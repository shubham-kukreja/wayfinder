import type Database from "better-sqlite3";
import { request } from "undici";
import { insertObservations, latestObservations } from "../store/observations.js";

// Daily benchmark-index history for backtesting.
//
// ORIGINAL DESIGN used niftyindices.com's Daily_Snapshot CSVs (one HTTP
// request per calendar day — the same source niftyindices.ts's own
// month-end-sampled scoring-pipeline backfill uses, at 1 request/month
// instead). That works for a handful of days but genuinely breaks at
// backtest scale: confirmed LIVE 2026-09-20 that requesting a multi-year
// range this way (hundreds to ~1000 sequential/low-concurrency requests)
// gets this machine's IP 403'd by niftyindices.com's Akamai front — twice,
// at both concurrency 24 and a much more conservative concurrency 4 with
// retry/backoff. That block is host/IP-scoped, not per-adapter, so it also
// breaks niftyindices.ts's OWN backfill for the scoring pipeline while
// active — an unacceptable blast radius for what is an interactive,
// nice-to-have feature.
//
// REPLACED with Yahoo Finance's v8/finance/chart endpoint (the same one
// yahooMetals.ts already uses for gold/silver futures — no auth, confirmed
// live) using each index's NSE ticker (^NSEI, ^NSEBANK, ^CNX100,
// NIFTYMIDCAP150.NS, NIFTYSMLCAP250.NS — the two without a ^ prefix
// resolved via Yahoo's own /v1/finance/search, confirmed live 2026-09-20).
// This is a SINGLE bulk request for up to 10 years of daily closes, not
// one request per day — verified live: 5y/1d for ^NSEI returns 1,241
// points in one call, values matching niftyindices.com's own closes
// exactly (23346.4 on 2026-09-18 from both sources). Trades "same exact
// source as the scoring pipeline's sector P/E figures" for "does not
// require hundreds of requests and cannot get the scoring pipeline's own
// data source blocked" — the right trade for a user-triggered, ad hoc
// backtest.
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
// Only used for the monthly Div Yield sample below (see
// fetchMonthlyDivYield) — Yahoo has no dividend-yield field on the chart
// endpoint, so the TRI approximation's one remaining ingredient still
// comes from niftyindices.com, at the safe ~1-request-per-month cadence.
const NIFTYINDICES_BASE_URL = "https://www.niftyindices.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function ddmmyyyyCompact(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}${mm}${yyyy}`;
}

export function backtestIndexSeriesId(benchmarkId: string): string {
  return `bt_index:${benchmarkId}`;
}

// Display name -> Yahoo Finance ticker.
export const BENCHMARK_INDICES: Record<string, string> = {
  "Nifty 50": "^NSEI",
  "Nifty 100": "^CNX100",
  "Nifty Midcap 150": "NIFTYMIDCAP150.NS",
  "Nifty Smallcap 250": "NIFTYSMLCAP250.NS",
  "Nifty Bank": "^NSEBANK",
};

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: { quote: Array<{ close: Array<number | null> }> };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

// Yahoo's `range` param is a fixed enum (1mo/3mo/6mo/1y/2y/5y/10y/max), not
// an arbitrary from/to — this maps a requested day-span to the smallest
// range that covers it, since a longer range than needed just means Yahoo
// trims client-side below (still one request either way).
function rangeFor(spanDays: number): string {
  if (spanDays <= 31) return "1mo";
  if (spanDays <= 93) return "3mo";
  if (spanDays <= 186) return "6mo";
  if (spanDays <= 366) return "1y";
  if (spanDays <= 731) return "2y";
  if (spanDays <= 1826) return "5y";
  return "10y";
}

async function fetchYahooDailyCloses(ticker: string, spanDays: number): Promise<Record<string, number>> {
  const range = rangeFor(spanDays);
  const res = await request(`${YAHOO_CHART_BASE_URL}/${encodeURIComponent(ticker)}?range=${range}&interval=1d`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new Error(`Yahoo chart fetch for ${ticker} failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const data = (await res.body.json()) as YahooChartResponse;
  if (data.chart.error || !data.chart.result || data.chart.result.length === 0) {
    throw new Error(`Yahoo chart error for ${ticker}: ${data.chart.error?.description ?? "no result"}`);
  }
  const result = data.chart.result[0]!;
  const closes = result.indicators.quote[0]?.close ?? [];
  const out: Record<string, number> = {};
  result.timestamp.forEach((ts, i) => {
    const close = closes[i];
    if (close === null || close === undefined) return; // a session with no trade (rare) — a gap, not a zero
    const iso = new Date(ts * 1000).toISOString().slice(0, 10);
    out[iso] = close;
  });
  return out;
}

// A "Nifty 100" price index systematically understates a fund's real
// relative return: a mutual fund's NAV already reflects reinvested
// dividends, so comparing it against a raw PRICE index (no dividends)
// overstates the fund's outperformance by roughly the index's own yield
// (~1-1.5%/year for these indices) every year of the backtest. The correct
// comparison is total return (TRI), but no free source publishes a real
// TRI series for any of these 5 indices (confirmed live 2026-09-20 — Yahoo
// has no TRI ticker for any of them, niftyindices.com's TRI report is a
// separate paid product). This approximates TRI the same way
// pipeline/derive.ts's niftyTriApprox12mReturn already does for the
// scoring pipeline's l1.equity::momentum figure — price return compounded
// with trailing dividend yield — just applied DAILY across the whole
// backtest window instead of once over a fixed 12 months.
//
// Div Yield is published in the SAME Daily_Snapshot CSV the original
// day-by-day design used (column 12, "Div Yield") for all 5 benchmark
// indices, not just Nifty 50 — niftyindices.ts's own INDEX_DIV_YIELD_SERIES_MAP
// only wired up Nifty 50 because that's the only one the scoring pipeline
// needed; the raw data exists for the other 4 too (confirmed live in the
// same CSV pull that verified niftyindices.ts's own close values).
//
// Sampled MONTH-END, not daily — the same "10-15Y history means ~120
// requests, not ~3,650" reasoning fetchMonthEndHistory documents, and the
// exact volume that stayed safely under niftyindices.com's rate limit
// throughout this session's testing (unlike the day-by-day design that
// got this IP blocked at any concurrency). Dividend yield moves slowly
// month to month, so monthly sampling loses negligible accuracy for a
// value that's itself an approximation.
const DIV_YIELD_COL_INDEX = 12;

function divYieldForIndex(csvText: string, indexDisplayName: string): number | null {
  const lines = csvText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || !lines[0]!.startsWith("Index Name,")) return null;
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    if (cols[0] === indexDisplayName) {
      const value = Number((cols[DIV_YIELD_COL_INDEX] ?? "").replace(/,/g, ""));
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

async function fetchDivYieldForDate(date: Date, indexDisplayName: string): Promise<number | null> {
  const filename = `ind_close_all_${ddmmyyyyCompact(date)}.csv`;
  const res = await request(`${NIFTYINDICES_BASE_URL}/Daily_Snapshot/${filename}`, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/csv, text/plain, */*",
      Referer: `${NIFTYINDICES_BASE_URL}/reports/historical-data`,
    },
  });
  if (res.statusCode !== 200) return null;
  const csvText = await res.body.text();
  return divYieldForIndex(csvText, indexDisplayName);
}

// Month-end div yield samples, walking back up to 6 days to the last
// trading day when a month-end lands on a weekend/holiday (same fallback
// niftyindices.ts's own fetchMonthEndHistory uses) — sequential, one
// request per month, not parallel, the safe cadence confirmed against
// this host's rate limit throughout this session.
async function fetchMonthlyDivYield(benchmarkId: string, from: Date, to: Date): Promise<Array<{ date: string; value: number }>> {
  // BENCHMARK_INDICES' keys ("Nifty 50", "Nifty 100", …) are already
  // exactly the CSV's own "Index Name" column values (verified live
  // 2026-09-20 against the same Daily Snapshot CSV) — no separate display
  // name map needed.
  if (!BENCHMARK_INDICES[benchmarkId]) throw new Error(`Unknown benchmark: ${benchmarkId}`);
  const indexDisplayName = benchmarkId;

  const out: Array<{ date: string; value: number }> = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    for (let back = 0; back < 6; back++) {
      const probe = new Date(monthEnd);
      probe.setUTCDate(probe.getUTCDate() - back);
      if (probe > to) continue;
      const value = await fetchDivYieldForDate(probe, indexDisplayName);
      if (value !== null) {
        out.push({ date: probe.toISOString().slice(0, 10), value });
        break;
      }
      // 404/holiday: try the previous day. Exhausting all 6 leaves this
      // month absent — a gap in the yield series, not a failure; the
      // compounding step below just holds the last known yield forward.
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

// Builds a TRI-approximation series from a daily (TRADING-day, so with
// weekend/holiday gaps) price series and sparse (month-end) yield samples.
//
// BUG FIXED 2026-09-20, found by comparing a live backtest against
// AdvisorKhoj's published NIFTY 50 TRI benchmark calculator for the exact
// same window (2021-09-20 to 2026-09-18, ₹10L lumpsum): AdvisorKhoj's real
// TRI grew 42.37% while this approximation only produced ~40.18% — a
// ~2.2pp gap. Root cause: the loop compounds `yield/365` once per PRICE-
// SERIES ITERATION, but that series only has ~1,236 trading-day entries
// over those 5 years, not the ~1,826 calendar days /365 implies — so each
// gap (every weekend, every holiday) silently DROPPED the yield accrual
// for the calendar days it spanned, applying only 1236/1826 ≈ 68% of the
// intended yield. Confirmed numerically: with the real ~1.29% average
// yield sampled from niftyindices.com for this exact window, compounding
// once per trading day understates the cumulative yield contribution by
// ~2.2pp versus compounding once per ELAPSED CALENDAR DAY — which lines
// up almost exactly with the AdvisorKhoj discrepancy.
//
// Fix: raise the daily yield factor to the power of the number of
// CALENDAR days actually elapsed since the previous trading day (5 over a
// Fri->Mon gap, 3-4 over a long weekend/holiday), not always 1 — so a
// closed market still accrues the dividend yield it would have accrued in
// real life, exactly like a real TRI index does (accrued yield doesn't
// pause just because NSE is shut).
function buildTriApproxSeries(priceByDate: Record<string, number>, divYieldSamples: Array<{ date: string; value: number }>): Record<string, number> {
  const dates = Object.keys(priceByDate).sort();
  if (dates.length === 0) return {};

  const sortedYield = [...divYieldSamples].sort((a, b) => a.date.localeCompare(b.date));
  let yieldIdx = 0;
  let currentYieldPct = sortedYield.length > 0 ? sortedYield[0]!.value : 0;

  const out: Record<string, number> = { [dates[0]!]: priceByDate[dates[0]!]! };
  for (let i = 1; i < dates.length; i++) {
    const date = dates[i]!;
    while (yieldIdx < sortedYield.length && sortedYield[yieldIdx]!.date <= date) {
      currentYieldPct = sortedYield[yieldIdx]!.value;
      yieldIdx++;
    }
    const prevDate = dates[i - 1]!;
    const priceReturn = priceByDate[date]! / priceByDate[prevDate]!;
    const dailyYield = currentYieldPct / 100 / 365;
    const calendarDaysElapsed = Math.round((new Date(date).getTime() - new Date(prevDate).getTime()) / (24 * 3600 * 1000));
    out[date] = out[prevDate]! * priceReturn * Math.pow(1 + dailyYield, calendarDaysElapsed);
  }
  return out;
}

export async function fetchBenchmarkHistoryLive(benchmarkId: string, from: Date, to: Date): Promise<Record<string, number>> {
  const ticker = BENCHMARK_INDICES[benchmarkId];
  if (!ticker) throw new Error(`Unknown benchmark: ${benchmarkId}`);

  const spanDays = Math.ceil((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
  const all = await fetchYahooDailyCloses(ticker, spanDays);

  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const out: Record<string, number> = {};
  for (const [date, value] of Object.entries(all)) {
    if (date >= fromIso && date <= toIso) out[date] = value;
  }
  return out;
}

// Combines the daily price series (Yahoo, one bulk request) with month-end
// div yield samples (niftyindices, sequential, one request per month) into
// a TRI-approximation series — see buildTriApproxSeries's comment for the
// compounding method and why this is the free-data ceiling here.
async function fetchBenchmarkTriApproxLive(benchmarkId: string, from: Date, to: Date): Promise<Record<string, number>> {
  const [priceByDate, divYieldSamples] = await Promise.all([
    fetchBenchmarkHistoryLive(benchmarkId, from, to),
    fetchMonthlyDivYield(benchmarkId, from, to),
  ]);
  return buildTriApproxSeries(priceByDate, divYieldSamples);
}

// DB-backed wrapper: reads whatever's already cached for this benchmark's
// TRI-approx series from observations (series "bt_index:<benchmarkId>",
// source BACKTEST_INDEX_DAILY — the values stored here are the TRI
// approximation, not the raw price index), live-fetches only when the
// requested range has a real gap, and writes the result back before
// returning. Since a live fetch is a small, fixed number of requests
// regardless of range (one Yahoo bulk call + ~1 niftyindices call per
// month), this simply re-fetches the whole span on any gap rather than
// computing partial missing-day ranges — that bookkeeping existed to
// avoid hundreds of redundant per-day requests under the old niftyindices
// day-by-day design and doesn't earn its complexity under this one.
export async function fetchBenchmarkHistoryCached(
  db: Database.Database,
  benchmarkId: string,
  from: Date,
  to: Date
): Promise<Record<string, number>> {
  if (!BENCHMARK_INDICES[benchmarkId]) throw new Error(`Unknown benchmark: ${benchmarkId}`);
  const seriesId = backtestIndexSeriesId(benchmarkId);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const cached = latestObservations(db, seriesId, { from: fromIso, to: toIso });
  const out: Record<string, number> = {};
  for (const row of cached) out[row.date] = row.value;

  // Cache-miss heuristic mirroring the NAV cache in routes/backtest.ts —
  // including the same bug that heuristic had until it was fixed there: a
  // row count within [from, to] is not enough, because a cache built from
  // an earlier, SHORTER-range backtest holds rows that are still inside a
  // later, WIDER range's window (a superset) while covering none of that
  // wider range's earlier years. Requires the earliest cached row to be
  // within 10 days of the requested `from`, not just "some row exists
  // somewhere in range" — otherwise a widened range silently re-served a
  // stale, too-short cached window instead of live-fetching the gap.
  const spanDays = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
  const earliestCachedDate = cached[0]?.date;
  const coversStart = earliestCachedDate !== undefined && new Date(earliestCachedDate).getTime() - from.getTime() <= 10 * 24 * 3600 * 1000;
  if (cached.length >= Math.min(5, spanDays) && coversStart) return out;

  const fetched = await fetchBenchmarkTriApproxLive(benchmarkId, from, to);
  const now = new Date().toISOString();
  insertObservations(
    db,
    Object.entries(fetched).map(([date, value]) => ({
      seriesId,
      date,
      value,
      basis: null,
      source: "BACKTEST_INDEX_DAILY",
      fetchedAt: now,
    }))
  );
  Object.assign(out, fetched);
  return out;
}
