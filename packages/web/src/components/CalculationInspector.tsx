import type { Allocation, ScoreState, SeriesState, Snapshot, TiltGroupId } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
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

// Traces a single signal score (e.g. "Large Cap - Valuation = 98.8")
// back to the raw data point it came from - percentile rank within its
// own trailing history, then inverted if the cell's transform calls
// for it. This is a DIFFERENT question from the composite "Formula"
// section above (which explains how already-computed signal scores
// combine into a node's composite) - this explains how ONE of those
// signal scores was itself computed from raw market data in the first
// place. Only rendered for "percentile"/"inverted" cells backed by
// exactly one raw series - "average"/"rubric"/"static" cells and
// multi-series derivations (ratios, spreads) don't reduce to this
// single clean trace and are left to their own dedicated derivation
// logic (not yet surfaced here).
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
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <h3 className="text-sm font-semibold text-neutral-900">How this signal score was calculated</h3>
      <p className="mt-1 text-xs text-neutral-500">
        {signalLabel} = {formatScore(score)} traces back to one raw data point: <span className="font-mono">{scoreState.derivedFrom[0]}</span>.
      </p>
      <ol className="mt-3 space-y-2.5 text-sm text-neutral-700">
        <li>
          <span className="font-medium text-neutral-900">1. Raw value.</span> The latest observation of{" "}
          <span className="font-mono">{scoreState.derivedFrom[0]}</span> is{" "}
          <span className="font-semibold tabular-nums">{series.latest}</span>
          {series.latestDate ? ` (as of ${new Date(series.latestDate).toLocaleDateString("en-IN")})` : ""}, sourced from {series.source}.
        </li>
        <li>
          <span className="font-medium text-neutral-900">2. Percentile rank.</span> Compared against its own trailing history of{" "}
          <span className="font-semibold tabular-nums">{series.observations}</span> observations
          {series.windowStart ? ` (since ${new Date(series.windowStart).toLocaleDateString("en-IN")})` : ""}, about{" "}
          <span className="font-semibold tabular-nums">{rankCount}</span> of {series.observations} historical values are at or below today's — a raw
          percentile of <span className="font-semibold tabular-nums">{rawPercentile.toFixed(1)}</span>.
        </li>
        {scoreState.transform === "inverted" ? (
          <li>
            <span className="font-medium text-neutral-900">3. Inverted.</span> This signal scores low-value-is-attractive (e.g. cheap valuation), so
            the score is 100 minus the raw percentile:
            <div className="mt-1.5 rounded bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-700">
              100 − {rawPercentile.toFixed(1)} = {formatScore(score)}
            </div>
          </li>
        ) : (
          <li>
            <span className="font-medium text-neutral-900">3. Used as-is.</span> This signal scores high-value-is-attractive, so the percentile rank
            is the score directly: <span className="font-semibold tabular-nums">{formatScore(score)}</span>.
          </li>
        )}
      </ol>
    </section>
  );
}

// l1.equity::momentum is a 3-series derivation (nifty50_close,
// nifty50_div_yield, gsec_10y), not a single-series percentile like
// valuation - SignalDerivationTrace below explicitly skips anything
// with more than one derivedFrom series, so this cell gets its own
// dedicated trace matching the exact formula in
// server/src/pipeline/derive.ts's niftyTriApprox12mReturn /
// deriveNiftyMomentumSeries: TRI-approx 12M return = (price return) x
// (1 + trailing div yield) - 1, then excess return = TRI return - 10Y
// G-sec yield, then that excess-return history is percentiled AS-IS
// (not inverted - persistent relative strength is attractive).
function EquityMomentumTrace({ scoreState, series, score }: { scoreState: ScoreState; series: Record<string, SeriesState>; score: number }) {
  const close = series["nifty50_close"];
  const divYield = series["nifty50_div_yield"];
  const gsec = series["gsec_10y"];
  if (!close || !divYield || !gsec || close.latest === null || divYield.latest === null || gsec.latest === null) return null;

  // This is an approximation shown for illustration, not a live
  // re-derivation of the 12M price return - the exact "value 12 months
  // ago" isn't part of SeriesState (only latest/percentile are), so the
  // real backend math (deriveNiftyMomentumSeries) does the actual
  // per-date TRI/excess-return computation; this trace explains the
  // FORMULA and shows the real current inputs, not a recomputed result.
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <h3 className="text-sm font-semibold text-neutral-900">How this signal score was calculated</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Momentum = {formatScore(score)} combines 3 raw data points: <span className="font-mono">nifty50_close</span>,{" "}
        <span className="font-mono">nifty50_div_yield</span>, and <span className="font-mono">gsec_10y</span>.
      </p>
      <ol className="mt-3 space-y-2.5 text-sm text-neutral-700">
        <li>
          <span className="font-medium text-neutral-900">1. Approximate the Nifty 50 total-return, 12M.</span> No free real Total Return Index
          source exists, so this is estimated as price return over the trailing 12 months, boosted by today's trailing dividend yield:
          <div className="mt-1.5 rounded bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-700">
            TRI return ≈ (price 12M return) × (1 + div yield) − 1
          </div>
          Current inputs: close = <span className="font-semibold tabular-nums">{close.latest}</span> (nifty50_close), trailing div yield ={" "}
          <span className="font-semibold tabular-nums">{divYield.latest}%</span>.
        </li>
        <li>
          <span className="font-medium text-neutral-900">2. Subtract the 10Y G-sec yield</span> to get equity's excess return over the risk-free
          rate:
          <div className="mt-1.5 rounded bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-700">
            excess return = TRI return × 100 − gsec_10y yield
          </div>
          Current 10Y G-sec yield: <span className="font-semibold tabular-nums">{gsec.latest.toFixed(2)}%</span>.
        </li>
        <li>
          <span className="font-medium text-neutral-900">3. Percentile, as-is.</span> That excess-return figure is percentiled against its own
          trailing history — persistent relative strength scores positively, so this is NOT inverted:{" "}
          <span className="font-semibold tabular-nums">{formatScore(score)}</span>.
        </li>
      </ol>
      <p className="mt-3 text-xs text-neutral-500">
        This is an approximation, not an exact TRI reconstruction — it applies a single point-in-time dividend yield across the whole trailing
        12-month window, so it will diverge from AMFI's own published Nifty 50 TRI return whenever yield itself moved materially over that period.
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
  if (!selectedId) return null;

  const [rawNodeId, selectedSignal] = selectedId.split("::");
  const nodeId = rawNodeId ?? selectedId;
  const group = groupForNode(nodeId);
  const node = group ? allocation.groups[group].nodes[nodeId] : undefined;
  const rollup = allocation.rollup.find((r) => r.id === selectedId || r.id === nodeId);
  const title = node ? NODE_LABELS[nodeId as keyof typeof NODE_LABELS] ?? nodeId : rollup?.label ?? selectedId;
  const finalWeight = node ? portfolioWeightForNode(allocation, nodeId) : rollup?.portfolioWeight ?? null;
  const focusedContribution = selectedSignal && node ? node.contributions.find((row) => row.signalId === selectedSignal) : null;

  // The composite formula above explains how a NODE's already-computed
  // signal scores combine - it has no idea how a single signal score
  // itself (e.g. "Large Cap - Valuation = 98.8") was derived from raw
  // market data. That provenance lives on the snapshot's own score
  // state (derivedFrom/transform), not on the Allocation object, so
  // it's read directly from `snapshot.scores` here rather than from
  // `node.contributions`.
  const focusedScoreState = selectedSignal ? snapshot.scores[selectedId] : undefined;
  const focusedSeries = focusedScoreState?.derivedFrom.length === 1 ? snapshot.series[focusedScoreState.derivedFrom[0]!] : undefined;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-neutral-200 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Calculation Inspector</p>
          <h2 className="mt-1 text-lg font-semibold text-neutral-950">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {node ? `${GROUP_LABELS[group!]} · as of ${new Date(snapshot.asOf).toLocaleDateString("en-IN")}` : "Allocation sleeve detail"}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border-[1.5px] border-ink px-2.5 py-1 text-sm text-ink hover:bg-neutral-50">
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {node ? (
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Result</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-neutral-200 p-3">
                  <p className="text-xs text-neutral-400">Composite score</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{formatScore(node.composite)}</p>
                </div>
                <div className="rounded-lg border border-neutral-200 p-3">
                  <p className="text-xs text-neutral-400">{nodeId.startsWith("l1.") ? "Model weight" : "Portfolio weight"}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{finalWeight !== null ? formatPct(finalWeight, 2) : "-"}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-600">
                The composite combines this node's signal scores using the configured model weights. The composite then maps to a capped tilt around neutral, with any active veto blocking overweights only.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Formula</h3>
              <div className="mt-3 rounded-lg bg-neutral-50 p-3 font-mono text-xs leading-6 text-neutral-700">
                Composite = {node.contributions.map((row) => `${SIGNAL_LABELS[row.signalId] ?? row.signalId} x ${formatPct(row.weight, 0)}`).join(" + ")}
                <br />
                = {node.contributions.map((row) => `${formatScore(row.score)}x${row.weight.toFixed(2)}`).join(" + ")}
                <br />
                = {node.contributions.map((row) => formatScore(row.contribution)).join(" + ")} = {formatScore(node.composite)}
              </div>
            </section>

            {focusedContribution && focusedScoreState && selectedId === "l1.equity::momentum" && (
              <EquityMomentumTrace scoreState={focusedScoreState} series={snapshot.series} score={focusedContribution.score} />
            )}
            {focusedContribution && focusedScoreState && selectedId !== "l1.equity::momentum" && (
              <SignalDerivationTrace scoreState={focusedScoreState} series={focusedSeries} signalLabel={SIGNAL_LABELS[selectedSignal!] ?? selectedSignal!} score={focusedContribution.score} />
            )}

            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Contribution breakdown</h3>
              <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-xs text-neutral-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Signal</th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-3 py-2 text-right font-medium">Weight</th>
                      <th className="px-3 py-2 text-right font-medium">Contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {node.contributions.map((row) => {
                      const isFocused = focusedContribution?.signalId === row.signalId;
                      return (
                        <tr key={row.signalId} className={isFocused ? "bg-amber-50" : undefined}>
                          <td className="px-3 py-2 text-neutral-700">{SIGNAL_LABELS[row.signalId] ?? row.signalId}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatScore(row.score)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatPct(row.weight, 0)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-950">{formatScore(row.contribution)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Allocation stages</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4"><span className="text-neutral-500">Neutral</span><span className="tabular-nums text-neutral-900">{formatPct(node.neutral, 2)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-neutral-500">Raw tilt</span><span className="tabular-nums text-neutral-900">{formatSignedPct(node.rawTilt, 2)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-neutral-500">Veto-adjusted tilt</span><span className="tabular-nums text-neutral-900">{formatSignedPct(node.tilt, 2)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-neutral-500">Sibling-normalized weight</span><span className="tabular-nums text-neutral-900">{formatPct(node.final, 2)}</span></div>
                {finalWeight !== null && !nodeId.startsWith("l1.") && (
                  <div className="flex justify-between gap-4"><span className="text-neutral-500">Final portfolio weight</span><span className="tabular-nums font-medium text-neutral-950">{formatPct(finalWeight, 2)}</span></div>
                )}
              </div>
              {node.vetoActive && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Veto active: overweights are blocked, but underweights remain allowed.
                </p>
              )}
            </section>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-600">
            {rollup ? (
              <p>
                {rollup.label} is currently {formatPct(rollup.portfolioWeight, 2)} of the portfolio. A full causal chain for sector sleeves will be expanded when sector contribution lineage lands.
              </p>
            ) : (
              <p>This selected item does not yet have inspector detail.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
