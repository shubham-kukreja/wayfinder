import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { createRbiAdapter } from "../adapters/rbi.js";
import { createNseAdapter } from "../adapters/nse.js";
import { runRefresh } from "../pipeline/refresh.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";
import type { SourceAdapter } from "../adapters/types.js";

// §11.5 / §13.1 POST /api/refresh[?sources=fred,bullion,amfi,rbi,nse].
// Default (no query param) fans out to the fast, non-browser adapters
// (FRED, bullion, AMFI, NSE — all plain HTTP requests, no headless
// browser) — RBI is opt-in via ?sources=... because it spins up a real
// headless browser per call (multi-second) and shouldn't silently slow
// down every quick refresh click. §13.1 documents this exact pattern
// ("POST /api/refresh?series=a,b,c -> partial refresh"); this uses
// source names rather than series names since that's the granularity a
// user/scheduler actually chooses at (§11.5: "per-source refresh
// exposed").
export const AVAILABLE_SOURCES = ["fred", "bullion", "amfi", "rbi", "nse"] as const;
export type SourceName = (typeof AVAILABLE_SOURCES)[number];

export function parseRequestedSources(sourcesParam: string | undefined): SourceName[] | { error: string } {
  const requested = sourcesParam ? sourcesParam.split(",").map((s) => s.trim().toLowerCase()) : ["fred", "bullion", "amfi", "nse"];
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
  if (names.includes("nse")) out.push(createNseAdapter());
  return out;
}

// Honesty gap, stated plainly rather than hidden: only the score cells
// computeAutoScoreCells() actually implements (§7 cells reachable from
// FRED/bullion/AMFI/RBI series — see pipeline/scoreCells.ts, currently
// 12 of 85) are recomputed from the newly stored observations. Every
// other cell still comes from the mock baseline unchanged. This is real
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

      const asOf = new Date().toISOString();
      let built;
      try {
        built = buildCurrentSnapshot(db, asOf);
      } catch (err) {
        reply.code(500);
        return { error: err instanceof Error ? err.message : String(err) };
      }
      const { snapshot, recomputedIds } = built;

      snapshot.fetchLog = fetchLog;
      snapshot.warnings = [
        ...warnings,
        {
          severity: "info",
          code: "partial_pipeline",
          message: `${recomputedIds.length} of 85 scores were recomputed from this refresh's fetched data (${recomputedIds.join(", ")}); the rest remain the baseline snapshot's values until the full derivation pipeline covers them.`,
          affects: recomputedIds,
        },
      ];

      return snapshot;
    } finally {
      db.close();
    }
  });
}
