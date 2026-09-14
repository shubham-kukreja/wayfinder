import { describe, expect, it } from "vitest";
import { createDbNomicsAdapter } from "../src/adapters/dbnomics.js";

// LIVE test — actually hits api.db.nomics.world for the IMF IFS gold
// reserves series. Skipped by default; run explicitly with
// RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("DBnomics adapter — live against api.db.nomics.world", () => {
  it("fetchLatest() returns a real, current global gold reserves observation", async () => {
    const adapter = createDbNomicsAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("cb_gold_reserves_tonnes");
    // Global official gold reserves have historically been well above
    // 30,000 tonnes for decades — sane range check, not exact value.
    expect(observations[0]!.value).toBeGreaterThan(20000);
  }, 15000);

  it("fetchHistory() returns real multi-year history", async () => {
    const adapter = createDbNomicsAdapter();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 10);
    const observations = await adapter.fetchHistory(from, new Date());
    // 10 years of monthly data should be well over 100 observations.
    expect(observations.length).toBeGreaterThan(100);
  }, 15000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createDbNomicsAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 15000);
});
