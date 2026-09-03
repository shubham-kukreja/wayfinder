import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { migrate } from "../src/store/schema.js";
import { insertObservations, seriesCoverage } from "../src/store/observations.js";
import { createFredAdapter } from "../src/adapters/fred.js";
import { deriveRealRatesScores, usReal10y6mChangeBp } from "../src/pipeline/derive.js";

// This test specifically gates the DFII10 -> us_real_10y path (§8.4), so
// it uses a single-series config rather than the real FRED_SERIES
// constant, which now also includes gsec_10y.
const DFII10_ONLY = [{ fredSeriesId: "DFII10", internalSeriesId: "us_real_10y" }];

let db: Database.Database;
let mockAgent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  db.close();
  setGlobalDispatcher(originalDispatcher);
});

// M2 acceptance criterion: "DFII10 backfilled 20 years; metals.*::real_rates
// computes end-to-end from a live fetch."
describe("M2 — FRED backfill -> store -> metals.*::real_rates end-to-end", () => {
  it("backfills 20 years of monthly observations and derives real-rate scores with no manual step", async () => {
    // Simulate 20 years of monthly DFII10 observations, ending with a
    // sharp 6-month decline (real rates falling -> should favour gold/silver).
    const rows: Array<{ date: string; value: string }> = [];
    const start = new Date("2006-09-01");
    for (let i = 0; i < 240; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const date = monthEnd.toISOString().slice(0, 10);
      // Flat around 1.5% until the final 6 months, then a sharp drop to 0.7%.
      const isRecentSix = i >= 234;
      const value = isRecentSix ? (1.5 - ((i - 234) / 6) * 0.8).toFixed(2) : "1.50";
      rows.push({ date, value });
    }

    const client = mockAgent.get("https://api.stlouisfed.org");
    client
      .intercept({ path: /\/fred\/series\/observations.*/, method: "GET" })
      .reply(200, { observations: rows }, { headers: { "content-type": "application/json" } });

    const adapter = createFredAdapter({ apiKey: "test-key", series: DFII10_ONLY });
    const observations = await adapter.fetchHistory(new Date("2006-09-01"), new Date("2026-09-01"));

    expect(observations.length).toBe(240);

    const fetchedAt = "2026-09-03T06:00:00Z";
    const written = insertObservations(
      db,
      observations.map((o) => ({
        seriesId: o.seriesId,
        date: o.date,
        value: o.value,
        basis: null,
        source: "FRED",
        fetchedAt,
      }))
    );
    expect(written).toBe(240);

    const coverage = seriesCoverage(db, "us_real_10y");
    expect(coverage.observations).toBe(240); // 20 years of monthly data

    const changeBp = usReal10y6mChangeBp(db, "2026-09-01");
    expect(changeBp).not.toBeNull();
    expect(changeBp!).toBeLessThan(-50); // sharp decline -> should hit the "< -50bp" rubric bucket

    const scores = deriveRealRatesScores(db, "2026-09-01");
    expect(scores).not.toBeNull();
    expect(scores!["metals.gold::real_rates"]).toBe(75); // §8.4 table: < -50bp -> gold 75
    expect(scores!["metals.silver::real_rates"]).toBe(65); // §8.4 table: < -50bp -> silver 65
    expect(scores!["l1.metals::macro"]).toBe(75);
  });

  it("returns null (not a guess) when the series has no history in the store", () => {
    const scores = deriveRealRatesScores(db, "2026-09-01");
    expect(scores).toBeNull();
  });
});
