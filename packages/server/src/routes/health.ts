import type { FastifyInstance } from "fastify";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { createNseAdapter } from "../adapters/nse.js";
import { createAaa3yAdapter } from "../adapters/aaa3y.js";
import { loadConfig } from "../config.js";

// §13.1 GET /api/health — per-source status, last success, staleness.
// RBI's health() spins up a real headless browser (several seconds), so
// it's excluded from this always-fast health check; it's exercised
// directly by its own live test instead.
export function registerHealthRoute(app: FastifyInstance): void {
  // Liveness only: is the process up and serving? Deliberately touches no
  // adapter and no database, so a deploy healthcheck can't be failed by a
  // flaky upstream (/api/health below calls five external APIs and is far
  // too slow and failure-prone for that job).
  app.get("/api/live", async () => ({ status: "ok" }));

  app.get("/api/health", async () => {
    const config = loadConfig();
    const fred = createFredAdapter({ apiKey: config.fredApiKey, series: FRED_SERIES });
    const bullion = createBullionAdapter({ apiKey: config.metalsDevApiKey, series: BULLION_SERIES });
    const amfi = createAmfiAdapter();
    const nse = createNseAdapter();
    const aaa3y = createAaa3yAdapter();

    const [fredHealth, bullionHealth, amfiHealth, nseHealth, aaa3yHealth] = await Promise.all([
      fred.health(),
      bullion.health(),
      amfi.health(),
      nse.health(),
      aaa3y.health(),
    ]);

    return {
      sources: [fredHealth, bullionHealth, amfiHealth, nseHealth, aaa3yHealth],
      checkedAt: new Date().toISOString(),
    };
  });
}
