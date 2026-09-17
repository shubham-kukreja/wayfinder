import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ScoreState, SeriesState, Snapshot } from "@wayfinder/engine";
import { SCORE_MAP } from "@wayfinder/engine";
import { listDataPoints, refreshDataPoints, type DataPointFreshness, type DataPointRow } from "../lib/datapointsApi.js";
import { DistributionStrip } from "../components/DistributionStrip.js";
import { formatScore } from "../lib/format.js";

type GroupMode = "model" | "operation" | "attention";

const GROUP_MODE_OPTIONS: ReadonlyArray<{ id: GroupMode; label: string }> = [
  { id: "model", label: "By model" },
  { id: "operation", label: "By operation" },
  { id: "attention", label: "By attention" },
];

const REFRESH_SOURCE_LABELS: Record<string, string> = {
  fred: "FRED",
  bullion: "Bullion",
  amfi: "AMFI",
  rbi_homepage: "RBI homepage",
  all: "All sources",
};

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
  due: {
    dot: "bg-warn-200",
    text: "text-warn-600",
    chip: "bg-warn-50 text-warn-800",
    blurb: "Past its refresh window — a new observation is expected.",
  },
  stale: {
    dot: "bg-warn",
    text: "text-warn-600",
    chip: "bg-warn-50 text-warn-800",
    blurb: "Well past its refresh window; the stored value may no longer hold.",
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

function groupKey(row: DataPointRow, mode: GroupMode): string {
  if (mode === "operation") return row.updateType;
  if (mode === "attention") return row.freshness;
  return row.modelGroup;
}

function groupLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// Score-cell registry ids are exactly `${nodeId}::${signalId}` (e.g.
// "l1.equity::valuation") - governance ids are prefixed "governance."
// and veto ids "veto.", so this alone is enough to tell "has a real
// formula/contribution breakdown via CalculationInspector" apart from
// "is a plain parameter or risk gate with no such breakdown."
function isScoreCellId(id: string): boolean {
  return id.includes("::") && !id.startsWith("governance.") && !id.startsWith("veto.");
}

const FRESHNESS_ORDER = ["current", "due", "stale", "failed", "overridden"] as const;

// "mock" is not a freshness state — it is a separate trust axis that cuts
// across all of them. It gets a tab because it is the first thing anyone
// auditing this page needs to find, and because mock rows report freshness
// "missing", which has no tab of its own.
type FreshnessTab = "all" | (typeof FRESHNESS_ORDER)[number] | "mock" | "constant";

function groupModeFromSearch(value: string | null): GroupMode {
  return value === "operation" || value === "attention" ? value : "model";
}

function CalculationBreakdown({
  row,
  scoreState,
  seriesById,
}: {
  row: DataPointRow;
  scoreState: ScoreState | undefined;
  seriesById: Snapshot["series"];
}) {
  if (!scoreState) {
    return (
      <div className="rounded-sm border border-line bg-paper-2 p-3">
        <p className="text-[13px] font-semibold text-ink">Calculation breakdown</p>
        <p className="mt-1 text-[12px] leading-5 text-muted">No computed score is available for this row yet.</p>
      </div>
    );
  }

  const sourceIds = effectiveSourceIds(row, scoreState);
  const sources = sourceIds.map((id) => ({ id, series: seriesById[id] }));
  const hasStaleSource = sources.some(({ series }) => isStaleSeries(series));
  const oneSeries = sources.length === 1 ? sources[0] : null;
  const rawPercentile =
    oneSeries?.series?.percentile ??
    (scoreState.transform === "inverted" ? 100 - scoreState.value : scoreState.transform === "percentile" ? scoreState.value : null);

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-ink">Calculation breakdown</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">{transformExplanation(scoreState)}</p>
        </div>
        {hasStaleSource && (
          <span className="shrink-0 rounded-sm bg-warn-50 px-2 py-0.5 text-[11px] font-bold text-warn-800">
            * stale
          </span>
        )}
      </div>

      <div className="mt-3 space-y-2.5">
        {sources.length > 0 ? (
          sources.map(({ id, series }) => {
            const external = isExternalSeries(series);
            const stale = isStaleSeries(series);
            return (
              <div
                key={id}
                className="border-t border-line py-3 first:border-t-0"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12px] font-semibold text-ink">
                    {id}
                    {stale ? " *" : ""}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{formatSeriesValue(series)}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4 text-muted">
                  <span className={external ? "font-semibold text-brand-800" : ""}>
                    {external ? "External source" : "Internal/manual source"}
                  </span>{" "}
                  · {series?.source ?? row.source} · observed {formatDate(series?.latestDate ?? null)}
                </p>
                <div className="mt-2">
                  <DistributionStrip percentile={series?.percentile ?? null} />
                </div>
                <div className="mt-1.5 flex justify-between gap-3 text-[11px] text-muted">
                  <span>{series?.observations ?? 0} observations{series?.windowStart ? ` since ${formatDate(series.windowStart)}` : ""}</span>
                  <span className="shrink-0">{series?.percentile !== null && series?.percentile !== undefined ? `${series.percentile.toFixed(1)}th pct` : statusLabel(series?.status ?? "missing")}</span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="rounded-sm bg-paper-2 px-2.5 py-2 text-[12px] leading-5 text-muted">
            No upstream market series. The score is {statusLabel(scoreState.provenance)}.
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {oneSeries && rawPercentile !== null && (
          <p className="text-[12px] leading-5 text-ink-2">
            Raw percentile: <span className="font-semibold tabular-nums text-ink">{rawPercentile.toFixed(1)}</span>
          </p>
        )}
        <p className="mt-1 font-mono text-[12px] leading-5 text-ink">{scoreFormulaLine(scoreState)}</p>
        {scoreState.note && <p className="mt-2 text-[12px] leading-5 text-muted">{scoreState.note}</p>}
        {hasStaleSource && (
          <p className="mt-2 text-[11px] leading-4 text-muted">
            * Stale means this source is past its refresh window or has a recorded source error.
          </p>
        )}
      </div>
    </div>
  );
}

function DataPointFormulaModal({
  row,
  scoreState,
  seriesById,
  onClose,
}: {
  row: DataPointRow | null;
  scoreState: ScoreState | undefined;
  seriesById: Snapshot["series"];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!row) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  if (!row) return null;
  const sourceIds = effectiveSourceIds(row, scoreState);
  const sourceStates = sourceIds.map((id) => seriesById[id]).filter((series): series is SeriesState => !!series);
  const observedAt = sourceStates.map((series) => series.latestDate).filter((date): date is string => !!date).sort().at(-1) ?? row.observedAt;
  const sourceLabel = sourceStates.length > 0 ? [...new Set(sourceStates.map((series) => series.source))].join(" + ") : row.source;

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
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Score</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-brand-800">{row.score !== null ? formatScore(row.score) : "-"}</p>
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
          <CalculationBreakdown row={row} scoreState={scoreState} seriesById={seriesById} />
        </div>
      </div>
    </div>
  );
}

export function DataPointControlCenterView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupMode = groupModeFromSearch(searchParams.get("group"));
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
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      await refreshDataPoints(refreshSource);
      await loadRows();
      setRefreshMessage("Refresh complete. Freshness and scores have been recalculated from stored observations.");
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  const freshnessFilter = searchParams.get("freshness");

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      // "mock" rides the same URL param as the freshness tabs but is not a
      // freshness state — it cuts across all of them, so it filters on its
      // own field rather than matching row.freshness.
      .filter((row) =>
        freshnessFilter === "mock"
          ? row.mock
          : freshnessFilter === "constant"
            ? row.updateType === "constant"
            : !freshnessFilter || row.freshness === freshnessFilter
      )
      .filter(
        (row) =>
          !needle ||
          [row.label, row.technicalKey, row.source, row.dependency, row.updateType, row.freshness, row.mock ? "mock" : "live"].some((value) =>
            value.toLowerCase().includes(needle)
          )
      );
  }, [rows, query, freshnessFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, DataPointRow[]>();
    for (const row of filteredRows) {
      const key = groupKey(row, groupMode);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredRows, groupMode]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? filteredRows[0] ?? null;
  const selectedScoreState = selectedRow && isScoreCellId(selectedRow.id) ? snapshot.scores[selectedRow.id] : undefined;
  const selectedUpstreamIds = selectedRow && selectedScoreState ? effectiveSourceIds(selectedRow, selectedScoreState) : selectedRow?.upstreamSeries ?? [];
  const inspectingRow = inspectingId ? rows.find((row) => row.id === inspectingId) ?? null : null;
  const inspectingScoreState = inspectingRow && isScoreCellId(inspectingRow.id) ? snapshot.scores[inspectingRow.id] : undefined;

  const total = summary.total ?? 0;

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
              since the last stored refresh; no scheduler is running yet.
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
                      onClick={() => setParam("freshness", "mock")}
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
                    <span className="whitespace-nowrap text-[13px] font-semibold text-ink">{REFRESH_SOURCE_LABELS[refreshSource] ?? refreshSource}</span>
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
                    <option value="fred">FRED</option>
                    <option value="bullion">Bullion</option>
                    <option value="amfi">AMFI</option>
                    <option value="rbi_homepage">RBI homepage</option>
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

        {/* Freshness tabs double as the page's legend: each carries its state
            colour as a dot, so the same hue in a registry chip needs no
            second explanation. */}
        <div className="flex gap-[22px] border-b border-line text-[13px] font-semibold">
          {(["all", ...FRESHNESS_ORDER, "constant", "mock"] as FreshnessTab[]).map((id) => {
            const active = (freshnessFilter ?? "all") === id;
            const count = id === "all" ? total : summary[id] ?? 0;
            const style = id === "all" || id === "mock" || id === "constant" ? null : FRESHNESS_STYLE[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setParam("freshness", id === "all" ? null : id)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 transition-colors duration-100 ease-in ${
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {style && <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 ${style.dot}`} />}
                {id === "mock" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 bg-danger-500" />}
                {id === "constant" && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 border border-line" />}
                <span>{id === "all" ? "All" : id === "mock" ? "Mock" : id === "constant" ? "Constants" : groupLabel(id)}</span>
                <span
                  className={`tabular-nums ${
                    active ? "text-ink" : id === "mock" && count > 0 ? "text-danger-500" : style && count > 0 ? style.text : "text-muted"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
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
                {freshnessFilter ? ` · ${groupLabel(freshnessFilter)}` : ""}
              </p>
            </div>
            {/* Search and grouping sit on one control line, both 28px and both
                in the header's bordered-pill language — the grouping select
                replaces the tab row that used to span the card. */}
            <div className="flex items-center gap-2">
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
              <div className="relative h-7 shrink-0">
                <div className="pointer-events-none flex h-7 items-center gap-1.5 rounded-sm border border-line px-2.5">
                  <span className="whitespace-nowrap text-[12px] font-bold text-ink">
                    {GROUP_MODE_OPTIONS.find((option) => option.id === groupMode)!.label}
                  </span>
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
                <select
                  value={groupMode}
                  onChange={(e) => setParam("group", e.target.value === "model" ? null : e.target.value)}
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
                    {groupLabel(key)} <span className="ml-1 font-normal normal-case tracking-normal tabular-nums">{items.length}</span>
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
                    {selectedUpstreamIds.map((id) => {
                      const series = snapshot.series[id as keyof typeof snapshot.series];
                      return (
                        <div key={id}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-[12px] text-ink-2">{id}</span>
                            <span className="shrink-0 text-[12px] tabular-nums text-muted">
                              {series?.percentile !== null && series?.percentile !== undefined
                                ? `${series.percentile.toFixed(0)}th pct`
                                : "—"}
                            </span>
                          </div>
                          <div className="mt-1">
                            <DistributionStrip percentile={series?.percentile ?? null} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1 text-[13px] text-muted">No upstream series</p>
                )}
              </div>
              {isScoreCellId(selectedRow.id) ? (
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
                Draft preview, edit reason, expiry and publish impact land in Slice 4. This panel is read-only for the current MVP slice.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Select a registry row to inspect freshness and dependencies.</p>
          )}
        </aside>
      </section>

      <DataPointFormulaModal
        row={inspectingRow}
        scoreState={inspectingScoreState}
        seriesById={snapshot.series}
        onClose={() => setParam("inspect", null)}
      />
    </main>
  );
}
