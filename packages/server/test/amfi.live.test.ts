import { describe, expect, it } from "vitest";
import { createAmfiAdapter } from "../src/adapters/amfi.js";

// LIVE test — actually downloads and parses a real report from
// portal.amfiindia.com. Skipped by default (network dependency); run
// explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("AMFI adapter — live against portal.amfiindia.com", () => {
  it("fetchLatest() downloads and parses the most recent available report", async () => {
    const adapter = createAmfiAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.some((o) => o.seriesId === "flow_equity_3m")).toBe(true);
    expect(observations.some((o) => o.seriesId === "aum_equity")).toBe(true);
  }, 30000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createAmfiAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 30000);
});
