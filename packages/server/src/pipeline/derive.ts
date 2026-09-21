import type Database from "better-sqlite3";
import {
  realRatesScore,
  type EtfHoldings,
  type CbBuying,
  type RbiStance,
  type InflationDir,
  type InflationVsTarget,
  type RbiPath,
} from "@wayfinder/engine";
import { latestObservations, latestObservationsBySource } from "../store/observations.js";
import { derivedRatioSeries } from "./scoreEngine.js";

/** The exact 20-year ratio history used by both ratio score cells and the UI trace. */
export function deriveGoldSilverRatio20ySeries(db: Database.Database, minObservations = 24): Array<{ date: string; value: number }> {
  const futures = derivedRatioSeries(db, "gold_usd_futures", "silver_usd_futures");
  const useFutures = futures.length >= minObservations;
  const unbounded = useFutures ? futures : derivedRatioSeries(db, "gold_inr", "silver_inr");
  const end = unbounded[unbounded.length - 1]?.date;
  if (!end) return [];
  const cutoff = new Date(`${end}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 20);
  return unbounded.filter((row) => row.date >= cutoff.toISOString().slice(0, 10));
}

// §8.4 — us_real_10y_6m_change (bp) drives both l1.metals::macro (gold
// column) and metals.{gold,silver}::real_rates. This is the one series the
// brief promises is "fully automatic from FRED" end-to-end, so it is the
// M2 gating acceptance test: a live us_real_10y history in the store must
// produce a real metals.*::real_rates score with no manual step.
export function deriveUsReal10y6mChangeSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = latestObservations(db, "us_real_10y");
  if (rows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const current of rows) {
    const sixMonthsAgo = new Date(`${current.date}T00:00:00Z`);
    sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);
    const target = sixMonthsAgo.toISOString().slice(0, 10);
    const past = lastRowAtOrBeforeDate(rows, target);
    if (!past) continue;

    // Both values are yields in percent; bp = percentage-point change * 100.
    out.push({ date: current.date, value: (current.value - past.value) * 100 });
  }
  return out;
}

export function usReal10y6mChangeBp(db: Database.Database, asOfDate: string): number | null {
  const rows = deriveUsReal10y6mChangeSeries(db);
  const latest = lastRowAtOrBeforeDate(rows, asOfDate);
  return latest?.value ?? null;
}

// §8.5 (Calculation Guide row 23) — "Global gold ETF holdings rising 3M:
// +10; falling: -10." A plain direction comparison, no percentile or
// magnitude threshold specified in the source spec — current
// gold_etf_tonnes vs. the closest observation ~3 months prior. Same
// "closest observation at or before the target date" pattern as
// usReal10y6mChangeBp above, reused rather than reinvented.
//
// Reads gold_etf_tonnes (SPDR's own GLD archive, adapters/goldEtfHoldings.ts),
// not the older gold_etf_shares_outstanding (Yahoo, adapters/yahooMetals.ts):
// that series is confirmed latest-only (no historical range on Yahoo's
// v7/finance/quote endpoint), so it could never carry a real ~3-months-ago
// observation until 3 months of daily refreshes had accumulated from
// scratch. gold_etf_tonnes has genuine daily history back to 2004.
export function goldEtfHoldingsTrend(db: Database.Database, asOfDate: string): EtfHoldings | null {
  const rows = latestObservations(db, "gold_etf_tonnes");
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

// §8.8 — the two readings silverIndustrialScore needs: the latest
// global_mfg_pmi and the one immediately before it. Unlike the trend
// helpers above, this is NOT a calendar lookback ("closest observation ~N
// months prior"): the rubric's condition is "> 52 AND RISING", i.e. up
// versus the immediately preceding PUBLISHED month, so the correct
// comparison is the previous distinct observation date, whatever the gap.
// A calendar lookback would silently compare against nothing at all when
// the store holds only the two months TE's page exposes.
//
// Returns null unless two genuinely DISTINCT observation dates exist.
// That matters: adapters/tradingEconomics.ts writes the same monthly
// figure on every refresh run, so latestObservations can hold many rows
// that are really one reading — treating those as "unchanged, therefore
// not rising" would fabricate a trend answer out of a single data point.
export function globalMfgPmiReadings(
  db: Database.Database,
  asOfDate: string
): { pmi: number; priorPmi: number } | null {
  const rows = latestObservations(db, "global_mfg_pmi");
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const eligible = rows.filter((r) => new Date(r.date) <= asOf);
  if (eligible.length === 0) return null;

  // Collapse to one value per date (latest fetch wins, matching this
  // project's "latest fetched_at wins" observation convention — see
  // store/observations.ts), then take the last two distinct dates.
  const byDate = new Map<string, number>();
  for (const row of eligible) byDate.set(row.date, row.value);
  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return null;

  const pmi = byDate.get(dates[dates.length - 1]!)!;
  const priorPmi = byDate.get(dates[dates.length - 2]!)!;
  return { pmi, priorPmi };
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

// Trailing simple mean over the last `window` observations, emitted only
// for dates that have a FULL window behind them — a partial average over
// 1-2 months is a different statistic from a 3M average, not a rougher
// version of it, so the leading rows are dropped rather than approximated
// (§1 invariant 4: never guess a value the data doesn't support).
//
// Positional, not calendar-based: it averages the last N OBSERVATIONS,
// which equals the last N months only when the series is truly monthly
// with no gaps. That holds for the AMFI flow/AUM series this serves
// (one published row per month). A daily series would need a
// calendar-window variant instead.
function trailingMeanSeries(
  rows: Array<{ date: string; value: number }>,
  window: number
): Array<{ date: string; value: number }> {
  if (rows.length < window) return [];
  const out: Array<{ date: string; value: number }> = [];
  for (let i = window - 1; i < rows.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += rows[j]!.value;
    out.push({ date: rows[i]!.date, value: sum / window });
  }
  return out;
}

// §7.1 l1.equity::flows / l1.debt::flows — "3-month average of total
// active fund net flows (AMFI) as % of AUM. Percentile vs history, then
// INVERT."
//
// The 3M AVERAGING STEP THE SPEC REQUIRES LIVES HERE, not in the adapter.
// Despite its name, the stored `flow_equity_3m` series is a SINGLE
// month's net flow: adapters/amfi.ts maps it straight from AMFI's
// "Growth/Equity Oriented Schemes" sub-total row for that month, with no
// rolling step anywhere. Scoring it raw (as this cell did until now) made
// the signal materially noisier than specified — one unusual month (a
// large NFO, a festival-season lull) swung a CONTRARIAN tilt that the 3M
// average exists precisely to damp.
//
// The flow is averaged BEFORE dividing by AUM, not after: the spec reads
// "3-month average of flows ... as % of AUM", and a mean of ratios would
// additionally smooth the AUM denominator, which is a stock, not a flow —
// it should be read at the ratio's own date.
// §7.1 l1.metals::flows — the 3-MONTH AVERAGE of a raw flow series, with
// NO AUM denominator.
//
// The spec (Calculation Guide, gold row) reads: "Indian gold ETF net
// flows (AMFI), 3M avg, percentile vs history, INVERTED." Unlike the
// equity and debt flow cells it specifies no "% of AUM" normalisation,
// so this smooths the flow and stops there rather than inventing a
// denominator the spec does not ask for.
//
// The 3M average was the missing half: flow_goldetf holds a SINGLE
// month's flow from AMFI's "Gold ETF" row (same shape as
// flow_equity_3m, whose name likewise overstates what it contains), and
// the cell percentiled it raw. Monthly gold-ETF flow is noisy enough to
// swing 4,168 crore between two adjacent months (May -725 -> Jun +3,443,
// live 2026-09-19), so ranking a single month made a contrarian signal
// far jumpier than the spec intends.
export function deriveFlowMean3mSeries(
  db: Database.Database,
  flowSeriesId: string
): Array<{ date: string; value: number }> {
  return trailingMeanSeries(latestObservations(db, flowSeriesId), 3);
}

export function deriveFlowRatio3mSeries(
  db: Database.Database,
  flowSeriesId: string,
  aumSeriesId: string
): Array<{ date: string; value: number }> {
  const flowRows = latestObservations(db, flowSeriesId);
  const aumRows = latestObservations(db, aumSeriesId);
  if (flowRows.length === 0 || aumRows.length === 0) return [];

  const smoothedFlows = trailingMeanSeries(flowRows, 3);
  const aumByMonth = new Map(aumRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const flow of smoothedFlows) {
    const aum = aumByMonth.get(flow.date.slice(0, 7));
    if (aum === undefined || aum === 0) continue;
    out.push({ date: flow.date, value: flow.value / aum });
  }
  return out;
}

// Calculation Guide row 7 — l1.equity::valuation: "Earnings-yield gap =
// (100 / Nifty 50 trailing P/E) − 10Y G-sec yield. Build monthly history
// of this gap; attractiveness = PERCENTRANK of current gap × 100, AS-IS."
// Month-joined against gsec_10y (FRED, monthly) same as
// derivedDifferenceSeries — nifty50_pe (NSE) publishes daily, gsec_10y
// doesn't, so an exact-date join would silently drop almost every row.
// Each row carries the two readings it was built from, alongside the
// gap itself. A trace cannot recover them afterwards: the gap ends
// wherever the month-join last resolved, so re-deriving the P/E from
// each series' own latest pairs readings that never coexisted (live on
// 2026-09-21: September's P/E of 19.79 against July's 6.78% yield gave
// -1.73%, while the ranked July row was -1.97%). Extra fields only —
// the {date, value} shape every caller consumes is unchanged.
export function deriveEarningsYieldGapSeries(
  db: Database.Database
): Array<{ date: string; value: number; pe: number; peDate: string; gsec: number; gsecDate: string }> {
  const peRows = latestObservations(db, "nifty50_pe");
  const gsecRows = latestObservations(db, "gsec_10y");
  if (peRows.length === 0 || gsecRows.length === 0) return [];

  // Keep the DATE of the joined yield, not just its value: the join is
  // month-granular, so the two sides of a row routinely carry different
  // days (July's gap pairs the 31st's P/E with the 1st's yield).
  const gsecByMonth = new Map(gsecRows.map((r) => [r.date.slice(0, 7), r]));

  const out: Array<{ date: string; value: number; pe: number; peDate: string; gsec: number; gsecDate: string }> = [];
  for (const peRow of peRows) {
    if (peRow.value === 0) continue;
    const gsecRow = gsecByMonth.get(peRow.date.slice(0, 7));
    if (gsecRow === undefined) continue;
    out.push({
      date: peRow.date,
      value: 100 / peRow.value - gsecRow.value,
      pe: peRow.value,
      peDate: peRow.date,
      gsec: gsecRow.value,
      gsecDate: gsecRow.date,
    });
  }
  return out;
}

// Calculation Guide row 7, part (b) — the OTHER half of
// l1.equity::valuation: "Nifty P/E percentile vs its own 10-15Y history,
// INVERTED: attractiveness = 100 − percentile." Final cell score is
// (a + b) / 2, averaged in scoreCells.ts.
//
// This is just the raw nifty50_pe history — the percentile and inversion
// are applied by autoScoreFromSeries(..., "inverted") like every other
// percentile cell, so no separate transform logic is needed here. It
// exists as its own function purely so scoreCells.ts reads symmetrically
// with part (a) and so the gsec_10y month-join (which part (b) does NOT
// need — it is a pure P/E percentile, no bond leg) can't be applied to it
// by accident.
//
// History depth: the spec asks for 10-15Y. nse.ts's fetchHistory() is a
// deliberate no-op, but niftyindices.ts maps "Nifty 50" -> nifty50_pe and
// has a REAL day-by-day backfill, so the depth available here is whatever
// that adapter has actually been run over — not a source limitation.
// Falls back to insufficient_history (score 50) until it clears
// percentileMinObservations, like every other percentile cell.
export function deriveNiftyPeSeries(db: Database.Database): Array<{ date: string; value: number }> {
  return latestObservations(db, "nifty50_pe")
    .filter((r) => r.value > 0)
    .map((r) => ({ date: r.date, value: r.value }));
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
// One row per MONTH, taking the last observation in each. The gold
// series now mixes granularities - a deep monthly backfill plus a recent
// daily top-up (see adapters/yahooMetals.ts for why the monthly feed
// alone has holes) - and this cell percentiles a MONTHLY series against
// monthly CPI. Without collapsing, recent months would contribute ~20
// rows each against one row for older months, silently reweighting the
// distribution toward the present.
function lastPerMonth(rows: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const byMonth = new Map<string, { date: string; value: number }>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const held = byMonth.get(month);
    if (!held || r.date >= held.date) byMonth.set(month, r);
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function deriveRealGoldPriceSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const cpiRows = cpiIndexSingleBase(db);
  if (cpiRows.length === 0) return [];
  const cpiByMonth = new Map(cpiRows.map((r) => [r.date.slice(0, 7), r.value]));

  const deflate = (rows: Array<{ date: string; value: number }>) => {
    const out: Array<{ date: string; value: number }> = [];
    for (const row of lastPerMonth(rows)) {
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

  // FX is daily and the gold series mixes daily and monthly rows; take
  // the closest FX observation at or before each gold date rather than
  // requiring an exact date match (which would drop every row landing on
  // a weekend).
  const synthetic: Array<{ date: string; value: number }> = [];
  for (const g of goldUsdRows) {
    const fx = lastRowAtOrBefore(fxRows, g.date);
    if (!fx) continue;
    synthetic.push({ date: g.date, value: g.value * fx.value });
  }

  const syntheticReal = deflate(synthetic);
  return syntheticReal.length > directly.length ? syntheticReal : directly;
}


// The INR gold price series the metals momentum cells rank.
//
// Built as gold_usd_futures x usd_inr, collapsed to ONE ROW PER MONTH.
// gold_inr (IBJA spot) is the natural source but its free tier has no
// historical endpoint, so it holds a handful of rows and can never clear
// the percentile floor - the same reason deriveRealGoldPriceSeries falls
// back to this construction.
//
// Month collapsing matters because the gold series now mixes a deep
// monthly backfill with a recent daily top-up; left raw, recent months
// would contribute ~20 rows each against one row for older months and
// silently reweight the distribution toward the present.
function goldInrMonthlySeries(db: Database.Database): Array<{ date: string; value: number }> {
  const goldRows = latestObservations(db, "gold_usd_futures");
  const fxRows = latestObservations(db, "usd_inr");
  if (goldRows.length === 0 || fxRows.length === 0) return [];

  const inr: Array<{ date: string; value: number }> = [];
  for (const g of goldRows) {
    const fx = lastRowAtOrBefore(fxRows, g.date);
    if (!fx) continue;
    inr.push({ date: g.date, value: g.value * fx.value });
  }
  return lastPerMonth(inr);
}

// §7.4 metals.gold::momentum / l1.metals::momentum - "Gold INR 12M
// return percentile vs history, AS-IS."
//
// Returns the 12-month return as a FRACTION (0.28 for 28%), matching
// trailingReturn's convention; the value only ever feeds a percentile,
// which is scale-invariant either way.
//
// Denominated in INR, not USD. This previously ranked the USD futures
// return and carried an explicit honesty note that it "omits the INR/USD
// move an Indian holder actually experiences." That omission is material
// rather than cosmetic: the rupee depreciated 8.04% over the 12 months
// to 2026-09 (88.44 -> 95.55, confirmed live 2026-09-19), so the USD
// return understated the INR return an Indian investor actually earned
// by roughly that much. usd_inr now has real daily history back to 2006,
// so the currency leg no longer has to be dropped.
export function deriveGoldReturn12mSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = goldInrMonthlySeries(db);
  if (rows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const ret = trailingReturn(rows, row.date, 12);
    if (ret === null) continue;
    out.push({ date: row.date, value: ret });
  }
  return out;
}

// The companion six-month return series used by veto.parabolic. Keeping
// the full series (rather than only today's scalar) lets the snapshot
// publish the exact quantity checked by the veto, so the UI can show the
// threshold comparison without reimplementing server arithmetic.
export function deriveGoldReturn6mSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = goldInrMonthlySeries(db);
  if (rows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const ret = trailingReturn(rows, row.date, 6);
    if (ret === null) continue;
    out.push({ date: row.date, value: ret });
  }
  return out;
}

// §9 veto.parabolic - "if return >40% in 6M the parabolic veto fires
// regardless of this score."
//
// Same INR series as the momentum cell, over a 6-month window. Returns
// null when there is not enough history to measure a 6-month move, so an
// unknown never reads as a quiet "not triggered."
export function goldParabolic6mReturn(db: Database.Database, asOfDate: string): number | null {
  const rows = deriveGoldReturn6mSeries(db);
  if (rows.length === 0) return null;
  const current = lastRowAtOrBefore(rows, asOfDate);
  if (!current) return null;
  return current.value;
}


// cpi_index is written by TWO adapters on DIFFERENT index bases: FRED's
// OECD series is "Index 2015=100" (reaching ~157 by 2025-03), while the
// RBI mirror publishes on a later base (~104.84 for 2026-03). They are
// the same concept but not the same scale, and naively concatenating
// them makes the level appear to COLLAPSE ~34%, which would corrupt
// every deflated series and invent a huge deflation print in the YoY
// change.
//
// This used to take whichever source had the LONGER run and discard the
// other, on the stated grounds that "there is no overlapping period, so
// any splice factor would be a guess." That was true when written and is
// now false: FRED and RBI both publish 2025-01, 2025-02 and 2025-03.
//
// The overlap was invisible through latestObservations(), which keeps
// only the latest FETCH per date — RBI was fetched after FRED, so those
// three months read as RBI-only and FRED looked like it ended 2024-12.
// The cost was real: deflation stopped at 2024-12, so
// l1.metals::valuation percentiled a NOVEMBER 2024 gold price and
// reported staleDays 687 while the store held prices through 2026-09.
//
// Now: read per (date, source), compute the splice factor as the mean
// FRED/RBI ratio across the genuinely shared months, and rebase the
// shorter run onto the longer one's scale. A factor measured on real
// overlap is an observation, not a guess. If the overlap ever
// disappears, this falls back to the old longest-run-only behaviour
// rather than inventing a factor.
export interface CpiSpliceResult {
  rows: Array<{ date: string; value: number }>;
  // Non-null only when a real splice happened. Surfaced so a trace can
  // say the series is spliced rather than implying one clean source.
  factor: number | null;
  overlapMonths: string[];
  baseSource: string | null;
}

export function cpiIndexSpliced(db: Database.Database): CpiSpliceResult {
  const bySource = latestObservationsBySource(db, "cpi_index");
  if (bySource.size === 0) return { rows: [], factor: null, overlapMonths: [], baseSource: null };

  // The longest run is the BASE: its scale is the one everything else is
  // rebased onto, so the bulk of the history keeps its original values.
  let baseSource: string | null = null;
  let base: Array<{ date: string; value: number }> = [];
  for (const [source, list] of bySource) {
    if (list.length > base.length) {
      base = list;
      baseSource = source;
    }
  }

  const byMonth = new Map(base.map((r) => [r.date.slice(0, 7), r]));
  const baseMonths = new Map(base.map((r) => [r.date.slice(0, 7), r.value]));

  let factor: number | null = null;
  const overlapMonths: string[] = [];

  for (const [source, list] of bySource) {
    if (source === baseSource) continue;

    const shared = list.filter((r) => baseMonths.has(r.date.slice(0, 7)) && r.value !== 0);
    if (shared.length === 0) {
      // No overlap with this source: cannot rebase it without guessing,
      // so it is dropped entirely rather than concatenated at the wrong
      // scale. This is the old behaviour, kept as the fallback.
      continue;
    }

    // Mean of the per-month ratios rather than a ratio of means, so one
    // unusually large month cannot dominate the factor.
    const ratios = shared.map((r) => baseMonths.get(r.date.slice(0, 7))! / r.value);
    const sourceFactor = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    if (!Number.isFinite(sourceFactor) || sourceFactor <= 0) continue;

    factor = sourceFactor;
    for (const r of shared) overlapMonths.push(r.date.slice(0, 7));

    // Rebase and fill ONLY the months the base does not already cover.
    // On a shared month the base's own reading wins: it is the scale
    // everything else was converted to, so using it avoids introducing
    // a second value for a month that already has one.
    for (const r of list) {
      const month = r.date.slice(0, 7);
      if (byMonth.has(month)) continue;
      byMonth.set(month, { date: r.date, value: r.value * sourceFactor });
    }
  }

  const rows = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, factor, overlapMonths: [...new Set(overlapMonths)].sort(), baseSource };
}

function cpiIndexSingleBase(db: Database.Database): Array<{ date: string; value: number }> {
  return cpiIndexSpliced(db).rows;
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

// §7.1 l1.debt::momentum — 12-month return of the composite bond index,
// percentiled AS-IS (a bond index that has been rising is momentum FOR
// debt, so it is not inverted).
//
// bond_index_close is NSE's "Nifty Composite G-sec Index" from the
// niftyindices Daily Snapshot (see adapters/niftyindices.ts). It is a
// total-return index, so the level already carries accrued coupon and
// the raw ratio IS the total return — no dividend-yield add-back of the
// kind deriveNiftyMomentumSeries needs for the equity side.
//
// Expressed in PERCENTAGE POINTS (8.2 for 8.2%) to match the spec's
// worked example and the units the equity momentum series uses, rather
// than trailingReturn's native decimal.
export function deriveBondIndexReturn12mSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const rows = latestObservations(db, "bond_index_close");
  if (rows.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of rows) {
    const ret = trailingReturn(rows, row.date, 12);
    if (ret === null) continue; // no observation ~12 months back yet
    out.push({ date: row.date, value: ret * 100 });
  }
  return out;
}

// The cpi_yoy picture l1.debt::valuation ranks: directly fetched RBI
// prints where they exist, the FRED-backed deriveCpiYoySeries
// reconstruction everywhere else. Directly fetched observations win on
// any shared month — they are the published print, not a reconstruction.
export function cpiYoyJoined(db: Database.Database): Array<{ date: string; value: number }> {
  const byMonth = new Map(deriveCpiYoySeries(db).map((o) => [o.date.slice(0, 7), o]));
  for (const row of latestObservations(db, "cpi_yoy")) byMonth.set(row.date.slice(0, 7), { date: row.date, value: row.value });
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// §7.1 l1.debt::valuation — the real 10Y yield series the cell actually
// percentiles: gsec_10y minus CPI YoY, joined by YEAR-MONTH (both are
// monthly but are stamped to different days by their sources).
//
// Extracted from scoreCells.ts so the SAME series can be published on the
// snapshot. The UI previously had to fall back to each raw leg's own
// percentile, which is not what was ranked — gsec_10y's own percentile
// read 28.6 against a cell scoring 70 (confirmed live 2026-09-19).
// Months where either leg is missing are skipped, never interpolated.
export function deriveRealGsec10ySeries(db: Database.Database): Array<{ date: string; value: number }> {
  const cpiByMonth = new Map(cpiYoyJoined(db).map((o) => [o.date.slice(0, 7), o.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const g of latestObservations(db, "gsec_10y")) {
    const cpi = cpiByMonth.get(g.date.slice(0, 7));
    if (cpi === undefined) continue;
    out.push({ date: g.date, value: g.value - cpi });
  }
  return out;
}

// §8.1 — the `rbiStance` input to equityMacroScore, derived from the
// repo_rate series rather than from prose. The rubric's own wording is
// "RBI cutting or clearly about to cut / on hold, neutral / hiking or
// hawkish"; this implements the RATE-MOVE half of that wording and
// deliberately does NOT attempt the forward-looking "about to cut" or
// "hawkish" half, which would mean keyword-matching free-text policy
// commentary — brittle, unsourced, and exactly the kind of guess §1
// invariant 4 forbids. The honest consequence: a central bank that has
// signalled a cut but not yet delivered one reads here as on_hold (+0),
// the rubric's own neutral case, rather than being assigned +20 on a
// scrape's reading of tone. An analyst who judges a cut imminent can
// still override upward via the manual path.
//
// Six-month lookback, matching usReal10y6mChangeBp's window above: a
// policy rate is a step function of discrete MPC decisions (~6 meetings
// a year), so a shorter window would read "on hold" through most of a
// genuine easing cycle simply because no meeting fell inside it.
//
// Same "closest observation at or before the target date" calendar
// lookback as usReal10y6mChangeBp/goldEtfHoldingsTrend — NOT a fixed
// row-count shift. repo_rate is populated by two sources with different
// shapes (BIS's monthly mirrored history via adapters/dbnomics.ts and
// rbi.org.in's current-value-only widget via adapters/rbiRepoRate.ts,
// which stamps every refresh with that day's date), so row spacing is
// genuinely irregular and a row-count shift would misalign against
// elapsed calendar time.
//
// Returns null — not a stance — when there is no observation at or
// before the 6-month mark. That is the insufficient-history case, and
// the caller must leave the cell alone rather than score it: silently
// returning "on_hold" for "we cannot see far enough back" would make an
// unknown indistinguishable from a real neutral reading.
export function rbiStanceFromRepoRate(db: Database.Database, asOfDate: string): RbiStance | null {
  const rows = latestObservations(db, "repo_rate");
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const current = [...rows].filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  const past = [...rows].filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!past) return null;

  // The baseline must be a reading from ROUGHLY six months ago, not
  // merely the newest one that is at least six months old. Those come
  // apart badly in the real store: confirmed live 2026-09-19, BIS's
  // mirrored history ends 2025-06 while rbi.org.in's widget reads today,
  // leaving a genuine ~15-month hole between them. Without this bound
  // the comparison silently spans that whole gap and reports "cutting"
  // off a June 2025 rate — true over 15 months, but flatly wrong as a
  // description of current policy, which has been four consecutive
  // HOLDS. A stance is a statement about a window; measuring it over an
  // unknown, much longer window is not a rougher answer, it is a
  // different one (§1 invariant 4).
  //
  // Six months of slack on a six-month lookback: generous enough to
  // absorb normal monthly-publication lag and the irregular spacing of
  // a series two sources write to, strict enough that a year-plus mirror
  // gap reports "we cannot see the window" instead of guessing across
  // it. The caller treats null as insufficient history and leaves the
  // cell on its manual baseline.
  const staleCutoff = new Date(asOf);
  staleCutoff.setMonth(staleCutoff.getMonth() - 12);
  if (new Date(past.date) < staleCutoff) return null;

  // Exact equality is right here rather than an epsilon band: RBI moves
  // the repo rate in 25bp increments, so any real change clears any
  // sensible tolerance and there is no measurement noise to absorb —
  // both sources publish the administered rate itself, not a market
  // observation of it.
  if (current.value < past.value) return "cutting";
  if (current.value > past.value) return "hiking";
  return "on_hold";
}

// The same comparison as rbiStanceFromRepoRate, but returning the two
// readings it was made from. A rubric score is a sum of discrete
// choices, so "45" is unauditable on its own — the reader needs to see
// that the stance was on_hold BECAUSE the repo rate reads 5.25% today
// and read 5.25% six months ago. Kept as a sibling rather than folded
// into the helper above so the stance-only callers (and their tests)
// keep their existing signature.
export interface RbiStanceEvidence {
  stance: RbiStance;
  currentValue: number;
  currentDate: string;
  pastValue: number;
  pastDate: string;
}

export function rbiStanceEvidence(db: Database.Database, asOfDate: string): RbiStanceEvidence | null {
  const stance = rbiStanceFromRepoRate(db, asOfDate);
  if (stance === null) return null;

  const rows = latestObservations(db, "repo_rate");
  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const current = [...rows].filter((r) => new Date(r.date) <= asOf).pop();
  const past = [...rows].filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!current || !past) return null;

  return { stance, currentValue: current.value, currentDate: current.date, pastValue: past.value, pastDate: past.date };
}

// §8.1 — the `inflationDir` input to equityMacroScore: "inflation
// falling toward target: +5; rising: -5."
//
// Reads the same cpi_yoy picture l1.debt::valuation already assembles in
// scoreCells.ts — directly fetched RBI prints where they exist, the
// FRED-backed deriveCpiYoySeries reconstruction elsewhere — so the two
// cells can never disagree about what inflation did.
//
// Compares against the reading ~6 months back, not the immediately prior
// month. Monthly CPI is noisy and seasonal (a single vegetable-price
// month routinely flips the sign of a month-over-month change), and the
// rubric is asking about a DIRECTION OF TRAVEL toward target, not about
// the latest print's wobble. Six months also matches the repo-rate
// lookback above, so both rubric inputs describe the same window.
//
// Note the rubric is deliberately asymmetric: it has no neutral case —
// inflation is either falling (+5) or rising (-5). Dead-flat YoY is
// scored as rising, the conservative side, rather than inventing a third
// bucket the rubric doesn't define.
export function inflationDirFromCpi(db: Database.Database, asOfDate: string): InflationDir | null {
  const stored = latestObservations(db, "cpi_yoy");
  const byMonth = new Map(deriveCpiYoySeries(db).map((o) => [o.date.slice(0, 7), o]));
  for (const row of stored) byMonth.set(row.date.slice(0, 7), { date: row.date, value: row.value });
  const rows = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const current = rows.filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  const past = rows.filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!past) return null;

  // Same ~6-month-window bound, and for the same reason, as
  // rbiStanceFromRepoRate above: a baseline that is merely "at least six
  // months old" can in practice be years old, and a direction measured
  // across an unknown window is a different statistic, not a rougher
  // one. CPI is a monthly series with a real publication lag, so the
  // 12-month cutoff leaves ample slack for normal staleness while still
  // refusing to compare today against a long-abandoned reading.
  const staleCutoff = new Date(asOf);
  staleCutoff.setMonth(staleCutoff.getMonth() - 12);
  if (new Date(past.date) < staleCutoff) return null;

  return current.value < past.value ? "falling" : "rising";
}

// Evidence-returning sibling of inflationDirFromCpi, for the same
// auditability reason as rbiStanceEvidence above. Rebuilds the same
// merged monthly picture the helper uses so the dates it reports are the
// ones actually compared, not the raw stored rows.
export interface InflationDirEvidence {
  direction: InflationDir;
  currentValue: number;
  currentDate: string;
  pastValue: number;
  pastDate: string;
}

export function inflationDirEvidence(db: Database.Database, asOfDate: string): InflationDirEvidence | null {
  const direction = inflationDirFromCpi(db, asOfDate);
  if (direction === null) return null;

  const stored = latestObservations(db, "cpi_yoy");
  const byMonth = new Map(deriveCpiYoySeries(db).map((o) => [o.date.slice(0, 7), o]));
  for (const row of stored) byMonth.set(row.date.slice(0, 7), { date: row.date, value: row.value });
  const rows = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));

  const asOf = new Date(asOfDate);
  const sixMonthsAgo = new Date(asOf);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const current = rows.filter((r) => new Date(r.date) <= asOf).pop();
  const past = rows.filter((r) => new Date(r.date) <= sixMonthsAgo).pop();
  if (!current || !past) return null;

  return { direction, currentValue: current.value, currentDate: current.date, pastValue: past.value, pastDate: past.date };
}

// Data Trackers rows 5-8 / Calculation Guide row 29 —
// equity.{large,mid,small}::relvalue. "Mid–Large Spread" and
// "Small–Large Spread" are simple differences of the same P/E series
// equity.{mid,small}::valuation already percentile (midcap150_pe /
// smallcap250_pe against nifty100_pe as the "Large" leg) — same-date
// join is correct here since all three come from the same NSE/
// niftyindices snapshot for a given day, unlike the cross-source month
// joins above.
// §8.2 — the `inflationVsTarget` input to debtMacroScore: "inflation
// trending below target: +10", otherwise +0.
//
// NOT the same question as equityMacroScore's `inflationDir`, which asks
// about DIRECTION of travel. This one is about the LEVEL against a fixed
// reference, so the two cells can legitimately disagree — inflation can
// be rising (equity: -5) while still sitting below target (debt: +10).
//
// The 4% reference is not a modelling choice: it is the statutory CPI
// target set for the RBI under the Reserve Bank of India Act (the
// flexible inflation-targeting framework's mid-point, with a +/-2% band).
// Using the mid-point rather than the band's lower edge matches the
// rubric's own wording, "below target" rather than "below the band".
export const RBI_CPI_TARGET_PCT = 4;

export interface InflationVsTargetEvidence {
  level: InflationVsTarget;
  currentValue: number;
  currentDate: string;
  targetPct: number;
}

export function inflationVsTargetFromCpi(
  db: Database.Database,
  asOfDate: string
): InflationVsTargetEvidence | null {
  const rows = cpiYoyJoined(db);
  if (rows.length === 0) return null;

  const asOf = new Date(asOfDate);
  const current = rows.filter((r) => new Date(r.date) <= asOf).pop();
  if (!current) return null;

  // Same 12-month staleness bound the other rubric helpers use: a
  // reading that old describes a different regime, so the cell should
  // abstain rather than answer from it.
  const staleCutoff = new Date(asOf);
  staleCutoff.setMonth(staleCutoff.getMonth() - 12);
  if (new Date(current.date) < staleCutoff) return null;

  return {
    level: current.value < RBI_CPI_TARGET_PCT ? "below" : "at_or_above",
    currentValue: current.value,
    currentDate: current.date,
    targetPct: RBI_CPI_TARGET_PCT,
  };
}

// §8.2 — the `rbiPath` input to debtMacroScore.
//
// The rubric asks a FORWARD question: "cuts expected over next 12M". A
// repo-rate series can only report what has already happened, so this
// deliberately implements the same narrow reading rbiStanceFromRepoRate
// takes for the equity cell: a bank that has been CUTTING is read as
// "cuts_expected" (easing cycles run longer than one meeting), one that
// has been HIKING as "hiking", and a flat rate as "on_hold".
//
// The honest consequence, stated rather than hidden: a central bank that
// has signalled a pivot but not yet moved reads "on_hold" (+0) here, the
// rubric's own neutral case, instead of being assigned +20 off a scrape
// of policy tone. Keyword-matching MPC prose for forward guidance is
// exactly the guess §1 invariant 4 forbids. An analyst who judges cuts
// imminent still overrides via the manual path.
export function rbiPathFromRepoRate(db: Database.Database, asOfDate: string): RbiPath | null {
  const stance = rbiStanceFromRepoRate(db, asOfDate);
  if (stance === null) return null;
  return stance === "cutting" ? "cuts_expected" : stance === "hiking" ? "hiking" : "on_hold";
}

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

// Calculation Guide "Earnings revision breadth" (per segment) —
// equity.{large,mid,small}::revisions. Spec: upgrades/(upgrades+downgrades)
// for the segment's own constituents, percentiled AS-IS; documented
// fallback if breadth is unobtainable is "3M change in the segment index
// consensus EPS," percentiled the same way.
//
// No free source publishes either breadth or CONSENSUS EPS for any Indian
// segment (checked live 2026-09-20 — see docs/missing_data_points/
// equity-segments.md and sector-satellite.md: niftyindices/NSE publish
// trailing multiples only, TradingEconomics' consensus figures render in
// JS with no server-side rows, FMP/Twelve Data/EODHD gate Indian coverage
// behind paid tiers).
//
// DOCUMENTED SUBSTITUTE, not the spec's literal input: trailing EPS,
// derived as index close ÷ index trailing P/E, 3-month change. This is
// the SAME substitute already built and explicitly rejected for
// sector.*::revisions (see sector-satellite.md's "built, tested, and
// rejected" note) for a real reason that still applies here: trailing EPS
// moves when constituents REPORT; consensus EPS moves when analysts
// REVISE. The two can point opposite directions exactly at cycle turns —
// a segment whose earnings just collapsed shows trailing EPS falling
// (scored bearish) while analysts may already be upgrading the forward
// estimate on the turnaround. Wired anyway on explicit instruction, with
// this deviation stated on the score cell (`derivedFrom` names the raw
// legs, never a fabricated "consensus_eps" id) and on the trace — never
// silently presented as the spec's own breadth/consensus figure.
export function deriveTrailingEpsSeries(db: Database.Database, closeSeriesId: string, peSeriesId: string): Array<{ date: string; value: number }> {
  const closeRows = latestObservations(db, closeSeriesId);
  const peByDate = new Map(latestObservations(db, peSeriesId).map((r) => [r.date, r.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const row of closeRows) {
    const pe = peByDate.get(row.date);
    if (pe === undefined || pe === 0) continue;
    out.push({ date: row.date, value: row.value / pe });
  }
  return out;
}

export function deriveTrailingEps3mChangeSeries(db: Database.Database, closeSeriesId: string, peSeriesId: string): Array<{ date: string; value: number }> {
  const epsRows = deriveTrailingEpsSeries(db, closeSeriesId, peSeriesId);
  if (epsRows.length === 0) return [];
  const out: Array<{ date: string; value: number }> = [];
  for (const row of epsRows) {
    const change = trailingReturn(epsRows, row.date, 3);
    if (change === null) continue;
    out.push({ date: row.date, value: change * 100 });
  }
  return out;
}

// Calculation Guide "Earnings growth differential" (per segment) —
// equity.{mid,small}::growth_diff. Spec: "segment consensus FY+1 EPS
// growth minus Large Cap's," run through growthDiffScore()'s fixed bands.
// No free source publishes consensus FY+1 EPS growth for any Indian
// segment (same dead ends as revisions — see docs/missing_data_points/
// equity-segments.md). DOCUMENTED SUBSTITUTE: 12-MONTH (YoY, not the 3M
// window revisions uses — growth is a year-over-year concept) change in
// segment trailing EPS (close ÷ trailing P/E), MINUS the same YoY change
// in Nifty 100 (large cap) trailing EPS. Same trailing-vs-consensus
// caveat as revisions: this is reported earnings growth, not analysts'
// forward estimate, and the two can disagree at cycle turns.
export function deriveTrailingEps12mChangeSeries(db: Database.Database, closeSeriesId: string, peSeriesId: string): Array<{ date: string; value: number }> {
  const epsRows = deriveTrailingEpsSeries(db, closeSeriesId, peSeriesId);
  if (epsRows.length === 0) return [];
  const out: Array<{ date: string; value: number }> = [];
  for (const row of epsRows) {
    const change = trailingReturn(epsRows, row.date, 12);
    if (change === null) continue;
    out.push({ date: row.date, value: change * 100 });
  }
  return out;
}

export function deriveSegmentGrowthGapSeries(db: Database.Database, closeSeriesId: string, peSeriesId: string): Array<{ date: string; value: number }> {
  const segmentGrowth = deriveTrailingEps12mChangeSeries(db, closeSeriesId, peSeriesId);
  const largeGrowth = deriveTrailingEps12mChangeSeries(db, "nifty100_close", "nifty100_pe");
  const largeByDate = new Map(largeGrowth.map((r) => [r.date, r.value]));
  const out: Array<{ date: string; value: number }> = [];
  for (const row of segmentGrowth) {
    const large = largeByDate.get(row.date);
    if (large === undefined) continue;
    out.push({ date: row.date, value: row.value - large });
  }
  return out;
}

// Calculation Guide "Earnings growth differential" (International) — "US
// EPS growth minus India's," same growthDiffScore() bands, +5 structural
// INR-depreciation bonus applied on top (in scoreCells.ts, not here).
//
// TWO STACKED DEVIATIONS from the spec's consensus-FY+1 input — see
// adapters/multpl.ts's header comment for the full reasoning:
//   (1) trailing vs consensus (same class as the segment cells above)
//   (2) REAL US EPS growth (multpl.com's EPS page is inflation-adjusted)
//       vs NOMINAL India EPS growth (no deflator applied to INR values)
// Both are stated on the score cell and the trace, not just here.
export function deriveIntlGrowthGapSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const usEpsRows = latestObservations(db, "sp500_trailing_eps_real");
  const indiaGrowth = deriveTrailingEps12mChangeSeries(db, "nifty100_close", "nifty100_pe");
  if (usEpsRows.length === 0 || indiaGrowth.length === 0) return [];

  const out: Array<{ date: string; value: number }> = [];
  for (const row of indiaGrowth) {
    const usChange = trailingReturn(usEpsRows, row.date, 12);
    if (usChange === null) continue;
    out.push({ date: row.date, value: usChange * 100 - row.value });
  }
  return out;
}

// Calculation Guide "Valuation vs own history" (International) — the
// India-US valuation gap that adjusts equity.intl::valuation: "subtract
// 5-10 points if the India-US valuation gap is at an extreme favouring
// India, add if favouring US."
//
// Gap = Nifty 100 trailing P/E - S&P 500 trailing P/E, joined by
// YEAR-MONTH (the two sources publish on different days — multpl.com's
// rows are month-start-dated, niftyindices' are month-end trading days —
// so an exact-date join yields zero rows; same reasoning as
// derivedDifferenceSeries).
//
// BOTH LEGS ARE TRAILING P/E. That is the one comparison this pair can
// make honestly: sp500_trailing_pe (multpl.com) against nifty100_pe
// (niftyindices), same metric on both sides. The spec's own "India-US
// valuation gap" is a like-for-like comparison, and mixing India trailing
// against US forward would have measured the trailing-vs-forward
// methodology difference (~40% on the US leg alone, see adapters/multpl.ts)
// rather than the valuation gap.
//
// "Extreme" is resolved against the gap's OWN history rather than a fixed
// P/E-point threshold, because the level of both markets' multiples has
// drifted over the decade; see scoreCells.ts for the percentile bands
// applied to this series.
export function deriveIndiaUsValuationGapSeries(db: Database.Database): Array<{ date: string; value: number }> {
  const indiaRows = latestObservations(db, "nifty100_pe");
  const usRows = latestObservations(db, "sp500_trailing_pe");
  const usByMonth = new Map(usRows.map((r) => [r.date.slice(0, 7), r.value]));

  const out: Array<{ date: string; value: number }> = [];
  for (const india of indiaRows) {
    const us = usByMonth.get(india.date.slice(0, 7));
    if (us === undefined) continue;
    out.push({ date: india.date, value: india.value - us });
  }
  return out;
}
