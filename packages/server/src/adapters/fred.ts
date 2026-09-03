import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.1 — FRED. Free, single self-service tier, 120 req/min, commercial use
// permitted. FRED launched API v2 in November 2025 and now REQUIRES the
// api_key param — keyless access and pre-v2 client libraries are broken.
// This adapter fails loudly (not silently) if no key is configured, since a
// silent 400/403 here would otherwise look like "no data" rather than
// "misconfigured."
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

export interface FredSeriesConfig {
  fredSeriesId: string; // e.g. "DFII10"
  internalSeriesId: string; // e.g. "us_real_10y"
}

export class FredConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FredConfigError";
  }
}

interface FredObservationRow {
  date: string;
  value: string; // FRED returns "." for missing observations
}

interface FredResponse {
  observations: FredObservationRow[];
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new FredConfigError(
      "FRED_API_KEY is not set. FRED API v2 (Nov 2025+) requires a key for all requests — " +
        "keyless access is no longer supported. Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html"
    );
  }
  return apiKey;
}

function toIsoDate(fredDate: string): string {
  return fredDate; // FRED already returns YYYY-MM-DD
}

async function fetchSeries(fredSeriesId: string, apiKey: string, from?: Date, to?: Date): Promise<FredObservationRow[]> {
  const params = new URLSearchParams({
    series_id: fredSeriesId,
    api_key: apiKey,
    file_type: "json",
  });
  if (from) params.set("observation_start", from.toISOString().slice(0, 10));
  if (to) params.set("observation_end", to.toISOString().slice(0, 10));

  const url = `${FRED_BASE_URL}?${params.toString()}`;
  const res = await request(url, { method: "GET" });

  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new Error(`FRED request failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }

  const data = (await res.body.json()) as FredResponse;
  return data.observations;
}

export function createFredAdapter(config: { apiKey: string | undefined; series: FredSeriesConfig[] }): SourceAdapter {
  const { series } = config;

  function rowsToObservations(internalSeriesId: string, rows: FredObservationRow[]): Observation[] {
    return rows
      .filter((r) => r.value !== ".") // FRED's sentinel for a missing observation
      .map((r) => ({
        seriesId: internalSeriesId,
        date: toIsoDate(r.date),
        value: Number(r.value),
        raw: r,
      }));
  }

  return {
    id: "FRED",
    series: series.map((s) => s.internalSeriesId),

    async fetchLatest(): Promise<Observation[]> {
      const apiKey = requireApiKey(config.apiKey);
      const out: Observation[] = [];
      for (const s of series) {
        // Pull the trailing 90 days and take the latest — FRED series can
        // publish with a lag, so "latest available" isn't always "today."
        const from = new Date();
        from.setDate(from.getDate() - 90);
        const rows = await fetchSeries(s.fredSeriesId, apiKey, from, new Date());
        const observations = rowsToObservations(s.internalSeriesId, rows);
        if (observations.length > 0) {
          out.push(observations[observations.length - 1]!);
        }
      }
      return out;
    },

    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const apiKey = requireApiKey(config.apiKey);
      const out: Observation[] = [];
      for (const s of series) {
        const rows = await fetchSeries(s.fredSeriesId, apiKey, from, to);
        out.push(...rowsToObservations(s.internalSeriesId, rows));
      }
      return out;
    },

    async health(): Promise<HealthStatus> {
      try {
        requireApiKey(config.apiKey);
        // A cheap 1-row request against the first configured series.
        const first = series[0];
        if (!first) return { source: "FRED", ok: true, lastChecked: new Date().toISOString(), detail: "no series configured" };
        const from = new Date();
        from.setDate(from.getDate() - 7);
        await fetchSeries(first.fredSeriesId, config.apiKey!, from, new Date());
        return { source: "FRED", ok: true, lastChecked: new Date().toISOString(), detail: null };
      } catch (err) {
        return {
          source: "FRED",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// Series used by this dashboard (§7.1, §8.4): DFII10 -> us_real_10y (US 10Y TIPS real yield).
export const FRED_SERIES: FredSeriesConfig[] = [{ fredSeriesId: "DFII10", internalSeriesId: "us_real_10y" }];
