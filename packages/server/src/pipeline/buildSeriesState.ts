import type Database from "better-sqlite3";
import type { SeriesSource, SeriesState } from "@wayfinder/engine";
import { latestObservations } from "../store/observations.js";
import { computePercentile } from "./percentile.js";

// Builds a real SeriesState (latest value, percentile vs its own
// trailing history, observation count, source, staleness) directly
// from the observations table, for any series id — used to backfill
// snapshot.series entries the static mock baseline never had, since
// newer adapters (niftyindices.ts, yahooMetals.ts, etc.) write series
// the baseline predates. Without this, a score cell's derivedFrom can
// point at a raw series that snapshot.series has literally no entry
// for at all, breaking any UI that wants to show "here's the raw data
// point behind this score" (see CalculationInspector's
// SignalDerivationTrace, which needs snapshot.series[id] to exist).
//
// Returns null when the series has no observations yet — callers
// should leave the mock baseline's entry (if any) untouched in that
// case rather than overwrite it with an all-null placeholder.
export function buildSeriesState(db: Database.Database, seriesId: string, asOfDate: string, minObservations: number): SeriesState | null {
  const rows = latestObservations(db, seriesId);
  if (rows.length === 0) return null;

  const last = rows[rows.length - 1]!;
  const history = rows.map((r) => r.value);
  const percentileResult = computePercentile(history, last.value, minObservations);

  const asOf = new Date(asOfDate);
  const latestDate = new Date(last.date);
  const staleDays = Math.max(0, Math.round((asOf.getTime() - latestDate.getTime()) / 86_400_000));

  return {
    id: seriesId,
    latest: last.value,
    latestDate: last.date,
    percentile: percentileResult.status === "ok" ? percentileResult.percentile : null,
    observations: rows.length,
    windowStart: rows[0]!.date,
    source: last.source as SeriesSource,
    status: percentileResult.status === "ok" ? "ok" : "insufficient_history",
    staleDays,
    error: null,
  };
}
