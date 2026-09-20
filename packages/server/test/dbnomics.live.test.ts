import { describe, expect, it } from "vitest";
import { createDbNomicsAdapter } from "../src/adapters/dbnomics.js";

// LIVE test — actually hits api.db.nomics.world for the IMF IFS gold
// reserves series. Skipped by default; run explicitly with
// RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("DBnomics adapter — live against api.db.nomics.world", () => {
  it("fetchLatest() returns a real, current observation for BOTH series", async () => {
    const adapter = createDbNomicsAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(2);

    const gold = observations.find((o) => o.seriesId === "cb_gold_reserves_tonnes")!;
    expect(gold).toBeDefined();
    // Global official gold reserves have historically been well above
    // 30,000 tonnes for decades — sane range check, not exact value.
    expect(gold.value).toBeGreaterThan(20000);

    const repo = observations.find((o) => o.seriesId === "repo_rate")!;
    expect(repo).toBeDefined();
    // India's policy rate has stayed inside this band for decades — a
    // sane range check, not an exact value that would break on the next
    // MPC decision.
    expect(repo.value).toBeGreaterThan(2);
    expect(repo.value).toBeLessThan(15);
  }, 15000);

  it("fetchHistory() returns real multi-year history for both series", async () => {
    const adapter = createDbNomicsAdapter();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 10);
    const observations = await adapter.fetchHistory(from, new Date());
    // 10 years of monthly data should be well over 100 observations.
    expect(observations.length).toBeGreaterThan(100);
    expect(observations.some((o) => o.seriesId === "cb_gold_reserves_tonnes")).toBe(true);
    expect(observations.some((o) => o.seriesId === "repo_rate")).toBe(true);
  }, 15000);

  // The reason this series was added at all: rbi.org.in's homepage widget
  // is current-value only, so without real history the equity macro
  // rubric's rbiStance input has nothing to compare against. This asserts
  // the history is genuinely deep and genuinely varies.
  it("repo_rate history is deep enough for a 6-month stance comparison and shows real rate changes", async () => {
    const adapter = createDbNomicsAdapter();
    const from = new Date("1990-01-01");
    const observations = (await adapter.fetchHistory(from, new Date())).filter((o) => o.seriesId === "repo_rate");
    expect(observations.length).toBeGreaterThan(300);
    const distinct = new Set(observations.map((o) => o.value));
    expect(distinct.size).toBeGreaterThan(5);
  }, 15000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createDbNomicsAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 15000);
});
