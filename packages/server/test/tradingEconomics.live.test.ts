import { describe, expect, it } from "vitest";
import { createTradingEconomicsAdapter, fetchChinaPmiReading } from "../src/adapters/tradingEconomics.js";

// LIVE test — actually hits tradingeconomics.com/china/manufacturing-pmi.
// Skipped by default (network dependency, unofficial/no-SLA source, could
// change its page layout without warning); run explicitly with
// RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("TradingEconomics adapter — live against tradingeconomics.com/china/manufacturing-pmi", () => {
  it("fetchLatest() returns a real China PMI observation in a sane range", async () => {
    const adapter = createTradingEconomicsAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("global_mfg_pmi");
    // PMI is a 0-100ish diffusion index; sane range check, not exact value.
    expect(observations[0]!.value).toBeGreaterThan(30);
    expect(observations[0]!.value).toBeLessThan(70);
  }, 15000);

  it("fetchChinaPmiReading() returns both latest and prior for the rubric's two-argument signature", async () => {
    const reading = await fetchChinaPmiReading();
    expect(reading.latest).toBeGreaterThan(30);
    expect(reading.prior).toBeGreaterThan(30);
  }, 15000);

  it("fetchHistory() throws honestly rather than fabricating a historical series", async () => {
    const adapter = createTradingEconomicsAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow();
  }, 15000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createTradingEconomicsAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 15000);
});
