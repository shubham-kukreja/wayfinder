import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateForwardPe,
  createYahooAdapter,
  extractTickersFromConstituentsTable,
  parseSp500TickersFromWikipediaHtml,
  YahooFetchError,
} from "../src/adapters/yahoo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixtureHtml() {
  return readFileSync(join(fixturesDir, "sp500_wikipedia_sample.html"), "utf-8");
}

// §10.6 — Yahoo adapter for S&P 500 Forward P/E. Confirmed live 2026-09-15
// that ^GSPC itself has no forwardPE field on Yahoo's quoteSummary — this
// adapter aggregates it from constituent-level forwardPE + marketCap
// instead. This fixture is a trimmed real Wikipedia table (5 of the ~500
// real rows, captured live), just enough to test the extraction regex —
// the "< 400 tickers" completeness guard is tested separately since a
// trimmed fixture would otherwise trip it.
describe("Yahoo adapter — S&P 500 constituent list + forward P/E aggregation", () => {
  it("extracts real ticker symbols from the Wikipedia constituents table", () => {
    const tickers = extractTickersFromConstituentsTable(loadFixtureHtml());
    expect(tickers).toEqual(["MMM", "AOS", "ABT", "ABBV", "ACN"]);
  });

  it("throws honestly when the constituents table is missing (layout changed)", () => {
    expect(() => extractTickersFromConstituentsTable("<html><body>no table here</body></html>")).toThrow(YahooFetchError);
  });

  it("parseSp500TickersFromWikipediaHtml rejects a suspiciously small extraction (< 400) rather than silently proceeding", () => {
    // The real fixture only has 5 rows (trimmed) — this should trip the
    // completeness guard, same as it would on a genuinely broken live page.
    expect(() => parseSp500TickersFromWikipediaHtml(loadFixtureHtml())).toThrow(/expected ~500/);
  });

  it("aggregateForwardPe computes a weighted-harmonic-mean forward P/E across constituents", () => {
    // Two constituents: forward earnings = marketCap / forwardPE for each,
    // aggregate P/E = total marketCap / total forward earnings.
    const quotes = [
      { symbol: "A", forwardPE: 20, marketCap: 2000 }, // forward earnings = 100
      { symbol: "B", forwardPE: 10, marketCap: 1000 }, // forward earnings = 100
    ];
    // total marketCap 3000, total forward earnings 200 -> 15
    expect(aggregateForwardPe(quotes)).toBe(15);
  });

  it("drops constituents missing forwardPE or marketCap rather than guessing", () => {
    const quotes = [
      { symbol: "A", forwardPE: 20, marketCap: 2000 },
      { symbol: "B", marketCap: 1000 }, // no forwardPE
      { symbol: "C", forwardPE: 15 }, // no marketCap
    ];
    // Only A counted: forward earnings = 100, marketCap = 2000 -> P/E 20
    expect(aggregateForwardPe(quotes)).toBe(20);
  });

  it("throws when no constituent has both fields (cannot aggregate anything)", () => {
    expect(() => aggregateForwardPe([{ symbol: "A", marketCap: 1000 }])).toThrow(YahooFetchError);
  });

  it("declares its one series (sp500_fwd_pe)", () => {
    const adapter = createYahooAdapter();
    expect(adapter.series).toEqual(["sp500_fwd_pe"]);
  });

  it("fetchHistory() throws honestly — no historical constituent-level source exists", async () => {
    const adapter = createYahooAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical/i);
  });
});
