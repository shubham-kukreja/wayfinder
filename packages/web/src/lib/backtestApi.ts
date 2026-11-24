import { coreFetch } from "./coreApi.js";

// Backtesting on core-jobs-service: GET /v1/benchmarks, /v1/funds/search,
// /v1/backtests/defaults, and /v1/backtests (submit, list, get, cancel,
// rerun). The types below are the ones the screens were built on; this
// module maps core's snake_case records onto them. Benchmarks are shown by
// name ("Nifty 50") and sent to core by key ("nifty50").

export interface BacktestLeg {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  date: string; // ISO yyyy-mm-dd
}

export interface BacktestPoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  portfolioReturnPct: number;
  benchmarkReturnPct: number;
}

export interface BacktestLegResult extends BacktestLeg {
  units: number;
  entryNav: number;
  latestNav: number;
  currentValue: number;
  missingHistory: boolean;
}

export interface BacktestSummary {
  totalInvested: number;
  portfolioCurrentValue: number;
  benchmarkCurrentValue: number;
  portfolioXirr: number | null;
  benchmarkXirr: number | null;
  portfolioCagr?: number | null;
  benchmarkCagr?: number | null;
  absoluteReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
}

export interface BacktestResult {
  legs: BacktestLegResult[];
  series: BacktestPoint[];
  summary: BacktestSummary;
}

export interface DefaultFundPick {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
}

export interface SchemeSearchResult {
  schemeCode: string;
  schemeName: string;
  /** Fund house and plan, shown under the name. */
  detail: string;
}

export type BacktestJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface BacktestJobBase {
  id: string;
  label: string;
  legs: BacktestLeg[];
  benchmarkId: string;
  status: BacktestJobStatus;
  etaSeconds: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BacktestJob extends BacktestJobBase {
  result: BacktestResult | null;
}

export type BacktestJobSummary = BacktestJobBase & { summary: BacktestSummary | null };

// ---- core wire format ----

interface CoreLeg {
  sleeve: string;
  scheme_code: string;
  scheme_name: string;
  amount: number;
  date: string;
}

interface CoreSummary {
  total_invested: number;
  portfolio_current_value: number;
  benchmark_current_value: number;
  portfolio_xirr: number | null;
  benchmark_xirr: number | null;
  portfolio_cagr: number | null;
  benchmark_cagr: number | null;
  absolute_return_pct: number;
  benchmark_return_pct: number;
  max_drawdown_pct: number;
}

interface CoreBacktest {
  id: string;
  name: string;
  status: BacktestJobStatus;
  benchmark: string;
  legs: CoreLeg[];
  summary: CoreSummary | null;
  result?: {
    legs: Array<CoreLeg & { units: number; entry_nav: number; latest_nav: number; current_value: number; missing_history: boolean }>;
    series: Array<{ date: string; portfolio_value: number; benchmark_value: number; portfolio_return_pct: number; benchmark_return_pct: number }>;
    summary: CoreSummary;
  };
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

let benchmarkNames: Map<string, string> | null = null;

async function benchmarkMap(): Promise<Map<string, string>> {
  if (!benchmarkNames) {
    const res = await coreFetch<{ data: Array<{ key: string; name: string; to: string | null }> }>("/v1/benchmarks");
    benchmarkNames = new Map(res.data.map((b) => [b.key, b.name]));
  }
  return benchmarkNames;
}

async function benchmarkKey(name: string): Promise<string> {
  for (const [k, n] of await benchmarkMap()) if (n === name || k === name) return k;
  throw new Error(`Unknown benchmark: ${name}`);
}

const leg = (l: CoreLeg): BacktestLeg => ({ sleeveId: l.sleeve, schemeCode: l.scheme_code, schemeName: l.scheme_name, amount: l.amount, date: l.date });

const summary = (s: CoreSummary): BacktestSummary => ({
  totalInvested: s.total_invested,
  portfolioCurrentValue: s.portfolio_current_value,
  benchmarkCurrentValue: s.benchmark_current_value,
  portfolioXirr: s.portfolio_xirr,
  benchmarkXirr: s.benchmark_xirr,
  portfolioCagr: s.portfolio_cagr,
  benchmarkCagr: s.benchmark_cagr,
  absoluteReturnPct: s.absolute_return_pct,
  benchmarkReturnPct: s.benchmark_return_pct,
  maxDrawdownPct: s.max_drawdown_pct,
});

function base(b: CoreBacktest, names: Map<string, string>): BacktestJobBase {
  return {
    id: b.id,
    label: b.name || "Untitled backtest",
    legs: b.legs.map(leg),
    benchmarkId: names.get(b.benchmark) ?? b.benchmark,
    status: b.status,
    etaSeconds: null,
    error: b.error,
    createdAt: b.created_at,
    startedAt: b.started_at,
    finishedAt: b.finished_at,
  };
}

function toJob(b: CoreBacktest, names: Map<string, string>): BacktestJob {
  const r = b.result;
  return {
    ...base(b, names),
    result: r
      ? {
          legs: r.legs.map((l) => ({
            ...leg(l),
            units: l.units,
            entryNav: l.entry_nav,
            latestNav: l.latest_nav,
            currentValue: l.current_value,
            missingHistory: l.missing_history,
          })),
          series: r.series.map((p) => ({
            date: p.date,
            portfolioValue: p.portfolio_value,
            benchmarkValue: p.benchmark_value,
            portfolioReturnPct: p.portfolio_return_pct,
            benchmarkReturnPct: p.benchmark_return_pct,
          })),
          summary: summary(r.summary),
        }
      : null,
  };
}

/** Benchmark names that have history in core. */
export async function listBenchmarks(): Promise<string[]> {
  const res = await coreFetch<{ data: Array<{ key: string; name: string; to: string | null }> }>("/v1/benchmarks");
  benchmarkNames = new Map(res.data.map((b) => [b.key, b.name]));
  return res.data.filter((b) => b.to !== null).map((b) => b.name);
}

export async function listDefaultFunds(): Promise<DefaultFundPick[]> {
  const res = await coreFetch<{ data: Array<{ sleeve: string; scheme_code: string; scheme_name: string }> }>("/v1/backtests/defaults");
  return res.data.map((d) => ({ sleeveId: d.sleeve, schemeCode: d.scheme_code, schemeName: d.scheme_name }));
}

export async function searchSchemes(q: string): Promise<SchemeSearchResult[]> {
  const res = await coreFetch<{ data: Array<{ scheme_code: string; name: string; amc: string; plan: string; option: string; active: boolean }> }>(
    `/v1/funds/search?q=${encodeURIComponent(q)}&limit=30`,
  );
  return res.data
    .filter((f) => f.active)
    .map((f) => ({ schemeCode: f.scheme_code, schemeName: f.name, detail: [f.amc, f.plan, f.option].filter(Boolean).join(" · ") }));
}

export async function listBacktestJobs(): Promise<BacktestJobSummary[]> {
  const [names, res] = await Promise.all([benchmarkMap(), coreFetch<{ data: CoreBacktest[] }>("/v1/backtests?limit=100")]);
  return res.data.map((b) => ({ ...base(b, names), summary: b.summary ? summary(b.summary) : null }));
}

export async function getBacktestJob(id: string): Promise<BacktestJob> {
  const [names, b] = await Promise.all([benchmarkMap(), coreFetch<CoreBacktest>(`/v1/backtests/${encodeURIComponent(id)}`)]);
  return toJob(b, names);
}

export async function enqueueBacktestJob(input: { label: string; legs: BacktestLeg[]; benchmarkId: string }): Promise<BacktestJob> {
  const [names, key] = await Promise.all([benchmarkMap(), benchmarkKey(input.benchmarkId)]);
  const b = await coreFetch<CoreBacktest>("/v1/backtests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.label,
      benchmark: key,
      legs: input.legs.map((l) => ({ sleeve: l.sleeveId, scheme_code: l.schemeCode, scheme_name: l.schemeName, amount: l.amount, date: l.date })),
    }),
  });
  return toJob(b, names);
}

export async function cancelBacktestJob(id: string): Promise<void> {
  await coreFetch(`/v1/backtests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}
