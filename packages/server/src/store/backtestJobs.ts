import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { BacktestResult, BacktestSummary } from "@wayfinder/engine";
import type { BacktestLeg } from "./backtestScenarios.js";

export type BacktestJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface BacktestJob {
  id: string;
  label: string;
  legs: BacktestLeg[];
  benchmarkId: string;
  status: BacktestJobStatus;
  etaSeconds: number | null;
  result: BacktestResult | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface BacktestJobRow {
  id: string;
  label: string;
  legsJson: string;
  benchmarkId: string;
  status: BacktestJobStatus;
  etaSeconds: number | null;
  resultJson: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function toJob(row: BacktestJobRow): BacktestJob {
  return {
    id: row.id,
    label: row.label,
    legs: JSON.parse(row.legsJson) as BacktestLeg[],
    benchmarkId: row.benchmarkId,
    status: row.status,
    etaSeconds: row.etaSeconds,
    result: row.resultJson ? (JSON.parse(row.resultJson) as BacktestResult) : null,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

const SELECT_COLUMNS = `
  id, label, legs_json as legsJson, benchmark_id as benchmarkId, status,
  eta_seconds as etaSeconds, result_json as resultJson, error,
  created_at as createdAt, started_at as startedAt, finished_at as finishedAt
`;

// Same shape as BacktestJob but with `result` always null — the Runs list
// view never renders a chart or per-fund table, only status/label/timing,
// so it has no use for a completed job's full result (which can hold
// ~1,800 daily points for a 5-year backtest). Confirmed live 2026-09-20:
// listBacktestJobs previously always SELECTed and JSON.parsed every job's
// full result_json, and the Runs page's 3s poll interval compounded that
// into a genuine OOM crash (~4.1GB heap) after repeated polls accumulated
// large parsed result objects faster than they could be GC'd. This list
// path now never selects result_json from SQLite at all, not just omits
// it after parsing — the column never crosses the wire for a list call.
export type BacktestJobSummary = Omit<BacktestJob, "result"> & { summary: BacktestSummary | null };

interface BacktestJobSummaryRow extends Omit<BacktestJobRow, "resultJson"> {
  summaryJson: string | null;
}

// json_extract pulls only the `summary` object out of result_json in
// SQLite itself — a few hundred bytes (invested/current/XIRR/return%) —
// rather than transferring and JSON.parsing the full result (which can
// hold ~1,800 daily series points for a 5-year backtest). This is what
// keeps the list endpoint cheap: see the OOM incident noted on
// BacktestJobSummary above, which this must not reintroduce.
const SUMMARY_SELECT_COLUMNS = `
  id, label, legs_json as legsJson, benchmark_id as benchmarkId, status,
  eta_seconds as etaSeconds, error,
  created_at as createdAt, started_at as startedAt, finished_at as finishedAt,
  json_extract(result_json, '$.summary') as summaryJson
`;

function toJobSummary(row: BacktestJobSummaryRow): BacktestJobSummary {
  return {
    id: row.id,
    label: row.label,
    legs: JSON.parse(row.legsJson) as BacktestLeg[],
    benchmarkId: row.benchmarkId,
    status: row.status,
    etaSeconds: row.etaSeconds,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    summary: row.summaryJson ? (JSON.parse(row.summaryJson) as BacktestSummary) : null,
  };
}

export function listBacktestJobs(db: Database.Database): BacktestJobSummary[] {
  const rows = db.prepare(`SELECT ${SUMMARY_SELECT_COLUMNS} FROM backtest_jobs ORDER BY created_at DESC`).all() as BacktestJobSummaryRow[];
  return rows.map(toJobSummary);
}

export function getBacktestJob(db: Database.Database, id: string): BacktestJob | null {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM backtest_jobs WHERE id = ?`).get(id) as BacktestJobRow | undefined;
  return row ? toJob(row) : null;
}

// Jobs that occupy a queue slot — a running job counts the same as a
// queued one for the "at most 3" cap, since it's still using up one of
// the 3 concurrent-attention slots from the user's point of view.
export function countActiveBacktestJobs(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM backtest_jobs WHERE status IN ('queued', 'running')`).get() as { n: number };
  return row.n;
}

export function enqueueBacktestJob(db: Database.Database, input: { label: string; legs: BacktestLeg[]; benchmarkId: string; etaSeconds: number | null }): BacktestJob {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO backtest_jobs (id, label, legs_json, benchmark_id, status, eta_seconds, created_at)
     VALUES (@id, @label, @legsJson, @benchmarkId, 'queued', @etaSeconds, @createdAt)`
  ).run({ id, label: input.label, legsJson: JSON.stringify(input.legs), benchmarkId: input.benchmarkId, etaSeconds: input.etaSeconds, createdAt: now });
  return getBacktestJob(db, id)!;
}

// Only a job still 'queued' can be cancelled — once the worker has picked
// it up (status 'running'), cancelling mid-fetch would leave observations
// partially written with no clean way to unwind, so that state is reached
// only by letting the run finish or fail on its own.
export function cancelBacktestJob(db: Database.Database, id: string): boolean {
  const result = db.prepare(`UPDATE backtest_jobs SET status = 'cancelled', finished_at = @now WHERE id = @id AND status = 'queued'`).run({
    id,
    now: new Date().toISOString(),
  });
  return result.changes > 0;
}

export function claimNextQueuedJob(db: Database.Database): BacktestJob | null {
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM backtest_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`).get() as
    | BacktestJobRow
    | undefined;
  if (!row) return null;
  db.prepare(`UPDATE backtest_jobs SET status = 'running', started_at = @now WHERE id = @id`).run({ id: row.id, now: new Date().toISOString() });
  return toJob({ ...row, status: "running" });
}

export function completeBacktestJob(db: Database.Database, id: string, result: BacktestResult): void {
  db.prepare(`UPDATE backtest_jobs SET status = 'completed', result_json = @resultJson, finished_at = @now WHERE id = @id`).run({
    id,
    resultJson: JSON.stringify(result),
    now: new Date().toISOString(),
  });
}

export function failBacktestJob(db: Database.Database, id: string, error: string): void {
  db.prepare(`UPDATE backtest_jobs SET status = 'failed', error = @error, finished_at = @now WHERE id = @id`).run({
    id,
    error,
    now: new Date().toISOString(),
  });
}

// Wipes every row, queued/running included — unlike cancelBacktestJob this
// isn't scoped to a single safe-to-interrupt state, so it's for an explicit
// "clear history" action, not something the queue worker or a route calls
// as a side effect of anything else.
export function clearBacktestJobs(db: Database.Database): number {
  const result = db.prepare(`DELETE FROM backtest_jobs`).run();
  return result.changes;
}

// A job stuck in 'running' with no matching in-memory worker (e.g. the
// server restarted mid-run) is unrecoverable — the worker's local state is
// gone, so it can never finish. Called once at startup before the worker
// loop starts, so a restart always starts from a clean slate rather than
// showing a run that will never complete.
export function resetOrphanedRunningJobs(db: Database.Database): void {
  db.prepare(`UPDATE backtest_jobs SET status = 'failed', error = 'Server restarted while this run was in progress.', finished_at = @now WHERE status = 'running'`).run(
    { now: new Date().toISOString() }
  );
}
