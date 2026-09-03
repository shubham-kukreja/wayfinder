import { computeAllocation } from "@wayfinder/engine";
import type { Params, Scores, Vetoes } from "@wayfinder/engine";

export interface SensitivityResult {
  scoreKey: string;
  // Total absolute portfolio-weight movement (summed across all rollup
  // line items) from a ±10-point nudge to this one score. Cheap to
  // compute because the engine is pure — perturb and re-run, no I/O.
  impact: number;
}

const PERTURBATION = 10;

export function computeSensitivity(scores: Scores, vetoes: Vetoes, params: Params): SensitivityResult[] {
  const baseline = computeAllocation(scores, vetoes, params);
  const baselineByRollupId = new Map(baseline.rollup.map((r) => [r.id, r.portfolioWeight]));

  const results: SensitivityResult[] = [];
  for (const scoreKey of Object.keys(scores)) {
    const original = scores[scoreKey]!;
    const nudged = { ...scores, [scoreKey]: Math.min(100, Math.max(0, original + PERTURBATION)) };
    const perturbed = computeAllocation(nudged, vetoes, params);

    let impact = 0;
    for (const r of perturbed.rollup) {
      const before = baselineByRollupId.get(r.id) ?? 0;
      impact += Math.abs(r.portfolioWeight - before);
    }
    results.push({ scoreKey, impact });
  }

  return results.sort((a, b) => b.impact - a.impact);
}
