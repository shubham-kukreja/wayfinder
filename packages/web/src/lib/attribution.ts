import { NODE_LABELS } from "@wayfinder/engine";
import type { Allocation } from "@wayfinder/engine";

export interface AttributionRow {
  rollupId: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  // Best-effort explanation: which score moved most for the tilt-group
  // node this rollup line belongs to.
  explanation: string | null;
}

// §12.2 Drivers surface: "Gilt went 25.1% -> 26.0% because carry
// percentile rose 12 points." This compares two Allocations (e.g. current
// vs. a saved review) and, for each rollup line, finds which single
// signal moved the most within the owning tilt node — the dominant term
// in that node's composite() weighted sum — as a plain-language cause.
export function attributeChanges(
  before: Allocation,
  after: Allocation,
  scoreDeltas: Record<string, number> // scoreKey ("nodeId::signal") -> point change
): AttributionRow[] {
  const beforeById = new Map(before.rollup.map((r) => [r.id, r.portfolioWeight]));

  return after.rollup.map((r) => {
    const beforeWeight = beforeById.get(r.id) ?? 0;
    const delta = r.portfolioWeight - beforeWeight;

    // Find the node this rollup line traces to (strip "sleeve." prefix
    // for sector sleeve lines, which don't have a single owning score).
    const nodeId = r.id.startsWith("sleeve.") ? null : r.id;
    let explanation: string | null = null;

    if (nodeId) {
      let biggestSignal: string | null = null;
      let biggestChange = 0;
      for (const [key, change] of Object.entries(scoreDeltas)) {
        if (!key.startsWith(`${nodeId}::`)) continue;
        if (Math.abs(change) > Math.abs(biggestChange)) {
          biggestChange = change;
          biggestSignal = key.split("::")[1] ?? null;
        }
      }
      if (biggestSignal && biggestChange !== 0) {
        const direction = biggestChange > 0 ? "rose" : "fell";
        explanation = `${biggestSignal} ${direction} ${Math.abs(biggestChange).toFixed(0)} points`;
      }
    }

    return {
      rollupId: r.id,
      label: nodeId ? NODE_LABELS[nodeId as keyof typeof NODE_LABELS] ?? r.label : r.label,
      before: beforeWeight,
      after: r.portfolioWeight,
      delta,
      explanation,
    };
  });
}
