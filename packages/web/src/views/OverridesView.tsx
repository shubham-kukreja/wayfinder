import { useMemo, useRef, useState } from "react";
import type { Snapshot, Params, ScoreProvenance } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS, RUBRIC_UI_BY_SCORE_ID } from "@wayfinder/engine";
import { scoresFromSnapshot, vetoesFromSnapshot, useLocalAllocation } from "../hooks/useLocalAllocation.js";
import { AllocationBar, type AllocationDepth } from "../components/AllocationBar.js";
import { StickyAllocationBar } from "../components/StickyAllocationBar.js";
import { AllocationChanges } from "../components/AllocationChanges.js";
import { WeightEditor } from "../components/WeightEditor.js";
import { CapEditor } from "../components/CapEditor.js";
import { RubricPicker } from "../components/RubricPicker.js";
import { TabRow } from "../components/ui/TabRow.js";
import { runFragilityTest } from "../lib/fragility.js";
import { computeSensitivity } from "../lib/sensitivity.js";
import { formatPct, formatScore } from "../lib/format.js";
import { saveParams } from "../lib/paramsApi.js";
import { saveScore } from "../lib/scoresApi.js";

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

const OVERRIDE_TABS = [
  { id: "signals", label: "Signal weights" },
  { id: "neutral", label: "Neutral weights" },
  { id: "caps", label: "Tilt and policy caps" },
  { id: "scores", label: "Scores" },
] as const;
type OverrideTab = (typeof OVERRIDE_TABS)[number]["id"];

const DEPTH_OPTIONS: ReadonlyArray<{ id: AllocationDepth; label: string }> = [
  { id: "overview", label: "Asset classes" },
  { id: "detail", label: "Full detail" },
];

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

export function OverridesView({ snapshot }: { snapshot: Snapshot }) {
  const [activeTab, setActiveTab] = useState<OverrideTab>("signals");
  const [depth, setDepth] = useState<AllocationDepth>("detail");

  const [params, setParams] = useState<Params>(snapshot.params);
  // Tracks what's actually persisted server-side (starts as the loaded
  // snapshot's params, updates on a successful save) — comparing `params`
  // against the ORIGINAL snapshot.params prop would keep isDirty stuck true
  // forever after a save, since that prop never changes within this
  // component's lifetime.
  const [lastSavedParams, setLastSavedParams] = useState<Params>(snapshot.params);
  const [neutralEditUnlocked, setNeutralEditUnlocked] = useState(false);
  const [showFragility, setShowFragility] = useState(false);

  // Score overrides use the same "local preview now, explicit save later"
  // split as ParametersView's `params` / `lastSavedParams` pair: keys here
  // are draft edits not yet written to the server, and `persistedScores`
  // layers on top of the snapshot once a save succeeds.
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>({});
  const [persistedScores, setPersistedScores] = useState<Record<string, number>>({});
  const [expandedProvenance, setExpandedProvenance] = useState<ScoreProvenance | null>("manual");
  const [expandedRubricKey, setExpandedRubricKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The full bar is what the sticky strip watches: once this scrolls out of
  // view, the condensed version takes over.
  const liveBarRef = useRef<HTMLElement>(null);

  const liveScores = useMemo(() => ({ ...scoresFromSnapshot(snapshot.scores), ...persistedScores }), [snapshot.scores, persistedScores]);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const liveAllocation = useLocalAllocation(liveScores, vetoes, lastSavedParams);

  const draftScores = useMemo(() => ({ ...liveScores, ...scoreOverrides }), [liveScores, scoreOverrides]);
  const allocation = useLocalAllocation(draftScores, vetoes, params);

  const fragility = useMemo(() => {
    if (!showFragility) return null;
    return runFragilityTest(draftScores, vetoes, params);
  }, [showFragility, draftScores, vetoes, params]);

  const sensitivity = useMemo(() => computeSensitivity(draftScores, vetoes, params), [draftScores, vetoes, params]);
  const sensitivityByKey = useMemo(() => new Map(sensitivity.map((s) => [s.scoreKey, s.impact])), [sensitivity]);

  const groupedScores = useMemo(() => {
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
    for (const p of PROVENANCE_ORDER) out[p].sort((a, b) => b.impact - a.impact);
    return out;
  }, [snapshot.scores, sensitivityByKey]);

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

  function updateScores(values: Record<string, number>) {
    setScoreOverrides((current) => ({ ...current, ...values }));
  }

  const paramsDirty = JSON.stringify(params) !== JSON.stringify(lastSavedParams);
  const dirtyScoreEntries = Object.entries(scoreOverrides);
  const isDirty = paramsDirty || dirtyScoreEntries.length > 0;

  function resetDraft() {
    setParams(lastSavedParams);
    setScoreOverrides({});
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const writes: Array<Promise<unknown>> = [];
      if (paramsDirty) writes.push(saveParams(params));
      for (const [id, value] of dirtyScoreEntries) {
        writes.push(saveScore(id, value, "Manual override from Overrides"));
      }
      await Promise.all(writes);
      if (paramsDirty) setLastSavedParams(params);
      if (dirtyScoreEntries.length > 0) {
        setPersistedScores((current) => ({ ...current, ...Object.fromEntries(dirtyScoreEntries) }));
        setScoreOverrides({});
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRubric(values: Record<string, number>) {
    await Promise.all(Object.entries(values).map(([id, value]) => saveScore(id, value)));
    setPersistedScores((current) => ({ ...current, ...values }));
    setScoreOverrides((current) => {
      const next = { ...current };
      for (const id of Object.keys(values)) delete next[id];
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="mb-1 font-display text-xl text-ink">Overrides</h1>
          <p className="max-w-[72ch] text-sm text-muted">
            Tune policy parameters, record analyst judgements, or replace model-filled scores. Every draft change uses the same allocation engine as the rest of the platform.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {saveError && <span className="text-xs text-danger-500">Save failed: {saveError}</span>}
          {!saveError && !isDirty && <span className="text-xs text-brand-800">Saved</span>}
          {isDirty && <span className="text-xs text-warn-600">Unsaved changes</span>}
          <button
            type="button"
            onClick={resetDraft}
            disabled={!isDirty || saving}
            className="border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="bg-ink px-4 py-1.5 text-xs font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save overrides"}
          </button>
        </div>
      </div>

      <StickyAllocationBar allocation={allocation} watch={liveBarRef} />

      <section ref={liveBarRef} className="mb-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Live allocation</h2>
            <p className="mt-0.5 text-xs text-muted">Previewed from the complete draft, before anything is saved.</p>
          </div>
          <TabRow options={DEPTH_OPTIONS} value={depth} onChange={setDepth} className="overflow-x-auto" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="border border-line bg-paper p-4 sm:p-5">
            <AllocationBar allocation={allocation} depth={depth} />
          </div>
          <AllocationChanges live={liveAllocation} draft={allocation} depth={depth} />
        </div>
      </section>

      <TabRow options={OVERRIDE_TABS} value={activeTab} onChange={setActiveTab} className="mb-6 overflow-x-auto whitespace-nowrap" />

      {activeTab === "signals" && (
        <section>
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
      )}

      {activeTab === "neutral" && (
        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Neutral weights</h2>
              <p className="text-xs text-muted">The policy baseline each node tilts away from. Reviewed annually, not automated.</p>
            </div>
            {!neutralEditUnlocked ? (
              <button
                type="button"
                onClick={() => setNeutralEditUnlocked(true)}
                className="w-fit border border-ink px-2.5 py-1 text-[11px] font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2 active:translate-y-px"
              >
                Unlock to edit
              </button>
            ) : (
              <span className="w-fit border border-warn-200 bg-warn-50 px-2.5 py-1 text-[11px] font-medium text-warn-600">Editing policy weights</span>
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
      )}

      {activeTab === "caps" && (
        <section className="space-y-6">
          <div>
            <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Tilt and policy caps</h2>
            <p className="mb-4 text-xs text-muted">Guardrails that limit how far the model can move from policy in one review cycle.</p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="border border-line bg-paper">
                <div className="border-b border-line bg-paper-2 px-4 py-2.5"><h3 className="text-[13px] font-semibold text-ink">Max tilt</h3></div>
                <div className="divide-y divide-line">
                  <CapEditor label="L1 asset classes" value={params.maxTilt.l1} onChange={(value) => updateMaxTilt("l1", value)} />
                  <CapEditor label="Equity segments" value={params.maxTilt.equity} onChange={(value) => updateMaxTilt("equity", value)} />
                  <CapEditor label="Debt buckets" value={params.maxTilt.debt} onChange={(value) => updateMaxTilt("debt", value)} />
                  <CapEditor label="Gold/Silver split" value={params.maxTilt.metals} onChange={(value) => updateMaxTilt("metals", value)} />
                </div>
              </div>
              <div className="border border-line bg-paper">
                <div className="border-b border-line bg-paper-2 px-4 py-2.5"><h3 className="text-[13px] font-semibold text-ink">Sector satellite</h3></div>
                <div className="divide-y divide-line">
                  <CapEditor label="Sleeve cap (% of Equity)" value={params.sector.sleeveCap} onChange={(value) => updateSectorCap("sleeveCap", value)} />
                  <CapEditor label="Max sectors held" value={params.sector.maxSectors} onChange={(value) => updateSectorCap("maxSectors", value)} isPercent={false} min={1} max={8} step={1} />
                  <CapEditor label="Qualification threshold" value={params.sector.threshold} onChange={(value) => updateSectorCap("threshold", value)} isPercent={false} min={0} max={100} step={1} />
                  <CapEditor label="Max consecutive quarters" value={params.sector.maxConsecutiveQuarters} onChange={(value) => updateSectorCap("maxConsecutiveQuarters", value)} isPercent={false} min={1} max={12} step={1} />
                </div>
              </div>
            </div>
          </div>

          <div className="border border-line bg-paper">
            <div className="border-b border-line bg-paper-2 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Normalisation</h2>
            </div>
            <div className="flex gap-0 p-5">
              {/* Segmented control: buttons share a border rather than sitting as
                  separate pills, matching the tab rows elsewhere in the app. */}
              {(["proportional", "zero_sum"] as const).map((mode, i) => (
                <button
                  key={mode}
                  type="button"
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
          </div>

          <div className="border border-line bg-paper">
            <div className="flex items-center justify-between border-b border-line bg-paper-2 px-5 py-3">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Fragility test</h2>
                <p className="mt-0.5 text-xs text-muted">How far each rollup moves when every weight is perturbed ±10%.</p>
              </div>
              <button
                type="button"
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
                    <span className={`font-mono text-[13px] tabular-nums ${f.stable ? "text-muted" : "font-medium text-warn-600"}`}>
                      {formatPct(f.minObserved)} – {formatPct(f.maxObserved)}
                      {!f.stable && " · unstable"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {activeTab === "scores" && (
        <section>
          <h2 className="mb-1 font-display text-base font-bold tracking-display text-ink">Scores</h2>
          <p className="mb-4 text-xs text-muted">
            All 85 scores, split by provenance and sorted by how much they can move the allocation — not sheet order.
          </p>

          {dirtyScoreEntries.length > 0 && (
            <div className="mb-4 rounded-lg border border-warn-200 bg-warn-50 px-4 py-2 text-xs text-warn-800">
              Edits below update the live preview instantly. Click "Save overrides" above to persist them to the server —
              until then they're local to this page and a reload will lose them.
            </div>
          )}

          {PROVENANCE_ORDER.map((provenance) => {
            const items = groupedScores[provenance];
            if (items.length === 0) return null;
            const isOpen = expandedProvenance === provenance;
            return (
              <section key={provenance} className="mb-4 rounded-lg border border-line bg-paper">
                <button
                  type="button"
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
                      const value = draftScores[key] ?? state.value;
                      const changed = scoreOverrides[key] !== undefined;
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
                              <span className="flex items-center gap-1 text-[11px]">
                                {stale && <span className={stale.className}>{stale.label}</span>}
                                {changed && <span className="font-semibold text-warn-600">Draft override</span>}
                              </span>
                              <span className="w-10 text-right font-mono tabular-nums text-muted" title="Impact if this score moved ±10 points">
                                {impact > 0.0005 ? `${(impact * 100).toFixed(1)}pp` : "—"}
                              </span>
                              {!rubricSpec ? (
                                <input
                                  type="number"
                                  aria-label={`Override ${key}`}
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={value}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (Number.isFinite(next)) updateScores({ [key]: Math.min(100, Math.max(0, next)) });
                                  }}
                                  className="w-20 border border-line bg-paper px-2 py-1 text-right font-mono text-sm tabular-nums text-ink outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                                />
                              ) : (
                                <span className="w-10 text-right font-mono tabular-nums font-medium text-ink">{formatScore(value)}</span>
                              )}
                            </div>
                          </div>
                          {rubricSpec && isRubricExpanded && (
                            <div className="px-4 pb-3">
                              <RubricPicker
                                spec={rubricSpec}
                                scoreId={key}
                                currentValue={state.value}
                                onEvaluate={(values) => updateScores(values)}
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
        </section>
      )}
    </main>
  );
}
