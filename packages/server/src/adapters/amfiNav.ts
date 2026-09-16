import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.13 — AMFI daily scheme NAV. A genuinely different shape from every
// other adapter in this file: ~14,373 live schemes with no server-side
// per-scheme filter on either endpoint (confirmed live 2026-09-16 — a
// schcode query param on the history endpoint was tried and simply times
// out, so it isn't honoured), versus every other adapter's small fixed
// list of series known at compile time. "Which schemes to pull" is
// therefore a runtime allowlist (store/trackedSchemes.ts), not a static
// series array — this file exports fetch functions that take that
// allowlist as a parameter, plus a thin SourceAdapter wrapper
// (createAmfiNavAdapter) built from the DB's current tracked list so it
// still fits the refresh pipeline's uniform interface.
//
// Two endpoints, two different column orders (verified live):
//   1. Latest snapshot: portal.amfiindia.com/spages/NAVAll.txt — one
//      request, every scheme's current NAV. Columns:
//      Code;ISIN;ISIN2;Name;Plan;Option;NAV;Date
//   2. Historical range: portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx
//      ?frmdt=DD-Mon-YYYY&todt=DD-Mon-YYYY — every scheme, every day in
//      range, no scheme filter. Columns:
//      Code;Name;Plan;Option;ISIN;ISIN2;NAV;Date
// Both are grouped/paginated with blank lines, "Open Ended Schemes(...)"
// category headers, and bare AMC name lines interleaved with real data
// rows (same shape AMFI's category-flow PDF report uses, just CSV instead
// of PDF-extracted text) — a real data row is recognised by field count
// (exactly 8 semicolon-delimited fields), not by position.
//
// Size/latency confirmed live: ~1MB / ~2s for one day (all schemes), ~5MB
// / ~2s for 7 days — scales linearly with days in range, independent of
// which schemes are actually tracked (the filter happens client-side,
// after download). A multi-year single request would be hundreds of MB
// and impractically slow, so fetchTrackedNavHistory chunks the requested
// range into fixed-size windows and discards untracked rows per chunk
// rather than holding the full-universe response for the whole range.
const NAV_LATEST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
const NAV_HISTORY_URL = "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx";

// Chunk size tuned against the live 7-day/~5MB benchmark above: a month
// (~30 days, ~22MB) stays comfortably fast per request while keeping the
// number of chunks for a multi-year backfill manageable (a 10-year
// backfill is ~120 requests, not ~3650 for a daily chunk or 1 impossibly
// slow request for the whole range).
const HISTORY_CHUNK_DAYS = 30;

export function amfiNavSeriesId(schemeCode: string): string {
  return `amfi_nav:${schemeCode}`;
}

export class AmfiNavFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmfiNavFetchError";
  }
}

export interface NavRow {
  schemeCode: string;
  schemeName: string;
  nav: number;
  date: string; // ISO
}

const MONTH_ABBR_TO_NUM: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// "15-Sep-2026" -> "2026-09-15". AMFI's NAV files use this format on both
// endpoints (distinct from amfi.ts's category-flow report, which has no
// per-row date at all — one reportDate covers the whole file there).
function parseAmfiNavDate(text: string): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, dd, mon, yyyy] = match;
  const mm = MONTH_ABBR_TO_NUM[mon!.toLowerCase()];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd!.padStart(2, "0")}`;
}

function parseNavNumber(text: string): number | null {
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Shared "is this a real 8-field data row, not a header/AMC-name/blank
// line" split, since both formats use the same delimiter and field count.
function splitDataRows(text: string): string[][] {
  return text
    .split("\n")
    .map((line) => line.split(";"))
    .filter((fields) => fields.length === 8);
}

// Pure parse step for the latest-snapshot endpoint (Code;ISIN;ISIN2;Name;
// Plan;Option;NAV;Date), split from the network call for the same reason
// every other adapter in this project splits parsing from fetching —
// testable against a fixture without hitting the network.
export function parseNavAllLatest(text: string): NavRow[] {
  const out: NavRow[] = [];
  for (const fields of splitDataRows(text)) {
    const [code, , , name, , , navText, dateText] = fields;
    if (!code || code === "Scheme Code" || !name) continue; // header row: field count coincidentally matches on some AMFI exports
    const nav = parseNavNumber(navText!);
    const date = parseAmfiNavDate(dateText!);
    if (nav === null || date === null) continue; // malformed row: dropped, not guessed
    out.push({ schemeCode: code.trim(), schemeName: name.trim(), nav, date });
  }
  return out;
}

// Pure parse step for the historical-range endpoint (Code;Name;Plan;
// Option;ISIN;ISIN2;NAV;Date) — different column order from the latest
// endpoint, confirmed live 2026-09-16.
export function parseNavHistoryChunk(text: string): NavRow[] {
  const out: NavRow[] = [];
  for (const fields of splitDataRows(text)) {
    const [code, name, , , , , navText, dateText] = fields;
    if (!code || code === "Scheme Code" || !name) continue;
    const nav = parseNavNumber(navText!);
    const date = parseAmfiNavDate(dateText!);
    if (nav === null || date === null) continue;
    out.push({ schemeCode: code.trim(), schemeName: name.trim(), nav, date });
  }
  return out;
}

function navRowsToObservations(rows: NavRow[]): Observation[] {
  return rows.map((r) => ({
    seriesId: amfiNavSeriesId(r.schemeCode),
    date: r.date,
    value: r.nav,
    raw: { schemeCode: r.schemeCode, schemeName: r.schemeName },
  }));
}

async function fetchText(url: string): Promise<string> {
  const res = await request(url, { method: "GET" });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new AmfiNavFetchError(`${url} failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  return res.body.text();
}

// DD-Mon-YYYY, the exact format both AMFI endpoints require.
function toAmfiDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = monthNames[date.getMonth()];
  return `${dd}-${mon}-${date.getFullYear()}`;
}

// Fetches the full latest-NAV universe (one request, ~1MB, ~14k schemes)
// and returns only the rows for tracked scheme codes. The full parse
// still runs over every scheme (AMFI gives no server-side filter), but
// nothing beyond the tracked subset is retained afterward.
export async function fetchTrackedNavLatest(trackedCodes: ReadonlySet<string>): Promise<Observation[]> {
  const text = await fetchText(NAV_LATEST_URL);
  const rows = parseNavAllLatest(text).filter((r) => trackedCodes.has(r.schemeCode));
  return navRowsToObservations(rows);
}

// Fetches history in fixed-size chunks (see HISTORY_CHUNK_DAYS above),
// filtering each chunk down to tracked codes before moving to the next —
// same "a single bad chunk is a gap, not an abort" resilience pattern
// amfi.ts's month-by-month category-report backfill and niftyindices.ts's
// day-by-day backfill both use.
export async function fetchTrackedNavHistory(trackedCodes: ReadonlySet<string>, from: Date, to: Date): Promise<Observation[]> {
  const out: Observation[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + HISTORY_CHUNK_DAYS - 1);
    const effectiveEnd = chunkEnd > to ? to : chunkEnd;

    try {
      const params = new URLSearchParams({ frmdt: toAmfiDate(cursor), todt: toAmfiDate(effectiveEnd) });
      const text = await fetchText(`${NAV_HISTORY_URL}?${params.toString()}`);
      const rows = parseNavHistoryChunk(text).filter((r) => trackedCodes.has(r.schemeCode));
      out.push(...navRowsToObservations(rows));
    } catch {
      // A single failed chunk is a gap in the backfill, not a reason to
      // abort the whole range (§9 — a failed fetch is a warning, never an
      // exception, applied here at the per-chunk granularity this
      // backfill actually operates at).
    }

    cursor.setDate(cursor.getDate() + HISTORY_CHUNK_DAYS);
  }
  return out;
}

// SourceAdapter wrapper for the refresh pipeline (POST /api/refresh?
// sources=amfi_nav). Unlike every other adapter's `series` (known at
// import time), this one is read from the DB's tracked list at
// construction time — the one deliberate deviation from the "series
// known statically" assumption the rest of this project's adapters share,
// forced by AMFI having no per-scheme filter to build a static list from.
export function createAmfiNavAdapter(trackedCodes: string[]): SourceAdapter {
  const codeSet = new Set(trackedCodes);

  return {
    id: "AMFI_NAV",
    series: trackedCodes.map(amfiNavSeriesId),

    async fetchLatest(): Promise<Observation[]> {
      return fetchTrackedNavLatest(codeSet);
    },

    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      return fetchTrackedNavHistory(codeSet, from, to);
    },

    async health(): Promise<HealthStatus> {
      if (codeSet.size === 0) {
        return {
          source: "AMFI_NAV",
          ok: true,
          lastChecked: new Date().toISOString(),
          detail: "No schemes are currently tracked (tracked_schemes is empty) — nothing to fetch, not a failure.",
        };
      }
      try {
        const observations = await fetchTrackedNavLatest(codeSet);
        const foundCodes = new Set(observations.map((o) => o.raw && typeof o.raw === "object" && "schemeCode" in o.raw ? (o.raw as { schemeCode: string }).schemeCode : undefined));
        const missing = trackedCodes.filter((c) => !foundCodes.has(c));
        return {
          source: "AMFI_NAV",
          ok: observations.length > 0,
          lastChecked: new Date().toISOString(),
          detail:
            missing.length > 0
              ? `${missing.length} of ${trackedCodes.length} tracked scheme codes not found in the latest NAV file: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`
              : null,
        };
      } catch (err) {
        return {
          source: "AMFI_NAV",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
