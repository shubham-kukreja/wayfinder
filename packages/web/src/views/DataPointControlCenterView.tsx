import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { computeAllocation } from "@wayfinder/engine";
import { listDataPoints, refreshDataPoints, type DataPointFreshness, type DataPointRow } from "../lib/datapointsApi.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { CalculationInspector } from "../components/CalculationInspector.js";
import { formatScore } from "../lib/format.js";

type GroupMode = "model" | "operation" | "attention";

const GROUP_MODE_OPTIONS: Array<{ id: GroupMode; label: string }> = [
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

const FRESHNESS_CLASS: Record<DataPointFreshness, string> = {
  current: "bg-paper-2 text-muted border-line",
  due: "bg-warn-50 text-warn-600 border-warn-200",
  stale: "bg-warn-50 text-warn-600 border-warn-200",
  failed: "bg-danger-50 text-danger-500 border-danger-500/30",
  missing: "bg-paper-2 text-ink-2 border-line",
  overridden: "bg-paper-2 text-ink-2 border-line",
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

export function DataPointControlCenterView({ snapshot }: { snapshot: Snapshot }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupMode = (searchParams.get("group") as GroupMode | null) ?? "model";
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
  const [refreshSource, setRefreshSource] = useState("fred");
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

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Model Explorer</p>
          <h1 className="mt-1 font-display text-2xl text-ink">Data Point Control Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Registry of model inputs, derived scores, manual controls, governance parameters and veto gates. Freshness reflects time since the last stored refresh; no scheduler is running yet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative h-8">
            <div className="pointer-events-none flex h-8 items-center gap-2 rounded-sm border border-ink px-3">
              <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 8a6 6 0 1 1-1.8-4.3M14 2v3.5h-3.5" />
              </svg>
              <span className="whitespace-nowrap text-[13px] font-bold text-ink">{REFRESH_SOURCE_LABELS[refreshSource] ?? refreshSource}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="ml-1 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </div>
            <select
              value={refreshSource}
              onChange={(event) => setRefreshSource(event.target.value)}
              className="absolute inset-0 h-8 w-full cursor-pointer opacity-0"
              aria-label="Refresh source"
            >
              <option value="fred">FRED</option>
              <option value="bullion">Bullion</option>
              <option value="amfi">AMFI</option>
              <option value="rbi_homepage">RBI homepage</option>
              <option value="all">All sources</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-sm border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-40"
          >
            {refreshing ? "Refreshing…" : "Refresh source"}
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      {refreshMessage && <p className="mb-6 border border-line bg-paper-2 px-3 py-2 text-[13px] text-ink-2">{refreshMessage}</p>}

      {/* Total is the anchor — a display-weight figure on its own card — with
          the five freshness states as a subordinate row of filter chips beside
          it. Six equal cells gave a count of 110 the same visual weight as a
          count of 0, and nothing indicated the cells were clickable. */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <button
          type="button"
          onClick={() => setParam("freshness", null)}
          className={`rounded-sm border px-5 py-4 text-left transition-colors duration-100 ease-in ${
            freshnessFilter ? "border-line bg-paper hover:bg-paper-2" : "border-ink bg-paper"
          }`}
        >
          <p className="text-xs text-muted">Total data points</p>
          <p className="mt-1 font-display text-[34px] font-bold leading-none tabular-nums text-ink">
            {summary.total ?? 0}
          </p>
          <p className="mt-1.5 text-xs font-semibold text-brand-800">
            {freshnessFilter ? "Show all" : "All rows shown"}
          </p>
        </button>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {(["current", "due", "stale", "failed", "overridden"] as const).map((key) => {
            const isActive = freshnessFilter === key;
            const count = summary[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setParam("freshness", isActive ? null : key)}
                // Zero-count states stay visible but recede: they are not
                // worth attention until something lands in them.
                className={`rounded-sm border px-3.5 py-3 text-left transition-colors duration-100 ease-in ${
                  isActive ? "border-ink bg-ink" : "border-line bg-paper hover:bg-paper-2"
                }`}
              >
                <p
                  className={`text-[11px] font-bold uppercase tracking-eyebrow ${
                    isActive ? "text-paper/70" : "text-muted"
                  }`}
                >
                  {key}
                </p>
                <p
                  className={`mt-1 font-display text-[22px] font-bold leading-none tabular-nums ${
                    isActive
                      ? "text-paper"
                      : count === 0
                        ? "text-muted"
                        : key === "current"
                          ? "text-brand-800"
                          : "text-ink"
                  }`}
                >
                  {count}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex w-full items-center sm:max-w-xs">
          <span className="sr-only">Search the registry</span>
          <input
            value={query}
            onChange={(e) => setParam("q", e.target.value || null)}
            className="h-8 w-full rounded-sm border border-line bg-paper px-3 text-[13px] text-ink-2 placeholder:text-muted focus:border-ink focus:outline-none"
            placeholder="Search name, source or key"
          />
        </label>
        {/* Segmented control, sharing borders — same pattern as Normalisation
            on Parameters. */}
        <div className="flex">
          {GROUP_MODE_OPTIONS.map((option, i) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setParam("group", option.id === "model" ? null : option.id)}
              className={`border px-3 py-1.5 text-[13px] transition-colors duration-100 ease-in ${i === 0 ? "rounded-l-sm" : "-ml-px"} ${i === GROUP_MODE_OPTIONS.length - 1 ? "rounded-r-sm" : ""} ${
                groupMode === option.id
                  ? "relative border-ink bg-ink font-medium text-paper"
                  : "border-line bg-paper text-ink-2 hover:bg-paper-2"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 rounded-sm border border-line border-t-2 border-t-brand-500 bg-paper">
          <div className="flex items-baseline justify-between border-b border-line bg-paper-2 px-4 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Registry</h2>
            <p className="font-mono text-[11px] tabular-nums text-muted">{filteredRows.length} rows</p>
          </div>
          {loading && <p className="p-4 text-sm text-muted">Loading data registry...</p>}
          {error && <p className="p-4 text-sm text-danger-500">{error}</p>}
          {!loading && !error && (
            <div className="max-h-[720px] overflow-y-auto">
              {groupedRows.map(([key, items]) => (
                <section key={key}>
                  <div className="sticky top-0 z-10 border-y border-line border-l-2 border-l-brand-500 bg-paper-2 px-4 py-2 text-xs font-bold uppercase tracking-eyebrow text-muted">
                    {groupLabel(key)} <span className="ml-1 font-mono text-[11px] font-normal normal-case tracking-normal">{items.length}</span>
                  </div>
                  <div className="divide-y divide-paper-2">
                    {items.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setParam("point", row.id)}
                        className={`grid w-full grid-cols-[1fr_auto] gap-4 border-l-2 px-4 py-2.5 text-left transition-colors duration-100 ease-in ${
                          selectedRow?.id === row.id
                            ? "border-l-brand-500 bg-brand-50/40"
                            : "border-l-transparent hover:bg-paper-2"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-ink">{row.label}</span>
                          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">{row.technicalKey}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="font-mono text-[13px] font-medium tabular-nums text-ink">{formatValue(row)}</span>
                          {row.freshness !== "current" && (
                            <span className={`border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-eyebrow ${FRESHNESS_CLASS[row.freshness]}`}>
                              {groupLabel(row.freshness)}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="rounded-sm border border-line border-t-2 border-t-brand-500 bg-paper">
          <div className="border-b border-line bg-paper-2 px-4 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Live impact</h2>
          </div>
          <div className="p-4">
          {selectedRow ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted">Selected</p>
                <p className="mt-1 text-sm font-medium text-ink">{selectedRow.label}</p>
                <p className="mt-0.5 break-all text-xs text-muted">{selectedRow.technicalKey}</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-line border border-line">
                <div className="px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Value</p>
                  <p className="mt-1 font-mono text-lg font-medium leading-none tabular-nums text-ink">{formatValue(selectedRow)}</p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Score</p>
                  <p className="mt-1 font-mono text-lg font-medium leading-none tabular-nums text-brand-700">{selectedRow.score !== null ? formatScore(selectedRow.score) : "-"}</p>
                </div>
              </div>
              <dl className="divide-y divide-line border-y border-line text-[13px]">
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Update type</dt><dd className="text-ink">{groupLabel(selectedRow.updateType)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Source</dt><dd className="text-right text-ink">{selectedRow.source}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Owner</dt><dd className="text-ink">{groupLabel(selectedRow.owner)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Frequency</dt><dd className="text-ink">{groupLabel(selectedRow.frequency)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Last updated</dt><dd className="text-ink">{formatDate(selectedRow.lastUpdated)}</dd></div>
                <div className="flex justify-between gap-4 py-1.5"><dt className="text-muted">Observed at</dt><dd className="text-ink">{formatDate(selectedRow.observedAt)}</dd></div>
              </dl>
              <div>
                <p className="text-xs font-medium text-muted">Upstream series</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedRow.upstreamSeries.length > 0 ? selectedRow.upstreamSeries.map((id) => (
                    <span key={id} className="border border-line bg-paper-2 px-2 py-0.5 font-mono text-[11px] text-ink-2">{id}</span>
                  )) : <span className="text-xs text-muted">No upstream series</span>}
                </div>
              </div>
              {isScoreCellId(selectedRow.id) ? (
                <button
                  type="button"
                  onClick={() => setParam("inspect", selectedRow.id)}
                  className="h-9 w-full bg-ink px-3 text-[13px] font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15]"
                >
                  View exact formula & contribution
                </button>
              ) : (
                <p className="border border-line bg-paper-2 px-3 py-2 text-xs leading-5 text-muted">
                  {selectedRow.modelGroup === "governance"
                    ? "Governance parameters configure the engine directly — see Methodology for what each one means."
                    : selectedRow.modelGroup === "vetoes"
                      ? "Veto gates are risk-gate rules, not a weighted calculation — see Methodology's veto gates section for the exact trigger."
                      : "This data point has no formula breakdown."}
                </p>
              )}
              <p className="border border-line bg-paper-2 px-3 py-2 text-xs leading-5 text-muted">
                Draft preview, edit reason, expiry and publish impact land in Slice 4. This panel is read-only for the current MVP slice.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Select a registry row to inspect freshness and dependencies.</p>
          )}
          </div>
        </aside>
      </section>

      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={inspectingId} onClose={() => setParam("inspect", null)} />
    </main>
  );
}
