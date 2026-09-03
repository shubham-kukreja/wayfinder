import { describe, expect, it } from "vitest";
import { computeAllocation } from "../src/compute.js";
import { DEFAULT_PARAMS, TILT_GROUP_NODES } from "../src/constants.js";
import { L1_SIGNALS, EQUITY_SIGNALS, DEBT_SIGNALS, METALS_SIGNALS, SECTOR_SIGNALS } from "../src/types.js";
import { SECTOR_NODES } from "../src/constants.js";
import type { Scores } from "../src/types.js";

function allFiftyScores(): Scores {
  const scores: Scores = {};
  for (const nodeId of TILT_GROUP_NODES.l1) for (const s of L1_SIGNALS) scores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.equity) for (const s of EQUITY_SIGNALS) scores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.debt) for (const s of DEBT_SIGNALS) scores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.metals) for (const s of METALS_SIGNALS) scores[`${nodeId}::${s}`] = 50;
  for (const nodeId of SECTOR_NODES) for (const s of SECTOR_SIGNALS) scores[`${nodeId}::${s}`] = 50;
  return scores;
}

describe("§1 invariant 1 — all scores = 50 returns exactly neutral weights", () => {
  const scores = allFiftyScores();
  const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);

  it("l1 group finals equal neutral weights", () => {
    for (const nodeId of TILT_GROUP_NODES.l1) {
      const node = allocation.groups.l1.nodes[nodeId]!;
      expect(node.final).toBeCloseTo(node.neutral, 10);
      expect(node.tilt).toBeCloseTo(0, 10);
    }
  });

  it("equity group finals equal neutral weights", () => {
    for (const nodeId of TILT_GROUP_NODES.equity) {
      const node = allocation.groups.equity.nodes[nodeId]!;
      expect(node.final).toBeCloseTo(node.neutral, 10);
    }
  });

  it("debt group finals equal neutral weights", () => {
    for (const nodeId of TILT_GROUP_NODES.debt) {
      const node = allocation.groups.debt.nodes[nodeId]!;
      expect(node.final).toBeCloseTo(node.neutral, 10);
    }
  });

  it("metals group finals equal neutral weights", () => {
    for (const nodeId of TILT_GROUP_NODES.metals) {
      const node = allocation.groups.metals.nodes[nodeId]!;
      expect(node.final).toBeCloseTo(node.neutral, 10);
    }
  });

  it("no sector qualifies at composite 50 (threshold 70), sleeve is 0", () => {
    expect(allocation.sector.qualifying).toEqual([]);
    expect(allocation.sector.held).toEqual([]);
    expect(allocation.sector.sleeve).toBe(0);
  });

  it("total allocation sums to 1.0", () => {
    expect(allocation.total).toBeCloseTo(1.0, 6);
  });
});

describe("§1 invariant 3 — vetoes clamp overweights to zero, never force underweights", () => {
  it("composite 70 (positive tilt) + veto -> tilt clamped to 0", () => {
    const scores = allFiftyScores();
    // Push l1.debt composite above 50 via valuation (weight 0.3): to get composite 70 evenly,
    // just set every debt signal for l1.debt-equivalent... use the debt group + debt.gilt node.
    for (const s of DEBT_SIGNALS) scores[`debt.gilt::${s}`] = 70;
    const allocationNoVeto = computeAllocation(scores, {}, DEFAULT_PARAMS);
    const allocationVeto = computeAllocation(scores, { "debt.gilt": true }, DEFAULT_PARAMS);

    expect(allocationNoVeto.groups.debt.nodes["debt.gilt"]!.tilt).toBeGreaterThan(0);
    expect(allocationVeto.groups.debt.nodes["debt.gilt"]!.tilt).toBeCloseTo(0, 10);
  });

  it("composite 30 (negative tilt) + veto -> unchanged", () => {
    const scores = allFiftyScores();
    for (const s of DEBT_SIGNALS) scores[`debt.gilt::${s}`] = 30;
    const allocationNoVeto = computeAllocation(scores, {}, DEFAULT_PARAMS);
    const allocationVeto = computeAllocation(scores, { "debt.gilt": true }, DEFAULT_PARAMS);

    expect(allocationNoVeto.groups.debt.nodes["debt.gilt"]!.tilt).toBeLessThan(0);
    expect(allocationVeto.groups.debt.nodes["debt.gilt"]!.tilt).toBeCloseTo(
      allocationNoVeto.groups.debt.nodes["debt.gilt"]!.tilt,
      10
    );
  });
});

describe("§1 invariant 4 — a missing signal scores 50, never a guess", () => {
  it("omitting a score key does not throw and treats it as 50", () => {
    const scores = allFiftyScores();
    delete scores["l1.equity::valuation"];
    expect(() => computeAllocation(scores, {}, DEFAULT_PARAMS)).not.toThrow();
    const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);
    expect(allocation.groups.l1.nodes["l1.equity"]!.composite).toBeCloseTo(50, 10);
  });
});
