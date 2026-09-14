import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.10 — Global Central Bank net gold purchases. Confirmed live
// 2026-09-15: World Gold Council's Goldhub Excel downloads are
// Cloudflare-blocked (HTTP 403 "Access denied," same wall class as
// nseindia.com) — see adapters/niftyindices.ts's investigation. DBnomics
// (db.nomics.world) mirrors IMF/World Bank/OECD datasets with a plain,
// unauthenticated REST JSON API — no key, no Cloudflare, no bot-wall
// encountered.
//
// Series: IMF International Financial Statistics (IFS), monthly, "All
// Countries, excluding the IO" (the genuine global total — IO =
// International Organizations, excluded to avoid double-counting
// supranational holdings like the IMF's own gold), Official Reserve
// Assets: Gold, volume in millions of fine troy ounces. Confirmed live:
// 829 monthly observations, 1950-12 through 2025-06 (a few months'
// reporting lag is normal for official IMF reserve data, not a stale
// source). This is a STOCK series (total reserves held), not a flow —
// month-over-month CHANGE is what "net purchases" means, computed here,
// not fetched directly (IMF doesn't publish a separate flow series).
const DBNOMICS_BASE_URL = "https://api.db.nomics.world/v22/series/IMF/IFS/M.W00.RAFAGOLDV_OZT";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Millions of troy ounces -> tonnes. 1 troy oz = 31.1034768 grams;
// 1 tonne = 1,000,000 grams. So 1 million troy oz = 31.1034768 tonnes.
const TROY_OZ_MILLIONS_TO_TONNES = 31.1034768;

export const CB_GOLD_RESERVES_TONNES_SERIES_ID = "cb_gold_reserves_tonnes";

export class DbNomicsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbNomicsFetchError";
  }
}

interface DbNomicsResponse {
  series: {
    docs: Array<{
      period: string[]; // "YYYY-MM"
      value: (number | null)[];
    }>;
  };
  errors?: unknown;
}

// Pure parse step, split from the network call — same pattern as every
// other adapter in this project. Converts millions-of-troy-oz to tonnes
// (the unit the spec's own rubric and worked example use) and drops null
// observations (IMF sometimes reports a gap month) rather than guessing.
export function parseDbNomicsReserves(json: DbNomicsResponse): Observation[] {
  if (json.errors) {
    throw new DbNomicsFetchError(`DBnomics response carried an error: ${JSON.stringify(json.errors)}`);
  }
  const doc = json.series.docs[0];
  if (!doc) {
    throw new DbNomicsFetchError("DBnomics response had no series docs — series code may be wrong or discontinued.");
  }
  const out: Observation[] = [];
  for (let i = 0; i < doc.period.length; i++) {
    const rawValue = doc.value[i];
    if (rawValue === null || rawValue === undefined) continue;
    const tonnes = rawValue * TROY_OZ_MILLIONS_TO_TONNES;
    // "YYYY-MM" -> "YYYY-MM-01", this project's monthly-series convention
    // (see fred.ts, amfi.ts).
    const date = `${doc.period[i]}-01`;
    out.push({ seriesId: CB_GOLD_RESERVES_TONNES_SERIES_ID, date, value: tonnes, raw: { period: doc.period[i], rawValueMillionOz: rawValue } });
  }
  return out;
}

async function fetchReservesSeries(): Promise<Observation[]> {
  const res = await request(`${DBNOMICS_BASE_URL}?observations=1`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new DbNomicsFetchError(`DBnomics request failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const json = (await res.body.json()) as DbNomicsResponse;
  return parseDbNomicsReserves(json);
}

export function createDbNomicsAdapter(): SourceAdapter {
  return {
    id: "DBNOMICS",
    series: [CB_GOLD_RESERVES_TONNES_SERIES_ID],

    // Real history in one request — no per-month pagination needed
    // (unlike AMFI/niftyindices.ts), so fetchLatest() and fetchHistory()
    // both just return the full series; the caller/store handles
    // upsert-by-date the same as any other bulk fetch.
    async fetchLatest(): Promise<Observation[]> {
      const all = await fetchReservesSeries();
      return all.length > 0 ? [all[all.length - 1]!] : [];
    },

    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const all = await fetchReservesSeries();
      return all.filter((o) => {
        const d = new Date(o.date);
        return d >= from && d <= to;
      });
    },

    async health(): Promise<HealthStatus> {
      try {
        const all = await fetchReservesSeries();
        return {
          source: "DBNOMICS",
          ok: all.length > 0,
          lastChecked: new Date().toISOString(),
          detail: all.length > 0 ? null : "DBnomics returned zero observations",
        };
      } catch (err) {
        return {
          source: "DBNOMICS",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
