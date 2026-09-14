import { describe, expect, it } from "vitest";
import { createCcilAdapter } from "../src/adapters/ccil.js";

// LIVE test — actually launches headless Chromium against
// ccilindia.com's tenorwise-indicative-yields page. Skipped by default
// (requires network + a real Chromium binary) so the regular `pnpm test`
// run stays fast and hermetic; run explicitly with RUN_LIVE_TESTS=1 and
// CHROMIUM_EXECUTABLE_PATH set, same convention as test/rbi.live.test.ts.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

describe.skipIf(!shouldRun)("CCIL ZCYC adapter — live against ccilindia.com", () => {
  it("fetchLatest() returns a real, current 364D T-bill yield in a sane range", async () => {
    const adapter = createCcilAdapter({ executablePath, headless: true });
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBe(1);
    expect(observations[0]!.seriesId).toBe("tbill_1y");
    // India's short-tenor T-bill yields have historically sat well
    // within 2%-15%.
    expect(observations[0]!.value).toBeGreaterThan(2);
    expect(observations[0]!.value).toBeLessThan(15);
    expect(observations[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 45000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createCcilAdapter({ executablePath, headless: true });
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 45000);
});
