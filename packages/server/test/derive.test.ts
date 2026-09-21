import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import {
  goldEtfHoldingsTrend,
  niftyTriApprox12mReturn,
  deriveNiftyMomentumSeries,
  centralBankGoldBuyingTrend,
  deriveEarningsYieldGapSeries,
  deriveRealGoldPriceSeries,
  deriveCpiYoySeries,
  cpiIndexSpliced,
  deriveGoldReturn12mSeries,
  goldParabolic6mReturn,
  deriveMidLargeSpreadSeries,
  deriveSmallLargeSpreadSeries,
  deriveSectorRelMomentumSeries,
  deriveFlowRatio3mSeries,
  deriveNiftyPeSeries,
  rbiStanceFromRepoRate,
  inflationDirFromCpi,
  deriveUsReal10y6mChangeSeries,
  usReal10y6mChangeBp,
  deriveTrailingEpsSeries,
  deriveTrailingEps3mChangeSeries,
  deriveTrailingEps12mChangeSeries,
  deriveSegmentGrowthGapSeries,
  deriveIntlGrowthGapSeries,
} from "../src/pipeline/derive.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function seed(seriesId: string, date: string, value: number) {
  insertObservations(db, [{ seriesId, date, value, basis: null, source: "YAHOO_METALS", fetchedAt: "2026-09-15T00:00:00Z" }]);
}

describe("US 10Y real yield six-month change — l1.metals::macro", () => {
  it("anchors the six-month comparison to the current observation date, not the later as-of date", () => {
    seed("us_real_10y", "2026-03-17", 1.8);
    seed("us_real_10y", "2026-03-18", 2.2);
    seed("us_real_10y", "2026-09-17", 1.5);

    // Current is Sep 17, so the correct comparison is Mar 17: 1.50 -
    // 1.80 = -0.30 percentage points = -30bp. Anchoring the lookback to
    // the Sep 19 as-of date would incorrectly pick Mar 18 and report -70bp.
    expect(usReal10y6mChangeBp(db, "2026-09-19")).toBeCloseTo(-30, 10);
    const series = deriveUsReal10y6mChangeSeries(db);
    expect(series[series.length - 1]).toEqual({ date: "2026-09-17", value: expect.closeTo(-30, 10) });
  });

  it("returns null until a genuine six-month comparison exists", () => {
    seed("us_real_10y", "2026-09-17", 1.5);
    expect(usReal10y6mChangeBp(db, "2026-09-19")).toBeNull();
  });
});

// Calculation Guide (docs/MultiAsset_Allocation_Framework_v2...xlsx,
// "Calculation Guide" sheet, row 23) — the spec's own rule for this
// signal: "Global gold ETF holdings rising 3M: +10; falling: -10." A
// plain direction comparison, current vs. ~3 months prior, no percentile
// or magnitude threshold specified.
describe("goldEtfHoldingsTrend — §8.5 (Calculation Guide row 23) rising/falling bucket", () => {
  it("returns null when there's no gold_etf_tonnes history at all", () => {
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBeNull();
  });

  it("returns null when there's a current observation but nothing ~3 months prior yet", () => {
    seed("gold_etf_tonnes", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBeNull();
  });

  it("returns 'rising' when the current value is higher than ~3 months ago", () => {
    seed("gold_etf_tonnes", "2026-06-01", 1_100_000_000);
    seed("gold_etf_tonnes", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("rising");
  });

  it("returns 'falling' when the current value is lower than ~3 months ago", () => {
    seed("gold_etf_tonnes", "2026-06-01", 1_200_000_000);
    seed("gold_etf_tonnes", "2026-09-01", 1_100_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("falling");
  });

  it("treats an unchanged value as 'rising' (>=, not strictly >)", () => {
    seed("gold_etf_tonnes", "2026-06-01", 1_200_000_000);
    seed("gold_etf_tonnes", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("rising");
  });

  it("uses the closest observation at or before the 3-months-ago mark, not an exact-date match", () => {
    // Observation landed a few days before the exact 3-month mark —
    // same "closest prior observation" tolerance usReal10y6mChangeBp uses.
    seed("gold_etf_tonnes", "2026-05-28", 1_000_000_000);
    seed("gold_etf_tonnes", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("rising");
  });
});

// No real Nifty 50 TRI source was found free (confirmed live 2026-09-15
// — see the function's own doc comment in derive.ts). Approximates it as
// 12M price return * (1 + trailing Div Yield) - 1, using nifty50_close
// and nifty50_div_yield (both from adapters/niftyindices.ts's Daily
// Snapshot CSV). Deliberately NOT claimed as an exact match to AMFI's
// published TRI 1Y return — a single point-in-time yield applied across
// the whole 12-month window is an approximation, not a reconstruction.
describe("niftyTriApprox12mReturn — Nifty 50 TRI 12M-return approximation (price return + trailing div yield)", () => {
  it("returns null when there's no nifty50_close history at all", () => {
    expect(niftyTriApprox12mReturn(db, "2026-09-15")).toBeNull();
  });

  it("returns null when close history exists but div yield history doesn't", () => {
    seed("nifty50_close", "2025-09-01", 22000);
    seed("nifty50_close", "2026-09-01", 25000);
    expect(niftyTriApprox12mReturn(db, "2026-09-15")).toBeNull();
  });

  it("returns null when there's no close observation ~12 months prior yet", () => {
    seed("nifty50_close", "2026-09-01", 25000);
    seed("nifty50_div_yield", "2026-09-01", 1.2);
    expect(niftyTriApprox12mReturn(db, "2026-09-15")).toBeNull();
  });

  it("computes price return * (1 + div yield decimal) - 1, matching the hand-verified worked example", () => {
    seed("nifty50_close", "2025-09-01", 22000);
    seed("nifty50_close", "2026-09-01", 25000);
    seed("nifty50_div_yield", "2026-09-01", 1.2); // stored as raw percentage, not decimal

    const result = niftyTriApprox12mReturn(db, "2026-09-15");
    expect(result).not.toBeNull();
    // price return = 25000/22000 - 1 = 13.636...%; TRI approx = 1.13636 * 1.012 - 1 = 15.0%
    expect(result! * 100).toBeCloseTo(15.0, 1);
  });

  it("TRI approximation return is always higher than plain price return (dividend yield adds, never subtracts here)", () => {
    seed("nifty50_close", "2025-09-01", 22000);
    seed("nifty50_close", "2026-09-01", 25000);
    seed("nifty50_div_yield", "2026-09-01", 1.2);

    const triReturn = niftyTriApprox12mReturn(db, "2026-09-15")!;
    const priceReturn = 25000 / 22000 - 1;
    expect(triReturn).toBeGreaterThan(priceReturn);
  });

  it("uses the closest observation at or before the 12-months-ago mark, not an exact-date match", () => {
    seed("nifty50_close", "2025-08-20", 22000); // a bit more than 12 months before asOfDate
    seed("nifty50_close", "2026-09-01", 25000);
    seed("nifty50_div_yield", "2026-09-01", 1.2);
    expect(niftyTriApprox12mReturn(db, "2026-09-15")).not.toBeNull();
  });
});

// §8.1 (Calculation Guide row 11) — l1.equity::momentum's raw input
// series: "Nifty 50 total-return 12M % minus 10Y G-sec yield," built for
// EVERY date with enough trailing history, not just "today" — this is
// what autoScoreFromSeries (scoreCells.ts) percentiles to produce the
// actual score.
describe("deriveNiftyMomentumSeries — the full excess-return history behind l1.equity::momentum", () => {
  function seedMonthlyClose(startYear: number, months: number, monthlyValues: number[]) {
    for (let i = 0; i < months; i++) {
      const monthIdx = i;
      const year = startYear + Math.floor(monthIdx / 12);
      const month = (monthIdx % 12) + 1;
      seed("nifty50_close", `${year}-${String(month).padStart(2, "0")}-01`, monthlyValues[i]!);
    }
  }

  it("returns an empty array when any of the three required series is missing", () => {
    seed("nifty50_close", "2025-01-01", 20000);
    seed("nifty50_div_yield", "2025-01-01", 1.2);
    // no gsec_10y seeded at all
    expect(deriveNiftyMomentumSeries(db)).toEqual([]);
  });

  it("produces one observation per date once 12 months of trailing close history + a matching gsec_10y month exist", () => {
    // 24 months of close data, flat div yield, flat gsec yield — just
    // proving the series GENERATES entries, not testing exact values here.
    seedMonthlyClose(2024, 24, Array.from({ length: 24 }, (_, i) => 20000 + i * 100));
    for (let i = 0; i < 24; i++) {
      const year = 2024 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      seed("nifty50_div_yield", `${year}-${String(month).padStart(2, "0")}-01`, 1.2);
      seed("gsec_10y", `${year}-${String(month).padStart(2, "0")}-15`, 6.75); // different day-of-month than close, proves month-join
    }

    const series = deriveNiftyMomentumSeries(db);
    // First 12 months have no 12-months-prior close yet -> skipped.
    // Months 13-24 (index 12-23) should each produce one observation.
    expect(series.length).toBe(12);
  });

  it("computes excess return as (TRI return * 100) - gsec yield for that month", () => {
    seed("nifty50_close", "2024-09-01", 20000);
    seed("nifty50_close", "2025-09-01", 23000); // 15% price return over the year
    seed("nifty50_div_yield", "2025-09-01", 1.0); // 1% trailing div yield
    seed("gsec_10y", "2025-09-15", 6.75);

    const series = deriveNiftyMomentumSeries(db);
    expect(series.length).toBe(1);
    // TRI return = 1.15 * 1.01 - 1 = 0.1615 -> 16.15%; excess = 16.15 - 6.75 = 9.4
    expect(series[0]!.value).toBeCloseTo(9.4, 1);
    expect(series[0]!.date).toBe("2025-09-01");
  });
});

// §8.5 (Calculation Guide row 23) — "central-bank buying running above 5Y
// average: +15; below: -10." cb_gold_reserves_tonnes is a STOCK series
// (total reserves), so "buying" is derived as month-over-month change,
// then trailing-12M average pace compared to trailing-5Y (60-month)
// average pace.
describe("centralBankGoldBuyingTrend — §8.5 (Calculation Guide row 23) above/below 5Y average buying pace", () => {
  function seedMonthlyReserves(startYear: number, months: number, values: number[]) {
    for (let i = 0; i < months; i++) {
      const year = startYear + Math.floor(i / 12);
      const month = (i % 12) + 1;
      seed("cb_gold_reserves_tonnes", `${year}-${String(month).padStart(2, "0")}-01`, values[i]!);
    }
  }

  it("returns null with fewer than 2 observations (can't compute even one month-over-month change)", () => {
    seed("cb_gold_reserves_tonnes", "2026-01-01", 35000);
    expect(centralBankGoldBuyingTrend(db, "2026-09-15")).toBeNull();
  });

  it("returns 'above_average' when recent 12M buying pace exceeds the trailing 5Y pace", () => {
    // 72 months (6 years) of reserves: flat for the first 60 months (net
    // purchases ~0/month), then a sharp acceleration in the most recent
    // 12 months (+50 tonnes/month) — recent pace should clearly exceed
    // the 5Y trailing average pace.
    const values: number[] = [];
    let level = 30000;
    for (let i = 0; i < 60; i++) {
      values.push(level);
      level += 1; // negligible early drift
    }
    for (let i = 0; i < 12; i++) {
      level += 50; // sharp recent acceleration
      values.push(level);
    }
    seedMonthlyReserves(2020, 72, values);

    expect(centralBankGoldBuyingTrend(db, "2026-09-15")).toBe("above_average");
  });

  it("returns 'below_average' when recent 12M buying pace is slower than the trailing 5Y pace", () => {
    // Strong buying for the first 60 months, then a sharp slowdown
    // (near-zero net purchases) in the most recent 12 months.
    const values: number[] = [];
    let level = 30000;
    for (let i = 0; i < 60; i++) {
      level += 50;
      values.push(level);
    }
    for (let i = 0; i < 12; i++) {
      level += 1; // sharp recent slowdown
      values.push(level);
    }
    seedMonthlyReserves(2020, 72, values);

    expect(centralBankGoldBuyingTrend(db, "2026-09-15")).toBe("below_average");
  });

  it("uses whatever history is available when fewer than 60 months exist, rather than requiring the full 5Y window", () => {
    // Only 13 months of data — recent12 and trailing60 both draw from
    // the same short window (slice(-N) naturally caps at what exists),
    // so this should still compute rather than returning null.
    const values = Array.from({ length: 13 }, (_, i) => 30000 + i * 10);
    seedMonthlyReserves(2025, 13, values);

    expect(centralBankGoldBuyingTrend(db, "2026-09-15")).not.toBeNull();
  });
});

// Calculation Guide row 7 — l1.equity::valuation: "Earnings-yield gap =
// (100 / Nifty 50 trailing P/E) − 10Y G-sec yield."
describe("deriveEarningsYieldGapSeries — §8.1 (Calculation Guide row 7) earnings-yield gap history", () => {
  it("returns an empty array when either series is missing", () => {
    expect(deriveEarningsYieldGapSeries(db)).toEqual([]);
    seed("nifty50_pe", "2026-01-01", 22);
    expect(deriveEarningsYieldGapSeries(db)).toEqual([]);
  });

  it("computes (100 / P/E) - gsec yield for each month both series share", () => {
    seed("nifty50_pe", "2026-01-15", 20); // 100/20 = 5
    seed("gsec_10y", "2026-01-01", 6.75);
    const result = deriveEarningsYieldGapSeries(db);
    // Each row also carries the two readings behind its value, with
    // their OWN dates — the join is by month, so the P/E's day and the
    // yield's day differ. A trace cannot recover these afterwards.
    expect(result).toEqual([
      {
        date: "2026-01-15",
        value: 5 - 6.75,
        pe: 20,
        peDate: "2026-01-15",
        gsec: 6.75,
        gsecDate: "2026-01-01",
      },
    ]);
  });

  it("skips a P/E row when no gsec_10y reading exists for that year-month", () => {
    seed("nifty50_pe", "2026-01-15", 20);
    seed("gsec_10y", "2026-02-01", 6.75);
    expect(deriveEarningsYieldGapSeries(db)).toEqual([]);
  });
});

// Calculation Guide row 21 — l1.metals::valuation: real INR gold price
// (gold_inr deflated by CPI index), percentile vs history, INVERTED.
describe("deriveRealGoldPriceSeries — §8.4 (Calculation Guide row 21) real gold price history", () => {
  it("returns an empty array when either series is missing", () => {
    expect(deriveRealGoldPriceSeries(db)).toEqual([]);
    seed("gold_inr", "2026-01-01", 65000);
    expect(deriveRealGoldPriceSeries(db)).toEqual([]);
  });

  it("computes gold_inr / cpi_index for each month both series share", () => {
    seed("gold_inr", "2026-01-15", 65000);
    seed("cpi_index", "2026-01-01", 185);
    expect(deriveRealGoldPriceSeries(db)).toEqual([{ date: "2026-01-15", value: 65000 / 185 }]);
  });

  it("falls back to gold_usd_futures x usd_inr when gold_inr is too short to percentile", () => {
    // IBJA spot has no historical endpoint, so gold_inr never reaches the
    // 24-observation floor on its own; the synthetic INR level does.
    seed("gold_inr", "2026-01-15", 65000);
    for (let i = 0; i < 30; i++) {
      const y = 2024 + Math.floor(i / 12);
      const m = String((i % 12) + 1).padStart(2, "0");
      seed("gold_usd_futures", `${y}-${m}-01`, 2000 + i * 10);
      seed("usd_inr", `${y}-${m}-01`, 85);
      seed("cpi_index", `${y}-${m}-01`, 150);
    }
    const out = deriveRealGoldPriceSeries(db);
    expect(out.length).toBeGreaterThanOrEqual(24);
    // (gold in USD x FX) / CPI, not the 3-observation IBJA path.
    expect(out[0]!.value).toBeCloseTo((2000 * 85) / 150, 6);
  });
});

describe("deriveRealGoldPriceSeries - month collapsing and gap filling", () => {
  function seedGold(date: string, value: number) {
    insertObservations(db, [
      { seriesId: "gold_usd_futures", date, value, basis: null, source: "YAHOO_METALS", fetchedAt: "2026-09-19T00:00:00Z" },
    ]);
  }
  function seedFx(date: string, value: number) {
    insertObservations(db, [
      { seriesId: "usd_inr", date, value, basis: null, source: "FRED", fetchedAt: "2026-09-19T00:00:00Z" },
    ]);
  }
  function seedCpi(month: string, value: number) {
    insertObservations(db, [
      { seriesId: "cpi_index", date: `${month}-01`, value, basis: null, source: "FRED", fetchedAt: "2026-09-19T00:00:00Z" },
    ]);
  }

  it("emits ONE row per month, taking the last observation in each", () => {
    // The gold series mixes a monthly backfill with a daily top-up. Left
    // uncollapsed, a month with 20 daily rows would outvote a month with
    // one, silently reweighting the percentile toward the present.
    seedCpi("2026-01", 100);
    seedCpi("2026-02", 100);
    seedFx("2026-01-01", 80);
    for (const d of ["2026-01-05", "2026-01-15", "2026-01-30"]) seedGold(d, 1000);
    for (const d of ["2026-02-03", "2026-02-27"]) seedGold(d, 2000);

    const out = deriveRealGoldPriceSeries(db);
    expect(out.map((o) => o.date)).toEqual(["2026-01-30", "2026-02-27"]);
    // Last-in-month, deflated: 2000 * 80 / 100.
    expect(out[1]!.value).toBeCloseTo(1600, 10);
  });

  it("reaches a month that only the DAILY rows cover", () => {
    // The live regression: Yahoo's 1mo preset had no Feb or Mar 2026
    // point, so the CPI join died at January and froze the cell on what
    // looked like an all-time high. February actually closed HIGHER.
    seedCpi("2026-01", 100);
    seedCpi("2026-02", 100);
    seedFx("2026-01-01", 80);
    seedGold("2026-01-01", 1000); // monthly-style row
    seedGold("2026-02-27", 1200); // daily-only month

    const out = deriveRealGoldPriceSeries(db);
    expect(out.map((o) => o.date.slice(0, 7))).toEqual(["2026-01", "2026-02"]);
  });

  it("stops where the legs last OVERLAP, not at either leg's own latest", () => {
    // Gold runs past CPI; the real series must end at the last month
    // BOTH cover, and that is the date the cell is computed for.
    seedCpi("2026-01", 100);
    seedFx("2026-01-01", 80);
    seedGold("2026-01-30", 1000);
    seedGold("2026-05-30", 1500); // no CPI for May

    const out = deriveRealGoldPriceSeries(db);
    expect(out[out.length - 1]!.date.slice(0, 7)).toBe("2026-01");
  });
});

describe("goldParabolic6mReturn - §9 veto.parabolic", () => {
  function seedMonths(seriesId: string, values: number[], startYear: number) {
    insertObservations(
      db,
      values.map((v, i) => {
        const y = startYear + Math.floor(i / 12);
        const m = String((i % 12) + 1).padStart(2, "0");
        return { seriesId, date: `${y}-${m}-01`, value: v, basis: null, source: "YAHOO_METALS", fetchedAt: "2026-09-19T00:00:00Z" };
      })
    );
  }

  it("measures the 6-month INR return and fires above the 40% threshold", () => {
    // Flat for a year, then +50% over six months.
    seedMonths("gold_usd_futures", [...Array(12).fill(1000), 1100, 1200, 1300, 1400, 1450, 1500], 2025);
    seedMonths("usd_inr", Array(18).fill(80), 2025);
    const ret = goldParabolic6mReturn(db, "2026-06-30");
    expect(ret).toBeCloseTo(0.5, 10);
    expect(ret! > 0.4).toBe(true);
  });

  it("does NOT fire on a move below the threshold", () => {
    seedMonths("gold_usd_futures", [...Array(12).fill(1000), 1050, 1080, 1100, 1120, 1150, 1200], 2025);
    seedMonths("usd_inr", Array(18).fill(80), 2025);
    const ret = goldParabolic6mReturn(db, "2026-06-30");
    expect(ret).toBeCloseTo(0.2, 10);
    expect(ret! > 0.4).toBe(false);
  });

  it("includes the currency move, so an INR spike can fire on flat USD gold", () => {
    // USD gold dead flat; the rupee collapses. An Indian holder DID see
    // a parabolic move, and a USD-only reading would have missed it.
    seedMonths("gold_usd_futures", Array(18).fill(1000), 2025);
    seedMonths("usd_inr", [...Array(12).fill(80), 88, 96, 104, 110, 116, 120], 2025);
    const ret = goldParabolic6mReturn(db, "2026-06-30");
    expect(ret).toBeCloseTo(0.5, 10);
  });

  it("returns null without enough history rather than a quiet 'not triggered'", () => {
    seedMonths("gold_usd_futures", [1000, 1100], 2026);
    seedMonths("usd_inr", [80, 80], 2026);
    expect(goldParabolic6mReturn(db, "2026-02-28")).toBeNull();
  });
});

describe("deriveGoldReturn12mSeries - INR denomination", () => {
  function seedMonths(seriesId: string, values: number[], startYear: number) {
    insertObservations(
      db,
      values.map((v, i) => {
        const y = startYear + Math.floor(i / 12);
        const m = String((i % 12) + 1).padStart(2, "0");
        return { seriesId, date: `${y}-${m}-01`, value: v, basis: null, source: "YAHOO_METALS", fetchedAt: "2026-09-19T00:00:00Z" };
      })
    );
  }

  it("includes the INR/USD move, not just the USD gold move", () => {
    // USD gold +10% over 12 months; rupee weakens 20%. The INR return is
    // the compounded 1.1 x 1.2 - 1 = 32%, NOT 10%.
    seedMonths("gold_usd_futures", [1000, ...Array(11).fill(1000), 1100], 2025);
    seedMonths("usd_inr", [80, ...Array(11).fill(80), 96], 2025);
    const out = deriveGoldReturn12mSeries(db);
    expect(out[out.length - 1]!.value).toBeCloseTo(0.32, 10);
  });
});

describe("deriveCpiYoySeries — 12-month change in cpi_index", () => {
  it("returns an empty array without a 12-months-prior month to compare to", () => {
    seed("cpi_index", "2026-01-01", 110);
    expect(deriveCpiYoySeries(db)).toEqual([]);
  });

  it("computes the year-on-year percentage change", () => {
    seed("cpi_index", "2025-01-01", 100);
    seed("cpi_index", "2026-01-01", 106);
    expect(deriveCpiYoySeries(db)).toEqual([{ date: "2026-01-01", value: 6 }]);
  });

  it("skips a month whose prior-year counterpart is missing rather than interpolating", () => {
    seed("cpi_index", "2025-01-01", 100);
    seed("cpi_index", "2026-01-01", 106);
    seed("cpi_index", "2026-02-01", 107); // no 2025-02 to compare against
    expect(deriveCpiYoySeries(db).map((o) => o.date)).toEqual(["2026-01-01"]);
  });

  it("uses only the longest single-base run when two sources disagree on index base", () => {
    // FRED publishes cpi_index on Index 2015=100; the RBI mirror uses a
    // later base. Concatenating them would fabricate a ~34% deflation.
    for (let i = 0; i < 24; i++) {
      const y = 2024 + Math.floor(i / 12);
      const m = String((i % 12) + 1).padStart(2, "0");
      insertObservations(db, [
        { seriesId: "cpi_index", date: `${y}-${m}-01`, value: 150 + i, basis: null, source: "FRED", fetchedAt: "2026-01-01T00:00:00Z" },
      ]);
    }
    insertObservations(db, [
      { seriesId: "cpi_index", date: "2026-03-01", value: 104.84, basis: null, source: "RBI", fetchedAt: "2026-01-01T00:00:00Z" },
    ]);
    // The lone RBI point on the other base must not appear as a crash
    // from ~173 down to ~105.
    for (const o of deriveCpiYoySeries(db)) expect(o.value).toBeGreaterThan(-50);
  });
});

describe("cpiIndexSpliced - rebasing FRED and RBI onto one scale", () => {
  function seedSource(source: string, months: string[], values: number[], fetchedAt: string) {
    insertObservations(
      db,
      months.map((m, i) => ({
        seriesId: "cpi_index",
        date: `${m}-01`,
        value: values[i]!,
        basis: null,
        source,
        fetchedAt,
      }))
    );
  }

  it("splices on genuinely overlapping months instead of discarding the shorter run", () => {
    // FRED on ~150 base through 2025-03; RBI on ~100 base from 2025-01.
    // They share 2025-01..03, so the factor is measurable: 1.5.
    // FRED is the LONGER run (as live), so it is the base whose scale
    // everything else is rebased onto.
    seedSource(
      "FRED",
      ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03"],
      [147, 148.5, 149, 150, 151.5, 153],
      "2026-01-01T00:00:00Z"
    );
    // RBI fetched LATER, which is what previously hid the overlap.
    seedSource("RBI", ["2025-01", "2025-02", "2025-03", "2025-04"], [100, 101, 102, 103], "2026-02-01T00:00:00Z");

    const out = cpiIndexSpliced(db);
    expect(out.baseSource).toBe("FRED");
    expect(out.overlapMonths).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(out.factor).toBeCloseTo(1.5, 10);

    // The RBI-only month is carried over REBASED, not at its raw 103.
    const april = out.rows.find((r) => r.date.startsWith("2025-04"))!;
    expect(april.value).toBeCloseTo(103 * 1.5, 10);

    // On a shared month the base's own reading wins - no second value.
    expect(out.rows.filter((r) => r.date.startsWith("2025-01")).length).toBe(1);
    expect(out.rows.find((r) => r.date.startsWith("2025-01"))!.value).toBe(150);

    // And the spliced level must never appear to collapse.
    for (let i = 1; i < out.rows.length; i++) {
      const change = out.rows[i]!.value / out.rows[i - 1]!.value - 1;
      expect(Math.abs(change)).toBeLessThan(0.1);
    }
  });

  it("extends coverage to the newer source's latest month", () => {
    // The live regression: deflation stopped at FRED's last month, so
    // l1.metals::valuation percentiled a Nov-2024 gold price and
    // reported staleDays 687 while newer CPI sat unused in the store.
    seedSource(
      "FRED",
      ["2024-10", "2024-11", "2024-12", "2025-01", "2025-02"],
      [147, 148.5, 149, 150, 151.5],
      "2026-01-01T00:00:00Z"
    );
    seedSource("RBI", ["2025-01", "2025-02", "2025-03", "2025-04"], [100, 101, 102, 103], "2026-02-01T00:00:00Z");

    const out = cpiIndexSpliced(db);
    expect(out.rows[out.rows.length - 1]!.date).toBe("2025-04-01");
  });

  it("falls back to the longest single run when there is NO overlap", () => {
    // The original no-overlap reasoning still holds: with nothing shared,
    // any factor would be a guess, so the other source is dropped rather
    // than concatenated at the wrong scale.
    seedSource("FRED", ["2024-01", "2024-02", "2024-03"], [150, 151, 152], "2026-01-01T00:00:00Z");
    seedSource("RBI", ["2026-03"], [104.84], "2026-02-01T00:00:00Z");

    const out = cpiIndexSpliced(db);
    expect(out.factor).toBeNull();
    expect(out.overlapMonths).toEqual([]);
    expect(out.rows.length).toBe(3);
    expect(out.rows.some((r) => r.date.startsWith("2026-03"))).toBe(false);
  });
});

describe("deriveGoldReturn12mSeries — trailing 12M return behind l1.metals::momentum", () => {
  it("returns an empty array without 12 months of history", () => {
    seed("gold_usd_futures", "2026-01-01", 2000);
    expect(deriveGoldReturn12mSeries(db)).toEqual([]);
  });

  it("computes the 12-month return as a fraction, matching trailingReturn's convention", () => {
    // A fraction, not percent — the other trailing-return derivations
    // here use the same convention, and the value only ever feeds a
    // percentile, which is scale-invariant either way.
    //
    // FX held FLAT so this isolates the gold move: the series is now
    // INR-denominated (gold_usd_futures x usd_inr), so a constant rate
    // makes the INR return equal the USD return and the 0.2 convention
    // this test exists to pin stays directly checkable.
    seed("gold_usd_futures", "2025-01-01", 2000);
    seed("gold_usd_futures", "2026-01-01", 2400);
    seed("usd_inr", "2025-01-01", 80);
    seed("usd_inr", "2026-01-01", 80);
    const out = deriveGoldReturn12mSeries(db);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe("2026-01-01");
    expect(out[0]!.value).toBeCloseTo(0.2, 6);
  });

  it("returns empty when the currency leg is missing rather than silently using USD", () => {
    seed("gold_usd_futures", "2025-01-01", 2000);
    seed("gold_usd_futures", "2026-01-01", 2400);
    expect(deriveGoldReturn12mSeries(db)).toEqual([]);
  });
});

// Data Trackers rows 5-8 / Calculation Guide row 29 —
// equity.{large,mid,small}::relvalue spread series.
describe("deriveMidLargeSpreadSeries / deriveSmallLargeSpreadSeries — §7.2 P/E spread history", () => {
  it("returns an empty array when either series is missing", () => {
    expect(deriveMidLargeSpreadSeries(db)).toEqual([]);
    expect(deriveSmallLargeSpreadSeries(db)).toEqual([]);
  });

  it("computes mid/small P/E minus large P/E for each shared date", () => {
    seed("midcap150_pe", "2026-01-15", 33.1);
    seed("smallcap250_pe", "2026-01-15", 30.2);
    seed("nifty100_pe", "2026-01-15", 22.5);

    expect(deriveMidLargeSpreadSeries(db)).toEqual([{ date: "2026-01-15", value: 33.1 - 22.5 }]);
    expect(deriveSmallLargeSpreadSeries(db)).toEqual([{ date: "2026-01-15", value: 30.2 - 22.5 }]);
  });

  it("skips a date with no matching large-cap P/E reading", () => {
    seed("midcap150_pe", "2026-01-15", 33.1);
    expect(deriveMidLargeSpreadSeries(db)).toEqual([]);
  });
});

// Calculation Guide "Earnings revision breadth" (per segment) — documented
// trailing-EPS substitute for equity.{large,mid,small}::revisions.
describe("deriveTrailingEpsSeries / deriveTrailingEps3mChangeSeries — segment revisions proxy", () => {
  it("returns an empty array when either series is missing", () => {
    expect(deriveTrailingEpsSeries(db, "nifty100_close", "nifty100_pe")).toEqual([]);
    seed("nifty100_close", "2026-01-15", 22000);
    expect(deriveTrailingEpsSeries(db, "nifty100_close", "nifty100_pe")).toEqual([]);
  });

  it("computes trailing EPS as close / P/E for each shared date", () => {
    seed("nifty100_close", "2026-01-15", 22500);
    seed("nifty100_pe", "2026-01-15", 22.5);
    expect(deriveTrailingEpsSeries(db, "nifty100_close", "nifty100_pe")).toEqual([{ date: "2026-01-15", value: 1000 }]);
  });

  it("computes the 3-month % change in trailing EPS, as a percentage", () => {
    seed("nifty100_close", "2025-10-15", 20000);
    seed("nifty100_pe", "2025-10-15", 20);
    seed("nifty100_close", "2026-01-15", 22500);
    seed("nifty100_pe", "2026-01-15", 22.5);
    // Trailing EPS: 1000 -> 1000 (unchanged, despite close and P/E both moving)
    const series = deriveTrailingEps3mChangeSeries(db, "nifty100_close", "nifty100_pe");
    expect(series).toEqual([{ date: "2026-01-15", value: 0 }]);
  });

  it("reflects a real trailing-EPS move over 3 months", () => {
    seed("nifty100_close", "2025-10-15", 20000);
    seed("nifty100_pe", "2025-10-15", 20); // EPS 1000
    seed("nifty100_close", "2026-01-15", 21000);
    seed("nifty100_pe", "2026-01-15", 20); // EPS 1050, +5%
    const series = deriveTrailingEps3mChangeSeries(db, "nifty100_close", "nifty100_pe");
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-01-15");
    expect(series[0]!.value).toBeCloseTo(5, 9);
  });
});

// Calculation Guide "Earnings growth differential" — documented
// trailing-EPS-YoY substitute for equity.{mid,small,intl}::growth_diff.
describe("deriveTrailingEps12mChangeSeries / deriveSegmentGrowthGapSeries / deriveIntlGrowthGapSeries — growth differential proxy", () => {
  it("computes the 12-month % change in trailing EPS, as a percentage", () => {
    seed("midcap150_close", "2025-01-15", 30000);
    seed("midcap150_pe", "2025-01-15", 30); // EPS 1000
    seed("midcap150_close", "2026-01-15", 34500);
    seed("midcap150_pe", "2026-01-15", 30); // EPS 1150, +15%
    const series = deriveTrailingEps12mChangeSeries(db, "midcap150_close", "midcap150_pe");
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-01-15");
    expect(series[0]!.value).toBeCloseTo(15, 9);
  });

  it("computes the segment's 12M EPS growth minus Large cap's, on shared dates", () => {
    seed("nifty100_close", "2025-01-15", 20000);
    seed("nifty100_pe", "2025-01-15", 20); // EPS 1000
    seed("nifty100_close", "2026-01-15", 21200);
    seed("nifty100_pe", "2026-01-15", 20); // EPS 1060, +6%
    seed("midcap150_close", "2025-01-15", 30000);
    seed("midcap150_pe", "2025-01-15", 30); // EPS 1000
    seed("midcap150_close", "2026-01-15", 34500);
    seed("midcap150_pe", "2026-01-15", 30); // EPS 1150, +15%

    const series = deriveSegmentGrowthGapSeries(db, "midcap150_close", "midcap150_pe");
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-01-15");
    // Mid +15% minus Large +6% = +9pp
    expect(series[0]!.value).toBeCloseTo(9, 6);
  });

  it("returns an empty array when the large-cap leg is missing", () => {
    seed("midcap150_close", "2025-01-15", 30000);
    seed("midcap150_pe", "2025-01-15", 30);
    seed("midcap150_close", "2026-01-15", 34500);
    seed("midcap150_pe", "2026-01-15", 30);
    expect(deriveSegmentGrowthGapSeries(db, "midcap150_close", "midcap150_pe")).toEqual([]);
  });

  it("computes US real EPS growth minus India nominal EPS growth", () => {
    seed("sp500_trailing_eps_real", "2025-01-15", 200);
    seed("sp500_trailing_eps_real", "2026-01-15", 220); // +10%
    seed("nifty100_close", "2025-01-15", 20000);
    seed("nifty100_pe", "2025-01-15", 20); // EPS 1000
    seed("nifty100_close", "2026-01-15", 21200);
    seed("nifty100_pe", "2026-01-15", 20); // EPS 1060, +6%

    const series = deriveIntlGrowthGapSeries(db);
    expect(series).toHaveLength(1);
    expect(series[0]!.date).toBe("2026-01-15");
    // US +10% minus India +6% = +4pp
    expect(series[0]!.value).toBeCloseTo(4, 6);
  });

  it("returns an empty array when the US EPS series is missing", () => {
    seed("nifty100_close", "2025-01-15", 20000);
    seed("nifty100_pe", "2025-01-15", 20);
    seed("nifty100_close", "2026-01-15", 21200);
    seed("nifty100_pe", "2026-01-15", 20);
    expect(deriveIntlGrowthGapSeries(db)).toEqual([]);
  });
});

// Calculation Guide row 48 — sector.*::rel_momentum: average of the
// sector index's 6M and 12M return minus Nifty's over the same windows.
describe("deriveSectorRelMomentumSeries — §7.5 sector relative momentum history", () => {
  it("returns an empty array when either series is missing", () => {
    expect(deriveSectorRelMomentumSeries(db, "sector_close_banking")).toEqual([]);
    seed("sector_close_banking", "2026-01-01", 100);
    expect(deriveSectorRelMomentumSeries(db, "sector_close_banking")).toEqual([]);
  });

  it("computes the average of 6M and 12M relative return once both windows have trailing history", () => {
    // Sector: +20% over 12M, +10% over 6M. Nifty: +10% over 12M, +5% over 6M.
    seed("sector_close_banking", "2025-01-15", 100); // 12M ago
    seed("sector_close_banking", "2025-07-15", 109); // 6M ago
    seed("sector_close_banking", "2026-01-15", 120); // now

    seed("nifty50_close", "2025-01-15", 100);
    seed("nifty50_close", "2025-07-15", 105);
    seed("nifty50_close", "2026-01-15", 110);

    const result = deriveSectorRelMomentumSeries(db, "sector_close_banking");
    const last = result[result.length - 1]!;
    expect(last.date).toBe("2026-01-15");

    const sector12m = 120 / 100 - 1; // 0.20
    const sector6m = 120 / 109 - 1; // ~0.1009
    const nifty12m = 110 / 100 - 1; // 0.10
    const nifty6m = 110 / 105 - 1; // ~0.0476
    const expected = (sector6m - nifty6m + (sector12m - nifty12m)) / 2;
    expect(last.value).toBeCloseTo(expected, 10);
  });

  // Regression test for a real perf bug: the original implementation
  // called a per-date O(n) filter/pop lookup once per row in the FULL
  // history, making the whole derivation O(n^2). With niftyindices' real
  // backfill producing 500+ daily rows per sector, that measured multiple
  // SECONDS per sector and made every /api/snapshot request (which
  // recomputes all 8 sectors via computeAutoScoreCells) take ~3s —
  // discovered via a browser smoke test where the app never left its
  // "Loading…" state. Fixed with a binary-search lookup
  // (lastRowAtOrBefore); this test fails on a slow re-regression before
  // it fails on a hang.
  it("stays fast (well under 1s) with 2 years of dense daily history, not O(n^2) on row count", () => {
    const start = new Date("2024-01-01T00:00:00Z");
    const sectorRows = Array.from({ length: 730 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { seriesId: "sector_close_banking", date: d.toISOString().slice(0, 10), value: 100 * Math.pow(1.0005, i), basis: null, source: "NIFTYINDICES", fetchedAt: "2026-09-15T00:00:00Z" };
    });
    const niftyRows = Array.from({ length: 730 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return { seriesId: "nifty50_close", date: d.toISOString().slice(0, 10), value: 100 * Math.pow(1.0003, i), basis: null, source: "NIFTYINDICES", fetchedAt: "2026-09-15T00:00:00Z" };
    });
    insertObservations(db, sectorRows);
    insertObservations(db, niftyRows);

    const t0 = Date.now();
    const result = deriveSectorRelMomentumSeries(db, "sector_close_banking");
    const elapsedMs = Date.now() - t0;

    expect(result.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

// §7.1 — "3-month average of total active fund net flows (AMFI) as % of
// AUM." The averaging step lives in the pipeline, NOT the adapter: the
// stored `flow_equity_3m` series holds a SINGLE month's flow despite its
// name (adapters/amfi.ts maps it straight from AMFI's monthly sub-total).
describe("deriveFlowRatio3mSeries — §7.1 3-month average of flows as % of AUM", () => {
  function seedFlow(seriesId: string, date: string, value: number) {
    insertObservations(db, [{ seriesId, date, value, basis: null, source: "AMFI", fetchedAt: "2026-09-15T00:00:00Z" }]);
  }

  it("returns [] when either input series is empty", () => {
    expect(deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity")).toEqual([]);
    seedFlow("flow_equity_3m", "2024-01-01", 1000);
    expect(deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity")).toEqual([]);
  });

  it("averages the trailing 3 months of FLOW, then divides by that date's AUM", () => {
    seedFlow("flow_equity_3m", "2024-01-01", 300);
    seedFlow("flow_equity_3m", "2024-02-01", 600);
    seedFlow("flow_equity_3m", "2024-03-01", 900);
    for (const d of ["2024-01-01", "2024-02-01", "2024-03-01"]) seedFlow("aum_equity", d, 10000);

    const result = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    // Only ONE row: the first two months have no full 3M window behind them.
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2024-03-01");
    // mean(300, 600, 900) = 600; 600 / 10000 = 0.06
    expect(result[0]!.value).toBeCloseTo(0.06, 10);
  });

  it("drops the leading rows rather than averaging a partial window", () => {
    for (let i = 1; i <= 5; i++) seedFlow("flow_equity_3m", `2024-0${i}-01`, 100 * i);
    for (let i = 1; i <= 5; i++) seedFlow("aum_equity", `2024-0${i}-01`, 10000);

    const result = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    expect(result.map((r) => r.date)).toEqual(["2024-03-01", "2024-04-01", "2024-05-01"]);
    // mean(100,200,300)=200 -> 0.02 ; mean(200,300,400)=300 -> 0.03 ; mean(300,400,500)=400 -> 0.04
    expect(result.map((r) => r.value)).toEqual([0.02, 0.03, 0.04]);
  });

  it("damps a one-month spike to a third of its raw size (the point of the 3M step)", () => {
    seedFlow("flow_equity_3m", "2024-01-01", 100);
    seedFlow("flow_equity_3m", "2024-02-01", 100);
    seedFlow("flow_equity_3m", "2024-03-01", 1000); // spike
    for (const d of ["2024-01-01", "2024-02-01", "2024-03-01"]) seedFlow("aum_equity", d, 10000);

    const result = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    // Raw ratio would be 1000/10000 = 0.10; smoothed is (1200/3)/10000 = 0.04.
    expect(result[0]!.value).toBeCloseTo(0.04, 10);
  });

  it("joins AUM by month, so a mid-month AUM publication date still matches", () => {
    seedFlow("flow_equity_3m", "2024-01-01", 300);
    seedFlow("flow_equity_3m", "2024-02-01", 300);
    seedFlow("flow_equity_3m", "2024-03-01", 300);
    seedFlow("aum_equity", "2024-03-28", 10000); // published on the 28th, not the 1st

    const result = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    expect(result).toHaveLength(1);
    expect(result[0]!.value).toBeCloseTo(0.03, 10);
  });

  it("skips dates whose AUM is missing or zero rather than dividing by zero", () => {
    for (let i = 1; i <= 4; i++) seedFlow("flow_equity_3m", `2024-0${i}-01`, 300);
    seedFlow("aum_equity", "2024-03-01", 0); // zero -> skipped
    seedFlow("aum_equity", "2024-04-01", 10000); // month 4 is fine

    const result = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    expect(result.map((r) => r.date)).toEqual(["2024-04-01"]);
  });
});

// Calculation Guide row 7, part (b) — the half of l1.equity::valuation
// that was missing until now: the raw Nifty P/E history, percentiled and
// INVERTED by the caller.
describe("deriveNiftyPeSeries — §8.1 (Calculation Guide row 7) part (b) input", () => {
  it("returns [] when nifty50_pe has no observations", () => {
    expect(deriveNiftyPeSeries(db)).toEqual([]);
  });

  it("passes the raw P/E history through unchanged", () => {
    insertObservations(db, [
      { seriesId: "nifty50_pe", date: "2024-01-01", value: 22.5, basis: null, source: "NSE", fetchedAt: "2026-09-15T00:00:00Z" },
      { seriesId: "nifty50_pe", date: "2024-02-01", value: 23.5, basis: null, source: "NSE", fetchedAt: "2026-09-15T00:00:00Z" },
    ]);
    expect(deriveNiftyPeSeries(db)).toEqual([
      { date: "2024-01-01", value: 22.5 },
      { date: "2024-02-01", value: 23.5 },
    ]);
  });

  it("drops non-positive P/E rows (a zero would make 100/PE infinite in part (a) and is meaningless in part (b))", () => {
    insertObservations(db, [
      { seriesId: "nifty50_pe", date: "2024-01-01", value: 0, basis: null, source: "NSE", fetchedAt: "2026-09-15T00:00:00Z" },
      { seriesId: "nifty50_pe", date: "2024-02-01", value: 23.5, basis: null, source: "NSE", fetchedAt: "2026-09-15T00:00:00Z" },
    ]);
    expect(deriveNiftyPeSeries(db).map((r) => r.date)).toEqual(["2024-02-01"]);
  });
});

// §8.1 — the equityMacroScore rubric's rbiStance input. The rubric's
// wording is "RBI cutting or clearly about to cut: +20 / on hold,
// neutral: +0 / hiking or hawkish: -20"; this helper implements the
// rate-move half and deliberately leaves the forward-looking
// "about to cut"/"hawkish" half to the analyst, so a bank that has only
// SIGNALLED a cut reads as on_hold here rather than being awarded +20
// on a scrape's reading of tone.
describe("rbiStanceFromRepoRate — §8.1 rbiStance from a 6-month repo-rate move", () => {
  it("returns null when there's no repo_rate history at all", () => {
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBeNull();
  });

  it("returns null when there's a current reading but nothing 6 months back yet", () => {
    seed("repo_rate", "2026-09-01", 5.25);
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBeNull();
  });

  // The real 2025 RBI easing cycle, as mirrored by BIS/WS_CBPOL/M.IN
  // (confirmed live 2026-09-19): 6.5 held through January, then 6.25 in
  // February, 6.0 in April, 5.5 in June.
  it("returns 'cutting' across a genuine easing cycle", () => {
    seed("repo_rate", "2025-01-01", 6.5);
    seed("repo_rate", "2025-02-01", 6.25);
    seed("repo_rate", "2025-04-01", 6.0);
    seed("repo_rate", "2025-06-01", 5.5);
    expect(rbiStanceFromRepoRate(db, "2025-07-01")).toBe("cutting");
  });

  it("returns 'hiking' when the rate is above where it was 6 months ago", () => {
    seed("repo_rate", "2026-03-01", 5.25);
    seed("repo_rate", "2026-09-01", 5.75);
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBe("hiking");
  });

  it("returns 'on_hold' when the rate is unchanged over the window", () => {
    seed("repo_rate", "2026-03-01", 5.25);
    seed("repo_rate", "2026-09-01", 5.25);
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBe("on_hold");
  });

  // A 3-month window would read this same easing cycle as "on hold"
  // purely because no MPC meeting cut inside it — the reason the
  // lookback is 6 months and not shorter. The cut here lands in April,
  // five months back: inside the 6-month window but well outside a
  // 3-month one, and the rate has been flat ever since.
  it("still sees a cut that happened early in the 6-month window", () => {
    seed("repo_rate", "2026-03-01", 5.5); // the 6-months-ago baseline
    seed("repo_rate", "2026-04-01", 5.25); // the cut
    seed("repo_rate", "2026-09-01", 5.25); // flat since
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBe("cutting");
  });

  // Observations dated after asOfDate must not leak into a historical
  // recomputation — the same as-of discipline every other helper here uses.
  it("ignores observations dated after asOfDate", () => {
    seed("repo_rate", "2026-01-01", 5.25);
    seed("repo_rate", "2026-07-01", 5.25);
    seed("repo_rate", "2026-12-01", 4.5);
    expect(rbiStanceFromRepoRate(db, "2026-07-15")).toBe("on_hold");
  });

  // The real store's actual shape on 2026-09-19: BIS's mirrored history
  // ends 2025-06 (5.5) while rbi.org.in's widget reads 5.25 today, with
  // a ~15-month hole between. Comparing across that gap yields "cutting"
  // — true over 15 months, but flatly wrong about current policy, which
  // has been four consecutive HOLDS. The window must be roughly six
  // months or the stance is unknowable, not guessable.
  it("returns null rather than comparing across a multi-year gap in the series", () => {
    seed("repo_rate", "2025-06-01", 5.5);
    seed("repo_rate", "2026-09-19", 5.25);
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBeNull();
  });

  it("still accepts a baseline that is merely lagging, not abandoned", () => {
    // 8 months back: older than the 6-month mark, well inside the
    // 12-month staleness bound — normal monthly-publication lag.
    seed("repo_rate", "2026-01-01", 5.5);
    seed("repo_rate", "2026-09-01", 5.25);
    expect(rbiStanceFromRepoRate(db, "2026-09-19")).toBe("cutting");
  });
});

// §8.1 — the rubric's inflationDir input ("falling toward target: +5;
// rising: -5"). Compared over 6 months rather than month-over-month:
// monthly CPI is seasonal enough that a single print routinely flips a
// MoM sign, and the rubric asks about direction of travel.
describe("inflationDirFromCpi — §8.1 inflationDir from a 6-month cpi_yoy move", () => {
  it("returns null when there's no inflation history at all", () => {
    expect(inflationDirFromCpi(db, "2026-09-19")).toBeNull();
  });

  it("returns null when there's a current reading but nothing 6 months back", () => {
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBeNull();
  });

  it("returns 'falling' when YoY inflation is below where it was 6 months ago", () => {
    seed("cpi_yoy", "2026-03-01", 6.1);
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("falling");
  });

  // India's real August 2026 print (4.82%, up from 4.44% in July) against
  // a lower reading 6 months prior.
  it("returns 'rising' when YoY inflation is above where it was 6 months ago", () => {
    seed("cpi_yoy", "2026-03-01", 3.4);
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("rising");
  });

  // The rubric defines no neutral case — it is falling (+5) or rising
  // (-5). Dead-flat resolves to the conservative side rather than
  // inventing a third bucket the rubric doesn't have.
  it("treats dead-flat inflation as 'rising', the rubric's conservative side", () => {
    seed("cpi_yoy", "2026-03-01", 4.5);
    seed("cpi_yoy", "2026-09-01", 4.5);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("rising");
  });

  // cpi_yoy has two populating paths (RBI's directly-fetched print and
  // the FRED-backed deriveCpiYoySeries reconstruction). A directly
  // fetched print must win on any shared month, same as l1.debt::valuation.
  it("prefers a directly fetched cpi_yoy print over the derived reconstruction for the same month", () => {
    // cpi_index that would reconstruct to a FALLING path...
    seed("cpi_index", "2025-03-01", 100);
    seed("cpi_index", "2026-03-01", 110); // derived 2026-03 YoY = +10%
    seed("cpi_index", "2025-09-01", 100);
    seed("cpi_index", "2026-09-01", 102); // derived 2026-09 YoY = +2%  -> falling
    // ...but the published prints say otherwise, and they win.
    seed("cpi_yoy", "2026-03-01", 3.4);
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("rising");
  });

  it("falls back to the derived cpi_index reconstruction when no direct print exists", () => {
    seed("cpi_index", "2025-03-01", 100);
    seed("cpi_index", "2026-03-01", 110); // 2026-03 YoY = +10%
    seed("cpi_index", "2025-09-01", 100);
    seed("cpi_index", "2026-09-01", 102); // 2026-09 YoY = +2%
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("falling");
  });

  it("ignores observations dated after asOfDate", () => {
    seed("cpi_yoy", "2026-01-01", 4.5);
    seed("cpi_yoy", "2026-07-01", 4.5);
    seed("cpi_yoy", "2026-12-01", 2.0);
    expect(inflationDirFromCpi(db, "2026-07-15")).toBe("rising");
  });

  // Same window discipline as the repo-rate stance: a baseline that is
  // merely "at least six months old" can be years old, and a direction
  // measured across an unknown window is a different statistic.
  it("returns null rather than comparing across a multi-year gap in the series", () => {
    seed("cpi_yoy", "2024-01-01", 6.1);
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBeNull();
  });

  it("still accepts a baseline that is merely lagging, not abandoned", () => {
    seed("cpi_yoy", "2026-01-01", 6.1);
    seed("cpi_yoy", "2026-09-01", 4.82);
    expect(inflationDirFromCpi(db, "2026-09-19")).toBe("falling");
  });
});
