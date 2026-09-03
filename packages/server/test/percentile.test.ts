import { describe, expect, it } from "vitest";
import { percentRank, computePercentile, windowedHistory } from "../src/pipeline/percentile.js";

describe("percentRank — matches Excel PERCENTRANK semantics", () => {
  // Excel: PERCENTRANK({1,2,3,4,5}, 3) = 0.5
  it("exact match at midpoint", () => {
    expect(percentRank([1, 2, 3, 4, 5], 3)).toBeCloseTo(0.5, 6);
  });

  // Excel: PERCENTRANK({1,2,3,4,5}, 1) = 0
  it("minimum value -> 0", () => {
    expect(percentRank([1, 2, 3, 4, 5], 1)).toBe(0);
  });

  // Excel: PERCENTRANK({1,2,3,4,5}, 5) = 1
  it("maximum value -> 1", () => {
    expect(percentRank([1, 2, 3, 4, 5], 5)).toBe(1);
  });

  // Excel: PERCENTRANK({1,2,3,4,5}, 2.5) = 0.375 (interpolated)
  it("interpolates between bracketing values", () => {
    expect(percentRank([1, 2, 3, 4, 5], 2.5)).toBeCloseTo(0.375, 6);
  });

  it("value below range clamps to 0", () => {
    expect(percentRank([10, 20, 30], 5)).toBe(0);
  });

  it("value above range clamps to 1", () => {
    expect(percentRank([10, 20, 30], 100)).toBe(1);
  });

  it("single-element array returns 0.5", () => {
    expect(percentRank([42], 42)).toBe(0.5);
  });

  it("handles duplicate values", () => {
    expect(percentRank([1, 2, 2, 2, 5], 2)).toBeCloseTo(0.25, 6);
  });
});

describe("computePercentile — floor enforcement", () => {
  it("below minObservations returns insufficient_history, percentile null", () => {
    const result = computePercentile([1, 2, 3], 2, 24);
    expect(result.status).toBe("insufficient_history");
    expect(result.percentile).toBeNull();
    expect(result.observations).toBe(3);
  });

  it("at or above minObservations computes a real percentile", () => {
    const history = Array.from({ length: 24 }, (_, i) => i + 1);
    const result = computePercentile(history, 12, 24);
    expect(result.status).toBe("ok");
    expect(result.percentile).not.toBeNull();
    expect(result.percentile).toBeGreaterThan(0);
    expect(result.percentile).toBeLessThan(100);
  });
});

describe("windowedHistory — definition break clipping", () => {
  const obs = [
    { date: "2015-01-01", value: 1 },
    { date: "2018-01-01", value: 2 },
    { date: "2020-06-01", value: 3 },
    { date: "2022-01-01", value: 4 },
    { date: "2025-01-01", value: 5 },
  ];

  it("without a definition break, uses the full trailing window", () => {
    // 10y window from 2026-01-01 starts 2016-01-01; 2015-01-01 falls outside it.
    const result = windowedHistory(obs, 10, "2026-01-01", null);
    expect(result.map((o) => o.value)).toEqual([2, 3, 4, 5]);
  });

  it("with a definition break inside the window, clips to the break date", () => {
    // 10y window from 2026-01-01 -> 2016-01-01. Break at 2021-04-01 is later, so it wins.
    const result = windowedHistory(obs, 10, "2026-01-01", "2021-04-01");
    expect(result.map((o) => o.value)).toEqual([4, 5]);
  });

  it("with a definition break before the window start, the window start wins", () => {
    const result = windowedHistory(obs, 5, "2026-01-01", "2010-01-01");
    // 5y window -> 2021-01-01, later than the break, so window wins.
    expect(result.map((o) => o.value)).toEqual([4, 5]);
  });
});
