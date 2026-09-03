import type Database from "better-sqlite3";
import type { FetchLogEntry, Warning } from "@wayfinder/engine";
import type { SourceAdapter } from "../adapters/types.js";
import { insertObservations } from "../store/observations.js";
import { insertFetchLog } from "../store/fetchLog.js";

const SOURCE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export interface RefreshOutcome {
  fetchLog: FetchLogEntry[];
  warnings: Warning[];
}

// §11.5 — POST /api/refresh contract:
//   1. Fan out to all adapters IN PARALLEL, each with its own timeout and
//      failure boundary.
//   2. Never fail globally — one dead source yields a warning and a stale
//      SeriesState; the other sources still update.
//   3. Append observations; never touch manual scores or vetoes.
// Step 4-5 (recompute derived series -> percentiles -> auto scores ->
// computeAllocation) is NOT done here — the full 85-score derivation
// pipeline (§7's per-cell auto/rubric transforms) doesn't exist yet
// beyond the one real-rates path in pipeline/derive.ts. This function's
// job ends at "observations are fetched and stored, honestly reported
// per source" — the route layer is explicit that the returned Snapshot's
// scores/allocation still come from the mock baseline until that
// pipeline is built.
export async function runRefresh(
  db: Database.Database,
  adapters: SourceAdapter[],
  timeoutMs: number = SOURCE_TIMEOUT_MS
): Promise<RefreshOutcome> {
  const fetchLog: FetchLogEntry[] = [];
  const warnings: Warning[] = [];

  const results = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const startedAt = new Date().toISOString();
      try {
        const observations = await withTimeout(adapter.fetchLatest(), timeoutMs, adapter.id);
        const fetchedAt = new Date().toISOString();
        const written = insertObservations(
          db,
          observations.map((o) => ({
            seriesId: o.seriesId,
            date: o.date,
            value: o.value,
            basis: o.basis ?? null,
            source: adapter.id,
            fetchedAt,
          }))
        );
        const entry: FetchLogEntry = { source: adapter.id, startedAt, finishedAt: fetchedAt, status: "ok", error: null, rowsWritten: written };
        insertFetchLog(db, entry);
        fetchLog.push(entry);
      } catch (err) {
        const finishedAt = new Date().toISOString();
        const message = err instanceof Error ? err.message : String(err);
        const entry: FetchLogEntry = { source: adapter.id, startedAt, finishedAt, status: "failed", error: message, rowsWritten: 0 };
        insertFetchLog(db, entry);
        fetchLog.push(entry);
        warnings.push({
          severity: "error",
          code: "source_failed",
          message: `${adapter.id} fetch failed: ${message}`,
          affects: adapter.series,
        });
      }
    })
  );

  // Promise.allSettled never rejects itself, but guard anyway — a thrown
  // error here would violate §9 ("a failed fetch is a warning, never an
  // exception"), so surface anything unexpected as a warning instead of
  // letting it propagate out of runRefresh.
  for (const r of results) {
    if (r.status === "rejected") {
      warnings.push({ severity: "error", code: "refresh_internal_error", message: String(r.reason), affects: [] });
    }
  }

  return { fetchLog, warnings };
}
