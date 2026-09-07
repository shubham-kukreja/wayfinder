import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { upsertManualScore } from "../store/manual.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

interface ScoreBody {
  id: string;
  value: number;
  note?: string;
  confidence?: "high" | "medium" | "low";
}

// §13.1 POST /api/scores {id, value, note, confidence} -> ScoreState.
// A manual entry (including a rubric picker's resulting value — the
// picker computes it client-side, this just persists the number) always
// wins over an automated derivation for that score cell (see
// pipeline/currentSnapshot.ts's layering comment) — that's the entire
// point of "manual" existing as a provenance category.
export function registerScoresRoute(app: FastifyInstance): void {
  app.post<{ Body: ScoreBody }>("/api/scores", async (req, reply) => {
    const { id, value, note, confidence } = req.body ?? ({} as ScoreBody);

    if (typeof id !== "string" || id.length === 0) {
      reply.code(400);
      return { error: "Body must include a non-empty string 'id' (the score key, e.g. 'l1.equity::macro')." };
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      reply.code(400);
      return { error: "Body must include a numeric 'value' between 0 and 100." };
    }
    if (confidence !== undefined && !["high", "medium", "low"].includes(confidence)) {
      reply.code(400);
      return { error: "'confidence', if given, must be 'high', 'medium', or 'low'." };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      upsertManualScore(db, {
        scoreId: id,
        value,
        note: note ?? null,
        confidence: confidence ?? null,
        enteredAt: new Date().toISOString(),
      });
      const { snapshot } = buildCurrentSnapshot(db);
      const scoreState = snapshot.scores[id];
      if (!scoreState) {
        // Saved successfully, but the ID isn't one of the frozen 85 score
        // keys the mock baseline enumerates — still tell the caller
        // clearly rather than returning undefined silently.
        reply.code(201);
        return { warning: `Saved, but '${id}' is not a recognised score key in the current snapshot.` };
      }
      reply.code(200);
      return scoreState;
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
