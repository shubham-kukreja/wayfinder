import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";
import { latestPublishedSnapshotRow } from "../store/snapshots.js";

function getDraftSnapshot() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const { snapshot } = buildCurrentSnapshot(db);
    return snapshot;
  } finally {
    db.close();
  }
}

function getPublishedSnapshot() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    return latestPublishedSnapshotRow(db)?.snapshot ?? null;
  } finally {
    db.close();
  }
}

// §13.1 GET /api/snapshot — compatibility alias for draft/current state.
// Explicit endpoints below make the draft vs published split visible while
// we migrate the UI intentionally.
export function registerSnapshotRoute(app: FastifyInstance): void {
  app.get("/api/snapshot", async (_req, reply) => {
    try {
      return getDraftSnapshot();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/snapshot/draft", async (_req, reply) => {
    try {
      return getDraftSnapshot();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/snapshot/published", async (_req, reply) => {
    try {
      const snapshot = getPublishedSnapshot();
      if (!snapshot) {
        reply.code(404);
        return { error: "No published model version exists yet." };
      }
      return snapshot;
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
