import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { TILT_GROUP_NODES, L1_SIGNALS, EQUITY_SIGNALS, DEBT_SIGNALS, METALS_SIGNALS, computeAllocation } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { useLatestReview } from "../hooks/useLatestReview.js";
import { SignalMatrix } from "../components/SignalMatrix.js";
import { TabRow } from "../components/ui/TabRow.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
import { computeSensitivity } from "../lib/sensitivity.js";
import { attributeChanges } from "../lib/attribution.js";
import { formatPct } from "../lib/format.js";

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

const GROUP_TABS: ReadonlyArray<{ id: (typeof TILT_GROUPS)[number]; label: string }> = [
  { id: "l1", label: "Asset classes" },
  { id: "equity", label: "Equity" },
  { id: "debt", label: "Debt" },
  { id: "metals", label: "Metals" },
];

function groupFromSearch(value: string | null): (typeof TILT_GROUPS)[number] {
  return value === "equity" || value === "debt" || value === "metals" ? value : "l1";
}

const SIGNAL_PANELS: ReadonlyArray<{
  id: string;
  title: string;
  subtitle: string;
  group: (typeof TILT_GROUPS)[number];
  signals: readonly string[];
  nodes: readonly string[];
}> = [
  {
    id: "l1",
    title: "Asset-class signals",
    subtitle: "The split between equity, debt and metals.",
    group: "l1",
    signals: L1_SIGNALS,
    nodes: TILT_GROUP_NODES.l1,
  },
  {
    id: "equity",
    title: "Equity segment signals",
    subtitle: "How the equity sleeve splits across market caps.",
    group: "equity",
    signals: EQUITY_SIGNALS,
    nodes: TILT_GROUP_NODES.equity,
  },
  {
    id: "debt",
    title: "Debt bucket signals",
    subtitle: "How the debt sleeve splits across duration and credit.",
    group: "debt",
    signals: DEBT_SIGNALS,
    nodes: TILT_GROUP_NODES.debt,
  },
  {
    id: "metals",
    title: "Precious metals signals",
    subtitle: "How the metals sleeve splits between gold and silver.",
    group: "metals",
    signals: METALS_SIGNALS,
    nodes: TILT_GROUP_NODES.metals,
  },
];

export function DriversView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedNode = searchParams.get("node");
  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const { review, loading: reviewLoading } = useLatestReview();

  const allocation = useMemo(() => computeAllocation(scores, vetoes, snapshot.params), [scores, vetoes, snapshot.params]);

  function selectNode(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set("node", id);
    setSearchParams(next);
  }

  function closeInspector() {
    const next = new URLSearchParams(searchParams);
    next.delete("node");
    setSearchParams(next);
  }

  const group = groupFromSearch(searchParams.get("group"));
  const activePanel = SIGNAL_PANELS.find((panel) => panel.group === group) ?? SIGNAL_PANELS[0]!;

  function setGroup(nextGroup: (typeof TILT_GROUPS)[number]) {
    const next = new URLSearchParams(searchParams);
    if (nextGroup === "l1") next.delete("group");
    else next.set("group", nextGroup);
    setSearchParams(next);
  }

  function weightsFor(group: (typeof TILT_GROUPS)[number]): Record<string, number> {
    return (snapshot.params.signalWeights as Record<string, Record<string, number>>)[group] ?? {};
  }

  function compositesFor(group: (typeof TILT_GROUPS)[number]): Record<string, number> {
    return Object.fromEntries(
      TILT_GROUP_NODES[group].map((id) => [id, allocation.groups[group].nodes[id]!.composite]),
    );
  }

  const sensitivity = useMemo(() => computeSensitivity(scores, vetoes, snapshot.params).slice(0, 10), [scores, vetoes, snapshot.params]);

  // §12.5 principle 4: distinguish looking from deciding — attribution
  // compares against the last SAVED review, not just whatever the
  // current live snapshot happens to be. Falls back to an all-neutral
  // (score=50) baseline when no review has been saved yet, so the
  // surface is still informative on first use rather than empty.
  const baselineScores = review ? scoresFromSnapshot(review.scores) : Object.fromEntries(Object.keys(scores).map((k) => [k, 50]));
  const baselineVetoes = review ? vetoesFromSnapshot(review.vetoes) : {};

  const attribution = useMemo(() => {
    const baselineAllocation = computeAllocation(baselineScores, baselineVetoes, snapshot.params);
    const scoreDeltas = Object.fromEntries(Object.keys(scores).map((k) => [k, scores[k]! - (baselineScores[k] ?? 50)]));
    return attributeChanges(baselineAllocation, allocation, scoreDeltas)
      .filter((r) => Math.abs(r.delta) > 0.001)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [scores, baselineScores, baselineVetoes, allocation, snapshot.params]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={selectedNode} onClose={closeInspector} />

      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Model Explorer</p>
        <h1 className="mt-1 font-display text-2xl text-ink">Signals</h1>
        <p className="mt-1 max-w-measure text-sm text-muted">
          Composite decomposition, change attribution, and sensitivity — the "why" behind the allocation.
        </p>
      </div>

      {/* §14 of the UX spec ("Signal Matrix") — the per-signal breakdown behind
          each composite, one asset class at a time. Tabs rather than four
          stacked matrices: the groups are alternatives to look at, not a
          sequence to read, and stacking them buried the lower ones. They sit
          above the panel rather than inside it, since they switch what the
          panel contains rather than being part of its content. */}
      <TabRow options={GROUP_TABS} value={group} onChange={setGroup} className="mb-6" />

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="max-w-measure text-[13px] text-muted">{activePanel.subtitle}</p>
        <p className="shrink-0 text-[13px] text-muted">
          {activePanel.signals.length} signals · {activePanel.nodes.length} nodes
        </p>
      </div>

      <section className="rounded-lg border border-line bg-paper p-5">
        <SignalMatrix
          title={activePanel.title}
          signals={activePanel.signals}
          nodes={activePanel.nodes}
          scores={scores}
          composites={compositesFor(activePanel.group)}
          weights={weightsFor(activePanel.group)}
          onSelect={selectNode}
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-paper p-5">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-ink">Change attribution</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {review ? "Versus the last saved review" : "Versus a neutral baseline — no review saved yet"}
            </p>
          </div>
          {reviewLoading ? (
            <p className="text-[13px] text-muted">Loading baseline…</p>
          ) : attribution.length === 0 ? (
            <p className="text-[13px] text-muted">No line item differs from the baseline by more than 0.1pp.</p>
          ) : (
            <div>
              {attribution.map((row) => (
                <div key={row.rollupId} className="border-b border-line py-3 first:pt-0 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[15px] text-ink">{row.label}</span>
                    <span
                      className={`shrink-0 text-[15px] font-semibold tabular-nums ${
                        row.delta >= 0 ? "text-brand-800" : "text-danger-500"
                      }`}
                    >
                      {row.delta >= 0 ? "+" : ""}
                      {formatPct(row.delta)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-4">
                    <span className="text-[13px] text-muted">
                      {row.explanation ? `because ${row.explanation}` : ""}
                    </span>
                    <span className="shrink-0 text-[13px] tabular-nums text-muted">
                      {formatPct(row.before)} → {formatPct(row.after)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-paper p-5">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-ink">Sensitivity</h2>
            <p className="mt-0.5 max-w-measure text-[13px] text-muted">
              How far a ±10-point move in each score shifts the total allocation. Highest impact first — these are
              the scores worth research time.
            </p>
          </div>
          <div>
            {sensitivity.map((s) => (
              <div key={s.scoreKey} className="flex items-center justify-between gap-4 border-b border-line py-2.5 first:pt-0 last:border-0 last:pb-0">
                <span className="min-w-0 truncate font-mono text-[12px] text-ink-2">{s.scoreKey}</span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{formatPct(s.impact)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
