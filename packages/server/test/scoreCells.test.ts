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

  it("l1.metals::fundamentals is computable end-to-end once BOTH cbBuying and etfHoldings derive (Calculation Guide row 23)", () => {
    // cbBuying = 'above_average': flat reserves for 60 months, sharp
    // recent-12M acceleration (+50 tonnes/month).
    let level = 30000;
    const reserves: number[] = [];
    for (let i = 0; i < 60; i++) {
      reserves.push(level);
      level += 1;
    }
    for (let i = 0; i < 12; i++) {
      level += 50;
      reserves.push(level);
    }
    for (let i = 0; i < 72; i++) {
      const year = 2020 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      seedMonthlySeries("cb_gold_reserves_tonnes", "DBNOMICS", [reserves[i]!], year, month);
    }

    // etfHoldings = 'rising': current sharesOutstanding higher than ~3
    // months ago.
    seedMonthlySeries("gold_etf_shares_outstanding", "YAHOO_METALS", [1_100_000_000], 2026, 6);
    seedMonthlySeries("gold_etf_shares_outstanding", "YAHOO_METALS", [1_200_000_000], 2026, 9);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-15");
    const fundamentals = results.find((r) => r.scoreId === "l1.metals::fundamentals");
    expect(fundamentals).toBeDefined();
    expect(fundamentals!.status).toBe("ok");
    expect(fundamentals!.derivedFrom).toEqual(["cb_gold_reserves_tonnes", "gold_etf_shares_outstanding"]);
    // metalsFundamentalsScore: start 50, above_average cbBuying +15,
    // rising etfHoldings +10 -> 75.
    expect(fundamentals!.value).toBe(75);
  });

  it("l1.metals::fundamentals is NOT included when only one of cbBuying/etfHoldings can be derived (never guess the other half)", () => {
    // Only seed enough for etfHoldings to derive — no cb_gold_reserves_tonnes at all.
    seedMonthlySeries("gold_etf_shares_outstanding", "YAHOO_METALS", [1_100_000_000], 2026, 6);
    seedMonthlySeries("gold_etf_shares_outstanding", "YAHOO_METALS", [1_200_000_000], 2026, 9);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-15");
    expect(results.some((r) => r.scoreId === "l1.metals::fundamentals")).toBe(false);
  });

  it("l1.equity::momentum is computable end-to-end (Calculation Guide row 11: Nifty 50 TRI 12M% minus gsec_10y, percentiled)", () => {
    // Compounding (not linear) growth, accelerating over time: each
    // month's close is a FIXED % higher than the prior month, so the
    // trailing-12M % return itself trends upward across the series
    // (a linear/arithmetic ramp would produce a DECREASING 12M % return
    // over time, since the base grows while the absolute step stays
    // fixed — verified by hand before picking this shape). Flat div
    // yield and gsec yield so the trend is driven purely by price.
    let close = 15000;
    const closes = Array.from({ length: 42 }, () => {
      const v = close;
      close *= 1.01; // 1% compounding monthly growth
      return v;
    });
    seedMonthlySeries("nifty50_close", "NIFTYINDICES", closes);
    seedMonthlySeries("nifty50_div_yield", "NIFTYINDICES", Array.from({ length: 42 }, () => 1.2));
    seedMonthlySeries("gsec_10y", "FRED", Array.from({ length: 42 }, () => 6.75));

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2023-06-01");
    const momentum = results.find((r) => r.scoreId === "l1.equity::momentum")!;
    expect(momentum.status).toBe("ok");
    expect(momentum.derivedFrom).toEqual(["nifty50_close", "nifty50_div_yield", "gsec_10y"]);
    // asOfDate 2023-06-01 lands near the end of the seeded window (Jan
    // 2020 start, 42 months -> Jun 2023) -> near the top of its own
    // 12M-excess-return percentile history for a compounding series.
    expect(momentum.value).toBeGreaterThan(50);
  });

  it("sector.capgoods::valuation is computable once sector_pe_capgoods has history (niftyindices.ts, 2026-09-15 fix — nse.ts alone has no matching index)", () => {
    // High P/E ramping up -> near-top percentile -> inverted to near 0
    // (expensive is not attractive), same convention as the other 7
    // sector valuation cells.
    const pe = Array.from({ length: 30 }, (_, i) => 30 + i);
    seedMonthlySeries("sector_pe_capgoods", "NIFTYINDICES", pe);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const capgoods = results.find((r) => r.scoreId === "sector.capgoods::valuation")!;
    expect(capgoods.status).toBe("ok");
    expect(capgoods.value).toBeLessThan(10);
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

  it("metals.gold::ratio_position vs metals.silver::ratio_position: same input, opposite transform (IBJA fallback path)", () => {
    // No gold_usd_futures/silver_usd_futures seeded -> must fall back to
    // gold_inr/silver_inr (IBJA), proving the fallback path works when
    // the futures pair has no history yet.
    const gold = Array.from({ length: 30 }, (_, i) => 5000 + i * 10);
    const silver = Array.from({ length: 30 }, () => 60); // flat, so ratio tracks gold's percentile directly
    seedMonthlySeries("gold_inr", "IBJA", gold);
    seedMonthlySeries("silver_inr", "IBJA", silver);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const goldRatio = results.find((r) => r.scoreId === "metals.gold::ratio_position")!;
    const silverRatio = results.find((r) => r.scoreId === "metals.silver::ratio_position")!;

    expect(goldRatio.status).toBe("ok");
    expect(silverRatio.status).toBe("ok");
    expect(goldRatio.derivedFrom).toEqual(["gold_inr", "silver_inr"]);
    // Same underlying ratio series, inverted vs as-is -> should sum close to 100.
    expect(goldRatio.value + silverRatio.value).toBeCloseTo(100, 0);
  });

  it("metals.gold::ratio_position prefers gold_usd_futures/silver_usd_futures over IBJA once the futures pair has enough history", () => {
    // Seed BOTH pairs — futures pair meets the 24-observation floor,
    // IBJA pair also has data (so this proves preference, not just
    // fallback-when-empty). Distinguishable inputs let the assertion
    // confirm which pair actually drove the result.
    const goldFutures = Array.from({ length: 30 }, (_, i) => 2000 + i * 10);
    const silverFutures = Array.from({ length: 30 }, () => 25); // flat
    seedMonthlySeries("gold_usd_futures", "YAHOO_METALS", goldFutures);
    seedMonthlySeries("silver_usd_futures", "YAHOO_METALS", silverFutures);

    const goldIbja = Array.from({ length: 30 }, () => 5000); // flat -> would score very differently
    const silverIbja = Array.from({ length: 30 }, () => 60);
    seedMonthlySeries("gold_inr", "IBJA", goldIbja);
    seedMonthlySeries("silver_inr", "IBJA", silverIbja);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const goldRatio = results.find((r) => r.scoreId === "metals.gold::ratio_position")!;

    expect(goldRatio.status).toBe("ok");
    expect(goldRatio.derivedFrom).toEqual(["gold_usd_futures", "silver_usd_futures"]);
    // Futures gold ratio is ramping (rising -> near-top percentile ->
    // inverted to near 0), whereas the flat IBJA pair would score ~50 —
    // confirms the futures pair actually drove the value, not just
    // derivedFrom's label.
    expect(goldRatio.value).toBeLessThan(20);
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

  it("debt.gilt::carry and debt.liquid::carry are NOT inverted — high yield scores HIGH (§15.1 trap)", () => {
    // Yields ramping up; the latest is the highest ever seen -> should
    // score near 100, the OPPOSITE convention from equity valuation.
    const gsecYields = Array.from({ length: 30 }, (_, i) => 5 + i * 0.1);
    const tbillYields = Array.from({ length: 30 }, (_, i) => 4 + i * 0.05);
    seedMonthlySeries("gsec_10y", "FRED", gsecYields);
    seedMonthlySeries("tbill_1y", "RBI", tbillYields);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const gilt = results.find((r) => r.scoreId === "debt.gilt::carry")!;
    const liquid = results.find((r) => r.scoreId === "debt.liquid::carry")!;

    expect(gilt.status).toBe("ok");
    expect(gilt.value).toBeGreaterThan(90); // high yield, as-is (not inverted) -> high score
    expect(liquid.status).toBe("ok");
    expect(liquid.value).toBeGreaterThan(90);
  });

  it("l1.debt::valuation derives a real yield from gsec_10y - cpi_yoy, joined by year-month not exact date", () => {
    // gsec_10y published on the 1st (FRED convention here); cpi_yoy
    // published on a different day of the month (RBI's month-end) —
    // this must still join correctly by year-month.
    const gsecYields = Array.from({ length: 30 }, (_, i) => 6 + i * 0.05);
    seedMonthlySeries("gsec_10y", "FRED", gsecYields, 2020, 1);

    const cpiRows = Array.from({ length: 30 }, (_, i) => {
      const monthIdx = i;
      const year = 2020 + Math.floor(monthIdx / 12);
      const month = (monthIdx % 12) + 1;
      // Publish on the 28th, not the 1st, to prove the join is by month.
      return { seriesId: "cpi_yoy", date: `${year}-${String(month).padStart(2, "0")}-28`, value: 4.0, basis: null, source: "RBI", fetchedAt: "2026-09-03T00:00:00Z" };
    });
    insertObservations(db, cpiRows);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const debtValuation = results.find((r) => r.scoreId === "l1.debt::valuation")!;
    expect(debtValuation.status).toBe("ok"); // would be insufficient_history if the join silently produced 0 matches
  });

  it("l1.equity::valuation computes the earnings-yield gap once nifty50_pe and gsec_10y both have enough history (Calculation Guide row 7)", () => {
    const peValues = Array.from({ length: 30 }, (_, i) => 18 + i * 0.1);
    seedMonthlySeries("nifty50_pe", "NSE", peValues, 2020, 1);
    const gsecYields = Array.from({ length: 30 }, () => 6.75);
    seedMonthlySeries("gsec_10y", "FRED", gsecYields, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const equityValuation = results.find((r) => r.scoreId === "l1.equity::valuation")!;
    expect(equityValuation.status).toBe("ok");
    expect(equityValuation.transform).toBe("percentile"); // AS-IS, not inverted (high gap = cheap = attractive)
  });

  it("l1.metals::valuation computes the real (CPI-deflated) gold price once gold_inr and cpi_index both have enough history (Calculation Guide row 21)", () => {
    const goldValues = Array.from({ length: 30 }, (_, i) => 60000 + i * 500);
    seedMonthlySeries("gold_inr", "IBJA", goldValues, 2020, 1);
    const cpiValues = Array.from({ length: 30 }, (_, i) => 180 + i * 0.5);
    seedMonthlySeries("cpi_index", "RBI", cpiValues, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const metalsValuation = results.find((r) => r.scoreId === "l1.metals::valuation")!;
    expect(metalsValuation.status).toBe("ok");
    expect(metalsValuation.transform).toBe("inverted"); // expensive in real terms = unattractive
  });

  it("equity.{mid,small}::relvalue score from the P/E spread vs large-cap, INVERTED (a wide spread = expensive vs large = unattractive)", () => {
    const largeValues = Array.from({ length: 30 }, () => 22.5);
    seedMonthlySeries("nifty100_pe", "NSE", largeValues, 2020, 1);
    const midValues = Array.from({ length: 30 }, (_, i) => 30 + i * 0.2); // widening spread over time
    seedMonthlySeries("midcap150_pe", "NSE", midValues, 2020, 1);
    const smallValues = Array.from({ length: 30 }, (_, i) => 28 + i * 0.2);
    seedMonthlySeries("smallcap250_pe", "NSE", smallValues, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const mid = results.find((r) => r.scoreId === "equity.mid::relvalue")!;
    const small = results.find((r) => r.scoreId === "equity.small::relvalue")!;
    const large = results.find((r) => r.scoreId === "equity.large::relvalue")!;
    expect(mid.status).toBe("ok");
    expect(small.status).toBe("ok");
    expect(large.status).toBe("ok");
    // The widest/most-recent spread -> highest raw percentile -> mid/small's INVERTED score is lowest.
    expect(mid.value).toBeLessThan(50);
    expect(small.value).toBeLessThan(50);
    // Large's score is the average of the two RAW (non-inverted) percentiles, so it moves opposite of mid/small.
    expect(large.value).toBeGreaterThan(50);
  });

  it("sector.*::rel_momentum scores from the 6M/12M relative-return average vs Nifty, AS-IS", () => {
    // Sector consistently outperforms Nifty every month -> relative
    // momentum should trend positive and score above 50 once percentiled.
    const sectorValues = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.002, i)); // ~daily-ish compounding
    const niftyValues = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.001, i));

    const seedDaily = (seriesId: string, source: string, values: number[]) => {
      const rows = values.map((value, i) => {
        const d = new Date("2024-01-01T00:00:00Z");
        d.setDate(d.getDate() + i);
        return { seriesId, date: d.toISOString().slice(0, 10), value, basis: null, source, fetchedAt: "2026-09-15T00:00:00Z" };
      });
      insertObservations(db, rows);
    };
    seedDaily("sector_close_banking", "NIFTYINDICES", sectorValues);
    seedDaily("nifty50_close", "NIFTYINDICES", niftyValues);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2025-06-01");
    const relMomentum = results.find((r) => r.scoreId === "sector.banking::rel_momentum")!;
    expect(relMomentum.status).toBe("ok");
    expect(relMomentum.transform).toBe("percentile"); // AS-IS, not inverted
  });
});
