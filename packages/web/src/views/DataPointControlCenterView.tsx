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

const FRESHNESS_CLASS: Record<DataPointFreshness, string> = {
  current: "bg-brand-50 text-brand-800 border-brand-100",
  due: "bg-amber-50 text-amber-700 border-amber-200",
  stale: "bg-orange-50 text-orange-700 border-orange-200",
  failed: "bg-danger-50 text-danger-500 border-danger-500/30",
  missing: "bg-neutral-100 text-neutral-600 border-neutral-200",
  overridden: "bg-neutral-100 text-neutral-600 border-neutral-200",
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
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Model Explorer</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-neutral-950">Data Point Control Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            Registry of model inputs, derived scores, manual controls, governance parameters and veto gates. Freshness reflects time since the last stored refresh; no scheduler is running yet.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={refreshSource}
            onChange={(event) => setRefreshSource(event.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-700"
            aria-label="Refresh source"
          >
            <option value="fred">FRED</option>
            <option value="bullion">Bullion</option>
            <option value="amfi">AMFI</option>
            <option value="rbi_homepage">RBI homepage</option>
            <option value="all">All sources</option>
          </select>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-black transition duration-100 ease-in hover:brightness-105 hover:-translate-y-px disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh source"}
          </button>
        </div>
      </div>

      {refreshMessage && <p className="mb-4 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">{refreshMessage}</p>}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        {(["total", "current", "due", "stale", "failed", "overridden"] as const).map((key) => {
          // "Total" always clears the filter rather than filtering to a
          // freshness value called "total" (no such row state exists) -
          // every other card toggles that exact freshness on/off.
          const isActive = key === "total" ? !freshnessFilter : freshnessFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setParam("freshness", key === "total" ? null : freshnessFilter === key ? null : key)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                isActive ? "border-brand-500 bg-brand-500 text-black" : "border-neutral-200 bg-white hover:bg-neutral-50"
              }`}
            >
              <p className={`text-xs capitalize ${isActive ? "text-black/60" : "text-neutral-400"}`}>{key}</p>
              <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${isActive ? "text-black" : "text-neutral-950"}`}>{summary[key] ?? 0}</p>
            </button>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr_360px]">
        <aside className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Filters</h2>
          <label className="mt-4 block text-xs font-medium text-neutral-500">
            Search
            <input
              value={query}
              onChange={(e) => setParam("q", e.target.value || null)}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm text-neutral-800"
              placeholder="Name, source, key"
            />
          </label>
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-neutral-500">Grouping</p>
            <div className="space-y-1">
              {GROUP_MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setParam("group", option.id === "model" ? null : option.id)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    groupMode === option.id ? "bg-brand-500 text-black" : "text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">Registry</h2>
            <p className="text-xs text-neutral-400">{filteredRows.length} visible rows</p>
          </div>
          {loading && <p className="p-4 text-sm text-neutral-400">Loading data registry...</p>}
          {error && <p className="p-4 text-sm text-danger-500">{error}</p>}
          {!loading && !error && (
            <div className="max-h-[720px] overflow-y-auto">
              {groupedRows.map(([key, items]) => (
                <section key={key}>
                  <div className="sticky top-0 z-10 border-y border-neutral-100 bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {groupLabel(key)} <span className="font-normal text-neutral-400">({items.length})</span>
                  </div>
                  <div className="divide-y divide-neutral-100">
                    {items.map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => setParam("point", row.id)}
                        className={`grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3 text-left hover:bg-neutral-50 ${
                          selectedRow?.id === row.id ? "bg-neutral-50" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-neutral-900">{row.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-neutral-400">{row.technicalKey}</span>
                          <span className="mt-1 block truncate text-xs text-neutral-500">{row.dependency}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="tabular-nums text-sm font-semibold text-neutral-950">{formatValue(row)}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${FRESHNESS_CLASS[row.freshness]}`}>{groupLabel(row.freshness)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Live impact</h2>
          {selectedRow ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-neutral-400">Selected</p>
                <p className="mt-1 text-sm font-medium text-neutral-950">{selectedRow.label}</p>
                <p className="mt-0.5 break-all text-xs text-neutral-400">{selectedRow.technicalKey}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-neutral-200 p-3">
                  <p className="text-xs text-neutral-400">Value</p>
                  <p className="mt-1 font-semibold tabular-nums text-neutral-950">{formatValue(selectedRow)}</p>
                </div>
                <div className="rounded-lg border border-neutral-200 p-3">
                  <p className="text-xs text-neutral-400">Score</p>
                  <p className="mt-1 font-semibold tabular-nums text-neutral-950">{selectedRow.score !== null ? formatScore(selectedRow.score) : "-"}</p>
                </div>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Update type</dt><dd className="text-neutral-900">{groupLabel(selectedRow.updateType)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Source</dt><dd className="text-right text-neutral-900">{selectedRow.source}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Owner</dt><dd className="text-neutral-900">{groupLabel(selectedRow.owner)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Frequency</dt><dd className="text-neutral-900">{groupLabel(selectedRow.frequency)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Last updated</dt><dd className="text-neutral-900">{formatDate(selectedRow.lastUpdated)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-neutral-500">Observed at</dt><dd className="text-neutral-900">{formatDate(selectedRow.observedAt)}</dd></div>
              </dl>
              <div>
                <p className="text-xs font-medium text-neutral-500">Upstream series</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedRow.upstreamSeries.length > 0 ? selectedRow.upstreamSeries.map((id) => (
                    <span key={id} className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600">{id}</span>
                  )) : <span className="text-xs text-neutral-400">No upstream series</span>}
                </div>
              </div>
              {isScoreCellId(selectedRow.id) ? (
                <button
                  type="button"
                  onClick={() => setParam("inspect", selectedRow.id)}
                  className="w-full rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-black transition duration-100 ease-in hover:brightness-105 hover:-translate-y-px"
                >
                  View exact formula & contribution
                </button>
              ) : (
                <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-500">
                  {selectedRow.modelGroup === "governance"
                    ? "Governance parameters configure the engine directly — see Methodology for what each one means."
                    : selectedRow.modelGroup === "vetoes"
                      ? "Veto gates are risk-gate rules, not a weighted calculation — see Methodology's veto gates section for the exact trigger."
                      : "This data point has no formula breakdown."}
                </p>
              )}
              <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-500">
                Draft preview, edit reason, expiry and publish impact land in Slice 4. This panel is read-only for the current MVP slice.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-400">Select a registry row to inspect freshness and dependencies.</p>
          )}
        </aside>
      </section>

      <CalculationInspector snapshot={snapshot} allocation={allocation} selectedId={inspectingId} onClose={() => setParam("inspect", null)} />
    </main>
  );
}
