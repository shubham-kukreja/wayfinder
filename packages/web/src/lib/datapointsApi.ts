import { API_BASE_URL } from "./constants.js";
import { apiFetch } from "./apiFetch.js";

export type DataPointFreshness = "current" | "due" | "stale" | "failed" | "missing" | "overridden";
export type DataPointUpdateType = "automatic" | "opt_in" | "manual" | "derived" | "governance" | "veto" | "raw_series" | "constant";

export interface DataPointRow {
  id: string;
  label: string;
  technicalKey: string;
  modelGroup: string;
  updateType: DataPointUpdateType;
  source: string;
  frequency: string;
  owner: string;
  description: string;
  dependency: string;
  currentValue: number | boolean | string | null;
  unit: string;
  score: number | null;
  freshness: DataPointFreshness;
  lastUpdated: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  state: "published" | "draft_override" | "validation_error";
  provenance: string | null;
  confidence: string | null;
  upstreamSeries: string[];
  sourceStatuses: Array<{ id: string; status: string; latestDate: string | null; staleDays: number | null }>;
  // True when the value shown is the static demo baseline, not a real
  // reading. mockReason says why (never wired / wired but not enough
  // history / no source exists).
  mock: boolean;
  mockReason: string | null;
}

export interface DataPointsResponse {
  rows: DataPointRow[];
  summary: Record<string, number>;
}

export async function listDataPoints(): Promise<DataPointsResponse> {
  const res = await fetch(`${API_BASE_URL}/api/datapoints`);
  if (!res.ok) throw new Error(`Failed to load data points: ${res.status}`);
  return res.json();
}

export async function refreshDataPoints(source: string): Promise<void> {
  const query = source === "all" ? "" : `?sources=${encodeURIComponent(source)}`;
  const res = await apiFetch(`/api/refresh${query}`, { method: "POST" });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
}
