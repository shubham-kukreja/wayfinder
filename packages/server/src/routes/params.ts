import type { FastifyInstance } from "fastify";
import { paramsSchema, computeAllocation, type Params } from "@wayfinder/engine";
import { openDb } from "../store/db.js";
import { saveParams } from "../store/params.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

// §13.1 POST /api/params {Params} -> Allocation (no refetch). Persists
// the full Params object under the fixed id "current" (store/params.ts),
// so it's picked up by buildCurrentSnapshot() on every subsequent GET
// /api/snapshot — this is what makes a Parameters-page edit survive a
// page reload and show up consistently across every other view, instead
// of being local-only state that vanishes on navigation (the gap this
// route exists to close).
//
// Deliberately does NOT touch observations/scores/vetoes or trigger a
// fetch — matches §13.1's own "(no refetch)" annotation and §12.5
// principle 2 (parameter changes are instant/local; only refresh/save
// actions are explicit network operations).
export function registerParamsRoute(app: FastifyInstance): void {
  app.post<{ Body: unknown }>("/api/params", async (req, reply) => {
    const result = paramsSchema.safeParse(req.body);
    if (!result.success) {
      reply.code(400);
      return { error: "Invalid Params object", issues: result.error.issues };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const params: Params = result.data as Params;
      saveParams(db, "current", params, null, new Date().toISOString());

      // Recompute allocation from the CURRENT scores/vetoes (manual
      // overrides included) against the newly saved params, rather than
      // just echoing back an allocation computed from the mock
      // baseline's scores alone.
      const { snapshot } = buildCurrentSnapshot(db);
      const scoreValues = Object.fromEntries(Object.entries(snapshot.scores).map(([k, v]) => [k, v.value]));
      const vetoValues = Object.fromEntries(Object.entries(snapshot.vetoes).map(([k, v]) => [k, v.active]));
      return computeAllocation(scoreValues, vetoValues, params);
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
