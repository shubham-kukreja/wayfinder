import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NODE_LABELS, TILT_GROUP_NODES, L1_SIGNALS, EQUITY_SIGNALS, DEBT_SIGNALS, METALS_SIGNALS } from "@wayfinder/engine";
import { SignalMatrix } from "../components/SignalMatrix.js";
import { TabRow } from "../components/ui/TabRow.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
import { formatPct } from "../lib/format.js";
import { coreFetch } from "../lib/coreApi.js";
import { inspectorSnapshot, scoresFrom, toAllocation, type PortfolioAllocation } from "../lib/portfolioApi.js";

// Signals reads core-jobs-service: the shared draft evaluated now
// (GET /v1/portfolios/core/allocation?version=draft), and the draft's
// signal analytics (GET /v1/signals/attribution, /v1/signals/sensitivity).

interface AttributionResponse {
  draft_rev: number;
  baseline_run: string | null;
  rows: Array<{ node: string; from: number; to: number; delta: number }>;
}
interface SensitivityResponse {
  draft_rev: number;
  bump: number;
  rows: Array<{ key: string; impact_pp: number }>;
}
interface SignalsData {
  draft: PortfolioAllocation;
  attribution: AttributionResponse;
  sensitivity: SensitivityResponse;
}

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

export function DriversView() {
  const [data, setData] = useState<SignalsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      coreFetch<PortfolioAllocation>("/v1/portfolios/core/allocation?version=draft"),
      coreFetch<AttributionResponse>("/v1/signals/attribution"),
      coreFetch<SensitivityResponse>("/v1/signals/sensitivity?limit=10"),
    ])
      .then(([draft, attribution, sensitivity]) => setData({ draft, attribution, sensitivity }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  if (error) return <p className="px-6 py-10 text-sm text-danger-500">Failed to load signals: {error}</p>;
  if (!data) return <div className="px-6 py-10 text-sm text-muted">Loading…</div>;
  return <DriversBody data={data} />;
}

function DriversBody({ data }: { data: SignalsData }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedNode = searchParams.get("node");
  const snapshot = useMemo(() => inspectorSnapshot(data.draft), [data.draft]);
  const scores = useMemo(() => scoresFrom(data.draft), [data.draft]);
  const allocation = useMemo(() => toAllocation(data.draft), [data.draft]);
  const review = data.attribution.baseline_run;

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
  const basePanel = SIGNAL_PANELS.find((panel) => panel.group === group) ?? SIGNAL_PANELS[0]!;
  // The scorecard core evaluated decides the signals, nodes and weights.
  const card = data.draft.scorecards[basePanel.group];
  const activePanel = card ? { ...basePanel, signals: card.signals.map((x) => x.key), nodes: card.buckets } : basePanel;

  function setGroup(nextGroup: (typeof TILT_GROUPS)[number]) {
    const next = new URLSearchParams(searchParams);
    if (nextGroup === "l1") next.delete("group");
    else next.set("group", nextGroup);
    setSearchParams(next);
  }

  function weightsFor(g: (typeof TILT_GROUPS)[number]): Record<string, number> {
    return Object.fromEntries((data.draft.scorecards[g]?.signals ?? []).map((x) => [x.key, x.weight]));
  }

  function compositesFor(g: (typeof TILT_GROUPS)[number]): Record<string, number> {
    return Object.fromEntries(activePanel.nodes.map((id) => [id, allocation.groups[g].nodes[id]?.composite ?? 0]));
  }

  const sensitivity = data.sensitivity.rows.map((r) => ({ scoreKey: r.key, impact: r.impact_pp / 100 }));
  const reviewLoading = false;
  const attribution = data.attribution.rows.slice(0, 8).map((r) => ({
    rollupId: r.node,
    label: NODE_LABELS[r.node as keyof typeof NODE_LABELS] ?? r.node,
    before: r.from,
    after: r.to,
    delta: r.delta,
    explanation: "",
  }));

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
              {review ? "Versus the published allocation" : "Nothing is published yet, so there is nothing to compare against"}
            </p>
          </div>
          {reviewLoading ? (
            <p className="text-[13px] text-muted">Loading baseline…</p>
          ) : attribution.length === 0 ? (
            <p className="text-[13px] text-muted">
              {review ? "No line item differs from the published allocation by more than 0.1pp." : "Publish a run to compare the draft against it."}
            </p>
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
