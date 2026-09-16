import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { computeAllocation } from "@wayfinder/engine";
import { listDataPoints, refreshDataPoints, type DataPointFreshness, type DataPointRow } from "../lib/datapointsApi.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
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

type FreshnessTab = "all" | (typeof FRESHNESS_ORDER)[number];

function groupModeFromSearch(value: string | null): GroupMode {
  return value === "operation" || value === "attention" ? value : "model";
}

export function DataPointControlCenterView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupMode = groupModeFromSearch(searchParams.get("group"));
  const query = searchParams.get("q") ?? "";
  const selectedId = searchParams.get("point");
  const inspectingId = searchParams.get("inspect");

  const scores = useMemo(() => scoresFromSnapshot(snapshot.scores), [snapshot.scores]);
  const vetoes = useMemo(() => vetoesFromSnapshot(snapshot.vetoes), [snapshot.vetoes]);
  const allocation = useMemo(() => computeAllocation(scores, vetoes, snapshot.params), [scores, vetoes, snapshot.params]);

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
      .filter((row) => !freshnessFilter || row.freshness === freshnessFilter)
      .filter((row) => !needle || [row.label, row.technicalKey, row.source, row.dependency, row.updateType, row.freshness].some((value) => value.toLowerCase().includes(needle)));
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
          {(["all", ...FRESHNESS_ORDER] as FreshnessTab[]).map((id) => {
            const active = (freshnessFilter ?? "all") === id;
            const count = id === "all" ? total : summary[id] ?? 0;
            const style = id === "all" ? null : FRESHNESS_STYLE[id];
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
                <span>{id === "all" ? "All" : groupLabel(id)}</span>
                <span className={`tabular-nums ${active ? "text-ink" : style && count > 0 ? style.text : "text-muted"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {refreshMessage && (
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

          {loading && <p className="py-4 text-sm text-muted">Loading data registry...</p>}
          {error && <p className="py-4 text-sm text-danger-500">{error}</p>}
          {!loading && !error && (
            <div className="max-h-[720px] overflow-y-auto">
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
                        <span className="text-[15px] font-semibold tabular-nums text-ink">{formatValue(row)}</span>
                        <span className="flex items-center gap-1.5">
                          {row.score !== null && (
                            <span className="text-[12px] tabular-nums text-muted">score {formatScore(row.score)}</span>
                          )}
                          {row.freshness !== "current" && (
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
              <div className={`rounded-sm px-3 py-2 ${FRESHNESS_STYLE[selectedRow.freshness].chip}`}>
                <p className="text-[11px] font-bold uppercase tracking-eyebrow">{groupLabel(selectedRow.freshness)}</p>
                <p className="mt-1 text-[12px] leading-5 opacity-90">{FRESHNESS_STYLE[selectedRow.freshness].blurb}</p>
              </div>
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
              <div>
                <p className="text-[13px] text-muted">Upstream series</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedRow.upstreamSeries.length > 0 ? selectedRow.upstreamSeries.map((id) => (
                    <span key={id} className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-ink-2">{id}</span>
                  )) : <span className="text-[13px] text-muted">No upstream series</span>}
                </div>
              </div>
              {isScoreCellId(selectedRow.id) ? (
                <button
                  type="button"
                  onClick={() => setParam("inspect", selectedRow.id)}
                  className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
                >
                  View exact formula &amp; contribution
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

      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={inspectingId} onClose={() => setParam("inspect", null)} />
    </main>
  );
}
