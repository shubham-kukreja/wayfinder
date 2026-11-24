import { coreFetch } from "./coreApi.js";

// The Data Points screen reads core-jobs-service: GET /v1/registry for the
// rows, POST /v1/sources/{key}/refresh to fetch. The row type below is the
// one the screen was built on; this module maps core's registry onto it.

export type DataPointFreshness = "current" | "stale" | "failed" | "missing" | "overridden";
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
  // True when the value shown is a placeholder (the registry's mock flag),
  // not a real reading. mockReason says why.
  mock: boolean;
  mockReason: string | null;
  // A rubric cell still serving its default: nobody has answered it yet.
  awaitingInput: boolean;
  // Core's latest value of each upstream input, keyed like upstreamSeries.
  upstreamValues?: Record<string, UpstreamValue>;
}

export interface UpstreamValue {
  value: number | boolean | string | null;
  observedAt: string | null;
  freshness: "fresh" | "stale" | "missing";
}

export interface DataPointsResponse {
  rows: DataPointRow[];
  summary: Record<string, number>;
}

// ---- /v1 wire format ----

type Freshness = "fresh" | "stale" | "missing";

interface RegistryUpstream {
  key: string;
  name: string;
  value: number | boolean | string | null;
  freshness: Freshness;
  observed_at: string | null;
}

interface RegistryRow {
  key: string;
  name: string;
  layer: string;
  group: "equity" | "debt" | "metals" | "governance" | "veto";
  node?: string;
  signal?: string;
  update_type: string;
  owner?: string;
  frequency?: string;
  flags: string[];
  source: string | null;
  value: number | boolean | string | null;
  freshness: Freshness;
  observed_at: string | null;
  known_at: string | null;
  overridden: boolean;
  upstream: RegistryUpstream[];
}

interface CoreSource {
  key: string;
  name: string;
  kind: string;
  active: boolean;
  connector_available: boolean;
}

// Core renamed four signals; the model snapshot and note mentions still use
// the earlier ids, so rows carry those as their id until they move to /v1.
const LEGACY_SIGNAL: Record<string, string> = {
  eps_growth_diff: "growth_diff",
  credit_spread: "spread_cushion",
  ratio: "ratio_position",
  cycle: "cycle_position",
};

export function legacyId(key: string): string {
  const [node, signal] = key.split("::");
  if (!signal) return key;
  return `${node}::${LEGACY_SIGNAL[signal] ?? signal}`;
}

const UPDATE_TYPE: Record<string, DataPointUpdateType> = {
  derived: "derived",
  rubric: "opt_in",
  analyst: "manual",
  constant: "constant",
  governance: "governance",
  veto: "veto",
  raw: "raw_series",
};

const SOURCE_LABEL: Record<string, string> = { computed: "Model pipeline", override: "Override", analyst: "Analyst" };

function freshnessOf(r: RegistryRow): DataPointFreshness {
  if (r.overridden) return "overridden";
  return r.freshness === "fresh" ? "current" : r.freshness;
}

function daysSince(date: string | null): number | null {
  if (!date) return null;
  const ms = Date.now() - new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : null;
}

// "Large Cap - Valuation" → ["Large Cap", "Valuation"].
function splitName(name: string): [string, string] {
  const i = name.lastIndexOf(" - ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, name];
}

function describe(r: RegistryRow, type: DataPointUpdateType): { description: string; dependency: string } {
  const [node, signal] = splitName(r.name);
  switch (type) {
    case "governance":
      return { description: "Model parameter from the active model config.", dependency: "Model config" };
    case "veto":
      return { description: "Risk gate that can block overweights but never force underweights.", dependency: `Can clamp ${r.node ?? r.key} overweight` };
    case "constant":
      return {
        description: `${signal} for ${node} — a structural property of the instrument class, not a market view. Reviewed annually.`,
        dependency: `${node} -> ${signal}`,
      };
    case "opt_in":
      return { description: `${signal} for ${node}, answered by the investment team through its rubric.`, dependency: `${node} -> ${signal}` };
    case "manual":
      return r.layer === "trigger"
        ? { description: "Analyst-entered trigger read by the veto rules.", dependency: "Veto rules" }
        : { description: `${signal} for ${node}, entered by an analyst.`, dependency: `${node} -> ${signal}` };
    default:
      return r.layer === "trigger"
        ? { description: "Computed trigger read by the veto rules.", dependency: "Veto rules" }
        : { description: `${signal} score feeding ${node}.`, dependency: `${node} -> ${signal}` };
  }
}

function toRow(r: RegistryRow, sourceNames: Map<string, string>): DataPointRow {
  const updateType = UPDATE_TYPE[r.update_type] ?? "derived";
  const mock = r.flags.includes("mock");
  const isScore = r.layer === "score";
  const modelGroup = r.group === "veto" ? "vetoes" : r.node?.startsWith("sector.") ? "sector" : r.group;
  const sourceLabel = r.source ? (SOURCE_LABEL[r.source] ?? sourceNames.get(r.source) ?? r.source) : updateType === "governance" ? "Model config" : "—";
  return {
    id: legacyId(r.key),
    label: r.name,
    technicalKey: r.key,
    modelGroup,
    updateType,
    source: r.group === "governance" && r.source ? r.source : sourceLabel,
    frequency: r.frequency === "event" ? "event_driven" : (r.frequency ?? "static"),
    owner: r.owner ?? "",
    ...describe(r, updateType),
    currentValue: r.value,
    unit: isScore ? "score" : typeof r.value === "boolean" ? "boolean" : r.group === "governance" ? "parameter" : "",
    score: isScore && typeof r.value === "number" ? r.value : null,
    freshness: freshnessOf(r),
    lastUpdated: r.known_at,
    observedAt: r.observed_at,
    fetchedAt: r.known_at,
    state: r.overridden ? "draft_override" : "published",
    provenance: r.source,
    confidence: null,
    upstreamSeries: r.upstream.map((u) => u.key),
    sourceStatuses: r.upstream.map((u) => ({
      id: u.key,
      status: u.freshness === "fresh" ? "ok" : u.freshness,
      latestDate: u.observed_at,
      staleDays: daysSince(u.observed_at),
    })),
    upstreamValues: Object.fromEntries(r.upstream.map((u) => [u.key, { value: u.value, observedAt: u.observed_at, freshness: u.freshness }])),
    mock,
    mockReason: mock ? "Placeholder value: flagged mock in the registry." : null,
    awaitingInput: updateType === "opt_in" && r.flags.includes("default"),
  };
}

function summarise(rows: DataPointRow[]): Record<string, number> {
  const acc: Record<string, number> = { total: 0 };
  for (const row of rows) {
    acc.total = (acc.total ?? 0) + 1;
    acc[row.freshness] = (acc[row.freshness] ?? 0) + 1;
    acc[row.updateType] = (acc[row.updateType] ?? 0) + 1;
    if (row.mock) acc.mock = (acc.mock ?? 0) + 1;
    else acc.live = (acc.live ?? 0) + 1;
    if (row.awaitingInput) acc.awaitingInput = (acc.awaitingInput ?? 0) + 1;
  }
  return acc;
}

async function listSources(): Promise<CoreSource[]> {
  return (await coreFetch<{ data: CoreSource[] }>("/v1/sources")).data;
}

export async function listDataPoints(): Promise<DataPointsResponse> {
  const [registry, sources] = await Promise.all([
    coreFetch<{ rows: RegistryRow[] }>("/v1/registry"),
    listSources().catch(() => [] as CoreSource[]),
  ]);
  const names = new Map(sources.map((s) => [s.key, s.name]));
  const rows = registry.rows.map((r) => toRow(r, names));
  return { rows, summary: summarise(rows) };
}

/** Sources that can be fetched on demand (those with a connector). */
export async function listRefreshSources(): Promise<Array<{ id: string; label: string }>> {
  return (await listSources())
    .filter((s) => s.active && s.kind === "external_api" && s.connector_available)
    .map((s) => ({ id: s.key, label: s.name }));
}

interface JobRun {
  id: string;
  status: string;
  error?: { message?: string } | string | null;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "skipped"]);

async function waitForJobs(ids: string[], timeoutMs: number): Promise<JobRun[]> {
  const deadline = Date.now() + timeoutMs;
  let runs: JobRun[] = [];
  while (Date.now() < deadline) {
    runs = await Promise.all(ids.map((id) => coreFetch<{ job_run: JobRun }>(`/v1/jobs/${encodeURIComponent(id)}`).then((r) => r.job_run)));
    if (runs.every((r) => TERMINAL.has(r.status))) return runs;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return runs;
}

/**
 * Queues a fetch for one source ("all": every source with a connector),
 * waits up to two minutes for the jobs, and reports what happened.
 */
export async function refreshDataPoints(source: string): Promise<string> {
  const keys = source === "all" ? (await listRefreshSources()).map((s) => s.id) : [source];
  const queued = await Promise.all(
    keys.map((key) =>
      coreFetch<{ job_run: JobRun }>(`/v1/sources/${encodeURIComponent(key)}/refresh`, { method: "POST" }).then((r) => r.job_run.id),
    ),
  );
  const runs = await waitForJobs(queued, 120_000);
  const done = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const pending = runs.filter((r) => !TERMINAL.has(r.status)).length;
  const parts = [`${done} of ${keys.length} source${keys.length === 1 ? "" : "s"} fetched`];
  if (failed) parts.push(`${failed} failed (see Jobs)`);
  if (pending) parts.push(`${pending} still running; values update when they finish`);
  return `${parts.join(", ")}. Scores recompute from the new observations.`;
}
