import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { L1_SIGNALS, NODE_LABELS, TILT_GROUP_NODES, computeAllocation } from "@wayfinder/engine";
import { AllocationBar, type AllocationDepth } from "../components/AllocationBar.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
import { StateSummary } from "../components/StateSummary.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { formatPct, formatScore, formatSignedPct } from "../lib/format.js";

const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
};

const L1_NODE_IDS = TILT_GROUP_NODES.l1;

function formatAsOf(asOf: string): string {
  return new Date(asOf).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function depthFromSearch(value: string | null): AllocationDepth {
  return value === "detail" ? "detail" : "overview";
}

function signalTone(value: number): string {
  if (value >= 70) return "bg-brand-500";
  if (value >= 55) return "bg-brand-300";
  if (value <= 30) return "bg-danger-500";
  if (value <= 45) return "bg-amber-400";
  return "bg-neutral-400";
}

function driverText(label: string, composite: number, delta: number, vetoActive: boolean): string {
  const direction = delta > 0.002 ? "above neutral" : delta < -0.002 ? "below neutral" : "near neutral";
  const scoreText = composite >= 56 ? "stronger composite" : composite <= 44 ? "weaker composite" : "balanced composite";
  const vetoText = vetoActive ? " A risk gate is active, so overweights are blocked." : "";
  return `${label} is ${direction} with a ${scoreText}.${vetoText}`;
}

export function OverviewView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const depth = depthFromSearch(searchParams.get("depth"));
  const selectedNode = searchParams.get("node");
  const scores = useMemo(() => scoresFromSnapshot(snapshot.scores), [snapshot.scores]);
  const vetoes = useMemo(() => vetoesFromSnapshot(snapshot.vetoes), [snapshot.vetoes]);
  const allocation = useMemo(() => computeAllocation(scores, vetoes, snapshot.params), [scores, vetoes, snapshot.params]);

  const l1Rows = L1_NODE_IDS.map((nodeId) => {
    const node = allocation.groups.l1.nodes[nodeId]!;
    return {
      id: nodeId,
      label: NODE_LABELS[nodeId],
      composite: node.composite,
      weight: node.final,
      neutralDelta: node.vsNeutralFinal,
      vetoActive: node.vetoActive,
    };
  });

  const activeVetoes = Object.entries(snapshot.vetoes).filter(([, veto]) => veto.active);
  const heldSectors = allocation.sector.held.map((id) => NODE_LABELS[id]);

  function setDepth(nextDepth: AllocationDepth) {
    const next = new URLSearchParams(searchParams);
    if (nextDepth === "overview") next.delete("depth");
    else next.set("depth", nextDepth);
    setSearchParams(next);
  }

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={selectedNode} onClose={closeInspector} />

      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Ideal Asset Allocation</p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-neutral-950">Current model allocation</h1>
            <p className="mt-1 text-sm text-neutral-500">Based on latest published market data and model inputs.</p>
            <div className="mt-2">
              <StateSummary snapshot={snapshot} />
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 text-sm lg:items-end">
            <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-600">
              As of {formatAsOf(snapshot.asOf)} · Current
            </span>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              Compare
              <select className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700" defaultValue="none">
                <option value="none">None</option>
                <option value="neutral">Neutral</option>
                <option value="previous" disabled>
                  Previous published
                </option>
              </select>
            </label>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-neutral-700">Allocation view</span>
            <div className="flex rounded-full border border-neutral-200 bg-neutral-50 p-1">
              {(["overview", "detail"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDepth(option)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    depth === option ? "bg-brand-500 text-black" : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {l1Rows.map((row) => (
              <span key={row.id} className="font-mono tabular-nums text-neutral-600">
                {row.label} <span className="font-semibold text-neutral-950">{formatPct(row.weight, 1)}</span>
              </span>
            ))}
          </div>
        </div>

        <AllocationBar allocation={allocation} depth={depth} selectedId={selectedNode} onSelect={selectNode} compactLegend />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.35fr]">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Model Drivers</h2>
            <Link to="/model/signals" className="text-xs font-medium text-neutral-500 hover:text-neutral-900">
              View calculations
            </Link>
          </div>
          <div className="space-y-4">
            {l1Rows.map((row) => (
              <div key={row.id} className="border-b border-neutral-100 pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{row.label}</p>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">{driverText(row.label, row.composite, row.neutralDelta, row.vetoActive)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono tabular-nums text-sm font-semibold text-neutral-950">{formatScore(row.composite)}</p>
                    <p className={`text-xs font-mono tabular-nums ${row.neutralDelta >= 0 ? "text-brand-800" : "text-danger-500"}`}>
                      {formatSignedPct(row.neutralDelta, 2)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {activeVetoes.length > 0 && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {activeVetoes.length} veto{activeVetoes.length === 1 ? "" : "es"} active. Vetoes block overweights; they do not force underweights.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">L2 Allocation</h2>
            {heldSectors.length > 0 && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                Sector sleeve: {heldSectors.join(", ")}
              </span>
            )}
          </div>
          <div className="divide-y divide-neutral-100">
            {allocation.rollup.map((row) => {
              const isVetoed = !!allocation.groups.equity.nodes[row.id]?.vetoActive || !!allocation.groups.debt.nodes[row.id]?.vetoActive || !!allocation.groups.metals.nodes[row.id]?.vetoActive;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectNode(row.id)}
                  className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 py-2.5 text-left text-sm hover:bg-neutral-50"
                >
                  <span className="min-w-0 truncate text-neutral-700">{row.label}{row.id.startsWith("sleeve.") ? " (sleeve)" : ""}</span>
                  {isVetoed ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Veto</span> : <span />}
                  <span className="font-mono tabular-nums font-medium text-neutral-950">{formatPct(row.portfolioWeight, 1)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Signals</h2>
          <Link to="/model/signals" className="text-xs font-medium text-neutral-500 hover:text-neutral-900">
            Explore model
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400">
                <th className="py-2 font-medium">Signal</th>
                {L1_NODE_IDS.map((nodeId) => (
                  <th key={nodeId} className="py-2 text-right font-medium">{NODE_LABELS[nodeId]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {L1_SIGNALS.map((signal) => (
                <tr key={signal} className="border-b border-neutral-100 last:border-0">
                  <td className="py-3 text-neutral-700">{SIGNAL_LABELS[signal] ?? signal}</td>
                  {L1_NODE_IDS.map((nodeId) => {
                    const value = scores[`${nodeId}::${signal}`] ?? 50;
                    return (
                      <td key={nodeId} className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => selectNode(`${nodeId}::${signal}`)}
                          className="ml-auto flex w-24 flex-col items-end gap-1 rounded-md px-2 py-1 hover:bg-neutral-50"
                        >
                          <span className="font-mono tabular-nums font-medium text-neutral-900">{formatScore(value)}</span>
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
                            <span className={`block h-full rounded-full ${signalTone(value)}`} style={{ width: `${value}%` }} />
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="py-3 font-semibold text-neutral-900">Composite</td>
                {l1Rows.map((row) => (
                  <td key={row.id} className="py-3 text-right font-semibold font-mono tabular-nums text-neutral-950">{formatScore(row.composite)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
