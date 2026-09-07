import { useMemo } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { NODE_LABELS, TILT_GROUP_NODES, GROUP_LABELS, computeAllocation } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { useLatestReview } from "../hooks/useLatestReview.js";
import { DivergingBar } from "../components/DivergingBar.js";
import { computeSensitivity } from "../lib/sensitivity.js";
import { attributeChanges } from "../lib/attribution.js";
import { formatPct, formatScore } from "../lib/format.js";

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

export function DriversView({ snapshot }: { snapshot: Snapshot }) {
  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const { review, loading: reviewLoading } = useLatestReview();

  const allocation = useMemo(() => computeAllocation(scores, vetoes, snapshot.params), [scores, vetoes, snapshot.params]);

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
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Drivers</h1>
      <p className="mb-8 text-sm text-neutral-500">Composite decomposition, change attribution, and sensitivity — the "why" behind the allocation.</p>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Composites</h2>
        <div className="space-y-6">
          {TILT_GROUPS.map((group) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">{GROUP_LABELS[group]}</h3>
              <div className="space-y-2">
                {TILT_GROUP_NODES[group].map((nodeId) => {
                  const node = allocation.groups[group].nodes[nodeId]!;
                  const signFlip = Math.sign(node.vsNeutralRaw) !== Math.sign(node.vsNeutralFinal) && node.vsNeutralRaw !== 0 && node.vsNeutralFinal !== 0;
                  return (
                    <div key={nodeId} className="grid grid-cols-[140px_1fr_70px] items-center gap-3 text-sm">
                      <span className="text-neutral-700">{NODE_LABELS[nodeId]}</span>
                      <DivergingBar value={node.composite} />
                      <span className="text-right tabular-nums text-neutral-500">
                        {formatScore(node.composite)}
                        {signFlip && (
                          <span className="ml-1 text-amber-600" title="Tilt direction and final-weight direction disagree — normalisation flipped the sign">
                            ⚠
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">
          Change attribution {review ? "(vs. last saved review)" : "(vs. neutral baseline — no review saved yet)"}
        </h2>
        {reviewLoading ? (
          <p className="text-sm text-neutral-400">Loading baseline…</p>
        ) : attribution.length === 0 ? (
          <p className="text-sm text-neutral-400">No line item differs from the baseline by more than 0.1pp.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {attribution.map((row) => (
              <li key={row.rollupId} className="flex items-baseline justify-between gap-4">
                <span className="text-neutral-700">
                  {row.label} {formatPct(row.before)} → {formatPct(row.after)}
                  {row.explanation && <span className="text-neutral-400"> — because {row.explanation}</span>}
                </span>
                <span className={`shrink-0 tabular-nums ${row.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {row.delta >= 0 ? "+" : ""}
                  {formatPct(row.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-neutral-700">Sensitivity</h2>
        <p className="mb-3 text-xs text-neutral-400">How far a ±10-point move in each score shifts the total allocation. Highest-impact scores first — these are the ones worth research time.</p>
        <ul className="space-y-1.5 text-sm">
          {sensitivity.map((s) => (
            <li key={s.scoreKey} className="flex items-center justify-between gap-4">
              <span className="text-neutral-700">{s.scoreKey}</span>
              <span className="tabular-nums text-neutral-500">{formatPct(s.impact)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
