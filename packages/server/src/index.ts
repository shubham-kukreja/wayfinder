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
import { registerSchemesRoute } from "./routes/schemes.js";
import { registerLoginRoute } from "./routes/login.js";
import { loadConfig } from "./config.js";
import { verifyToken } from "./auth.js";

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
  // create/publish/delete) is otherwise unauthenticated. Two credentials are
  // accepted, either of which is sufficient:
  //
  //   Authorization: Bearer <token>  — a session from POST /api/login. This is
  //     what the web app uses, so no long-lived secret ships in the bundle.
  //   x-api-secret: <API_SECRET>     — a static header, kept for curl and any
  //     scheduled job that has no session.
  //
  // Reads stay public either way.
  if (config.apiSecret || config.authTokenSecret) {
    app.addHook("onRequest", async (req, reply) => {
      if (!MUTATING_METHODS.has(req.method)) return;
      // Logging in is itself a POST and obviously cannot require a session.
      if (req.url.startsWith("/api/login")) return;

      if (config.apiSecret && req.headers["x-api-secret"] === config.apiSecret) return;

      if (config.authTokenSecret) {
        const header = req.headers.authorization;
        const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
        if (token && verifyToken(token, config.authTokenSecret)) return;
      }

      await reply.code(401).send({ error: "unauthorized" });
    });
  } else {
    app.log.warn(
      "Neither API_SECRET nor AUTH_TOKEN_SECRET is set — all mutating routes are open to anyone who can reach this server.",
    );
  }

  registerLoginRoute(app);
  registerSnapshotRoute(app);
  registerHealthRoute(app);
  registerRefreshRoute(app);
  registerSnapshotsRoute(app);
  registerScoresRoute(app);
  registerVetoesRoute(app);
  registerParamsRoute(app);
  registerDatapointsRoute(app);
  registerSchemesRoute(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
