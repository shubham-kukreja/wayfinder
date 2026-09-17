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

// Series used by this dashboard:
//   DFII10 -> us_real_10y (US 10Y TIPS real yield, §7.1/§8.4)
//   INDIRLTLT01STM -> gsec_10y (India 10Y government bond yield, monthly,
//     OECD-sourced). §10.3 originally targeted RBI DBIE for this series,
//     but the only "yield" page found on the dbie.rbihub.in mirror
//     (yield-of-sgl-transactions-in-government-dated-securities) turned
//     out to be a price/turnover index (values ~100-280), not a yield —
//     confirmed live 2026-09-03. INDIRLTLT01STM is the correct magnitude
//     (6-7%) and current; using FRED here is more reliable than scraping
//     a series that isn't actually on the RBI mirror.
//   INDCPIALLMINMEI -> cpi_index (India CPI, all items, OECD-sourced,
//     monthly, Index 2015=100). The RBI DBIE mirror only ever exposes a
//     ~15-month trailing window for CPI (adapters/rbi.ts), which is
//     below the 24-observation percentile floor — so l1.metals::valuation
//     (real gold price = gold_inr deflated by cpi_index) and
//     l1.debt::valuation (gsec_10y - cpi_yoy) both sat permanently at
//     insufficient_history on a 1-observation cpi_index. This series
//     genuinely backfills (1957-01 onward, verified live 2026-09-17).
//     KNOWN LIMITATION: OECD stopped updating it at 2025-03, so it is
//     deliberately a BACKFILL-ONLY source — it gives the percentile a
//     real distribution to rank against, while the RBI mirror keeps
//     supplying the current month. "Latest fetched_at wins" per date
//     means the two coexist without either clobbering the other.
// DELIBERATELY NOT WIRED: FRED's INDIR3TIB01STM (India 3-month interbank
// rate) was evaluated as a history source for tbill_1y and REJECTED.
// It is a different instrument at a different tenor, and it shows: it
// reads 5.32% for 2026-07 while CCIL's real 364-day security yield reads
// 5.91-6.04% over the same period — a systematic ~0.5pp gap. Percentiling
// today's real 364D yield against an interbank-rate distribution would
// rank it against the wrong distribution and silently bias
// debt.liquid::carry. A wrong number with enough observations to look
// confident is worse than an honest insufficient_history (§1 invariant 4).
export const FRED_SERIES: FredSeriesConfig[] = [
  { fredSeriesId: "DFII10", internalSeriesId: "us_real_10y" },
  { fredSeriesId: "INDIRLTLT01STM", internalSeriesId: "gsec_10y" },
  { fredSeriesId: "INDCPIALLMINMEI", internalSeriesId: "cpi_index" },
  //   DEXINUS -> usd_inr (INR per USD, daily, 1973 onward). Converts the
  //     COMEX gold futures series into rupee terms for
  //     l1.metals::valuation's real-gold-price level, since gold_inr
  //     (IBJA spot) has no historical endpoint on the free tier.
  { fredSeriesId: "DEXINUS", internalSeriesId: "usd_inr" },
];
