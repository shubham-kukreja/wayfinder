import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerSnapshotRoute } from "./routes/snapshot.js";
import { registerHealthRoute } from "./routes/health.js";

const PORT = Number(process.env.PORT) || 3001;

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  registerSnapshotRoute(app);
  registerHealthRoute(app);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
