import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { snapshotSchema } from "@wayfinder/engine";

const __dirname = dirname(fileURLToPath(import.meta.url));
// §13.1 GET /api/snapshot — "cached, fast, no fetching." The real
// pipeline that assembles a Snapshot from live store state (scores,
// series, allocation) doesn't exist yet (§13's ScoreState/SeriesState
// population from the store is a bigger, not-yet-built piece — see
// pipeline/derive.ts for the one series that's wired end-to-end so far).
// Until that lands, this serves the same healthy mock fixture the web
// app's dev-mode fixture switcher uses — real data, computed by the real
// engine, schema-valid — just not live-fetched from the store yet.
const MOCK_SNAPSHOT_PATH = join(__dirname, "../../../../mock/snapshot.json");

export function registerSnapshotRoute(app: FastifyInstance): void {
  app.get("/api/snapshot", async (_req, reply) => {
    const raw = JSON.parse(readFileSync(MOCK_SNAPSHOT_PATH, "utf-8"));
    const result = snapshotSchema.safeParse(raw);
    if (!result.success) {
      reply.code(500);
      return { error: "Snapshot failed schema validation", issues: result.error.issues };
    }
    return result.data;
  });
}
