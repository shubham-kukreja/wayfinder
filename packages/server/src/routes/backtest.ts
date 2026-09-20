import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { request } from "undici";
import { runBacktest, type BacktestLegInput, type DateValueSeries } from "@wayfinder/engine";
import { openDb } from "../store/db.js";
import { loadConfig } from "../config.js";
import { amfiNavSeriesId, fetchTrackedNavHistory, parseNavAllLatest } from "../adapters/amfiNav.js";
import { fetchBenchmarkHistoryCached, BENCHMARK_INDICES } from "../adapters/benchmarkIndex.js";
import { insertObservations, latestObservations } from "../store/observations.js";
import { pickDefaultFunds } from "../lib/defaultFunds.js";
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateLegs(legs: unknown): legs is BacktestLeg[] {
  if (!Array.isArray(legs) || legs.length === 0) return false;
  return legs.every(
    (l) =>
      l &&
      typeof l.sleeveId === "string" &&
      typeof l.schemeCode === "string" &&
      typeof l.schemeName === "string" &&
      typeof l.amount === "number" &&
      l.amount > 0 &&
      typeof l.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(l.date)
  );
}

// Resolves NAV history for every distinct scheme in the legs and the
// benchmark's daily index history, then runs the pure engine calculation.
// Both legs of the fetch are cached in observations (per-scheme NAV under
// its existing "amfi_nav:<code>"/AMFI_NAV series — the same one
// store/trackedSchemes.ts's refresh pipeline writes to — and the
// benchmark under "bt_index:<id>"/BACKTEST_INDEX_DAILY, see
// adapters/benchmarkIndex.ts). A backtest is a what-if a user reruns
// interactively with edited legs/dates, so subsequent runs over an
// overlapping range fetch only the missing tail rather than the whole
// range again — the first run for a fresh scheme+range is still a full
// live fetch (AMFI in 30-day chunks, the benchmark day-by-day with bounded
// concurrency), which is the unavoidable cost of genuinely new data.
// Days to fetch/cache before the earliest leg's purchase date. The engine
// looks up each leg's entry price as "the most recent NAV/index value on
// or before the purchase date" (packages/engine/src/backtest.ts's
// valueOnOrBefore) — necessary because a purchase date can land on a
// weekend or holiday with no trading that day. Without this buffer, a
// purchase date that IS itself a non-trading day has nothing earlier in
// the fetched/cached window to fall back to, and the leg is wrongly
// reported as missingHistory even though real history exists just before
// it. 7 days comfortably covers any single weekend or short holiday run.
const LOOKBACK_BUFFER_DAYS = 7;

async function resolveAndRun(db: Database.Database, legs: BacktestLegInput[], benchmarkId: string) {
  const dates = legs.map((l) => l.date);
  const earliest = dates.reduce((min, d) => (d < min ? d : min));
  const from = new Date(earliest);
  from.setDate(from.getDate() - LOOKBACK_BUFFER_DAYS);
  const to = new Date(isoToday());
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const schemeCodes = [...new Set(legs.map((l) => l.schemeCode))];
  const navSeriesByScheme: Record<string, DateValueSeries> = {};

  const missingCodes: string[] = [];
  for (const code of schemeCodes) {
    const seriesId = amfiNavSeriesId(code);
    const cached = latestObservations(db, seriesId, { from: fromIso, to: toIso });
    const series: DateValueSeries = {};
    for (const row of cached) series[row.date] = row.value;
    navSeriesByScheme[code] = series;
    // Cache-miss heuristic: a row count alone is not enough — a cache built
    // from an earlier, SHORTER-range backtest (e.g. one whose earliest leg
    // was a year ago) can hold hundreds of rows that are all still inside a
    // later, WIDER range's [from, to] window (a superset), while covering
    // none of that wider range's earlier years at all. That previously
    // passed the "fewer than 5 points" check and silently returned an
    // entry-price lookup with nothing before the fund's true purchase date
    // — reported as missingHistory even though AMFI has real history there,
    // it was just never fetched. So this now also requires the earliest
    // cached row to be within 10 days of the requested `from` (AMFI's own
    // 7-day lookback buffer above plus a few days of slack for the first
    // trading day after a fund's inception) — not just "some point on or
    // after `from` exists somewhere in range".
    const spanDays = (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
    const earliestCachedDate = cached[0]?.date;
    const coversStart = earliestCachedDate !== undefined && new Date(earliestCachedDate).getTime() - from.getTime() <= 10 * 24 * 3600 * 1000;
    if (cached.length < Math.min(5, spanDays) || !coversStart) missingCodes.push(code);
  }

  // NAV (AMFI, 30-day chunks) and the benchmark (niftyindices, day-by-day)
  // are independent, unrelated data sources — kick both off together
  // rather than awaiting one before starting the other. For a multi-year
  // cold range this roughly halves wall time, since neither fetch waits
  // on the other's requests.
  const navPromise = missingCodes.length > 0 ? fetchTrackedNavHistory(new Set(missingCodes), from, to) : Promise.resolve([]);
  const benchmarkPromise = fetchBenchmarkHistoryCached(db, benchmarkId, from, to);
  const [navFetch, benchmarkSeries] = await Promise.all([navPromise, benchmarkPromise]);

  if (missingCodes.length > 0) {
    const now = new Date().toISOString();
    const rows = navFetch.map((obs) => {
      const code = obs.raw && typeof obs.raw === "object" && "schemeCode" in obs.raw ? (obs.raw as { schemeCode: string }).schemeCode : null;
      return { seriesId: amfiNavSeriesId(code ?? ""), date: obs.date, value: obs.value, basis: null, source: "AMFI_NAV", fetchedAt: now };
    });
    insertObservations(db, rows);
    for (const row of rows) {
      const code = row.seriesId.slice("amfi_nav:".length);
      navSeriesByScheme[code] ??= {};
      navSeriesByScheme[code]![row.date] = row.value;
    }
  }

  return runBacktest(legs, navSeriesByScheme, benchmarkSeries, isoToday());
}

const NAV_LATEST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

export function registerBacktestRoute(app: FastifyInstance): void {
  app.get("/api/backtest/benchmarks", async () => {
    return { benchmarks: Object.keys(BENCHMARK_INDICES) };
  });

  // GET /api/backtest/default-funds — one default fund per sleeve, so the
  // form isn't a wall of blank pickers on first load. Same "no per-scheme
  // category on any free AMFI endpoint, so match by name" approach
  // lib/defaultFunds.ts documents; reuses the exact NAV file
  // /api/schemes/search already pulls, so results share that route's
  // ~2s-per-call cost and freshness, not a separate stale mirror.
  app.get("/api/backtest/default-funds", async (_req, reply) => {
    const res = await request(NAV_LATEST_URL, { method: "GET" });
    if (res.statusCode !== 200) {
      reply.code(502);
      return { error: `AMFI NAV file fetch failed (${res.statusCode}).` };
    }
    const text = await res.body.text();
    const rows = parseNavAllLatest(text);
    return { defaults: pickDefaultFunds(rows) };
  });

  app.post<{ Body: RunBody }>("/api/backtest/run", async (req, reply) => {
    const { legs, benchmarkId } = req.body ?? {};
    if (!validateLegs(legs)) {
      reply.code(400);
      return { error: "legs must be a non-empty array of {sleeveId, schemeCode, schemeName, amount, date}." };
    }
    if (!benchmarkId || !BENCHMARK_INDICES[benchmarkId]) {
      reply.code(400);
      return { error: `benchmarkId must be one of: ${Object.keys(BENCHMARK_INDICES).join(", ")}` };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const result = await resolveAndRun(db, legs, benchmarkId);
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
      if (!label || !validateLegs(legs) || !benchmarkId || !BENCHMARK_INDICES[benchmarkId]) {
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
