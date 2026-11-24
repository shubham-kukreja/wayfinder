// Client for the core-jobs-service API (`/v1`), the backend CORE is moving to
// (core-jobs-service docs/plan.md, "Dashboard support"). It is separate from
// apiFetch, which talks to the legacy wayfinder server with a bearer token.
//
// Auth is core's cookie session: POST /v1/auth/login sets an HttpOnly
// `core_session` cookie and a readable `core_csrf` cookie that unsafe
// requests echo in X-CSRF-Token. Both cookies are SameSite=Strict, so the API
// must be same-origin: in development Vite proxies /v1 to the local API
// (vite.config.ts); in production the host must proxy /v1 the same way.

const CORE_BASE = import.meta.env.VITE_CORE_API_BASE_URL ?? "";

export class CoreApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)core_csrf=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export async function coreFetch<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const res = await fetch(`${CORE_BASE}${path}`, { ...init, headers, credentials: "same-origin", signal });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new CoreApiError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface CoreUser {
  email: string;
  role: string;
}

export const coreAuth = {
  me: (signal?: AbortSignal) => coreFetch<{ user: CoreUser }>("/v1/me", {}, signal).then((r) => r.user),
  login: (email: string, password: string) =>
    coreFetch<{ user: CoreUser }>("/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.user),
  logout: () => coreFetch<void>("/v1/auth/logout", { method: "POST" }),
};

// ---- Fund scores (GET /v1/fund-scores, /v1/fund-scores/{category}) ----

export type FundScoreStatus = "shortlist" | "below_cutoff" | "filtered_out" | "incomplete";

export interface FundScoreRun {
  id: number;
  as_of: string;
  config_sha: string;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface FundCategoryCount {
  key: string;
  name: string;
  funds: number;
  by_status: Partial<Record<FundScoreStatus, number>>;
}

export interface FundScoreOverview {
  run: FundScoreRun;
  categories: FundCategoryCount[];
}

export interface FundMetricDef {
  id: string;
  metric: string;
  weight: number;
  period?: string;
  months?: number;
  min_points?: number;
  years?: number;
  fallback_years?: number;
}

export interface FundFilterResult {
  name: "track_record" | "aum" | "manager_change";
  ok: boolean;
  detail: string;
}

export interface FundScore {
  scheme_code: string;
  name: string;
  amc: string;
  category: string;
  status: FundScoreStatus;
  composite: number | null;
  rank: number | null;
  ranked_of: number | null;
  metrics: Record<string, number>;
  percentiles: Record<string, number>;
  filters: FundFilterResult[];
  missing: string[];
  fallbacks: Record<string, number>;
  facts: {
    aum_cr: number | null;
    ter_direct: number | null;
    launch_date: string | null;
    returns_as_of: string | null;
    returns: Record<string, number>;
  };
}

export interface FundScoreRanking {
  run: FundScoreRun;
  category: {
    key: string;
    name: string;
    profile: string;
    cutoff: number;
    metrics: FundMetricDef[];
    filters: { min_track_record_years: number; min_aum_cr: number; manager_change_months: number };
  };
  funds: FundScore[];
}

// ---- Search (GET /v1/search) ----

export interface SearchHit {
  kind: "series" | "node" | "parameter" | "note";
  key: string;
  title: string;
  snippet?: string;
}

export const searchApi = {
  search: (q: string, signal?: AbortSignal) =>
    coreFetch<{ data: SearchHit[] }>(`/v1/search?q=${encodeURIComponent(q)}&limit=12`, {}, signal).then((r) => r.data),
};

export const fundScoresApi = {
  overview: (signal?: AbortSignal) => coreFetch<FundScoreOverview>("/v1/fund-scores", {}, signal),
  category: (key: string, signal?: AbortSignal) =>
    coreFetch<FundScoreRanking>(`/v1/fund-scores/${encodeURIComponent(key)}`, {}, signal),
};
