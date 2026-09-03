import { describe, expect, it } from "vitest";
import { createRbiAdapter } from "../src/adapters/rbi.js";

// LIVE test — actually drives the dbie.rbihub.in mirror with a real headless
// browser. Not mocked, unlike the FRED/bullion adapter tests, because the
// entire risk in this adapter is DOM/selector drift on a third-party site
// that was live-verified 2026-09-03 but explicitly documents itself as a
// scraped, unofficial mirror with no SLA. A mock would only prove the
// adapter's own logic is internally consistent, not that it still matches
// reality — which is the actual risk here.
//
// Skipped by default (requires network + a real Chromium binary) so the
// regular `pnpm test` run stays fast and hermetic; run explicitly with
// RUN_LIVE_TESTS=1 and CHROMIUM_EXECUTABLE_PATH set.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;

describe.skipIf(!shouldRun)("RBI adapter — live against dbie.rbihub.in", () => {
  it("scrapes cpi_index and cpi_yoy with real historical observations", async () => {
    const adapter = createRbiAdapter({ executablePath, headless: true });
    const observations = await adapter.fetchLatest();

    const bySeries = new Map<string, typeof observations>();
    for (const o of observations) {
      if (!bySeries.has(o.seriesId)) bySeries.set(o.seriesId, []);
      bySeries.get(o.seriesId)!.push(o);
    }

    expect(bySeries.has("cpi_index")).toBe(true);
    expect(bySeries.has("cpi_yoy")).toBe(true);

    const cpiIndex = bySeries.get("cpi_index")![0]!;
    expect(cpiIndex.value).toBeGreaterThan(50); // CPI index, base ~100
    expect(cpiIndex.value).toBeLessThan(200);
    expect(cpiIndex.date).toMatch(/^\d{4}-\d{2}-01$/);
  }, 60000);

  it("scrapes tbill_1y from the treasury-bills yield page (no select controls, different date format)", async () => {
    const adapter = createRbiAdapter({ executablePath, headless: true });
    const observations = await adapter.fetchLatest();

    const tbill = observations.find((o) => o.seriesId === "tbill_1y");
    expect(tbill).toBeDefined();
    expect(tbill!.value).toBeGreaterThan(0); // real yield %, not a price/index magnitude
    expect(tbill!.value).toBeLessThan(20);
    expect(tbill!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // already a full date on this page, no "-01" append needed
  }, 60000);

  it("health() reports ok:true against the live mirror", async () => {
    const adapter = createRbiAdapter({ executablePath, headless: true });
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 60000);
});
