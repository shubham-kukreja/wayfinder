import { useMemo } from "react";
import { L1_SIGNALS, NODE_LABELS, TILT_GROUP_NODES } from "@wayfinder/engine";
import { SignalHeatmap } from "../SignalHeatmap.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { scoresFrom } from "../../lib/portfolioApi.js";
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
  // Core's scores and composites (published, else the draft).
  const { data, allocation, loading, error } = useCoreAllocation();
  const scores = useMemo(() => (data ? scoresFrom(data) : {}), [data]);
  const composites = useMemo(() => {
    const entries: Record<string, number> = {};
    if (allocation) for (const nodeId of L1_NODE_IDS) entries[nodeId] = allocation.groups.l1.nodes[nodeId]?.composite ?? 0;
    return entries;
  }, [allocation]);

  if (error) return <p className="rounded-sm bg-paper-2 px-3 py-2 text-xs text-muted">Signals unavailable: {error}</p>;
  if (loading || !data) {
    return <div className="h-40 w-full animate-pulse bg-paper-2" />;
  }

  return (
    <div className={size === "small" ? "scale-90 origin-left" : undefined}>
      <SignalHeatmap signals={L1_SIGNALS} signalLabels={SIGNAL_LABELS} nodes={L1_NODE_IDS} nodeLabels={HEATMAP_NODE_LABELS} scores={scores} composites={composites} onSelect={() => {}} />
    </div>
  );
}
