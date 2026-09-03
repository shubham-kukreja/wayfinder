import { useMemo } from "react";
import { computeAllocation } from "@wayfinder/engine";
import type { Allocation, NodeId, Params, Scores, Vetoes } from "@wayfinder/engine";

// Recomputes the allocation locally, in the browser, using the exact same
// pure engine module the server uses (§6, §12.5 principle 2). No network
// call — this is what lets a parameter slider move and the whole
// allocation update in the same frame.
export function useLocalAllocation(scores: Scores, vetoes: Vetoes, params: Params): Allocation {
  return useMemo(() => computeAllocation(scores, vetoes, params), [scores, vetoes, params]);
}

export function scoresFromSnapshot(scoreStates: Record<string, { value: number }>): Scores {
  const out: Scores = {};
  for (const [key, state] of Object.entries(scoreStates)) {
    out[key] = state.value;
  }
  return out;
}

export function vetoesFromSnapshot(vetoStates: Record<string, { active: boolean }>): Vetoes {
  const out: Vetoes = {};
  for (const [key, state] of Object.entries(vetoStates)) {
    out[key as NodeId] = state.active;
  }
  return out;
}
