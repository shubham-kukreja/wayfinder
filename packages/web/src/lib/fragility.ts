import { computeAllocation } from "@wayfinder/engine";
import type { Params, Scores, Vetoes } from "@wayfinder/engine";

export interface FragilityResult {
  rollupId: string;
  label: string;
  baseline: number;
  minObserved: number;
  maxObserved: number;
  // "Stable" means no ±10% weight perturbation moved this line by more
  // than 1pp — the framework's own annual review checklist treats
  // fragility (large swings from small weight changes) as a reason to
  // simplify, per §12.2.
  stable: boolean;
}

const TRIALS = 30;
const PERTURBATION_RANGE = 0.1; // ±10%

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

export function runFragilityTest(scores: Scores, vetoes: Vetoes, params: Params): FragilityResult[] {
  const baseline = computeAllocation(scores, vetoes, params);
  const rng = mulberry32(1);

  const observed = new Map<string, { min: number; max: number }>();
  for (const r of baseline.rollup) {
    observed.set(r.id, { min: r.portfolioWeight, max: r.portfolioWeight });
  }

  for (let t = 0; t < TRIALS; t++) {
    const perturbedParams = structuredClone(params);
    for (const group of Object.keys(perturbedParams.signalWeights) as Array<keyof typeof perturbedParams.signalWeights>) {
      const weights = perturbedParams.signalWeights[group] as Record<string, number>;
      for (const key of Object.keys(weights)) {
        const factor = 1 + (rng() * 2 - 1) * PERTURBATION_RANGE;
        weights[key] = weights[key]! * factor;
      }
    }
    const allocation = computeAllocation(scores, vetoes, perturbedParams);
    for (const r of allocation.rollup) {
      const entry = observed.get(r.id);
      if (!entry) continue;
      entry.min = Math.min(entry.min, r.portfolioWeight);
      entry.max = Math.max(entry.max, r.portfolioWeight);
    }
  }

  return baseline.rollup.map((r) => {
    const entry = observed.get(r.id)!;
    return {
      rollupId: r.id,
      label: r.label,
      baseline: r.portfolioWeight,
      minObserved: entry.min,
      maxObserved: entry.max,
      stable: entry.max - entry.min <= 0.01,
    };
  });
}
