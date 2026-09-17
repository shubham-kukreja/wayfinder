import type Database from "better-sqlite3";
import type { Params } from "@wayfinder/engine";
import { metalsFundamentalsScore } from "@wayfinder/engine";
import { autoScore, autoScoreFromSeries, derivedRatioSeries, derivedDifferenceSeries } from "./scoreEngine.js";
import {
  deriveRealRatesScores,
  deriveNiftyMomentumSeries,
  goldEtfHoldingsTrend,
  centralBankGoldBuyingTrend,
  deriveEarningsYieldGapSeries,
  deriveRealGoldPriceSeries,
  deriveCpiYoySeries,
  deriveGoldReturn12mSeries,
  deriveMidLargeSpreadSeries,
  deriveSmallLargeSpreadSeries,
  deriveSectorRelMomentumSeries,
} from "./derive.js";
import { latestObservations } from "../store/observations.js";

export interface ScoreCellResult {
  scoreId: string;
  value: number;
  status: "ok" | "insufficient_history";
  derivedFrom: string[];
  transform: "percentile" | "inverted" | "rubric" | "average";
  // The date of the observation the CURRENT value was actually computed
  // from, not asOfDate — see scoreEngine.ts's AutoScoreResult.latestDate
  // doc comment. null only for the rare cell that isn't derived from a
  // dated observation at all.
  latestDate: string | null;
}

// §7 — every score cell computable end-to-end from the series this
// project's adapters (FRED, bullion/IBJA, AMFI, RBI, NSE, niftyindices,
// yahoo/yahooMetals, dbnomics) actually fetch as of this build.
// sector.*::rel_momentum is now wired via niftyindices.ts's sector_close_*
// history against nifty50_close (deriveSectorRelMomentumSeries).
// l1.equity::momentum is wired (see deriveNiftyMomentumSeries below)
// using a TRI approximation (no free real Nifty 50 TRI source exists —
// see derive.ts's doc comment). l1.equity::valuation (earnings-yield gap)
// and l1.metals::valuation (real INR gold price) are wired via
// deriveEarningsYieldGapSeries/deriveRealGoldPriceSeries.
// equity.{large,mid,small}::relvalue are wired via the Mid/Small-Large
// P/E spread series (Data Trackers rows 5-8). Still NOT computable:
// debt.corporate::carry/spread_cushion (no free aaa_3y source — FIMMDA/
// FBIL both confirmed dead ends, see docs/SESSION_SUMMARY_2026-09-15.md)
// and l1.debt::momentum (needs a CRISIL/Nifty composite bond index return
// — no adapter fetches this). Cells this can't compute are left for the
// caller to default to 50/manual — this module never guesses.
export function computeAutoScoreCells(db: Database.Database, params: Params, asOfDate: string): ScoreCellResult[] {
  const out: ScoreCellResult[] = [];

  // §7.1 l1.equity::flows — flow_equity_3m / aum_equity, inverted (high
  // relative inflow = crowded/expensive, not attractive).
  {
    const series = derivedRatioSeries(db, "flow_equity_3m", "aum_equity");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.equity::flows", value: result.value, status: result.status, derivedFrom: ["flow_equity_3m", "aum_equity"], transform: "inverted", latestDate: result.latestDate });
  }

  // §7.1 l1.debt::flows — flow_duration_3m / aum_duration, inverted.
  {
    const series = derivedRatioSeries(db, "flow_duration_3m", "aum_duration");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.debt::flows", value: result.value, status: result.status, derivedFrom: ["flow_duration_3m", "aum_duration"], transform: "inverted", latestDate: result.latestDate });
  }

  // §7.1 l1.metals::flows — flow_goldetf_3m, inverted, as-is (no AUM
  // denominator specified for this cell in §7.1's table).
  {
    const result = autoScore(db, "flow_goldetf", params, "inverted");
    out.push({ scoreId: "l1.metals::flows", value: result.value, status: result.status, derivedFrom: ["flow_goldetf"], transform: "inverted", latestDate: result.latestDate });
  }

  // §8.1 (Calculation Guide row 7) l1.equity::valuation — earnings-yield
  // gap = (100 / Nifty 50 trailing P/E) - 10Y G-sec yield, percentile
  // vs history, AS-IS (high gap = equity cheap vs bonds = attractive).
  {
    const series = deriveEarningsYieldGapSeries(db);
    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({ scoreId: "l1.equity::valuation", value: result.value, status: result.status, derivedFrom: ["nifty50_pe", "gsec_10y"], transform: "percentile", latestDate: result.latestDate });
  }

  // §8.4 (Calculation Guide row 21) l1.metals::valuation — real INR gold
  // price (gold_inr deflated by cpi_index), percentile vs history,
  // INVERTED (expensive in real terms = unattractive).
  {
    const series = deriveRealGoldPriceSeries(db);
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.metals::valuation", value: result.value, status: result.status, derivedFrom: ["gold_inr", "cpi_index"], transform: "inverted", latestDate: result.latestDate });
  }

  // §7.2 equity.{large,mid,small}::valuation — inverted index P/E, from
  // nseindia.com's /api/allIndices (see adapters/nse.ts). large uses
  // nifty100_pe (broader large-cap proxy than nifty50_pe, matching the
  // NIFTY 100 fund category AMFI's flow cells already key off of); mid
  // and small use the exact NSE index the §7.2 table names.
  // equity.intl::valuation stays manual — no source for that segment.
  {
    const result = autoScore(db, "nifty100_pe", params, "inverted");
    out.push({ scoreId: "equity.large::valuation", value: result.value, status: result.status, derivedFrom: ["nifty100_pe"], transform: "inverted", latestDate: result.latestDate });
  }
  {
    const result = autoScore(db, "midcap150_pe", params, "inverted");
    out.push({ scoreId: "equity.mid::valuation", value: result.value, status: result.status, derivedFrom: ["midcap150_pe"], transform: "inverted", latestDate: result.latestDate });
  }
  {
    const result = autoScore(db, "smallcap250_pe", params, "inverted");
    out.push({ scoreId: "equity.small::valuation", value: result.value, status: result.status, derivedFrom: ["smallcap250_pe"], transform: "inverted", latestDate: result.latestDate });
  }

  // Calculation Guide row 29 / Data Trackers rows 5-8 —
  // equity.{large,mid,small}::relvalue. "Mid Cap score = 100 − Mid
  // Spread %ile. Small Cap score = 100 − Small Spread %ile. Large Cap
  // score = average of the two raw spread %iles" (i.e. NOT inverted for
  // Large — a wide spread favoring Large means Large itself looks
  // relatively cheap, so Large's score moves WITH the spread percentile,
  // opposite of Mid/Small's own "high spread = expensive vs Large" framing).
  {
    const midSpread = deriveMidLargeSpreadSeries(db);
    const smallSpread = deriveSmallLargeSpreadSeries(db);
    const midResult = autoScoreFromSeries(midSpread, params, "inverted");
    const smallResult = autoScoreFromSeries(smallSpread, params, "inverted");
    out.push({ scoreId: "equity.mid::relvalue", value: midResult.value, status: midResult.status, derivedFrom: ["midcap150_pe", "nifty100_pe"], transform: "inverted", latestDate: midResult.latestDate });
    out.push({ scoreId: "equity.small::relvalue", value: smallResult.value, status: smallResult.status, derivedFrom: ["smallcap250_pe", "nifty100_pe"], transform: "inverted", latestDate: smallResult.latestDate });

    if (midResult.status === "ok" && smallResult.status === "ok") {
      const midRawPercentile = 100 - midResult.value;
      const smallRawPercentile = 100 - smallResult.value;
      const largeValue = (midRawPercentile + smallRawPercentile) / 2;
      // Large's freshness is bounded by whichever of the two inputs is
      // staler, same "the whole is only as fresh as its stalest part"
      // reasoning as elsewhere in this function.
      const largeLatestDate = [midResult.latestDate, smallResult.latestDate].sort()[0] ?? null;
      out.push({ scoreId: "equity.large::relvalue", value: largeValue, status: "ok", derivedFrom: ["midcap150_pe", "smallcap250_pe", "nifty100_pe"], transform: "average", latestDate: largeLatestDate });
    } else {
      out.push({ scoreId: "equity.large::relvalue", value: 50, status: "insufficient_history", derivedFrom: ["midcap150_pe", "smallcap250_pe", "nifty100_pe"], transform: "average", latestDate: null });
    }
  }

  // §7.5 sector.{banking,it,pharma,auto,fmcg,energy,metals,capgoods}::valuation
  // — inverted sector index P/E. Series IDs are shared between two
  // adapters: nse.ts (nseindia.com/api/allIndices, latest-only, no
  // Capital Goods match) and niftyindices.ts (Daily Snapshot CSV, real
  // historical backfill, DOES have a "Nifty Capital Goods" row) both
  // write to the same sector_pe_* series names, so this cell reads
  // whichever source has actually populated the store — no adapter
  // preference logic needed here, unlike the gold/silver ratio's
  // explicit futures-vs-IBJA fallback (that case needed preference
  // because the two sources measure different instruments; these two
  // measure the exact same index P/E, so they're interchangeable/
  // additive, not competing). sector.capgoods::valuation was manual-only
  // until niftyindices.ts confirmed a real "Nifty Capital Goods" row
  // 2026-09-15 — see adapters/niftyindices.ts.
  for (const [sector, seriesId] of [
    ["banking", "sector_pe_banking"],
    ["it", "sector_pe_it"],
    ["pharma", "sector_pe_pharma"],
    ["auto", "sector_pe_auto"],
    ["fmcg", "sector_pe_fmcg"],
    ["energy", "sector_pe_energy"],
    ["metals", "sector_pe_metals"],
    ["capgoods", "sector_pe_capgoods"],
  ] as const) {
    const result = autoScore(db, seriesId, params, "inverted");
    out.push({ scoreId: `sector.${sector}::valuation`, value: result.value, status: result.status, derivedFrom: [seriesId], transform: "inverted", latestDate: result.latestDate });
  }

  // Calculation Guide row 48 — sector.*::rel_momentum: average of the
  // sector index's 6M and 12M return minus Nifty's over the same
  // windows, percentile vs history, AS-IS. Uses sector_close_* (real
  // closing index values, adapters/niftyindices.ts) against
  // nifty50_close — nse.ts's sector_pe_* series has no matching close
  // value, so this reads a different series family than the valuation
  // loop above despite the shared sector list.
  for (const [sector, closeSeriesId] of [
    ["banking", "sector_close_banking"],
    ["it", "sector_close_it"],
    ["pharma", "sector_close_pharma"],
    ["auto", "sector_close_auto"],
    ["fmcg", "sector_close_fmcg"],
    ["energy", "sector_close_energy"],
    ["metals", "sector_close_metals"],
    ["capgoods", "sector_close_capgoods"],
  ] as const) {
    const series = deriveSectorRelMomentumSeries(db, closeSeriesId);
    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({ scoreId: `sector.${sector}::rel_momentum`, value: result.value, status: result.status, derivedFrom: [closeSeriesId, "nifty50_close"], transform: "percentile", latestDate: result.latestDate });
  }

  // §7.4 metals.gold::ratio_position / metals.silver::ratio_position —
  // gold_silver_ratio, inverted for gold / as-is for silver.
  //
  // Prefers gold_usd_futures/silver_usd_futures (Yahoo Finance COMEX
  // futures, adapters/yahooMetals.ts) over gold_inr/silver_inr (IBJA spot,
  // adapters/bullion.ts) when the futures pair has enough history to
  // clear the percentile floor — bullion.ts's metals.dev free tier has NO
  // historical backfill (fetchHistory() throws by design), so
  // gold_inr/silver_inr stays stuck at insufficient_history for weeks of
  // real usage; the futures pair has real multi-year daily history
  // (confirmed live 2026-09-15) and gives a working percentile from day
  // one. The ratio itself is currency-agnostic (both legs share a
  // currency in either pairing), so this is a legitimate same-signal
  // substitute for THIS score cell specifically — gold_inr/silver_inr
  // themselves are untouched and still feed l1.metals::momentum and any
  // absolute-INR-price use elsewhere. Falls back to IBJA once the
  // futures pair also lacks enough history (e.g. the adapter hasn't been
  // run yet), so this degrades gracefully rather than silently preferring
  // an empty series.
  {
    const futuresRatioSeries = derivedRatioSeries(db, "gold_usd_futures", "silver_usd_futures");
    const useFutures = futuresRatioSeries.length >= params.percentileMinObservations;
    const ratioSeries = useFutures ? futuresRatioSeries : derivedRatioSeries(db, "gold_inr", "silver_inr");
    const derivedFrom = useFutures ? ["gold_usd_futures", "silver_usd_futures"] : ["gold_inr", "silver_inr"];

    const goldResult = autoScoreFromSeries(ratioSeries, params, "inverted");
    out.push({ scoreId: "metals.gold::ratio_position", value: goldResult.value, status: goldResult.status, derivedFrom, transform: "inverted", latestDate: goldResult.latestDate });
    const silverResult = autoScoreFromSeries(ratioSeries, params, "percentile");
    out.push({ scoreId: "metals.silver::ratio_position", value: silverResult.value, status: silverResult.status, derivedFrom, transform: "percentile", latestDate: silverResult.latestDate });
  }

  // §8.5 (Calculation Guide row 23) l1.metals::fundamentals —
  // metalsFundamentalsScore(cbBuying, etfHoldings), both derived rather
  // than percentiled (this cell is a rubric/bucket lookup, not a
  // percentile-vs-history cell, so it doesn't go through
  // autoScore/autoScoreFromSeries). Both inputs are now real:
  // cbBuying from cb_gold_reserves_tonnes (DBnomics/IMF IFS,
  // adapters/dbnomics.ts — WGC's own Excel is Cloudflare-blocked, see
  // that adapter's file comment) and etfHoldings from
  // gold_etf_shares_outstanding (Yahoo GLD+IAU, adapters/yahooMetals.ts).
  // Only computed when BOTH derive successfully — a half-derived,
  // half-guessed rubric input would violate this project's "never guess"
  // invariant, so this cell stays on the manual/mock baseline until both
  // series have enough history.
  {
    const cbBuying = centralBankGoldBuyingTrend(db, asOfDate);
    const etfHoldings = goldEtfHoldingsTrend(db, asOfDate);
    if (cbBuying !== null && etfHoldings !== null) {
      const value = metalsFundamentalsScore({ cbBuying, etfHoldings });
      const cbRows = latestObservations(db, "cb_gold_reserves_tonnes");
      const etfRows = latestObservations(db, "gold_etf_shares_outstanding");
      // Same "stalest input wins" reasoning as equity.large::relvalue above.
      const latestDate = [cbRows[cbRows.length - 1]?.date, etfRows[etfRows.length - 1]?.date].filter((d): d is string => d !== undefined).sort()[0] ?? null;
      out.push({
        scoreId: "l1.metals::fundamentals",
        value,
        status: "ok",
        derivedFrom: ["cb_gold_reserves_tonnes", "gold_etf_shares_outstanding"],
        transform: "rubric",
        latestDate,
      });
    }
  }

  // §7.4 metals.gold::momentum / l1.metals::momentum — gold_return_12m,
  // percentile as-is.
  //
  // Computed from gold_usd_futures (COMEX GC=F, ~10Y of real monthly
  // history) rather than gold_inr (IBJA spot, 3 observations and no
  // historical endpoint on the free tier — it would never clear the
  // 24-observation floor). This is a genuine 12-month RETURN now, not the
  // price level's own percentile the way this cell used to approximate it.
  //
  // Using a USD series for an INR portfolio is sound HERE specifically
  // because a return is scale-invariant: the ~15% India landed-cost wedge
  // over spot (import duty + GST + local premium, confirmed live —
  // IBJA 15,236 INR/g vs 13,291 implied by futures x FX on 2026-09-16) is
  // a near-constant multiplier, so it cancels in a ratio of two dates.
  // It would NOT be sound for a price-level percentile, which is exactly
  // why l1.metals::valuation below still refuses to substitute it.
  // Residual honesty note: this is a USD-denominated return, so it omits
  // the INR/USD move an Indian holder actually experiences.
  {
    const series = deriveGoldReturn12mSeries(db);
    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({ scoreId: "l1.metals::momentum", value: result.value, status: result.status, derivedFrom: ["gold_usd_futures"], transform: "percentile", latestDate: result.latestDate });
  }

  // §8.4 — real rates rubric, already wired end-to-end (Phase 2's gating
  // path): metals.gold::real_rates, metals.silver::real_rates,
  // l1.metals::macro.
  const realRates = deriveRealRatesScores(db, asOfDate);
  if (realRates) {
    const usReal10yRows = latestObservations(db, "us_real_10y");
    const usReal10yLatestDate = usReal10yRows[usReal10yRows.length - 1]?.date ?? null;
    for (const [scoreId, value] of Object.entries(realRates)) {
      out.push({ scoreId, value, status: "ok", derivedFrom: ["us_real_10y"], transform: "rubric", latestDate: usReal10yLatestDate });
    }
  }

  // §8.1 (Calculation Guide row 11) l1.equity::momentum — "Nifty 50
  // total-return 12M % minus 10Y G-sec yield (equity excess return).
  // Percentile vs history, AS-IS." TRI is an approximation (no free real
  // TRI source found — see derive.ts's niftyTriApprox12mReturn doc
  // comment); deriveNiftyMomentumSeries builds the full excess-return
  // HISTORY the spec's percentile step requires, not just today's value.
  {
    const series = deriveNiftyMomentumSeries(db);
    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({
      scoreId: "l1.equity::momentum",
      value: result.value,
      status: result.status,
      derivedFrom: ["nifty50_close", "nifty50_div_yield", "gsec_10y"],
      transform: "percentile",
      latestDate: result.latestDate,
    });
  }

  // §7.1 l1.debt::valuation — real_gsec_10y (gsec_10y - cpi_yoy)
  // percentile, NOT inverted (§15.1 trap: high yield = attractive carry,
  // opposite of the equity valuation convention). gsec_10y is FRED's
  // INDIRLTLT01STM; cpi_yoy is RBI's combinedInflation column — both are
  // monthly, so subtracting them date-for-date is a reasonable real-yield
  // approximation without needing a dedicated inflation-adjusted series.
  //
  // cpi_yoy comes from two places: the RBI mirror fetches it directly but
  // only ever exposes a ~15-month window (1 stored observation as of
  // 2026-09-17), and deriveCpiYoySeries() computes it as the 12-month
  // change in cpi_index, which now backfills to 2016 via FRED. Directly
  // fetched observations win on any shared month — they are the
  // published print, not a reconstruction — and the derived series fills
  // in the rest of the history so the percentile has a real distribution
  // to rank against instead of failing the 24-observation floor outright.
  {
    const storedCpiYoy = latestObservations(db, "cpi_yoy");
    const byMonth = new Map(deriveCpiYoySeries(db).map((o) => [o.date.slice(0, 7), o]));
    for (const row of storedCpiYoy) byMonth.set(row.date.slice(0, 7), { date: row.date, value: row.value });
    const cpiYoy = [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));

    const gsecRows = latestObservations(db, "gsec_10y");
    const cpiByMonth = new Map(cpiYoy.map((o) => [o.date.slice(0, 7), o.value]));
    const realGsec: Array<{ date: string; value: number }> = [];
    for (const g of gsecRows) {
      const cpi = cpiByMonth.get(g.date.slice(0, 7));
      if (cpi === undefined) continue;
      realGsec.push({ date: g.date, value: g.value - cpi });
    }

    const result = autoScoreFromSeries(realGsec, params, "percentile");
    out.push({ scoreId: "l1.debt::valuation", value: result.value, status: result.status, derivedFrom: ["gsec_10y", "cpi_yoy"], transform: "percentile", latestDate: result.latestDate });
  }

  // §7.3 debt.gilt::carry — gsec_10y percentile, NOT inverted (high
  // yield = attractive carry).
  {
    const result = autoScore(db, "gsec_10y", params, "percentile");
    out.push({ scoreId: "debt.gilt::carry", value: result.value, status: result.status, derivedFrom: ["gsec_10y"], transform: "percentile", latestDate: result.latestDate });
  }

  // §7.3 debt.liquid::carry — tbill_1y percentile, NOT inverted. Uses the
  // RBI mirror's 183-364 day T-bill bucket (closest available match to a
  // 1y liquid-fund carry proxy — see adapters/rbi.ts).
  {
    const result = autoScore(db, "tbill_1y", params, "percentile");
    out.push({ scoreId: "debt.liquid::carry", value: result.value, status: result.status, derivedFrom: ["tbill_1y"], transform: "percentile", latestDate: result.latestDate });
  }

  // §7.3 debt.corporate::carry (aaa_3y) is NOT computable — no adapter
  // fetches AAA corporate bond yields yet (FIMMDA/CCIL, per §7.3's table,
  // has no free programmatic source found so far).

  return out;
}
