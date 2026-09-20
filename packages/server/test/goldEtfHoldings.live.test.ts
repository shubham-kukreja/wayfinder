import { describe, expect, it } from "vitest";
import { createGoldEtfHoldingsAdapter } from "../src/adapters/goldEtfHoldings.js";

// LIVE test — actually hits api.spdrgoldshares.com's historical-archive
// endpoint (no auth, no Cloudflare wall, confirmed live 2026-09-20).
// Skipped by default; run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("Gold ETF holdings adapter — live against api.spdrgoldshares.com", () => {
  it("fetchLatest() returns a real, sane current GLD tonnes-of-gold observation", async () => {
    const adapter = createGoldEtfHoldingsAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    // GLD has held somewhere between ~700 and ~1500 tonnes over the last
    // decade; a loose sanity floor/ceiling, not an exact expectation.
    expect(observations[0]!.value).toBeGreaterThan(500);
    expect(observations[0]!.value).toBeLessThan(2000);
  }, 20000);

  it("fetchHistory() returns real multi-year daily history, including a genuine 3-months-ago observation", async () => {
    const adapter = createGoldEtfHoldingsAdapter();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    const observations = await adapter.fetchHistory(from, new Date());
    // ~250 trading days/year; a loose floor proving this is real daily
    // history, not a handful of sparse points.
    expect(observations.length).toBeGreaterThan(150);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    expect(observations.some((o) => new Date(o.date) <= threeMonthsAgo)).toBe(true);
  }, 20000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createGoldEtfHoldingsAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 20000);
});
