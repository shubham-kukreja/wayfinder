import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { DEFAULT_PARAMS } from "@wayfinder/engine";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { computeAutoScoreCells } from "../src/pipeline/scoreCells.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function seedMonthlySeries(seriesId: string, source: string, values: number[], startYear = 2020, startMonth = 1) {
  const rows = values.map((value, i) => {
    const monthIdx = startMonth - 1 + i;
    const year = startYear + Math.floor(monthIdx / 12);
    const month = (monthIdx % 12) + 1;
    return {
      seriesId,
      date: `${year}-${String(month).padStart(2, "0")}-01`,
      value,
      basis: null,
      source,
      fetchedAt: "2026-09-03T00:00:00Z",
    };
  });
  insertObservations(db, rows);
}

describe("computeAutoScoreCells — §7 cells computable from live-fetchable series", () => {
  it("returns insufficient_history / neutral 50 for cells with no data at all", () => {
    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const equityFlows = results.find((r) => r.scoreId === "l1.equity::flows")!;
    expect(equityFlows.status).toBe("insufficient_history");
    expect(equityFlows.value).toBe(50); // §1 invariant 4: missing signal scores 50, never a guess
  });

  it("l1.equity::flows: high relative inflow scores LOW (inverted — crowded is not attractive)", () => {
    // 30 months of flow/AUM ratio, ramping up; the latest is the highest
    // ever seen -> should score near 0 after inversion.
    const flows = Array.from({ length: 30 }, (_, i) => 1000 + i * 50);
    const aum = Array.from({ length: 30 }, () => 100000);
    seedMonthlySeries("flow_equity_3m", "AMFI", flows);
    seedMonthlySeries("aum_equity", "AMFI", aum);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const result = results.find((r) => r.scoreId === "l1.equity::flows")!;
    expect(result.status).toBe("ok");
    expect(result.value).toBeLessThan(10); // near the top of the raw range -> inverted to near 0
  });

  it("metals.gold::ratio_position vs metals.silver::ratio_position: same input, opposite transform", () => {
    const gold = Array.from({ length: 30 }, (_, i) => 5000 + i * 10);
    const silver = Array.from({ length: 30 }, () => 60); // flat, so ratio tracks gold's percentile directly
    seedMonthlySeries("gold_inr", "IBJA", gold);
    seedMonthlySeries("silver_inr", "IBJA", silver);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const goldRatio = results.find((r) => r.scoreId === "metals.gold::ratio_position")!;
    const silverRatio = results.find((r) => r.scoreId === "metals.silver::ratio_position")!;

    expect(goldRatio.status).toBe("ok");
    expect(silverRatio.status).toBe("ok");
    // Same underlying ratio series, inverted vs as-is -> should sum close to 100.
    expect(goldRatio.value + silverRatio.value).toBeCloseTo(100, 0);
  });

  it("real-rates rubric cells (§8.4) are included when us_real_10y has history", () => {
    const rates = Array.from({ length: 30 }, () => 1.5);
    // Sharp 6-month decline at the end.
    for (let i = 24; i < 30; i++) rates[i] = 1.5 - ((i - 24) / 6) * 0.8;
    // 30 monthly observations starting 2020-01 -> the last (index 29) lands
    // on 2022-06-01; asOfDate must match where the data actually ends.
    seedMonthlySeries("us_real_10y", "FRED", rates);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2022-06-01");
    const goldRealRates = results.find((r) => r.scoreId === "metals.gold::real_rates");
    expect(goldRealRates).toBeDefined();
    expect(goldRealRates!.value).toBe(75); // §8.4: < -50bp -> gold 75
  });

  it("derivedFrom is populated for every cell (provenance must be traceable)", () => {
    seedMonthlySeries("gold_inr", "IBJA", Array.from({ length: 30 }, (_, i) => 5000 + i));
    seedMonthlySeries("silver_inr", "IBJA", Array.from({ length: 30 }, () => 60));
    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    for (const r of results) {
      expect(r.derivedFrom.length).toBeGreaterThan(0);
    }
  });
});
