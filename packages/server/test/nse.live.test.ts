import { describe, expect, it } from "vitest";
import { createNseAdapter } from "../src/adapters/nse.js";

// LIVE test — actually hits nseindia.com's cookie-harvest page and
// /api/allIndices. Skipped by default (network dependency, and this is
// a bot-protected domain that could start blocking this pattern without
// warning); run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("NSE adapter — live against nseindia.com/api/allIndices", () => {
  it("fetchLatest() harvests cookies and returns real P/E observations", async () => {
    const adapter = createNseAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.some((o) => o.seriesId === "nifty50_pe")).toBe(true);
  }, 30000);

  it("fetchHistory() throws honestly rather than returning fabricated history", async () => {
    const adapter = createNseAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow();
  }, 30000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createNseAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 30000);
});
