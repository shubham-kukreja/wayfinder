import { useMemo, useState } from "react";
import type { Snapshot, ScoreProvenance } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { computeSensitivity } from "../lib/sensitivity.js";
import { formatScore } from "../lib/format.js";

const PROVENANCE_LABELS: Record<ScoreProvenance, string> = {
  auto: "Auto (fetched)",
  rubric: "Rubric",
  static: "Static",
  manual: "Manual",
  default: "Default (never set)",
};

const PROVENANCE_ORDER: ScoreProvenance[] = ["manual", "rubric", "auto", "static", "default"];

function staleBadge(staleDays: number | null): { label: string; className: string } | null {
  if (staleDays === null) return null;
  if (staleDays <= 7) return { label: `${staleDays}d`, className: "text-neutral-400" };
  if (staleDays <= 45) return { label: `${staleDays}d stale`, className: "text-amber-600" };
  return { label: `${staleDays}d stale`, className: "text-rose-600" };
}

export function InputsView({ snapshot }: { snapshot: Snapshot }) {
  const [expandedProvenance, setExpandedProvenance] = useState<ScoreProvenance | null>("manual");

  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const sensitivity = useMemo(() => computeSensitivity(scores, vetoes, snapshot.params), [scores, vetoes, snapshot.params]);
  const sensitivityByKey = useMemo(() => new Map(sensitivity.map((s) => [s.scoreKey, s.impact])), [sensitivity]);

  const grouped = useMemo(() => {
    const out: Record<ScoreProvenance, Array<{ key: string; state: (typeof snapshot.scores)[string]; impact: number }>> = {
      manual: [],
      rubric: [],
      auto: [],
      static: [],
      default: [],
    };
    for (const [key, state] of Object.entries(snapshot.scores)) {
      out[state.provenance].push({ key, state, impact: sensitivityByKey.get(key) ?? 0 });
    }
    for (const p of PROVENANCE_ORDER) {
      out[p].sort((a, b) => b.impact - a.impact);
    }
    return out;
  }, [snapshot.scores, sensitivityByKey]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">Inputs</h1>
      <p className="mb-8 text-sm text-neutral-500">
        All 85 scores, split by provenance and sorted by how much they can move the allocation — not sheet order.
      </p>

      {PROVENANCE_ORDER.map((provenance) => {
        const items = grouped[provenance];
        if (items.length === 0) return null;
        const isOpen = expandedProvenance === provenance;
        return (
          <section key={provenance} className="mb-4 rounded-lg border border-neutral-200 bg-white">
            <button
              onClick={() => setExpandedProvenance(isOpen ? null : provenance)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-neutral-800">
                {PROVENANCE_LABELS[provenance]} <span className="font-normal text-neutral-400">({items.length})</span>
              </span>
              <span className="text-neutral-400">{isOpen ? "−" : "+"}</span>
            </button>
            {isOpen && (
              <div className="divide-y divide-neutral-100 border-t border-neutral-100">
                {items.map(({ key, state, impact }) => {
                  const stale = staleBadge(state.staleDays);
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-neutral-800">{key}</div>
                        {state.note && <div className="truncate text-xs text-neutral-400">{state.note}</div>}
                        {provenance === "default" && <div className="text-xs text-neutral-400">No fetched or manual input — contributing nothing to the allocation</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {stale && <span className={`text-xs ${stale.className}`}>{stale.label}</span>}
                        {state.confidence && <span className="text-xs text-neutral-400">{state.confidence}</span>}
                        <span className="w-10 text-right tabular-nums text-neutral-500" title="Impact if this score moved ±10 points">
                          {impact > 0.0005 ? `${(impact * 100).toFixed(1)}pp` : "—"}
                        </span>
                        <span className="w-10 text-right tabular-nums font-medium text-neutral-900">{formatScore(state.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
