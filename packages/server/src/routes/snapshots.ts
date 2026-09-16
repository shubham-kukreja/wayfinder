import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, latestPublishedSnapshotRow } from "../store/snapshots.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { saveParams } from "../store/params.js";
import { clearManualScores, clearManualVetoes, upsertManualScore, upsertManualVeto } from "../store/manual.js";
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

  // Diff any two saved entries, so the audit surface can answer "what
  // changed between these two versions" rather than only the built-in
  // draft-vs-latest-published comparison. `from` may be omitted to diff a
  // single entry against nothing (its first-publish state), and either id
  // may be the literal "draft" to compare against current unsaved state.
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/snapshots/diff", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const { from, to } = req.query;
      if (!to) {
        reply.code(400);
        return { error: "`to` is required" };
      }

      const resolve = (id: string) => (id === "draft" ? buildCurrentSnapshot(db).snapshot : getSnapshot(db, id));

      const afterSnapshot = resolve(to);
      if (!afterSnapshot) {
        reply.code(404);
        return { error: `No saved snapshot with id ${to}` };
      }

      let beforeSnapshot = null;
      if (from) {
        const resolved = resolve(from);
        if (!resolved) {
          reply.code(404);
          return { error: `No saved snapshot with id ${from}` };
        }
        beforeSnapshot = resolved;
      }

      return {
        from: from ?? null,
        to,
        diff: diffSnapshotInputs(beforeSnapshot, afterSnapshot),
        // The allocations themselves travel with the diff: the changed
        // inputs say what moved, but the reader's actual question is what
        // it did to the portfolio, and recomputing that needs both
        // snapshots' params — which the caller would otherwise refetch.
        before: beforeSnapshot ? { asOf: beforeSnapshot.asOf, scores: beforeSnapshot.scores, vetoes: beforeSnapshot.vetoes, params: beforeSnapshot.params } : null,
        after: { asOf: afterSnapshot.asOf, scores: afterSnapshot.scores, vetoes: afterSnapshot.vetoes, params: afterSnapshot.params },
      };
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

  // Restore the draft to a saved entry's state. Only the inputs a user can
  // actually author are restored — params and manual overrides. Auto-derived
  // scores are deliberately NOT written back: they are a pure function of the
  // stored observations, so re-deriving them is what keeps a revert from
  // resurrecting stale values that the observation history has since moved
  // past. Reverting is therefore "restore the decisions", not "rewind time".
  //
  // Observations are never touched: a revert must not discard data that has
  // legitimately arrived since.
  app.post<{ Params: { id: string } }>("/api/snapshots/:id/revert", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const target = getSnapshot(db, req.params.id);
      if (!target) {
        reply.code(404);
        return { error: `No saved snapshot with id ${req.params.id}` };
      }

      const now = new Date().toISOString();

      // One transaction: a half-applied revert would leave the draft in a
      // state that never existed, which is worse than either endpoint.
      db.transaction(() => {
        saveParams(db, "current", target.params, null, now);

        clearManualScores(db);
        for (const [scoreId, state] of Object.entries(target.scores)) {
          if (state.provenance !== "manual") continue;
          upsertManualScore(db, {
            scoreId,
            value: state.value,
            note: state.note ?? null,
            confidence: state.confidence ?? null,
            enteredAt: state.enteredAt ?? now,
          });
        }

        clearManualVetoes(db);
        for (const [nodeId, veto] of Object.entries(target.vetoes)) {
          if (veto.provenance !== "manual") continue;
          upsertManualVeto(db, { nodeId, active: veto.active, detail: veto.detail ?? null, enteredAt: now });
        }
      })();

      const { snapshot } = buildCurrentSnapshot(db);
      const latestPublished = latestPublishedSnapshotRow(db);
      return {
        revertedTo: req.params.id,
        restoredManualScores: Object.values(target.scores).filter((s) => s.provenance === "manual").length,
        restoredManualVetoes: Object.values(target.vetoes).filter((v) => v.provenance === "manual").length,
        diff: diffSnapshotInputs(latestPublished?.snapshot ?? null, snapshot),
      };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
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

  app.post<{ Body: { label?: string; reason?: string } }>("/api/snapshots", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const { snapshot } = buildCurrentSnapshot(db);
      const label = req.body?.label ?? null;
      const reason = req.body?.reason ?? null;
      const id = saveSnapshot(db, snapshot, label, { isReview: true, published: false, actor: STATIC_ACTOR, reason });
      reply.code(201);
      return { id, label, reason, createdAt: snapshot.asOf };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  // Publishing defaults to freezing current state, but may instead promote a
  // saved review by id. Without that, a review saved on Monday could never be
  // published on Friday as the thing that was actually reviewed — the only
  // route to "published" rebuilt from whatever the draft had since become,
  // which quietly publishes something the user never looked at.
  app.post<{ Body: { label?: string; reason?: string; fromSnapshotId?: string } }>("/api/snapshots/publish", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const sourceId = req.body?.fromSnapshotId;
      let snapshot;
      if (sourceId) {
        const saved = getSnapshot(db, sourceId);
        if (!saved) {
          reply.code(404);
          return { error: `No saved snapshot with id ${sourceId}` };
        }
        snapshot = saved;
      } else {
        snapshot = buildCurrentSnapshot(db).snapshot;
      }
      const latestPublished = latestPublishedSnapshotRow(db);
      const diff = diffSnapshotInputs(latestPublished?.snapshot ?? null, snapshot);
      // A promotion carries the review's own label and reason forward unless
      // the caller supplies new ones: the justification written at review
      // time is the one that belongs on the published version.
      const source = sourceId ? listSnapshots(db).find((row) => row.id === sourceId) ?? null : null;
      const label = req.body?.label ?? source?.label ?? `Published ${new Date(snapshot.asOf).toLocaleString("en-IN")}`;
      const reason = req.body?.reason ?? source?.reason ?? null;
      const id = saveSnapshot(db, snapshot, label, {
        isReview: true,
        published: true,
        parentId: latestPublished?.id ?? null,
        actor: STATIC_ACTOR,
        reason,
      });
      reply.code(201);
      return {
        id,
        label,
        parentId: latestPublished?.id ?? null,
        actor: STATIC_ACTOR,
        createdAt: snapshot.asOf,
        reason,
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
