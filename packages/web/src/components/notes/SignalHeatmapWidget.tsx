import { useMemo } from "react";
import { computeAllocation, L1_SIGNALS, NODE_LABELS, TILT_GROUP_NODES } from "@wayfinder/engine";
import { SignalHeatmap } from "../SignalHeatmap.js";
import { useSnapshot } from "../../hooks/useSnapshot.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../../hooks/useLocalAllocation.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../../lib/constants.js";
import type { NoteWidgetSize } from "../../lib/notesApi.js";

const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
};

const L1_NODE_IDS = TILT_GROUP_NODES.l1;

const HEATMAP_NODE_LABELS: Record<string, string> = {
  ...NODE_LABELS,
  "l1.metals": "Metals",
};

// The same signal x asset-class grid as Overview's "Model drivers" section,
// dropped into a note and kept live the same way AllocationWidget is —
// it re-fetches and recomputes rather than storing a value at insert time.
export function SignalHeatmapWidget({ size }: { size: NoteWidgetSize }) {
  const { snapshot, loading } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);
  const scores = useMemo(() => (snapshot ? scoresFromSnapshot(snapshot.scores) : {}), [snapshot]);
  const composites = useMemo(() => {
    if (!snapshot) return {};
    const allocation = computeAllocation(scores, vetoesFromSnapshot(snapshot.vetoes), snapshot.params);
    const entries: Record<string, number> = {};
    for (const nodeId of L1_NODE_IDS) entries[nodeId] = allocation.groups.l1.nodes[nodeId]!.composite;
    return entries;
  }, [snapshot, scores]);

  if (loading || !snapshot) {
    return <div className="h-40 w-full animate-pulse bg-paper-2" />;
  }

  return (
    <div className={size === "small" ? "scale-90 origin-left" : undefined}>
      <SignalHeatmap signals={L1_SIGNALS} signalLabels={SIGNAL_LABELS} nodes={L1_NODE_IDS} nodeLabels={HEATMAP_NODE_LABELS} scores={scores} composites={composites} onSelect={() => {}} />
    </div>
  );
}
