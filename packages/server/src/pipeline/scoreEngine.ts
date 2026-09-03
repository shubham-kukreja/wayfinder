import type Database from "better-sqlite3";
import { latestObservations } from "../store/observations.js";
import { computePercentile } from "./percentile.js";
import type { Params } from "@wayfinder/engine";

// §7 — general-purpose auto-score computation: percentile a series within
// its own trailing window, then apply the cell's transform (as-is or
// inverted). This is the shared machinery every "auto" score cell in §7's
// tables uses; cell-specific series selection/derivation (e.g. a ratio of
// two series) lives in scoreCells.ts, not here.
export interface AutoScoreResult {
  value: number;
  status: "ok" | "insufficient_history";
  observations: number;
}

export function autoScore(
  db: Database.Database,
  seriesId: string,
  params: Params,
  transform: "percentile" | "inverted"
): AutoScoreResult {
  const rows = latestObservations(db, seriesId);
  if (rows.length === 0) {
    return { value: 50, status: "insufficient_history", observations: 0 };
  }

  const current = rows[rows.length - 1]!.value;
  const history = rows.map((r) => r.value);

  const result = computePercentile(history, current, params.percentileMinObservations);
  if (result.status === "insufficient_history" || result.percentile === null) {
    // §1 invariant 4: a missing/unusable signal scores 50, never a guess.
    return { value: 50, status: "insufficient_history", observations: result.observations };
  }

  const value = transform === "inverted" ? 100 - result.percentile : result.percentile;
  return { value, status: "ok", observations: result.observations };
}

// A ratio/derived series computed from two stored series (e.g.
// flow_equity_3m / aum_equity, or gold_inr / silver_inr for the
// gold-silver ratio) rather than fetched directly. Returns null if either
// input series has no observations for a shared date.
export function derivedRatioSeries(
  db: Database.Database,
  numeratorId: string,
  denominatorId: string
): Array<{ date: string; value: number }> {
  const numRows = latestObservations(db, numeratorId);
  const denRows = latestObservations(db, denominatorId);
  const denByDate = new Map(denRows.map((r) => [r.date, r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const n of numRows) {
    const d = denByDate.get(n.date);
    if (d === undefined || d === 0) continue;
    out.push({ date: n.date, value: n.value / d });
  }
  return out;
}

export function autoScoreFromSeries(
  observations: Array<{ date: string; value: number }>,
  params: Params,
  transform: "percentile" | "inverted"
): AutoScoreResult {
  if (observations.length === 0) {
    return { value: 50, status: "insufficient_history", observations: 0 };
  }
  const current = observations[observations.length - 1]!.value;
  const history = observations.map((o) => o.value);
  const result = computePercentile(history, current, params.percentileMinObservations);
  if (result.status === "insufficient_history" || result.percentile === null) {
    return { value: 50, status: "insufficient_history", observations: result.observations };
  }
  const value = transform === "inverted" ? 100 - result.percentile : result.percentile;
  return { value, status: "ok", observations: result.observations };
}
