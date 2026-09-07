import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeAllocation, snapshotSchema, type Snapshot } from "@wayfinder/engine";
import { computeAutoScoreCells } from "./scoreCells.js";

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
export function buildCurrentSnapshot(db: Database.Database, asOf: string = new Date().toISOString()): CurrentSnapshotResult {
  const raw = JSON.parse(readFileSync(MOCK_SNAPSHOT_PATH, "utf-8"));
  raw.asOf = asOf;

  const asOfDate = asOf.slice(0, 10);
  const recomputed = computeAutoScoreCells(db, raw.params, asOfDate);
  const recomputedIds: string[] = [];
  for (const cell of recomputed) {
    if (cell.status !== "ok") continue; // insufficient history: leave the baseline's value, don't overwrite with a fresh 50
    raw.scores[cell.scoreId] = {
      ...raw.scores[cell.scoreId],
      value: cell.value,
      provenance: cell.transform === "rubric" ? "rubric" : "auto",
      transform: cell.transform,
      derivedFrom: cell.derivedFrom,
      computedAt: asOf,
      staleDays: 0,
    };
    recomputedIds.push(cell.scoreId);
  }

  if (recomputedIds.length > 0) {
    const scoreValues = Object.fromEntries(Object.entries(raw.scores).map(([k, v]: [string, any]) => [k, v.value]));
    const vetoValues = Object.fromEntries(Object.entries(raw.vetoes as Record<string, { active: boolean }>).map(([k, v]) => [k, v.active]));
    raw.allocation = computeAllocation(scoreValues, vetoValues, raw.params);
  }

  const result = snapshotSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Current snapshot failed schema validation: ${JSON.stringify(result.error.issues)}`);
  }

  return { snapshot: result.data as Snapshot, recomputedIds };
}
