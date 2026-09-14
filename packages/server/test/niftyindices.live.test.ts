import { describe, expect, it } from "vitest";
import { createNiftyIndicesAdapter } from "../src/adapters/niftyindices.js";

// LIVE test — actually hits niftyindices.com's cookie-harvest page and the
// Daily_Snapshot CSV archive. Skipped by default (network dependency, an
// unofficial mechanism reverse-engineered from a working UI flow — no
// documented API contract); run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("niftyindices.com adapter — live against Daily_Snapshot CSVs", () => {
  it("fetchLatest() returns real observations with no cookie handshake needed, including Nifty Capital Goods", async () => {
    const adapter = createNiftyIndicesAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.some((o) => o.seriesId === "nifty50_pe")).toBe(true);
    expect(observations.some((o) => o.seriesId === "sector_pe_capgoods")).toBe(true);
  }, 30000);

  it("fetchHistory() returns real observations across a multi-day range, skipping non-trading days", async () => {
    const adapter = createNiftyIndicesAdapter();
    const to = new Date();
    to.setDate(to.getDate() - 1);
    const from = new Date(to);
    from.setDate(from.getDate() - 6); // a week back covers at least a couple of weekend gaps
    const observations = await adapter.fetchHistory(from, to);
    expect(observations.length).toBeGreaterThan(0);
    // At most 7 calendar days, so at most 7 distinct trading dates.
    const distinctDates = new Set(observations.map((o) => o.date));
    expect(distinctDates.size).toBeLessThanOrEqual(7);
    expect(distinctDates.size).toBeGreaterThan(0);
  }, 60000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createNiftyIndicesAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 30000);
});
