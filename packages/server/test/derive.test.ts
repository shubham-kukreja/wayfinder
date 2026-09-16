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
  deriveMidLargeSpreadSeries,
  deriveSmallLargeSpreadSeries,
  deriveSectorRelMomentumSeries,
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

// Calculation Guide (docs/MultiAsset_Allocation_Framework_v2...xlsx,
// "Calculation Guide" sheet, row 23) — the spec's own rule for this
// signal: "Global gold ETF holdings rising 3M: +10; falling: -10." A
// plain direction comparison, current vs. ~3 months prior, no percentile
// or magnitude threshold specified.
describe("goldEtfHoldingsTrend — §8.5 (Calculation Guide row 23) rising/falling bucket", () => {
  it("returns null when there's no gold_etf_shares_outstanding history at all", () => {
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBeNull();
  });

  it("returns null when there's a current observation but nothing ~3 months prior yet", () => {
    seed("gold_etf_shares_outstanding", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBeNull();
  });

  it("returns 'rising' when the current value is higher than ~3 months ago", () => {
    seed("gold_etf_shares_outstanding", "2026-06-01", 1_100_000_000);
    seed("gold_etf_shares_outstanding", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("rising");
  });

  it("returns 'falling' when the current value is lower than ~3 months ago", () => {
    seed("gold_etf_shares_outstanding", "2026-06-01", 1_200_000_000);
    seed("gold_etf_shares_outstanding", "2026-09-01", 1_100_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("falling");
  });

  it("treats an unchanged value as 'rising' (>=, not strictly >)", () => {
    seed("gold_etf_shares_outstanding", "2026-06-01", 1_200_000_000);
    seed("gold_etf_shares_outstanding", "2026-09-01", 1_200_000_000);
    expect(goldEtfHoldingsTrend(db, "2026-09-15")).toBe("rising");
  });

  it("uses the closest observation at or before the 3-months-ago mark, not an exact-date match", () => {
    // Observation landed a few days before the exact 3-month mark —
    // same "closest prior observation" tolerance usReal10y6mChangeBp uses.
    seed("gold_etf_shares_outstanding", "2026-05-28", 1_000_000_000);
    seed("gold_etf_shares_outstanding", "2026-09-01", 1_200_000_000);
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
    expect(result).toEqual([{ date: "2026-01-15", value: 5 - 6.75 }]);
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
