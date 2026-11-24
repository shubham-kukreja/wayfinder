import { useEffect, useMemo, useRef, useState } from "react";
import type { Allocation, Params, ScoreProvenance } from "@wayfinder/engine";
import { GROUP_LABELS, NODE_LABELS } from "@wayfinder/engine";
import { AllocationBar, type AllocationDepth } from "../components/AllocationBar.js";
import { StickyAllocationBar } from "../components/StickyAllocationBar.js";
import { AllocationChanges } from "../components/AllocationChanges.js";
import { WeightEditor } from "../components/WeightEditor.js";
import { CapEditor } from "../components/CapEditor.js";
import { CoreRubricPicker } from "../components/CoreRubricPicker.js";
import { TabRow } from "../components/ui/TabRow.js";
import { formatPct, formatScore } from "../lib/format.js";
import { coreFetch } from "../lib/coreApi.js";
import { draftApi, paramEdits, toParams, type CoreDraft, type DraftEdit } from "../lib/draftApi.js";
import { toAllocation } from "../lib/portfolioApi.js";

// Overrides edits core-jobs-service's shared draft (/v1/draft). Every change
// previews through core's engine (POST /v1/draft/evaluate); Save applies
// them all as one draft change with a reason (PATCH /v1/draft).

interface ScoreRow {
  key: string;
  state: { value: number; staleDays: number | null; note: string | null };
  impact: number;
}

interface RegistryScore {
  key: string;
  layer: string;
  update_type: string;
  value: number | boolean | string | null;
  observed_at: string | null;
  source: string | null;
}

interface LoadedDraft {
  draft: CoreDraft;
  live: Allocation;
  scores: Record<ScoreProvenance, ScoreRow[]>;
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000));
}

async function loadDraft(): Promise<LoadedDraft> {
  const [draft, live, registry, sens] = await Promise.all([
    draftApi.get(),
    draftApi.allocation(),
    coreFetch<{ rows: RegistryScore[] }>("/v1/registry"),
    draftApi.sensitivity().catch(() => ({ rows: [] as Array<{ key: string; impact_pp: number }> })),
  ]);
  const impact = new Map(sens.rows.map((r) => [r.key, r.impact_pp / 100]));
  const scores: Record<ScoreProvenance, ScoreRow[]> = { manual: [], rubric: [], auto: [], static: [], default: [] };
  for (const r of registry.rows) {
    if (r.layer !== "score" || typeof r.value !== "number") continue;
    const provenance: ScoreProvenance = r.update_type === "rubric" ? "rubric" : r.update_type === "constant" ? "static" : r.update_type === "analyst" ? "manual" : "auto";
    scores[provenance].push({
      key: r.key,
      state: { value: r.value, staleDays: daysSince(r.observed_at), note: r.source === "override" ? "Overridden" : null },
      impact: impact.get(r.key) ?? 0,
    });
  }
  for (const list of Object.values(scores)) list.sort((a, b) => b.impact - a.impact);
  return { draft, live: toAllocation(live), scores };
}

export function OverridesView() {
  const [loaded, setLoaded] = useState<LoadedDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () =>
    loadDraft()
      .then(setLoaded)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  useEffect(() => {
    void reload();
  }, []);
  if (error) return <p className="px-6 py-10 text-sm text-danger-500">Failed to load the draft: {error}</p>;
  if (!loaded) return <div className="px-6 py-10 text-sm text-muted">Loading…</div>;
  return <OverridesBody key={loaded.draft.rev} loaded={loaded} onSaved={reload} />;
}

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
// Manual and static scores are set through their own surfaces already (a
// manual score is by definition someone's direct override, and static
// scores don't move) and default-provenance scores contribute nothing to
// the allocation — none of the three belong on a tab whose job is
// overriding what's live. Rubric and auto are the two provenances that
// actually feed the allocation from an external source, so those are the
// only ones worth reviewing and overriding here.
const PROVENANCE_ORDER: ScoreProvenance[] = ["rubric", "auto"];

function staleBadge(staleDays: number | null): { label: string; className: string } | null {
  if (staleDays === null) return null;
  if (staleDays <= 7) return { label: `${staleDays}d`, className: "text-muted" };
  if (staleDays <= 45) return { label: `${staleDays}d stale`, className: "text-warn-600" };
  return { label: `${staleDays}d stale`, className: "text-danger-500" };
}

function OverridesBody({ loaded, onSaved }: { loaded: LoadedDraft; onSaved: () => Promise<void> | void }) {
  const [activeTab, setActiveTab] = useState<OverrideTab>("signals");
  const [depth, setDepth] = useState<AllocationDepth>("detail");

  const savedParams = useMemo(() => toParams(loaded.draft), [loaded.draft]);
  const [params, setParams] = useState<Params>(savedParams);
  const [neutralEditUnlocked, setNeutralEditUnlocked] = useState(false);
  const [fragility, setFragility] = useState<Array<{ rollupId: string; label: string; minObserved: number; maxObserved: number; stable: boolean }> | null>(null);
  const [fragilityBusy, setFragilityBusy] = useState(false);

  // Unsaved score overrides and rubric answers, by score key.
  const [scoreOverrides, setScoreOverrides] = useState<Record<string, number>>({});
  const [rubricAnswers, setRubricAnswers] = useState<Record<string, { answers: Record<string, string>; score: number | null }>>({});
  const [openProvenances, setOpenProvenances] = useState<Set<ScoreProvenance>>(() => new Set(["rubric", "auto"]));
  const [expandedRubricKey, setExpandedRubricKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const liveBarRef = useRef<HTMLElement>(null);
  const liveAllocation = loaded.live;

  const edits = useMemo<DraftEdit[]>(() => {
    const out = paramEdits(loaded.draft, savedParams, params);
    for (const [key, value] of Object.entries(scoreOverrides)) out.push({ op: "set_score", key, value });
    for (const [key, r] of Object.entries(rubricAnswers)) out.push({ op: "set_rubric", key, conditions: r.answers });
    return out;
  }, [loaded.draft, savedParams, params, scoreOverrides, rubricAnswers]);

  // Core previews the edited draft; until it answers, the last preview stays.
  const [allocation, setAllocation] = useState<Allocation>(liveAllocation);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (edits.length === 0) {
      setAllocation(liveAllocation);
      setPreviewError(null);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      draftApi
        .evaluate(loaded.draft.rev, edits, ac.signal)
        .then((p) => {
          setAllocation(toAllocation(p.portfolio));
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (!ac.signal.aborted) setPreviewError(err instanceof Error ? err.message : String(err));
        });
    }, 250);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [edits, liveAllocation, loaded.draft.rev]);

  const groupedScores = loaded.scores;
  const draftScores: Record<string, number> = { ...scoreOverrides };
  for (const [key, r] of Object.entries(rubricAnswers)) if (r.score !== null) draftScores[key] = r.score;

  async function runFragility() {
    if (fragility) {
      setFragility(null);
      return;
    }
    setFragilityBusy(true);
    try {
      const res = await draftApi.fragility(0.1);
      setFragility(
        res.rollups.map((r) => ({
          rollupId: r.node,
          label: NODE_LABELS[r.node as keyof typeof NODE_LABELS] ?? r.node,
          minObserved: r.min,
          maxObserved: r.max,
          stable: r.range_pp < 2,
        })),
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setFragilityBusy(false);
    }
  }

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

  const dirtyScoreEntries = Object.entries(scoreOverrides);
  const isDirty = edits.length > 0;

  function resetDraft() {
    setParams(savedParams);
    setScoreOverrides({});
    setRubricAnswers({});
    setSaveError(null);
  }

  async function handleSave() {
    if (!reason.trim()) {
      setSaveError("Add a reason for this change");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await draftApi.apply(loaded.draft.rev, edits, reason.trim());
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
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
          {previewError && <span className="text-xs text-danger-500">Preview: {previewError}</span>}
          {saveError && <span className="text-xs text-danger-500">Save failed: {saveError}</span>}
          {isDirty && (
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for this change"
              aria-label="Reason for this change"
              maxLength={2000}
              className="w-56 border border-line bg-paper px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink"
            />
          )}
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
                <p className="mt-0.5 text-xs text-muted">How far each line moves when every signal weight is perturbed ±10% (on the saved draft).</p>
              </div>
              <button
                type="button"
                onClick={() => void runFragility()}
                disabled={fragilityBusy}
                className="shrink-0 border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper disabled:opacity-50"
              >
                {fragilityBusy ? "Running…" : fragility ? "Hide" : "Run test"}
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
            Rubric and auto-fetched scores, sorted by how much each can move the allocation — not sheet order. Manual
            and static scores are set on their own surfaces and don&rsquo;t belong on an overrides review.
          </p>

          {dirtyScoreEntries.length > 0 && (
            <div className="mb-4 rounded-lg border border-warn-200 bg-warn-50 px-4 py-2 text-xs text-warn-800">
              Edits below preview through the model straight away. Click "Save overrides" above, with a reason, to apply
              them to the shared draft. Until then they're local to this page and a reload will lose them.
            </div>
          )}

          {PROVENANCE_ORDER.map((provenance) => {
            const items = groupedScores[provenance];
            if (items.length === 0) return null;
            const isOpen = openProvenances.has(provenance);
            return (
              <section key={provenance} className="mb-4 rounded-lg border border-line bg-paper">
                <button
                  type="button"
                  onClick={() =>
                    setOpenProvenances((current) => {
                      const next = new Set(current);
                      if (next.has(provenance)) next.delete(provenance);
                      else next.add(provenance);
                      return next;
                    })
                  }
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
                      const rubricSpec = provenance === "rubric";
                      const isRubricExpanded = expandedRubricKey === key;
                      const value = draftScores[key] ?? state.value;
                      const changed = scoreOverrides[key] !== undefined || rubricAnswers[key] !== undefined;
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
                              <CoreRubricPicker
                                scoreKey={key}
                                answers={rubricAnswers[key]?.answers}
                                onChange={(answers, score) =>
                                  setRubricAnswers((current) => {
                                    const next = { ...current };
                                    if (answers) next[key] = { answers, score };
                                    else delete next[key];
                                    return next;
                                  })
                                }
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
