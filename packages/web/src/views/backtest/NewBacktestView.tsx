import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Allocation } from "@wayfinder/engine";
import { segmentColor, stickyClassTotals } from "../../components/AllocationBar.js";
import { loadPortfolioAllocation, toAllocation } from "../../lib/portfolioApi.js";
import { FundPicker } from "../../components/backtest/FundPicker.js";
import { Slider } from "../../components/ui/Slider.js";
import { SearchableSelect, type SearchableSelectOption } from "../../components/ui/SearchableSelect.js";
import { SegmentedBar } from "../../components/ui/SegmentedBar.js";
import { AmountInput } from "../../components/ui/AmountInput.js";
import { TabRow } from "../../components/ui/TabRow.js";
import { formatPct } from "../../lib/format.js";
import { todayIso, defaultPurchaseDateIso } from "../../lib/backtestFormat.js";
import { listBenchmarks, listDefaultFunds, enqueueBacktestJob, type BacktestLeg } from "../../lib/backtestApi.js";

let legIdCounter = 0;
function nextLegId(): string {
  legIdCounter += 1;
  return `leg-${legIdCounter}`;
}

interface LegDraft extends BacktestLeg {
  _id: string;
}

type PanelTab = "split" | "funds";
const PANEL_TAB_OPTIONS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: "split", label: "Split" },
  { id: "funds", label: "Funds" },
];

export function NewBacktestView() {
  const navigate = useNavigate();
  // The model allocation from core: the published one, or the draft while
  // nothing is published (as Overview shows it).
  const [liveAllocation, setLiveAllocation] = useState<Allocation | null>(null);
  useEffect(() => {
    loadPortfolioAllocation()
      .then(({ data }) => setLiveAllocation(toAllocation(data)))
      .catch((err: unknown) => setQueueError(`Could not load the model allocation: ${err instanceof Error ? err.message : String(err)}`));
  }, []);

  const [legs, setLegs] = useState<LegDraft[]>([]);
  const [benchmarkId, setBenchmarkId] = useState<string>("Nifty 50");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("split");

  const [defaultFunds, setDefaultFunds] = useState<Record<string, { schemeCode: string; schemeName: string }>>({});

  const [totalAmount, setTotalAmount] = useState<number>(100000);
  const [sleevePercentages, setSleevePercentages] = useState<Record<string, number>>({});
  const [purchaseDate, setPurchaseDate] = useState<string>(defaultPurchaseDateIso());
  const [jobLabel, setJobLabel] = useState("");

  // The version history of published allocations, offered as an alternative
  // starting point to the live model allocation — picking one recomputes the
  // sleeve split (and the thin bar + sliders below) from that snapshot's
  // frozen scores/vetoes/params rather than the current draft.
  const [publishedVersions, setPublishedVersions] = useState<SearchableSelectOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versionAllocation, setVersionAllocation] = useState<Allocation | null>(null);
  const [loadingVersion, setLoadingVersion] = useState(false);

  const allocation = versionAllocation ?? liveAllocation;

  useEffect(() => {
    listBenchmarks().then(setBenchmarks).catch(() => setBenchmarks([]));
    listDefaultFunds()
      .then((picks) => {
        const bySleeve: Record<string, { schemeCode: string; schemeName: string }> = {};
        for (const p of picks) bySleeve[p.sleeveId] = { schemeCode: p.schemeCode, schemeName: p.schemeName };
        setDefaultFunds(bySleeve);
      })
      .catch(() => setDefaultFunds({}));
    // Saved versions move to core with Compare & Publish; until then the
    // starting point is the live model allocation only.
    setPublishedVersions([]);
  }, []);

  function applyAllocationRows(nextAllocation: Allocation) {
    const rows = nextAllocation.rollup.filter((r) => r.portfolioWeight > 0.001);
    const percentages: Record<string, number> = {};
    for (const r of rows) percentages[r.id] = r.portfolioWeight;
    setSleevePercentages(percentages);

    setLegs((prevLegs) => {
      const existingBySleeve = new Map(prevLegs.map((l) => [l.sleeveId, l]));
      return rows.map((r) => {
        const existing = existingBySleeve.get(r.id);
        const fund = defaultFunds[r.id];
        return {
          _id: existing?._id ?? nextLegId(),
          sleeveId: r.id,
          schemeCode: existing?.schemeCode ?? fund?.schemeCode ?? "",
          schemeName: existing?.schemeName ?? fund?.schemeName ?? "",
          amount: Math.round(r.portfolioWeight * totalAmount),
          date: purchaseDate,
        };
      });
    });
  }

  async function selectVersion(id: string | null) {
    setSelectedVersionId(id);
    if (id === null) {
      setVersionAllocation(null);
      if (liveAllocation) applyAllocationRows(liveAllocation);
      return;
    }
    setLoadingVersion(true);
    try {
      throw new Error(`Version ${id} is not available yet`);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingVersion(false);
    }
  }

  useEffect(() => {
    if (!liveAllocation || legs.length > 0 || versionAllocation) return;
    applyAllocationRows(liveAllocation);
  }, [liveAllocation]);

  useEffect(() => {
    if (Object.keys(defaultFunds).length === 0) return;
    setLegs((prev) =>
      prev.map((l) => {
        if (l.schemeCode) return l;
        const fund = defaultFunds[l.sleeveId];
        return fund ? { ...l, schemeCode: fund.schemeCode, schemeName: fund.schemeName } : l;
      })
    );
  }, [defaultFunds]);

  function updateLeg(id: string, patch: Partial<LegDraft>) {
    setLegs((prev) => {
      const next = prev.map((l) => (l._id === id ? { ...l, ...patch } : l));
      if (patch.amount !== undefined && totalAmount > 0) {
        const leg = next.find((l) => l._id === id);
        if (leg) {
          setSleevePercentages((prevPct) => ({ ...prevPct, [leg.sleeveId]: patch.amount! / totalAmount }));
        }
      }
      return next;
    });
  }

  function removeLeg(id: string) {
    setLegs((prev) => prev.filter((l) => l._id !== id));
  }

  function addLeg() {
    setLegs((prev) => [...prev, { _id: nextLegId(), sleeveId: "", schemeCode: "", schemeName: "", amount: 0, date: purchaseDate }]);
  }

  function updatePurchaseDate(date: string) {
    setPurchaseDate(date);
    setLegs((prev) => prev.map((l) => ({ ...l, date })));
  }

  function updateSleevePercentage(sleeveId: string, pct: number) {
    setSleevePercentages((prev) => ({ ...prev, [sleeveId]: pct }));
  }

  function prefillFromSplit() {
    setLegs((prev) =>
      prev.map((l) => {
        const pct = sleevePercentages[l.sleeveId];
        if (pct === undefined) return l;
        return { ...l, amount: Math.round(pct * totalAmount) };
      })
    );
  }

  const percentageSum = Object.values(sleevePercentages).reduce((s, p) => s + p, 0);
  const readyLegs = legs.filter((l) => l.schemeCode && l.amount > 0 && l.date);

  const allocationSegments = Object.entries(sleevePercentages)
    .filter(([, pct]) => pct > 0)
    .map(([sleeveId, pct]) => ({
      id: sleeveId,
      label: sleeveId,
      weight: pct,
      color: segmentColor(sleeveId, allocation ?? undefined),
    }));

  const l1Totals = allocation
    ? stickyClassTotals(allocation).map((cls) => ({ ...cls, label: cls.label.replace(" Segments", "").replace(" Buckets", "") }))
    : [];

  async function handleQueue() {
    setQueueError(null);
    if (readyLegs.length === 0) {
      setQueueError("Pick a fund, amount, and date for at least one sleeve.");
      return;
    }
    setQueueing(true);
    try {
      await enqueueBacktestJob({
        label: jobLabel.trim() || `Backtest ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`,
        legs: readyLegs.map(({ _id, ...rest }) => rest),
        benchmarkId,
      });
      navigate("/backtest/runs");
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueing(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-6">
        <h1 className="mb-1 font-display text-xl text-ink">New Run</h1>
        <p className="text-sm text-muted">
          Model your allocation with real funds and compare it against a benchmark index. Starting a backtest runs it in the background — see{" "}
          <a href="/backtest/runs" className="font-medium text-ink-2 underline">
            Run History
          </a>{" "}
          for progress and results.
        </p>
      </div>

      {/* Benchmark, model allocation and run name in one row, left to right
          — the action bar for the page, borderless since it's a control
          strip rather than a data section. Both this row and the minimal
          allocation bar below it share one max width, so the page reads as
          one aligned column rather than two independently sized blocks. */}
      <section className="mb-8 max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Benchmark</span>
              <div className="relative h-9 w-56">
                <div className="pointer-events-none flex h-9 items-center justify-between gap-3 border border-ink px-3">
                  <span className="whitespace-nowrap text-[13px] font-bold text-ink">{benchmarkId}</span>
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
                <select
                  value={benchmarkId}
                  onChange={(e) => setBenchmarkId(e.target.value)}
                  className="absolute inset-0 h-9 w-56 cursor-pointer opacity-0"
                >
                  {benchmarks.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            {/* The reset link and loading note hang below the field
                absolutely rather than sitting in the column's flow. The
                row is items-end, so laying them out normally grew this
                column the moment a version was picked and shunted its
                input upward, breaking the baseline it shares with
                Benchmark and Run name. */}
            <div className="relative flex flex-col gap-1">
              <SearchableSelect
                label="Model allocation"
                placeholder="Live allocation (current)"
                value={selectedVersionId ? publishedVersions.find((v) => v.id === selectedVersionId) ?? null : null}
                options={publishedVersions}
                onQueryChange={() => {}}
                onSelect={(option) => selectVersion(option.id)}
                // Wider than the w-56 siblings: this is the only control
                // in the row holding a variable-length value (a published
                // version's label, which defaults to a timestamp and can
                // be anything a user typed), so a width matched to the
                // fixed-content fields clipped it mid-timestamp.
                className="w-72"
              />
              {selectedVersionId && !loadingVersion && (
                <button
                  type="button"
                  onClick={() => selectVersion(null)}
                  className="absolute left-0 top-full mt-1 whitespace-nowrap text-left text-[11px] font-semibold text-ink-2 transition-colors duration-100 ease-in hover:text-ink"
                >
                  Use live allocation instead
                </button>
              )}
              {loadingVersion && (
                <span className="absolute left-0 top-full mt-1 whitespace-nowrap text-[11px] text-muted">Loading version…</span>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Run name (optional)</span>
              <input
                type="text"
                value={jobLabel}
                onChange={(e) => setJobLabel(e.target.value)}
                placeholder="e.g. Current allocation, 5y"
                className="h-9 w-56 border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleQueue}
            disabled={queueing || readyLegs.length === 0}
            className="h-9 shrink-0 bg-ink px-[22px] text-sm font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] disabled:pointer-events-none disabled:opacity-40"
          >
            {queueing ? "Starting…" : "Start Backtest"}
          </button>
        </div>
        {queueError && <p className="mt-3 text-xs text-danger-500">{queueError}</p>}

        {/* Minimal read of the selected allocation — a plain segmented bar,
            not the interactive AllocationBar/StickyAllocationBar used on
            Overview and Parameters, so this page doesn't read as a repeat
            of that same widget. The legend below it is deliberately the
            same tinted-chip style as AllocationBar's, per request, just
            without the hover/select interactivity that page doesn't need.
            The L1 class totals sit to the right, filling the same empty
            space the row above fills with the Start Backtest button. */}
        {allocationSegments.length > 0 && (
          <div className="mt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <SegmentedBar segments={allocationSegments} legend={false} className="max-w-2xl flex-1" />
              <div className="flex shrink-0 items-center gap-4">
                {l1Totals.map((cls) => (
                  <span key={cls.id} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: cls.color }} />
                    <span className="text-[13px] font-semibold text-ink-2">{cls.label}</span>
                    <span className="text-[13px] font-semibold tabular-nums text-ink">{formatPct(cls.weight, 1)}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {allocationSegments.map((segment) => (
                <span key={segment.id} className="inline-flex items-center gap-2 rounded-md bg-paper-2 px-3 py-2">
                  <span className="h-3.5 w-3.5 shrink-0" style={{ backgroundColor: segment.color }} />
                  <span className="text-[13px] font-semibold text-ink">{segment.label}</span>
                  <span className="text-[13px] font-semibold tabular-nums text-muted">{formatPct(segment.weight)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Split and Funds share one panel behind a tab row — the same
          underlined-tab-over-a-card pattern as the Data Points control
          center's asset-class tabs, with each tab's own row count next to
          its label, rather than two separately bordered sections. */}
      <section className="mb-8 border border-line bg-paper p-5">
        <TabRow
          options={PANEL_TAB_OPTIONS.map((option) => ({
            id: option.id,
            label: `${option.label} (${option.id === "split" ? Object.keys(sleevePercentages).length : legs.length})`,
          }))}
          value={panelTab}
          onChange={setPanelTab}
          className="mb-5"
        />

        {panelTab === "split" && (
          <div>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Total to invest</span>
                  <AmountInput value={totalAmount} onChange={setTotalAmount} className="w-36" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Purchase date</span>
                  <input
                    type="date"
                    value={purchaseDate}
                    max={todayIso()}
                    onChange={(e) => updatePurchaseDate(e.target.value)}
                    className="h-9 border border-line bg-paper px-3 text-[13px] text-ink focus:border-ink focus:outline-none"
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium ${Math.abs(percentageSum - 1) > 0.005 ? "text-warn-600" : "text-muted"}`}>
                  Split totals {(percentageSum * 100).toFixed(1)}%
                </span>
                <button
                  type="button"
                  onClick={prefillFromSplit}
                  className="border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2"
                >
                  Prefill amounts
                </button>
              </div>
            </div>

            <div className="divide-y divide-line">
              {Object.entries(sleevePercentages).map(([sleeveId, pct]) => (
                <div key={sleeveId} className="grid grid-cols-12 items-center gap-3 px-1 py-2.5">
                  <div className="col-span-3 truncate text-[13px] text-ink-2">{sleeveId}</div>
                  <Slider value={pct} min={0} max={0.6} step={0.005} onChange={(e) => updateSleevePercentage(sleeveId, Number(e.target.value))} className="col-span-7" />
                  <div className="col-span-2 text-right font-mono text-[13px] font-medium tabular-nums text-ink">{(pct * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {panelTab === "funds" && (
          <div>
            <p className="mb-3 text-xs text-muted">One real fund per sleeve — defaults are pre-filled, click to review or change.</p>
            <div className="mb-2 grid grid-cols-12 gap-3 text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">
              <div className="col-span-3">Sleeve</div>
              <div className="col-span-6">Fund</div>
              <div className="col-span-2">Amount (₹)</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-2">
              {legs.map((leg) => (
                <div key={leg._id} className="grid grid-cols-12 items-start gap-3">
                  <input
                    type="text"
                    value={leg.sleeveId}
                    onChange={(e) => updateLeg(leg._id, { sleeveId: e.target.value })}
                    placeholder="sleeve id"
                    className="col-span-3 h-9 border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
                  />
                  <div className="col-span-6">
                    <FundPicker value={leg.schemeCode ? { schemeCode: leg.schemeCode, schemeName: leg.schemeName } : null} onSelect={(scheme) => updateLeg(leg._id, scheme)} />
                  </div>
                  <AmountInput value={leg.amount} onChange={(amount) => updateLeg(leg._id, { amount })} className="col-span-2 w-full" />
                  <button
                    type="button"
                    onClick={() => removeLeg(leg._id)}
                    aria-label="Remove leg"
                    className="col-span-1 flex h-9 items-center justify-center text-muted transition-colors duration-100 ease-in hover:bg-paper-2 hover:text-danger-500"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addLeg} className="mt-3 text-xs font-semibold text-ink-2 transition-colors duration-100 ease-in hover:text-ink">
              + Add fund
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
