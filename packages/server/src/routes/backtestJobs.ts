import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { loadConfig } from "../config.js";
import { isValidBenchmark, estimateEtaSeconds, validateLegs } from "../lib/backtestRunner.js";
import { BENCHMARK_INDICES } from "../adapters/benchmarkIndex.js";
import {
  cancelBacktestJob,
  clearBacktestJobs,
  countActiveBacktestJobs,
  enqueueBacktestJob,
  getBacktestJob,
  listBacktestJobs,
} from "../store/backtestJobs.js";
import type { BacktestLeg } from "../store/backtestScenarios.js";

// At most 3 jobs occupying a slot (queued + running combined) at once —
// the UI's own stated cap. Enforced server-side, not just by disabling
// the "Queue backtest" button client-side, since the API is the actual
// boundary that matters (a second tab, a stale page, or a direct curl
// could otherwise bypass a client-only check).
const MAX_ACTIVE_JOBS = 3;

interface EnqueueBody {
  label?: string;
  legs?: BacktestLeg[];
  benchmarkId?: string;
}

export function registerBacktestJobsRoute(app: FastifyInstance): void {
  app.get("/api/backtest/jobs", async () => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      return { jobs: listBacktestJobs(db) };
    } finally {
      db.close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/backtest/jobs/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const job = getBacktestJob(db, req.params.id);
      if (!job) {
        reply.code(404);
        return { error: "Job not found." };
      }
      return job;
    } finally {
      db.close();
    }
  });

  app.post<{ Body: EnqueueBody }>("/api/backtest/jobs", async (req, reply) => {
    const { label, legs, benchmarkId } = req.body ?? {};
    if (!label || !label.trim()) {
      reply.code(400);
      return { error: "label is required." };
    }
    if (!validateLegs(legs)) {
      reply.code(400);
      return { error: "legs must be a non-empty array of {sleeveId, schemeCode, schemeName, amount, date}." };
    }
    if (!isValidBenchmark(benchmarkId)) {
      reply.code(400);
      return { error: `benchmarkId must be one of: ${Object.keys(BENCHMARK_INDICES).join(", ")}` };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const active = countActiveBacktestJobs(db);
      if (active >= MAX_ACTIVE_JOBS) {
        reply.code(429);
        return { error: `Only ${MAX_ACTIVE_JOBS} backtests can be queued or running at once. Wait for one to finish, or cancel a queued run.` };
      }

      const etaSeconds = estimateEtaSeconds(db, legs, benchmarkId);
      const job = enqueueBacktestJob(db, { label: label.trim(), legs, benchmarkId, etaSeconds });
      return job;
    } finally {
      db.close();
    }
  });

  // Clears the whole run history, queued/running included — a deliberate
  // "start over" action, not scoped to the single-queued-job safety
  // cancelBacktestJob enforces below. A job the worker still has in flight
  // simply finds its row gone when it tries to write the result; see
  // completeBacktestJob/failBacktestJob, which no-op on a missing id rather
  // than throwing.
  app.delete("/api/backtest/jobs", async () => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const cleared = clearBacktestJobs(db);
      return { ok: true, cleared };
    } finally {
      db.close();
    }
  });

  app.delete<{ Params: { id: string } }>("/api/backtest/jobs/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const cancelled = cancelBacktestJob(db, req.params.id);
      if (!cancelled) {
        reply.code(409);
        return { error: "Job is not queued (already running, finished, or does not exist) — only a queued job can be cancelled." };
      }
      return { ok: true };
    } finally {
      db.close();
    }
  });
}
