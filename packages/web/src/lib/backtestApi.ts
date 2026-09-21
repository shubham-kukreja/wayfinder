import { API_BASE_URL } from "./constants.js";
import { apiFetch, apiFetchJson } from "./apiFetch.js";

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
  // Optional so reports saved before CAGR was introduced remain readable.
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

export interface BacktestScenario {
  id: string;
  label: string;
  legs: BacktestLeg[];
  benchmarkId: string;
  createdAt: string;
  updatedAt: string;
}

export async function listBenchmarks(): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/benchmarks`);
  if (!res.ok) throw new Error(`Failed to load benchmarks: ${res.status}`);
  const data = (await res.json()) as { benchmarks: string[] };
  return data.benchmarks;
}

export interface InflationRate {
  ratePct: number;
  asOf: string;
}

export async function getInflationRate(): Promise<InflationRate | null> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/inflation`);
  if (!res.ok) return null;
  return res.json();
}

export interface DefaultFundPick {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
}

export async function listDefaultFunds(): Promise<DefaultFundPick[]> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/default-funds`);
  if (!res.ok) throw new Error(`Failed to load default funds: ${res.status}`);
  const data = (await res.json()) as { defaults: DefaultFundPick[] };
  return data.defaults;
}

export async function runBacktest(legs: BacktestLeg[], benchmarkId: string): Promise<BacktestResult> {
  const res = await apiFetchJson("/api/backtest/run", "POST", { legs, benchmarkId });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Backtest run failed: ${res.status}`);
  }
  return res.json();
}

export async function listBacktestScenarios(): Promise<BacktestScenario[]> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/scenarios`);
  if (!res.ok) throw new Error(`Failed to load scenarios: ${res.status}`);
  const data = (await res.json()) as { scenarios: BacktestScenario[] };
  return data.scenarios;
}

export async function saveBacktestScenario(input: {
  id?: string;
  label: string;
  legs: BacktestLeg[];
  benchmarkId: string;
}): Promise<BacktestScenario> {
  const res = await apiFetchJson("/api/backtest/scenarios", "POST", input);
  if (!res.ok) throw new Error(`Failed to save scenario: ${res.status}`);
  return res.json();
}

export async function deleteBacktestScenario(id: string): Promise<void> {
  const res = await apiFetch(`/api/backtest/scenarios/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete scenario: ${res.status}`);
}

export interface SchemeSearchResult {
  schemeCode: string;
  schemeName: string;
  nav: number;
  date: string;
}

export async function searchSchemes(q: string): Promise<SchemeSearchResult[]> {
  const res = await fetch(`${API_BASE_URL}/api/schemes/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Scheme search failed: ${res.status}`);
  const data = (await res.json()) as { results: SchemeSearchResult[] };
  return data.results;
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

// GET /api/backtest/jobs (the list/Runs-page endpoint) never includes each
// job's full result — a completed job's result.series can hold ~1,800
// points for a 5-year backtest, and the Runs page polls every few seconds
// while anything is in flight, so returning full results there caused a
// real server OOM (confirmed live 2026-09-20). Only GET
// /api/backtest/jobs/:id (a single job's own detail/report page) returns
// the full BacktestJob with `result` populated. `summary` is the one
// exception — the server extracts just that small object (via SQLite's
// json_extract, never the full result_json) so the list can show XIRR/
// return without re-adding the series array that caused the OOM.
export type BacktestJobSummary = BacktestJobBase & { summary: BacktestSummary | null };

export async function listBacktestJobs(): Promise<BacktestJobSummary[]> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/jobs`);
  if (!res.ok) throw new Error(`Failed to load backtest jobs: ${res.status}`);
  const data = (await res.json()) as { jobs: BacktestJobSummary[] };
  return data.jobs;
}

export async function getBacktestJob(id: string): Promise<BacktestJob> {
  const res = await fetch(`${API_BASE_URL}/api/backtest/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load backtest job: ${res.status}`);
  return res.json();
}

export async function enqueueBacktestJob(input: { label: string; legs: BacktestLeg[]; benchmarkId: string }): Promise<BacktestJob> {
  const res = await apiFetchJson("/api/backtest/jobs", "POST", input);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to queue backtest: ${res.status}`);
  }
  return res.json();
}

export async function cancelBacktestJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/backtest/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to cancel job: ${res.status}`);
  }
}
