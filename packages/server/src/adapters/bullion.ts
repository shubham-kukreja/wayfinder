import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.2 — Bullion. IBJA is the benchmark but has no free official API.
// Primary source: metals.dev (free tier, 100 req/month, sources include
// IBJA and MCX). §11.5 requires 30-min caching for this source; the caller
// (scheduler/route) is responsible for that — this adapter itself does not
// throttle, but fetchLatest() intentionally makes ONE request per series,
// never a polling loop, to respect the monthly budget documented in §10.2.
//
// Gotcha (§10.2, §15.9): IBJA does not publish on weekends or national
// holidays. lastBusinessDay() below implements the fallback rule for
// month-end extraction during backfill.
const METALS_DEV_BASE_URL = "https://api.metals.dev/v1/latest";

export interface BullionSeriesConfig {
  metal: "gold" | "silver";
  internalSeriesId: string; // "gold_inr" | "silver_inr"
}

export class BullionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BullionConfigError";
  }
}

interface MetalsDevResponse {
  status: string;
  currency: string;
  unit: string;
  metals: Record<string, number>;
  timestamps: { metal: string; currency: string };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new BullionConfigError(
      "METALS_DEV_API_KEY is not set. Get a free key (100 req/month) at https://metals.dev/"
    );
  }
  return apiKey;
}

// Saturday=6, Sunday=0. Holiday calendar is intentionally out of scope here
// (no free authoritative source of NSE/IBJA holidays) — callers doing
// month-end extraction should treat a "no data on this date" response from
// IBJA/metals.dev as a signal to try the prior business day, not treat this
// function alone as sufficient.
export function lastBusinessDay(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
  else if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
  return d;
}

export function createBullionAdapter(config: { apiKey: string | undefined; series: BullionSeriesConfig[] }): SourceAdapter {
  const { series } = config;

  async function fetchLatestPrices(apiKey: string): Promise<MetalsDevResponse> {
    const params = new URLSearchParams({
      api_key: apiKey,
      currency: "INR",
      unit: "g",
    });
    const url = `${METALS_DEV_BASE_URL}?${params.toString()}`;
    const res = await request(url, { method: "GET" });

    if (res.statusCode !== 200) {
      const body = await res.body.text();
      throw new Error(`metals.dev request failed (${res.statusCode}): ${body.slice(0, 300)}`);
    }

    return (await res.body.json()) as MetalsDevResponse;
  }

  return {
    id: "IBJA",
    series: series.map((s) => s.internalSeriesId),

    async fetchLatest(): Promise<Observation[]> {
      const apiKey = requireApiKey(config.apiKey);
      const data = await fetchLatestPrices(apiKey);
      const asOfDate = lastBusinessDay(new Date(data.timestamps.metal)).toISOString().slice(0, 10);

      const out: Observation[] = [];
      for (const s of series) {
        // §10.2: IBJA is the benchmark. metals.dev's plain "gold"/"silver"
        // keys are a generic/LBMA-derived spot price, not the IBJA print —
        // read the ibja_* keys specifically so this series actually tracks
        // what the framework's other IBJA-referenced logic (SGB issuance,
        // RBI lending-against-jewellery norms) is benchmarked against.
        const price = data.metals[`ibja_${s.metal}`];
        if (price === undefined) continue;
        out.push({
          seriesId: s.internalSeriesId,
          date: asOfDate,
          value: price,
          raw: data,
        });
      }
      return out;
    },

    // metals.dev's free tier does not expose a historical range endpoint;
    // history for this source comes from backfill against a supplementary
    // archive (§11.4), not from this adapter. This is a deliberate no-op
    // rather than a silent partial implementation.
    async fetchHistory(): Promise<Observation[]> {
      throw new BullionConfigError(
        "metals.dev free tier has no historical range endpoint. Use the backfill script's IBJA archive source for history."
      );
    },

    async health(): Promise<HealthStatus> {
      try {
        const apiKey = requireApiKey(config.apiKey);
        await fetchLatestPrices(apiKey);
        return { source: "IBJA", ok: true, lastChecked: new Date().toISOString(), detail: null };
      } catch (err) {
        return {
          source: "IBJA",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const BULLION_SERIES: BullionSeriesConfig[] = [
  { metal: "gold", internalSeriesId: "gold_inr" },
  { metal: "silver", internalSeriesId: "silver_inr" },
];
