import { describe, expect, it } from "vitest";
import { createYahooAdapter } from "../src/adapters/yahoo.js";

// LIVE test — actually hits Wikipedia for the constituent list and Yahoo
// Finance's unofficial quote API (cookie+crumb handshake, no official
// SLA — could start blocking this pattern without warning). Skipped by
// default; run explicitly with RUN_LIVE_TESTS=1. Slower than the other
// live tests (~500 constituents across 2 batch requests plus the
// Wikipedia fetch), so a longer per-test timeout.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("Yahoo adapter — live against Wikipedia + Yahoo Finance's unofficial quote API", () => {
  it("fetchLatest() aggregates a real S&P 500 forward P/E from live constituent data", async () => {
    const adapter = createYahooAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("sp500_fwd_pe");
    // Sanity range, not an exact assertion — a real aggregate forward P/E
    // for the S&P 500 has historically sat well within 10-40.
    expect(observations[0]!.value).toBeGreaterThan(5);
    expect(observations[0]!.value).toBeLessThan(60);
  }, 45000);

  it("fetchHistory() throws honestly rather than fabricating a historical series", async () => {
    const adapter = createYahooAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow();
  }, 45000);

  it("health() reports ok:true against the live sources", async () => {
    const adapter = createYahooAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 45000);
});
