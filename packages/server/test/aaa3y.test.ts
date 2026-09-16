import { describe, expect, it } from "vitest";
import { AAA_3Y_SERIES_ID, Aaa3yUnavailableError, createAaa3yAdapter } from "../src/adapters/aaa3y.js";

// aaa_3y has no live source — FIMMDA/FBIL both confirmed dead ends
// (docs/DATA_SOURCES.md). This adapter is an intentional always-fails
// stand-in so the gap surfaces honestly instead of being silently
// absent; these tests confirm it never fabricates a value.
describe("aaa_3y mock adapter — honest failure, never fabricates a value", () => {
  it("declares its one series (aaa_3y)", () => {
    const adapter = createAaa3yAdapter();
    expect(adapter.series).toEqual([AAA_3Y_SERIES_ID]);
  });

  it("uses an unmistakable non-vendor id", () => {
    const adapter = createAaa3yAdapter();
    expect(adapter.id).toBe("AAA3Y_MOCK");
  });

  it("fetchLatest always rejects", async () => {
    const adapter = createAaa3yAdapter();
    await expect(adapter.fetchLatest()).rejects.toThrow(Aaa3yUnavailableError);
  });

  it("fetchHistory always rejects", async () => {
    const adapter = createAaa3yAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(Aaa3yUnavailableError);
  });

  it("health() reports ok:false with a clear detail message", async () => {
    const adapter = createAaa3yAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.source).toBe("AAA3Y_MOCK");
    expect(health.detail).toMatch(/FIMMDA|FBIL/);
  });
});
