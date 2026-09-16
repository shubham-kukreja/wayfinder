import { useMemo, useRef, useState } from "react";
import type { Snapshot, Params } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot, useLocalAllocation } from "../hooks/useLocalAllocation.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { StickyAllocationBar } from "../components/StickyAllocationBar.js";
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
  // The full bar is what the sticky strip watches: once this scrolls out of
  // view, the condensed version takes over.
  const liveBarRef = useRef<HTMLElement>(null);

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
            className="border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-40"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="bg-ink px-4 py-1.5 text-xs font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] disabled:pointer-events-none disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <StickyAllocationBar allocation={allocation} watch={liveBarRef} />

      <section ref={liveBarRef} className="mb-10 border border-line bg-paper">
        <div className="border-b border-line bg-paper-2 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Live allocation</h2>
          <p className="mt-0.5 text-xs text-muted">
            Recomputed live from the weights and caps below, using the same allocation bar as Overview.
          </p>
        </div>
        <div className="p-5">
          <AllocationBar allocation={allocation} depth="detail" />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Signal weights</h2>
        <p className="mb-4 text-xs text-muted">How much each signal contributes to a node&rsquo;s composite score.</p>
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

      <section className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <div>
            <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Neutral weights (policy)</h2>
            <p className="text-xs text-muted">The baseline each node tilts away from. Reviewed annually, not automated.</p>
          </div>
          {!neutralEditUnlocked ? (
            <button
              onClick={() => setNeutralEditUnlocked(true)}
              className="border border-ink px-2.5 py-1 text-[11px] font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2"
            >
              Unlock to edit
            </button>
          ) : (
            <span className="border border-warn-200 bg-warn-50 px-2.5 py-1 text-[11px] font-medium text-warn-600">
              Editing policy weights
            </span>
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

      <section className="mb-10">
        <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Tilt caps</h2>
        <p className="mb-4 text-xs text-muted">
          The maximum a node can move away from its neutral weight in a single review cycle. See Methodology for the
          reasoning behind each cap.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="border border-line bg-paper">
            <div className="border-b border-line bg-paper-2 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-ink">Max tilt</h3>
            </div>
            <div className="divide-y divide-line">
              <CapEditor label="L1 asset classes" value={params.maxTilt.l1} onChange={(v) => updateMaxTilt("l1", v)} />
              <CapEditor label="Equity segments" value={params.maxTilt.equity} onChange={(v) => updateMaxTilt("equity", v)} />
              <CapEditor label="Debt buckets" value={params.maxTilt.debt} onChange={(v) => updateMaxTilt("debt", v)} />
              <CapEditor label="Gold/Silver split" value={params.maxTilt.metals} onChange={(v) => updateMaxTilt("metals", v)} />
            </div>
          </div>
          <div className="border border-line bg-paper">
            <div className="border-b border-line bg-paper-2 px-4 py-2.5">
              <h3 className="text-[13px] font-semibold text-ink">Sector satellite</h3>
            </div>
            <div className="divide-y divide-line">
              <CapEditor label="Sleeve cap (% of Equity)" value={params.sector.sleeveCap} onChange={(v) => updateSectorCap("sleeveCap", v)} />
              <CapEditor label="Max sectors held" value={params.sector.maxSectors} onChange={(v) => updateSectorCap("maxSectors", v)} isPercent={false} min={1} max={8} step={1} />
              <CapEditor label="Qualification threshold" value={params.sector.threshold} onChange={(v) => updateSectorCap("threshold", v)} isPercent={false} min={0} max={100} step={1} />
              <CapEditor label="Max consecutive quarters" value={params.sector.maxConsecutiveQuarters} onChange={(v) => updateSectorCap("maxConsecutiveQuarters", v)} isPercent={false} min={1} max={12} step={1} />
            </div>
          </div>
        </div>
      </section>

      <section className="mb-10 border border-line bg-paper">
        <div className="border-b border-line bg-paper-2 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">Normalisation</h2>
        </div>
        <div className="flex gap-0 p-5">
          {/* Segmented control: buttons share a border rather than sitting as
              separate pills, matching the tab rows elsewhere in the app. */}
          {(["proportional", "zero_sum"] as const).map((mode, i) => (
            <button
              key={mode}
              onClick={() => setParams((p) => ({ ...p, normalisation: mode }))}
              className={`border px-4 py-2 text-xs font-semibold transition duration-100 ease-in ${i > 0 ? "-ml-px" : ""} ${
                params.normalisation === mode
                  ? "relative border-ink bg-ink text-paper"
                  : "border-line bg-paper text-ink-2 hover:bg-paper-2"
              }`}
            >
              {mode === "proportional" ? "Proportional (default)" : "Zero-sum"}
            </button>
          ))}
        </div>
      </section>

      <section className="border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line bg-paper-2 px-5 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Fragility test</h2>
            <p className="mt-0.5 text-xs text-muted">How far each rollup moves when every weight is perturbed ±10%.</p>
          </div>
          <button
            onClick={() => setShowFragility((v) => !v)}
            className="shrink-0 border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper"
          >
            {showFragility ? "Hide" : "Run test"}
          </button>
        </div>
        {fragility && (
          <ul className="divide-y divide-line">
            {fragility.map((f) => (
              <li key={f.rollupId} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <span className="text-[13px] text-ink-2">{f.label}</span>
                <span
                  className={`font-mono text-[13px] tabular-nums ${f.stable ? "text-muted" : "font-medium text-warn-600"}`}
                >
                  {formatPct(f.minObserved)} – {formatPct(f.maxObserved)}
                  {!f.stable && " · unstable"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
