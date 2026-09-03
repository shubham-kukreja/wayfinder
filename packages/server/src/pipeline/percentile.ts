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
