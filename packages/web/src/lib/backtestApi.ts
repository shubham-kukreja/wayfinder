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
