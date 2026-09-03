import { describe, expect, it } from "vitest";
import { createNseAdapter, NseNotImplementedError, NSE_SERIES_IDS } from "../src/adapters/nse.js";

// §9: "A failed fetch is a warning, never an exception. The allocation
// always computes." This adapter deliberately throws rather than
// returning fabricated/stale data — the pipeline layer (not built yet)
// is responsible for catching this and converting it into a warning +
// falling back to manual/default scores, per the same contract every
// other adapter's failure path follows.
describe("NSE adapter — not yet implemented, fails loudly rather than silently", () => {
  it("fetchLatest throws NseNotImplementedError", async () => {
    const adapter = createNseAdapter();
    await expect(adapter.fetchLatest()).rejects.toThrow(NseNotImplementedError);
  });

  it("fetchHistory throws NseNotImplementedError", async () => {
    const adapter = createNseAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(NseNotImplementedError);
  });

  it("health() reports ok:false with a clear, actionable message", async () => {
    const adapter = createNseAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/not implemented/i);
  });

  it("declares the ~19 series it will eventually cover, so the pipeline can reference them as known-but-manual", () => {
    const adapter = createNseAdapter();
    expect(adapter.series).toEqual(NSE_SERIES_IDS);
    expect(adapter.series.length).toBe(21); // 4 broad indices + TR + 8 sector PE + 8 sector TR
  });
});
