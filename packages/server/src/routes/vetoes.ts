import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { upsertManualVeto } from "../store/manual.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";

interface VetoBody {
  node: string;
  active: boolean;
  detail?: string;
}

// §13.1 POST /api/vetoes {node, active, detail} -> VetoState.
export function registerVetoesRoute(app: FastifyInstance): void {
  app.post<{ Body: VetoBody }>("/api/vetoes", async (req, reply) => {
    const { node, active, detail } = req.body ?? ({} as VetoBody);

    if (typeof node !== "string" || node.length === 0) {
      reply.code(400);
      return { error: "Body must include a non-empty string 'node' (the node ID, e.g. 'debt.corporate')." };
    }
    if (typeof active !== "boolean") {
      reply.code(400);
      return { error: "Body must include a boolean 'active'." };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      upsertManualVeto(db, {
        nodeId: node,
        active,
        detail: detail ?? null,
        enteredAt: new Date().toISOString(),
      });
      const { snapshot } = buildCurrentSnapshot(db);
      const vetoState = snapshot.vetoes[node as keyof typeof snapshot.vetoes];
      if (!vetoState) {
        reply.code(201);
        return { warning: `Saved, but '${node}' is not a recognised node ID in the current snapshot.` };
      }
      reply.code(200);
      return vetoState;
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });
}
