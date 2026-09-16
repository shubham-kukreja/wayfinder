import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { addTrackedScheme, deactivateTrackedScheme, listTrackedSchemes } from "../store/trackedSchemes.js";
import { parseNavAllLatest } from "../adapters/amfiNav.js";
import { request } from "undici";
import { loadConfig } from "../config.js";

const NAV_LATEST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

// GET /api/schemes/search?q=... — AMFI has no scheme search API, so this
// pulls the same full latest-NAV file the adapter uses (~1MB, ~14k rows,
// ~2s live) and filters by name substring, in-memory, per request. Not
// cached: this route is only hit interactively (a user adding a scheme to
// track), never by the refresh pipeline, so the extra ~2s per search is an
// acceptable trade for always-current scheme names/codes rather than a
// stale local mirror going out of sync with AMFI's own listings.
export function registerSchemesRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string } }>("/api/schemes/search", async (req, reply) => {
    const q = (req.query.q ?? "").trim().toLowerCase();
    if (q.length < 3) {
      reply.code(400);
      return { error: "Query must be at least 3 characters." };
    }

    const res = await request(NAV_LATEST_URL, { method: "GET" });
    if (res.statusCode !== 200) {
      reply.code(502);
      return { error: `AMFI NAV file fetch failed (${res.statusCode}).` };
    }
    const text = await res.body.text();
    const rows = parseNavAllLatest(text).filter((r) => r.schemeName.toLowerCase().includes(q));

    // Cap results: a broad query like "fund" matches thousands of rows,
    // which is not a useful search-result list either way.
    return { results: rows.slice(0, 50).map((r) => ({ schemeCode: r.schemeCode, schemeName: r.schemeName, nav: r.nav, date: r.date })) };
  });

  app.get("/api/schemes/tracked", async () => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      return { schemes: listTrackedSchemes(db) };
    } finally {
      db.close();
    }
  });

  app.post<{ Body: { schemeCode?: string; schemeName?: string; isinGrowth?: string; category?: string } }>(
    "/api/schemes/tracked",
    async (req, reply) => {
      const { schemeCode, schemeName, isinGrowth, category } = req.body ?? {};
      if (!schemeCode || !schemeName) {
        reply.code(400);
        return { error: "schemeCode and schemeName are required." };
      }

      const config = loadConfig();
      const db = openDb(config.dbPath);
      try {
        addTrackedScheme(db, { schemeCode, schemeName, isinGrowth, category });
        return { schemes: listTrackedSchemes(db) };
      } finally {
        db.close();
      }
    }
  );

  app.delete<{ Params: { schemeCode: string } }>("/api/schemes/tracked/:schemeCode", async (req) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      deactivateTrackedScheme(db, req.params.schemeCode);
      return { schemes: listTrackedSchemes(db) };
    } finally {
      db.close();
    }
  });
}
