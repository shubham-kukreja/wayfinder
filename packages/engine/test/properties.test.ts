import { describe, expect, it } from "vitest";
import { computeAllocation } from "../src/compute.js";
import { DEFAULT_PARAMS, SECTOR_NODES, TILT_GROUP_NODES } from "../src/constants.js";
import { DEBT_SIGNALS, EQUITY_SIGNALS, L1_SIGNALS, METALS_SIGNALS, SECTOR_SIGNALS } from "../src/types.js";
import type { Scores } from "../src/types.js";

function randomScores(rng: () => number): Scores {
  const scores: Scores = {};
  for (const nodeId of TILT_GROUP_NODES.l1) for (const s of L1_SIGNALS) scores[`${nodeId}::${s}`] = rng() * 100;
  for (const nodeId of TILT_GROUP_NODES.equity) for (const s of EQUITY_SIGNALS) scores[`${nodeId}::${s}`] = rng() * 100;
  for (const nodeId of TILT_GROUP_NODES.debt) for (const s of DEBT_SIGNALS) scores[`${nodeId}::${s}`] = rng() * 100;
  for (const nodeId of TILT_GROUP_NODES.metals) for (const s of METALS_SIGNALS) scores[`${nodeId}::${s}`] = rng() * 100;
  for (const nodeId of SECTOR_NODES) for (const s of SECTOR_SIGNALS) scores[`${nodeId}::${s}`] = rng() * 100;
  return scores;
}

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("§6.6.5 — sum property (1000 random score sets)", () => {
  it("always totals 1.0 within tolerance", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const scores = randomScores(rng);
      const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);
      expect(allocation.total).toBeCloseTo(1.0, 3);
    }
  });
});

describe("§6.6.6 — weight sensitivity: perturbing signal weights never produces NaN or out-of-range", () => {
  it("holds across ±10% perturbations", () => {
    const rng = mulberry32(7);
    const scores = randomScores(rng);
    for (let i = 0; i < 100; i++) {
      const params = structuredClone(DEFAULT_PARAMS);
      for (const group of Object.keys(params.signalWeights) as Array<keyof typeof params.signalWeights>) {
        const weights = params.signalWeights[group] as Record<string, number>;
        for (const key of Object.keys(weights)) {
          const perturb = 1 + (rng() * 0.2 - 0.1);
          weights[key] = weights[key]! * perturb;
        }
      }
      const allocation = computeAllocation(scores, {}, params);
      for (const r of allocation.rollup) {
        expect(Number.isNaN(r.portfolioWeight)).toBe(false);
        expect(r.portfolioWeight).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });
});

describe("§6.3 sleeve sizing", () => {
  const baseScores: Scores = {};
  for (const nodeId of TILT_GROUP_NODES.l1) for (const s of L1_SIGNALS) baseScores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.equity) for (const s of EQUITY_SIGNALS) baseScores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.debt) for (const s of DEBT_SIGNALS) baseScores[`${nodeId}::${s}`] = 50;
  for (const nodeId of TILT_GROUP_NODES.metals) for (const s of METALS_SIGNALS) baseScores[`${nodeId}::${s}`] = 50;
  for (const nodeId of SECTOR_NODES) for (const s of SECTOR_SIGNALS) baseScores[`${nodeId}::${s}`] = 50;

  it("0 qualifying -> sleeve 0, coreScale 1", () => {
    const allocation = computeAllocation(baseScores, {}, DEFAULT_PARAMS);
    expect(allocation.sector.sleeve).toBe(0);
  });

  it("1 qualifying -> sleeve 7.5%", () => {
    const scores = { ...baseScores };
    for (const s of SECTOR_SIGNALS) scores[`sector.banking::${s}`] = 75;
    const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);
    expect(allocation.sector.held).toEqual(["sector.banking"]);
    expect(allocation.sector.sleeve).toBeCloseTo(0.075, 4);
  });

  it("2 qualifying -> sleeve 15%", () => {
    const scores = { ...baseScores };
    for (const s of SECTOR_SIGNALS) scores[`sector.banking::${s}`] = 75;
    for (const s of SECTOR_SIGNALS) scores[`sector.it::${s}`] = 80;
    const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);
    expect(allocation.sector.held.length).toBe(2);
    expect(allocation.sector.sleeve).toBeCloseTo(0.15, 4);
  });

  it("3 qualifying with maxSectors 2 -> only top 2 held, sleeve still 15%", () => {
    const scores = { ...baseScores };
    for (const s of SECTOR_SIGNALS) scores[`sector.banking::${s}`] = 75;
    for (const s of SECTOR_SIGNALS) scores[`sector.it::${s}`] = 80;
    for (const s of SECTOR_SIGNALS) scores[`sector.pharma::${s}`] = 72;
    const allocation = computeAllocation(scores, {}, DEFAULT_PARAMS);
    expect(allocation.sector.qualifying.length).toBe(3);
    expect(allocation.sector.held.length).toBe(2);
    expect(allocation.sector.held).toEqual(["sector.it", "sector.banking"]);
    expect(allocation.sector.sleeve).toBeCloseTo(0.15, 4);
  });
});
