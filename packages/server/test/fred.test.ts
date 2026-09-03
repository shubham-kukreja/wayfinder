import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { createFredAdapter, FredConfigError, FRED_SERIES } from "../src/adapters/fred.js";

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

    const adapter = createFredAdapter({ apiKey: "test-key", series: FRED_SERIES });
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

    const adapter = createFredAdapter({ apiKey: "test-key", series: FRED_SERIES });
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
