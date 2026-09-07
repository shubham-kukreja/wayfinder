import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

// §13.1 GET /api/snapshot — "cached, fast, no fetching." Uses the same
// buildCurrentSnapshot() as POST /api/refresh and POST /api/snapshots,
// so this always reflects whatever the store currently holds (including
// anything a prior refresh call fetched and stored), not a separate
// static copy that could silently drift from what refresh last computed.
export function registerSnapshotRoute(app: FastifyInstance): void {
  app.get("/api/snapshot", async (_req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const { snapshot } = buildCurrentSnapshot(db);
      return snapshot;
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
