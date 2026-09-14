import type Database from "better-sqlite3";
import { realRatesScore, type EtfHoldings, type CbBuying } from "@wayfinder/engine";
import { latestObservations } from "../store/observations.js";

// §8.4 — us_real_10y_6m_change (bp) drives both l1.metals::macro (gold
// column) and metals.{gold,silver}::real_rates. This is the one series the
// brief promises is "fully automatic from FRED" end-to-end, so it is the
// M2 gating acceptance test: a live us_real_10y history in the store must
// produce a real metals.*::real_rates score with no manual step.
export function usReal10y6mChangeBp(db: Database.Database, asOfDate: string): number | null {
  const rows = latestObservations(db, "us_real_10y");
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Latest observation at or before asOfDate.
  const current = [...rows].filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  // Closest observation at or before the 6-months-ago mark.
  const past = [...rows].filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!past) return null;

  // Both values are yields in percent; bp = percentage-point change * 100.
  return (current.value - past.value) * 100;
}

// §8.5 (Calculation Guide row 23) — "Global gold ETF holdings rising 3M:
// +10; falling: -10." A plain direction comparison, no percentile or
// magnitude threshold specified in the source spec — current
// gold_etf_shares_outstanding vs. the closest observation ~3 months prior.
// Same "closest observation at or before the target date" pattern as
// usReal10y6mChangeBp above, reused rather than reinvented.
export function goldEtfHoldingsTrend(db: Database.Database, asOfDate: string): EtfHoldings | null {
  const rows = latestObservations(db, "gold_etf_shares_outstanding");
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const threeMonthsAgo = new Date(asOf);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const current = [...rows].filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  const past = [...rows].filter((r) => new Date(r.date) <= threeMonthsAgo).pop();
  if (!past) return null;

  return current.value >= past.value ? "rising" : "falling";
}

// Nifty 50 TRI (Total Return Index) 12M-return approximation. No real TRI
// source was found free (confirmed live 2026-09-15: NSE's Daily Snapshot
// CSV only has a distinct "Nifty 50 Futures TR Index," a different
// product; investing.com's NIFTRI ticker is Cloudflare/WAF-blocked). This
// approximates it as price return over the trailing 12 months plus
// today's trailing Div Yield — NOT a precise reconstruction: it applies
// a single point-in-time yield figure across the whole 12-month window,
// so it will diverge from the real TRI whenever yield itself moved
// materially over that period (e.g. a dividend-heavy quarter, or a large
// price move that mechanically shifts the yield%). Treat this as a
// reasonable estimate, not an exact match to AMFI's published Nifty 50
// TRI 1Y return.
//
// Same "closest observation at or before the target date" calendar
// lookback as usReal10y6mChangeBp/goldEtfHoldingsTrend above — NOT a
// fixed trading-day shift (e.g. 252 rows back), since this project's
// stored history won't be a dense gap-free daily series from day one
// (early backfill windows, holidays) and a row-count shift would
// misalign against actual elapsed calendar time.
//
// Pure calculation, split out from the DB-querying wrapper below so the
// per-date series generator (deriveNiftyMomentumSeries) can reuse the
// exact same formula for every historical date, not just "today."
function triApproxFromRows(
  closeRows: { date: string; value: number }[],
  divYieldRows: { date: string; value: number }[],
  asOfDate: string
): number | null {
  const asOf = new Date(asOfDate);
  const twelveMonthsAgo = new Date(asOf);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const currentClose = closeRows.filter((r) => new Date(r.date) <= asOf).pop();
  if (!currentClose) return null;

  const pastClose = closeRows.filter((r) => new Date(r.date) <= twelveMonthsAgo).pop();
  if (!pastClose || pastClose.value === 0) return null;

  const currentDivYield = divYieldRows.filter((r) => new Date(r.date) <= asOf).pop();
  if (!currentDivYield) return null;

  const priceReturn = currentClose.value / pastClose.value;
  const divYieldDecimal = currentDivYield.value / 100; // stored as a raw percentage (e.g. 1.21), see adapters/niftyindices.ts
  return priceReturn * (1 + divYieldDecimal) - 1;
}

export function niftyTriApprox12mReturn(db: Database.Database, asOfDate: string): number | null {
  const closeRows = latestObservations(db, "nifty50_close");
  const divYieldRows = latestObservations(db, "nifty50_div_yield");
  if (closeRows.length === 0 || divYieldRows.length === 0) return null;
  return triApproxFromRows(closeRows, divYieldRows, asOfDate);
}

// §8.1 (Calculation Guide row 11) — l1.equity::momentum: "Nifty 50
// total-return 12M % minus 10Y G-sec yield (equity excess return).
// Percentile vs history, AS-IS." The spec's own "universal recipe"
// (Calculation Guide A3) requires a HISTORY of this excess-return value
// to percentile against — not just today's single figure — so this
// generates one excess-return observation for every date that has both
// enough trailing nifty50_close history (12 months back) and a gsec_10y
// reading for that month, reusing niftyTriApprox12mReturn's exact
// formula per date rather than just for "today."
//
// gsec_10y is joined by YEAR-MONTH, not exact date — same reasoning as
// derivedDifferenceSeries in scoreEngine.ts (FRED's gsec_10y publishes on
// a different cadence/day than the daily nifty50_close series).
export function deriveNiftyMomentumSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const closeRows = latestObservations(db, "nifty50_close");
  const divYieldRows = latestObservations(db, "nifty50_div_yield");
  const gsecRows = latestObservations(db, "gsec_10y");
  if (closeRows.length === 0 || divYieldRows.length === 0 || gsecRows.length === 0) return [];

  const gsecByMonth = new Map(gsecRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const closeRow of closeRows) {
    const triReturn = triApproxFromRows(closeRows, divYieldRows, closeRow.date);
    if (triReturn === null) continue; // not enough trailing history yet for this date

    const gsecYield = gsecByMonth.get(closeRow.date.slice(0, 7));
    if (gsecYield === undefined) continue;

    // Both sides in percentage points: triReturn is a decimal (e.g.
    // 0.15 for 15%), gsecYield is already a percent (e.g. 6.75).
    out.push({ date: closeRow.date, value: triReturn * 100 - gsecYield });
  }
  return out;
}

// §8.5 (Calculation Guide row 23) — "central-bank buying running above 5Y
// average: +15; below: -10." cb_gold_reserves_tonnes (DBnomics/IMF IFS,
// adapters/dbnomics.ts) is a STOCK series (total reserves held each
// month), so "buying" (a flow) is the month-over-month change — this
// compares the trailing-12M average monthly net purchase against the
// trailing-5Y (60-month) average monthly net purchase, both computed
// from the same reserves series. "Above/below 5Y average" reads most
// naturally as comparing a recent pace to a longer-run pace, not a
// single month's change (too noisy) or reserve LEVEL vs its own 5Y
// average (that's a valuation-style comparison, not a buying-pace one,
// and doesn't match the spec's "net purchases" framing in row 23's own
// worked example).
export function centralBankGoldBuyingTrend(db: Database.Database, asOfDate: string): CbBuying | null {
  const rows = latestObservations(db, "cb_gold_reserves_tonnes");
  if (rows.length < 2) return null;

  const asOf = new Date(asOfDate);
  const upToAsOf = rows.filter((r) => new Date(r.date) <= asOf);
  if (upToAsOf.length < 2) return null;

  // Month-over-month net purchases (tonnes), consecutive observations.
  const monthlyChanges: number[] = [];
  for (let i = 1; i < upToAsOf.length; i++) {
    monthlyChanges.push(upToAsOf[i]!.value - upToAsOf[i - 1]!.value);
  }
  if (monthlyChanges.length === 0) return null;

  const recent12 = monthlyChanges.slice(-12);
  const trailing60 = monthlyChanges.slice(-60);
  if (recent12.length === 0 || trailing60.length === 0) return null;

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const recentAvg = avg(recent12);
  const fiveYearAvg = avg(trailing60);

  return recentAvg >= fiveYearAvg ? "above_average" : "below_average";
}

export function deriveRealRatesScores(
  db: Database.Database,
  asOfDate: string
): { "metals.gold::real_rates": number; "metals.silver::real_rates": number; "l1.metals::macro": number } | null {
  const changeBp = usReal10y6mChangeBp(db, asOfDate);
  if (changeBp === null) return null;
  return {
    "metals.gold::real_rates": realRatesScore(changeBp, "gold"),
    "metals.silver::real_rates": realRatesScore(changeBp, "silver"),
    "l1.metals::macro": realRatesScore(changeBp, "gold"), // §8.4: same table drives the gold column of l1.metals::macro
  };
}

// Calculation Guide row 7 — l1.equity::valuation: "Earnings-yield gap =
// (100 / Nifty 50 trailing P/E) − 10Y G-sec yield. Build monthly history
// of this gap; attractiveness = PERCENTRANK of current gap × 100, AS-IS."
// Month-joined against gsec_10y (FRED, monthly) same as
// derivedDifferenceSeries — nifty50_pe (NSE) publishes daily, gsec_10y
// doesn't, so an exact-date join would silently drop almost every row.
export function deriveEarningsYieldGapSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const peRows = latestObservations(db, "nifty50_pe");
  const gsecRows = latestObservations(db, "gsec_10y");
  if (peRows.length === 0 || gsecRows.length === 0) return [];

  const gsecByMonth = new Map(gsecRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const peRow of peRows) {
    if (peRow.value === 0) continue;
    const gsecYield = gsecByMonth.get(peRow.date.slice(0, 7));
    if (gsecYield === undefined) continue;
    out.push({ date: peRow.date, value: (100 / peRow.value) - gsecYield });
  }
  return out;
}

// Calculation Guide row 21 — l1.metals::valuation: "INR gold price
// deflated by CPI index (real gold price). Percentile vs 15–20Y history,
// INVERTED." Month-joined against RBI's cpi_index (same reasoning as
// deriveEarningsYieldGapSeries above — gold_inr/IBJA is daily,
// cpi_index/RBI is monthly).
export function deriveRealGoldPriceSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const goldRows = latestObservations(db, "gold_inr");
  const cpiRows = latestObservations(db, "cpi_index");
  if (goldRows.length === 0 || cpiRows.length === 0) return [];

  const cpiByMonth = new Map(cpiRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const goldRow of goldRows) {
    const cpi = cpiByMonth.get(goldRow.date.slice(0, 7));
    if (cpi === undefined || cpi === 0) continue;
    out.push({ date: goldRow.date, value: goldRow.value / cpi });
  }
  return out;
}

// Data Trackers rows 5-8 / Calculation Guide row 29 —
// equity.{large,mid,small}::relvalue. "Mid–Large Spread" and
// "Small–Large Spread" are simple differences of the same P/E series
// equity.{mid,small}::valuation already percentile (midcap150_pe /
// smallcap250_pe against nifty100_pe as the "Large" leg) — same-date
// join is correct here since all three come from the same NSE/
// niftyindices snapshot for a given day, unlike the cross-source month
// joins above.
export function deriveMidLargeSpreadSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const midRows = latestObservations(db, "midcap150_pe");
  const largeRows = latestObservations(db, "nifty100_pe");
  const largeByDate = new Map(largeRows.map((r) => [r.date, r.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const mid of midRows) {
    const large = largeByDate.get(mid.date);
    if (large === undefined) continue;
    out.push({ date: mid.date, value: mid.value - large });
  }
  return out;
}

export function deriveSmallLargeSpreadSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const smallRows = latestObservations(db, "smallcap250_pe");
  const largeRows = latestObservations(db, "nifty100_pe");
  const largeByDate = new Map(largeRows.map((r) => [r.date, r.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const small of smallRows) {
    const large = largeByDate.get(small.date);
    if (large === undefined) continue;
    out.push({ date: small.date, value: small.value - large });
  }
  return out;
}

// Calculation Guide row 48 — sector.*::rel_momentum: "Average of the
// sector index's 6M and 12M return minus Nifty's over the same windows;
// percentile vs history, AS-IS." Generates one relative-momentum
// observation per date that has 12M of trailing history for BOTH the
// sector close and nifty50_close — same "closest observation at or
// before" calendar lookback as the TRI approximation above (niftyindices'
// backfill window won't be a dense gap-free daily series from day one).
function trailingReturn(rows: { date: string; value: number }[], asOfDate: string, monthsBack: number): number | null {
  const asOf = new Date(asOfDate);
  const past = new Date(asOf);
  past.setMonth(past.getMonth() - monthsBack);

  const currentRow = rows.filter((r) => new Date(r.date) <= asOf).pop();
  if (!currentRow) return null;
  const pastRow = rows.filter((r) => new Date(r.date) <= past).pop();
  if (!pastRow || pastRow.value === 0) return null;

  return currentRow.value / pastRow.value - 1;
}

export function deriveSectorRelMomentumSeries(db: Database.Database, sectorSeriesId: string): Array<{ date: string; value: number }> {
  const sectorRows = latestObservations(db, sectorSeriesId);
  const niftyRows = latestObservations(db, "nifty50_close");
  if (sectorRows.length === 0 || niftyRows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of sectorRows) {
    const sector6m = trailingReturn(sectorRows, row.date, 6);
    const sector12m = trailingReturn(sectorRows, row.date, 12);
    const nifty6m = trailingReturn(niftyRows, row.date, 6);
    const nifty12m = trailingReturn(niftyRows, row.date, 12);
    if (sector6m === null || sector12m === null || nifty6m === null || nifty12m === null) continue;

    const relMomentum = ((sector6m - nifty6m) + (sector12m - nifty12m)) / 2;
    out.push({ date: row.date, value: relMomentum });
  }
  return out;
}
