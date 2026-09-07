import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { saveSnapshot, listSnapshots, getSnapshot } from "../store/snapshots.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

// §13.1 GET/POST /api/snapshots — "saved reviews" / "freeze current state
// as an immutable review." §12.2's History & Review surface and §12.5
// principle 4 ("distinguish looking from deciding — refreshing data is
// not saving a review") both depend on this existing as a real, separate
// action from a refresh.
//
// "Current state" here is the same buildCurrentSnapshot() GET
// /api/snapshot and POST /api/refresh use — saving a review does not
// itself trigger a fetch; it freezes whatever the store currently
// produces. A user who wants a review to reflect the latest data must
// call POST /api/refresh first, then save — two explicit actions,
// matching §12.5's looking-vs-deciding distinction rather than
// collapsing them into one click.
export function registerSnapshotsRoute(app: FastifyInstance): void {
  app.get("/api/snapshots", async () => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      return listSnapshots(db);
    } finally {
      db.close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/snapshots/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const snapshot = getSnapshot(db, req.params.id);
      if (!snapshot) {
        reply.code(404);
        return { error: `No saved snapshot with id ${req.params.id}` };
      }
      return snapshot;
    } finally {
      db.close();
    }
  });

  app.post<{ Body: { label?: string } }>("/api/snapshots", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const { snapshot } = buildCurrentSnapshot(db);
      const label = req.body?.label ?? null;
      const id = saveSnapshot(db, snapshot, label, true);
      reply.code(201);
      return { id, label, createdAt: snapshot.asOf };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
