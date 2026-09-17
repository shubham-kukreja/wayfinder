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
// Binary search rather than a per-date filter/pop — see the identical
// note on lastRowAtOrBefore's other definition further down this file
// (deriveNiftyMomentumSeries below calls this once per row in the FULL
// nifty50_close history, so an O(n) scan per lookup makes the whole
// derivation O(n^2); with niftyindices' real backfill now producing
// 500+ rows, that was the dominant cost in computeAutoScoreCells).
function lastRowAtOrBeforeDate(rows: { date: string; value: number }[], targetIso: string): { date: string; value: number } | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let result: { date: string; value: number } | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.date <= targetIso) {
      result = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

function triApproxFromRows(
  closeRows: { date: string; value: number }[],
  divYieldRows: { date: string; value: number }[],
  asOfDate: string
): number | null {
  const asOf = new Date(asOfDate);
  const twelveMonthsAgo = new Date(asOf);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const twelveMonthsAgoIso = twelveMonthsAgo.toISOString().slice(0, 10);

  const currentClose = lastRowAtOrBeforeDate(closeRows, asOfDate);
  if (!currentClose) return null;

  const pastClose = lastRowAtOrBeforeDate(closeRows, twelveMonthsAgoIso);
  if (!pastClose || pastClose.value === 0) return null;

  const currentDivYield = lastRowAtOrBeforeDate(divYieldRows, asOfDate);
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
// Prefers a synthetic INR gold level built from gold_usd_futures x
// usd_inr over the directly-fetched gold_inr (IBJA spot), because IBJA
// has NO historical endpoint on the free tier — gold_inr holds 3
// observations and can never clear the 24-observation percentile floor,
// so this cell was permanently insufficient_history.
//
// The synthetic level is NOT the price an Indian buyer pays: it omits
// the ~15% landed-cost wedge (import duty + GST + local premium —
// measured live at 1.146x on 2026-09-16). That is acceptable here and
// ONLY here because this cell percentiles the series against ITS OWN
// history: a near-constant multiplier shifts every point alike and so
// leaves the percentile ordering unchanged. It would be wrong to mix the
// two series within one history, which is why this picks one or the
// other rather than merging them.
//
// Falls back to real gold_inr whenever that series does clear the floor
// on its own (e.g. after enough daily refreshes accumulate) — a real
// measured price beats a reconstruction once it is usable.
export function deriveRealGoldPriceSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const cpiRows = cpiIndexSingleBase(db);
  if (cpiRows.length === 0) return [];
  const cpiByMonth = new Map(cpiRows.map((r) => [r.date.slice(0, 7), r.value]));

  const deflate = (rows: Array<{ date: string; value: number }>) => {
    const out: Array<{ date: string; value: number }> = [];
    for (const row of rows) {
      const cpi = cpiByMonth.get(row.date.slice(0, 7));
      if (cpi === undefined || cpi === 0) continue;
      out.push({ date: row.date, value: row.value / cpi });
    }
    return out;
  };

  const directly = deflate(latestObservations(db, "gold_inr"));
  if (directly.length >= 24) return directly;

  const goldUsdRows = latestObservations(db, "gold_usd_futures");
  const fxRows = latestObservations(db, "usd_inr");
  if (goldUsdRows.length === 0 || fxRows.length === 0) return directly;

  // FX is daily and gold futures here are monthly; take the closest FX
  // observation at or before each gold date rather than requiring an
  // exact date match (which would drop every row landing on a weekend).
  const synthetic: Array<{ date: string; value: number }> = [];
  for (const g of goldUsdRows) {
    const fx = lastRowAtOrBefore(fxRows, g.date);
    if (!fx) continue;
    synthetic.push({ date: g.date, value: g.value * fx.value });
  }

  const syntheticReal = deflate(synthetic);
  return syntheticReal.length > directly.length ? syntheticReal : directly;
}

// gold_return_12m — trailing 12-month return on gold, from the COMEX
// futures series (see the l1.metals::momentum comment in scoreCells.ts
// for why a USD series is legitimate for a RETURN and not for a level).
// Uses the same "closest observation at or before the target date"
// lookback as the other trailing-return derivations here, so an exactly
// -12-months date that falls on a non-trading day still resolves.
export function deriveGoldReturn12mSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = latestObservations(db, "gold_usd_futures");
  if (rows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const ret = trailingReturn(rows, row.date, 12);
    if (ret === null) continue;
    out.push({ date: row.date, value: ret });
  }
  return out;
}

// cpi_index is written by TWO adapters on DIFFERENT index bases: FRED's
// OECD series is "Index 2015=100" (reaching ~157 by 2025-03), while the
// RBI mirror publishes on a later base (~104.84 for 2026-03). They are
// the same concept but not the same scale, and concatenating them makes
// the level appear to COLLAPSE ~34% between 2025-03 and 2026-03 — which
// would corrupt every deflated series and invent a huge deflation print
// in the YoY change.
//
// Rebasing one onto the other needs an overlapping period to compute the
// splice factor from, and there is none (FRED ends 2025-03, RBI starts
// 2026-03) — so any splice factor would be a guess. Instead: take
// whichever source supplies the longer continuous run and use ONLY that
// one. A shorter honest series beats a longer corrupted one.
function cpiIndexSingleBase(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = latestObservations(db, "cpi_index");
  const bySource = new Map<string, Array<{ date: string; value: number }>>();
  for (const r of rows) {
    const list = bySource.get(r.source) ?? [];
    list.push({ date: r.date, value: r.value });
    bySource.set(r.source, list);
  }
  let best: Array<{ date: string; value: number }> = [];
  for (const list of bySource.values()) if (list.length > best.length) best = list;
  return best;
}

// cpi_yoy derived from the cpi_index level: the 12-month percentage
// change, which is the definition of year-on-year CPI inflation.
//
// Why this exists: cpi_yoy is fetched directly by the RBI mirror adapter
// (its combinedInflation column), but that mirror only ever exposes a
// ~15-month trailing window, so the stored series sat at 1 observation —
// far below the 24-observation percentile floor — and l1.debt::valuation
// (gsec_10y - cpi_yoy) was permanently insufficient_history. cpi_index
// now backfills properly from FRED's INDCPIALLMINMEI, so the YoY change
// can be computed across that whole history instead.
//
// Matches on YEAR-MONTH exactly 12 months back rather than date
// arithmetic: CPI is monthly and stamped to the 1st, so the comparison is
// unambiguous and needs no nearest-neighbour search. Rows whose
// 12-months-prior month is absent are skipped rather than interpolated —
// a gap must not become an invented inflation print.
//
// Returns a series for percentile purposes only; never writes to the
// observations table.
export function deriveCpiYoySeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = cpiIndexSingleBase(db);
  const byMonth = new Map(rows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const [year, month] = row.date.slice(0, 7).split("-").map(Number);
    if (!year || !month) continue;
    const priorKey = `${year - 1}-${String(month).padStart(2, "0")}`;
    const prior = byMonth.get(priorKey);
    if (prior === undefined || prior === 0) continue;
    out.push({ date: row.date, value: ((row.value - prior) / prior) * 100 });
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
//
// Binary search rather than a per-date filter/pop: this runs once per
// row in the FULL history (deriveSectorRelMomentumSeries below), so a
// naive O(n) scan per lookup makes the whole derivation O(n^2) — with
// niftyindices' real backfill now producing 500+ daily rows per sector,
// that measured multiple seconds PER SECTOR and made every /api/snapshot
// request (which recomputes all 8 sectors) take ~3s. `rows` is assumed
// date-sorted ascending, same invariant latestObservations already
// provides.
function lastRowAtOrBefore(rows: { date: string; value: number }[], targetIso: string): { date: string; value: number } | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let result: { date: string; value: number } | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.date <= targetIso) {
      result = rows[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

function trailingReturn(rows: { date: string; value: number }[], asOfDate: string, monthsBack: number): number | null {
  const asOf = new Date(asOfDate);
  const past = new Date(asOf);
  past.setMonth(past.getMonth() - monthsBack);
  const pastIso = past.toISOString().slice(0, 10);

  const currentRow = lastRowAtOrBefore(rows, asOfDate);
  if (!currentRow) return null;
  const pastRow = lastRowAtOrBefore(rows, pastIso);
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
