import { useMemo, useState } from "react";
import type { Snapshot, ScoreProvenance } from "@wayfinder/engine";
import { RUBRIC_UI_BY_SCORE_ID } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { computeSensitivity } from "../lib/sensitivity.js";
import { formatScore } from "../lib/format.js";
import { RubricPicker } from "../components/RubricPicker.js";
import { saveScore } from "../lib/scoresApi.js";

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
  if (staleDays <= 7) return { label: `${staleDays}d`, className: "text-muted" };
  if (staleDays <= 45) return { label: `${staleDays}d stale`, className: "text-warn-600" };
  return { label: `${staleDays}d stale`, className: "text-danger-500" };
}

export function InputsView({ snapshot }: { snapshot: Snapshot }) {
  const [expandedProvenance, setExpandedProvenance] = useState<ScoreProvenance | null>("manual");
  const [expandedRubricKey, setExpandedRubricKey] = useState<string | null>(null);
  // Picking conditions updates this local preview instantly (§12.5
  // principle 2 — no network call just to see the resulting score), but
  // it's only written to the server (and so only survives a reload / is
  // visible elsewhere) once the picker's own "Save" button is clicked —
  // matching §12.5 principle 3 ("data changes are explicit").
  const [rubricOverrides, setRubricOverrides] = useState<Record<string, number>>({});

  async function handleSaveRubric(values: Record<string, number>) {
    await Promise.all(Object.entries(values).map(([id, value]) => saveScore(id, value)));
  }

  const scores = useMemo(() => ({ ...scoresFromSnapshot(snapshot.scores), ...rubricOverrides }), [snapshot.scores, rubricOverrides]);
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

  const hasUnsavedRubricPicks = Object.keys(rubricOverrides).length > 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <h1 className="mb-1 font-display text-xl text-ink">Inputs</h1>
      <p className="mb-8 text-sm text-muted">
        All 85 scores, split by provenance and sorted by how much they can move the allocation — not sheet order.
      </p>

      {hasUnsavedRubricPicks && (
        <div className="mb-4 rounded-lg border border-warn-200 bg-warn-50 px-4 py-2 text-xs text-warn-800">
          Rubric selections below update the live preview instantly. Click "Save" inside a picker to persist it to the
          server — until then it's local to this page and a reload will lose it.
        </div>
      )}

      {PROVENANCE_ORDER.map((provenance) => {
        const items = grouped[provenance];
        if (items.length === 0) return null;
        const isOpen = expandedProvenance === provenance;
        return (
          <section key={provenance} className="mb-4 rounded-lg border border-line bg-paper">
            <button
              onClick={() => setExpandedProvenance(isOpen ? null : provenance)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-ink-2">
                {PROVENANCE_LABELS[provenance]} <span className="font-normal text-muted">({items.length})</span>
              </span>
              <span className="text-muted">{isOpen ? "−" : "+"}</span>
            </button>
            {isOpen && (
              <div className="divide-y divide-paper-2 border-t border-paper-2">
                {items.map(({ key, state, impact }) => {
                  const stale = staleBadge(state.staleDays);
                  const rubricSpec = provenance === "rubric" ? RUBRIC_UI_BY_SCORE_ID[key] : undefined;
                  const isRubricExpanded = expandedRubricKey === key;
                  const displayValue = rubricOverrides[key] ?? state.value;
                  return (
                    <div key={key}>
                      <div
                        className={`flex items-center justify-between gap-4 px-4 py-2.5 text-sm ${rubricSpec ? "cursor-pointer hover:bg-paper-2" : ""}`}
                        onClick={rubricSpec ? () => setExpandedRubricKey(isRubricExpanded ? null : key) : undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-ink-2">
                            {key}
                            {rubricSpec && <span className="ml-1 text-muted">{isRubricExpanded ? "▾" : "▸"}</span>}
                          </div>
                          {state.note && <div className="truncate text-xs text-muted">{state.note}</div>}
                          {provenance === "default" && (
                            <div className="text-xs text-muted">No fetched or manual input — contributing nothing to the allocation</div>
                          )}
                          {rubricSpec && !isRubricExpanded && <div className="text-xs text-muted">Click to pick conditions</div>}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {stale && <span className={`text-xs ${stale.className}`}>{stale.label}</span>}
                          {state.confidence && <span className="text-xs text-muted">{state.confidence}</span>}
                          <span className="w-10 text-right font-mono tabular-nums text-muted" title="Impact if this score moved ±10 points">
                            {impact > 0.0005 ? `${(impact * 100).toFixed(1)}pp` : "—"}
                          </span>
                          <span className="w-10 text-right font-mono tabular-nums font-medium text-ink">{formatScore(displayValue)}</span>
                        </div>
                      </div>
                      {rubricSpec && isRubricExpanded && (
                        <div className="px-4 pb-3">
                          <RubricPicker
                            spec={rubricSpec}
                            scoreId={key}
                            currentValue={state.value}
                            onEvaluate={(values) => setRubricOverrides((prev) => ({ ...prev, ...values }))}
                            onSave={handleSaveRubric}
                          />
                        </div>
                      )}
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
