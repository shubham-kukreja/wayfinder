import { useEffect, useMemo, useRef, useState } from "react";
import { computeAllocation } from "@wayfinder/engine";
import { useSnapshot } from "../hooks/useSnapshot.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../lib/constants.js";
import { FundPicker } from "../components/backtest/FundPicker.js";
import { BacktestChart } from "../components/backtest/BacktestChart.js";
import { Slider } from "../components/ui/Slider.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { StickyAllocationBar } from "../components/StickyAllocationBar.js";
import {
  listBenchmarks,
  runBacktest,
  listBacktestScenarios,
  saveBacktestScenario,
  deleteBacktestScenario,
  listDefaultFunds,
  type BacktestLeg,
  type BacktestResult,
  type BacktestScenario,
} from "../lib/backtestApi.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultPurchaseDateIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

let legIdCounter = 0;
function nextLegId(): string {
  legIdCounter += 1;
  return `leg-${legIdCounter}`;
}

interface LegDraft extends BacktestLeg {
  _id: string;
}

function formatXirr(x: number | null): string {
  if (x === null) return "—";
  const pct = x * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPctValue(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Indian numbering (K/L/Cr), not the western K/M/B a plain Intl.NumberFormat
// compact notation would produce — 100000 reads as "1L" here, matching how
// every rupee figure elsewhere in this flow (and in India generally) is
// actually spoken, not as "100K".
function formatRupeesCompact(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(abs >= 10_00_00_000 ? 1 : 2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(abs >= 10_00_000 ? 1 : 2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function BacktestView() {
  const { snapshot } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);
  const allocation = useMemo(() => {
    if (!snapshot) return null;
    return computeAllocation(scoresFromSnapshot(snapshot.scores), vetoesFromSnapshot(snapshot.vetoes), snapshot.params);
  }, [snapshot]);
  // Watched by StickyAllocationBar: once this section scrolls out from
  // under the TopBar, the condensed strip takes over — same handoff
  // Parameters uses for its own "Live allocation" band.
  const liveBarRef = useRef<HTMLElement>(null);

  const [legs, setLegs] = useState<LegDraft[]>([]);
  const [benchmarkId, setBenchmarkId] = useState<string>("Nifty 50");
  const [benchmarks, setBenchmarks] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const [scenarios, setScenarios] = useState<BacktestScenario[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const [defaultFunds, setDefaultFunds] = useState<Record<string, { schemeCode: string; schemeName: string }>>({});

  // Total to split across sleeves, and each sleeve's share of it — a
  // second, higher-level way to set leg amounts than typing each one by
  // hand. Percentages default to the model's own weights (allocation.rollup)
  // and stay in sync with typed-in amounts whenever those imply a
  // different split (see the amount-typed branch in updateLeg below), so
  // the slider row always reflects what the legs table actually holds —
  // never a stale split left over from before an override.
  const [totalAmount, setTotalAmount] = useState<number>(100000);
  const [sleevePercentages, setSleevePercentages] = useState<Record<string, number>>({});

  // One shared purchase date for every leg — all lump-sum, bought the same
  // day. SIP (a different amount/date per instalment) is a separate,
  // future planning mode, not this date; changing this one input updates
  // every leg's date in lockstep, so there's nowhere for legs to silently
  // drift onto different dates.
  const [purchaseDate, setPurchaseDate] = useState<string>(defaultPurchaseDateIso());

  useEffect(() => {
    listBenchmarks().then(setBenchmarks).catch(() => setBenchmarks([]));
    listBacktestScenarios().then(setScenarios).catch(() => setScenarios([]));
    listDefaultFunds()
      .then((picks) => {
        const bySleeve: Record<string, { schemeCode: string; schemeName: string }> = {};
        for (const p of picks) bySleeve[p.sleeveId] = { schemeCode: p.schemeCode, schemeName: p.schemeName };
        setDefaultFunds(bySleeve);
      })
      .catch(() => setDefaultFunds({}));
  }, []);

  // Default to the current published allocation's leaf sleeves — model
  // weight as the starting percentage/amount split, and (where a free AMFI
  // scheme name pattern matches — see server/src/lib/defaultFunds.ts) a
  // real fund pre-selected per sleeve, so the modeling surface starts from
  // "what we actually hold, in a fund we can actually buy" rather than an
  // empty form.
  useEffect(() => {
    if (!allocation || legs.length > 0) return;
    const rows = allocation.rollup.filter((r) => r.portfolioWeight > 0.001);
    const percentages: Record<string, number> = {};
    for (const r of rows) percentages[r.id] = r.portfolioWeight;
    setSleevePercentages(percentages);

    const defaults: LegDraft[] = rows.map((r) => {
      const fund = defaultFunds[r.id];
      return {
        _id: nextLegId(),
        sleeveId: r.id,
        schemeCode: fund?.schemeCode ?? "",
        schemeName: fund?.schemeName ?? "",
        amount: Math.round(r.portfolioWeight * totalAmount),
        date: purchaseDate,
      };
    });
    setLegs(defaults);
    // Re-runs once defaultFunds arrives (usually after allocation, since
    // it's a second network call) to fill in fund names on the rows
    // that were just created blank — see the defaultFunds-only effect
    // below, which patches schemeCode/schemeName onto existing legs
    // rather than re-triggering this whole effect via its own deps.
  }, [allocation]);

  // Patches fund picks onto already-created legs once default-funds loads
  // after the initial allocation-driven leg creation above (the common
  // order, since default-funds is a second, slightly slower call) —
  // without this, a leg created before defaultFunds resolved would stay
  // blank forever even though a match exists.
  useEffect(() => {
    if (Object.keys(defaultFunds).length === 0) return;
    setLegs((prev) =>
      prev.map((l) => {
        if (l.schemeCode) return l; // never override a fund the user already picked or that was already filled
        const fund = defaultFunds[l.sleeveId];
        return fund ? { ...l, schemeCode: fund.schemeCode, schemeName: fund.schemeName } : l;
      })
    );
  }, [defaultFunds]);

  function updateLeg(id: string, patch: Partial<LegDraft>) {
    setLegs((prev) => {
      const next = prev.map((l) => (l._id === id ? { ...l, ...patch } : l));
      // A directly-typed amount is an override of the split — recompute
      // that one sleeve's percentage from it (against the CURRENT total)
      // so the slider/percentage row reflects the table instead of going
      // stale the moment someone edits an amount by hand.
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

  // The single date input's onChange — updates the shared date AND every
  // existing leg's date in the same action, so the legs table is never
  // left holding a stale date after the picker changes.
  function updatePurchaseDate(date: string) {
    setPurchaseDate(date);
    setLegs((prev) => prev.map((l) => ({ ...l, date })));
  }

  // A slider drag sets that one sleeve's percentage directly — deliberately
  // NOT re-normalised against the others on every drag (which would fight
  // the user's cursor mid-drag as every other slider jumps). The split can
  // sum to more or less than 100% while sliders are being adjusted; the
  // sum is only what matters at the moment "Prefill amounts" is clicked,
  // which is the actual point the split becomes real leg amounts.
  function updateSleevePercentage(sleeveId: string, pct: number) {
    setSleevePercentages((prev) => ({ ...prev, [sleeveId]: pct }));
  }

  // Applies the current split (sleevePercentages × totalAmount) onto every
  // leg's amount — the one place a percentage actually becomes a rupee
  // figure. A leg for a sleeve with no percentage set yet (e.g. one added
  // via "+ Add fund") is left alone rather than zeroed.
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

  async function handleRun() {
    setRunError(null);
    if (readyLegs.length === 0) {
      setRunError("Pick a fund, amount, and date for at least one sleeve.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await runBacktest(
        readyLegs.map(({ _id, ...rest }) => rest),
        benchmarkId
      );
      setResult(res);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function handleSaveScenario() {
    if (!scenarioLabel.trim() || readyLegs.length === 0) return;
    setSaving(true);
    try {
      const saved = await saveBacktestScenario({
        id: activeScenarioId ?? undefined,
        label: scenarioLabel.trim(),
        legs: readyLegs.map(({ _id, ...rest }) => rest),
        benchmarkId,
      });
      setActiveScenarioId(saved.id);
      const updated = await listBacktestScenarios();
      setScenarios(updated);
    } finally {
      setSaving(false);
    }
  }

  function loadScenario(scenario: BacktestScenario) {
    setActiveScenarioId(scenario.id);
    setScenarioLabel(scenario.label);
    setBenchmarkId(scenario.benchmarkId);
    setLegs(scenario.legs.map((l) => ({ ...l, _id: nextLegId() })));
    // A saved scenario predates the single shared date picker and could in
    // principle hold different dates per leg — take the first leg's date
    // as the picker's value rather than leaving it stale from whatever was
    // on screen before. Loading the scenario doesn't itself rewrite the
    // legs' individual dates to match; only actually moving the picker
    // does that (see updatePurchaseDate).
    setPurchaseDate(scenario.legs[0]?.date ?? defaultPurchaseDateIso());
    setResult(null);
  }

  function newScenario() {
    setActiveScenarioId(null);
    setScenarioLabel("");
    setResult(null);
  }

  async function handleDeleteScenario(id: string) {
    await deleteBacktestScenario(id);
    const updated = await listBacktestScenarios();
    setScenarios(updated);
    if (activeScenarioId === id) newScenario();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink">Backtest</h1>
          <p className="mt-1 text-sm text-muted">Model your allocation with real funds and compare it against a benchmark index.</p>
        </div>
      </div>

      {/* Same "Live allocation" band Parameters shows — the model's own
          current allocation, read-only reference for the editable split
          below, not editable here itself. Scroll it past the TopBar and
          StickyAllocationBar takes over with the condensed strip. */}
      {allocation && (
        <>
          <StickyAllocationBar allocation={allocation} watch={liveBarRef} />
          <section ref={liveBarRef} className="mb-6 border border-line bg-paper">
            <div className="border-b border-line bg-paper-2 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-ink">Live allocation</h2>
              <p className="mt-0.5 text-xs text-muted">The model's current weights — for reference while setting the split below.</p>
            </div>
            <div className="p-5">
              <AllocationBar allocation={allocation} depth="detail" />
            </div>
          </section>
        </>
      )}

      {/* Saved scenarios */}
      <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <button
          type="button"
          onClick={newScenario}
          className={`rounded-sm px-3 py-1.5 text-xs font-medium ${activeScenarioId === null ? "bg-ink text-paper" : "border border-line text-ink-2 hover:bg-paper-2"}`}
        >
          + New
        </button>
        {scenarios.map((s) => (
          <div key={s.id} className="flex items-center">
            <button
              type="button"
              onClick={() => loadScenario(s)}
              className={`rounded-l-sm border border-line px-3 py-1.5 text-xs font-medium ${
                activeScenarioId === s.id ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"
              }`}
            >
              {s.label}
            </button>
            <button
              type="button"
              onClick={() => handleDeleteScenario(s.id)}
              aria-label={`Delete ${s.label}`}
              className="rounded-r-sm border border-l-0 border-line px-2 py-1.5 text-xs text-muted hover:bg-paper-2 hover:text-danger-500"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Total amount + split. Sliders default to the current model's own
          weights and start out in sync with the legs table (both derive
          from allocation.rollup on load); editing a slider here doesn't
          touch the table until "Prefill amounts" is clicked, while editing
          an amount directly in the table pushes that sleeve's slider back
          into sync (see updateLeg's patch.amount branch) so the two never
          silently disagree. */}
      <div className="mb-6 border border-line p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Total to invest (₹)</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={totalAmount || ""}
                  onChange={(e) => setTotalAmount(Number(e.target.value))}
                  className="h-9 w-40 border border-line bg-paper px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
                <span className="text-sm font-medium tabular-nums text-ink-2">{formatRupeesCompact(totalAmount)}</span>
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Purchase date (all funds)</span>
              <input
                type="date"
                value={purchaseDate}
                max={todayIso()}
                onChange={(e) => updatePurchaseDate(e.target.value)}
                className="h-9 border border-line bg-paper px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${Math.abs(percentageSum - 1) > 0.005 ? "text-warn-600" : "text-muted"}`}>
              Split totals {(percentageSum * 100).toFixed(1)}%
            </span>
            <button
              type="button"
              onClick={prefillFromSplit}
              className="h-9 rounded-sm border border-line px-4 text-sm font-medium text-ink-2 hover:bg-paper-2"
            >
              Prefill amounts from split
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(sleevePercentages).map(([sleeveId, pct]) => (
            <div key={sleeveId} className="grid grid-cols-12 items-center gap-2">
              <div className="col-span-2 text-xs text-ink-2">{sleeveId}</div>
              <Slider
                value={pct}
                min={0}
                max={0.6}
                step={0.005}
                onChange={(e) => updateSleevePercentage(sleeveId, Number(e.target.value))}
                className="col-span-8"
              />
              <div className="col-span-2 text-right text-xs tabular-nums text-ink">{(pct * 100).toFixed(1)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Legs */}
      <div className="mb-6 space-y-3">
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted">
          <div className="col-span-3">Sleeve</div>
          <div className="col-span-6">Fund</div>
          <div className="col-span-2">Amount (₹)</div>
          <div className="col-span-1" />
        </div>
        {legs.map((leg) => (
          <div key={leg._id} className="grid grid-cols-12 items-start gap-2">
            <input
              type="text"
              value={leg.sleeveId}
              onChange={(e) => updateLeg(leg._id, { sleeveId: e.target.value })}
              placeholder="sleeve id"
              className="col-span-3 h-9 border border-line bg-paper px-2 text-xs text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
            />
            <div className="col-span-6">
              <FundPicker
                value={leg.schemeCode ? { schemeCode: leg.schemeCode, schemeName: leg.schemeName } : null}
                onSelect={(scheme) => updateLeg(leg._id, scheme)}
              />
            </div>
            <div className="col-span-2">
              <input
                type="number"
                value={leg.amount || ""}
                onChange={(e) => updateLeg(leg._id, { amount: Number(e.target.value) })}
                placeholder="0"
                className="h-9 w-full border border-line bg-paper px-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
              />
              {leg.amount > 0 && <div className="mt-0.5 text-right text-[11px] tabular-nums text-muted">{formatRupeesCompact(leg.amount)}</div>}
            </div>
            <button
              type="button"
              onClick={() => removeLeg(leg._id)}
              aria-label="Remove leg"
              className="col-span-1 h-9 text-sm text-muted hover:text-danger-500"
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={addLeg} className="text-xs font-medium text-ink-2 hover:text-ink">
          + Add fund
        </button>
      </div>

      {/* Benchmark + run */}
      <div className="mb-6 flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Benchmark</span>
          <select
            value={benchmarkId}
            onChange={(e) => setBenchmarkId(e.target.value)}
            className="h-9 border border-line bg-paper px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {benchmarks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleRun}
          disabled={running || readyLegs.length === 0}
          className="h-9 rounded-sm bg-brand-700 px-4 text-sm font-semibold text-paper hover:bg-brand-800 disabled:opacity-50"
        >
          {running ? "Running…" : "Run backtest"}
        </button>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Scenario name</span>
          <input
            type="text"
            value={scenarioLabel}
            onChange={(e) => setScenarioLabel(e.target.value)}
            placeholder="e.g. Current allocation"
            className="h-9 w-56 border border-line bg-paper px-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </label>
        <button
          type="button"
          onClick={handleSaveScenario}
          disabled={saving || !scenarioLabel.trim() || readyLegs.length === 0}
          className="h-9 rounded-sm border border-line px-4 text-sm font-medium text-ink-2 hover:bg-paper-2 disabled:opacity-50"
        >
          {saving ? "Saving…" : activeScenarioId ? "Update scenario" : "Save scenario"}
        </button>
      </div>

      {runError && <div className="mb-4 border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-500">{runError}</div>}

      {running && (
        <div className="py-10 text-center text-sm text-muted">
          Fetching NAV/benchmark history — first run for a new fund or date range can take a minute or two.
        </div>
      )}

      {result && !running && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Invested" value={formatRupees(result.summary.totalInvested)} />
            <StatTile label="Current value" value={formatRupees(result.summary.portfolioCurrentValue)} sub={`Benchmark: ${formatRupees(result.summary.benchmarkCurrentValue)}`} />
            <StatTile
              label="XIRR"
              value={formatXirr(result.summary.portfolioXirr)}
              sub={`Benchmark: ${formatXirr(result.summary.benchmarkXirr)}`}
              tone={result.summary.portfolioXirr !== null && result.summary.portfolioXirr >= 0 ? "positive" : "negative"}
            />
            <StatTile label="Max drawdown" value={`-${result.summary.maxDrawdownPct.toFixed(2)}%`} tone="negative" />
          </div>

          <div className="border border-line p-4">
            <BacktestChart series={result.series} />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 font-medium">Fund</th>
                <th className="py-2 text-right font-medium">Invested</th>
                <th className="py-2 text-right font-medium">Units</th>
                <th className="py-2 text-right font-medium">Current value</th>
                <th className="py-2 text-right font-medium">Return</th>
              </tr>
            </thead>
            <tbody>
              {result.legs.map((l) => (
                <tr key={`${l.sleeveId}-${l.schemeCode}`} className="border-b border-paper-2">
                  <td className="py-2 text-ink-2">
                    {l.schemeName}
                    {l.missingHistory && <span className="ml-2 text-xs text-warn-600">no NAV history found for this date</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-ink">{formatRupees(l.amount)}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{l.units.toFixed(3)}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{formatRupees(l.currentValue)}</td>
                  <td className="py-2 text-right tabular-nums text-ink">
                    {l.amount > 0 ? formatPctValue(((l.currentValue - l.amount) / l.amount) * 100) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="border border-line p-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "positive" ? "text-brand-800" : tone === "negative" ? "text-danger-500" : "text-ink"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}
