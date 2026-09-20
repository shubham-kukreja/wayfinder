import { describe, expect, it } from "vitest";
import { createTradingEconomicsAdapter, fetchChinaPmiReading } from "../src/adapters/tradingEconomics.js";

// LIVE test — actually hits tradingeconomics.com's China PMI and India
// inflation pages.
// Skipped by default (network dependency, unofficial/no-SLA source, could
// change its page layout without warning); run explicitly with
// RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("TradingEconomics adapter — live against tradingeconomics.com", () => {
  it("fetchLatest() returns real observations for BOTH series in sane ranges", async () => {
    const adapter = createTradingEconomicsAdapter();
    const observations = await adapter.fetchLatest();

    const pmi = observations.filter((o) => o.seriesId === "global_mfg_pmi");
    expect(pmi.length).toBeGreaterThan(0);
    // PMI is a 0-100ish diffusion index; sane range check, not exact value.
    for (const o of pmi) {
      expect(o.value).toBeGreaterThan(30);
      expect(o.value).toBeLessThan(70);
    }

    const cpi = observations.filter((o) => o.seriesId === "cpi_yoy");
    expect(cpi.length).toBeGreaterThan(0);
    // India CPI YoY in percent — a plausible band, not an exact print.
    for (const o of cpi) {
      expect(o.value).toBeGreaterThan(-5);
      expect(o.value).toBeLessThan(20);
    }
  }, 20000);

  // The whole reason this series was added: both prior cpi_yoy sources
  // had fallen ~6 and ~18 months behind. This asserts TE is actually
  // fresher than the RBI mirror's 2026-03 ceiling, which is the only
  // thing that makes it worth wiring.
  it("cpi_yoy from TE is materially fresher than the RBI mirror's newest print", async () => {
    const observations = await createTradingEconomicsAdapter().fetchLatest();
    const cpi = observations.filter((o) => o.seriesId === "cpi_yoy").map((o) => o.date).sort();
    expect(cpi[cpi.length - 1]! > "2026-03-01").toBe(true);
  }, 20000);

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
