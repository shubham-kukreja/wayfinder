import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.4 — NSE. Live-investigated across 4 sessions before this adapter
// was built; the first 3 sessions (2026-09-03, 2026-09-08 x2) tried
// niftyindices.com's historical-data reports page — a 2-step
// dropdown-driven flow behind Akamai bot-manager whose drill-down
// payload was never cracked (that dead end's full blow-by-blow is
// preserved in git history / HANDOFF.md, not repeated here since it's
// no longer the active approach).
//
// SESSION 4 (2026-09-08) FINDING — a DIFFERENT domain, nseindia.com
// (not niftyindices.com), exposes index-level P/E, P/B, and dividend
// yield through a much simpler cookie-then-fetch pattern with NO
// Akamai challenge on this specific endpoint:
//
//   1. GET a real page (e.g. /market-data/live-market-indices) to
//      harvest Set-Cookie headers.
//   2. GET /api/allIndices with those cookies + a browser-like
//      User-Agent + Referer. Returns clean JSON, ~139 indices, one
//      request, confirmed repeatable on this session (no rotation/
//      expiry hit).
//
// Each row carries pe/pb/dy as strings for every real index —
// confirmed live for NIFTY 50, NIFTY 100, NIFTY MIDCAP 150, NIFTY
// SMALLCAP 250, NIFTY BANK, NIFTY IT, NIFTY PHARMA, NIFTY AUTO, NIFTY
// FMCG, NIFTY ENERGY, NIFTY METAL. No "Capital Goods" index exists in
// the 139-row list (closest: Infrastructure, Capital Markets,
// Commodities — none is a direct match) — dropped rather than guessed,
// per this project's "never guess" invariant.
//
// CAVEATS (do not build past these without new evidence):
//   - LATEST ONLY. Guessed historical-index endpoint names
//     (/api/historical/generateIndexWiseHistoricalData,
//     /api/historical/indicesHistory) both hit Akamai's real challenge
//     wall (503s with injected bot-manager sensor JS) — that stricter
//     tier does exist on this domain too, just gated behind different
//     paths than /api/allIndices. No historical index-level source
//     found. fetchHistory() is a deliberate no-op, same pattern as
//     bullion.ts's metals.dev limitation — history must accumulate via
//     repeated fetchLatest() calls over time (a daily refresh/cron),
//     not a backfill.
//   - NO TRI (total-return-index) FIELD ANYWHERE in this payload —
//     only price-return figures (last/previousClose/perChange365d/
//     perChange30d). The sector_tr_* / nifty50_tr score cells stay
//     unreachable from this source; only the *_pe cells are unlocked.
//   - nseindia.com is a known bot-protected surface in general — this
//     one endpoint being reachable today is not a guarantee it stays
//     that way. health() below is a real live check, not a static ok.
const NSE_BASE_URL = "https://www.nseindia.com";
const COOKIE_HARVEST_PATH = "/market-data/live-market-indices";
const ALL_INDICES_PATH = "/api/allIndices";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class NseFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NseFetchError";
  }
}

// NSE index display name -> internal series ID, for the two figures
// each row carries that this adapter reads (pe -> *_pe, dy is also
// present but no score cell references a dividend-yield series yet).
// Only indices confirmed present in a live /api/allIndices response are
// mapped; "Capital Goods" has no matching index and is intentionally
// absent (see file-level note above).
const INDEX_SERIES_MAP: Record<string, string> = {
  "NIFTY 50": "nifty50_pe",
  "NIFTY 100": "nifty100_pe",
  "NIFTY MIDCAP 150": "midcap150_pe",
  "NIFTY SMALLCAP 250": "smallcap250_pe",
  "NIFTY BANK": "sector_pe_banking",
  "NIFTY IT": "sector_pe_it",
  "NIFTY PHARMA": "sector_pe_pharma",
  "NIFTY AUTO": "sector_pe_auto",
  "NIFTY FMCG": "sector_pe_fmcg",
  "NIFTY ENERGY": "sector_pe_energy",
  "NIFTY METAL": "sector_pe_metals",
};

// P/B is only spec'd for Midcap 150 / Smallcap 250 (the two segments whose
// valuation rubric references book value); the row already carries `pb`
// for every index, this map just scopes which indices we actually emit it
// for, same pattern as INDEX_SERIES_MAP for pe.
const INDEX_PB_SERIES_MAP: Record<string, string> = {
  "NIFTY MIDCAP 150": "midcap150_pb",
  "NIFTY SMALLCAP 250": "smallcap250_pb",
};

interface NseIndexRow {
  index: string;
  pe?: string;
  pb?: string;
  dy?: string;
}

interface AllIndicesResponse {
  data: NseIndexRow[];
}

// Pure mapping step, split out from the network call so the row-parsing
// logic (which index names map to which series, which pe/pb values are
// dropped as non-numeric) can be unit-tested against fixture JSON
// without hitting the network — same split AMFI's adapter uses between
// parseAmfiCategoryReport (pure) and fetchLatest (network + parse).
export function mapIndexRowsToObservations(rows: NseIndexRow[], asOfDate: string): Observation[] {
  const out: Observation[] = [];
  for (const row of rows) {
    const peSeriesId = INDEX_SERIES_MAP[row.index];
    if (peSeriesId && row.pe !== undefined) {
      const value = Number(row.pe);
      if (Number.isFinite(value)) out.push({ seriesId: peSeriesId, date: asOfDate, value, raw: row }); // "-"/non-numeric pe: dropped, not guessed
    }

    const pbSeriesId = INDEX_PB_SERIES_MAP[row.index];
    if (pbSeriesId && row.pb !== undefined) {
      const value = Number(row.pb);
      if (Number.isFinite(value)) out.push({ seriesId: pbSeriesId, date: asOfDate, value, raw: row }); // "-"/non-numeric pb: dropped, not guessed
    }
  }
  return out;
}

// Parses only the cookie name=value pairs out of Set-Cookie headers —
// attributes (Path, Expires, HttpOnly, ...) are dropped since this
// adapter only needs to replay the cookies on the next request, not
// honour their full semantics.
function parseSetCookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
  return headers.map((h) => h.split(";")[0]).join("; ");
}

async function harvestCookies(): Promise<string> {
  const res = await request(`${NSE_BASE_URL}${COOKIE_HARVEST_PATH}`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  // Drain the body even though it's unused — undici requires the
  // response body be consumed before the connection is reusable.
  await res.body.text();
  const cookies = parseSetCookieHeader(res.headers["set-cookie"]);
  if (!cookies) {
    throw new NseFetchError(`No cookies returned from ${COOKIE_HARVEST_PATH} (status ${res.statusCode})`);
  }
  return cookies;
}

async function fetchAllIndices(): Promise<NseIndexRow[]> {
  const cookies = await harvestCookies();
  const res = await request(`${NSE_BASE_URL}${ALL_INDICES_PATH}`, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      Referer: `${NSE_BASE_URL}${COOKIE_HARVEST_PATH}`,
      Cookie: cookies,
    },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new NseFetchError(`${ALL_INDICES_PATH} failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const data = (await res.body.json()) as AllIndicesResponse;
  return data.data ?? [];
}

export function createNseAdapter(): SourceAdapter {
  return {
    id: "NSE",
    series: [...Object.values(INDEX_SERIES_MAP), ...Object.values(INDEX_PB_SERIES_MAP)],

    async fetchLatest(): Promise<Observation[]> {
      const rows = await fetchAllIndices();
      const asOfDate = new Date().toISOString().slice(0, 10);
      return mapIndexRowsToObservations(rows, asOfDate);
    },

    // No historical index-level endpoint found on this domain either
    // (see file-level caveats) — history must accumulate via repeated
    // fetchLatest() calls over time, same limitation as bullion.ts.
    async fetchHistory(): Promise<Observation[]> {
      throw new NseFetchError(
        "nseindia.com exposes no historical index-level P/E/P/B endpoint found so far — only /api/allIndices (latest). " +
          "History must accumulate via repeated fetchLatest() calls (daily refresh), not backfill."
      );
    },

    async health(): Promise<HealthStatus> {
      try {
        const rows = await fetchAllIndices();
        return {
          source: "NSE",
          ok: rows.length > 0,
          lastChecked: new Date().toISOString(),
          detail: rows.length > 0 ? null : "allIndices returned zero rows",
        };
      } catch (err) {
        return {
          source: "NSE",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
