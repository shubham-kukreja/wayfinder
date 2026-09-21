import { openDb } from "../store/db.js";
import { claimNextQueuedJob, completeBacktestJob, failBacktestJob, resetOrphanedRunningJobs } from "../store/backtestJobs.js";
import { resolveAndRunBacktest } from "../lib/backtestRunner.js";

// A single sequential in-process worker for backtest_jobs — never more
// than one job 'running' at a time, by construction: the poll loop only
// claims a NEW job once the previous run's await has resolved, so
// there's no concurrency to coordinate. This is what "always run
// sequentially, only one runs, others show queued" (the UI requirement)
// actually rests on — not a lock, just a loop that never overlaps itself.
//
// Runs in the same process as the Fastify server (started once from
// index.ts), sharing its long-lived WAL-mode DB connection the same way
// every other route already opens its own per-request connection — WAL
// mode is what makes a long-lived writer connection safe alongside those
// short-lived ones.
const POLL_INTERVAL_MS = 2000;

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(dbPath: string): Promise<void> {
  if (running) return; // a run is still in flight; the loop below already awaits it, but this guards against a slow tick overlapping a fast one under load
  const db = openDb(dbPath);
  try {
    const job = claimNextQueuedJob(db);
    if (!job) return;
    running = true;
    try {
      const result = await resolveAndRunBacktest(db, job.legs, job.benchmarkId);
      completeBacktestJob(db, job.id, result);
    } catch (err) {
      failBacktestJob(db, job.id, err instanceof Error ? err.message : String(err));
    }
  } finally {
    running = false;
    db.close();
  }
}

export function startBacktestQueueWorker(dbPath: string): void {
  if (timer) return; // already started — startBacktestQueueWorker is safe to call more than once
  const db = openDb(dbPath);
  resetOrphanedRunningJobs(db);
  db.close();

  timer = setInterval(() => {
    tick(dbPath).catch((err) => {
      // A tick-level failure (e.g. openDb itself throwing) shouldn't kill
      // the interval — the next tick gets another chance, same "a failed
      // fetch is a warning, never an exception" resilience posture the
      // rest of the pipeline uses.
      console.error("backtest queue worker tick failed:", err);
    });
  }, POLL_INTERVAL_MS);
}

export function stopBacktestQueueWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
