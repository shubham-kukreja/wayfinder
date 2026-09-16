import { useEffect } from "react";
import type { Allocation, ScoreState, SeriesState, Snapshot, TiltGroupId } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
import { DistributionStrip } from "./DistributionStrip.js";
import { segmentSwatchStyle } from "./AllocationBar.js";
import { formatPct, formatScore, formatSignedPct } from "../lib/format.js";

const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
  relvalue: "Relative value",
  revisions: "Revisions",
  growth_diff: "Growth differential",
  margin_cycle: "Margin / cycle",
  carry: "Carry",
  rate_cycle: "Rate cycle",
  spread_cushion: "Spread cushion",
  liquidity: "Liquidity",
  ratio_position: "Ratio positioning",
  real_rates: "Real rates",
  industrial: "Industrial demand",
};

const GROUP_BY_NODE_PREFIX: Record<string, TiltGroupId> = {
  "l1.": "l1",
  "equity.": "equity",
  "debt.": "debt",
  "metals.": "metals",
};

function groupForNode(nodeId: string): TiltGroupId | null {
  const prefix = Object.keys(GROUP_BY_NODE_PREFIX).find((p) => nodeId.startsWith(p));
  return prefix ? GROUP_BY_NODE_PREFIX[prefix]! : null;
}

function portfolioWeightForNode(allocation: Allocation, nodeId: string): number | null {
  if (nodeId.startsWith("l1.")) {
    return allocation.groups.l1.nodes[nodeId]?.final ?? null;
  }
  const row = allocation.rollup.find((r) => r.id === nodeId);
  return row?.portfolioWeight ?? null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// A score's distance from 50 is the only thing that moves a weight, so the
// scale is drawn centred on 50 rather than as a 0-100 progress bar. Left of
// centre is a headwind, right is a tailwind, and the bar's length is the
// magnitude of the push.
function ScoreScale({ score }: { score: number }) {
  const delta = score - 50;
  const magnitude = Math.min(50, Math.abs(delta));
  const positive = delta >= 0;
  return (
    <div className="relative h-1.5 w-full bg-paper-2" title={`${formatScore(score)} — ${positive ? "above" : "below"} neutral`}>
      <span
        className={positive ? "absolute inset-y-0 bg-brand-500" : "absolute inset-y-0 bg-danger-500"}
        style={positive ? { left: "50%", width: `${magnitude}%` } : { right: "50%", width: `${magnitude}%` }}
      />
      <span aria-hidden="true" className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-ink/40" />
    </div>
  );
}

// The four stages the engine actually runs, each with the number it produced.
// Previously this was a flat list of labelled values, which hid the fact that
// they are sequential and that each one can change the answer.
function PipelineStage({
  index,
  label,
  value,
  detail,
  tone = "quiet",
}: {
  index: number;
  label: string;
  value: string;
  detail: string;
  tone?: "quiet" | "warn";
}) {
  return (
    <div className="relative flex gap-3 pb-4 pl-7 last:pb-0">
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0.5 flex h-[18px] w-[18px] items-center justify-center text-[10px] font-bold ${
          tone === "warn" ? "bg-warn-50 text-warn-800" : "bg-paper-2 text-ink-2"
        }`}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink">{label}</span>
          <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${tone === "warn" ? "text-warn-600" : "text-ink"}`}>
            {value}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-5 text-muted">{detail}</p>
      </div>
    </div>
  );
}

// Traces a single signal score back to the raw data point it came from —
// percentile rank within its own trailing history, then inverted if the
// cell's transform calls for it. Only meaningful for "percentile"/"inverted"
// cells backed by exactly one raw series; multi-series derivations get their
// own dedicated traces.
function SignalDerivationTrace({
  scoreState,
  series,
  signalLabel,
  score,
}: {
  scoreState: ScoreState;
  series: SeriesState | undefined;
  signalLabel: string;
  score: number;
}) {
  const isPercentileBased = scoreState.transform === "percentile" || scoreState.transform === "inverted";
  if (!isPercentileBased || !series || series.latest === null || series.percentile === null) return null;

  const rawPercentile = scoreState.transform === "inverted" ? 100 - score : score;
  const rankCount = Math.round((rawPercentile / 100) * series.observations);

  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Where {signalLabel} came from</h3>

      <div className="mt-3 border-y border-line py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-2">{scoreState.derivedFrom[0]}</span>
          <span className="text-[15px] font-semibold tabular-nums text-ink">{series.latest}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-muted">
          {series.source} · observed {formatDate(series.latestDate)}
        </p>
        {/* The raw number means nothing without its own history; the strip is
            what turns "6.78" into "unusually high". */}
        <div className="mt-2.5">
          <DistributionStrip percentile={series.percentile} />
          <p className="mt-1.5 text-[12px] text-muted">
            {rankCount} of {series.observations} past readings sit at or below this one
            {series.windowStart ? `, going back to ${formatDate(series.windowStart)}` : ""}.
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted">
          {scoreState.transform === "inverted"
            ? "Low readings are attractive here, so the percentile is flipped"
            : "High readings are attractive here, so the percentile is the score"}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-ink-2">
          {scoreState.transform === "inverted" ? `100 − ${rawPercentile.toFixed(1)} = ` : ""}
          <span className="text-[15px] font-semibold text-ink">{formatScore(score)}</span>
        </span>
      </div>
    </section>
  );
}

// l1.equity::momentum is a 3-series derivation (nifty50_close,
// nifty50_div_yield, gsec_10y), not a single-series percentile, so it gets
// its own trace matching server/src/pipeline/derive.ts.
function EquityMomentumTrace({ series, score }: { series: Record<string, SeriesState>; score: number }) {
  const close = series["nifty50_close"];
  const divYield = series["nifty50_div_yield"];
  const gsec = series["gsec_10y"];
  if (!close || !divYield || !gsec || close.latest === null || divYield.latest === null || gsec.latest === null) return null;

  const inputs = [
    { id: "nifty50_close", label: "Nifty 50 close", value: close.latest.toLocaleString("en-IN"), state: close },
    { id: "nifty50_div_yield", label: "Trailing dividend yield", value: `${divYield.latest}%`, state: divYield },
    { id: "gsec_10y", label: "10Y G-sec yield", value: `${gsec.latest.toFixed(2)}%`, state: gsec },
  ];

  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Where Momentum came from</h3>
      <p className="mt-2 text-[13px] leading-5 text-muted">
        Equity's total return over the trailing year, less the risk-free rate, ranked against its own history. Three inputs feed it.
      </p>

      <div className="mt-3 border-y border-line">
        {inputs.map((input) => (
          <div key={input.id} className="border-b border-line py-2.5 last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-ink-2">{input.label}</span>
              <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">{input.value}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">
              {input.id} · {input.state.source} · observed {formatDate(input.state.latestDate)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-1.5 text-[12px] leading-5 text-ink-2">
        <p>
          <span className="font-semibold text-ink">1.</span> TRI return ≈ (12M price return) × (1 + dividend yield) − 1
        </p>
        <p>
          <span className="font-semibold text-ink">2.</span> Excess return = TRI return × 100 − 10Y G-sec yield
        </p>
        <p>
          <span className="font-semibold text-ink">3.</span> That excess-return history is percentiled as-is — persistent strength
          scores positively, so it is not inverted.
        </p>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-[13px] text-muted">Momentum score</span>
        <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(score)}</span>
      </div>

      <p className="mt-3 text-[12px] leading-5 text-muted">
        An approximation, not an exact TRI reconstruction: it applies one point-in-time dividend yield across the whole trailing
        year, so it diverges from AMFI's published Nifty 50 TRI whenever yield itself moved materially.
      </p>
    </section>
  );
}

export function CalculationInspector({
  snapshot,
  allocation,
  selectedId,
  onClose,
}: {
  snapshot: Snapshot;
  allocation: Allocation;
  selectedId: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!selectedId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId, onClose]);

  if (!selectedId) return null;

  const [rawNodeId, selectedSignal] = selectedId.split("::");
  const nodeId = rawNodeId ?? selectedId;
  const group = groupForNode(nodeId);
  const node = group ? allocation.groups[group].nodes[nodeId] : undefined;
  const rollup = allocation.rollup.find((r) => r.id === selectedId || r.id === nodeId);
  const title = node ? NODE_LABELS[nodeId as keyof typeof NODE_LABELS] ?? nodeId : rollup?.label ?? selectedId;
  const finalWeight = node ? portfolioWeightForNode(allocation, nodeId) : rollup?.portfolioWeight ?? null;
  const focusedContribution = selectedSignal && node ? node.contributions.find((row) => row.signalId === selectedSignal) : null;

  const focusedScoreState = selectedSignal ? snapshot.scores[selectedId] : undefined;
  const focusedSeries = focusedScoreState?.derivedFrom.length === 1 ? snapshot.series[focusedScoreState.derivedFrom[0]!] : undefined;

  const maxTilt = group ? snapshot.params.maxTilt[group] : null;
  const capped = node ? Math.abs(node.rawTilt - node.tilt) > 0.00005 : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/20 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Calculation for ${title}`}
        className="mt-[5vh] w-full max-w-3xl rounded-lg border border-line bg-paper p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header states the outcome first — the weight and the score — so the
            reader sees the answer before the derivation of it. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Calculation</p>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="h-4 w-4 shrink-0" style={segmentSwatchStyle(nodeId, allocation)} />
              <h2 className="truncate font-display text-xl text-ink">{title}</h2>
              {selectedSignal && (
                <span className="shrink-0 rounded-sm bg-lilac px-2 py-0.5 text-[11px] font-bold text-indigo">
                  {SIGNAL_LABELS[selectedSignal] ?? selectedSignal}
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {node && group ? `${GROUP_LABELS[group]} · as of ${formatDate(snapshot.asOf)}` : "Allocation sleeve detail"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 shrink-0 rounded-sm border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
          >
            Close
          </button>
        </div>

        {node ? (
          <>
            {/* The two numbers that matter, and the one sentence tying them
                together — a composite above 50 pushes the weight above
                neutral, below 50 pulls it under. */}
            <div className="mt-5 grid grid-cols-2 gap-8 border-y border-line py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Composite score</p>
                <p className="mt-1.5 font-display text-[36px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink">
                  {formatScore(node.composite)}
                </p>
                <div className="mt-2.5">
                  <ScoreScale score={node.composite} />
                </div>
                <p className="mt-1.5 text-[12px] text-muted">
                  {node.composite >= 50
                    ? `${formatScore(node.composite - 50)} above neutral`
                    : `${formatScore(50 - node.composite)} below neutral`}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                  {nodeId.startsWith("l1.") ? "Model weight" : "Portfolio weight"}
                </p>
                <p className="mt-1.5 font-display text-[36px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink">
                  {finalWeight !== null ? formatPct(finalWeight, 1) : "—"}
                </p>
                <p className="mt-2.5 text-[13px] tabular-nums text-muted">
                  Neutral {formatPct(node.neutral, 1)}
                  <span className={`ml-2 font-semibold ${node.vsNeutralFinal >= 0 ? "text-brand-800" : "text-danger-500"}`}>
                    {formatSignedPct(node.vsNeutralFinal, 2)}
                  </span>
                </p>
                {(node.vetoActive || capped) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {node.vetoActive && (
                      <span className="rounded-sm bg-warn-50 px-2 py-0.5 text-[11px] font-bold text-warn-800">Veto active</span>
                    )}
                    {capped && (
                      <span className="rounded-sm bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2">Tilt capped</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2">
              {/* Which signals built the composite — as bars, so the dominant
                  driver is visible without reading four columns of numbers. */}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">What built this score</h3>
                <div className="mt-3">
                  {node.contributions.map((row) => {
                    const isFocused = focusedContribution?.signalId === row.signalId;
                    return (
                      <div
                        key={row.signalId}
                        className={`border-b border-line py-2.5 last:border-0 ${isFocused ? "-mx-2 bg-paper-2 px-2" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[13px] text-ink">
                            {SIGNAL_LABELS[row.signalId] ?? row.signalId}
                            <span className="ml-1.5 text-[12px] text-muted">{formatPct(row.weight, 0)}</span>
                          </span>
                          <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">{formatScore(row.score)}</span>
                        </div>
                        <div className="mt-1.5">
                          <ScoreScale score={row.score} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                  <span className="text-[13px] font-semibold text-ink">Weighted average</span>
                  <span className="text-[15px] font-semibold tabular-nums text-ink">{formatScore(node.composite)}</span>
                </div>
              </section>

              {/* How the score became a weight — the four engine stages, in
                  order, each with the number it produced. */}
              <section>
                <h3 className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">How it became a weight</h3>
                <div className="mt-3">
                  <PipelineStage
                    index={1}
                    label="Score to tilt"
                    value={formatSignedPct(node.rawTilt, 2)}
                    detail={
                      maxTilt !== null
                        ? `(${formatScore(node.composite)} − 50) ÷ 50 × ${formatPct(maxTilt, 0)} cap`
                        : "Distance from neutral, scaled by the group's tilt cap"
                    }
                  />
                  <PipelineStage
                    index={2}
                    label={node.vetoActive ? "Veto clamp" : "Veto check"}
                    value={formatSignedPct(node.tilt, 2)}
                    tone={node.vetoActive ? "warn" : "quiet"}
                    detail={
                      node.vetoActive
                        ? "A veto blocks overweights but allows underweights, so any positive tilt is clamped to zero."
                        : "No veto on this node, so the tilt passes through unchanged."
                    }
                  />
                  <PipelineStage
                    index={3}
                    label="Applied to neutral"
                    value={formatPct(node.prelim, 2)}
                    detail={`${formatPct(node.neutral, 1)} neutral × (1 ${node.tilt >= 0 ? "+" : "−"} ${formatPct(Math.abs(node.tilt), 2)})`}
                  />
                  <PipelineStage
                    index={4}
                    label="Normalised against siblings"
                    value={formatPct(node.final, 2)}
                    detail="Every node in the group is rescaled so the group sums to 100%."
                  />
                  {finalWeight !== null && !nodeId.startsWith("l1.") && (
                    <PipelineStage
                      index={5}
                      label="Final portfolio weight"
                      value={formatPct(finalWeight, 2)}
                      detail="Scaled by the parent asset class's own weight."
                    />
                  )}
                </div>
              </section>
            </div>

            {(focusedContribution && focusedScoreState) && (
              <div className="mt-6 border-t border-line pt-5">
                {selectedId === "l1.equity::momentum" ? (
                  <EquityMomentumTrace series={snapshot.series} score={focusedContribution.score} />
                ) : (
                  <SignalDerivationTrace
                    scoreState={focusedScoreState}
                    series={focusedSeries}
                    signalLabel={SIGNAL_LABELS[selectedSignal!] ?? selectedSignal!}
                    score={focusedContribution.score}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <p className="mt-5 text-[13px] text-muted">
            {rollup
              ? `${rollup.label} is currently ${formatPct(rollup.portfolioWeight, 2)} of the portfolio. A full causal chain for sector sleeves lands with sector contribution lineage.`
              : "This item does not yet have inspector detail."}
          </p>
        )}
      </div>
    </div>
  );
}
