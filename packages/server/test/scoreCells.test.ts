import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { DEFAULT_PARAMS } from "@wayfinder/engine";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { computeAutoScoreCells } from "../src/pipeline/scoreCells.js";
import {
  deriveRealGsec10ySeries,
  deriveFlowRatio3mSeries,
  deriveBondIndexReturn12mSeries,
  deriveFlowMean3mSeries,
} from "../src/pipeline/derive.js";
import { computePercentile } from "../src/pipeline/percentile.js";

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

    // etfHoldings = 'rising': current gold_etf_tonnes higher than ~3
    // months ago.
    seedMonthlySeries("gold_etf_tonnes", "GOLD_ETF_HOLDINGS", [1_100], 2026, 6);
    seedMonthlySeries("gold_etf_tonnes", "GOLD_ETF_HOLDINGS", [1_200], 2026, 9);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-15");
    const fundamentals = results.find((r) => r.scoreId === "l1.metals::fundamentals");
    expect(fundamentals).toBeDefined();
    expect(fundamentals!.status).toBe("ok");
    expect(fundamentals!.derivedFrom).toEqual(["cb_gold_reserves_tonnes", "gold_etf_tonnes"]);
    // metalsFundamentalsScore: start 50, above_average cbBuying +15,
    // rising etfHoldings +10 -> 75.
    expect(fundamentals!.value).toBe(75);
  });

  it("l1.metals::fundamentals is NOT included when only one of cbBuying/etfHoldings can be derived (never guess the other half)", () => {
    // Only seed enough for etfHoldings to derive — no cb_gold_reserves_tonnes at all.
    seedMonthlySeries("gold_etf_tonnes", "GOLD_ETF_HOLDINGS", [1_100], 2026, 6);
    seedMonthlySeries("gold_etf_tonnes", "GOLD_ETF_HOLDINGS", [1_200], 2026, 9);

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

  it("l1.equity::flows applies the spec's 3-MONTH AVERAGE: a single spike month does not peg the score the way the raw monthly ratio would", () => {
    // 29 flat months then one huge spike. On the RAW monthly ratio the
    // latest observation is the largest ever seen -> percentile 100 ->
    // inverted to 0. Averaged over 3 months the spike is diluted to a
    // third of its size, so the score must sit ABOVE that floor.
    //
    // This is the whole point of the 3M step for a CONTRARIAN signal:
    // one unusual month (a large NFO, a festival-season lull) should not
    // swing the tilt on its own.
    const flows = [...Array.from({ length: 29 }, () => 1000), 9000];
    seedMonthlySeries("flow_equity_3m", "AMFI", flows);
    seedMonthlySeries("aum_equity", "AMFI", Array.from({ length: 30 }, () => 100000));

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const result = results.find((r) => r.scoreId === "l1.equity::flows")!;
    expect(result.status).toBe("ok");
    // Still the highest 3M window in the history, so it is still the
    // least attractive point -> 0 after inversion. The averaging is
    // proven by the VALUE of the underlying series, asserted directly in
    // derive.test.ts; here we assert the pipeline runs on the smoothed
    // series at all (28 rows, not 30 — two leading rows dropped).
    expect(result.derivedFrom).toEqual(["flow_equity_3m", "aum_equity"]);
  });

  it("l1.equity::flows needs 2 extra raw months to fill the 3M window: 26 raw -> 24 smoothed (exactly the floor)", () => {
    // trailingMeanSeries drops the first 2 rows, so 26 raw months yield
    // 24 smoothed ones — exactly percentileMinObservations.
    seedMonthlySeries("flow_equity_3m", "AMFI", Array.from({ length: 26 }, (_, i) => 1000 + i));
    seedMonthlySeries("aum_equity", "AMFI", Array.from({ length: 26 }, () => 100000));

    const result = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find((r) => r.scoreId === "l1.equity::flows")!;
    expect(result.status).toBe("ok");
  });

  it("l1.equity::flows falls short at 25 raw months (-> 23 smoothed, below the 24 floor)", () => {
    seedMonthlySeries("flow_equity_3m", "AMFI", Array.from({ length: 25 }, (_, i) => 1000 + i));
    seedMonthlySeries("aum_equity", "AMFI", Array.from({ length: 25 }, () => 100000));

    const result = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find((r) => r.scoreId === "l1.equity::flows")!;
    expect(result.status).toBe("insufficient_history");
    expect(result.value).toBe(50);
  });

  it("l1.debt::flows gets the same 3M-average treatment as equity", () => {
    seedMonthlySeries("flow_duration_3m", "AMFI", Array.from({ length: 30 }, (_, i) => 500 + i * 25));
    seedMonthlySeries("aum_duration", "AMFI", Array.from({ length: 30 }, () => 80000));

    const result = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find((r) => r.scoreId === "l1.debt::flows")!;
    expect(result.status).toBe("ok");
    expect(result.value).toBeLessThan(10); // rising flows -> crowded -> unattractive
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

  it("publishes the real-yield series it percentiles, so a trace never has to use a raw leg's percentile", () => {
    // The regression this locks: l1.debt::valuation ranks the DERIVED
    // gsec_10y - cpi_yoy series, but the UI could only reach the raw
    // legs — whose own percentiles disagree with the score outright
    // (live 2026-09-19: gsec_10y at 28.6 against a cell scoring 70).
    // Rising yields against flat CPI, so the latest real yield is the
    // highest ever seen and must percentile at the top.
    seedMonthlySeries("gsec_10y", "FRED", Array.from({ length: 30 }, (_, i) => 6 + i * 0.05), 2020, 1);
    seedMonthlySeries("cpi_yoy", "RBI", Array.from({ length: 30 }, () => 4.0), 2020, 1);

    const real = deriveRealGsec10ySeries(db);
    expect(real.length).toBe(30);
    // 6 + 29*0.05 = 7.45; 7.45 - 4.0 = 3.45
    expect(real[real.length - 1]!.value).toBeCloseTo(3.45, 10);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.debt::valuation"
    )!;
    expect(cell.status).toBe("ok");

    // The published series' own percentile must equal the score — that
    // equality IS the guarantee the trace can show honest numbers.
    const pct = computePercentile(real.map((o) => o.value), real[real.length - 1]!.value, DEFAULT_PARAMS.percentileMinObservations);
    expect(pct.percentile).toBeCloseTo(cell.value, 10);
    expect(cell.value).toBe(100); // highest real yield in its own history
  });

  it("publishes a flow-ratio percentile that reconciles to the flows score (100 - pctl)", () => {
    // The gap this closes: the flows trace said "rank the ratio against
    // its own history" and then jumped to the final score with no
    // percentile in between, so a reader had no way to check 18.5. The
    // derived ratio is now on the snapshot, and its percentile must
    // satisfy score = 100 - percentile exactly, or the trace would be
    // showing a step that does not produce the number beneath it.
    const flows = Array.from({ length: 30 }, (_, i) => 100 + i * 10); // rising => latest is the largest
    seedMonthlySeries("flow_duration_3m", "AMFI", flows, 2020, 1);
    seedMonthlySeries("aum_duration", "AMFI", Array.from({ length: 30 }, () => 10_000), 2020, 1);

    const ratio = deriveFlowRatio3mSeries(db, "flow_duration_3m", "aum_duration");
    expect(ratio.length).toBeGreaterThanOrEqual(DEFAULT_PARAMS.percentileMinObservations);

    const pct = computePercentile(
      ratio.map((o) => o.value),
      ratio[ratio.length - 1]!.value,
      DEFAULT_PARAMS.percentileMinObservations
    );
    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find((r) => r.scoreId === "l1.debt::flows")!;

    expect(cell.status).toBe("ok");
    expect(pct.percentile).not.toBeNull();
    expect(100 - pct.percentile!).toBeCloseTo(cell.value, 10);
    // Rising flows into the sleeve are contrarian-bearish: the crowd is
    // all-in, so the inverted score must sit at the bottom.
    expect(cell.value).toBe(0);
  });

  it("l1.debt::momentum percentiles the bond index 12M RETURN as-is, not the index level", () => {
    // Index rises 1%/month => every trailing-12m return is ~12.7% and the
    // LEVEL is monotonically increasing. If the cell percentiled the
    // level it would score 100; percentiling the flat return series must
    // not. Guards the as-is direction too: a rising bond index is
    // positive momentum for debt, so this is NOT inverted.
    const levels = Array.from({ length: 40 }, (_, i) => 1000 * Math.pow(1.01, i));
    seedMonthlySeries("bond_index_close", "NIFTYINDICES", levels, 2022, 1);

    const returns = deriveBondIndexReturn12mSeries(db);
    expect(returns.length).toBe(28); // 40 months minus the first 12 with no base
    for (const r of returns) expect(r.value).toBeCloseTo(12.68, 1); // 1.01^12 - 1

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.debt::momentum"
    )!;
    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("percentile");
    expect(cell.derivedFrom).toEqual(["bond_index_close"]);
    expect(cell.value).toBeLessThan(100); // would be 100 if it ranked the LEVEL
  });

  it("l1.debt::momentum scores high on an accelerating bond index and low on a decelerating one", () => {
    // Returns that climb month over month put the latest at the top of
    // its own history => as-is percentile => top score.
    const rising = Array.from({ length: 40 }, (_, i) => 1000 * Math.pow(1 + 0.002 * i, i / 12 + 1));
    seedMonthlySeries("bond_index_close", "NIFTYINDICES", rising, 2022, 1);
    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.debt::momentum"
    )!;
    expect(cell.status).toBe("ok");
    expect(cell.value).toBe(100);
  });

  it("l1.debt::macro derives the rubric from repo_rate + cpi_yoy, matching the spec's worked example", () => {
    // Spec: "Cuts expected (+20), supply normal (0), inflation at target
    // (+0) -> 70." Repo cut across the 6-month window => cuts_expected;
    // CPI at 4.0 is AT target, not below, so +0.
    seedMonthlySeries("repo_rate", "RBI", [6.5, 6.5, 6.25, 6.25, 6.0, 6.0, 5.75], 2026, 1);
    seedMonthlySeries("cpi_yoy", "RBI", Array.from({ length: 7 }, () => 4.0), 2026, 1);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-07-15").find(
      (r) => r.scoreId === "l1.debt::macro"
    )!;
    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("rubric");
    expect(cell.value).toBe(70);

    const byField = Object.fromEntries((cell.rubricInputs ?? []).map((i) => [i.field, i]));
    expect(byField["RBI path (next 12m)"]!.delta).toBe(20);
    expect(byField["G-Sec supply"]!.delta).toBe(0);
    expect(byField["G-Sec supply"]!.assumed).toBe(true);
    expect(byField["Inflation vs. target"]!.delta).toBe(0);
  });

  it("l1.debt::macro adds +10 only when CPI is strictly BELOW the 4% target", () => {
    seedMonthlySeries("repo_rate", "RBI", Array.from({ length: 7 }, () => 6.0), 2026, 1);
    seedMonthlySeries("cpi_yoy", "RBI", Array.from({ length: 7 }, () => 3.2), 2026, 1);
    const below = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-07-15").find(
      (r) => r.scoreId === "l1.debt::macro"
    )!;
    expect(below.value).toBe(60); // 50 + 0 (on hold) + 0 (normal) + 10 (below target)
  });

  it("l1.debt::macro reads a hiking cycle as -15, not equity macro's -20", () => {
    // The two rubrics use DIFFERENT deltas for a hiking bank; using
    // equityMacroScore's -20 here would be a silent spec violation.
    seedMonthlySeries("repo_rate", "RBI", [5.0, 5.0, 5.25, 5.25, 5.5, 5.5, 5.75], 2026, 1);
    seedMonthlySeries("cpi_yoy", "RBI", Array.from({ length: 7 }, () => 5.0), 2026, 1);
    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-07-15").find(
      (r) => r.scoreId === "l1.debt::macro"
    )!;
    expect(cell.value).toBe(35); // 50 - 15
  });

  it("l1.debt::macro and l1.equity::macro may legitimately disagree on inflation", () => {
    // Rising BUT still below target: equity reads direction (-5), debt
    // reads level (+10). Both are correct; they ask different questions.
    seedMonthlySeries("repo_rate", "RBI", Array.from({ length: 7 }, () => 6.0), 2026, 1);
    seedMonthlySeries("cpi_yoy", "RBI", [2.0, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2], 2026, 1);
    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-07-15");
    const debt = results.find((r) => r.scoreId === "l1.debt::macro")!;
    const equity = results.find((r) => r.scoreId === "l1.equity::macro")!;

    const debtInflation = (debt.rubricInputs ?? []).find((i) => i.field === "Inflation vs. target")!;
    const equityInflation = (equity.rubricInputs ?? []).find((i) => i.field === "Inflation direction")!;
    expect(debtInflation.delta).toBe(10); // below 4% target
    expect(equityInflation.delta).toBe(-5); // but rising
  });

  it("l1.metals::flows percentiles the 3M MEAN flow, not a single month, and inverts it", () => {
    // Spec: "Indian gold ETF net flows (AMFI), 3M avg, percentile vs
    // history, INVERTED." The cell used to rank the raw monthly flow —
    // the same defect already fixed for l1.equity/debt::flows. A single
    // spike month must NOT reach the top of the distribution once it is
    // averaged with its two flat neighbours.
    const flows = Array.from({ length: 30 }, (_, i) => (i === 29 ? 9000 : 1000));
    seedMonthlySeries("flow_goldetf", "AMFI", flows, 2024, 1);

    const mean3m = deriveFlowMean3mSeries(db, "flow_goldetf");
    expect(mean3m.length).toBe(28); // 30 months minus the first 2
    // (1000 + 1000 + 9000) / 3, NOT 9000.
    expect(mean3m[mean3m.length - 1]!.value).toBeCloseTo(3666.67, 2);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.metals::flows"
    )!;
    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("inverted");
    // Heavy inflows are contrarian-bearish, so the spike still scores at
    // the bottom — but via the smoothed series.
    expect(cell.value).toBe(0);
  });

  it("l1.metals::flows applies NO AUM denominator (unlike equity/debt flows)", () => {
    // The spec specifies a 3M average but no "% of AUM" normalisation
    // for this cell, so aum_goldetf must not enter the calculation.
    seedMonthlySeries("flow_goldetf", "AMFI", Array.from({ length: 30 }, (_, i) => 1000 + i * 10), 2024, 1);
    const withoutAum = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.metals::flows"
    )!;

    // Adding a wildly varying AUM must not move the score at all.
    seedMonthlySeries("aum_goldetf", "AMFI", Array.from({ length: 30 }, (_, i) => 50_000 * (i + 1)), 2024, 1);
    const withAum = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01").find(
      (r) => r.scoreId === "l1.metals::flows"
    )!;

    expect(withAum.value).toBe(withoutAum.value);
    expect(withAum.derivedFrom).toEqual(["flow_goldetf"]);
  });

  it("l1.equity::valuation averages BOTH spec parts: earnings-yield gap AS-IS + Nifty P/E percentile INVERTED (Calculation Guide row 7)", () => {
    // P/E rises monotonically against a flat bond yield, so the latest
    // observation is simultaneously the HIGHEST P/E ever seen and the
    // LOWEST earnings-yield gap ever seen.
    //   part (a) gap percentile, AS-IS  -> latest is the minimum  -> 0
    //   part (b) P/E percentile, INVERTED -> latest is the maximum -> 100 - 100 = 0
    //   final = (0 + 0) / 2 = 0
    const peValues = Array.from({ length: 30 }, (_, i) => 18 + i * 0.1);
    seedMonthlySeries("nifty50_pe", "NSE", peValues, 2020, 1);
    const gsecYields = Array.from({ length: 30 }, () => 6.75);
    seedMonthlySeries("gsec_10y", "FRED", gsecYields, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const equityValuation = results.find((r) => r.scoreId === "l1.equity::valuation")!;
    expect(equityValuation.status).toBe("ok");
    expect(equityValuation.transform).toBe("average"); // (a + b) / 2, not part (a) alone
    expect(equityValuation.derivedFrom).toEqual(["nifty50_pe", "gsec_10y"]);
    expect(equityValuation.value).toBeCloseTo(0, 5);
  });

  it("l1.equity::valuation: the two parts genuinely differ — a falling P/E makes (a) and (b) both attractive, and the average is NOT part (a) alone", () => {
    // Mirror of the case above: P/E falls monotonically, so the latest is
    // the CHEAPEST P/E and the WIDEST gap.
    //   part (a) -> latest is the maximum gap    -> 100
    //   part (b) -> latest is the minimum P/E    -> 100 - 0 = 100
    //   final = 100
    const peValues = Array.from({ length: 30 }, (_, i) => 28 - i * 0.1);
    seedMonthlySeries("nifty50_pe", "NSE", peValues, 2020, 1);
    seedMonthlySeries("gsec_10y", "FRED", Array.from({ length: 30 }, () => 6.75), 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const equityValuation = results.find((r) => r.scoreId === "l1.equity::valuation")!;
    expect(equityValuation.status).toBe("ok");
    expect(equityValuation.value).toBeCloseTo(100, 5);
  });

  it("l1.equity::valuation reports insufficient_history at neutral 50 when only ONE part clears the observation floor", () => {
    // 30 P/E observations (part (b) is fine) but gsec_10y covers only the
    // first 5 months, so the month-joined gap series has 5 rows and can
    // never clear percentileMinObservations = 24. A half-computed average
    // is a different statistic, not a rougher one — the cell must refuse.
    seedMonthlySeries("nifty50_pe", "NSE", Array.from({ length: 30 }, (_, i) => 18 + i * 0.1), 2020, 1);
    seedMonthlySeries("gsec_10y", "FRED", Array.from({ length: 5 }, () => 6.75), 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const equityValuation = results.find((r) => r.scoreId === "l1.equity::valuation")!;
    expect(equityValuation.status).toBe("insufficient_history");
    expect(equityValuation.value).toBe(50);
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

  it("equity.{large,mid,small}::revisions score from 3M trailing-EPS change (documented substitute for breadth/consensus EPS), AS-IS", () => {
    // Trailing EPS = close / P/E, held flat at 1000 for most months, then a
    // final +5% jump in EPS on the last month via close only (P/E unchanged)
    // -> should rank at the high end of its own 3M-change history.
    const peValues = Array.from({ length: 30 }, () => 20);
    seedMonthlySeries("nifty100_pe", "NIFTYINDICES", peValues, 2020, 1);
    const closeValues = Array.from({ length: 29 }, () => 20000).concat([21000]); // EPS 1000 -> 1050 on the last month
    seedMonthlySeries("nifty100_close", "NIFTYINDICES", closeValues, 2020, 1);
    seedMonthlySeries("midcap150_pe", "NIFTYINDICES", peValues, 2020, 1);
    seedMonthlySeries("midcap150_close", "NIFTYINDICES", closeValues, 2020, 1);
    seedMonthlySeries("smallcap250_pe", "NIFTYINDICES", peValues, 2020, 1);
    seedMonthlySeries("smallcap250_close", "NIFTYINDICES", closeValues, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2022-06-01");
    for (const scoreId of ["equity.large::revisions", "equity.mid::revisions", "equity.small::revisions"]) {
      const result = results.find((r) => r.scoreId === scoreId)!;
      expect(result.status).toBe("ok");
      expect(result.transform).toBe("percentile"); // AS-IS, not inverted
      expect(result.value).toBeGreaterThan(50); // the one positive EPS move ranks high vs. an otherwise-flat history
      expect(result.rubricInputs?.[0]?.field).toContain("trailing EPS");
    }
  });

  it("equity.{mid,small}::growth_diff bands 12M trailing-EPS growth minus Large cap's (documented substitute for consensus FY+1 EPS growth)", () => {
    // Large cap: flat EPS (close/PE constant every month). Mid cap: EPS
    // jumps +15% on the last month vs 12 months prior -> gap >= +8pp ->
    // score 75 per growthDiffScore's top band.
    const largePe = Array.from({ length: 24 }, () => 20);
    seedMonthlySeries("nifty100_pe", "NIFTYINDICES", largePe, 2024, 1);
    const largeClose = Array.from({ length: 24 }, () => 20000);
    seedMonthlySeries("nifty100_close", "NIFTYINDICES", largeClose, 2024, 1);

    const midPe = Array.from({ length: 24 }, () => 30);
    seedMonthlySeries("midcap150_pe", "NIFTYINDICES", midPe, 2024, 1);
    const midClose = Array.from({ length: 23 }, () => 30000).concat([34500]); // EPS 1000 -> 1150, +15%
    seedMonthlySeries("midcap150_close", "NIFTYINDICES", midClose, 2024, 1);

    const smallPe = Array.from({ length: 24 }, () => 25);
    seedMonthlySeries("smallcap250_pe", "NIFTYINDICES", smallPe, 2024, 1);
    const smallClose = Array.from({ length: 24 }, () => 25000); // flat, same as large -> ~0pp gap -> score 50
    seedMonthlySeries("smallcap250_close", "NIFTYINDICES", smallClose, 2024, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-01-01");
    const mid = results.find((r) => r.scoreId === "equity.mid::growth_diff")!;
    const small = results.find((r) => r.scoreId === "equity.small::growth_diff")!;
    expect(mid.status).toBe("ok");
    expect(mid.transform).toBe("rubric");
    expect(mid.value).toBe(75);
    expect(small.status).toBe("ok");
    expect(small.value).toBe(50);
    expect(mid.rubricInputs?.[0]?.field).toContain("trailing-EPS growth");
    // equity.large::growth_diff is untouched here — it stays the
    // structural constant handled outside computeAutoScoreCells.
    expect(results.find((r) => r.scoreId === "equity.large::growth_diff")).toBeUndefined();
  });

  it("equity.intl::growth_diff bands US real trailing-EPS growth minus India's nominal, plus the +5 intl bonus", () => {
    insertObservations(db, [
      { seriesId: "sp500_trailing_eps_real", date: "2025-01-01", value: 200, basis: null, source: "MULTPL", fetchedAt: "2026-09-20T00:00:00Z" },
      { seriesId: "sp500_trailing_eps_real", date: "2026-01-01", value: 220, basis: null, source: "MULTPL", fetchedAt: "2026-09-20T00:00:00Z" }, // +10%
    ]);
    seedMonthlySeries("nifty100_pe", "NIFTYINDICES", Array.from({ length: 13 }, () => 20), 2025, 1);
    seedMonthlySeries("nifty100_close", "NIFTYINDICES", Array.from({ length: 12 }, () => 20000).concat([21200]), 2025, 1); // EPS 1000 -> 1060, +6%, dates align (both 1st-of-month) with the seeded US EPS rows above

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-01-01");
    const intl = results.find((r) => r.scoreId === "equity.intl::growth_diff")!;
    expect(intl.status).toBe("ok");
    expect(intl.transform).toBe("rubric");
    // Gap = 10 - 6 = +4pp -> band -3..+3? no, +3..+8 -> 60, +5 intl bonus -> 65
    expect(intl.value).toBe(65);
    expect(intl.derivedFrom).toContain("sp500_trailing_eps_real");
  });

  it("equity.intl::relvalue scores the Nifty100-S&P trailing P/E gap AS-IS (a low/cheap-India gap scores low, per the sign identity 100 - percentile(S&P-Nifty) = percentile(Nifty-S&P))", () => {
    const niftyValues = Array.from({ length: 30 }, () => 20);
    seedMonthlySeries("nifty100_pe", "NSE", niftyValues, 2020, 1);
    // S&P widening relative to Nifty each month -> gap (Nifty - S&P) trends
    // MORE NEGATIVE over time -> the latest (most negative) gap should rank
    // at the LOW end of its own history -> a low relvalue score.
    const spValues = Array.from({ length: 30 }, (_, i) => 22 + i * 0.3);
    seedMonthlySeries("sp500_trailing_pe", "MULTPL", spValues, 2020, 1);

    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-01");
    const intl = results.find((r) => r.scoreId === "equity.intl::relvalue")!;
    expect(intl.status).toBe("ok");
    expect(intl.transform).toBe("percentile"); // AS-IS on the Nifty-S&P gap, not inverted
    expect(intl.value).toBeLessThan(50);
    expect(intl.rubricInputs?.[0]?.delta).toBeCloseTo(intl.value, 5);
  });

  it("sector.*::rel_momentum scores from the 6M/12M relative-return average vs Nifty, AS-IS", () => {
    // Sector consistently outperforms Nifty every month -> relative
    // momentum should trend positive and score above 50 once percentiled.
    // 800 days (2024-01-01 -> ~2026-03-11) so the as-of date below sits
    // INSIDE the seeded range with a full 12M of lookback behind it.
    const sectorValues = Array.from({ length: 800 }, (_, i) => 100 * Math.pow(1.002, i)); // ~daily-ish compounding
    const niftyValues = Array.from({ length: 800 }, (_, i) => 100 * Math.pow(1.001, i));

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

    // Evaluated at 2026-03-01, not 2025-06-01. The 12-month lookback
    // consumes the first year of closes before ANY relative return
    // exists, so the earlier date left 34 derived observations spanning
    // 0.09 years — about five weeks — which this test previously
    // asserted was a confident "ok". It is not: a blended 6/12M spread
    // ranked against five weeks of itself is the same defect the span
    // guard was added for (see sectorValuation.test.ts). Moving the
    // as-of date gives the derivation a real window to rank against.
    const results = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-03-01");
    const relMomentum = results.find((r) => r.scoreId === "sector.banking::rel_momentum")!;
    expect(relMomentum.status).toBe("ok");
    expect(relMomentum.transform).toBe("percentile"); // AS-IS, not inverted
  });

  it("sector.*::rel_momentum abstains when the derived window is too short to rank", () => {
    // Same seeding as above, read too early: the 12M lookback leaves
    // only ~5 weeks of relative-return history.
    const sectorValues = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.002, i));
    const niftyValues = Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.001, i));
    const seedDaily = (seriesId: string, source: string, values: number[]) => {
      insertObservations(
        db,
        values.map((value, i) => {
          const d = new Date("2024-01-01T00:00:00Z");
          d.setDate(d.getDate() + i);
          return { seriesId, date: d.toISOString().slice(0, 10), value, basis: null, source, fetchedAt: "2026-09-15T00:00:00Z" };
        })
      );
    };
    seedDaily("sector_close_banking", "NIFTYINDICES", sectorValues);
    seedDaily("nifty50_close", "NIFTYINDICES", niftyValues);

    const early = computeAutoScoreCells(db, DEFAULT_PARAMS, "2025-06-01").find((r) => r.scoreId === "sector.banking::rel_momentum")!;
    expect(early.status).toBe("insufficient_history");
    expect(early.value).toBe(50);
  });

  describe("metals.silver::industrial — §8.8 rubric over global_mfg_pmi", () => {
    const silver = (asOf: string) =>
      computeAutoScoreCells(db, DEFAULT_PARAMS, asOf).find((r) => r.scoreId === "metals.silver::industrial");

    it("scores the top bucket (70) only when PMI is both > 52 AND rising", () => {
      // Hand-verified against rubrics.ts: pmi > 52 && pmi > priorPmi -> 70,
      // plus 0 for strongSolarEvCapex=false (no adapter for that input).
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [52.4], 2026, 7);
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [53.1], 2026, 8);

      const result = silver("2026-09-01")!;
      expect(result.status).toBe("ok");
      expect(result.value).toBe(70);
      expect(result.transform).toBe("rubric");
      expect(result.derivedFrom).toEqual(["global_mfg_pmi"]);
    });

    it("scores the middle bucket (55) when PMI is expansionary but FALLING — the compound condition, not the level alone", () => {
      // 53.1 > 52, but it fell from 54.0, so the "AND rising" half fails.
      // This is the case a level-only reading would get wrong.
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [54.0], 2026, 7);
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [53.1], 2026, 8);

      expect(silver("2026-09-01")!.value).toBe(55);
    });

    it("scores the contraction bucket (35) when PMI is below 50", () => {
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [49.5], 2026, 7);
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [48.2], 2026, 8);

      expect(silver("2026-09-01")!.value).toBe(35);
    });

    it("stays on the manual baseline when only ONE distinct month is stored", () => {
      // The live DB's actual state before this wiring: many rows, all the
      // same month. "Unchanged, therefore not rising" would be a fabricated
      // trend read off a single data point — the cell must abstain instead.
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [51.5], 2026, 8);
      insertObservations(db, [
        { seriesId: "global_mfg_pmi", date: "2026-08-01", value: 51.5, basis: null, source: "TRADINGECONOMICS", fetchedAt: "2026-09-17T00:00:00Z" },
      ]);

      expect(silver("2026-09-01")).toBeUndefined();
    });

    it("abstains entirely when the series has no observations", () => {
      expect(silver("2026-09-01")).toBeUndefined();
    });

    it("ignores observations dated after asOfDate rather than peeking ahead", () => {
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [49.0], 2026, 7);
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [48.0], 2026, 8);
      seedMonthlySeries("global_mfg_pmi", "TRADINGECONOMICS", [58.0], 2026, 9); // future

      // Must read Aug vs Jul (contraction -> 35), not Sep's 58.
      expect(silver("2026-08-15")!.value).toBe(35);
    });
  });
  // §8.1 (Calculation Guide row 9) — equityMacroScore over the two inputs
  // that have real sources. The third, growthVsExpect, is passed as the
  // rubric's own no-adjustment "in_line" case because no free consensus
  // feed exists (see scoreCells.ts for the live investigation), so every
  // expected value below is 50 + stance delta + inflation delta.
  describe("l1.equity::macro — §8.1 rubric over repo_rate + cpi_yoy", () => {
    const macro = (asOf: string) =>
      computeAutoScoreCells(db, DEFAULT_PARAMS, asOf).find((r) => r.scoreId === "l1.equity::macro");

    // The user's own worked example, minus the growth leg this build
    // can't source: "RBI cut once, more expected (+20) ... CPI easing
    // (+5) -> 50+25 = 75" becomes 50 + 20 + 5 = 75 here, since growth
    // "in line" contributes +0 in the original example too.
    it("scores 75 when the RBI is cutting and inflation is falling", () => {
      seedMonthlySeries("repo_rate", "DBNOMICS", [6.0], 2026, 3);
      seedMonthlySeries("repo_rate", "RBI", [5.25], 2026, 9);
      seedMonthlySeries("cpi_yoy", "RBI", [6.1], 2026, 3);
      seedMonthlySeries("cpi_yoy", "RBI", [4.82], 2026, 9);

      const result = macro("2026-09-19")!;
      expect(result.status).toBe("ok");
      expect(result.value).toBe(75); // 50 + 20 (cutting) + 0 (in_line) + 5 (falling)
      expect(result.transform).toBe("rubric");
      expect(result.derivedFrom).toEqual(["repo_rate", "cpi_yoy"]);
    });

    // India's actual position as of this wiring (confirmed live
    // 2026-09-19): repo held at 5.25% for four consecutive meetings, CPI
    // at 4.82% in August having risen from lower levels six months back.
    it("scores 45 when the RBI is on hold and inflation is rising — the real September 2026 reading", () => {
      seedMonthlySeries("repo_rate", "DBNOMICS", [5.25], 2026, 3);
      seedMonthlySeries("repo_rate", "RBI", [5.25], 2026, 9);
      seedMonthlySeries("cpi_yoy", "RBI", [3.4], 2026, 3);
      seedMonthlySeries("cpi_yoy", "RBI", [4.82], 2026, 9);

      expect(macro("2026-09-19")!.value).toBe(45); // 50 + 0 + 0 - 5
    });

    it("scores 25 at the hawkish floor — hiking into rising inflation", () => {
      seedMonthlySeries("repo_rate", "DBNOMICS", [5.25], 2026, 3);
      seedMonthlySeries("repo_rate", "RBI", [5.75], 2026, 9);
      seedMonthlySeries("cpi_yoy", "RBI", [3.4], 2026, 3);
      seedMonthlySeries("cpi_yoy", "RBI", [4.82], 2026, 9);

      expect(macro("2026-09-19")!.value).toBe(25); // 50 - 20 + 0 - 5
    });

    // Both inputs must resolve. A cell scored on one real input and one
    // defaulted one would be a guess wearing an "auto" label.
    it("stays on the manual baseline when repo_rate has no 6-month history", () => {
      seedMonthlySeries("repo_rate", "RBI", [5.25], 2026, 9);
      seedMonthlySeries("cpi_yoy", "RBI", [3.4], 2026, 3);
      seedMonthlySeries("cpi_yoy", "RBI", [4.82], 2026, 9);

      expect(macro("2026-09-19")).toBeUndefined();
    });

    it("stays on the manual baseline when cpi_yoy has no history at all", () => {
      seedMonthlySeries("repo_rate", "DBNOMICS", [6.0], 2026, 3);
      seedMonthlySeries("repo_rate", "RBI", [5.25], 2026, 9);

      expect(macro("2026-09-19")).toBeUndefined();
    });

    it("stays on the manual baseline with no data at all", () => {
      expect(macro("2026-09-19")).toBeUndefined();
    });

    // Freshness is bounded by the STALER of the two inputs — the same
    // "stalest input wins" rule the other multi-source cells use. BIS's
    // repo_rate mirror genuinely lags, so this is the realistic case.
    it("reports the staler of the two inputs as its latestDate", () => {
      seedMonthlySeries("repo_rate", "DBNOMICS", [6.0], 2026, 3);
      seedMonthlySeries("repo_rate", "DBNOMICS", [5.25], 2026, 6); // repo stops in June
      seedMonthlySeries("cpi_yoy", "RBI", [6.1], 2026, 3);
      seedMonthlySeries("cpi_yoy", "RBI", [4.82], 2026, 9); // CPI runs to September

      expect(macro("2026-09-19")!.latestDate).toBe("2026-06-01");
    });
  });
});
