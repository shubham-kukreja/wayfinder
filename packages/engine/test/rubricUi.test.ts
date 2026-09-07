import { describe, expect, it } from "vitest";
import { RUBRIC_UI_BY_SCORE_ID } from "../src/rubricUi.js";
import { SCORE_PROVENANCE } from "../src/scoreProvenance.js";

const RUBRIC_SCORE_IDS = Object.entries(SCORE_PROVENANCE)
  .filter(([, provenance]) => provenance === "rubric")
  .map(([id]) => id);

describe("RUBRIC_UI_BY_SCORE_ID — completeness against scoreProvenance.ts", () => {
  it("every score marked 'rubric' provenance has a picker UI spec", () => {
    const missing = RUBRIC_SCORE_IDS.filter((id) => !(id in RUBRIC_UI_BY_SCORE_ID));
    // Some rubric-provenance cells (l1.metals::macro, metals.*::real_rates)
    // are driven by an AUTO series (§8.4's real-rates table fed by FRED),
    // not a manual picker — those are intentionally excluded from the UI
    // spec since there's nothing for a user to pick.
    const expectedNoPicker = ["l1.metals::macro", "metals.gold::real_rates", "metals.silver::real_rates"];
    const unexpectedlyMissing = missing.filter((id) => !expectedNoPicker.includes(id));
    expect(unexpectedlyMissing).toEqual([]);
  });

  it("every registered spec's evaluate() returns null on an incomplete selection", () => {
    for (const spec of new Set(Object.values(RUBRIC_UI_BY_SCORE_ID))) {
      expect(spec.evaluate({})).toBeNull();
    }
  });

  it("every registered spec's fields all have at least 2 options", () => {
    for (const spec of new Set(Object.values(RUBRIC_UI_BY_SCORE_ID))) {
      for (const field of spec.fields) {
        expect(field.options.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("RUBRIC_UI_BY_SCORE_ID — evaluation matches the real rubric functions", () => {
  it("l1.equity::macro: best-case selection matches equityMacroScore's best case", () => {
    const spec = RUBRIC_UI_BY_SCORE_ID["l1.equity::macro"]!;
    const result = spec.evaluate({ rbiStance: "cutting", growthVsExpect: "beating", inflationDir: "falling" });
    expect(result).toEqual({ "l1.equity::macro": 85 });
  });

  it("debt rate-cycle: one selection drives all 3 score cells consistently with rateCycleScores()", () => {
    const spec = RUBRIC_UI_BY_SCORE_ID["debt.gilt::rate_cycle"]!;
    expect(spec).toBe(RUBRIC_UI_BY_SCORE_ID["debt.corporate::rate_cycle"]); // same spec object
    expect(spec).toBe(RUBRIC_UI_BY_SCORE_ID["debt.liquid::rate_cycle"]);

    const result = spec.evaluate({ path: "cuts_gt_50bp" });
    expect(result).toEqual({
      "debt.gilt::rate_cycle": 80,
      "debt.corporate::rate_cycle": 60,
      "debt.liquid::rate_cycle": 30,
    });
  });

  it("equity.intl::growth_diff includes the +5 structural tailwind", () => {
    const spec = RUBRIC_UI_BY_SCORE_ID["equity.intl::growth_diff"]!;
    const result = spec.evaluate({ gapPp: "0" });
    expect(result).toEqual({ "equity.intl::growth_diff": 55 }); // 50 base + 5 intl bonus
  });

  it("metals.silver::industrial: high-and-rising PMI + strong capex hits the top bucket plus bonus", () => {
    const spec = RUBRIC_UI_BY_SCORE_ID["metals.silver::industrial"]!;
    const result = spec.evaluate({ pmiLevel: "high_rising", capexNewsflow: "strong" });
    expect(result).toEqual({ "metals.silver::industrial": 75 }); // 70 + 5
  });
});
