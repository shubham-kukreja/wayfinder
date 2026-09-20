import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { createFredAdapter, checkFredSeriesFreshness, FredConfigError, FRED_SERIES } from "../src/adapters/fred.js";

// Parsing tests use a single-series config rather than the real,
// multi-series FRED_SERIES constant — each MockAgent interceptor here
// handles exactly one request, and the adapter fires one request per
// configured series, so testing parsing logic in isolation doesn't need
// to know how many real series are configured.
const SINGLE_SERIES = [{ fredSeriesId: "DFII10", internalSeriesId: "us_real_10y" }];

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
});

describe("FRED adapter — config", () => {
  it("throws FredConfigError when no API key is set, rather than silently failing", async () => {
    const adapter = createFredAdapter({ apiKey: undefined, series: FRED_SERIES });
    await expect(adapter.fetchLatest()).rejects.toThrow(FredConfigError);
  });

  it("health() reports ok:false with a clear message when the key is missing", async () => {
    const adapter = createFredAdapter({ apiKey: undefined, series: FRED_SERIES });
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toMatch(/FRED_API_KEY/);
  });
});

describe("FRED adapter — parsing", () => {
  it("fetchHistory parses observations and filters FRED's '.' missing-value sentinel", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(
        200,
        {
          observations: [
            { date: "2026-06-01", value: "1.85" },
            { date: "2026-06-02", value: "." }, // missing observation
            { date: "2026-06-03", value: "1.90" },
          ],
        },
        { headers: { "content-type": "application/json" } }
      );

    const adapter = createFredAdapter({ apiKey: "test-key", series: SINGLE_SERIES });
    const observations = await adapter.fetchHistory(new Date("2026-06-01"), new Date("2026-06-03"));

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ seriesId: "us_real_10y", date: "2026-06-01", value: 1.85 });
    expect(observations[1]).toMatchObject({ seriesId: "us_real_10y", date: "2026-06-03", value: 1.9 });
  });

  it("fetchLatest returns only the most recent observation per series", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(
        200,
        {
          observations: [
            { date: "2026-06-01", value: "1.85" },
            { date: "2026-06-15", value: "2.10" },
          ],
        },
        { headers: { "content-type": "application/json" } }
      );

    const adapter = createFredAdapter({ apiKey: "test-key", series: SINGLE_SERIES });
    const observations = await adapter.fetchLatest();

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ date: "2026-06-15", value: 2.1 });
  });

  it("throws a descriptive error on non-200 response", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(400, "Bad Request. Variable api_key is not a 32 character alpha-numeric lower-case string.");

    const adapter = createFredAdapter({ apiKey: "bad-key", series: FRED_SERIES });
    await expect(adapter.fetchHistory(new Date("2026-06-01"), new Date("2026-06-03"))).rejects.toThrow(/FRED request failed \(400\)/);
  });
});

describe("FRED adapter — per-series lookbackDays", () => {
  it("fetchLatest uses a series' own lookbackDays instead of the 90-day default, so a series meant to stay live isn't silently dropped by a real-world publication lag", async () => {
    let capturedStart: string | null = null;
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply((req) => {
        const url = new URL(`https://api.stlouisfed.org${req.path}`);
        capturedStart = url.searchParams.get("observation_start");
        return { statusCode: 200, data: { observations: [{ date: "2026-07-01", value: "6.78" }] }, responseOptions: { headers: { "content-type": "application/json" } } };
      });

    const adapter = createFredAdapter({
      apiKey: "test-key",
      series: [{ fredSeriesId: "INDIRLTLT01STM", internalSeriesId: "gsec_10y", lookbackDays: 180 }],
    });
    await adapter.fetchLatest();

    const expectedStart = new Date();
    expectedStart.setDate(expectedStart.getDate() - 180);
    expect(capturedStart).toBe(expectedStart.toISOString().slice(0, 10));
  });

  it("fetchLatest falls back to the 90-day default when a series declares no lookbackDays", async () => {
    let capturedStart: string | null = null;
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply((req) => {
        const url = new URL(`https://api.stlouisfed.org${req.path}`);
        capturedStart = url.searchParams.get("observation_start");
        return { statusCode: 200, data: { observations: [] }, responseOptions: { headers: { "content-type": "application/json" } } };
      });

    const adapter = createFredAdapter({ apiKey: "test-key", series: [{ fredSeriesId: "DFII10", internalSeriesId: "us_real_10y" }] });
    await adapter.fetchLatest();

    const expectedStart = new Date();
    expectedStart.setDate(expectedStart.getDate() - 90);
    expect(capturedStart).toBe(expectedStart.toISOString().slice(0, 10));
  });
});

describe("checkFredSeriesFreshness — per-series staleness, distinct from adapter reachability", () => {
  it("flags a series as stale when its latest observation is older than its own staleWarningDays", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(200, { observations: [{ date: "2026-01-01", value: "6.5" }] }, { headers: { "content-type": "application/json" } });

    const result = await checkFredSeriesFreshness({
      apiKey: "test-key",
      series: [{ fredSeriesId: "INDIRLTLT01STM", internalSeriesId: "gsec_10y", lookbackDays: 365, staleWarningDays: 60 }],
    });

    expect(result).toEqual([{ internalSeriesId: "gsec_10y", latestDate: "2026-01-01", stale: true }]);
  });

  it("does not flag a deliberately backfill-only series whose staleWarningDays is configured wide enough to never trip", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(200, { observations: [{ date: "2025-03-01", value: "150" }] }, { headers: { "content-type": "application/json" } });

    const result = await checkFredSeriesFreshness({
      apiKey: "test-key",
      series: [{ fredSeriesId: "INDCPIALLMINMEI", internalSeriesId: "cpi_index", staleWarningDays: 99999 }],
    });

    expect(result).toEqual([{ internalSeriesId: "cpi_index", latestDate: "2025-03-01", stale: false }]);
  });

  it("flags a series as stale when it returns no observations at all within its lookback window", async () => {
    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(200, { observations: [] }, { headers: { "content-type": "application/json" } });

    const result = await checkFredSeriesFreshness({
      apiKey: "test-key",
      series: [{ fredSeriesId: "INDIRLTLT01STM", internalSeriesId: "gsec_10y" }],
    });

    expect(result).toEqual([{ internalSeriesId: "gsec_10y", latestDate: null, stale: true }]);
  });
});
