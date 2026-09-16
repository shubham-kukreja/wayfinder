import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeAllocation, snapshotSchema, type Snapshot } from "@wayfinder/engine";
import { computeAutoScoreCells } from "./scoreCells.js";
import { buildSeriesState } from "./buildSeriesState.js";
import { allManualScores, allManualVetoes } from "../store/manual.js";
import { loadCurrentParams } from "../store/params.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SNAPSHOT_PATH = join(__dirname, "../../../../mock/snapshot.json");

export interface CurrentSnapshotResult {
  snapshot: Snapshot;
  recomputedIds: string[];
}

// The single source of truth for "what is the current snapshot right
// now," used by GET /api/snapshot, POST /api/refresh, and POST
// /api/snapshots alike — previously each route re-implemented this
// (mock baseline + computeAutoScoreCells overlay) independently, which
// meant GET /api/snapshot never reflected anything a prior POST
// /api/refresh had fetched and stored. This function always reads
// whatever is currently in the store, regardless of whether a refresh
// just ran in this same request or an hour ago, so "current state" means
// the same thing everywhere it's asked.
//
// Layering, in order (later steps override earlier ones, per §1
// invariant 5 — provenance is always visible, so every override also
// updates the score/param's recorded provenance, not just its value):
//   1. Mock baseline (scores, vetoes, params) — the starting point until
//      the full 85-cell pipeline and NSE exist.
//   2. computeAutoScoreCells() — auto/rubric cells recomputed from
//      whatever the store's observations table currently holds.
//   3. Saved params (store/params.ts, id "current") — a user's edited
//      weights/caps from POST /api/params, if any have been saved.
//   4. Manual scores/vetoes (store/manual.ts) — a human's deliberate
//      entry always wins over an automated derivation; this is the
//      whole point of "manual" provenance existing as a category.
export function buildCurrentSnapshot(db: Database.Database, asOf: string = new Date().toISOString()): CurrentSnapshotResult {
  const raw = JSON.parse(readFileSync(MOCK_SNAPSHOT_PATH, "utf-8"));
  raw.asOf = asOf;

  const savedParams = loadCurrentParams(db);
  if (savedParams) raw.params = savedParams;

  const asOfDate = asOf.slice(0, 10);
  const recomputed = computeAutoScoreCells(db, raw.params, asOfDate);
  const recomputedIds: string[] = [];
  for (const cell of recomputed) {
    if (cell.status !== "ok") continue; // insufficient history: leave the baseline's value, don't overwrite with a fresh 50
    // staleDays reflects the age of the observation the value was ACTUALLY
    // computed from, not always 0 — a derived series can join sources with
    // different publication lags (e.g. l1.equity::momentum month-joins
    // FRED's gsec_10y, which can trail nifty50_close by months), so
    // hardcoding 0 here would silently overstate freshness. §1 invariant 5:
    // provenance must stay visible, freshness included.
    const staleDays = cell.latestDate ? Math.max(0, Math.round((new Date(asOfDate).getTime() - new Date(cell.latestDate).getTime()) / 86_400_000)) : 0;
    raw.scores[cell.scoreId] = {
      ...raw.scores[cell.scoreId],
      value: cell.value,
      provenance: cell.transform === "rubric" ? "rubric" : "auto",
      transform: cell.transform,
      derivedFrom: cell.derivedFrom,
      computedAt: asOf,
      staleDays,
    };
    recomputedIds.push(cell.scoreId);

    // Backfill snapshot.series for any raw series this cell reads that
    // the static mock baseline predates (e.g. nifty50_close,
    // nifty50_div_yield — added by niftyindices.ts after the baseline
    // was authored). Without this, a cell's derivedFrom can point at a
    // series with literally no snapshot.series entry at all, so the UI
    // has no raw value to show even though the DB has real observations
    // for it (see CalculationInspector's derivation trace).
    for (const seriesId of cell.derivedFrom) {
      if (raw.series[seriesId]) continue; // mock baseline already covers this one
      const state = buildSeriesState(db, seriesId, asOfDate, raw.params.percentileMinObservations);
      if (state) raw.series[seriesId] = state;
    }
  }

  const manualScores = allManualScores(db);
  for (const m of manualScores) {
    raw.scores[m.scoreId] = {
      ...raw.scores[m.scoreId],
      value: m.value,
      provenance: "manual",
      transform: "none",
      derivedFrom: [],
      computedAt: null,
      enteredAt: m.enteredAt,
      note: m.note,
      confidence: m.confidence,
      staleDays: 0,
    };
  }

  const manualVetoes = allManualVetoes(db);
  for (const v of manualVetoes) {
    raw.vetoes[v.nodeId] = {
      active: v.active,
      triggeredBy: [],
      provenance: "manual",
      detail: v.detail,
      hadEffect: raw.vetoes[v.nodeId]?.hadEffect ?? true, // recomputed below via computeAllocation's per-node vetoActive
    };
  }

  const scoreValues = Object.fromEntries(Object.entries(raw.scores).map(([k, v]: [string, any]) => [k, v.value]));
  const vetoValues = Object.fromEntries(Object.entries(raw.vetoes as Record<string, { active: boolean }>).map(([k, v]) => [k, v.active]));
  raw.allocation = computeAllocation(scoreValues, vetoValues, raw.params);

  // hadEffect needs the freshly computed allocation to know whether a
  // veto's clamp actually changed anything (§9: "vetoes on already-
  // underweight nodes do nothing — say so rather than flashing red").
  for (const v of manualVetoes) {
    for (const group of Object.values(raw.allocation.groups) as Array<{ nodes: Record<string, { rawTilt: number }> }>) {
      const node = group.nodes[v.nodeId];
      if (node) raw.vetoes[v.nodeId].hadEffect = node.rawTilt > 0;
    }
  }

  const result = snapshotSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Current snapshot failed schema validation: ${JSON.stringify(result.error.issues)}`);
  }

  return { snapshot: result.data as Snapshot, recomputedIds };
}
