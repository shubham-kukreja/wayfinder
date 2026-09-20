// §11.3 — percentile computation matching Excel's PERCENTRANK semantics
// (interpolated, inclusive) so results reconcile against the source
// spreadsheet during migration.
//
// PERCENTRANK(array, x) for x within [min, max] of a sorted array:
//   rank = position of x when interpolated linearly between the two
//   bracketing sorted values, expressed as a fraction of (n - 1) steps.
// Values below min -> 0. Values above max -> 1. Ties resolve to the
// exact matched rank.

export interface PercentileResult {
  percentile: number | null;
  status: "ok" | "insufficient_history";
  observations: number;
}

export function percentRank(sortedValues: number[], x: number): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return 0.5;

  if (x <= sortedValues[0]!) return 0;
  if (x >= sortedValues[n - 1]!) return 1;

  // Exact match: Excel PERCENTRANK ranks at the FIRST occurrence in the
  // sorted array, not an interpolated midpoint of a duplicate run.
  const exactIndex = sortedValues.indexOf(x);
  if (exactIndex !== -1) return exactIndex / (n - 1);

  // Otherwise find the bracketing indices and interpolate.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedValues[mid]! <= x) lo = mid;
    else hi = mid;
  }

  const loVal = sortedValues[lo]!;
  const hiVal = sortedValues[hi]!;
  const frac = (x - loVal) / (hiVal - loVal);
  return (lo + frac) / (n - 1);
}

export function computePercentile(
  history: number[],
  currentValue: number,
  minObservations: number
): PercentileResult {
  const observations = history.length;
  if (observations < minObservations) {
    return { percentile: null, status: "insufficient_history", observations };
  }
  const sorted = [...history].sort((a, b) => a - b);
  const rank = percentRank(sorted, currentValue);
  return { percentile: rank * 100, status: "ok", observations };
}

// Clip a date-value history to the trailing window, optionally starting no
// earlier than a definition-break date (§15.5 — NSE Apr-2021, AMFI Apr-2019).
export function windowedHistory<T extends { date: string; value: number }>(
  observations: T[],
  windowYears: number,
  asOfDate: string,
  definitionBreakDate: string | null
): T[] {
  const asOf = new Date(asOfDate);
  const windowStart = new Date(asOf);
  windowStart.setFullYear(windowStart.getFullYear() - windowYears);

  let effectiveStart = windowStart;
  if (definitionBreakDate) {
    const breakDate = new Date(definitionBreakDate);
    if (breakDate > windowStart) effectiveStart = breakDate;
  }

  return observations.filter((o) => {
    const d = new Date(o.date);
    return d >= effectiveStart && d <= asOf;
  });
}

// The calendar span a history actually covers, in years — NOT its row
// count. These measure different things and the difference is
// load-bearing for any cell the spec constrains by TIME ("percentile vs
// its own 10Y history"): daily data clears an observation FLOOR almost
// immediately while covering almost no history. sector_pe_capgoods is
// the live case (confirmed 2026-09-20): 81 rows spanning 0.26 years
// cleared percentileMinObservations=24 and reported status "ok", so a
// three-month window was ranked as though it were a decade and scored
// 95.0 — top of the sector table, holding a sleeve slot.
//
// Returns 0 for an empty or single-dated history.
export function historySpanYears(observations: Array<{ date: string }>): number {
  if (observations.length < 2) return 0;
  const first = new Date(`${observations[0]!.date}T00:00:00Z`).getTime();
  const last = new Date(`${observations[observations.length - 1]!.date}T00:00:00Z`).getTime();
  if (Number.isNaN(first) || Number.isNaN(last)) return 0;
  return Math.max(0, (last - first) / (365.25 * 24 * 60 * 60 * 1000));
}

// Collapse a history to ONE observation per calendar month (the last
// dated row in each month), for the cells whose spec says "vs its own
// 10-15Y MONTHLY history."
//
// This is a correctness fix, not a performance one. Percentile rank is
// computed over the stored rows, so an unevenly-sampled history weights
// whichever period happens to be sampled most densely. The live case
// (confirmed 2026-09-20): niftyindices P/E was backfilled month-end back
// to 2016 but refreshed DAILY since 2024-08, leaving 12 rows/year for
// 2016-2023 against 124/309/221 rows for 2024/2025/2026 — the most
// recent two years carried ~20x the weight per unit of calendar time.
// midcap150_pb's percentile moved from 17.2 (daily) to 77.1 (monthly) on
// that bias alone: the same number reading "cheap" or "expensive"
// depending only on how often the feed was polled.
//
// Month-end sampling makes each month contribute equally, which is what
// "monthly history" means and what the workbook's PERCENTRANK over a
// monthly column computes. Takes the LAST row of each month (month-end
// convention, matching the backfill and the spec's own sampling).
export function monthEndSample<T extends { date: string }>(observations: T[]): T[] {
  const byMonth = new Map<string, T>();
  for (const o of observations) {
    const month = o.date.slice(0, 7);
    const existing = byMonth.get(month);
    if (existing === undefined || o.date >= existing.date) byMonth.set(month, o);
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}
