import { describe, expect, it } from "vitest";
import { createRbiRepoRateAdapter } from "../src/adapters/rbiRepoRate.js";

// LIVE test — actually hits rbi.org.in's homepage. Skipped by default;
// run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("RBI repo rate adapter — live against rbi.org.in", () => {
  it("fetchLatest() returns a real, current repo rate in a sane range", async () => {
    const adapter = createRbiRepoRateAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("repo_rate");
    // India's repo rate has historically sat between roughly 4% and 9%.
    expect(observations[0]!.value).toBeGreaterThan(2);
    expect(observations[0]!.value).toBeLessThan(15);
  }, 15000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createRbiRepoRateAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 15000);
});
