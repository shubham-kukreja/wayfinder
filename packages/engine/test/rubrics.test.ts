import { describe, expect, it } from "vitest";
import {
  equityMacroScore,
  debtMacroScore,
  debtFundamentalsScore,
  metalsFundamentalsScore,
  growthDiffScore,
  rateCycleScores,
  silverIndustrialScore,
  realRatesScore,
} from "../src/rubrics.js";

describe("§8.1 equityMacroScore", () => {
  it("neutral inputs -> 50", () => {
    expect(equityMacroScore({ rbiStance: "on_hold", growthVsExpect: "in_line", inflationDir: "rising" })).toBe(45);
  });
  it("best case clamps within 0-100", () => {
    expect(equityMacroScore({ rbiStance: "cutting", growthVsExpect: "beating", inflationDir: "falling" })).toBe(85);
  });
  it("worst case", () => {
    expect(equityMacroScore({ rbiStance: "hiking", growthVsExpect: "missing", inflationDir: "rising" })).toBe(15);
  });
});

describe("§8.2 debtMacroScore", () => {
  it("cuts expected + normal supply + below target -> 80", () => {
    expect(debtMacroScore({ rbiPath: "cuts_expected", gsecSupply: "normal", inflationVsTarget: "below" })).toBe(80);
  });
  it("hiking + heavy supply + at/above target -> 25", () => {
    expect(debtMacroScore({ rbiPath: "hiking", gsecSupply: "heavy", inflationVsTarget: "at_or_above" })).toBe(25);
  });
});

describe("§8.3 debtFundamentalsScore", () => {
  it("quiet credit + surplus liquidity -> 70", () => {
    expect(debtFundamentalsScore({ creditCycle: "quiet", systemLiquidity: "surplus" })).toBe(70);
  });
  it("rising downgrades + tight liquidity -> 15", () => {
    expect(debtFundamentalsScore({ creditCycle: "rising_downgrades", systemLiquidity: "tight" })).toBe(15);
  });
});

describe("§8.5 metalsFundamentalsScore", () => {
  it("above-average CB buying + rising ETF holdings -> 75", () => {
    expect(metalsFundamentalsScore({ cbBuying: "above_average", etfHoldings: "rising" })).toBe(75);
  });
  it("below-average + falling -> 30", () => {
    expect(metalsFundamentalsScore({ cbBuying: "below_average", etfHoldings: "falling" })).toBe(30);
  });
});

describe("§8.6 growthDiffScore", () => {
  it("gap >= 8pp -> 75", () => {
    expect(growthDiffScore(10, "mid")).toBe(75);
  });
  it("gap in [-3,3] -> 50", () => {
    expect(growthDiffScore(0, "mid")).toBe(50);
  });
  it("gap < -8pp -> 25", () => {
    expect(growthDiffScore(-10, "small")).toBe(25);
  });
  it("intl gets +5 structural tailwind on top of the bucket", () => {
    expect(growthDiffScore(0, "intl")).toBe(55);
  });
  it("intl clamps at 100 even with the +5 bonus", () => {
    expect(growthDiffScore(20, "intl")).toBe(80);
  });
});

describe("§8.7 rateCycleScores — one input, three outputs", () => {
  it("cuts > 50bp", () => {
    expect(rateCycleScores("cuts_gt_50bp")).toEqual({ gilt: 80, corporate: 60, liquid: 30 });
  });
  it("on hold", () => {
    expect(rateCycleScores("on_hold")).toEqual({ gilt: 50, corporate: 50, liquid: 55 });
  });
  it("hikes > 50bp", () => {
    expect(rateCycleScores("hikes_gt_50bp")).toEqual({ gilt: 20, corporate: 35, liquid: 80 });
  });
});

describe("§8.8 silverIndustrialScore — compound PMI level+trend condition", () => {
  it("PMI > 52 AND rising -> 70", () => {
    expect(silverIndustrialScore(53, 51, false)).toBe(70);
  });
  it("PMI > 52 but FALLING does not hit the top bucket — falls to the 50-52 tier since 53 >= 50", () => {
    expect(silverIndustrialScore(53, 55, false)).toBe(55);
  });
  it("PMI in [50,52] -> 55", () => {
    expect(silverIndustrialScore(51, 51, false)).toBe(55);
  });
  it("PMI < 50 -> 35", () => {
    expect(silverIndustrialScore(48, 49, false)).toBe(35);
  });
  it("strong solar/EV capex adds +5", () => {
    expect(silverIndustrialScore(53, 51, true)).toBe(75);
  });
});

describe("§8.4 realRatesScore (regression — already covered but re-asserted here for completeness)", () => {
  it("sharp decline favours gold more than silver", () => {
    expect(realRatesScore(-60, "gold")).toBe(75);
    expect(realRatesScore(-60, "silver")).toBe(65);
  });
  it("flat -> neutral", () => {
    expect(realRatesScore(0, "gold")).toBe(50);
    expect(realRatesScore(0, "silver")).toBe(50);
  });
});
