import type { FastifyInstance } from "fastify";
import type { ScoreState, SeriesState, VetoState } from "@wayfinder/engine";
import { DATA_POINT_REGISTRY, type DataPointRegistryEntry } from "../dataPointRegistry.js";
import { loadConfig } from "../config.js";
import { openDb } from "../store/db.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";

type FreshnessState = "current" | "due" | "stale" | "failed" | "missing" | "overridden";
type RowState = "published" | "draft_override" | "validation_error";

interface DataPointRow extends DataPointRegistryEntry {
  currentValue: number | boolean | string | null;
  unit: string;
  score: number | null;
  freshness: FreshnessState;
  lastUpdated: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  state: RowState;
  provenance: string | null;
  confidence: string | null;
  upstreamSeries: string[];
  sourceStatuses: Array<{ id: string; status: SeriesState["status"]; latestDate: string | null; staleDays: number | null }>;
}

function scoreFreshness(score: ScoreState | undefined, sourceStates: SeriesState[]): FreshnessState {
  if (!score) return "missing";
  if (score.provenance === "manual") return "overridden";
  if (sourceStates.some((s) => s.status === "failed")) return "failed";
  if (sourceStates.some((s) => s.status === "insufficient_history")) return "missing";
  if (score.staleDays !== null && score.staleDays > 45) return "stale";
  if (score.staleDays !== null && score.staleDays > 7) return "due";
  if (score.provenance === "default") return "missing";
  return "current";
}

function latestSeriesDate(states: SeriesState[]): string | null {
  const dates = states.map((s) => s.latestDate).filter((date): date is string => !!date).sort();
  return dates[dates.length - 1] ?? null;
}

function rowFromScore(entry: DataPointRegistryEntry, score: ScoreState | undefined, seriesById: Record<string, SeriesState>): DataPointRow {
  const upstreamSeries = score?.derivedFrom ?? [];
  const sourceStates = upstreamSeries.map((id) => seriesById[id]).filter((s): s is SeriesState => !!s);
  const freshness = scoreFreshness(score, sourceStates);
  return {
    ...entry,
    currentValue: score?.value ?? null,
    unit: "score",
    score: score?.value ?? null,
    freshness,
    lastUpdated: score?.enteredAt ?? score?.computedAt ?? latestSeriesDate(sourceStates),
    observedAt: latestSeriesDate(sourceStates),
    fetchedAt: null,
    state: score?.provenance === "manual" ? "draft_override" : "published",
    provenance: score?.provenance ?? null,
    confidence: score?.confidence ?? null,
    upstreamSeries,
    sourceStatuses: sourceStates.map((s) => ({ id: s.id, status: s.status, latestDate: s.latestDate, staleDays: s.staleDays })),
  };
}

function rowFromGovernance(entry: DataPointRegistryEntry): DataPointRow {
  return {
    ...entry,
    currentValue: "Configured",
    unit: "parameter",
    score: null,
    freshness: "current",
    lastUpdated: null,
    observedAt: null,
    fetchedAt: null,
    state: "published",
    provenance: "static",
    confidence: null,
    upstreamSeries: [],
    sourceStatuses: [],
  };
}

function rowFromVeto(entry: DataPointRegistryEntry, veto: VetoState | undefined): DataPointRow {
  return {
    ...entry,
    currentValue: veto?.active ?? false,
    unit: "boolean",
    score: null,
    freshness: veto?.provenance === "manual" && veto.active ? "overridden" : "current",
    lastUpdated: null,
    observedAt: null,
    fetchedAt: null,
    state: veto?.provenance === "manual" ? "draft_override" : "published",
    provenance: veto?.provenance ?? "auto",
    confidence: null,
    upstreamSeries: veto?.triggeredBy ?? [],
    sourceStatuses: [],
  };
}

function rowFromSeries(entry: DataPointRegistryEntry, seriesState: SeriesState | undefined): DataPointRow {
  // hasLiveSource === false means no adapter exists for this series at
  // all — any snapshot.series entry for it is leftover mock-baseline
  // placeholder data (see packages/engine/scripts/gen-fixtures.ts),
  // never a real reading. Report it as "missing" unconditionally rather
  // than let the baseline's fake "ok" status read as current/trustworthy.
  if (entry.hasLiveSource === false) {
    return {
      ...entry,
      currentValue: null,
      unit: "%",
      score: null,
      freshness: "missing",
      lastUpdated: null,
      observedAt: null,
      fetchedAt: null,
      state: "published",
      provenance: null,
      confidence: null,
      upstreamSeries: [],
      sourceStatuses: [],
    };
  }
  // No SeriesState key at all is itself the "missing" signal for a series
  // with zero real observations and no score consumer (buildSeriesState()
  // only ever runs off a score cell's derivedFrom backfill). The
  // status==="failed"/"insufficient_history" branches below are for
  // forward-compatibility only, mirroring scoreFreshness()'s semantics,
  // in case this function is later reused for a series that does get
  // derivedFrom-backfilled.
  const freshness: FreshnessState = !seriesState
    ? "missing"
    : seriesState.status === "failed"
      ? "failed"
      : seriesState.status === "insufficient_history"
        ? "missing"
        : seriesState.staleDays !== null && seriesState.staleDays > 45
          ? "stale"
          : seriesState.staleDays !== null && seriesState.staleDays > 7
            ? "due"
            : "current";
  return {
    ...entry,
    currentValue: seriesState?.latest ?? null,
    unit: "%",
    score: null,
    freshness,
    lastUpdated: seriesState?.latestDate ?? null,
    observedAt: seriesState?.latestDate ?? null,
    fetchedAt: null,
    state: "published",
    provenance: seriesState ? "auto" : null,
    confidence: null,
    upstreamSeries: [],
    sourceStatuses: seriesState
      ? [{ id: seriesState.id, status: seriesState.status, latestDate: seriesState.latestDate, staleDays: seriesState.staleDays }]
      : [],
  };
}

function buildRows(): { rows: DataPointRow[]; summary: Record<string, number> } {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const { snapshot } = buildCurrentSnapshot(db);
    const rows = DATA_POINT_REGISTRY.map((entry) => {
      if (entry.updateType === "governance") return rowFromGovernance(entry);
      if (entry.updateType === "veto") return rowFromVeto(entry, snapshot.vetoes[entry.technicalKey as keyof typeof snapshot.vetoes]);
      if (entry.updateType === "raw_series") return rowFromSeries(entry, snapshot.series[entry.technicalKey]);
      return rowFromScore(entry, snapshot.scores[entry.id], snapshot.series);
    });
    const summary = rows.reduce<Record<string, number>>(
      (acc, row) => {
        acc.total = (acc.total ?? 0) + 1;
        acc[row.freshness] = (acc[row.freshness] ?? 0) + 1;
        acc[row.updateType] = (acc[row.updateType] ?? 0) + 1;
        return acc;
      },
      { total: 0 }
    );
    return { rows, summary };
  } finally {
    db.close();
  }
}

export function registerDatapointsRoute(app: FastifyInstance): void {
  app.get("/api/datapoints", async (_req, reply) => {
    try {
      return buildRows();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
