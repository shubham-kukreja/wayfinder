import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, latestPublishedSnapshotRow } from "../store/snapshots.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

const STATIC_ACTOR = "dev";

function diffSnapshotInputs(before: ReturnType<typeof buildCurrentSnapshot>["snapshot"] | null, after: ReturnType<typeof buildCurrentSnapshot>["snapshot"]) {
  const changedScores = Object.entries(after.scores)
    .filter(([id, state]) => !before || before.scores[id]?.value !== state.value || before.scores[id]?.provenance !== state.provenance)
    .map(([id, state]) => ({ id, before: before?.scores[id]?.value ?? null, after: state.value, provenance: state.provenance }));

  const changedVetoes = Object.entries(after.vetoes)
    .filter(([id, state]) => !before || before.vetoes[id as keyof typeof before.vetoes]?.active !== state.active)
    .map(([id, state]) => ({ id, before: before?.vetoes[id as keyof typeof before.vetoes]?.active ?? null, after: state.active }));

  const paramsChanged = !before || JSON.stringify(before.params) !== JSON.stringify(after.params);
  return { changedScores, changedVetoes, paramsChanged, totalChanges: changedScores.length + changedVetoes.length + (paramsChanged ? 1 : 0) };
}

function currentDraftStatus(db: ReturnType<typeof openDb>) {
  const { snapshot } = buildCurrentSnapshot(db);
  const latestPublished = latestPublishedSnapshotRow(db);
  const diff = diffSnapshotInputs(latestPublished?.snapshot ?? null, snapshot);
  return {
    hasPublishedVersion: !!latestPublished,
    latestPublishedId: latestPublished?.id ?? null,
    draftAsOf: snapshot.asOf,
    diff,
  };
}

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

  app.get("/api/snapshots/draft-status", async (_req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      return currentDraftStatus(db);
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
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

  // Any saved entry is deletable, reviews and published versions alike
  // — the audit trail is a convenience for this single-user tool, not
  // a compliance guarantee overriding what the user explicitly asks
  // for. Dangling parentId references (a published version whose
  // parent got deleted) are left as-is rather than cascaded — no FK
  // constraint enforces this, and the UI already renders an unknown
  // parent gracefully (a truncated id with nothing behind it).
  app.delete<{ Params: { id: string } }>("/api/snapshots/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const deleted = deleteSnapshot(db, req.params.id);
      if (!deleted) {
        reply.code(404);
        return { error: `No saved snapshot with id ${req.params.id}` };
      }
      reply.code(204);
      return null;
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
      const id = saveSnapshot(db, snapshot, label, { isReview: true, published: false, actor: STATIC_ACTOR });
      reply.code(201);
      return { id, label, createdAt: snapshot.asOf };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  app.post<{ Body: { label?: string; reason?: string } }>("/api/snapshots/publish", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const { snapshot } = buildCurrentSnapshot(db);
      const latestPublished = latestPublishedSnapshotRow(db);
      const diff = diffSnapshotInputs(latestPublished?.snapshot ?? null, snapshot);
      const label = req.body?.label ?? `Published ${new Date(snapshot.asOf).toLocaleString("en-IN")}`;
      const id = saveSnapshot(db, snapshot, label, {
        isReview: true,
        published: true,
        parentId: latestPublished?.id ?? null,
        actor: STATIC_ACTOR,
      });
      reply.code(201);
      return {
        id,
        label,
        parentId: latestPublished?.id ?? null,
        actor: STATIC_ACTOR,
        createdAt: snapshot.asOf,
        reason: req.body?.reason ?? null,
        diff,
      };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
