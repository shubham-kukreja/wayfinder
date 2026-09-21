import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BacktestChart } from "../../components/backtest/BacktestChart.js";
import { SegmentedBar, type Segment } from "../../components/ui/SegmentedBar.js";
import { TabRow } from "../../components/ui/TabRow.js";
import { formatXirr, formatPctValue, formatRupees } from "../../lib/backtestFormat.js";
import {
  enqueueBacktestJob,
  getBacktestJob,
  type BacktestJob,
} from "../../lib/backtestApi.js";

type ReportTab = "metrics" | "allocation" | "funds";

const REPORT_TABS: ReadonlyArray<{ id: ReportTab; label: string }> = [
  { id: "metrics", label: "Key metrics" },
  { id: "allocation", label: "Allocation used" },
  { id: "funds", label: "Per-fund result" },
];

const FAMILY_COLORS = {
  equity: ["#4A57E0", "#5C6AE8", "#7B86F4", "#A3ABF8", "#C5CAFB", "#DDE0FD"],
  debt: ["#3B9A52", "#4CAF63", "#7FCB92", "#A8E6B4"],
  metals: ["#D96A2F", "#E8834F", "#F2B195", "#FBE4D8"],
} as const;

function sleeveFamily(id: string): keyof typeof FAMILY_COLORS {
  if (id.startsWith("debt.") || id.includes("debt")) return "debt";
  if (id.startsWith("metals.") || id.includes("gold") || id.includes("silver") || id.includes("metal")) return "metals";
  return "equity";
}

function buildAllocationSegments(job: BacktestJob): Segment[] {
  const amounts = new Map<string, number>();
  for (const leg of job.legs) amounts.set(leg.sleeveId, (amounts.get(leg.sleeveId) ?? 0) + leg.amount);
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
  const familyIndex: Record<keyof typeof FAMILY_COLORS, number> = { equity: 0, debt: 0, metals: 0 };

  return [...amounts.entries()].map(([id, amount]) => {
    const family = sleeveFamily(id);
    const ramp = FAMILY_COLORS[family];
    const index = familyIndex[family]++;
    return { id, label: id, weight: total > 0 ? amount / total : 0, color: ramp[Math.min(index, ramp.length - 1)]! };
  });
}

function formatRupeeDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatRupees(Math.abs(value))}`;
}

function MetricCard({
  label,
  allocation,
  benchmark,
  delta,
  deltaTone,
}: {
  label: string;
  allocation: string;
  benchmark: string;
  delta: string;
  deltaTone: "positive" | "negative" | "neutral";
}) {
  const deltaColor = deltaTone === "positive" ? "text-brand-800" : deltaTone === "negative" ? "text-danger-500" : "text-ink";

  return (
    <div className="rounded-lg bg-paper-2 p-5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-eyebrow text-muted">Difference</div>
        <div className={`mt-1 font-mono text-[26px] font-semibold leading-none tracking-tight tabular-nums ${deltaColor}`}>{delta}</div>
      </div>
      <div className="mt-5 space-y-3 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted"><span className="h-[3px] w-5 bg-[#0FAE62]" />Allocation</span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{allocation}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted"><span className="h-[3px] w-5 bg-[#D2B640]" />Benchmark</span>
          <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">{benchmark}</span>
        </div>
      </div>
    </div>
  );
}

export function BacktestReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<BacktestJob | null>(null);
  const [tab, setTab] = useState<ReportTab>("metrics");
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    if (!id) return;
    getBacktestJob(id).then(setJob).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  const segments = useMemo(() => (job ? buildAllocationSegments(job) : []), [job]);

  async function handleRerun() {
    if (!job) return;
    setRerunning(true);
    try {
      const newJob = await enqueueBacktestJob({ label: `${job.label} (re-run)`, legs: job.legs, benchmarkId: job.benchmarkId });
      navigate(`/backtest/runs/${newJob.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRerunning(false);
    }
  }

  if (error) {
    return <div className="mx-auto w-full max-w-[1600px] px-6 py-8"><p className="text-sm text-danger-500">{error}</p><Link to="/backtest/runs" className="mt-4 inline-block text-sm font-medium text-ink-2 underline">Back to Run History</Link></div>;
  }
  if (!job) return <div className="mx-auto w-full max-w-[1600px] px-6 py-8 text-sm text-muted">Loading…</div>;
  if (job.status !== "completed" || !job.result) {
    return <div className="mx-auto w-full max-w-[1600px] px-6 py-8"><p className="text-sm text-muted">This run is {job.status}{job.status === "failed" && job.error ? `: ${job.error}` : "."}</p><Link to="/backtest/runs" className="mt-4 inline-block text-sm font-medium text-ink-2 underline">Back to Run History</Link></div>;
  }

  const { result } = job;
  const portfolioProfit = result.summary.portfolioCurrentValue - result.summary.totalInvested;
  const benchmarkProfit = result.summary.benchmarkCurrentValue - result.summary.totalInvested;
  // Completed jobs persist their result JSON. Runs created before the
  // percent-indexed chart was introduced have values but no return fields,
  // so enrich them from the job's dated cash contributions at read time.
  const chartSeries = result.series.map((point) => {
    const investedToDate = job.legs.reduce((sum, leg) => (leg.date <= point.date ? sum + leg.amount : sum), 0);
    return {
      ...point,
      portfolioReturnPct: Number.isFinite(point.portfolioReturnPct)
        ? point.portfolioReturnPct
        : investedToDate > 0
          ? ((point.portfolioValue - investedToDate) / investedToDate) * 100
          : 0,
      benchmarkReturnPct: Number.isFinite(point.benchmarkReturnPct)
        ? point.benchmarkReturnPct
        : investedToDate > 0
          ? ((point.benchmarkValue - investedToDate) / investedToDate) * 100
          : 0,
    };
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <Link to="/backtest/runs" className="mb-2 inline-block text-xs font-medium text-muted transition-colors duration-100 ease-in hover:text-ink">← Run History</Link>
          <h1 className="mb-1 font-display text-xl text-ink">{job.label}</h1>
          <p className="text-sm text-muted">{job.benchmarkId} · {job.legs.length} funds · {job.finishedAt ? new Date(job.finishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}</p>
        </div>
        <button type="button" onClick={handleRerun} disabled={rerunning} className="shrink-0 border border-ink px-3 py-1.5 text-xs font-semibold text-ink transition duration-100 ease-in hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-40">{rerunning ? "Queuing…" : "Re-run"}</button>
      </div>

      <section>
        <TabRow options={REPORT_TABS} value={tab} onChange={setTab} className="mb-6" />

        {tab === "metrics" && (
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                label="Current value"
                allocation={formatRupees(result.summary.portfolioCurrentValue)}
                benchmark={formatRupees(result.summary.benchmarkCurrentValue)}
                delta={formatRupeeDelta(portfolioProfit - benchmarkProfit)}
                deltaTone={portfolioProfit > benchmarkProfit ? "positive" : portfolioProfit < benchmarkProfit ? "negative" : "neutral"}
              />
              <MetricCard
                label="Absolute return"
                allocation={formatPctValue(result.summary.absoluteReturnPct)}
                benchmark={formatPctValue(result.summary.benchmarkReturnPct)}
                delta={formatPctValue(result.summary.absoluteReturnPct - result.summary.benchmarkReturnPct)}
                deltaTone={result.summary.absoluteReturnPct > result.summary.benchmarkReturnPct ? "positive" : result.summary.absoluteReturnPct < result.summary.benchmarkReturnPct ? "negative" : "neutral"}
              />
              <MetricCard
                label="XIRR"
                allocation={formatXirr(result.summary.portfolioXirr)}
                benchmark={formatXirr(result.summary.benchmarkXirr)}
                delta={result.summary.portfolioXirr !== null && result.summary.benchmarkXirr !== null ? formatXirr(result.summary.portfolioXirr - result.summary.benchmarkXirr) : "—"}
                deltaTone={
                  result.summary.portfolioXirr === null || result.summary.benchmarkXirr === null
                    ? "neutral"
                    : result.summary.portfolioXirr > result.summary.benchmarkXirr
                      ? "positive"
                      : result.summary.portfolioXirr < result.summary.benchmarkXirr
                        ? "negative"
                        : "neutral"
                }
              />
            </div>

            <div className="mt-8">
              <div className="mb-5 flex items-end justify-between gap-4"><div><h2 className="text-lg font-semibold text-ink">Return over time</h2><p className="mt-0.5 text-[13px] text-muted">Percentage gain on capital invested by each date.</p></div><span className="text-[11px] text-muted">Hover for return, value and performance gap</span></div>
              <BacktestChart series={chartSeries} />
            </div>
          </div>
        )}

        {tab === "allocation" && (
          <div>
            <SegmentedBar segments={segments} legend={false} />
            <div className="mt-3 flex flex-wrap gap-2">
              {segments.map((segment) => <span key={segment.id} className="inline-flex items-center gap-2 rounded-md bg-paper-2 px-3 py-2"><span className="h-3.5 w-3.5 shrink-0" style={{ backgroundColor: segment.color }} /><span className="text-[13px] font-semibold text-ink">{segment.label}</span><span className="font-mono text-[13px] font-semibold tabular-nums text-muted">{formatPctValue(segment.weight * 100)}</span></span>)}
            </div>
            <div className="mt-6 overflow-x-auto border border-line">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-line bg-paper-2 text-left text-xs text-muted"><th className="px-5 py-2.5 font-medium">Sleeve</th><th className="px-5 py-2.5 font-medium">Fund</th><th className="px-5 py-2.5 text-right font-medium">Amount</th><th className="px-5 py-2.5 text-right font-medium">Weight</th><th className="px-5 py-2.5 text-right font-medium">Purchase date</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {job.legs.map((leg) => <tr key={`${leg.sleeveId}-${leg.schemeCode}`}><td className="px-5 py-2.5 text-[13px] text-ink-2">{leg.sleeveId}</td><td className="px-5 py-2.5 text-[13px] text-ink">{leg.schemeName}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{formatRupees(leg.amount)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{formatPctValue((leg.amount / result.summary.totalInvested) * 100)}</td><td className="px-5 py-2.5 text-right text-[13px] tabular-nums text-ink-2">{leg.date}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "funds" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border border-line text-sm">
              <thead><tr className="border-b border-line bg-paper-2 text-left text-xs text-muted"><th className="px-5 py-2.5 font-medium">Fund</th><th className="px-5 py-2.5 text-right font-medium">Invested</th><th className="px-5 py-2.5 text-right font-medium">Entry NAV</th><th className="px-5 py-2.5 text-right font-medium">Latest NAV</th><th className="px-5 py-2.5 text-right font-medium">Units</th><th className="px-5 py-2.5 text-right font-medium">Current value</th><th className="px-5 py-2.5 text-right font-medium">Return</th></tr></thead>
              <tbody className="divide-y divide-line">
                {result.legs.map((leg) => <tr key={`${leg.sleeveId}-${leg.schemeCode}`}><td className="px-5 py-2.5 text-[13px] text-ink-2"><span className="block text-ink">{leg.schemeName}</span><span className="text-[11px] text-muted">{leg.sleeveId}</span>{leg.missingHistory && <span className="ml-2 text-xs text-warn-600">no NAV history</span>}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{formatRupees(leg.amount)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{leg.missingHistory ? "—" : leg.entryNav.toFixed(2)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{leg.missingHistory ? "—" : leg.latestNav.toFixed(2)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{leg.missingHistory ? "—" : leg.units.toFixed(3)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{formatRupees(leg.currentValue)}</td><td className="px-5 py-2.5 text-right font-mono text-[13px] tabular-nums text-ink">{leg.amount > 0 && !leg.missingHistory ? formatPctValue(((leg.currentValue - leg.amount) / leg.amount) * 100) : "—"}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
