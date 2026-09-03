import type Database from "better-sqlite3";
import type { Params } from "@wayfinder/engine";
import { autoScore, autoScoreFromSeries, derivedRatioSeries } from "./scoreEngine.js";
import { deriveRealRatesScores } from "./derive.js";

export interface ScoreCellResult {
  scoreId: string;
  value: number;
  status: "ok" | "insufficient_history";
  derivedFrom: string[];
  transform: "percentile" | "inverted" | "rubric";
}

// §7 — every score cell computable end-to-end from the series this
// project's adapters (FRED, bullion/IBJA, AMFI) actually fetch as of this
// build. Deliberately NOT the full 85 cells: NSE (~19 cells) and RBI
// beyond CPI (repo_rate, gsec_10y, tbill_1y — the mirror's page-per-series
// scrape only covers CPI so far, see adapters/rbi.ts) aren't wired into
// the refresh route yet. Cells this can't compute are left for the
// caller to default to 50/manual — this module never guesses.
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

  // §7.2 equity.{large,mid,small}::valuation — inverted index P/E.
  // NOT computable: NSE P/E series (nifty100_pe etc.) aren't fetched by
  // any working adapter yet.

  // §7.4 metals.gold::ratio_position / metals.silver::ratio_position —
  // gold_silver_ratio, inverted for gold / as-is for silver.
  {
    const ratioSeries = derivedRatioSeries(db, "gold_inr", "silver_inr");
    const goldResult = autoScoreFromSeries(ratioSeries, params, "inverted");
    out.push({ scoreId: "metals.gold::ratio_position", value: goldResult.value, status: goldResult.status, derivedFrom: ["gold_inr", "silver_inr"], transform: "inverted" });
    const silverResult = autoScoreFromSeries(ratioSeries, params, "percentile");
    out.push({ scoreId: "metals.silver::ratio_position", value: silverResult.value, status: silverResult.status, derivedFrom: ["gold_inr", "silver_inr"], transform: "percentile" });
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

  // §7.1 l1.debt::valuation — real_gsec_10y percentile, NOT inverted
  // (§15.1 trap: high yield = attractive carry). NOT computable yet:
  // gsec_10y isn't fetched by the RBI adapter's current single-page
  // scrape (CPI only) — see adapters/rbi.ts's RBI_PAGES.

  return out;
}
