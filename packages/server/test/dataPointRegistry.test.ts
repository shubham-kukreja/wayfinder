import { describe, expect, it } from "vitest";
import { growthDiffScore, rateCycleScores, debtLiquidityScore } from "@wayfinder/engine";
import { readFileSync } from "node:fs";
import { DATA_POINT_REGISTRY } from "../src/dataPointRegistry.js";

const baseline = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));

const constants = DATA_POINT_REGISTRY.filter((e) => e.updateType === "constant");
const rubricPickers = DATA_POINT_REGISTRY.filter((e) => e.updateType === "opt_in");

describe("structural constants — §7 cells that describe the instrument class, not a market view", () => {
  it("covers exactly the four cells the engine declares static for this reason", () => {
    // debt.corporate::spread_cushion is deliberately EXCLUDED (it is a real
    // signal blocked on the missing aaa_3y source), as is
    // metals.silver::industrial (silver genuinely tracks an industrial
    // cycle). Both would be wrong to freeze as constants.
    // debt.{liquid,gilt,corporate}::liquidity moved OUT of this set
    // 2026-09-20 — the spec is "set-and-forget EXCEPT IN STRESS", and once
    // debtLiquidityUi wires a real stress override these are a rubric
    // picker (see below), not a pure constant.
    expect(constants.map((e) => e.id).sort()).toEqual([
      "debt.gilt::spread_cushion",
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

describe("rubric-picker cells (§8.7) — a real rubric with no automatic feed", () => {
  it("includes the debt rate-cycle trio alongside the sector cycle-position rubrics", () => {
    expect(rubricPickers.map((e) => e.id)).toEqual(
      expect.arrayContaining(["debt.gilt::rate_cycle", "debt.corporate::rate_cycle", "debt.liquid::rate_cycle"])
    );
  });

  it("labels the rate-cycle trio as analyst-owned, not a plain manual number box", () => {
    for (const id of ["debt.gilt::rate_cycle", "debt.corporate::rate_cycle", "debt.liquid::rate_cycle"]) {
      const entry = DATA_POINT_REGISTRY.find((e) => e.id === id);
      expect(entry?.updateType).toBe("opt_in");
      expect(entry?.owner).toBe("investment_team");
      expect(entry?.source).toBe("Analyst rubric (no feed answers it)");
    }
  });

  it("still has no auto-wired derivation for the rate-cycle trio (the rubric answers a FORWARD question no feed settles)", () => {
    // rbiPathFromRepoRate() only reads REALISED repo_rate direction for
    // l1.debt::macro's 3-bucket rbiPath. This rubric needs a 5-bucket
    // FORWARD magnitude read (>50bp vs 25-50bp expected) that only
    // OIS-implied pricing or an analyst's own guidance read can answer.
    for (const id of ["debt.gilt::rate_cycle", "debt.corporate::rate_cycle", "debt.liquid::rate_cycle"]) {
      const entry = DATA_POINT_REGISTRY.find((e) => e.id === id);
      expect(entry?.updateType).not.toBe("derived");
    }
  });

  it("matches the engine's rate-cycle table on the worked example (on_hold -> 50/50/55)", () => {
    expect(rateCycleScores("on_hold")).toEqual({ gilt: 50, corporate: 50, liquid: 55 });
  });

  it("includes the debt liquidity trio, labelled analyst-owned like rate-cycle", () => {
    for (const id of ["debt.gilt::liquidity", "debt.corporate::liquidity", "debt.liquid::liquidity"]) {
      const entry = DATA_POINT_REGISTRY.find((e) => e.id === id);
      expect(entry?.updateType).toBe("opt_in");
      expect(entry?.owner).toBe("investment_team");
      expect(entry?.source).toBe("Analyst rubric (no feed answers it)");
    }
  });

  it("reproduces the frozen baseline exactly when the analyst picks 'Normal' (90/65/75)", () => {
    expect(debtLiquidityScore("liquid", false)).toBe(90);
    expect(debtLiquidityScore("corporate", false)).toBe(65);
    expect(debtLiquidityScore("gilt", false)).toBe(75);
  });

  it("applies the stress override exactly as the spec's worked example states (corporate -> 40, liquid/gilt -> 50)", () => {
    expect(debtLiquidityScore("liquid", true)).toBe(50);
    expect(debtLiquidityScore("corporate", true)).toBe(40);
    expect(debtLiquidityScore("gilt", true)).toBe(50);
  });
});
