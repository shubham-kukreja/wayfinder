import { describe, expect, it } from "vitest";
import { createBisPolicyRateAdapter } from "../src/adapters/bisPolicyRate.js";

// LIVE test — actually hits stats.bis.org's SDMX API. Skipped by default;
// run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("BIS policy rate adapter — live against stats.bis.org", () => {
  it("fetchLatest() returns a real, current India policy rate in a sane range", async () => {
    const observations = await createBisPolicyRateAdapter().fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("repo_rate");
    // India's policy rate has stayed inside this band for decades — a
    // sane range check, not an exact value that breaks on the next MPC.
    expect(observations[0]!.value).toBeGreaterThan(2);
    expect(observations[0]!.value).toBeLessThan(15);
  }, 30000);

  it("fetchHistory() returns deep history with real rate changes in it", async () => {
    const from = new Date("1990-01-01");
    const observations = await createBisPolicyRateAdapter().fetchHistory(from, new Date());
    expect(observations.length).toBeGreaterThan(300);
    expect(new Set(observations.map((o) => o.value)).size).toBeGreaterThan(5);
  }, 30000);

  // The whole reason this adapter exists rather than reusing the
  // DBnomics mirror of the same dataset: that mirror ends 2025-06, a gap
  // too wide for rbiStanceFromRepoRate()'s 12-month staleness bound, so
  // l1.equity::macro abstained permanently. If BIS direct ever falls as
  // far behind, this test says so loudly instead of the cell going quiet.
  it("is fresh enough for a 6-month stance comparison against today", async () => {
    const observations = await createBisPolicyRateAdapter().fetchHistory(new Date("1990-01-01"), new Date());
    const newest = observations.map((o) => o.date).sort().pop()!;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    expect(new Date(newest).getTime()).toBeGreaterThan(twelveMonthsAgo.getTime());
  }, 30000);

  it("health() reports ok:true against the live source", async () => {
    expect((await createBisPolicyRateAdapter().health()).ok).toBe(true);
  }, 30000);
});
