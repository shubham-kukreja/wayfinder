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
  // The date of the observation the score's CURRENT value was actually
  // computed from — not asOfDate. A derived series can join two sources
  // with different publication lags (e.g. deriveNiftyMomentumSeries
  // month-joins FRED's gsec_10y, which as of 2026-09-15 trails
  // nifty50_close by 3+ months), so the score's real freshness can be
  // materially older than "today." null when there's no observation at
  // all (insufficient_history with zero rows). Used by
  // currentSnapshot.ts to set an honest staleDays instead of always 0 —
  // §1 invariant 5: provenance (including freshness) must stay visible,
  // never silently overstated.
  latestDate: string | null;
}

export function autoScore(
  db: Database.Database,
  seriesId: string,
  params: Params,
  transform: "percentile" | "inverted"
): AutoScoreResult {
  const rows = latestObservations(db, seriesId);
  if (rows.length === 0) {
    return { value: 50, status: "insufficient_history", observations: 0, latestDate: null };
  }

  const current = rows[rows.length - 1]!.value;
  const latestDate = rows[rows.length - 1]!.date;
  const history = rows.map((r) => r.value);

  const result = computePercentile(history, current, params.percentileMinObservations);
  if (result.status === "insufficient_history" || result.percentile === null) {
    // §1 invariant 4: a missing/unusable signal scores 50, never a guess.
    return { value: 50, status: "insufficient_history", observations: result.observations, latestDate };
  }

  const value = transform === "inverted" ? 100 - result.percentile : result.percentile;
  return { value, status: "ok", observations: result.observations, latestDate };
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

// A difference series (e.g. gsec_10y - cpi_yoy for a real-yield
// approximation) computed from two stored series. Joins by YEAR-MONTH,
// not exact date — different sources publish on different days of the
// month (FRED's OECD-sourced gsec_10y vs. RBI's month-end CPI release),
// so an exact-date join (like derivedRatioSeries uses for same-source
// AMFI pairs) would silently produce zero matches here.
export function derivedDifferenceSeries(
  db: Database.Database,
  minuendId: string,
  subtrahendId: string
): Array<{ date: string; value: number }> {
  const minuendRows = latestObservations(db, minuendId);
  const subtrahendRows = latestObservations(db, subtrahendId);
  const subtrahendByMonth = new Map(subtrahendRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const m of minuendRows) {
    const s = subtrahendByMonth.get(m.date.slice(0, 7));
    if (s === undefined) continue;
    out.push({ date: m.date, value: m.value - s });
  }
  return out;
}

export function autoScoreFromSeries(
  observations: Array<{ date: string; value: number }>,
  params: Params,
  transform: "percentile" | "inverted"
): AutoScoreResult {
  if (observations.length === 0) {
    return { value: 50, status: "insufficient_history", observations: 0, latestDate: null };
  }
  const current = observations[observations.length - 1]!.value;
  const latestDate = observations[observations.length - 1]!.date;
  const history = observations.map((o) => o.value);
  const result = computePercentile(history, current, params.percentileMinObservations);
  if (result.status === "insufficient_history" || result.percentile === null) {
    return { value: 50, status: "insufficient_history", observations: result.observations, latestDate };
  }
  const value = transform === "inverted" ? 100 - result.percentile : result.percentile;
  return { value, status: "ok", observations: result.observations, latestDate };
}
