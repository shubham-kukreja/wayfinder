import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/backtest.js";

describe("backtest performance metrics", () => {
  it("indexes each chart point against capital invested by that date", () => {
    const result = runBacktest(
      [
        { sleeveId: "equity.large", schemeCode: "a", schemeName: "A", amount: 100, date: "2024-01-01" },
        { sleeveId: "debt.liquid", schemeCode: "b", schemeName: "B", amount: 100, date: "2024-01-02" },
      ],
      {
        a: { "2024-01-01": 10, "2024-01-02": 11 },
        b: { "2024-01-01": 20, "2024-01-02": 20 },
      },
      { "2024-01-01": 100, "2024-01-02": 110 },
      "2024-01-02"
    );

    expect(result.series[0]).toMatchObject({ date: "2024-01-01", portfolioReturnPct: 0, benchmarkReturnPct: 0 });
    expect(result.series[1]!.portfolioReturnPct).toBeCloseTo(5, 8);
    expect(result.series[1]!.benchmarkReturnPct).toBeCloseTo(5, 8);
  });

  it("reports simple CAGR separately from money-weighted XIRR", () => {
    const result = runBacktest(
      [{ sleeveId: "equity.large", schemeCode: "a", schemeName: "A", amount: 100, date: "2020-01-01" }],
      { a: { "2020-01-01": 10, "2021-01-01": 12.1 } },
      { "2020-01-01": 100, "2021-01-01": 110 },
      "2021-01-01"
    );

    expect(result.summary.portfolioCagr).toBeCloseTo(0.21, 2);
    expect(result.summary.benchmarkCagr).toBeCloseTo(0.1, 2);
    expect(result.summary.portfolioXirr).not.toBeNull();
  });
});
