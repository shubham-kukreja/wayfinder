import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.9 — niftyindices.com Daily Snapshot. Confirmed live 2026-09-15: a
// SEPARATE domain/mechanism from nse.ts's nseindia.com/api/allIndices —
// this one solves two problems that source could not:
//
//   1. NIFTY CAPITAL GOODS P/E/P/B — nse.ts's /api/allIndices genuinely
//      has no matching index (confirmed across the ~139-row live list).
//      niftyindices.com's Daily Snapshot report DOES carry "Nifty Capital
//      Goods" as its own row, with P/E, P/B, and Div Yield columns.
//   2. Real historical backfill — nse.ts's /api/allIndices is latest-only
//      (no historical index-level endpoint found on that domain, a
//      genuine Akamai wall on the endpoints tried). This Daily Snapshot
//      CSV has a DIRECTLY CONSTRUCTIBLE per-day URL
//      (/Daily_Snapshot/ind_close_all_DDMMYYYY.csv, confirmed live back
//      to at least 2021, likely further) — no pagination cap, one request
//      per trading day, same backfill shape AMFI's adapter already uses.
//
// Mechanism: unlike nseindia.com, this endpoint needs NO cookie handshake
// at all — confirmed live with a bare unauthenticated GET (re-verified
// 2026-09-15 after an earlier test run's "no cookies returned" failure
// turned out to be a leftover cookie jar from unrelated manual testing,
// not an actual requirement — the CSV is a genuinely open static file).
// Also NOT behind Akamai: no 503/challenge page encountered across ~10
// test requests spanning 2021-2026, including weekend/holiday dates
// (which 404 honestly with an HTML error page rather than any bot-wall).
//
// CAVEAT: the URL pattern was reverse-engineered by testing directly
// constructed URLs, not by driving the actual report-selector UI (which
// hit ERR_TIMED_OUT under a headless Playwright browser during
// investigation — the raw HTTP endpoint itself was NOT timing out, only
// the headless-browser page load was, likely unrelated fingerprinting on
// full page loads specifically). If this URL pattern ever breaks, the
// UI-driven POST /reports/historical-data/Index/ endpoint is the
// documented fallback (also confirmed live, returns a DownloadLink for
// the exact CSV filename this adapter constructs directly).
const NIFTYINDICES_BASE_URL = "https://www.niftyindices.com";
const REFERER_PATH = "/reports/historical-data";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export class NiftyIndicesFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NiftyIndicesFetchError";
  }
}

// Index display name -> internal series ID stem. Reuses nse.ts's
// sector_pe_* naming for the 7 sectors that adapter already covers (so
// this becomes an additional/backfill source for the same series, not a
// competing naming scheme) and adds sector_pe_capgoods, the one sector
// nse.ts's source genuinely cannot reach.
const INDEX_PE_SERIES_MAP: Record<string, string> = {
  "Nifty 50": "nifty50_pe",
  "Nifty 100": "nifty100_pe",
  "Nifty Midcap 150": "midcap150_pe",
  "Nifty Smallcap 250": "smallcap250_pe",
  "Nifty Bank": "sector_pe_banking",
  "Nifty IT": "sector_pe_it",
  "Nifty Pharma": "sector_pe_pharma",
  "Nifty Auto": "sector_pe_auto",
  "Nifty FMCG": "sector_pe_fmcg",
  "Nifty Energy": "sector_pe_energy",
  "Nifty Metal": "sector_pe_metals",
  "Nifty Capital Goods": "sector_pe_capgoods",
};

const INDEX_PB_SERIES_MAP: Record<string, string> = {
  "Nifty Midcap 150": "midcap150_pb",
  "Nifty Smallcap 250": "smallcap250_pb",
  "Nifty Capital Goods": "sector_pb_capgoods",
};

// Closing index VALUE (not P/E) — the raw price level, stored so 6M/12M
// relative price returns can be computed locally from accumulated daily
// closes, per the same "compute returns from history you already have"
// approach used elsewhere in this project (e.g. gold/silver ratio from
// gold_usd_futures/silver_usd_futures history).
const INDEX_CLOSE_SERIES_MAP: Record<string, string> = {
  "Nifty 50": "nifty50_close",
  "Nifty Bank": "sector_close_banking",
  "Nifty IT": "sector_close_it",
  "Nifty Pharma": "sector_close_pharma",
  "Nifty Auto": "sector_close_auto",
  "Nifty FMCG": "sector_close_fmcg",
  "Nifty Energy": "sector_close_energy",
  "Nifty Metal": "sector_close_metals",
  "Nifty Capital Goods": "sector_close_capgoods",
};

// Div Yield — only stored for Nifty 50, feeding the TRI-return
// approximation (§ derive.ts's niftyTriApprox12mReturn): no NSE/
// niftyindices.com source publishes a real Nifty 50 Total Return Index
// (checked live 2026-09-15 — the Daily Snapshot CSV only has a distinct
// "Nifty 50 Futures TR Index," a different product). Price return
// (nifty50_close, above) plus this trailing Div Yield approximates it
// instead. Not stored for other indices since nothing currently consumes
// a non-Nifty-50 TRI approximation.
const INDEX_DIV_YIELD_SERIES_MAP: Record<string, string> = {
  "Nifty 50": "nifty50_div_yield",
};

function parseSnapshotNumber(text: string | undefined): number | null {
  if (!text || text === "-" || text === "") return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

// Pure parse step, split from the network call so it's unit-testable
// against a fixture — same split every other adapter in this project
// uses. The CSV has no quoting/escaping complexity (verified live: no
// commas inside any field, unlike AMFI's PDF-derived text), so a plain
// split is sufficient, no CSV-parsing library needed.
export function parseDailySnapshotCsv(csvText: string, isoDate: string): Observation[] {
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !lines[0]!.startsWith("Index Name,")) {
    // The site returns HTTP 200 with an HTML "Error 404" page body for a
    // non-trading day (weekend/holiday) rather than a real 404 status —
    // detected here by content, not status code.
    throw new NiftyIndicesFetchError("Response is not a Daily Snapshot CSV (likely a non-trading day or the report format changed).");
  }

  const out: Observation[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const indexName = cols[0];
    if (!indexName) continue;
    const closeValue = parseSnapshotNumber(cols[5]);
    const peValue = parseSnapshotNumber(cols[10]);
    const pbValue = parseSnapshotNumber(cols[11]);
    const divYieldValue = parseSnapshotNumber(cols[12]);

    const closeSeriesId = INDEX_CLOSE_SERIES_MAP[indexName];
    if (closeSeriesId && closeValue !== null) {
      out.push({ seriesId: closeSeriesId, date: isoDate, value: closeValue, raw: { line } });
    }
    const peSeriesId = INDEX_PE_SERIES_MAP[indexName];
    if (peSeriesId && peValue !== null) {
      out.push({ seriesId: peSeriesId, date: isoDate, value: peValue, raw: { line } });
    }
    const pbSeriesId = INDEX_PB_SERIES_MAP[indexName];
    if (pbSeriesId && pbValue !== null) {
      out.push({ seriesId: pbSeriesId, date: isoDate, value: pbValue, raw: { line } });
    }
    const divYieldSeriesId = INDEX_DIV_YIELD_SERIES_MAP[indexName];
    if (divYieldSeriesId && divYieldValue !== null) {
      // Stored as the raw percentage (e.g. 1.21, not 0.0121) — matches
      // this CSV's own convention for P/E, P/B, etc; the decimal
      // conversion happens at point of use (derive.ts), not here.
      out.push({ seriesId: divYieldSeriesId, date: isoDate, value: divYieldValue, raw: { line } });
    }
  }
  return out;
}

// DD-MM-YYYY -> DDMMYYYY, the exact filename format confirmed live.
function ddmmyyyyCompact(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

async function fetchSnapshotForDate(date: Date): Promise<Observation[]> {
  const filename = `ind_close_all_${ddmmyyyyCompact(date)}.csv`;
  const res = await request(`${NIFTYINDICES_BASE_URL}/Daily_Snapshot/${filename}`, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/csv, text/plain, */*",
      Referer: `${NIFTYINDICES_BASE_URL}${REFERER_PATH}`,
    },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new NiftyIndicesFetchError(`${filename} failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const csvText = await res.body.text();
  const isoDate = date.toISOString().slice(0, 10);
  return parseDailySnapshotCsv(csvText, isoDate);
}

export function createNiftyIndicesAdapter(): SourceAdapter {
  return {
    id: "NIFTYINDICES",
    series: [
      ...new Set([
        ...Object.values(INDEX_PE_SERIES_MAP),
        ...Object.values(INDEX_PB_SERIES_MAP),
        ...Object.values(INDEX_CLOSE_SERIES_MAP),
        ...Object.values(INDEX_DIV_YIELD_SERIES_MAP),
      ]),
    ],

    async fetchLatest(): Promise<Observation[]> {
      // niftyindices.com publishes the same day's snapshot after market
      // close; "yesterday" is the safest bet for "most recent AVAILABLE"
      // without a trading-calendar dependency. If yesterday was a
      // weekend/holiday, walk back up to 5 days rather than fail outright
      // (mirrors bullion.ts's lastBusinessDay reasoning, generalised
      // since niftyindices.com has no documented holiday calendar either).
      let cursor = new Date();
      cursor.setDate(cursor.getDate() - 1);
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await fetchSnapshotForDate(cursor);
        } catch (err) {
          lastError = err;
          cursor.setDate(cursor.getDate() - 1);
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new NiftyIndicesFetchError("Failed to fetch a Daily Snapshot after 5 attempts.");
    },

    // Real backfill, unlike nse.ts's fetchHistory() (a deliberate no-op).
    // One request per calendar day in range; non-trading days (weekends,
    // holidays) throw per-day and are skipped, not aborted, same pattern
    // AMFI's fetchHistory() uses for a failed month.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const out: Observation[] = [];
      const cursor = new Date(from);
      while (cursor <= to) {
        try {
          const observations = await fetchSnapshotForDate(cursor);
          out.push(...observations);
        } catch {
          // A single non-trading day is a gap in the backfill, not a
          // reason to abort the whole range (§9: a failed fetch is a
          // warning, never an exception, at the per-day granularity this
          // backfill actually operates at).
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      return out;
    },

    async health(): Promise<HealthStatus> {
      try {
        let cursor = new Date();
        cursor.setDate(cursor.getDate() - 1);
        let observations: Observation[] = [];
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            observations = await fetchSnapshotForDate(cursor);
            break;
          } catch {
            cursor.setDate(cursor.getDate() - 1);
          }
        }
        return {
          source: "NIFTYINDICES",
          ok: observations.length > 0,
          lastChecked: new Date().toISOString(),
          detail: observations.length > 0 ? null : "No Daily Snapshot found in the last 5 days",
        };
      } catch (err) {
        return {
          source: "NIFTYINDICES",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
