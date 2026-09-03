import type { FastifyInstance } from "fastify";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { createNseAdapter } from "../adapters/nse.js";
import { loadConfig } from "../config.js";

// §13.1 GET /api/health — per-source status, last success, staleness.
// RBI's health() spins up a real headless browser (several seconds), so
// it's excluded from this always-fast health check; it's exercised
// directly by its own live test instead.
export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/api/health", async () => {
    const config = loadConfig();
    const fred = createFredAdapter({ apiKey: config.fredApiKey, series: FRED_SERIES });
    const bullion = createBullionAdapter({ apiKey: config.metalsDevApiKey, series: BULLION_SERIES });
    const amfi = createAmfiAdapter();
    const nse = createNseAdapter();

    const [fredHealth, bullionHealth, amfiHealth, nseHealth] = await Promise.all([
      fred.health(),
      bullion.health(),
      amfi.health(),
      nse.health(),
    ]);

    return {
      sources: [fredHealth, bullionHealth, amfiHealth, nseHealth],
      checkedAt: new Date().toISOString(),
    };
  });
}
