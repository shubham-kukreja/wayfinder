import { useMemo, useState } from "react";
import type { Snapshot, Params } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot, useLocalAllocation } from "../hooks/useLocalAllocation.js";
import { WeightEditor } from "../components/WeightEditor.js";
import { runFragilityTest } from "../lib/fragility.js";
import { formatPct } from "../lib/format.js";

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

export function ParametersView({ snapshot }: { snapshot: Snapshot }) {
  const [params, setParams] = useState<Params>(snapshot.params);
  const [neutralEditUnlocked, setNeutralEditUnlocked] = useState(false);
  const [showFragility, setShowFragility] = useState(false);

  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const allocation = useLocalAllocation(scores, vetoes, params);

  const fragility = useMemo(() => {
    if (!showFragility) return null;
    return runFragilityTest(scores, vetoes, params);
  }, [showFragility, scores, vetoes, params]);

  function updateSignalWeights(group: (typeof TILT_GROUPS)[number] | "sector", next: Record<string, number>) {
    setParams((p) => ({ ...p, signalWeights: { ...p.signalWeights, [group]: next } as Params["signalWeights"] }));
  }

  function updateNeutralWeights(group: (typeof TILT_GROUPS)[number], next: Record<string, number>) {
    setParams((p) => ({ ...p, neutralWeights: { ...p.neutralWeights, [group]: next } as Params["neutralWeights"] }));
  }

  const isDirty = JSON.stringify(params) !== JSON.stringify(snapshot.params);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-1 text-xl font-semibold text-neutral-900">Parameters</h1>
          <p className="text-sm text-neutral-500">Every weight, cap and threshold is editable. Recomputes locally, no network call.</p>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && <span className="text-xs text-amber-600">Unsaved — not yet a review</span>}
          <button
            onClick={() => setParams(snapshot.params)}
            disabled={!isDirty}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">Live allocation</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {allocation.rollup.map((r) => (
            <span key={r.id} className="tabular-nums text-neutral-700">
              {r.label}: <span className="font-medium">{formatPct(r.portfolioWeight)}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Signal weights</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TILT_GROUPS.map((group) => (
            <WeightEditor
              key={group}
              title={GROUP_LABELS[group] ?? group}
              weights={params.signalWeights[group]}
              onChange={(next) => updateSignalWeights(group, next)}
            />
          ))}
          <WeightEditor title="Sector" weights={params.signalWeights.sector} onChange={(next) => updateSignalWeights("sector", next)} />
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">Neutral weights (policy)</h2>
          {!neutralEditUnlocked ? (
            <button
              onClick={() => setNeutralEditUnlocked(true)}
              className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100"
            >
              Unlock to edit
            </button>
          ) : (
            <span className="text-xs font-medium text-amber-700">Editing policy weights — reviewed annually, not automated</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TILT_GROUPS.map((group) => (
            <div key={group} className={neutralEditUnlocked ? "" : "pointer-events-none opacity-60"}>
              <WeightEditor
                title={GROUP_LABELS[group] ?? group}
                weights={params.neutralWeights[group]}
                labels={NODE_LABELS}
                onChange={(next) => updateNeutralWeights(group, next)}
                friction
              />
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-800">Normalisation</h2>
        <div className="flex gap-2">
          {(["proportional", "zero_sum"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setParams((p) => ({ ...p, normalisation: mode }))}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                params.normalisation === mode ? "bg-neutral-900 text-white" : "border border-neutral-200 text-neutral-600"
              }`}
            >
              {mode === "proportional" ? "Proportional (default)" : "Zero-sum"}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Fragility test</h2>
          <button
            onClick={() => setShowFragility((v) => !v)}
            className="rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          >
            {showFragility ? "Hide" : "Run: perturb every weight ±10%"}
          </button>
        </div>
        {fragility && (
          <ul className="space-y-1.5 text-sm">
            {fragility.map((f) => (
              <li key={f.rollupId} className="flex items-center justify-between gap-4">
                <span className="text-neutral-700">{f.label}</span>
                <span className={`tabular-nums ${f.stable ? "text-neutral-500" : "text-amber-600 font-medium"}`}>
                  {formatPct(f.minObserved)} – {formatPct(f.maxObserved)} {!f.stable && "· unstable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
