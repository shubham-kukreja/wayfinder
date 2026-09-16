import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerSnapshotRoute } from "./routes/snapshot.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRefreshRoute } from "./routes/refresh.js";
import { registerSnapshotsRoute } from "./routes/snapshots.js";
import { registerScoresRoute } from "./routes/scores.js";
import { registerVetoesRoute } from "./routes/vetoes.js";
import { registerParamsRoute } from "./routes/params.js";
import { registerDatapointsRoute } from "./routes/datapoints.js";
import { loadConfig } from "./config.js";

const PORT = Number(process.env.PORT) || 3001;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function main() {
  const app = Fastify({ logger: true });
  const config = loadConfig();

  // @fastify/cors's default `methods` allowlist doesn't include DELETE
  // (or PUT/PATCH) — without this, DELETE /api/snapshots/:id fails
  // entirely in the browser with a CORS preflight error, even though
  // the route itself works fine when hit directly (e.g. via curl).
  //
  // origin: true reflects whatever Origin the caller sends, so any site
  // could script the API from a visitor's browser. Deployments set
  // ALLOWED_ORIGINS to their web origin; local dev leaves it unset.
  await app.register(cors, {
    origin: config.allowedOrigins ?? true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Every mutating route (refresh, params, scores, vetoes, snapshot
  // create/publish/delete) is otherwise unauthenticated. With API_SECRET
  // set, they require a matching x-api-secret header; reads stay public.
  if (config.apiSecret) {
    const expected = config.apiSecret;
    app.addHook("onRequest", async (req, reply) => {
      if (!MUTATING_METHODS.has(req.method)) return;
      const provided = req.headers["x-api-secret"];
      if (provided !== expected) {
        await reply.code(401).send({ error: "unauthorized" });
      }
    });
  } else {
    app.log.warn(
      "API_SECRET is unset — all mutating routes are open to anyone who can reach this server.",
    );
  }

  registerSnapshotRoute(app);
  registerHealthRoute(app);
  registerRefreshRoute(app);
  registerSnapshotsRoute(app);
  registerScoresRoute(app);
  registerVetoesRoute(app);
  registerParamsRoute(app);
  registerDatapointsRoute(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
