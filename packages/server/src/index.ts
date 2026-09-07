import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerSnapshotRoute } from "./routes/snapshot.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRefreshRoute } from "./routes/refresh.js";
import { registerSnapshotsRoute } from "./routes/snapshots.js";
import { registerScoresRoute } from "./routes/scores.js";
import { registerVetoesRoute } from "./routes/vetoes.js";
import { registerParamsRoute } from "./routes/params.js";

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  registerSnapshotRoute(app);
  registerHealthRoute(app);
  registerRefreshRoute(app);
  registerSnapshotsRoute(app);
  registerScoresRoute(app);
  registerVetoesRoute(app);
  registerParamsRoute(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
