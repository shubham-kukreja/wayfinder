import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTradingEconomicsAdapter,
  parsePmiFromMetaDescription,
  TradingEconomicsFetchError,
} from "../src/adapters/tradingEconomics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture(name: string) {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// §10.7 — TradingEconomics adapter, the global_mfg_pmi proxy for
// silverIndustrialScore (§8.8). Confirmed live 2026-09-15 that FRED
// carries no PMI data at all (see file-level comment in
// adapters/tradingEconomics.ts) and that tradingeconomics.com serves the
// real current headline figure in an unauthenticated <meta
// name="description"> tag. These fixtures are trimmed real page excerpts
// captured live that same day.
describe("TradingEconomics adapter — parses China PMI from the meta description tag", () => {
  it("parses the 'increased/decreased to X ... from Y ...' phrasing with a distinct prior month", () => {
    const reading = parsePmiFromMetaDescription(loadFixture("te_china_pmi_sample.html"));
    expect(reading).toEqual({ latest: 51.5, prior: 50.9, latestMonth: "August", priorMonth: "July" });
  });

  it("parses the 'remained unchanged at X' phrasing (no distinct prior month named)", () => {
    const reading = parsePmiFromMetaDescription(loadFixture("te_us_pmi_unchanged_sample.html"));
    expect(reading).toEqual({ latest: 53.9, prior: 53.9, latestMonth: "August", priorMonth: null });
  });

  it("throws honestly when the meta description tag is missing (layout changed)", () => {
    expect(() => parsePmiFromMetaDescription("<html><head></head><body>no meta here</body></html>")).toThrow(
      TradingEconomicsFetchError
    );
  });

  it("throws honestly when the description text doesn't match either known phrasing", () => {
    const html = '<meta id="metaDesc" name="description" content="Some unexpected new phrasing entirely." />';
    expect(() => parsePmiFromMetaDescription(html)).toThrow(/didn't match either known PMI phrasing/);
  });

  it("declares its one series (global_mfg_pmi, sourced from China as the project's chosen global proxy)", () => {
    const adapter = createTradingEconomicsAdapter();
    expect(adapter.series).toEqual(["global_mfg_pmi"]);
  });

  it("fetchHistory() throws honestly — no historical range endpoint on the free page", async () => {
    const adapter = createTradingEconomicsAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical range/i);
  });
});
