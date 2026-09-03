import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { snapshotSchema } from "@wayfinder/engine";
import { openDb } from "../store/db.js";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { runRefresh } from "../pipeline/refresh.js";
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
// Honesty gap, stated plainly rather than hidden: the returned
// Snapshot's scores/allocation are NOT yet recomputed from the newly
// stored observations — that requires the full 85-score derivation
// pipeline (§7's per-cell transforms), which doesn't exist beyond the
// one real-rates path in pipeline/derive.ts. This endpoint proves the
// fetch-and-store half of §11.5's contract works for real; it returns
// the mock baseline's scores/allocation with the REAL fetchLog and
// warnings from this run spliced in, so the per-source progress and
// failure reporting are genuine even though the numbers below them
// aren't recomputed yet.
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
      raw.warnings = [
        ...warnings,
        {
          severity: "info",
          code: "partial_pipeline",
          message: "Scores and allocation below are the baseline snapshot, not yet recomputed from this refresh's fetched data — the full derivation pipeline is still being built.",
          affects: [],
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
