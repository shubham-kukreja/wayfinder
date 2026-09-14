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
import { createNiftyIndicesAdapter } from "../src/adapters/niftyindices.js";
import { createYahooMetalsAdapter, GOLD_USD_FUTURES_SERIES_ID, SILVER_USD_FUTURES_SERIES_ID } from "../src/adapters/yahooMetals.js";
import { createDbNomicsAdapter } from "../src/adapters/dbnomics.js";
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
async function backfillNiftyIndices(db: ReturnType<typeof openDb>, days = 760): Promise<CoverageReport[]> {
  const adapter = createNiftyIndicesAdapter();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return backfillRanged(db, "NIFTYINDICES", adapter.series, adapter.fetchHistory, from);
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

// dbnomics.ts mirrors IMF IFS central-bank gold reserves — a stable,
// official-data time series (unlike the scraped/unofficial sources
// above), so a long range is both safe and useful here.
async function backfillDbNomics(db: ReturnType<typeof openDb>, years = 10): Promise<CoverageReport[]> {
  const adapter = createDbNomicsAdapter();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  return backfillRanged(db, "DBNOMICS", adapter.series, adapter.fetchHistory, from);
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

  console.log("-- Yahoo Metals --");
  reports.push(...(await backfillYahooMetals(db)));
  console.log("  NOTE: gold_etf_shares_outstanding is latest-only; it accumulates via refresh, not historical backfill.");

  console.log("-- DB.NOMICS --");
  reports.push(...(await backfillDbNomics(db)));

  // Bullion (IBJA/metals.dev) has no historical range endpoint on the free
  // tier (see adapters/bullion.ts fetchHistory) — its backfill needs a
  // supplementary archive source, out of scope for this script until one
  // is selected.
  console.log("-- Bullion (IBJA/metals.dev) --");
  console.log("  SKIPPED: no historical range endpoint on the free tier; needs a supplementary archive.");
  // RBI's fetchHistory only returns whatever trailing window the scraped
  // mirror displays (~15 months for CPI) — not a true long-range backfill,
  // so there is nothing this script can usefully request beyond that.
  console.log("-- RBI --");
  console.log("  SKIPPED: adapter only exposes a short trailing window (no true historical range) — nothing to backfill.");
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
