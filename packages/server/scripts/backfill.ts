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

async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);

  console.log("=== Wayfinder backfill ===");
  console.log(`DB: ${config.dbPath}`);
  console.log();

  const reports: CoverageReport[] = [];

  console.log("-- FRED --");
  reports.push(...(await backfillFred(db, config.fredApiKey)));

  // Bullion (IBJA/metals.dev) has no historical range endpoint on the free
  // tier (see adapters/bullion.ts fetchHistory) — its backfill needs a
  // supplementary archive source, out of scope for this script until one
  // is selected. RBI/NSE/AMFI backfill land in Phase 4 alongside those
  // adapters.
  console.log("-- Bullion (IBJA/metals.dev) --");
  console.log("  SKIPPED: no historical range endpoint on the free tier; needs a supplementary archive (Phase 4).");
  console.log("-- RBI --");
  console.log("  SKIPPED: adapter not yet built (Phase 4).");
  console.log("-- NSE --");
  console.log("  SKIPPED: adapter not yet built (Phase 4).");
  console.log("-- AMFI --");
  console.log("  SKIPPED: adapter not yet built (Phase 4).");

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
