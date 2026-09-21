import type { FastifyInstance } from "fastify";
import { request } from "undici";
import { openDb } from "../store/db.js";
import { loadConfig } from "../config.js";
import { fetchSchemeCodesExistingOn, parseNavAllLatest } from "../adapters/amfiNav.js";
import { BENCHMARK_INDICES } from "../adapters/benchmarkIndex.js";
import { pickDefaultFunds } from "../lib/defaultFunds.js";
import { isValidBenchmark, resolveAndRunBacktest, validateLegs } from "../lib/backtestRunner.js";
import { latestObservations } from "../store/observations.js";
import {
  deleteBacktestScenario,
  getBacktestScenario,
  listBacktestScenarios,
  saveBacktestScenario,
  type BacktestLeg,
} from "../store/backtestScenarios.js";

interface RunBody {
  legs?: BacktestLeg[];
  benchmarkId?: string;
}

const NAV_LATEST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export function registerBacktestRoute(app: FastifyInstance): void {
  app.get("/api/backtest/benchmarks", async () => {
    return { benchmarks: Object.keys(BENCHMARK_INDICES) };
  });

  // GET /api/backtest/inflation — latest India CPI YoY print, used by a
  // report's "real return" estimate (nominal CAGR/XIRR minus this rate).
  // A single flat rate rather than a full CPI time series deflating each
  // leg's own window — simpler, and the report already states it's an
  // estimate rather than a precise inflation-adjusted calculation.
  app.get("/api/backtest/inflation", async (_req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const rows = latestObservations(db, "cpi_yoy");
      const latest = rows[rows.length - 1];
      if (!latest) {
        reply.code(404);
        return { error: "No cpi_yoy observation available." };
      }
      return { ratePct: latest.value, asOf: latest.date };
    } finally {
      db.close();
    }
  });

  // GET /api/backtest/default-funds — one default fund per sleeve, so the
  // form isn't a wall of blank pickers on first load. Same "no per-scheme
  // category on any free AMFI endpoint, so match by name" approach
  // lib/defaultFunds.ts documents; reuses the exact NAV file
  // /api/schemes/search already pulls, so results share that route's
  // ~2s-per-call cost and freshness, not a separate stale mirror.
  //
  // Also fetches which scheme codes existed 8 years back (a short 5-day
  // window, cheap) so pickDefaultFunds can prefer an established fund over
  // a recently-launched one within the same sleeve — 8 years comfortably
  // covers this app's 5-year default backtest window with margin. Both
  // fetches are independent AMFI calls, run concurrently.
  app.get("/api/backtest/default-funds", async (_req, reply) => {
    const eightYearsAgo = new Date();
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);

    const [latestRes, establishedCodes] = await Promise.all([
      request(NAV_LATEST_URL, { method: "GET" }),
      fetchSchemeCodesExistingOn(eightYearsAgo).catch(() => new Set<string>()), // a failed "established" check just falls back to NAV-only ranking, not a hard error
    ]);
    if (latestRes.statusCode !== 200) {
      reply.code(502);
      return { error: `AMFI NAV file fetch failed (${latestRes.statusCode}).` };
    }
    const text = await latestRes.body.text();
    const rows = parseNavAllLatest(text);
    return { defaults: pickDefaultFunds(rows, establishedCodes) };
  });

  app.post<{ Body: RunBody }>("/api/backtest/run", async (req, reply) => {
    const { legs, benchmarkId } = req.body ?? {};
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
      const result = await resolveAndRunBacktest(db, legs, benchmarkId);
      return result;
    } catch (err) {
      reply.code(502);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  app.get("/api/backtest/scenarios", async () => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      return { scenarios: listBacktestScenarios(db) };
    } finally {
      db.close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/backtest/scenarios/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const scenario = getBacktestScenario(db, req.params.id);
      if (!scenario) {
        reply.code(404);
        return { error: "Scenario not found." };
      }
      return scenario;
    } finally {
      db.close();
    }
  });

  app.post<{ Body: { id?: string; label?: string; legs?: BacktestLeg[]; benchmarkId?: string } }>(
    "/api/backtest/scenarios",
    async (req, reply) => {
      const { id, label, legs, benchmarkId } = req.body ?? {};
      if (!label || !validateLegs(legs) || !isValidBenchmark(benchmarkId)) {
        reply.code(400);
        return { error: "label, legs, and a valid benchmarkId are required." };
      }
      const config = loadConfig();
      const db = openDb(config.dbPath);
      try {
        const scenario = saveBacktestScenario(db, { id, label, legs, benchmarkId });
        return scenario;
      } finally {
        db.close();
      }
    }
  );

  app.delete<{ Params: { id: string } }>("/api/backtest/scenarios/:id", async (req) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      deleteBacktestScenario(db, req.params.id);
      return { ok: true };
    } finally {
      db.close();
    }
  });
}
