import type Database from "better-sqlite3";
import type { Params } from "@wayfinder/engine";
import { metalsFundamentalsScore } from "@wayfinder/engine";
import { autoScore, autoScoreFromSeries, derivedRatioSeries, derivedDifferenceSeries } from "./scoreEngine.js";
import { deriveRealRatesScores, deriveNiftyMomentumSeries, goldEtfHoldingsTrend, centralBankGoldBuyingTrend } from "./derive.js";
import { latestObservations } from "../store/observations.js";

export interface ScoreCellResult {
  scoreId: string;
  value: number;
  status: "ok" | "insufficient_history";
  derivedFrom: string[];
  transform: "percentile" | "inverted" | "rubric";
}

// §7 — every score cell computable end-to-end from the series this
// project's adapters (FRED, bullion/IBJA, AMFI, RBI, NSE, niftyindices)
// actually fetch as of this build. Deliberately NOT the full 85 cells:
// nse.ts covers P/E-based valuation only (nseindia.com's /api/allIndices
// has no TRI field), so sector.*::rel_momentum stays unreachable from
// that source — niftyindices.ts's Daily Snapshot carries a closing index
// VALUE per sector (sector_close_*) which COULD support relative-return
// calculation, but that derivation isn't wired here yet either (same
// "data exists, rubric wiring is separate, not-yet-built work" pattern
// as cpi_yoy/tbill_1y below). l1.equity::momentum IS now wired (see
// deriveNiftyMomentumSeries below) using a TRI approximation (no free
// real Nifty 50 TRI source exists — see derive.ts's doc comment).
// sector.capgoods now has real P/E data via niftyindices.ts (nse.ts's
// source still has no matching index, but niftyindices.ts's Daily
// Snapshot does — see that adapter's file comment). RBI now covers
// cpi_index, cpi_yoy, and tbill_1y (see adapters/rbi.ts); gsec_10y comes
// from FRED instead (the only RBI-mirror "yield" page turned out to be a
// price/turnover index, not a yield); repo_rate has no source found on
// either RBI's own portal or the mirror as of 2026-09-03. None of
// cpi_index/cpi_yoy/tbill_1y/gsec_10y are wired into a score cell here
// yet either — they feed §8.1/§8.2 macro rubrics (inflation direction,
// rate-path expectations) whose inputs are still manual selections, not
// automatically derived from a raw series trend; that derivation is
// separate, not-yet-built work. Cells this can't compute are left for
// the caller to default to 50/manual — this module never guesses.
export function computeAutoScoreCells(db: Database.Database, params: Params, asOfDate: string): ScoreCellResult[] {
  const out: ScoreCellResult[] = [];

  // §7.1 l1.equity::flows — flow_equity_3m / aum_equity, inverted (high
  // relative inflow = crowded/expensive, not attractive).
  {
    const series = derivedRatioSeries(db, "flow_equity_3m", "aum_equity");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.equity::flows", value: result.value, status: result.status, derivedFrom: ["flow_equity_3m", "aum_equity"], transform: "inverted" });
  }

  // §7.1 l1.debt::flows — flow_duration_3m / aum_duration, inverted.
  {
    const series = derivedRatioSeries(db, "flow_duration_3m", "aum_duration");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.debt::flows", value: result.value, status: result.status, derivedFrom: ["flow_duration_3m", "aum_duration"], transform: "inverted" });
  }

  // §7.1 l1.metals::flows — flow_goldetf_3m, inverted, as-is (no AUM
  // denominator specified for this cell in §7.1's table).
  {
    const result = autoScore(db, "flow_goldetf", params, "inverted");
    out.push({ scoreId: "l1.metals::flows", value: result.value, status: result.status, derivedFrom: ["flow_goldetf"], transform: "inverted" });
  }

  // §7.2 equity.{large,mid,small}::valuation — inverted index P/E, from
  // nseindia.com's /api/allIndices (see adapters/nse.ts). large uses
  // nifty100_pe (broader large-cap proxy than nifty50_pe, matching the
  // NIFTY 100 fund category AMFI's flow cells already key off of); mid
  // and small use the exact NSE index the §7.2 table names.
  // equity.intl::valuation stays manual — no source for that segment.
  {
    const result = autoScore(db, "nifty100_pe", params, "inverted");
    out.push({ scoreId: "equity.large::valuation", value: result.value, status: result.status, derivedFrom: ["nifty100_pe"], transform: "inverted" });
  }
  {
    const result = autoScore(db, "midcap150_pe", params, "inverted");
    out.push({ scoreId: "equity.mid::valuation", value: result.value, status: result.status, derivedFrom: ["midcap150_pe"], transform: "inverted" });
  }
  {
    const result = autoScore(db, "smallcap250_pe", params, "inverted");
    out.push({ scoreId: "equity.small::valuation", value: result.value, status: result.status, derivedFrom: ["smallcap250_pe"], transform: "inverted" });
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
    out.push({ scoreId: `sector.${sector}::valuation`, value: result.value, status: result.status, derivedFrom: [seriesId], transform: "inverted" });
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
    out.push({ scoreId: "metals.gold::ratio_position", value: goldResult.value, status: goldResult.status, derivedFrom, transform: "inverted" });
    const silverResult = autoScoreFromSeries(ratioSeries, params, "percentile");
    out.push({ scoreId: "metals.silver::ratio_position", value: silverResult.value, status: silverResult.status, derivedFrom, transform: "percentile" });
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
      out.push({
        scoreId: "l1.metals::fundamentals",
        value,
        status: "ok",
        derivedFrom: ["cb_gold_reserves_tonnes", "gold_etf_shares_outstanding"],
        transform: "rubric",
      });
    }
  }

  // §7.4 metals.gold::momentum / l1.metals::momentum — gold_return_12m,
  // percentile as-is. Approximated here as the gold_inr series' own
  // percentile (a genuine 12m-return series isn't separately computed
  // yet — flagged as an approximation, not silently treated as exact).
  {
    const result = autoScore(db, "gold_inr", params, "percentile");
    out.push({ scoreId: "l1.metals::momentum", value: result.value, status: result.status, derivedFrom: ["gold_inr"], transform: "percentile" });
  }

  // §8.4 — real rates rubric, already wired end-to-end (Phase 2's gating
  // path): metals.gold::real_rates, metals.silver::real_rates,
  // l1.metals::macro.
  const realRates = deriveRealRatesScores(db, asOfDate);
  if (realRates) {
    for (const [scoreId, value] of Object.entries(realRates)) {
      out.push({ scoreId, value, status: "ok", derivedFrom: ["us_real_10y"], transform: "rubric" });
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
    });
  }

  // §7.1 l1.debt::valuation — real_gsec_10y (gsec_10y - cpi_yoy)
  // percentile, NOT inverted (§15.1 trap: high yield = attractive carry,
  // opposite of the equity valuation convention). gsec_10y is FRED's
  // INDIRLTLT01STM; cpi_yoy is RBI's combinedInflation column — both are
  // monthly, so subtracting them date-for-date is a reasonable real-yield
  // approximation without needing a dedicated inflation-adjusted series.
  {
    const realGsec = derivedDifferenceSeries(db, "gsec_10y", "cpi_yoy");
    const result = autoScoreFromSeries(realGsec, params, "percentile");
    out.push({ scoreId: "l1.debt::valuation", value: result.value, status: result.status, derivedFrom: ["gsec_10y", "cpi_yoy"], transform: "percentile" });
  }

  // §7.3 debt.gilt::carry — gsec_10y percentile, NOT inverted (high
  // yield = attractive carry).
  {
    const result = autoScore(db, "gsec_10y", params, "percentile");
    out.push({ scoreId: "debt.gilt::carry", value: result.value, status: result.status, derivedFrom: ["gsec_10y"], transform: "percentile" });
  }

  // §7.3 debt.liquid::carry — tbill_1y percentile, NOT inverted. Uses the
  // RBI mirror's 183-364 day T-bill bucket (closest available match to a
  // 1y liquid-fund carry proxy — see adapters/rbi.ts).
  {
    const result = autoScore(db, "tbill_1y", params, "percentile");
    out.push({ scoreId: "debt.liquid::carry", value: result.value, status: result.status, derivedFrom: ["tbill_1y"], transform: "percentile" });
  }

  // §7.3 debt.corporate::carry (aaa_3y) is NOT computable — no adapter
  // fetches AAA corporate bond yields yet (FIMMDA/CCIL, per §7.3's table,
  // has no free programmatic source found so far).

  return out;
}
