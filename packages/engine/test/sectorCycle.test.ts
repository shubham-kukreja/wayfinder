import { describe, expect, it } from "vitest";
import { sectorCyclePositionScore, RUBRIC_UI_BY_SCORE_ID } from "../src/index.js";

// Calculation Guide, SECTOR SATELLITE "Cycle position": start 50;
// turning up +15; mid-cycle 0; late-cycle -15; regulatory/disruption
// overhang -10. The worked example is Capital Goods at 65 ("private
// capex turning up, utilization high").
describe("sectorCyclePositionScore — the workbook's table", () => {
  it("matches the spec's own worked example (capex turning up -> 65)", () => {
    expect(sectorCyclePositionScore({ stage: "turning_up", overhang: "none" })).toBe(65);
  });

  it("scores each stage, and stacks the overhang on top", () => {
    expect(sectorCyclePositionScore({ stage: "mid_cycle", overhang: "none" })).toBe(50);
    expect(sectorCyclePositionScore({ stage: "late_cycle", overhang: "none" })).toBe(35);
    // Overhang is additive to the stage, not an alternative to it.
    expect(sectorCyclePositionScore({ stage: "late_cycle", overhang: "regulatory_or_disruption" })).toBe(25);
  });

  it("exposes a picker for all 8 sectors", () => {
    for (const s of ["banking", "it", "pharma", "auto", "capgoods", "fmcg", "energy", "metals"]) {
      const spec = RUBRIC_UI_BY_SCORE_ID[`sector.${s}::cycle_position`];
      expect(spec).toBeDefined();
      expect(spec!.evaluate({ stage: "turning_up", overhang: "none" })).toEqual({ [`sector.${s}::cycle_position`]: 65 });
    }
  });
});
