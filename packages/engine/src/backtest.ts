// Backtesting a user-defined allocation of named funds against a benchmark
// index. Pure compute: this file never fetches NAV/index data itself — the
// caller (server route) resolves each leg's NAV history and the benchmark's
// index history first, then hands both in as plain date->value maps. That
// keeps this file testable against fixtures without a network, same split
// every adapter in packages/server/src/adapters already uses between parse
// and fetch.

export interface BacktestLegInput {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  date: string; // ISO yyyy-mm-dd, the lump-sum purchase date
}

// date (ISO) -> NAV or index level. Sparse is fine (weekends/holidays are
// simply absent); lookups fall back to the most recent prior date.
export type DateValueSeries = Record<string, number>;

export interface BacktestPoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  // % gain vs money invested SO FAR (not the eventual total) — a leg that
  // hasn't started yet must not depress the return of legs already live,
  // so this indexes each point against investedToDate, not totalInvested.
  portfolioReturnPct: number;
  benchmarkReturnPct: number;
}

export interface BacktestLegResult {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  date: string;
  units: number;
  entryNav: number;
  latestNav: number;
  currentValue: number;
  missingHistory: boolean; // true if no NAV was found on/after the purchase date at all
}

export interface BacktestSummary {
  totalInvested: number;
  portfolioCurrentValue: number;
  benchmarkCurrentValue: number; // what the same total, invested the same way, would be worth in the benchmark
  portfolioXirr: number | null; // annualised, as a fraction (0.12 = 12%)
  benchmarkXirr: number | null;
  portfolioCagr: number | null; // simple annualised growth from total invested to current value
  benchmarkCagr: number | null;
  absoluteReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number; // portfolio, over the backtest window
}

function cagr(invested: number, currentValue: number, years: number): number | null {
  if (invested <= 0 || currentValue < 0 || years <= 0) return null;
  if (currentValue === 0) return -1;
  const result = Math.pow(currentValue / invested, 1 / years) - 1;
  return Number.isFinite(result) ? result : null;
}

export interface BacktestResult {
  legs: BacktestLegResult[];
  series: BacktestPoint[];
  summary: BacktestSummary;
}

const sortedDates = (series: DateValueSeries): string[] => Object.keys(series).sort();

// Most recent value on or before `date`. Returns null if the series has
// nothing that early (e.g. a scheme that launched after the requested
// purchase date) — the caller surfaces this as missingHistory rather than
// silently substituting a wrong price.
function valueOnOrBefore(series: DateValueSeries, dates: string[], date: string): number | null {
  let lo = 0;
  let hi = dates.length - 1;
  let result: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! <= date) {
      result = dates[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result === null ? null : series[result]!;
}

// XIRR via Newton-Raphson on the standard NPV-of-cashflows-at-t=0 equation,
// falling back to bisection if Newton doesn't converge (it can overshoot for
// portfolios with an extreme return). cashflows: negative = money in
// (purchase), positive = money out (current value, dated today).
export function xirr(cashflows: Array<{ date: string; amount: number }>): number | null {
  if (cashflows.length < 2) return null;
  const t0 = new Date(cashflows[0]!.date).getTime();
  const years = cashflows.map((cf) => (new Date(cf.date).getTime() - t0) / (365.25 * 24 * 3600 * 1000));

  const npv = (rate: number): number => cashflows.reduce((sum, cf, i) => sum + cf.amount / Math.pow(1 + rate, years[i]!), 0);
  const dnpv = (rate: number): number =>
    cashflows.reduce((sum, cf, i) => sum - (years[i]! * cf.amount) / Math.pow(1 + rate, years[i]! + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dnpv(rate);
    if (Math.abs(df) < 1e-10) break;
    const next = rate - f / df;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }

  // Newton didn't converge cleanly (common for short windows or near-total
  // loss) — bisect over a wide, plausible annualised-return range instead of
  // reporting a garbage extrapolated rate.
  let lo = -0.999;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null; // no sign change: no real root in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (npv(lo) * fMid < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function runBacktest(
  legs: BacktestLegInput[],
  navSeriesByScheme: Record<string, DateValueSeries>,
  benchmarkSeries: DateValueSeries,
  today: string
): BacktestResult {
  const benchmarkDates = sortedDates(benchmarkSeries);

  const legResults: BacktestLegResult[] = [];
  const legUnits: Array<{ leg: BacktestLegInput; units: number; navDates: string[]; series: DateValueSeries }> = [];
  const benchmarkUnitsPerLeg: Array<{ units: number }> = [];

  for (const leg of legs) {
    const series = navSeriesByScheme[leg.schemeCode] ?? {};
    const navDates = sortedDates(series);
    const entryNav = valueOnOrBefore(series, navDates, leg.date);
    const latestNavDate = navDates[navDates.length - 1];
    const latestNav = latestNavDate ? series[latestNavDate]! : null;

    if (entryNav === null || latestNav === null) {
      legResults.push({
        sleeveId: leg.sleeveId,
        schemeCode: leg.schemeCode,
        schemeName: leg.schemeName,
        amount: leg.amount,
        date: leg.date,
        units: 0,
        entryNav: 0,
        latestNav: 0,
        currentValue: 0,
        missingHistory: true,
      });
      continue;
    }

    const units = leg.amount / entryNav;
    legResults.push({
      sleeveId: leg.sleeveId,
      schemeCode: leg.schemeCode,
      schemeName: leg.schemeName,
      amount: leg.amount,
      date: leg.date,
      units,
      entryNav,
      latestNav,
      currentValue: units * latestNav,
      missingHistory: false,
    });
    legUnits.push({ leg, units, navDates, series });

    const benchmarkEntry = valueOnOrBefore(benchmarkSeries, benchmarkDates, leg.date);
    benchmarkUnitsPerLeg.push({ units: benchmarkEntry ? leg.amount / benchmarkEntry : 0 });
  }

  // Daily portfolio value series from the earliest leg date to today, so the
  // chart shows the full ramp as legs come online rather than starting flat
  // at the last leg's date.
  const validLegDates = legUnits.map((l) => l.leg.date);
  const seriesStart = validLegDates.length > 0 ? validLegDates.reduce((min, d) => (d < min ? d : min)) : today;
  const allDates = new Set<string>([...benchmarkDates]);
  for (const l of legUnits) for (const d of l.navDates) allDates.add(d);
  const timeline = [...allDates].filter((d) => d >= seriesStart && d <= today).sort();

  const series: BacktestPoint[] = timeline.map((date) => {
    let portfolioValue = 0;
    let investedToDate = 0;
    for (const { leg, units, navDates, series: s } of legUnits) {
      if (date < leg.date) continue;
      investedToDate += leg.amount;
      const v = valueOnOrBefore(s, navDates, date);
      if (v !== null) portfolioValue += units * v;
    }
    let benchmarkValue = 0;
    for (let i = 0; i < legUnits.length; i++) {
      const leg = legUnits[i]!.leg;
      if (date < leg.date) continue;
      const bv = valueOnOrBefore(benchmarkSeries, benchmarkDates, date);
      if (bv !== null) benchmarkValue += benchmarkUnitsPerLeg[i]!.units * bv;
    }
    const portfolioReturnPct = investedToDate > 0 ? ((portfolioValue - investedToDate) / investedToDate) * 100 : 0;
    const benchmarkReturnPct = investedToDate > 0 ? ((benchmarkValue - investedToDate) / investedToDate) * 100 : 0;
    return { date, portfolioValue, benchmarkValue, portfolioReturnPct, benchmarkReturnPct };
  });

  const totalInvested = legs.reduce((sum, l) => sum + l.amount, 0);
  const portfolioCurrentValue = legResults.reduce((sum, l) => sum + l.currentValue, 0);
  const benchmarkCurrentValue = series.length > 0 ? series[series.length - 1]!.benchmarkValue : 0;

  const portfolioCashflows = [
    ...legResults.filter((l) => !l.missingHistory).map((l) => ({ date: l.date, amount: -l.amount })),
    { date: today, amount: portfolioCurrentValue },
  ];
  const benchmarkCashflows = [
    ...legResults.filter((l) => !l.missingHistory).map((l) => ({ date: l.date, amount: -l.amount })),
    { date: today, amount: benchmarkCurrentValue },
  ];

  const earliestLegDate = legs.reduce<string | null>((earliest, leg) => (!earliest || leg.date < earliest ? leg.date : earliest), null);
  const elapsedYears = earliestLegDate
    ? Math.max((new Date(today).getTime() - new Date(earliestLegDate).getTime()) / (365.25 * 24 * 3600 * 1000), 1 / 365.25)
    : 0;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of series) {
    peak = Math.max(peak, point.portfolioValue);
    if (peak > 0) {
      const drawdown = (peak - point.portfolioValue) / peak;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdown * 100);
    }
  }

  return {
    legs: legResults,
    series,
    summary: {
      totalInvested,
      portfolioCurrentValue,
      benchmarkCurrentValue,
      portfolioXirr: xirr(portfolioCashflows),
      benchmarkXirr: xirr(benchmarkCashflows),
      portfolioCagr: cagr(totalInvested, portfolioCurrentValue, elapsedYears),
      benchmarkCagr: cagr(totalInvested, benchmarkCurrentValue, elapsedYears),
      absoluteReturnPct: totalInvested > 0 ? ((portfolioCurrentValue - totalInvested) / totalInvested) * 100 : 0,
      benchmarkReturnPct: totalInvested > 0 ? ((benchmarkCurrentValue - totalInvested) / totalInvested) * 100 : 0,
      maxDrawdownPct,
    },
  };
}
