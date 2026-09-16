import { useMemo, useState } from "react";
import type { Snapshot, Params } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot, useLocalAllocation } from "../hooks/useLocalAllocation.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { WeightEditor } from "../components/WeightEditor.js";
import { CapEditor } from "../components/CapEditor.js";
import { runFragilityTest } from "../lib/fragility.js";
import { formatPct } from "../lib/format.js";
import { saveParams } from "../lib/paramsApi.js";

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

export function ParametersView({ snapshot }: { snapshot: Snapshot }) {
  const [params, setParams] = useState<Params>(snapshot.params);
  // Tracks what's actually persisted server-side (starts as the loaded
  // snapshot's params, updates on a successful save) — comparing `params`
  // against the ORIGINAL snapshot.params prop would keep isDirty stuck
  // true forever after a save, since that prop never changes within this
  // component's lifetime.
  const [lastSavedParams, setLastSavedParams] = useState<Params>(snapshot.params);
  const [neutralEditUnlocked, setNeutralEditUnlocked] = useState(false);
  const [showFragility, setShowFragility] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  function updateMaxTilt(group: (typeof TILT_GROUPS)[number], value: number) {
    setParams((p) => ({ ...p, maxTilt: { ...p.maxTilt, [group]: value } }));
  }

  function updateSectorCap<K extends keyof Params["sector"]>(key: K, value: Params["sector"][K]) {
    setParams((p) => ({ ...p, sector: { ...p.sector, [key]: value } }));
  }

  const isDirty = JSON.stringify(params) !== JSON.stringify(lastSavedParams);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveParams(params);
      setLastSavedParams(params);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="mb-1 font-display text-xl text-ink">Parameters</h1>
          <p className="text-sm text-muted">
            Every weight, cap and threshold is editable. Recomputes locally, no network call — saving writes it to the
            server so it applies everywhere and survives a reload. See{" "}
            <a href="/methodology" className="font-medium text-ink-2 underline">
              Methodology
            </a>{" "}
            for what each one means and why.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveError && <span className="text-xs text-danger-500">Save failed: {saveError}</span>}
          {!saveError && !isDirty && <span className="text-xs text-brand-800">Saved</span>}
          {isDirty && <span className="text-xs text-warn-600">Unsaved changes</span>}
          <button
            onClick={() => setParams(lastSavedParams)}
            disabled={!isDirty}
            className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white transition duration-100 ease-in hover:brightness-105 hover:-translate-y-px disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <section className="mb-8 rounded-lg border border-line bg-paper p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Live allocation</h2>
        <p className="mb-3 text-xs text-muted">Recomputed live from the weights and caps below, using the same allocation bar as Overview.</p>
        <AllocationBar allocation={allocation} depth="detail" />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-2">Signal weights</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          <h2 className="text-sm font-semibold text-ink-2">Neutral weights (policy)</h2>
          {!neutralEditUnlocked ? (
            <button
              onClick={() => setNeutralEditUnlocked(true)}
              className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-paper-2"
            >
              Unlock to edit
            </button>
          ) : (
            <span className="text-xs font-medium text-warn-600">Editing policy weights — reviewed annually, not automated</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-2">Tilt caps</h2>
        <p className="mb-3 text-xs text-muted">The maximum a node can move away from its neutral weight in a single review cycle. See Methodology for the reasoning behind each cap.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-line bg-paper p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink-2">Max tilt</h3>
            <div className="space-y-2">
              <CapEditor label="L1 asset classes" value={params.maxTilt.l1} onChange={(v) => updateMaxTilt("l1", v)} />
              <CapEditor label="Equity segments" value={params.maxTilt.equity} onChange={(v) => updateMaxTilt("equity", v)} />
              <CapEditor label="Debt buckets" value={params.maxTilt.debt} onChange={(v) => updateMaxTilt("debt", v)} />
              <CapEditor label="Gold/Silver split" value={params.maxTilt.metals} onChange={(v) => updateMaxTilt("metals", v)} />
            </div>
          </div>
          <div className="rounded-lg border border-line bg-paper p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink-2">Sector satellite</h3>
            <div className="space-y-2">
              <CapEditor label="Sleeve cap (% of Equity)" value={params.sector.sleeveCap} onChange={(v) => updateSectorCap("sleeveCap", v)} />
              <CapEditor label="Max sectors held" value={params.sector.maxSectors} onChange={(v) => updateSectorCap("maxSectors", v)} isPercent={false} min={1} max={8} step={1} />
              <CapEditor label="Qualification threshold" value={params.sector.threshold} onChange={(v) => updateSectorCap("threshold", v)} isPercent={false} min={0} max={100} step={1} />
              <CapEditor label="Max consecutive quarters" value={params.sector.maxConsecutiveQuarters} onChange={(v) => updateSectorCap("maxConsecutiveQuarters", v)} isPercent={false} min={1} max={12} step={1} />
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-line bg-paper p-5">
        <h2 className="mb-2 text-sm font-semibold text-ink-2">Normalisation</h2>
        <div className="flex gap-2">
          {(["proportional", "zero_sum"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setParams((p) => ({ ...p, normalisation: mode }))}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                params.normalisation === mode ? "bg-brand-500 text-white" : "border border-line text-ink-2"
              }`}
            >
              {mode === "proportional" ? "Proportional (default)" : "Zero-sum"}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-2">Fragility test</h2>
          <button
            onClick={() => setShowFragility((v) => !v)}
            className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-paper-2"
          >
            {showFragility ? "Hide" : "Run: perturb every weight ±10%"}
          </button>
        </div>
        {fragility && (
          <ul className="space-y-1.5 text-sm">
            {fragility.map((f) => (
              <li key={f.rollupId} className="flex items-center justify-between gap-4">
                <span className="text-ink-2">{f.label}</span>
                <span className={`tabular-nums ${f.stable ? "text-muted" : "text-warn-600 font-medium"}`}>
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
