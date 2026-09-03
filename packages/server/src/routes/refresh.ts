import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { snapshotSchema, computeAllocation } from "@wayfinder/engine";
import { openDb } from "../store/db.js";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { createRbiAdapter } from "../adapters/rbi.js";
import { runRefresh } from "../pipeline/refresh.js";
import { computeAutoScoreCells } from "../pipeline/scoreCells.js";
import { loadConfig } from "../config.js";
import type { SourceAdapter } from "../adapters/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SNAPSHOT_PATH = join(__dirname, "../../../../mock/snapshot.json");

// §11.5 / §13.1 POST /api/refresh[?sources=fred,bullion,amfi,rbi].
// Default (no query param) fans out to the fast, non-browser adapters
// (FRED, bullion, AMFI) — RBI is opt-in via ?sources=... because it
// spins up a real headless browser per call (multi-second; NSE would be
// too, once built) and shouldn't silently slow down every quick refresh
// click. §13.1 documents this exact pattern ("POST /api/refresh?series=
// a,b,c -> partial refresh"); this uses source names rather than series
// names since that's the granularity a user/scheduler actually chooses
// at (§11.5: "per-source refresh exposed").
export const AVAILABLE_SOURCES = ["fred", "bullion", "amfi", "rbi"] as const;
export type SourceName = (typeof AVAILABLE_SOURCES)[number];

export function parseRequestedSources(sourcesParam: string | undefined): SourceName[] | { error: string } {
  const requested = sourcesParam ? sourcesParam.split(",").map((s) => s.trim().toLowerCase()) : ["fred", "bullion", "amfi"];
  const invalid = requested.filter((s) => !AVAILABLE_SOURCES.includes(s as SourceName));
  if (invalid.length > 0) {
    return { error: `Unknown source(s): ${invalid.join(", ")}. Available: ${AVAILABLE_SOURCES.join(", ")}` };
  }
  return requested as SourceName[];
}

export function buildAdapters(names: SourceName[], config: ReturnType<typeof loadConfig>): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  if (names.includes("fred")) out.push(createFredAdapter({ apiKey: config.fredApiKey, series: FRED_SERIES }));
  if (names.includes("bullion")) out.push(createBullionAdapter({ apiKey: config.metalsDevApiKey, series: BULLION_SERIES }));
  if (names.includes("amfi")) out.push(createAmfiAdapter());
  if (names.includes("rbi")) out.push(createRbiAdapter({ executablePath: config.chromiumExecutablePath }));
  return out;
}

// Honesty gap, stated plainly rather than hidden: only the score cells
// computeAutoScoreCells() actually implements (§7 cells reachable from
// FRED/bullion/AMFI series — see pipeline/scoreCells.ts, currently 9 of
// 85) are recomputed from the newly stored observations. Every other
// cell still comes from the mock baseline unchanged. This is real
// progress over serving a static file (the pipeline that WOULD compute
// the rest doesn't exist yet — NSE and most of RBI aren't wired in), but
// it is not the full 85-cell pipeline; the response's warnings say so
// explicitly rather than presenting every number as freshly computed.
export function registerRefreshRoute(app: FastifyInstance): void {
  app.post<{ Querystring: { sources?: string } }>("/api/refresh", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);

    try {
      const requested = parseRequestedSources(req.query.sources);
      if ("error" in requested) {
        reply.code(400);
        return requested;
      }

      const adapters = buildAdapters(requested, config);
      // RBI's live test (test/rbi.live.test.ts) took ~19s end-to-end
      // (browser launch + page navigation + AG Grid pagination) — give
      // every source in this batch a longer timeout when RBI is among
      // them rather than let it get cut off by the default 15s.
      const timeoutMs = requested.includes("rbi") ? 45000 : undefined;

      const { fetchLog, warnings } = await runRefresh(db, adapters, timeoutMs);

      const raw = JSON.parse(readFileSync(MOCK_SNAPSHOT_PATH, "utf-8"));
      raw.asOf = new Date().toISOString();
      raw.fetchLog = fetchLog;

      const asOfDate = raw.asOf.slice(0, 10);
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
          computedAt: raw.asOf,
          staleDays: 0,
        };
        recomputedIds.push(cell.scoreId);
      }

      if (recomputedIds.length > 0) {
        const scoreValues = Object.fromEntries(Object.entries(raw.scores).map(([k, v]: [string, any]) => [k, v.value]));
        const vetoValues = Object.fromEntries(
          Object.entries(raw.vetoes as Record<string, { active: boolean }>).map(([k, v]) => [k, v.active])
        );
        raw.allocation = computeAllocation(scoreValues, vetoValues, raw.params);
      }

      raw.warnings = [
        ...warnings,
        {
          severity: "info",
          code: "partial_pipeline",
          message: `${recomputedIds.length} of 85 scores were recomputed from this refresh's fetched data (${recomputedIds.join(", ")}); the rest remain the baseline snapshot's values until the full derivation pipeline covers them.`,
          affects: recomputedIds,
        },
      ];

      const result = snapshotSchema.safeParse(raw);
      if (!result.success) {
        reply.code(500);
        return { error: "Snapshot failed schema validation", issues: result.error.issues };
      }
      return result.data;
    } finally {
      db.close();
    }
  });
}
