import { describe, expect, it } from "vitest";
import { createYahooMetalsAdapter, fetchGoldEtfSharesOutstanding } from "../src/adapters/yahooMetals.js";

// LIVE test — actually hits Yahoo Finance's chart endpoint (no auth) and
// the crumb-gated quote endpoint (GLD/IAU sharesOutstanding). Skipped by
// default; run explicitly with RUN_LIVE_TESTS=1.
const shouldRun = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!shouldRun)("Yahoo metals adapter — live against query1.finance.yahoo.com", () => {
  it("fetchLatest() returns real gold/silver futures + ETF shares outstanding observations", async () => {
    const adapter = createYahooMetalsAdapter();
    const observations = await adapter.fetchLatest();
    expect(observations.length).toBeGreaterThanOrEqual(2);
    const gold = observations.find((o) => o.seriesId === "gold_usd_futures");
    const silver = observations.find((o) => o.seriesId === "silver_usd_futures");
    const etf = observations.find((o) => o.seriesId === "gold_etf_shares_outstanding");
    expect(gold?.value).toBeGreaterThan(500); // COMEX gold futures, sane USD/oz floor
    expect(silver?.value).toBeGreaterThan(5); // COMEX silver futures, sane USD/oz floor
    expect(etf?.value).toBeGreaterThan(0);
  }, 20000);

  it("fetchHistory() returns real multi-year daily history for both futures series", async () => {
    const adapter = createYahooMetalsAdapter();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 2);
    const observations = await adapter.fetchHistory(from, new Date());
    const gold = observations.filter((o) => o.seriesId === "gold_usd_futures");
    // 2 years of trading days is ~500 — a loose floor that still proves
    // this is real daily history, not a handful of sparse points.
    expect(gold.length).toBeGreaterThan(200);
  }, 20000);

  it("fetchGoldEtfSharesOutstanding() returns a real combined GLD+IAU figure", async () => {
    const total = await fetchGoldEtfSharesOutstanding();
    expect(total).toBeGreaterThan(100_000_000); // both ETFs combined are well over 100M shares
  }, 20000);

  it("health() reports ok:true against the live source", async () => {
    const adapter = createYahooMetalsAdapter();
    const health = await adapter.health();
    expect(health.ok).toBe(true);
  }, 20000);
});
