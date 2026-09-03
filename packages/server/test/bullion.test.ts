import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { createBullionAdapter, BullionConfigError, BULLION_SERIES, lastBusinessDay } from "../src/adapters/bullion.js";

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

describe("lastBusinessDay — IBJA weekend/holiday fallback (§15.9)", () => {
  it("Saturday rolls back to Friday", () => {
    const sat = new Date("2026-09-05T00:00:00Z"); // a Saturday
    expect(lastBusinessDay(sat).getDay()).toBe(5);
  });

  it("Sunday rolls back to Friday", () => {
    const sun = new Date("2026-09-06T00:00:00Z"); // a Sunday
    expect(lastBusinessDay(sun).getDay()).toBe(5);
  });

  it("a weekday is unchanged", () => {
    const wed = new Date("2026-09-02T00:00:00Z"); // a Wednesday
    expect(lastBusinessDay(wed).getDay()).toBe(3);
  });
});

describe("Bullion adapter — config", () => {
  it("throws BullionConfigError when no API key is set", async () => {
    const adapter = createBullionAdapter({ apiKey: undefined, series: BULLION_SERIES });
    await expect(adapter.fetchLatest()).rejects.toThrow(BullionConfigError);
  });

  it("fetchHistory is a deliberate no-op pointing at the backfill path, not a silent partial", async () => {
    const adapter = createBullionAdapter({ apiKey: "test-key", series: BULLION_SERIES });
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/backfill/);
  });
});

describe("Bullion adapter — parsing", () => {
  it("fetchLatest maps gold and silver prices to their internal series IDs", async () => {
    const client = mockAgent.get("https://api.metals.dev");
    client
      .intercept({ path: /\/v1\/latest.*/, method: "GET" })
      .reply(
        200,
        {
          status: "success",
          currency: "INR",
          unit: "g",
          metals: { gold: 7250.5, silver: 91.3 },
          timestamp: "2026-09-03T05:00:00Z",
        },
        { headers: { "content-type": "application/json" } }
      );

    const adapter = createBullionAdapter({ apiKey: "test-key", series: BULLION_SERIES });
    const observations = await adapter.fetchLatest();

    expect(observations).toHaveLength(2);
    const bySeries = Object.fromEntries(observations.map((o) => [o.seriesId, o.value]));
    expect(bySeries["gold_inr"]).toBe(7250.5);
    expect(bySeries["silver_inr"]).toBe(91.3);
  });

  it("throws a descriptive error on non-200 response", async () => {
    const client = mockAgent.get("https://api.metals.dev");
    client.intercept({ path: /\/v1\/latest.*/, method: "GET" }).reply(429, "Rate limit exceeded");

    const adapter = createBullionAdapter({ apiKey: "test-key", series: BULLION_SERIES });
    await expect(adapter.fetchLatest()).rejects.toThrow(/metals\.dev request failed \(429\)/);
  });
});
