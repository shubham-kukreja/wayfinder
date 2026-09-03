import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { snapshotSchema, computeAllocation } from "@wayfinder/engine";
import { openDb } from "../store/db.js";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { runRefresh } from "../pipeline/refresh.js";
import { computeAutoScoreCells } from "../pipeline/scoreCells.js";
import { loadConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SNAPSHOT_PATH = join(__dirname, "../../../../mock/snapshot.json");

// §11.5 / §13.1 POST /api/refresh. Fans out to the real, non-browser
// adapters (FRED, bullion, AMFI) in parallel via runRefresh() — RBI and
// NSE are excluded here because they require a headless browser per
// invocation (multi-second, heavier than a request should block on); a
// scheduled job is the right place for those, not an interactive refresh
// click. Appends whatever each source returns to the SQLite store with a
// real fetchLog and warnings.
//
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
  app.post("/api/refresh", async (_req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);

    try {
      const adapters = [
        createFredAdapter({ apiKey: config.fredApiKey, series: FRED_SERIES }),
        createBullionAdapter({ apiKey: config.metalsDevApiKey, series: BULLION_SERIES }),
        createAmfiAdapter(),
      ];

      const { fetchLog, warnings } = await runRefresh(db, adapters);

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
