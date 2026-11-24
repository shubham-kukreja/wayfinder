import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ScoreState, SeriesState, Snapshot } from "@wayfinder/engine";
import { SCORE_MAP, scoreMapEntry, seriesRole } from "@wayfinder/engine";
import { listDataPoints, listRefreshSources, refreshDataPoints, type DataPointFreshness, type DataPointRow } from "../lib/datapointsApi.js";
import { DistributionStrip } from "../components/DistributionStrip.js";
import { ExplainBreakdown, useExplanation } from "../components/CoreExplain.js";
import { UpstreamSeriesRow } from "../components/UpstreamSeriesRow.js";
import { formatScore } from "../lib/format.js";

// The page's tab row can group the same 110 rows three different ways —
// a dropdown ("Group by") picks the mode, and the tab SET underneath it
// changes to match. Every mode partitions all 110 rows; none of them
// hide a row, they just draw the lines between groups differently.
//
//   assetClass — Equity/Debt/Metals fold in their matching L1 tilt AND
//     (for Equity only) the Sector Satellite cells, so "Equity" means
//     everything that moves the equity sleeve at a glance.
//   signalGroup — the same asset folding, minus Sector: it gets its own
//     tab instead of hiding inside Equity. This is the finer-grained
//     view for someone who specifically wants to review sector cells as
//     their own set.
//   status — ignores asset class entirely and groups by trust/freshness
//     state instead (is this real, is it fresh, does it need a person).
// Governance and Veto are their own tab in both asset-based modes (they
// are not an asset class), and simply land wherever their status puts
// them in status mode (typically "Live").
type GroupMode = "assetClass" | "signalGroup" | "status";

const GROUP_MODE_OPTIONS: ReadonlyArray<{ id: GroupMode; label: string }> = [
  { id: "assetClass", label: "Asset class" },
  { id: "signalGroup", label: "Signal group" },
  { id: "status", label: "Status" },
];

function groupModeFromSearch(value: string | null): GroupMode {
  return value === "signalGroup" || value === "status" ? value : "assetClass";
}

type TabId =
  | "equity" | "debt" | "metals" | "governance" | "vetoes" // assetClass
  | "equitySegments" | "debtBuckets" | "sector" // signalGroup-only ids (metals/governance/vetoes reused above)
  | "live" | "stale" | "mock" | "opt_in" | "constant"; // status

const TAB_OPTIONS_BY_MODE: Record<GroupMode, ReadonlyArray<{ id: TabId; label: string }>> = {
  assetClass: [
    { id: "equity", label: "Equity" },
    { id: "debt", label: "Debt" },
    { id: "metals", label: "Precious Metals" },
    { id: "governance", label: "Governance" },
    { id: "vetoes", label: "Veto" },
  ],
  signalGroup: [
    { id: "equitySegments", label: "Equity Segments" },
    { id: "debtBuckets", label: "Debt Buckets" },
    { id: "metals", label: "Precious Metals" },
    { id: "sector", label: "Sector Satellite" },
    { id: "governance", label: "Governance" },
    { id: "vetoes", label: "Veto" },
  ],
  status: [
    { id: "live", label: "Live" },
    { id: "stale", label: "Stale" },
    { id: "mock", label: "Mock" },
    { id: "opt_in", label: "Analyst input" },
    { id: "constant", label: "Constants" },
  ],
};

function tabOf(row: DataPointRow, mode: GroupMode): TabId {
  if (mode === "status") {
    // A row can be both stale and mock at once; mock is the louder,
    // more actionable fact (a placeholder outranks "also overdue"), so
    // it's checked first. Analyst-input and Constants are update-type
    // facts that don't compete with freshness the same way, so they're
    // checked ahead of plain "live" but behind "mock".
    if (row.mock) return "mock";
    if (row.updateType === "opt_in") return "opt_in";
    if (row.updateType === "constant") return "constant";
    if (row.freshness === "stale") return "stale";
    return "live";
  }
  if (row.modelGroup === "governance") return "governance";
  if (row.modelGroup === "vetoes") return "vetoes";
  if (mode === "signalGroup" && row.modelGroup === "sector") return "sector";
  if (row.id.startsWith("l1.equity::") || row.modelGroup === "equity" || (mode === "assetClass" && row.modelGroup === "sector")) {
    return mode === "signalGroup" ? "equitySegments" : "equity";
  }
  if (row.id.startsWith("l1.debt::") || row.modelGroup === "debt") return mode === "signalGroup" ? "debtBuckets" : "debt";
  return "metals"; // l1.metals::* or modelGroup === "metals"
}


// Freshness is the page's one colour axis, so each state gets a fixed hue
// from the system palette and keeps it everywhere it appears — the tab dot,
// the row chip and the detail panel all read as the same state at a glance.
// `dot`/`text`/`chip` are the same hue at three intensities.
const FRESHNESS_STYLE: Record<
  DataPointFreshness,
  { dot: string; text: string; chip: string; blurb: string }
> = {
  current: {
    dot: "bg-brand-500",
    text: "text-brand-800",
    chip: "bg-brand-50 text-brand-800",
    blurb: "Refreshed within its expected cadence.",
  },
  stale: {
    dot: "bg-warn",
    text: "text-warn-600",
    chip: "bg-warn-50 text-warn-800",
    blurb: "Past its refresh window; the stored value may no longer hold.",
  },
  failed: {
    dot: "bg-danger-500",
    text: "text-danger-500",
    chip: "bg-danger-50 text-danger-500",
    blurb: "The last refresh attempt errored; the value shown is the prior one.",
  },
  missing: {
    dot: "bg-line",
    text: "text-muted",
    chip: "bg-paper-2 text-muted",
    blurb: "No observation has ever been stored for this point.",
  },
  overridden: {
    dot: "bg-periwinkle",
    text: "text-indigo",
    chip: "bg-lilac text-indigo",
    blurb: "A manual value is in force, taking precedence over the feed.",
  },
};

function formatValue(row: DataPointRow): string {
  if (row.currentValue === null) return "-";
  if (typeof row.currentValue === "boolean") return row.currentValue ? "Active" : "Inactive";
  if (typeof row.currentValue === "number") return row.unit === "score" ? formatScore(row.currentValue) : row.currentValue.toLocaleString("en-IN");
  return row.currentValue;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatSeriesValue(series: SeriesState | undefined): string {
  if (!series || series.latest === null) return "-";
  return series.latest.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function isExternalSeries(series: SeriesState | undefined): boolean {
  return !!series && series.source !== "MANUAL";
}

function isStaleSeries(series: SeriesState | undefined): boolean {
  return !!series && (series.status === "stale" || !!series.error || (series.staleDays !== null && series.staleDays > 7));
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// A percentile strip answers "where does this reading sit in its own
// history" — which is only part of the ANSWER when the score is actually
// computed that way. "percentile"/"inverted"/"average" rank against
// history; "rubric"/"static"/"none" do not. A rubric cell reads the
// latest one or two values (l1.equity::macro reads a 6-month DIRECTION,
// metals.silver::industrial reads latest vs prior), so showing it a
// distribution strip invites the reader to attribute the score to a
// percentile that never entered the calculation — and renders a bare
// "—" for any series below the percentile floor, which reads as missing
// data even when the input is feeding the score correctly.
function usesPercentile(scoreState: ScoreState | undefined): boolean {
  if (!scoreState) return false;
  return scoreState.transform === "percentile" || scoreState.transform === "inverted" || scoreState.transform === "average";
}

function transformExplanation(scoreState: ScoreState): string {
  if (scoreState.transform === "percentile") {
    return "The latest reading is ranked against its own stored history. Higher readings score higher.";
  }
  if (scoreState.transform === "inverted") {
    return "The latest reading is ranked against its own stored history, then flipped because lower readings are more attractive.";
  }
  if (scoreState.transform === "average") {
    return "Multiple ranked inputs are combined by the backend into one score.";
  }
  if (scoreState.transform === "rubric") {
    return "A rubric maps the source reading into a score band.";
  }
  if (scoreState.transform === "static") {
    return "This is a policy baseline, not a market feed.";
  }
  return "This value is carried through without a percentile transform.";
}

function scoreFormulaLine(scoreState: ScoreState): string {
  if (scoreState.transform === "percentile") return `score = percentile = ${formatScore(scoreState.value)}`;
  if (scoreState.transform === "inverted") {
    const rawPercentile = 100 - scoreState.value;
    return `score = 100 - ${rawPercentile.toFixed(1)} = ${formatScore(scoreState.value)}`;
  }
  if (scoreState.transform === "static") return `static score = ${formatScore(scoreState.value)}`;
  if (scoreState.transform === "rubric") return `rubric score = ${formatScore(scoreState.value)}`;
  if (scoreState.transform === "average") return `combined score = ${formatScore(scoreState.value)}`;
  return `score = ${formatScore(scoreState.value)}`;
}

function declaredSourceIds(scoreId: string): string[] {
  return SCORE_MAP.find((cell) => cell.scoreId === scoreId)?.series ?? [];
}

function effectiveSourceIds(row: DataPointRow, scoreState: ScoreState | undefined): string[] {
  const rowSeries = row.upstreamSeries;
  if (rowSeries.length > 0 && !rowSeries.includes("series:example")) return rowSeries;

  const scoreSeries = scoreState?.derivedFrom ?? [];
  if (scoreSeries.length > 0 && !scoreSeries.includes("series:example")) return scoreSeries;

  return declaredSourceIds(row.id);
}

// Sub-grouping inside an asset tab: still by modelGroup, so "Equity"
// shows Equity Segments, Sector Satellite and L1 as separate sections
// rather than one flat list.
function groupKey(row: DataPointRow): string {
  return row.modelGroup;
}

// Generic title-casing, with explicit overrides where the raw key is a
// poor label for a reader. "opt_in" is the live case: it is the
// updateType for cells that have a real rubric but no feed that can
// answer it (the 8 sector cycle-position cells), and "Opt In" says
// nothing about what the row needs from you.
const GROUP_LABEL_OVERRIDES: Record<string, string> = {
  opt_in: "Needs analyst input",
};

function groupLabel(key: string): string {
  return GROUP_LABEL_OVERRIDES[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// Score-cell registry ids are exactly `${nodeId}::${signalId}` (e.g.
// "l1.equity::valuation") - governance ids are prefixed "governance."
// and veto ids "veto.", so this alone is enough to tell "has a real
// formula/contribution breakdown via CalculationInspector" apart from
// "is a plain parameter or risk gate with no such breakdown."
function isScoreCellId(id: string): boolean {
  return id.includes("::") && !id.startsWith("governance.") && !id.startsWith("veto.");
}

function tabFromSearch(mode: GroupMode, value: string | null): TabId {
  const options = TAB_OPTIONS_BY_MODE[mode];
  const match = options.find((option) => option.id === value);
  return (match ?? options[0]!).id;
}

// "View exact formula": core's explanation of how the value was formed
// (GET /v1/series/{key}/explain).
function DataPointFormulaModal({ row, onClose }: { row: DataPointRow | null; onClose: () => void }) {
  const { data, error, loading } = useExplanation(row?.technicalKey ?? null);
  useEffect(() => {
    if (!row) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  if (!row) return null;
  const sourceLabel = data?.sources.length ? data.sources.join(" + ") : row.source;
  const observedAt = data?.observed ?? row.observedAt;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/30 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="data-point-formula-title">
      <div className="mx-auto w-full max-w-3xl rounded-lg border border-line bg-paper p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Exact Formula</p>
            <h2 id="data-point-formula-title" className="mt-1 text-xl font-semibold text-ink">
              {row.label}
            </h2>
            <p className="mt-1 break-all text-[13px] text-muted">{row.technicalKey}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close formula breakdown"
            className="shrink-0 rounded-sm p-1.5 text-muted transition-colors duration-100 ease-in hover:bg-paper-2 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-b border-line pb-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Value</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800">
              {row.score !== null ? formatScore(row.score) : typeof row.currentValue === "number" ? formatScore(row.currentValue) : "-"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Source</p>
            <p className="mt-1 truncate text-[13px] font-semibold text-ink">{sourceLabel}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Observed</p>
            <p className="mt-1 text-[13px] font-semibold text-ink">{formatDate(observedAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Freshness</p>
            <p className="mt-1 text-[13px] font-semibold text-ink">{groupLabel(row.freshness)}</p>
          </div>
        </div>

        <div className="mt-4">
          {loading && <p className="text-[13px] text-muted">Loading the calculation…</p>}
          {error && <p className="text-[13px] text-danger-500">Could not load the calculation: {error}</p>}
          {data && <ExplainBreakdown explanation={data} />}
        </div>
      </div>
    </div>
  );
}

export function DataPointControlCenterView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupMode = groupModeFromSearch(searchParams.get("group"));
  const activeTab = tabFromSearch(groupMode, searchParams.get("tab"));
  const query = searchParams.get("q") ?? "";
  const selectedId = searchParams.get("point");
  const inspectingId = searchParams.get("inspect");

  const [rows, setRows] = useState<DataPointRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({ total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshSource, setRefreshSource] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  // Sources core can fetch on demand (those with a connector).
  const [refreshSources, setRefreshSources] = useState<Array<{ id: string; label: string }>>([]);

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      const result = await listDataPoints();
      setRows(result.rows);
      setSummary(result.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
    listRefreshSources()
      .then(setRefreshSources)
      .catch(() => setRefreshSources([]));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const message = await refreshDataPoints(refreshSource);
      await loadRows();
      setRefreshMessage(message);
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const tabRows = useMemo(() => rows.filter((row) => tabOf(row, groupMode) === activeTab), [rows, groupMode, activeTab]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tabRows.filter(
      (row) =>
        !needle ||
        [row.label, row.technicalKey, row.source, row.dependency, row.updateType, row.freshness, row.mock ? "mock" : "live"].some((value) =>
          value.toLowerCase().includes(needle)
        )
    );
  }, [tabRows, query]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, DataPointRow[]>();
    for (const row of filteredRows) {
      const key = groupKey(row);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? filteredRows[0] ?? null;
  const selectedUpstreamIds = selectedRow?.upstreamSeries ?? [];
  const selectedScoreMapEntry = selectedRow ? scoreMapEntry(selectedRow.id) : undefined;
  const inspectingRow = inspectingId ? rows.find((row) => row.id === inspectingId) ?? null : null;

  const total = summary.total ?? 0;

  // Tab counts for the CURRENT mode, computed off the full row set —
  // every mode partitions all 110 rows, so these always sum to `total`.
  const tabCounts = useMemo(() => {
    const counts = new Map<TabId, number>();
    for (const row of rows) {
      const id = tabOf(row, groupMode);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [rows, groupMode]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <section>
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Model Explorer</p>
            <h1 className="mt-1 font-display text-2xl text-ink">Data Point Control Center</h1>
            <p className="mt-2 max-w-3xl text-[13px] text-muted">
              Registry of model inputs, derived scores, manual controls, governance parameters and veto gates. Freshness reflects time
              since each value's observation date, against its series' expected cadence.
            </p>
          </div>
          {/* Captions align on one baseline and each sits over a 32px control
              row; the Tracking subtext hangs below without dragging the
              controls down, so alignment is from the top, not the bottom. */}
          {/* Both blocks are caption-over-content and end on one bottom
              edge: the figure and the control row share a baseline, so the
              group reads as a single band rather than two floating pieces. */}
          <div className="flex shrink-0 items-end gap-10">
            <div>
              <div className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Tracking</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-ink">{total}</span>
                <span className="text-[13px] text-muted">data points</span>
              </div>
              {/* The headline count alone implies all of it is real. The
                  live/mock split sits directly under it so the qualifier
                  is impossible to read past. */}
              <div className="mt-2 flex items-center gap-2 text-[13px]">
                <span className="tabular-nums text-ink">{summary.live ?? 0} live</span>
                {(summary.mock ?? 0) > 0 && (
                  <>
                    <span aria-hidden="true" className="text-line">·</span>
                    <button
                      type="button"
                      onClick={() => setParam("status", "mock")}
                      className="flex items-center gap-1.5 font-semibold text-danger-500 underline-offset-2 hover:underline"
                    >
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-danger-500" />
                      <span className="tabular-nums">{summary.mock} mock</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* A hairline divides the readout from the controls that change
                it — the same rule weight the cards below use. */}
            <div className="self-stretch border-l border-line" aria-hidden="true" />

            <div>
              <label htmlFor="refresh-source" className="block text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">
                Source
              </label>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative h-9">
                  {/* No leading glyph here: the refresh mark belongs on the
                      button that performs the action, not on the picker. */}
                  <div className="pointer-events-none flex h-9 items-center justify-between gap-3 rounded-sm border border-line px-3">
                    <span className="whitespace-nowrap text-[13px] font-semibold text-ink">{refreshSource === "all" ? "All sources" : (refreshSources.find((src) => src.id === refreshSource)?.label ?? refreshSource)}</span>
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 6l4 4 4-4" />
                    </svg>
                  </div>
                  <select
                    id="refresh-source"
                    value={refreshSource}
                    onChange={(event) => setRefreshSource(event.target.value)}
                    className="absolute inset-0 h-9 w-full cursor-pointer opacity-0"
                  >
                    {refreshSources.map((src) => (
                      <option key={src.id} value={src.id}>
                        {src.label}
                      </option>
                    ))}
                    <option value="all">All sources</option>
                  </select>
                </div>
                {/* The one filled control on the page — this is the only
                    thing here that changes state. */}
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-sm bg-ink px-3.5 text-[13px] font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] disabled:pointer-events-none disabled:opacity-40"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-4 w-4 shrink-0 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 8a6 6 0 1 1-1.8-4.3M14 2v3.5h-3.5" />
                  </svg>
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* The dropdown picks which of the three ways to slice the same 110
            rows is active; the tab row underneath always reflects that
            mode's own tab set and always partitions every row, so nothing
            is ever hidden — switching modes just redraws the lines. Both
            sit on ONE line and share a bottom border, so the dropdown
            reads as part of the tab row's own control strip rather than
            a second, disconnected block underneath it. */}
        <div className="flex items-center justify-between gap-4 border-b border-line">
          <div className="flex gap-[22px] overflow-x-auto text-[13px] font-semibold">
            {TAB_OPTIONS_BY_MODE[groupMode].map((option) => {
              const active = activeTab === option.id;
              const style = option.id === "stale" ? FRESHNESS_STYLE.stale : null;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setParam("tab", option.id === TAB_OPTIONS_BY_MODE[groupMode][0]!.id ? null : option.id)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 transition-colors duration-100 ease-in ${
                    active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {style && <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 ${style.dot}`} />}
                  {option.id === "mock" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 bg-danger-500" />}
                  {option.id === "constant" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 border border-line" />}
                  <span>{option.label}</span>
                  <span className={`tabular-nums ${active ? "text-ink" : "text-muted"}`}>{tabCounts.get(option.id) ?? 0}</span>
                </button>
              );
            })}
          </div>

          {/* Same 28px pill language as the Source control above, so the
              two dropdowns on the page read as one family. */}
          <div className="relative h-7 shrink-0">
            <div className="pointer-events-none flex h-7 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line px-2.5">
              <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Group by</span>
              <span className="text-[12px] font-bold text-ink">
                {GROUP_MODE_OPTIONS.find((option) => option.id === groupMode)!.label}
              </span>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </div>
            <select
              value={groupMode}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                const mode = e.target.value as GroupMode;
                if (mode === "assetClass") next.delete("group");
                else next.set("group", mode);
                next.delete("tab"); // a tab id from the old mode may not exist in the new one
                setSearchParams(next);
              }}
              className="absolute inset-0 h-7 w-full cursor-pointer opacity-0"
              aria-label="Group registry by"
            >
              {GROUP_MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Indeterminate by design: the refresh is one blocking call that
            reports nothing until it returns, so a percentage would be
            invented. A segment sweeping the tab row's own rule says "working"
            without claiming to know how far along it is. Sits flush under
            that rule so it reads as the rule activating, not as a new
            element pushing the page down. */}
        {refreshing && (
          <div
            role="progressbar"
            aria-label="Refreshing data sources"
            className="relative -mt-px h-0.5 w-full overflow-hidden bg-paper-2"
          >
            <span className="absolute inset-y-0 left-0 w-1/4 animate-indeterminate-sweep bg-ink" />
          </div>
        )}

        {refreshMessage && !refreshing && (
          <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 bg-brand-500" />
            {refreshMessage}
          </p>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Registry: grouping tabs over a search field and one row per data
            point — name and key on the left, value and freshness on the right. */}
        <div className="min-w-0 rounded-lg border border-line bg-paper p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">Registry</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}
                {" · "}
                {TAB_OPTIONS_BY_MODE[groupMode].find((option) => option.id === activeTab)!.label}
              </p>
            </div>
            <label className="relative flex w-full items-center sm:w-56">
              <span className="sr-only">Search the registry</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" />
              </svg>
              <input
                value={query}
                onChange={(e) => setParam("q", e.target.value || null)}
                className="h-7 w-full rounded-sm border border-line bg-paper pl-7 pr-2 text-[12px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
                placeholder="Search name, source or key"
              />
            </label>
          </div>

          {/* During a refresh the reload is part of that same operation, so
              the rows dim in place rather than being replaced by a second
              loading message competing with the progress bar above. */}
          {loading && !refreshing && <p className="py-4 text-sm text-muted">Loading data registry...</p>}
          {error && <p className="py-4 text-sm text-danger-500">{error}</p>}
          {(!loading || refreshing) && !error && (
            <div
              className={`max-h-[720px] overflow-y-auto transition-opacity duration-150 ease-in ${
                refreshing ? "opacity-40" : "opacity-100"
              }`}
            >
              {groupedRows.map(([key, items]) => (
                <section key={key}>
                  <div className="sticky top-0 z-10 border-b border-line bg-paper py-2 text-xs font-bold uppercase tracking-eyebrow text-muted">
                    {groupLabel(key)}{" "}
                    <span className="ml-1 font-normal normal-case tracking-normal tabular-nums">
                      {/* Filtered to "Analyst input", the total is not the
                          actionable number — how many are still unanswered
                          is. A count reading "8" when 5 are already done
                          invites re-reviewing work that is finished. */}
                      {activeTab === "opt_in" && items.some((row) => row.awaitingInput)
                        ? `${items.filter((row) => row.awaitingInput).length} of ${items.length} unanswered`
                        : items.length}
                    </span>
                  </div>
                  {items.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setParam("point", row.id)}
                      className={`grid w-full grid-cols-[1fr_auto] gap-4 border-b border-line py-3 text-left last:border-0 transition-colors duration-100 ease-in ${
                        selectedRow?.id === row.id ? "bg-paper-2" : "hover:bg-paper-2"
                      }`}
                    >
                      <span className="flex min-w-0 gap-2.5">
                        {/* State dot on every row, not just the unhealthy
                            ones — a column of colour scans far faster than
                            chips that appear and disappear. */}
                        <span
                          aria-hidden="true"
                          className={`mt-1 h-3.5 w-3.5 shrink-0 ${FRESHNESS_STYLE[row.freshness].dot}`}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] text-ink">{row.label}</span>
                          <span className="mt-1 block truncate text-[13px] text-muted">
                            {row.technicalKey} · {row.source}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        {/* A mock value is struck through and muted: it is
                            shown (so the row is not blank) but is visibly
                            not a number to act on. */}
                        <span
                          className={
                            row.mock
                              ? "text-[15px] font-semibold tabular-nums text-muted line-through decoration-danger-500/60"
                              : "text-[15px] font-semibold tabular-nums text-ink"
                          }
                        >
                          {formatValue(row)}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {row.score !== null && !row.mock && (
                            <span className="text-[12px] tabular-nums text-muted">score {formatScore(row.score)}</span>
                          )}
                          {/* Mock is a different axis from freshness — it
                              says the number is demo filler, not that it is
                              old. It gets its own chip so the two can never
                              be conflated, and it is deliberately the
                              loudest thing on the row. */}
                          {row.mock && (
                            <span className="rounded-sm bg-danger-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-eyebrow text-white">
                              Mock
                            </span>
                          )}
                          {/* Live, but never decided. The value is a real
                              model position (the rubric's neutral case),
                              so it is not mock — but "live" must not be
                              read as "somebody looked at this". Amber,
                              between mock's red and constant's quiet
                              outline: it needs action, but nothing is
                              wrong with the number meanwhile. */}
                          {row.awaitingInput && (
                            <span className="rounded-sm bg-warn-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-eyebrow text-warn-800">
                              Default
                            </span>
                          )}
                          {/* A constant is finished, not pending — a quiet
                              outline, not a colour that competes with the
                              states that need action. */}
                          {row.updateType === "constant" && (
                            <span className="rounded-sm border border-line px-2 py-0.5 text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                              Constant
                            </span>
                          )}
                          {row.freshness !== "current" && !row.mock && (
                            <span className={`rounded-sm px-2 py-0.5 text-[11px] font-bold ${FRESHNESS_STYLE[row.freshness].chip}`}>
                              {groupLabel(row.freshness)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-line bg-paper p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Live impact</h2>
            <p className="mt-0.5 text-[13px] text-muted">Freshness and dependencies for the selected row</p>
          </div>
          {selectedRow ? (
            <div className="space-y-4">
              <div>
                <p className="text-[15px] text-ink">{selectedRow.label}</p>
                <p className="mt-0.5 break-all text-[13px] text-muted">{selectedRow.technicalKey}</p>
              </div>
              {/* The state, named and explained — the row chip says what it
                  is, this says what it means for the number above. */}
              {/* Mock supersedes the freshness box entirely. Telling
                  someone a placeholder is "missing" or "due" invites them
                  to wait for a refresh that will never change it — the
                  actionable fact is that no real value exists yet, and
                  why. */}
              {selectedRow.updateType === "constant" ? (
                <div className="rounded-sm border border-line bg-paper-2 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                    Structural constant — annual review
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-ink">
                    This value describes the instrument class itself, not a market view, so it does
                    not move with the market and has no feed to refresh. It is deliberate and
                    complete — revisit it at the annual strategic review.
                  </p>
                </div>
              ) : selectedRow.mock ? (
                <div className="rounded-sm border border-danger-500 bg-danger-50 px-3 py-2">
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-danger-500">
                    Mock — not real data
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-ink">
                    The value shown is static demo baseline data, not a reading from any source. It
                    still feeds the allocation, so treat any tilt it drives as provisional.
                  </p>
                  {selectedRow.mockReason && (
                    <p className="mt-2 text-[12px] leading-5 text-danger-500">{selectedRow.mockReason}</p>
                  )}
                </div>
              ) : (
                <div className={`rounded-sm px-3 py-2 ${FRESHNESS_STYLE[selectedRow.freshness].chip}`}>
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow">{groupLabel(selectedRow.freshness)}</p>
                  <p className="mt-1 text-[12px] leading-5 opacity-90">{FRESHNESS_STYLE[selectedRow.freshness].blurb}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 border-y border-line py-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Value</p>
                  <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-ink">{formatValue(selectedRow)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Score</p>
                  <p className="mt-1 text-lg font-semibold leading-none tabular-nums text-brand-800">
                    {selectedRow.score !== null ? formatScore(selectedRow.score) : "-"}
                  </p>
                </div>
              </div>
              <dl className="divide-y divide-line text-[13px]">
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Update type</dt><dd className="text-ink">{groupLabel(selectedRow.updateType)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Source</dt><dd className="text-right text-ink">{selectedRow.source}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Owner</dt><dd className="text-ink">{groupLabel(selectedRow.owner)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Frequency</dt><dd className="text-ink">{groupLabel(selectedRow.frequency)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Last updated</dt><dd className="text-ink">{formatDate(selectedRow.lastUpdated)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Observed at</dt><dd className="text-ink">{formatDate(selectedRow.observedAt)}</dd></div>
              </dl>
              {/* Upstream series, each against its own history. "Where does
                  this input sit in its own distribution" is a per-datapoint
                  question, so it belongs beside the datapoint rather than in
                  a flat list on the audit page, which is where it used to
                  live. A bare series id told the reader nothing; the strip
                  says whether the input is at an extreme. */}
              <div>
                <p className="text-[13px] text-muted">Upstream series</p>
                {selectedUpstreamIds.length > 0 ? (
                  <div className="mt-2 space-y-2.5">
                    {selectedUpstreamIds.map((id) => (
                      <UpstreamSeriesRow
                        key={id}
                        id={id}
                        series={undefined}
                        role={seriesRole(selectedScoreMapEntry, id)}
                        fallback={selectedRow.upstreamValues?.[id]}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[13px] text-muted">No upstream series</p>
                )}
              </div>
              {isScoreCellId(selectedRow.id) || selectedRow.upstreamSeries.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setParam("inspect", selectedRow.id)}
                  className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
                >
                  View exact formula
                  <span aria-hidden="true">›</span>
                </button>
              ) : (
                <p className="text-[13px] leading-5 text-muted">
                  {selectedRow.modelGroup === "governance"
                    ? "Governance parameters configure the engine directly - see Methodology for what each one means."
                    : selectedRow.modelGroup === "vetoes"
                      ? "Veto gates are risk-gate rules, not a weighted calculation - see Methodology's veto gates section for the exact trigger."
                      : "This data point has no formula breakdown."}
                </p>
              )}
              <p className="border-t border-line pt-3 text-[12px] leading-5 text-muted">
                To change a score, use Overrides: edits there preview through the model and save to the shared draft with a reason.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Select a registry row to inspect freshness and dependencies.</p>
          )}
        </aside>
      </section>

      <DataPointFormulaModal
        row={inspectingRow}
        onClose={() => setParam("inspect", null)}
      />
    </main>
  );
}
