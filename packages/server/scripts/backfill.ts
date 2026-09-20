#!/usr/bin/env tsx
// §11.4 — backfill. Idempotent (insertObservations is ON CONFLICT DO
// NOTHING keyed on series_id/date/fetched_at) and re-runnable. Emits a
// per-series coverage report and reports shortfalls honestly — this
// script exists specifically to prevent the failure mode the brief
// documents: a percentile computed on 3 observations wearing the
// confidence of a 15-year history.
import { openDb } from "../src/store/db.js";
import { insertObservations, seriesCoverage } from "../src/store/observations.js";
import { insertFetchLog } from "../src/store/fetchLog.js";
import { createFredAdapter, FRED_SERIES } from "../src/adapters/fred.js";
import { createAmfiAdapter } from "../src/adapters/amfi.js";
import { createRbiAdapter } from "../src/adapters/rbi.js";
import { createNiftyIndicesAdapter, fetchMonthEndHistory } from "../src/adapters/niftyindices.js";
import { createMultplAdapter } from "../src/adapters/multpl.js";
import { createYahooMetalsAdapter, GOLD_USD_FUTURES_SERIES_ID, SILVER_USD_FUTURES_SERIES_ID } from "../src/adapters/yahooMetals.js";
import { createDbNomicsAdapter } from "../src/adapters/dbnomics.js";
import { createGoldEtfHoldingsAdapter, GOLD_ETF_TONNES_SERIES_ID } from "../src/adapters/goldEtfHoldings.js";
import { createBisPolicyRateAdapter } from "../src/adapters/bisPolicyRate.js";
import { fetchTrackedNavHistory, amfiNavSeriesId } from "../src/adapters/amfiNav.js";
import { listTrackedSchemes } from "../src/store/trackedSchemes.js";
import { loadConfig } from "../src/config.js";
import { DEFAULT_PARAMS } from "@wayfinder/engine";

interface CoverageReport {
  seriesId: string;
  observations: number;
  windowStart: string | null;
  windowEnd: string | null;
  meetsMinimum: boolean;
}

async function backfillFred(db: ReturnType<typeof openDb>, apiKey: string | undefined, years = 20): Promise<CoverageReport[]> {
  const adapter = createFredAdapter({ apiKey, series: FRED_SERIES });
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);

  const startedAt = new Date().toISOString();
  try {
    const observations = await adapter.fetchHistory(from, to);
    const fetchedAt = new Date().toISOString();
    const written = insertObservations(
      db,
      observations.map((o) => ({
        seriesId: o.seriesId,
        date: o.date,
        value: o.value,
        basis: o.basis ?? null,
        source: "FRED",
        fetchedAt,
      }))
    );
    insertFetchLog(db, {
      source: "FRED",
      startedAt,
      finishedAt: fetchedAt,
      status: "ok",
      error: null,
      rowsWritten: written,
    });
  } catch (err) {
    insertFetchLog(db, {
      source: "FRED",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      rowsWritten: 0,
    });
    console.error(`FRED backfill failed: ${err instanceof Error ? err.message : err}`);
  }

  return FRED_SERIES.map((s) => {
    const coverage = seriesCoverage(db, s.internalSeriesId);
    return {
      seriesId: s.internalSeriesId,
      ...coverage,
      meetsMinimum: coverage.observations >= DEFAULT_PARAMS.percentileMinObservations,
    };
  });
}

async function backfillAmfi(db: ReturnType<typeof openDb>, years = 10): Promise<CoverageReport[]> {
  const adapter = createAmfiAdapter();
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);

  const startedAt = new Date().toISOString();
  try {
    const observations = await adapter.fetchHistory(from, to);
    const fetchedAt = new Date().toISOString();
    const written = insertObservations(
      db,
      observations.map((o) => ({
        seriesId: o.seriesId,
        date: o.date,
        value: o.value,
        basis: o.basis ?? null,
        source: "AMFI",
        fetchedAt,
      }))
    );
    insertFetchLog(db, {
      source: "AMFI",
      startedAt,
      finishedAt: fetchedAt,
      status: "ok",
      error: null,
      rowsWritten: written,
    });
  } catch (err) {
    insertFetchLog(db, {
      source: "AMFI",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      rowsWritten: 0,
    });
    console.error(`AMFI backfill failed: ${err instanceof Error ? err.message : err}`);
  }

  return adapter.series.map((seriesId) => {
    const coverage = seriesCoverage(db, seriesId);
    return {
      seriesId,
      ...coverage,
      meetsMinimum: coverage.observations >= DEFAULT_PARAMS.percentileMinObservations,
    };
  });
}

// Generic runner for adapters whose fetchHistory() is a genuine ranged
// backfill (unlike bullion.ts/nse.ts/yahoo.ts/tradingEconomics.ts/
// rbiRepoRate.ts/ccil.ts, which deliberately throw — see this script's
// per-source SKIPPED notes below). Shared here instead of duplicating
// backfillFred/backfillAmfi's identical try/log/coverage shape a third
// and fourth time.
async function backfillRanged(
  db: ReturnType<typeof openDb>,
  sourceId: string,
  seriesIds: string[],
  fetchHistory: (from: Date, to: Date) => Promise<{ seriesId: string; date: string; value: number; basis?: string | null }[]>,
  from: Date,
  to: Date = new Date()
): Promise<CoverageReport[]> {
  const startedAt = new Date().toISOString();
  try {
    const observations = await fetchHistory(from, to);
    const fetchedAt = new Date().toISOString();
    const written = insertObservations(
      db,
      observations.map((o) => ({
        seriesId: o.seriesId,
        date: o.date,
        value: o.value,
        basis: o.basis ?? null,
        source: sourceId,
        fetchedAt,
      }))
    );
    insertFetchLog(db, { source: sourceId, startedAt, finishedAt: fetchedAt, status: "ok", error: null, rowsWritten: written });
  } catch (err) {
    insertFetchLog(db, {
      source: sourceId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      rowsWritten: 0,
    });
    console.error(`${sourceId} backfill failed: ${err instanceof Error ? err.message : err}`);
  }

  return seriesIds.map((seriesId) => {
    const coverage = seriesCoverage(db, seriesId);
    return {
      seriesId,
      ...coverage,
      meetsMinimum: coverage.observations >= DEFAULT_PARAMS.percentileMinObservations,
    };
  });
}

// niftyindices.ts's fetchHistory() issues one HTTP request per calendar
// day in range — a real ranged backfill (unlike nse.ts's latest-only
// /api/allIndices), but every year of range is ~365 requests. The score
// derivations fed by this source include 12M lookbacks, so the default
// window needs room for both the lookback and the 24-observation
// percentile floor.
//
// TWO PASSES, deliberately, because two different cells need two
// different shapes of history from the same source:
//
//   DAILY (last ~2y) — the 6M/12M return lookbacks in
//   sector.*::rel_momentum and the TRI approximation need dense recent
//   closes.
//
//   MONTH-END (last ~11y) — every "percentile vs its own 10-15Y history"
//   cell needs calendar DEPTH, which the daily pass cannot afford: a
//   decade of daily fetches is ~4,000 requests. Month-end sampling is the
//   spec's own stated granularity ("10-15Y MONTHLY history"), so ~12
//   requests per year covers the full window. Without this pass the P/E
//   cells ranked today against a 2.1-year window and scored large/mid at
//   ~98 (see the header comment on equity.*::valuation in scoreCells.ts).
async function backfillNiftyIndices(db: ReturnType<typeof openDb>, days = 760, monthEndYears = 11): Promise<CoverageReport[]> {
  const adapter = createNiftyIndicesAdapter();

  const monthEndFrom = new Date();
  monthEndFrom.setFullYear(monthEndFrom.getFullYear() - monthEndYears);
  await backfillRanged(db, "NIFTYINDICES", adapter.series, fetchMonthEndHistory, monthEndFrom);

  const from = new Date();
  from.setDate(from.getDate() - days);
  return backfillRanged(db, "NIFTYINDICES", adapter.series, adapter.fetchHistory, from);
}

// multpl.com's S&P 500 trailing P/E — one request returns the whole
// monthly series back to 1871, so there is no per-period cost here and
// the only reason to bound the range is storage. 30y comfortably covers
// the 10-15Y window equity.intl::valuation ranks against.
// NOTE: this is TRAILING P/E standing in for the spec's FORWARD P/E; the
// deviation is documented in adapters/multpl.ts.
async function backfillMultpl(db: ReturnType<typeof openDb>, years = 30): Promise<CoverageReport[]> {
  const adapter = createMultplAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "MULTPL", adapter.series, adapter.fetchHistory, from);
}

// yahooMetals.ts's fetchHistory() hits Yahoo Finance's real chart-history
// endpoint for GC=F/SI=F futures — a genuine multi-year daily/monthly
// series, unlike bullion.ts's IBJA spot (metals.dev free tier has no
// history endpoint at all). GLD+IAU ETF share counts from the same
// adapter are latest-only via Yahoo quote, so they are intentionally
// excluded from this coverage report and must accumulate via refresh.
async function backfillYahooMetals(db: ReturnType<typeof openDb>, years = 10): Promise<CoverageReport[]> {
  const adapter = createYahooMetalsAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "YAHOO_METALS", [GOLD_USD_FUTURES_SERIES_ID, SILVER_USD_FUTURES_SERIES_ID], adapter.fetchHistory, from);
}

// SPDR's own GLD historical archive (adapters/goldEtfHoldings.ts) — a
// genuine daily series back to 2004, unlike the Yahoo-sourced
// gold_etf_shares_outstanding it replaced (latest-only, no history
// endpoint). One request returns the full archive regardless of range,
// so `years` only bounds what's written, not what's fetched.
async function backfillGoldEtfHoldings(db: ReturnType<typeof openDb>, years = 20): Promise<CoverageReport[]> {
  const adapter = createGoldEtfHoldingsAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "GOLD_ETF_HOLDINGS", [GOLD_ETF_TONNES_SERIES_ID], adapter.fetchHistory, from);
}

// RBI's DBIE mirror. Headless-browser scrape, so it is slower than the
// plain-HTTP sources above; it runs once here rather than on every refresh.
// The mirror only shows a trailing window per table (~15 months for CPI,
// ~25 months for the T-bill yield table), so `from` is a request, not a
// guarantee — the coverage report says what actually landed.
async function backfillRbi(db: ReturnType<typeof openDb>, chromiumExecutablePath: string | undefined, years = 3): Promise<CoverageReport[]> {
  const adapter = createRbiAdapter({ executablePath: chromiumExecutablePath });
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "RBI", ["cpi_index", "cpi_yoy", "tbill_1y"], adapter.fetchHistory, from);
}

// dbnomics.ts mirrors IMF IFS central-bank gold reserves — a stable,
// official-data time series (unlike the scraped/unofficial sources
// above), so a long range is both safe and useful here.
async function backfillDbNomics(db: ReturnType<typeof openDb>, years = 10): Promise<CoverageReport[]> {
  const adapter = createDbNomicsAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "DBNOMICS", adapter.series, adapter.fetchHistory, from);
}

// bisPolicyRate.ts serves repo_rate straight from BIS's SDMX API. This
// backfill is what makes l1.equity::macro's rbiStance input meaningful:
// rbi.org.in's homepage widget is current-value only, so without real
// history the "6 months ago" comparison has nothing to compare against
// and the cell abstains. 20 years covers every MPC cycle that matters
// for a 6-month stance read, with room to spare.
async function backfillBis(db: ReturnType<typeof openDb>, years = 20): Promise<CoverageReport[]> {
  const adapter = createBisPolicyRateAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "BIS", adapter.series, adapter.fetchHistory, from);
}

// Backfills only currently-tracked schemes (store/trackedSchemes.ts) — an
// empty tracked list means an empty backfill, not an error, since there's
// no default universe to guess at (§9: never guess). Uses
// fetchTrackedNavHistory directly rather than backfillRanged's shared
// runner because its signature is (codes, from, to), not (from, to) —
// createAmfiNavAdapter().fetchHistory already binds the tracked set as a
// closure for the refresh pipeline, but backfill's own coverage report
// needs the resolved series list up front, so this stays a small
// dedicated function instead of forcing that shape through the shared
// runner.
async function backfillAmfiNav(db: ReturnType<typeof openDb>, years = 10): Promise<CoverageReport[]> {
  const tracked = listTrackedSchemes(db, { activeOnly: true });
  if (tracked.length === 0) {
    console.log("  SKIPPED: no schemes are currently tracked (tracked_schemes is empty).");
    return [];
  }

  const trackedCodes = new Set(tracked.map((s) => s.schemeCode));
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);

  const startedAt = new Date().toISOString();
  try {
    const observations = await fetchTrackedNavHistory(trackedCodes, from, to);
    const fetchedAt = new Date().toISOString();
    const written = insertObservations(
      db,
      observations.map((o) => ({
        seriesId: o.seriesId,
        date: o.date,
        value: o.value,
        basis: o.basis ?? null,
        source: "AMFI_NAV",
        fetchedAt,
      }))
    );
    insertFetchLog(db, { source: "AMFI_NAV", startedAt, finishedAt: fetchedAt, status: "ok", error: null, rowsWritten: written });
  } catch (err) {
    insertFetchLog(db, {
      source: "AMFI_NAV",
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      rowsWritten: 0,
    });
    console.error(`AMFI_NAV backfill failed: ${err instanceof Error ? err.message : err}`);
  }

  return tracked.map((s) => {
    const seriesId = amfiNavSeriesId(s.schemeCode);
    const coverage = seriesCoverage(db, seriesId);
    return {
      seriesId,
      ...coverage,
      meetsMinimum: coverage.observations >= DEFAULT_PARAMS.percentileMinObservations,
    };
  });
}

async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);

  console.log("=== Wayfinder backfill ===");
  console.log(`DB: ${config.dbPath}`);
  console.log();

  const reports: CoverageReport[] = [];

  console.log("-- FRED --");
  reports.push(...(await backfillFred(db, config.fredApiKey)));

  console.log("-- AMFI --");
  reports.push(...(await backfillAmfi(db)));

  console.log("-- NiftyIndices --");
  reports.push(...(await backfillNiftyIndices(db)));

  console.log("-- multpl.com (S&P 500 trailing P/E) --");
  reports.push(...(await backfillMultpl(db)));

  console.log("-- Yahoo Metals --");
  reports.push(...(await backfillYahooMetals(db)));

  console.log("-- Gold ETF holdings (SPDR GLD archive) --");
  reports.push(...(await backfillGoldEtfHoldings(db)));

  console.log("-- DB.NOMICS --");
  reports.push(...(await backfillDbNomics(db)));
  reports.push(...(await backfillBis(db)));

  console.log("-- AMFI NAV (tracked schemes only) --");
  reports.push(...(await backfillAmfiNav(db)));

  // Bullion (IBJA/metals.dev) has no historical range endpoint on the free
  // tier (see adapters/bullion.ts fetchHistory) — its backfill needs a
  // supplementary archive source, out of scope for this script until one
  // is selected.
  console.log("-- Bullion (IBJA/metals.dev) --");
  console.log("  SKIPPED: no historical range endpoint on the free tier; needs a supplementary archive.");
  // RBI's fetchHistory returns only whatever trailing window the scraped
  // mirror happens to display — NOT a true arbitrary-range backfill. This
  // used to be skipped outright on that basis, which was an overcorrection:
  // the window is short but it is not empty, and for the T-bill yield table
  // it is 25 monthly rows back to 2024-04 (verified live 2026-09-17) —
  // enough on its own to clear the 24-observation percentile floor that had
  // debt.liquid::carry stuck at insufficient_history on 4 CCIL day-rows.
  //
  // So: run it, and let the coverage report below say honestly how far it
  // actually reached rather than assuming in advance that it reaches
  // nothing. Whatever it returns is real published data.
  console.log("-- RBI --");
  reports.push(...(await backfillRbi(db, config.chromiumExecutablePath)));
  // NSE (nseindia.com/api/allIndices) is latest-only. Historical index
  // close/P/E/P/B coverage is handled above by NiftyIndices' Daily
  // Snapshot CSV instead.
  console.log("-- NSE --");
  console.log("  SKIPPED: latest-only adapter; historical backfill comes from NiftyIndices Daily Snapshot.");

  console.log();
  console.log("=== Coverage report ===");
  for (const r of reports) {
    const flag = r.meetsMinimum ? "OK" : "SHORTFALL";
    console.log(
      `  [${flag}] ${r.seriesId}: ${r.observations} observations (${r.windowStart ?? "—"} to ${r.windowEnd ?? "—"}), ` +
        `minimum required = ${DEFAULT_PARAMS.percentileMinObservations}`
    );
  }
  const shortfalls = reports.filter((r) => !r.meetsMinimum);
  if (shortfalls.length > 0) {
    console.log();
    console.log(`WARNING: ${shortfalls.length} series below the minimum observation floor. Percentiles for these will report`);
    console.log(`insufficient_history and fall back to a neutral score of 50 until enough history accumulates.`);
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
