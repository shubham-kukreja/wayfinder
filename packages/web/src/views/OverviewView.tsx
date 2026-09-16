import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { L1_SIGNALS, NODE_LABELS, TILT_GROUP_NODES, computeAllocation } from "@wayfinder/engine";
import { AllocationBar, segmentSwatchStyle, type AllocationDepth, type CompareBasis } from "../components/AllocationBar.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
import { SignalHeatmap } from "../components/SignalHeatmap.js";
import { TabRow } from "../components/ui/TabRow.js";
import { InfoPopover } from "../components/ui/InfoPopover.js";
import { listReviews, type ReviewListItem } from "../lib/reviewsApi.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { formatPct, formatSignedPct } from "../lib/format.js";

const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
};

const L1_NODE_IDS = TILT_GROUP_NODES.l1;

// The heatmap's columns are narrow, so "Precious Metals" is shortened here
// rather than in the shared label map, which the rest of the app still uses in
// full.
const HEATMAP_NODE_LABELS: Record<string, string> = {
  ...NODE_LABELS,
  "l1.metals": "Metals",
};

type SleeveFilter = "all" | "equity" | "debt" | "metals";

const SLEEVE_FILTERS: Array<{ id: SleeveFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "equity", label: "Equity" },
  { id: "debt", label: "Debt" },
  { id: "metals", label: "Metals" },
];

// Which asset class each rollup row belongs to, used both to filter the list
// and as the row's descriptive second line. Sector sleeves are carved out of
// equity, so they filter under it.
const ROLLUP_GROUP: Record<string, SleeveFilter> = {
  "equity.large": "equity",
  "equity.mid": "equity",
  "equity.small": "equity",
  "equity.intl": "equity",
  "debt.liquid": "debt",
  "debt.corporate": "debt",
  "debt.gilt": "debt",
  "metals.gold": "metals",
  "metals.silver": "metals",
};

const GROUP_LABEL_BY_ROLLUP: Record<string, string> = {
  "equity.large": "Equity · Large cap",
  "equity.mid": "Equity · Mid cap",
  "equity.small": "Equity · Small cap",
  "equity.intl": "Equity · International",
  "debt.liquid": "Debt · Liquid",
  "debt.corporate": "Debt · Corporate",
  "debt.gilt": "Debt · Gilt",
  "metals.gold": "Precious metals · Gold",
  "metals.silver": "Precious metals · Silver",
};

function rollupGroup(id: string): SleeveFilter {
  if (id.startsWith("sleeve.")) return "equity";
  return ROLLUP_GROUP[id] ?? "all";
}

// Veto keys arrive as plain strings, so the label map needs a widened lookup.
function nodeLabel(nodeId: string): string {
  return (NODE_LABELS as Record<string, string>)[nodeId] ?? nodeId;
}

function sleeveFilterFromSearch(value: string | null): SleeveFilter {
  return value === "equity" || value === "debt" || value === "metals" ? value : "all";
}

function formatPublishedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatAsOf(asOf: string): string {
  return new Date(asOf).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function depthFromSearch(value: string | null): AllocationDepth {
  return value === "detail" ? "detail" : "overview";
}

// Labelled by what each depth actually shows rather than "Overview / Detail":
// "Overview" collided with the page's own name, and the pair now says which
// level of the allocation tree is on screen.
const DEPTH_OPTIONS: ReadonlyArray<{ id: AllocationDepth; label: string }> = [
  { id: "overview", label: "Asset classes" },
  { id: "detail", label: "Sleeves" },
];

function compareFromSearch(value: string | null): CompareBasis {
  return value === "neutral" ? "neutral" : "none";
}

const COMPARE_LABELS: Record<CompareBasis, string> = {
  none: "None",
  neutral: "Neutral",
};

export function OverviewView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  // The newest published entry is the one this page is serving.
  const [activeVersion, setActiveVersion] = useState<ReviewListItem | null>(null);
  useEffect(() => {
    listReviews()
      .then((rows) => setActiveVersion(rows.find((r) => r.published) ?? null))
      .catch(() => setActiveVersion(null));
  }, []);
  const depth = depthFromSearch(searchParams.get("depth"));
  const compare = compareFromSearch(searchParams.get("compare"));
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

  const compositesByNode = useMemo(() => {
    const entries: Record<string, number> = {};
    for (const nodeId of L1_NODE_IDS) {
      entries[nodeId] = allocation.groups.l1.nodes[nodeId]!.composite;
    }
    return entries;
  }, [allocation]);

  const sleeveFilter = sleeveFilterFromSearch(searchParams.get("sleeve"));
  const visibleRollup =
    sleeveFilter === "all" ? allocation.rollup : allocation.rollup.filter((row) => rollupGroup(row.id) === sleeveFilter);
  const visibleWeight = visibleRollup.reduce((sum, row) => sum + row.portfolioWeight, 0);

  function setDepth(nextDepth: AllocationDepth) {
    const next = new URLSearchParams(searchParams);
    if (nextDepth === "overview") next.delete("depth");
    else next.set("depth", nextDepth);
    setSearchParams(next);
  }

  function setCompare(nextCompare: CompareBasis) {
    const next = new URLSearchParams(searchParams);
    if (nextCompare === "none") next.delete("compare");
    else next.set("compare", nextCompare);
    setSearchParams(next);
  }

  function setSleeveFilter(nextFilter: SleeveFilter) {
    const next = new URLSearchParams(searchParams);
    if (nextFilter === "all") next.delete("sleeve");
    else next.set("sleeve", nextFilter);
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
    <main className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={selectedNode} onClose={closeInspector} />

      <section className="rounded-lg border border-line bg-paper p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Ideal Asset Allocation</p>
            <h1 className="mt-1 font-display text-2xl text-ink">Current model allocation</h1>
          </div>
          {/* Date and compare sit on a shared baseline: matching caption
              heights and a uniform 32px control row, so the value and the
              select line up rather than drifting apart. */}
          <div className="flex shrink-0 items-end gap-8">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">As of</span>
                {/* Overview serves the published version, not the live draft,
                    so the exact version behind these numbers is worth being
                    able to check without leaving the page. */}
                <InfoPopover label="Which version is this?" title="Published version">
                  {activeVersion ? (
                    <>
                      <p>
                        <strong className="font-semibold text-ink">{activeVersion.label ?? "Unlabelled"}</strong>
                      </p>
                      <dl className="space-y-1.5 border-t border-line pt-2.5 text-[12px]">
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Published</dt>
                          <dd className="text-right text-ink">{formatPublishedAt(activeVersion.createdAt)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Version id</dt>
                          <dd className="text-right font-mono text-ink">{activeVersion.id.slice(0, 8)}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Published by</dt>
                          <dd className="text-right text-ink">{activeVersion.actor ?? "unknown"}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-muted">Snapshot as of</dt>
                          <dd className="text-right text-ink">{formatPublishedAt(snapshot.asOf)}</dd>
                        </div>
                      </dl>
                      {activeVersion.reason && (
                        <p className="border-t border-line pt-2.5">
                          <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Reason</span>
                          <br />
                          {activeVersion.reason}
                        </p>
                      )}
                      <p className="border-t border-line pt-2.5 text-[12px] text-muted">
                        This allocation is frozen at publish time. Tuning the model does not change it until you publish again.
                      </p>
                    </>
                  ) : (
                    <p>
                      Nothing has been published yet, so this shows the current draft. Publish a version from Governance to fix
                      an allocation of record.
                    </p>
                  )}
                </InfoPopover>
              </div>
              <div className="mt-1 flex h-8 items-center text-sm font-semibold tabular-nums text-ink">
                {formatAsOf(snapshot.asOf)}
              </div>
            </div>
            <div>
              <label htmlFor="compare-basis" className="block text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">
                Compare
              </label>
              {/* Bordered pill: leading icon, bold label, trailing chevron.
                  The native select sits transparent on top so it keeps real
                  keyboard and screen-reader behaviour. */}
              <div className="relative mt-1 h-8">
                <div className="pointer-events-none flex h-8 items-center gap-2 rounded-sm border border-ink px-3">
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="3" width="12" height="11" rx="1.5" />
                    <path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2" />
                  </svg>
                  <span className="text-[13px] font-bold text-ink">{COMPARE_LABELS[compare]}</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="ml-1 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
                <select
                  id="compare-basis"
                  value={compare}
                  onChange={(e) => setCompare(compareFromSearch(e.target.value))}
                  className="absolute inset-0 h-8 w-full cursor-pointer opacity-0"
                >
                  <option value="none">None</option>
                  <option value="neutral">Neutral</option>
                  <option value="previous" disabled>
                    Previous published
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <TabRow options={DEPTH_OPTIONS} value={depth} onChange={setDepth} className="mb-5" />

        <AllocationBar allocation={allocation} depth={depth} selectedId={selectedNode} onSelect={selectNode} compare={compare} />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* Sleeve list: filter tabs over a two-line row per sleeve — swatch,
            name and status on the first line; the class descriptor, the
            within-group share and the neutral comparison on the second. */}
        <div className="rounded-lg border border-line bg-paper p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Sleeve allocation</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {visibleRollup.length} sleeve{visibleRollup.length === 1 ? "" : "s"} · {formatPct(visibleWeight, 1)} of portfolio
              </p>
            </div>
            <Link
              to="/model/parameters"
              className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-line px-3 py-2 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
            >
              Manage weights
              <span aria-hidden="true">›</span>
            </Link>
          </div>

          <TabRow options={SLEEVE_FILTERS} value={sleeveFilter} onChange={setSleeveFilter} className="mb-1" />

          <div>
            {visibleRollup.map((row) => {
              const node =
                allocation.groups.equity.nodes[row.id] ??
                allocation.groups.debt.nodes[row.id] ??
                allocation.groups.metals.nodes[row.id];
              const isVetoed = !!node?.vetoActive;
              const delta = node ? node.vsNeutralFinal : null;
              const capped = node ? Math.abs(node.rawTilt - node.tilt) > 0.0005 : false;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectNode(row.id)}
                  className="w-full border-b border-line py-3 text-left last:border-0 hover:bg-paper-2"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="h-3.5 w-3.5 shrink-0" style={segmentSwatchStyle(row.id, allocation)} />
                      <span className="truncate text-[15px] text-ink">{row.label}</span>
                      {row.id.startsWith("sleeve.") && (
                        <span className="shrink-0 rounded-sm bg-lilac px-2 py-0.5 text-[11px] font-bold text-ink">Sleeve</span>
                      )}
                      {isVetoed && (
                        <span className="shrink-0 rounded-sm bg-warn-50 px-2 py-0.5 text-[11px] font-bold text-warn-800">Veto</span>
                      )}
                      {capped && (
                        <span className="shrink-0 rounded-sm bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2" title="Tilt limited by the group cap">
                          Capped
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">
                      {formatPct(row.portfolioWeight, 1)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-4 pl-6">
                    <span className="truncate text-[13px] text-muted">
                      {GROUP_LABEL_BY_ROLLUP[row.id] ?? "Equity · Sector sleeve"} · {formatPct(row.withinGroup, 1)} of group
                    </span>
                    {delta !== null && (
                      <span className="shrink-0 text-[13px] tabular-nums text-muted">
                        Neutral: {formatPct(row.portfolioWeight - delta, 1)}{" "}
                        <span className={delta >= 0 ? "text-brand-800" : "text-danger-500"}>{formatSignedPct(delta, 2)}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Drivers: for each class, the composite, the tilt it produced, and
            the signal contributions that built it — so a weight traces back to
            the scores behind it without leaving the page. */}
        <div className="rounded-lg border border-line bg-paper p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Model drivers</h2>
            <p className="mt-0.5 text-[13px] text-muted">Composite scores and signal contributions</p>
          </div>

          {/* The tilt each class ended up with, above the grid that explains
              it: the outcome first, then the scores behind it. */}
          <div className="mb-9 mt-7 grid grid-cols-3 gap-4 border-b border-line pb-7">
            {l1Rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => selectNode(row.id)}
                className="rounded-sm px-1 py-1 text-left transition-colors duration-100 ease-in hover:bg-paper-2"
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0" style={segmentSwatchStyle(row.id, allocation)} />
                  <span className="truncate text-[12px] text-muted">{row.label}</span>
                </div>
                <div
                  className={`mt-0.5 text-[15px] font-semibold tabular-nums ${
                    row.neutralDelta >= 0 ? "text-brand-800" : "text-danger-500"
                  }`}
                >
                  {formatSignedPct(row.neutralDelta, 2)}
                </div>
                {row.vetoActive && (
                  <span className="mt-1 inline-block rounded-sm bg-warn-50 px-1.5 py-0.5 text-[10px] font-bold text-warn-800">
                    Veto
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Signals x classes as one grid. Three stacked bar-and-prose blocks
              made the reader compare across sections; a matrix puts every
              score in a single field where a weak row or column is visible at
              a glance. */}
          <SignalHeatmap
            signals={L1_SIGNALS}
            signalLabels={SIGNAL_LABELS}
            nodes={L1_NODE_IDS}
            nodeLabels={HEATMAP_NODE_LABELS}
            scores={scores}
            composites={compositesByNode}
            onSelect={selectNode}
          />

          {/* Quiet notice rather than a tinted callout: a hairline rule and a
              warn-coloured status dot, matching the flat, bordered language
              the rest of the page uses. */}
          {activeVetoes.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                <p className="text-[13px] font-semibold text-ink">
                  {activeVetoes.length} veto{activeVetoes.length === 1 ? "" : "es"} active
                </p>
              </div>
              <ul className="mt-1.5 space-y-1">
                {activeVetoes.map(([nodeId, veto]) => (
                  <li key={nodeId} className="pl-3.5 text-[13px] leading-5 text-muted">
                    <span className="font-semibold text-ink-2">{nodeLabel(nodeId)}</span>
                    {veto.detail ? ` — ${veto.detail}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-2 pl-3.5 text-[12px] text-muted">Vetoes block overweights; they do not force underweights.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
