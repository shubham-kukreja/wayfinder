import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import {
  createTradingEconomicsAdapter,
  parsePmiFromMetaDescription,
  parseCpiFromMetaDescription,
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

  it("declares both series (global_mfg_pmi from China as the global proxy; cpi_yoy from India)", () => {
    const adapter = createTradingEconomicsAdapter();
    expect(adapter.series).toEqual(["global_mfg_pmi", "cpi_yoy"]);
  });

  // TE phrases an index level in "points" and a rate in "percent". The
  // unit is matched explicitly rather than accepted as any trailing word:
  // it is the one token distinguishing 4.82 percent from a 104.84 index
  // level, and silently ingesting the wrong one would corrupt cpi_yoy far
  // more quietly than a thrown parse error.
  it("parses India CPI YoY in percent from a real captured page excerpt", () => {
    const reading = parseCpiFromMetaDescription(loadFixture("te_india_cpi_sample.html"));
    expect(reading).toEqual({ latest: 4.82, prior: 4.44, latestMonth: "August", priorMonth: "July" });
  });

  it("refuses a percent-phrased page when parsing for points, and vice versa", () => {
    const cpiHtml = loadFixture("te_india_cpi_sample.html");
    expect(() => parsePmiFromMetaDescription(cpiHtml)).toThrow(/didn't match either known PMI phrasing/);
    const pmiHtml = loadFixture("te_china_pmi_sample.html");
    expect(() => parseCpiFromMetaDescription(pmiHtml)).toThrow(/didn't match either known inflation rate phrasing/);
  });

  it("fetchHistory() throws honestly — no historical range endpoint on the free page", async () => {
    const adapter = createTradingEconomicsAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical range/i);
  });
});

// fetchLatest() must persist the PRIOR month too, not just the latest.
// fetchHistory() throws by design, so repeated fetchLatest calls are the
// only way this series ever accumulates history — and silverIndustrialScore
// (§8.8) needs two distinct months to answer its "> 52 AND rising" bucket.
describe("TradingEconomics adapter — fetchLatest persists both months", () => {
  let mockAgent: MockAgent;
  let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
    vi.useRealTimers();
  });

  const mockPage = (path: string, content: string) => {
    mockAgent
      .get("https://tradingeconomics.com")
      .intercept({ path, method: "GET" })
      .reply(200, `<meta id="metaDesc" name="description" content="${content}" />`, {
        headers: { "content-type": "text/html" },
      });
  };

  // The adapter now fetches two independent pages per run. These tests
  // assert on the PMI half, so the CPI page is stubbed with a valid
  // reading and its observations filtered out — leaving it unmocked would
  // make every assertion below depend on allSettled's failure path rather
  // than on the PMI parsing actually under test.
  const CPI_STUB = "Inflation Rate in India increased to 4.82 percent in August from 4.44 percent in July of 2026.";
  const mockPmiPage = (content: string) => {
    mockPage("/china/manufacturing-pmi", content);
    mockPage("/india/inflation-cpi", CPI_STUB);
  };
  const pmiOnly = <T extends { seriesId: string }>(observations: T[]): T[] =>
    observations.filter((o) => o.seriesId === "global_mfg_pmi");

  it("writes two dated observations when the page names a distinct prior month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
    mockPmiPage("The Manufacturing PMI increased to 51.5 points in August from 50.9 points in July of 2026.");

    const observations = pmiOnly(await createTradingEconomicsAdapter().fetchLatest());

    expect(observations.map((o) => ({ date: o.date, value: o.value }))).toEqual([
      { date: "2026-08-01", value: 51.5 },
      { date: "2026-07-01", value: 50.9 },
    ]);
  });

  it("writes only ONE observation for the 'remained unchanged' phrasing — no prior month to date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
    mockPmiPage("The Manufacturing PMI remained unchanged at 53.9 points in August.");

    const observations = pmiOnly(await createTradingEconomicsAdapter().fetchLatest());

    // reading.prior is just a copy of latest here; writing it as its own
    // dated observation would invent a month the source never reported.
    expect(observations).toHaveLength(1);
    expect(observations[0]!.date).toBe("2026-08-01");
  });

  it("dates a December prior month to the PREVIOUS year when the latest month is January", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-20T00:00:00Z"));
    mockPmiPage("The Manufacturing PMI increased to 52.0 points in January from 51.1 points in December of 2026.");

    const observations = pmiOnly(await createTradingEconomicsAdapter().fetchLatest());

    expect(observations.map((o) => o.date)).toEqual(["2027-01-01", "2026-12-01"]);
  });

  // §8.1 — the CPI half. Added 2026-09-19 because both existing cpi_yoy
  // sources had gone stale (RBI's mirror ends 2026-03, FRED's series
  // 2025-03) and the Control Center was correctly flagging the series,
  // and every cell reading it, as stale.
  it("writes cpi_yoy observations for both months from the inflation page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
    mockPage("/china/manufacturing-pmi", "The Manufacturing PMI increased to 51.5 points in August from 50.9 points in July of 2026.");
    mockPage("/india/inflation-cpi", CPI_STUB);

    const observations = (await createTradingEconomicsAdapter().fetchLatest()).filter((o) => o.seriesId === "cpi_yoy");

    expect(observations.map((o) => ({ date: o.date, value: o.value }))).toEqual([
      { date: "2026-08-01", value: 4.82 },
      { date: "2026-07-01", value: 4.44 },
    ]);
  });

  // The two pages are independent indicators on independent URLs; one
  // being down must not silently discard the other's real reading.
  it("still returns PMI observations when the CPI page fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
    mockPage("/china/manufacturing-pmi", "The Manufacturing PMI increased to 51.5 points in August from 50.9 points in July of 2026.");
    mockAgent.get("https://tradingeconomics.com").intercept({ path: "/india/inflation-cpi", method: "GET" }).reply(503, "upstream down");

    const observations = await createTradingEconomicsAdapter().fetchLatest();
    expect(observations.every((o) => o.seriesId === "global_mfg_pmi")).toBe(true);
    expect(observations).toHaveLength(2);
  });

  it("still returns cpi_yoy observations when the PMI page fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
    mockAgent.get("https://tradingeconomics.com").intercept({ path: "/china/manufacturing-pmi", method: "GET" }).reply(503, "upstream down");
    mockPage("/india/inflation-cpi", CPI_STUB);

    const observations = await createTradingEconomicsAdapter().fetchLatest();
    expect(observations.every((o) => o.seriesId === "cpi_yoy")).toBe(true);
    expect(observations).toHaveLength(2);
  });

  it("throws only when BOTH pages fail", async () => {
    mockAgent.get("https://tradingeconomics.com").intercept({ path: "/china/manufacturing-pmi", method: "GET" }).reply(503, "down");
    mockAgent.get("https://tradingeconomics.com").intercept({ path: "/india/inflation-cpi", method: "GET" }).reply(503, "down");

    await expect(createTradingEconomicsAdapter().fetchLatest()).rejects.toThrow(/Both TradingEconomics pages failed/);
  });
});
