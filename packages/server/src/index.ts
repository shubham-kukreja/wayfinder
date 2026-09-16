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

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = Fastify({ logger: true });

  // @fastify/cors's default `methods` allowlist doesn't include DELETE
  // (or PUT/PATCH) — without this, DELETE /api/snapshots/:id fails
  // entirely in the browser with a CORS preflight error, even though
  // the route itself works fine when hit directly (e.g. via curl).
  await app.register(cors, { origin: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });

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
