import { describe, expect, it } from "vitest";
import { growthDiffScore } from "@wayfinder/engine";
import { readFileSync } from "node:fs";
import { DATA_POINT_REGISTRY } from "../src/dataPointRegistry.js";

const baseline = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));

const constants = DATA_POINT_REGISTRY.filter((e) => e.updateType === "constant");

describe("structural constants — §7 cells that describe the instrument class, not a market view", () => {
  it("covers exactly the seven cells the engine declares static for this reason", () => {
    // debt.corporate::spread_cushion is deliberately EXCLUDED (it is a real
    // signal blocked on the missing aaa_3y source), as is
    // metals.silver::industrial (silver genuinely tracks an industrial
    // cycle). Both would be wrong to freeze as constants.
    expect(constants.map((e) => e.id).sort()).toEqual([
      "debt.corporate::liquidity",
      "debt.gilt::liquidity",
      "debt.gilt::spread_cushion",
      "debt.liquid::liquidity",
      "debt.liquid::spread_cushion",
      "equity.large::growth_diff",
      "metals.gold::industrial",
    ]);
  });

  it("is reviewed annually by the model admin, not quarterly by the investment team", () => {
    for (const entry of constants) {
      expect(entry.frequency).toBe("annual");
      expect(entry.owner).toBe("model_admin");
    }
  });

  it("matches the engine's own debt liquidity baselines rather than the demo's numbers", () => {
    // If rubrics.ts's DEBT_LIQUIDITY_BASELINE ever changes, the baseline
    // values these cells serve must change with it — otherwise the Control
    // Center would present a stale constant as authoritative.
    expect(baseline.scores["debt.liquid::liquidity"].value).toBe(90);
    expect(baseline.scores["debt.gilt::liquidity"].value).toBe(75);
    expect(baseline.scores["debt.corporate::liquidity"].value).toBe(65);
  });

  it("scores large-cap growth differential at 50, the value rubrics.ts documents", () => {
    // rubrics.ts and rubricUi.ts both state "large cap is always 50" — it is
    // the baseline every other segment's growth gap is measured against, so
    // its own gap is zero by construction. The demo baseline shipped 45,
    // which silently contradicted that; corrected 2026-09-17.
    expect(baseline.scores["equity.large::growth_diff"].value).toBe(50);
    // A zero gap through the actual rubric agrees.
    expect(growthDiffScore(0, "mid")).toBe(50);
  });

  it("scores the spread-cushion constants at neutral, which is correct by definition", () => {
    // Neither liquid funds nor sovereign gilts carry meaningful credit
    // spread, so there is no cushion to score — 50 here is the right
    // answer, not an unfilled placeholder.
    expect(baseline.scores["debt.liquid::spread_cushion"].value).toBe(50);
    expect(baseline.scores["debt.gilt::spread_cushion"].value).toBe(50);
  });
});
