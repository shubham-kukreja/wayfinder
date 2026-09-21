import type Database from "better-sqlite3";
import { runBacktest, type BacktestLegInput, type BacktestResult, type DateValueSeries } from "@wayfinder/engine";
import { amfiNavSeriesId, fetchTrackedNavHistory } from "../adapters/amfiNav.js";
import { fetchBenchmarkHistoryCached, BENCHMARK_INDICES } from "../adapters/benchmarkIndex.js";
import { insertObservations, latestObservations } from "../store/observations.js";
import type { BacktestLeg } from "../store/backtestScenarios.js";

// Shared by both the synchronous POST /api/backtest/run route and the
// backtest_jobs queue worker (pipeline/backtestQueue.ts) — one place for
// the actual fetch/cache/compute logic, so the two paths can never drift
// apart in behaviour. The queue is the primary way this now runs; the
// synchronous route stays for anything that still wants an immediate
// result (e.g. a quick re-check against already-cached data).

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function validateLegs(legs: unknown): legs is BacktestLeg[] {
  if (!Array.isArray(legs) || legs.length === 0) return false;
  return legs.every(
    (l) =>
      l &&
      typeof l.sleeveId === "string" &&
      typeof l.schemeCode === "string" &&
      typeof l.schemeName === "string" &&
      typeof l.amount === "number" &&
      l.amount > 0 &&
      typeof l.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(l.date)
  );
}

export function isValidBenchmark(benchmarkId: unknown): benchmarkId is string {
  return typeof benchmarkId === "string" && Object.prototype.hasOwnProperty.call(BENCHMARK_INDICES, benchmarkId);
}

// Days to fetch/cache before the earliest leg's purchase date. The engine
// looks up each leg's entry price as "the most recent NAV/index value on
// or before the purchase date" (packages/engine/src/backtest.ts's
// valueOnOrBefore) — necessary because a purchase date can land on a
// weekend or holiday with no trading that day. Without this buffer, a
// purchase date that IS itself a non-trading day has nothing earlier in
// the fetched/cached window to fall back to, and the leg is wrongly
// reported as missingHistory even though real history exists just before
// it. 7 days comfortably covers any single weekend or short holiday run.
const LOOKBACK_BUFFER_DAYS = 7;

// Resolves NAV history for every distinct scheme in the legs and the
// benchmark's daily index history, then runs the pure engine calculation.
// Both legs of the fetch are cached in observations (per-scheme NAV under
// its existing "amfi_nav:<code>"/AMFI_NAV series — the same one
// store/trackedSchemes.ts's refresh pipeline writes to — and the
// benchmark under "bt_index:<id>"/BACKTEST_INDEX_DAILY, see
// adapters/benchmarkIndex.ts). A backtest is a what-if a user reruns
// interactively with edited legs/dates, so subsequent runs over an
// overlapping range fetch only the missing tail rather than the whole
// range again — the first run for a fresh scheme+range is still a full
// live fetch (AMFI in 30-day chunks, the benchmark's monthly div-yield
// sample plus one bulk price call), which is the unavoidable cost of
// genuinely new data.
// Whether a scheme's cached NAV rows are too thin to run against, so the
// range must be re-fetched from AMFI.
//
// Two ways a cache can be inadequate, and one way it can merely LOOK
// inadequate:
//
//   1. Too few rows outright.
//   2. Rows exist but start well after the requested window — a cache
//      built by an earlier, NARROWER backtest is a subset of this wider
//      one's window and covers none of its earlier years.
//   3. Rows start after the window because THE FUND DID NOT EXIST YET.
//      Indistinguishable from (2) by date alone, but not a cache problem:
//      no fetch can ever produce history from before a fund's inception.
//
// Treating (3) as (2) re-fetched the entire multi-year range on EVERY run
// for any leg holding a young fund — and since each AMFI chunk is the
// full ~14k-scheme universe, that is the whole fetch, not one fund's
// slice. Confirmed live 2026-09-21: a 5-year backtest whose silver sleeve
// resolved to a 2025-launched ETF re-fetched all 147 chunks each time,
// ~30 minutes against Railway's throttled AMFI egress, to rediscover that
// pre-inception history does not exist.
//
// fetched_at separates them. A row fetched after the window's start came
// from a fetch that asked for this whole range; if that fetch still
// returned nothing earlier, the fund's history genuinely starts there.
export function needsHistoryFetch(
  cached: Array<{ date: string; fetchedAt: string }>,
  fromIso: string,
  toIso: string
): boolean {
  const spanDays = (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (24 * 3600 * 1000);
  if (cached.length < Math.min(5, spanDays)) return true;

  const earliestCachedDate = cached[0]?.date;
  const coversStart =
    earliestCachedDate !== undefined &&
    new Date(earliestCachedDate).getTime() - new Date(fromIso).getTime() <= 10 * 24 * 3600 * 1000;
  if (coversStart) return false;

  return !cached.some((row) => row.fetchedAt >= fromIso);
}

export async function resolveAndRunBacktest(db: Database.Database, legs: BacktestLegInput[], benchmarkId: string): Promise<BacktestResult> {
  const dates = legs.map((l) => l.date);
  const earliest = dates.reduce((min, d) => (d < min ? d : min));
  const from = new Date(earliest);
  from.setDate(from.getDate() - LOOKBACK_BUFFER_DAYS);
  const to = new Date(isoToday());
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const schemeCodes = [...new Set(legs.map((l) => l.schemeCode))];
  const navSeriesByScheme: Record<string, DateValueSeries> = {};

  const missingCodes: string[] = [];
  for (const code of schemeCodes) {
    const seriesId = amfiNavSeriesId(code);
    const cached = latestObservations(db, seriesId, { from: fromIso, to: toIso });
    const series: DateValueSeries = {};
    for (const row of cached) series[row.date] = row.value;
    navSeriesByScheme[code] = series;
    // Cache-miss heuristic: a row count alone is not enough — a cache built
    // from an earlier, SHORTER-range backtest can hold hundreds of rows
    // that are all still inside a later, WIDER range's [from, to] window
    // (a superset), while covering none of that wider range's earlier
    // years at all. Requires the earliest cached row to be within 10 days
    // of the requested `from`, not just "some row exists somewhere in
    // range" — see the fix history in routes/backtest.ts's git log for
    // the live bug this heuristic previously had.
    if (needsHistoryFetch(cached, fromIso, toIso)) missingCodes.push(code);
  }

  // NAV (AMFI, 30-day chunks) and the benchmark (Yahoo bulk price + monthly
  // niftyindices div-yield) are independent, unrelated data sources — kick
  // both off together rather than awaiting one before starting the other.
  const navPromise = missingCodes.length > 0 ? fetchTrackedNavHistory(new Set(missingCodes), from, to) : Promise.resolve([]);
  const benchmarkPromise = fetchBenchmarkHistoryCached(db, benchmarkId, from, to);
  const [navFetch, benchmarkSeries] = await Promise.all([navPromise, benchmarkPromise]);

  if (missingCodes.length > 0) {
    const now = new Date().toISOString();
    const rows = navFetch.map((obs) => {
      const code = obs.raw && typeof obs.raw === "object" && "schemeCode" in obs.raw ? (obs.raw as { schemeCode: string }).schemeCode : null;
      return { seriesId: amfiNavSeriesId(code ?? ""), date: obs.date, value: obs.value, basis: null, source: "AMFI_NAV", fetchedAt: now };
    });
    insertObservations(db, rows);
    for (const row of rows) {
      const code = row.seriesId.slice("amfi_nav:".length);
      navSeriesByScheme[code] ??= {};
      navSeriesByScheme[code]![row.date] = row.value;
    }
  }

  return runBacktest(legs, navSeriesByScheme, benchmarkSeries, isoToday());
}

// Rough pre-run ETA: instant (a few seconds) if every scheme+benchmark is
// already cached for the requested range, else a per-fund estimate based
// on how many 30-day AMFI chunks the missing range implies (~20s/chunk,
// the live-measured cost of a full-universe chunk download — see
// adapters/amfiNav.ts's own comment on chunk size/latency) plus a flat
// few seconds for the benchmark's bulk price + monthly-yield calls.
export function estimateEtaSeconds(db: Database.Database, legs: BacktestLegInput[], benchmarkId: string): number {
  const dates = legs.map((l) => l.date);
  const earliest = dates.reduce((min, d) => (d < min ? d : min));
  const from = new Date(earliest);
  from.setDate(from.getDate() - LOOKBACK_BUFFER_DAYS);
  const to = new Date(isoToday());
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const spanDays = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);

  const schemeCodes = [...new Set(legs.map((l) => l.schemeCode))];
  // Shares needsHistoryFetch with the run itself — this estimate is only
  // honest if it counts the same schemes the run will actually fetch.
  let missingCount = 0;
  for (const code of schemeCodes) {
    const cached = latestObservations(db, amfiNavSeriesId(code), { from: fromIso, to: toIso });
    if (needsHistoryFetch(cached, fromIso, toIso)) missingCount++;
  }

  // Every missing scheme is covered by the SAME chunk fetch (AMFI returns
  // the whole universe per chunk, filtered client-side — see amfiNav.ts),
  // so the chunk count doesn't multiply per fund, only the range does.
  const chunkCount = missingCount > 0 ? Math.ceil(spanDays / 30) : 0;
  const navEtaSeconds = missingCount > 0 ? (chunkCount / 4) * 20 : 0; // CHUNK_CONCURRENCY=4 in amfiNav.ts

  // The benchmark's own cache-coverage check lives inside
  // fetchBenchmarkHistoryCached; duplicating it here isn't worth it since
  // that fetch is fast even fully cold (verified live: full 5y range in a
  // few seconds — one Yahoo bulk call plus ~1 niftyindices call/month), so
  // a flat estimate covers both the cached and cold cases well enough.
  const benchmarkEtaSeconds = 5;

  return Math.round(navEtaSeconds + benchmarkEtaSeconds);
}
