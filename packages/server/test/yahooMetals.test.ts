import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createYahooMetalsAdapter, parseChartObservations, YahooMetalsFetchError } from "../src/adapters/yahooMetals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture() {
  return JSON.parse(readFileSync(join(fixturesDir, "yahoo_chart_gcf_sample.json"), "utf-8"));
}

// §10.8 — Yahoo metals adapter: gold/silver USD futures history (a
// backfill fix for metals.gold/silver::ratio_position, which was stuck at
// insufficient_history because metals.dev/IBJA has no historical range
// endpoint) plus gold ETF shares outstanding (a flow proxy). This fixture
// is a trimmed real v8/finance/chart response for GC=F captured live
// 2026-09-15, including a null close (a non-trading-day gap) to verify
// it's dropped rather than guessed.
describe("Yahoo metals adapter — chart parsing", () => {
  it("parses timestamp+close pairs into observations, converting unix seconds to ISO dates", () => {
    const observations = parseChartObservations(loadFixture(), "gold_usd_futures");
    expect(observations).toEqual([
      { seriesId: "gold_usd_futures", date: "2026-09-09", value: 4416.0, raw: { timestamp: 1788926400, symbol: "gold_usd_futures" } },
      { seriesId: "gold_usd_futures", date: "2026-09-10", value: 4364.5, raw: { timestamp: 1789012800, symbol: "gold_usd_futures" } },
      { seriesId: "gold_usd_futures", date: "2026-09-14", value: 4343.7998046875, raw: { timestamp: 1789358400, symbol: "gold_usd_futures" } },
    ]);
  });

  it("drops a null close (non-trading day) instead of guessing a value", () => {
    const observations = parseChartObservations(loadFixture(), "gold_usd_futures");
    expect(observations.length).toBe(3); // 4 timestamps, 1 null close dropped
  });

  it("throws honestly when the chart response carries an error", () => {
    const errorResponse = { chart: { result: null, error: { code: "Not Found", description: "No data found" } } };
    expect(() => parseChartObservations(errorResponse as any, "gold_usd_futures")).toThrow(YahooMetalsFetchError);
  });

  it("throws honestly when the response has no result at all", () => {
    const emptyResponse = { chart: { result: [], error: null } };
    expect(() => parseChartObservations(emptyResponse as any, "gold_usd_futures")).toThrow(/no result/i);
  });

  it("declares its three series (gold/silver USD futures + gold ETF shares outstanding)", () => {
    const adapter = createYahooMetalsAdapter();
    expect(adapter.series).toEqual(["gold_usd_futures", "silver_usd_futures", "gold_etf_shares_outstanding"]);
  });
});
