import type Database from "better-sqlite3";
import type { Params } from "@wayfinder/engine";
import { metalsFundamentalsScore, silverIndustrialScore, equityMacroScore, debtMacroScore, growthDiffScore, type RubricInput } from "@wayfinder/engine";
import { autoScore, autoScoreFromSeries, derivedDifferenceSeries, derivedRatioSeries } from "./scoreEngine.js";
import { computePercentile, historySpanYears, monthEndSample, windowedHistory } from "./percentile.js";
import {
  deriveRealRatesScores,
  deriveNiftyMomentumSeries,
  goldEtfHoldingsTrend,
  centralBankGoldBuyingTrend,
  deriveEarningsYieldGapSeries,
  deriveIndiaUsValuationGapSeries,
  deriveNiftyPeSeries,
  deriveFlowRatio3mSeries,
  deriveRealGoldPriceSeries,
  deriveCpiYoySeries,
  deriveRealGsec10ySeries,
  deriveBondIndexReturn12mSeries,
  deriveFlowMean3mSeries,
  rbiPathFromRepoRate,
  inflationVsTargetFromCpi,
  deriveGoldReturn12mSeries,
  deriveGoldSilverRatio20ySeries,
  deriveMidLargeSpreadSeries,
  deriveSmallLargeSpreadSeries,
  deriveTrailingEps3mChangeSeries,
  deriveSegmentGrowthGapSeries,
  deriveIntlGrowthGapSeries,
  deriveSectorRelMomentumSeries,
  globalMfgPmiReadings,
  rbiStanceFromRepoRate,
  inflationDirFromCpi,
  rbiStanceEvidence,
  inflationDirEvidence,
} from "./derive.js";
import { latestObservations } from "../store/observations.js";
import { SP500_TRAILING_PE_SERIES_ID } from "../adapters/multpl.js";

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
  // RUBRIC cells only: which option each field resolved to, and the
  // reading behind it. A rubric score is a sum of discrete choices, so
  // the final number cannot be checked without them.
  rubricInputs?: RubricInput[];
  // PERCENTILE cells whose spec names a window (e.g. "vs its own 10Y
  // history"): the calendar span actually ranked against, and whether it
  // falls short of params.percentileWindowYears. Observation COUNT
  // cannot stand in for this — 81 daily rows clear a 24-row floor while
  // covering 3 months. Surfaced so a thin-history percentile is visibly
  // provisional instead of quietly wearing a decade's confidence.
  historySpanYears?: number;
  historyShortfall?: boolean;
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
// l1.debt::momentum is now wired via deriveBondIndexReturn12mSeries
// (NSE's "Nifty Composite G-sec Index" in the niftyindices Daily
// Snapshot — the spec's "CRISIL/NIFTY composite bond index"; CRISIL's own
// indices are paywalled, this one is not). Cells this can't compute are left for the
// caller to default to 50/manual — this module never guesses.
export function computeAutoScoreCells(db: Database.Database, params: Params, asOfDate: string): ScoreCellResult[] {
  const out: ScoreCellResult[] = [];

  // §7.1 l1.equity::flows — 3-MONTH AVERAGE of net flows / aum_equity,
  // inverted (high relative inflow = crowded/expensive, not attractive).
  //
  // The 3M average is applied by deriveFlowRatio3mSeries, NOT by the
  // adapter: `flow_equity_3m` holds a single month's flow despite its
  // name (see that function's comment and adapters/amfi.ts). This cell
  // previously percentiled the raw monthly ratio, making a contrarian
  // signal far noisier than the spec intends.
  {
    const series = deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.equity::flows", value: result.value, status: result.status, derivedFrom: ["flow_equity_3m", "aum_equity"], transform: "inverted", latestDate: result.latestDate });
  }

  // §7.1 l1.debt::flows — same 3M-average treatment as equity above;
  // flow_duration_3m is likewise a single month's flow from the same
  // AMFI sub-total parse.
  {
    const series = deriveFlowRatio3mSeries(db, "flow_duration_3m", "aum_duration");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.debt::flows", value: result.value, status: result.status, derivedFrom: ["flow_duration_3m", "aum_duration"], transform: "inverted", latestDate: result.latestDate });
  }

  // §7.1 l1.debt::momentum — composite bond index 12M return,
  // percentile AS-IS (not inverted: a rising bond index is positive
  // momentum for debt).
  {
    const series = deriveBondIndexReturn12mSeries(db);
    if (series.length > 0) {
      const result = autoScoreFromSeries(series, params, "percentile");
      out.push({ scoreId: "l1.debt::momentum", value: result.value, status: result.status, derivedFrom: ["bond_index_close"], transform: "percentile", latestDate: result.latestDate });
    }
  }

  // §7.1 l1.metals::flows — 3M AVERAGE of gold ETF net flows, inverted.
  // No AUM denominator: unlike the equity and debt flow cells, the spec
  // ("Indian gold ETF net flows (AMFI), 3M avg, percentile vs history,
  // INVERTED") specifies none, so none is invented.
  //
  // The 3M averaging is applied HERE, not by the adapter: flow_goldetf
  // holds one month's flow, exactly like flow_equity_3m. This cell used
  // to percentile that raw monthly number — the same defect already
  // fixed for l1.equity::flows and l1.debt::flows.
  {
    const series = deriveFlowMean3mSeries(db, "flow_goldetf");
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.metals::flows", value: result.value, status: result.status, derivedFrom: ["flow_goldetf"], transform: "inverted", latestDate: result.latestDate });
  }

  // §8.1 (Calculation Guide row 7) l1.equity::valuation — TWO parts,
  // then averaged:
  //   (a) earnings-yield gap = (100 / Nifty 50 trailing P/E) - 10Y G-sec
  //       yield, percentile vs history, AS-IS (high gap = equity cheap
  //       vs bonds = attractive).
  //   (b) Nifty 50 P/E percentile vs its own 10-15Y history, INVERTED
  //       (expensive is not attractive).
  //   final = (a + b) / 2.
  //
  // Part (b) was missing until now and the cell returned (a) alone. The
  // two parts do NOT move together: a rising P/E lowers the earnings
  // yield AND raises the P/E percentile, so both fall — but at rates that
  // depend on where the bond yield sits, which is exactly the
  // equity-vs-bonds information part (a) contributes and part (b) can't.
  // In the source spec's own worked example the difference is 30 vs 38.
  //
  // Both parts must clear percentileMinObservations independently. If
  // either is short, the cell reports insufficient_history at the neutral
  // 50 rather than silently scoring on whichever half happens to be
  // ready — a half-computed average is a different statistic, not a
  // rougher version of the specified one (§1 invariant 4).
  {
    const gapResult = autoScoreFromSeries(deriveEarningsYieldGapSeries(db), params, "percentile");
    const peResult = autoScoreFromSeries(deriveNiftyPeSeries(db), params, "inverted");
    const derivedFrom = ["nifty50_pe", "gsec_10y"];

    if (gapResult.status === "ok" && peResult.status === "ok") {
      // Same "stalest input wins" freshness rule as equity.large::relvalue
      // and l1.metals::fundamentals below.
      const latestDate = [gapResult.latestDate, peResult.latestDate].filter((d): d is string => d !== null).sort()[0] ?? null;
      out.push({
        scoreId: "l1.equity::valuation",
        value: (gapResult.value + peResult.value) / 2,
        status: "ok",
        derivedFrom,
        transform: "average",
        latestDate,
      });
    } else {
      out.push({
        scoreId: "l1.equity::valuation",
        value: 50,
        status: "insufficient_history",
        derivedFrom,
        transform: "average",
        latestDate: null,
      });
    }
  }

  // §8.4 (Calculation Guide row 21) l1.metals::valuation — real INR gold
  // price (gold_inr deflated by cpi_index), percentile vs history,
  // INVERTED (expensive in real terms = unattractive).
  {
    const series = deriveRealGoldPriceSeries(db);
    const result = autoScoreFromSeries(series, params, "inverted");
    out.push({ scoreId: "l1.metals::valuation", value: result.value, status: result.status, derivedFrom: ["gold_inr", "cpi_index"], transform: "inverted", latestDate: result.latestDate });
  }

  // Calculation Guide "Valuation vs own history" —
  // equity.{large,mid,small}::valuation. "Segment index trailing P/E
  // percentile vs its own 10-15Y MONTHLY history, INVERTED:
  // attractiveness = 100 - PERCENTRANK x 100. Optionally average with
  // the same on P/B."
  //
  // Two corrections to the earlier implementation, both of which changed
  // live scores materially (verified 2026-09-20):
  //
  // 1. THE WINDOW. This used autoScore(), which ranks against EVERY
  //    stored row with no windowing and no span guard. Stored P/E history
  //    started 2024-08 (backfill.ts's niftyIndices default is 760 days),
  //    so "vs its own 10-15Y history" was being answered by a 2.1-year
  //    window. Large and mid scored 97.99 and 97.37 — a claim that both
  //    segments were at their cheapest in a decade, off two years of data.
  //    The niftyindices Daily Snapshot CSV turned out to reach back to
  //    2016 (confirmed live), so the history now genuinely spans ~10.4y.
  //
  // 2. THE SAMPLING. The spec says MONTHLY history and percentile rank is
  //    computed over stored rows, so mixing a month-end backfill with a
  //    daily refresh weights the recent period ~20x per unit of calendar
  //    time (12 rows/year pre-2024 vs 124/309/221 for 2024/25/26).
  //    midcap150_pb's percentile read 17.2 daily and 77.1 monthly on that
  //    bias alone. monthEndSample() makes each month count once, which is
  //    what the workbook's PERCENTRANK over a monthly column computes.
  //
  // The P/B leg is the spec's "optionally average with the same on P/B",
  // applied wherever a real P/B series exists — all three segments as of
  // 2026-09-20 (nifty100_pb was newly mapped in adapters/niftyindices.ts;
  // the column was in the CSV all along). Each leg is percentiled on its
  // OWN history and inverted, then the two are averaged, per the spec's
  // "the same on P/B" (average the SCORES, not the raw multiples, which
  // are not commensurable). A segment whose P/B is missing or too short
  // scores on P/E alone and says so via derivedFrom rather than dropping
  // to 50 — one leg of a spec-optional average is still the spec.
  const MIN_VALUATION_HISTORY_YEARS = 1.5; // same floor/reasoning as sector.*::valuation below
  for (const [segment, peSeriesId, pbSeriesId] of [
    ["large", "nifty100_pe", "nifty100_pb"],
    ["mid", "midcap150_pe", "midcap150_pb"],
    ["small", "smallcap250_pe", "smallcap250_pb"],
  ] as const) {
    const scoreId = `equity.${segment}::valuation`;

    const legScore = (seriesId: string) => {
      const windowed = monthEndSample(
        windowedHistory(latestObservations(db, seriesId), params.percentileWindowYears, asOfDate, null)
      );
      const spanYears = historySpanYears(windowed);
      if (spanYears < MIN_VALUATION_HISTORY_YEARS) return null;
      const result = autoScoreFromSeries(windowed, params, "inverted");
      if (result.status !== "ok") return null;
      return { ...result, spanYears };
    };

    const pe = legScore(peSeriesId);
    const pb = legScore(pbSeriesId);

    if (pe === null && pb === null) {
      const windowed = monthEndSample(
        windowedHistory(latestObservations(db, peSeriesId), params.percentileWindowYears, asOfDate, null)
      );
      out.push({
        scoreId,
        value: 50,
        status: "insufficient_history",
        derivedFrom: [peSeriesId],
        transform: "inverted",
        latestDate: windowed[windowed.length - 1]?.date ?? null,
        historySpanYears: historySpanYears(windowed),
        historyShortfall: true,
      });
      continue;
    }

    const legs = [pe, pb].filter((l): l is NonNullable<typeof l> => l !== null);
    const value = legs.reduce((sum, l) => sum + l.value, 0) / legs.length;
    const derivedFrom: string[] = [];
    if (pe !== null) derivedFrom.push(peSeriesId);
    if (pb !== null) derivedFrom.push(pbSeriesId);
    // Freshness is bounded by the STALEST leg — the same "the whole is
    // only as fresh as its stalest part" rule as equity.large::relvalue.
    const latestDate = legs.map((l) => l.latestDate).filter((d): d is string => d !== null).sort()[0] ?? null;
    const spanYears = Math.min(...legs.map((l) => l.spanYears));

    out.push({
      scoreId,
      value,
      status: "ok",
      derivedFrom,
      transform: legs.length > 1 ? "average" : "inverted",
      latestDate,
      historySpanYears: spanYears,
      historyShortfall: spanYears < params.percentileWindowYears,
    });
  }

  // Calculation Guide "Valuation vs own history" (International) —
  // equity.intl::valuation. "International: use S&P 500 forward P/E vs
  // its own history, inverted; then subtract 5-10 points if the India-US
  // valuation gap is at an extreme favouring India, add if favouring US."
  //
  // DOCUMENTED DEVIATION: this ranks S&P 500 TRAILING P/E, not forward.
  // multpl.com publishes no forward series, and our own Yahoo-derived
  // sp500_fwd_pe is latest-only (6 distinct dates as of 2026-09-20) so it
  // cannot support a "vs its own history" percentile for years. Ranking
  // trailing against its own trailing history is internally consistent;
  // the full reasoning and the ~40% level difference are in
  // adapters/multpl.ts. Recorded in derivedFrom so the series name itself
  // says "trailing" wherever the cell is displayed.
  //
  // The gap adjustment uses the gap's own percentile rather than a fixed
  // P/E-point threshold, because both markets' multiples drift over a
  // decade. "Extreme" = the top/bottom decile of the gap's own 10Y
  // history, and the spec's "5-10 points" is applied at its midpoint
  // magnitude for a normal extreme and its full magnitude beyond the 5th/
  // 95th percentile — a coarse two-step rather than a continuous function,
  // matching the workbook's own "deliberately coarse" note on rubrics.
  // A LOW gap (India cheap vs US) favours India, so it SUBTRACTS from the
  // international score; a HIGH gap favours the US and ADDS.
  {
    const scoreId = "equity.intl::valuation";
    const peWindowed = monthEndSample(
      windowedHistory(latestObservations(db, SP500_TRAILING_PE_SERIES_ID), params.percentileWindowYears, asOfDate, null)
    );
    const peSpanYears = historySpanYears(peWindowed);
    const peResult = autoScoreFromSeries(peWindowed, params, "inverted");

    if (peSpanYears < MIN_VALUATION_HISTORY_YEARS || peResult.status !== "ok") {
      out.push({
        scoreId,
        value: 50,
        status: "insufficient_history",
        derivedFrom: [SP500_TRAILING_PE_SERIES_ID],
        transform: "inverted",
        latestDate: peWindowed[peWindowed.length - 1]?.date ?? null,
        historySpanYears: peSpanYears,
        historyShortfall: true,
      });
    } else {
      const gapSeries = monthEndSample(
        windowedHistory(deriveIndiaUsValuationGapSeries(db), params.percentileWindowYears, asOfDate, null)
      );
      const gapSpanYears = historySpanYears(gapSeries);
      let adjustment = 0;
      const derivedFrom = [SP500_TRAILING_PE_SERIES_ID];

      // The adjustment is reported as a rubricInput, not left for the UI
      // to re-derive. It is selected by the gap's percentile over the 10Y
      // MONTH-END window computed here, which is NOT the percentile
      // published on the series (that one is computed over the entire
      // stored history — 10.2 vs 3.4 live on 2026-09-20). A trace that
      // recomputed the band from the published percentile would have
      // shown -5 beside a score built with -10, breaking §8 invariant 6.
      let gapInput: RubricInput = {
        field: "India-US valuation gap",
        selected: null,
        delta: 0,
        basis: "No India-US gap history is available, so no adjustment is applied rather than guessing a direction.",
        assumed: true,
      };

      // The gap leg is OPTIONAL in effect: if it cannot be measured, the
      // cell scores on the S&P percentile alone with a zero adjustment
      // rather than guessing a direction (§1 invariant 3 — never pick a
      // side on an unsourced input).
      if (gapSpanYears >= MIN_VALUATION_HISTORY_YEARS) {
        const gapPct = computePercentile(
          gapSeries.map((o) => o.value),
          gapSeries[gapSeries.length - 1]!.value,
          params.percentileMinObservations
        );
        if (gapPct.status === "ok" && gapPct.percentile !== null) {
          const p = gapPct.percentile;
          if (p <= 5) adjustment = -10;
          else if (p <= 10) adjustment = -5;
          else if (p >= 95) adjustment = 10;
          else if (p >= 90) adjustment = 5;
          derivedFrom.push("nifty100_pe");

          const gapValue = gapSeries[gapSeries.length - 1]!.value;
          gapInput = {
            field: "India-US valuation gap",
            selected:
              adjustment < 0
                ? "Extreme favouring India"
                : adjustment > 0
                  ? "Extreme favouring US"
                  : "Not at an extreme",
            delta: adjustment,
            basis: `nifty100_pe - sp500_trailing_pe = ${gapValue.toFixed(2)}, at the ${p.toFixed(1)}th percentile of its own 10Y month-end history`,
          };
        }
      }

      out.push({
        scoreId,
        value: Math.max(0, Math.min(100, peResult.value + adjustment)),
        status: "ok",
        derivedFrom,
        transform: "inverted",
        latestDate: peResult.latestDate,
        historySpanYears: peSpanYears,
        historyShortfall: peSpanYears < params.percentileWindowYears,
        rubricInputs: [
          {
            field: "S&P 500 trailing P/E percentile (inverted)",
            selected: `${(100 - peResult.value).toFixed(1)}th percentile`,
            delta: peResult.value,
            basis: `sp500_trailing_pe ranked against its own ${peSpanYears.toFixed(1)}y month-end history; TRAILING P/E substituted for the spec's forward P/E (see adapters/multpl.ts)`,
          },
          gapInput,
        ],
      });
    }
  }

  // Calculation Guide row 29 / Data Trackers rows 5-8 —
  // equity.{large,mid,small}::relvalue. "Mid Cap score = 100 − Mid
  // Spread %ile. Small Cap score = 100 − Small Spread %ile. Large Cap
  // score = average of the two raw spread %iles" (i.e. NOT inverted for
  // Large — a wide spread favoring Large means Large itself looks
  // relatively cheap, so Large's score moves WITH the spread percentile,
  // opposite of Mid/Small's own "high spread = expensive vs Large" framing).
  //
  // Windowed to the same 10Y month-end treatment as
  // equity.{large,mid,small,intl}::valuation and equity.intl::relvalue —
  // previously this ranked the raw spread against its ENTIRE stored
  // history with no window cap and no month-end sampling, which is
  // exactly the "row count != calendar span" failure mode documented on
  // equity.*::valuation: a short or unevenly-sampled window can clear the
  // 24-row floor while covering far less than 10 years, or weight recent
  // daily rows ~20:1 against older month-end ones per unit of calendar
  // time.
  {
    const midSpread = monthEndSample(windowedHistory(deriveMidLargeSpreadSeries(db), params.percentileWindowYears, asOfDate, null));
    const smallSpread = monthEndSample(windowedHistory(deriveSmallLargeSpreadSeries(db), params.percentileWindowYears, asOfDate, null));
    const midSpanYears = historySpanYears(midSpread);
    const smallSpanYears = historySpanYears(smallSpread);
    const midResult = autoScoreFromSeries(midSpread, params, "inverted");
    const smallResult = autoScoreFromSeries(smallSpread, params, "inverted");
    out.push({
      scoreId: "equity.mid::relvalue",
      value: midResult.value,
      status: midResult.status,
      derivedFrom: ["midcap150_pe", "nifty100_pe"],
      transform: "inverted",
      latestDate: midResult.latestDate,
      historySpanYears: midSpanYears,
      historyShortfall: midSpanYears < params.percentileWindowYears,
    });
    out.push({
      scoreId: "equity.small::relvalue",
      value: smallResult.value,
      status: smallResult.status,
      derivedFrom: ["smallcap250_pe", "nifty100_pe"],
      transform: "inverted",
      latestDate: smallResult.latestDate,
      historySpanYears: smallSpanYears,
      historyShortfall: smallSpanYears < params.percentileWindowYears,
    });

    if (midResult.status === "ok" && smallResult.status === "ok") {
      const midRawPercentile = 100 - midResult.value;
      const smallRawPercentile = 100 - smallResult.value;
      const largeValue = (midRawPercentile + smallRawPercentile) / 2;
      // Large's freshness is bounded by whichever of the two inputs is
      // staler, same "the whole is only as fresh as its stalest part"
      // reasoning as elsewhere in this function.
      const largeLatestDate = [midResult.latestDate, smallResult.latestDate].sort()[0] ?? null;
      const largeSpanYears = Math.min(midSpanYears, smallSpanYears);
      out.push({
        scoreId: "equity.large::relvalue",
        value: largeValue,
        status: "ok",
        derivedFrom: ["midcap150_pe", "smallcap250_pe", "nifty100_pe"],
        transform: "average",
        latestDate: largeLatestDate,
        historySpanYears: largeSpanYears,
        historyShortfall: largeSpanYears < params.percentileWindowYears,
      });
    } else {
      out.push({ scoreId: "equity.large::relvalue", value: 50, status: "insufficient_history", derivedFrom: ["midcap150_pe", "smallcap250_pe", "nifty100_pe"], transform: "average", latestDate: null, historyShortfall: true });
    }
  }

  // Calculation Guide "Earnings revision breadth" (per segment) —
  // equity.{large,mid,small}::revisions. DOCUMENTED SUBSTITUTE: 3M change
  // in segment trailing EPS (index close ÷ trailing P/E), percentiled
  // AS-IS against its own 10Y month-end history, in place of the spec's
  // upgrade/downgrade breadth or consensus-EPS-revision fallback — neither
  // is free-sourced for any Indian segment. This is the SAME substitute
  // already built and explicitly REJECTED for sector.*::revisions (see
  // docs/missing_data_points/sector-satellite.md): trailing EPS moves on
  // REPORTING, consensus EPS moves on REVISION, and the two can disagree
  // exactly at cycle turns. Wired here on explicit instruction despite
  // that prior rejection — `derivedFrom` names the real close/P/E legs,
  // never a fabricated "consensus_eps" series id, and the trace states the
  // deviation plainly so a reader can't mistake this for the spec's own
  // breadth figure. equity.intl::revisions has no equivalent proxy (no
  // global consensus EPS source, and Nifty-100-close/S&P-close indices
  // aren't a like-for-like earnings comparison) and is left as a manual
  // analyst-input cell.
  {
    const segments: Array<{ scoreId: string; closeId: string; peId: string }> = [
      { scoreId: "equity.large::revisions", closeId: "nifty100_close", peId: "nifty100_pe" },
      { scoreId: "equity.mid::revisions", closeId: "midcap150_close", peId: "midcap150_pe" },
      { scoreId: "equity.small::revisions", closeId: "smallcap250_close", peId: "smallcap250_pe" },
    ];
    for (const seg of segments) {
      const series = monthEndSample(
        windowedHistory(deriveTrailingEps3mChangeSeries(db, seg.closeId, seg.peId), params.percentileWindowYears, asOfDate, null)
      );
      const spanYears = historySpanYears(series);
      const result = autoScoreFromSeries(series, params, "percentile");
      if (spanYears < MIN_VALUATION_HISTORY_YEARS || result.status !== "ok") {
        out.push({
          scoreId: seg.scoreId,
          value: 50,
          status: "insufficient_history",
          derivedFrom: [seg.closeId, seg.peId],
          transform: "percentile",
          latestDate: series[series.length - 1]?.date ?? null,
          historySpanYears: spanYears,
          historyShortfall: true,
        });
      } else {
        out.push({
          scoreId: seg.scoreId,
          value: result.value,
          status: "ok",
          derivedFrom: [seg.closeId, seg.peId],
          transform: "percentile",
          latestDate: result.latestDate,
          historySpanYears: spanYears,
          historyShortfall: spanYears < params.percentileWindowYears,
          rubricInputs: [
            {
              field: "3M change in segment trailing EPS (documented substitute for breadth/consensus EPS revision)",
              selected: `${result.value.toFixed(1)}th percentile of 3M trailing-EPS change`,
              delta: result.value,
              basis: `${seg.closeId} ÷ ${seg.peId} trailing EPS, 3M change, ranked against its own ${spanYears.toFixed(1)}y month-end history. Trailing EPS moves on reporting, not analyst revision — see docs/missing_data_points/sector-satellite.md for why this substitute was rejected for sector cells and is a documented deviation here.`,
            },
          ],
        });
      }
    }
  }

  // Calculation Guide "Earnings growth differential" — equity.{mid,small}::
  // growth_diff. Spec: "segment consensus FY+1 EPS growth minus Large
  // Cap's," through growthDiffScore()'s fixed bands (≥+8pp:75, +3-8:60,
  // -3..+3:50, -8..-3:40, <-8:25). equity.large::growth_diff stays the
  // structural constant (zero gap by construction, see
  // dataPointRegistry.ts) — NOT touched here.
  //
  // DOCUMENTED SUBSTITUTE, same shape as the revisions cells above: 12M
  // (YoY — growth is a year-over-year concept, unlike revisions' 3M
  // window) change in segment trailing EPS, minus the same YoY change in
  // Nifty 100's own trailing EPS (deriveSegmentGrowthGapSeries). This is
  // reported earnings growth, not analysts' FY+1 estimate, and can
  // disagree with it at cycle turns — see docs/missing_data_points/
  // equity-segments.md. This is a RUBRIC cell (a banded lookup, not a
  // percentile), so the LATEST gap value drives the score directly, no
  // percentile step — matching the spec's own rubric construction exactly
  // (unlike revisions, which the spec treats as percentile-vs-history).
  {
    const segments: Array<{ scoreId: string; closeId: string; peId: string }> = [
      { scoreId: "equity.mid::growth_diff", closeId: "midcap150_close", peId: "midcap150_pe" },
      { scoreId: "equity.small::growth_diff", closeId: "smallcap250_close", peId: "smallcap250_pe" },
    ];
    for (const seg of segments) {
      const series = deriveSegmentGrowthGapSeries(db, seg.closeId, seg.peId);
      const latest = series[series.length - 1];
      if (!latest) {
        out.push({
          scoreId: seg.scoreId,
          value: 50,
          status: "insufficient_history",
          derivedFrom: [seg.closeId, seg.peId, "nifty100_close", "nifty100_pe"],
          transform: "rubric",
          latestDate: null,
        });
        continue;
      }
      const value = growthDiffScore(latest.value, seg.scoreId === "equity.mid::growth_diff" ? "mid" : "small");
      out.push({
        scoreId: seg.scoreId,
        value,
        status: "ok",
        derivedFrom: [seg.closeId, seg.peId, "nifty100_close", "nifty100_pe"],
        transform: "rubric",
        latestDate: latest.date,
        rubricInputs: [
          {
            field: "Segment 12M trailing-EPS growth minus Large Cap's (documented substitute for consensus FY+1 EPS growth gap)",
            selected: `${latest.value.toFixed(1)}pp gap`,
            delta: value - 50,
            basis: `${seg.closeId} ÷ ${seg.peId} trailing EPS, 12M change, minus the same for nifty100_close ÷ nifty100_pe, as of ${latest.date}. Trailing EPS growth, not analyst consensus FY+1 growth — see docs/missing_data_points/equity-segments.md.`,
          },
        ],
      });
    }
  }

  // Calculation Guide "Earnings growth differential" (International) —
  // equity.intl::growth_diff. Spec: "US EPS growth minus India's," same
  // growthDiffScore() bands, PLUS a +5 structural INR-depreciation bonus
  // (applied here, after the band lookup, per the spec's own ordering).
  //
  // TWO STACKED DEVIATIONS — see adapters/multpl.ts's header comment for
  // the full reasoning: (1) trailing vs consensus, same class as the
  // segment cells above; (2) REAL US EPS growth (multpl.com's EPS page is
  // inflation-adjusted) vs NOMINAL India EPS growth (no deflator on the
  // INR leg). Both stated in rubricInputs[].basis and the trace, not just
  // in code comments.
  {
    const series = deriveIntlGrowthGapSeries(db);
    const latest = series[series.length - 1];
    if (!latest) {
      out.push({
        scoreId: "equity.intl::growth_diff",
        value: 50,
        status: "insufficient_history",
        derivedFrom: ["sp500_trailing_eps_real", "nifty100_close", "nifty100_pe"],
        transform: "rubric",
        latestDate: null,
      });
    } else {
      const bandValue = growthDiffScore(latest.value, "intl"); // already includes the +5 intl bonus
      out.push({
        scoreId: "equity.intl::growth_diff",
        value: bandValue,
        status: "ok",
        derivedFrom: ["sp500_trailing_eps_real", "nifty100_close", "nifty100_pe"],
        transform: "rubric",
        latestDate: latest.date,
        rubricInputs: [
          {
            field: "US 12M trailing-EPS growth (real) minus India's (nominal) (documented substitute for consensus FY+1 EPS growth gap), +5 structural INR-depreciation bonus",
            selected: `${latest.value.toFixed(1)}pp gap`,
            delta: bandValue - 50,
            basis: `sp500_trailing_eps_real 12M change (multpl.com, inflation-adjusted) minus nifty100_close ÷ nifty100_pe 12M change (nominal INR), as of ${latest.date}. Trailing, not consensus FY+1; real US growth vs nominal India growth — see adapters/multpl.ts and docs/missing_data_points/equity-segments.md.`,
          },
        ],
      });
    }
  }

  // Calculation Guide row 29, International sub-case — equity.intl::relvalue.
  // "International = 100 − percentile of (S&P fwd P/E − Nifty fwd P/E)
  // spread vs history."
  //
  // DOCUMENTED DEVIATION, same reasoning as equity.intl::valuation above:
  // sp500_fwd_pe is latest-only (15 rows over 5 days as of 2026-09-20),
  // far short of a spread history, so this ranks TRAILING P/E on both legs
  // via deriveIndiaUsValuationGapSeries (nifty100_pe - sp500_trailing_pe),
  // the same series equity.intl::valuation's gap adjustment already uses.
  //
  // Sign identity: deriveIndiaUsValuationGapSeries returns Nifty - S&P
  // (call it G). The spec ranks S&P - Nifty = -G. For PERCENTRANK,
  // percentile(-G_now in -G_hist) = 100 - percentile(G_now in G_hist)
  // (negation reverses rank order exactly). So:
  //   relvalue = 100 - percentile(-G) = 100 - (100 - percentile(G)) = percentile(G)
  // i.e. this is the plain AS-IS percentile of the existing Nifty-S&P gap
  // series — no separate negated series needed, and no double-inversion
  // bug from naively wiring "inverted" on top of the existing series.
  {
    const scoreId = "equity.intl::relvalue";
    const gapSeries = monthEndSample(
      windowedHistory(deriveIndiaUsValuationGapSeries(db), params.percentileWindowYears, asOfDate, null)
    );
    const gapSpanYears = historySpanYears(gapSeries);
    const gapResult = autoScoreFromSeries(gapSeries, params, "percentile");

    if (gapSpanYears < MIN_VALUATION_HISTORY_YEARS || gapResult.status !== "ok") {
      out.push({
        scoreId,
        value: 50,
        status: "insufficient_history",
        derivedFrom: ["nifty100_pe", SP500_TRAILING_PE_SERIES_ID],
        transform: "percentile",
        latestDate: gapSeries[gapSeries.length - 1]?.date ?? null,
        historySpanYears: gapSpanYears,
        historyShortfall: true,
      });
    } else {
      out.push({
        scoreId,
        value: gapResult.value,
        status: "ok",
        derivedFrom: ["nifty100_pe", SP500_TRAILING_PE_SERIES_ID],
        transform: "percentile",
        latestDate: gapResult.latestDate,
        historySpanYears: gapSpanYears,
        historyShortfall: gapSpanYears < params.percentileWindowYears,
        rubricInputs: [
          {
            field: "S&P 500 minus Nifty 100 trailing P/E spread percentile",
            selected: `${gapResult.value.toFixed(1)}th percentile of (Nifty100 P/E − S&P trailing P/E)`,
            delta: gapResult.value,
            basis: `nifty100_pe - sp500_trailing_pe ranked against its own ${gapSpanYears.toFixed(1)}y month-end history; TRAILING P/E substituted for the spec's forward P/E on both legs (see adapters/multpl.ts). Sign identity: 100 - percentile(S&P - Nifty) = percentile(Nifty - S&P).`,
          },
        ],
      });
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
  //
  // Two clauses of that row were previously unimplemented, both fixed
  // 2026-09-20 after verifying the raw feed is correct and the RANKING
  // was not (Nifty IT P/E 18.41 in-store matches Trendlyne's 18.4 for
  // 2026-09-18 exactly, yet scored 97.7):
  //
  //   "vs its own 10Y HISTORY" — the window was never applied. autoScore
  //     percentiles the ENTIRE stored series, and params.percentileWindowYears
  //     (10) had no caller anywhere in the pipeline. Against a ~2.1-year
  //     window Nifty IT's 18.41 ranked at the 2.3rd percentile; Trendlyne's
  //     own 5-year range for the same index is 16.9-39.6, so the stored
  //     17.26-36.41 is a truncation, not the distribution the spec names.
  //
  //   "or P/B for FINANCIALS" — banking is a financial sector, where P/E
  //     is distorted by provisioning cycles and book value is the
  //     conventional multiple. Applied only where a real P/B series
  //     exists; no sector_pb_banking source is wired yet (nse.ts maps pb
  //     for Midcap/Smallcap only), so banking still reads P/E and says so
  //     rather than silently claiming to follow the clause.
  //
  // The span guard is the substantive change. percentileMinObservations
  // counts ROWS and the spec constrains TIME — on daily data those
  // diverge badly. See historySpanYears in percentile.ts for the
  // capgoods case this caught.
  // No sector's stored P/E reaches the spec's 10 years (niftyindices'
  // Daily Snapshot backfill starts 2024-08; NSE is latest-only), so
  // requiring the full window would abstain on all 8 and hand the sleeve
  // back to mock baseline values — strictly worse than ranking against a
  // real but shorter history. The floor is therefore set at the depth
  // below which a percentile stops meaning anything ("cheap vs its own
  // past" needs at least a cycle, not a quarter), and the shortfall is
  // reported rather than hidden: confidence is downgraded and the trace
  // states the true span. Raise this toward 10 as backfill deepens.
  const MIN_HISTORY_YEARS = 1.5;
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
    const scoreId = `sector.${sector}::valuation`;
    const all = latestObservations(db, seriesId);
    const windowed = windowedHistory(all, params.percentileWindowYears, asOfDate, null);
    const spanYears = historySpanYears(windowed);

    // A window far shorter than the spec's cannot answer "cheap vs its
    // own past" — it answers "cheap vs this quarter", which is a
    // different and much noisier question. Abstain rather than rank
    // against it (§1 invariant 4 / "honest insufficient_history beats a
    // confident wrong number").
    if (spanYears < MIN_HISTORY_YEARS) {
      out.push({
        scoreId,
        value: 50,
        status: "insufficient_history",
        derivedFrom: [seriesId],
        transform: "inverted",
        latestDate: windowed[windowed.length - 1]?.date ?? null,
        // Carry the real span so the Control Center can say WHY this
        // abstained. Without it the generic "needs 24 observations"
        // reason fires and reads as false — capgoods has 81.
        historySpanYears: spanYears,
        historyShortfall: true,
      });
      continue;
    }

    const result = autoScoreFromSeries(windowed, params, "inverted");
    out.push({
      scoreId,
      value: result.value,
      status: result.status,
      derivedFrom: [seriesId],
      transform: "inverted",
      latestDate: result.latestDate,
      historySpanYears: spanYears,
      historyShortfall: spanYears < params.percentileWindowYears,
    });
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
    const scoreId = `sector.${sector}::rel_momentum`;
    const series = deriveSectorRelMomentumSeries(db, closeSeriesId);
    const spanYears = historySpanYears(series);

    // Same span guard as sector.*::valuation, and it bites HARDER here:
    // the 12-month lookback consumes the first year of closes before a
    // single momentum observation exists, so the derived series is
    // always ~1 year shorter than the stored closes (645 close dates ->
    // 337 momentum rows, 2.09y -> 1.09y). A sector whose closes start
    // inside the last 12 months derives NOTHING at all —
    // sector_close_capgoods (81 rows from 2026-06-14) produced an empty
    // series, so the cell silently kept its mock baseline of 80.0 while
    // every other sector was genuinely computed, and it was ranked
    // against them for sleeve entry on that basis (live 2026-09-20).
    // A LOWER floor than valuation's deliberately. That cell ranks a
    // level whose stored history is the raw feed's; this one ranks a
    // spread whose history is structurally 12 months shorter than the
    // same feed, so applying valuation's 1.5y here would abstain on all
    // 8 sectors at 1.09y and hand the whole sleeve back to mock values.
    // 0.75y is the point below which a blended 6/12M spread has too few
    // independent readings to rank at all; the shortfall against the
    // spec's window is reported either way.
    const MIN_MOMENTUM_HISTORY_YEARS = 0.75;
    if (series.length === 0 || spanYears < MIN_MOMENTUM_HISTORY_YEARS) {
      out.push({
        scoreId,
        value: 50,
        status: "insufficient_history",
        derivedFrom: [closeSeriesId, "nifty50_close"],
        transform: "percentile",
        latestDate: series[series.length - 1]?.date ?? null,
        historySpanYears: spanYears,
        historyShortfall: true,
      });
      continue;
    }

    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({
      scoreId,
      value: result.value,
      status: result.status,
      derivedFrom: [closeSeriesId, "nifty50_close"],
      transform: "percentile",
      latestDate: result.latestDate,
      historySpanYears: spanYears,
      historyShortfall: spanYears < params.percentileWindowYears,
    });
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
    const ratioSeries = deriveGoldSilverRatio20ySeries(db, params.percentileMinObservations);
    const derivedFrom = derivedRatioSeries(db, "gold_usd_futures", "silver_usd_futures").length >= params.percentileMinObservations
      ? ["gold_usd_futures", "silver_usd_futures"]
      : ["gold_inr", "silver_inr"];

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
  // that adapter's file comment) and etfHoldings from gold_etf_tonnes
  // (SPDR's own GLD historical archive, adapters/goldEtfHoldings.ts —
  // WGC's Goldhub Excel is blocked the same way; SPDR's own archive isn't
  // and carries real daily history back to 2004, unlike the older
  // Yahoo-sourced gold_etf_shares_outstanding it replaced 2026-09-20).
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
      const etfRows = latestObservations(db, "gold_etf_tonnes");
      // Same "stalest input wins" reasoning as equity.large::relvalue above.
      const latestDate = [cbRows[cbRows.length - 1]?.date, etfRows[etfRows.length - 1]?.date].filter((d): d is string => d !== undefined).sort()[0] ?? null;
      out.push({
        scoreId: "l1.metals::fundamentals",
        value,
        status: "ok",
        derivedFrom: ["cb_gold_reserves_tonnes", "gold_etf_tonnes"],
        transform: "rubric",
        latestDate,
      });
    }
  }

  // §8.8 metals.silver::industrial — silverIndustrialScore(pmi, priorPmi,
  // strongSolarEvCapex). A rubric/bucket lookup like l1.metals::fundamentals
  // above, not a percentile cell, so it needs only two real readings rather
  // than clearing percentileMinObservations.
  //
  // strongSolarEvCapex is passed FALSE deliberately, not because it is
  // known to be false: it is a qualitative newsflow judgment with no
  // adapter anywhere in this project, and false is the rubric's own
  // no-adjustment case (+0 rather than +5). This keeps the cell's
  // automatic value the honest floor of its range — an analyst who judges
  // capex strong can still override upward via the manual path, whereas
  // baking in +5 here would silently assert something no source checked.
  // Flagged rather than hidden: the cell is genuinely auto-derived on its
  // PMI inputs, and approximate on that one boolean.
  {
    const readings = globalMfgPmiReadings(db, asOfDate);
    if (readings !== null) {
      const value = silverIndustrialScore(readings.pmi, readings.priorPmi, false);
      const pmiRows = latestObservations(db, "global_mfg_pmi");
      const latestDate = pmiRows[pmiRows.length - 1]?.date ?? null;

      // Unlike equityMacroScore, this rubric is a BASE BAND plus an
      // adjustment rather than a sum of deltas, so the trace reports the
      // band as the base and the capex flag as the one adjustment —
      // which is how the rubric itself is written.
      const rising = readings.pmi > readings.priorPmi;
      const band =
        readings.pmi > 52 && rising
          ? "Above 52 and rising"
          : readings.pmi >= 50
            ? "50-52 (expanding)"
            : "Below 50 (contracting)";
      const bandValue = readings.pmi > 52 && rising ? 70 : readings.pmi >= 50 ? 55 : 35;
      const rubricInputs: RubricInput[] = [
        {
          field: "Global manufacturing PMI band",
          selected: band,
          delta: bandValue,
          basis: `global_mfg_pmi ${readings.pmi} vs ${readings.priorPmi} prior — ${rising ? "rising" : "not rising"}`,
        },
        {
          field: "Solar/EV capex",
          selected: "Not strong",
          delta: 0,
          basis: "No adapter for this qualitative newsflow input — the rubric's own no-adjustment case is used",
          assumed: true,
        },
      ];

      out.push({
        scoreId: "metals.silver::industrial",
        value,
        status: "ok",
        derivedFrom: ["global_mfg_pmi"],
        transform: "rubric",
        latestDate,
        rubricInputs,
      });
    }
  }

  // §8.1 (Calculation Guide row 9) l1.equity::macro —
  // equityMacroScore(rbiStance, growthVsExpect, inflationDir). A rubric
  // lookup like l1.metals::fundamentals above, not a percentile cell, so
  // it needs real readings rather than percentileMinObservations.
  //
  // TWO of the three inputs are genuinely derived:
  //   rbiStance    <- repo_rate over 6 months (rbiStanceFromRepoRate).
  //                   Real history now exists: BIS/WS_CBPOL/M.IN via
  //                   adapters/dbnomics.ts backfills to 1946 and covers
  //                   the actual 2025 easing cycle, with rbi.org.in's
  //                   homepage widget supplying the live current rate.
  //   inflationDir <- cpi_yoy over 6 months (inflationDirFromCpi), the
  //                   same directly-fetched-plus-derived cpi_yoy picture
  //                   l1.debt::valuation assembles above.
  //
  // growthVsExpect is passed "in_line" DELIBERATELY, not because growth
  // is known to be in line. "Beating/missing EXPECTATIONS" needs a
  // consensus figure, and no free source for one exists: confirmed live
  // 2026-09-19, tradingeconomics.com's India calendar (the one page that
  // carries actual-vs-consensus pairs) renders its table in JS with no
  // rows in the server HTML, and of the individual indicator pages only
  // Manufacturing PMI leaks a server-side forecast array — TE's own
  // proprietary model output, not an analyst survey. Actual prints are
  // freely available (GDP 7.80% Q2, IIP 6.70% July, PMI 52.90 August),
  // but an actual without an expectation cannot answer this input, and
  // substituting "growth is high" for "growth beat" would silently
  // change what the rubric measures.
  //
  // "in_line" is the rubric's own no-adjustment case (+0), so this keeps
  // the automatic value the honest CENTRE of the cell's range rather
  // than tilting it on an unsourced assumption — the same pattern, and
  // the same reasoning, as strongSolarEvCapex=false in
  // metals.silver::industrial above. An analyst who has the consensus
  // read still overrides via the manual path, which currentSnapshot.ts
  // applies after this and lets win.
  //
  // Both derived inputs must resolve before the cell is emitted. A
  // half-derived, half-defaulted rubric would be a guess wearing an
  // "auto" label, so on a null from either helper the cell is left to
  // the manual/mock baseline entirely.
  {
    const rbiEvidence = rbiStanceEvidence(db, asOfDate);
    const cpiEvidence = inflationDirEvidence(db, asOfDate);
    const rbiStance = rbiEvidence?.stance ?? null;
    const inflationDir = cpiEvidence?.direction ?? null;
    if (rbiStance !== null && inflationDir !== null && rbiEvidence && cpiEvidence) {
      const value = equityMacroScore({ rbiStance, growthVsExpect: "in_line", inflationDir });

      // The three rubric choices, with the readings behind them. This is
      // what makes the final number auditable: a rubric score is a sum
      // of discrete options, so "45" is uncheckable unless the reader
      // can see it was 50 + 0 (on hold) + 0 (assumed in line) - 5
      // (inflation rising). Labels match the spec's own wording.
      const stanceLabel =
        rbiStance === "cutting" ? "Cutting / about to cut" : rbiStance === "hiking" ? "Hiking / hawkish" : "On hold";
      const stanceDelta = rbiStance === "cutting" ? 20 : rbiStance === "hiking" ? -20 : 0;
      const moveWord =
        rbiEvidence.currentValue === rbiEvidence.pastValue
          ? "unchanged at"
          : rbiEvidence.currentValue < rbiEvidence.pastValue
            ? "down to"
            : "up to";
      const inflationLabel = inflationDir === "falling" ? "Falling toward target" : "Rising";
      const inflationDelta = inflationDir === "falling" ? 5 : -5;

      const rubricInputs: RubricInput[] = [
        {
          field: "RBI stance",
          selected: stanceLabel,
          delta: stanceDelta,
          basis: `repo_rate ${moveWord} ${rbiEvidence.currentValue}% (${rbiEvidence.currentDate}) vs ${rbiEvidence.pastValue}% six months earlier (${rbiEvidence.pastDate})`,
        },
        {
          field: "Growth vs. expectations",
          selected: "In line",
          delta: 0,
          // Stated as an assumption, not a finding — see the block
          // comment above on why no consensus source exists.
          basis: "No free consensus source for analyst expectations — the rubric's own no-adjustment case is used",
          assumed: true,
        },
        {
          field: "Inflation direction",
          selected: inflationLabel,
          delta: inflationDelta,
          basis: `cpi_yoy ${cpiEvidence.currentValue}% (${cpiEvidence.currentDate}) vs ${cpiEvidence.pastValue}% six months earlier (${cpiEvidence.pastDate})`,
        },
      ];
      const repoRows = latestObservations(db, "repo_rate");
      const cpiRows = latestObservations(db, "cpi_yoy");
      // Same "stalest input wins" freshness rule as the cells above.
      const latestDate =
        [repoRows[repoRows.length - 1]?.date, cpiRows[cpiRows.length - 1]?.date]
          .filter((d): d is string => d !== undefined)
          .sort()[0] ?? null;
      out.push({
        scoreId: "l1.equity::macro",
        value,
        status: "ok",
        derivedFrom: ["repo_rate", "cpi_yoy"],
        transform: "rubric",
        latestDate,
        rubricInputs,
      });
    }
  }

  // §8.2 (Calculation Guide row 10) l1.debt::macro —
  // debtMacroScore(rbiPath, gsecSupply, inflationVsTarget). Same shape as
  // l1.equity::macro above: a rubric lookup, two inputs genuinely
  // derived, the third passed as the rubric's own no-adjustment case.
  //
  //   rbiPath           <- repo_rate over 6 months (rbiPathFromRepoRate).
  //   inflationVsTarget <- cpi_yoy vs the statutory 4% target
  //                        (inflationVsTargetFromCpi). Note this asks a
  //                        DIFFERENT question from l1.equity::macro's
  //                        inflationDir — level vs target, not direction
  //                        of travel — so the two cells can legitimately
  //                        disagree, and that is not an inconsistency.
  //
  // gsecSupply is passed "normal" DELIBERATELY. Judging "heavy G-sec
  // supply / fiscal slippage risk" needs either the borrowing calendar
  // measured against expectations or a banking-system liquidity figure,
  // and docs/DATA_SOURCES.md records that as a researched dead end: RBI's
  // BS_LAF pages turned out to be the auction CALENDAR rather than
  // settled amounts, and CCIL's liquidity pages are a report listing, not
  // data. "Normal" is the rubric's own 0-delta case, so this keeps the
  // automatic value at the honest CENTRE of the cell's range rather than
  // inventing a fiscal view — same pattern as growthVsExpect in
  // l1.equity::macro and strongSolarEvCapex in metals.silver::industrial.
  //
  // Both derived inputs must resolve or the cell is not emitted at all —
  // never half-derived, half-defaulted.
  {
    const path = rbiPathFromRepoRate(db, asOfDate);
    const rbiEvidence = rbiStanceEvidence(db, asOfDate);
    const inflation = inflationVsTargetFromCpi(db, asOfDate);
    if (path !== null && inflation !== null && rbiEvidence) {
      const value = debtMacroScore({ rbiPath: path, gsecSupply: "normal", inflationVsTarget: inflation.level });

      const pathLabel = path === "cuts_expected" ? "Cuts expected" : path === "hiking" ? "Hiking" : "On hold";
      const pathDelta = path === "cuts_expected" ? 20 : path === "hiking" ? -15 : 0;
      const moveWord =
        rbiEvidence.currentValue === rbiEvidence.pastValue
          ? "unchanged at"
          : rbiEvidence.currentValue < rbiEvidence.pastValue
            ? "down to"
            : "up to";
      const inflationLabel = inflation.level === "below" ? "Below target" : "At or above target";
      const inflationDelta = inflation.level === "below" ? 10 : 0;

      const rubricInputs: RubricInput[] = [
        {
          field: "RBI path (next 12m)",
          selected: pathLabel,
          delta: pathDelta,
          basis: `repo_rate ${moveWord} ${rbiEvidence.currentValue}% (${rbiEvidence.currentDate}) vs ${rbiEvidence.pastValue}% six months earlier (${rbiEvidence.pastDate})`,
        },
        {
          field: "G-Sec supply",
          selected: "Normal",
          delta: 0,
          basis:
            "No free source for the borrowing calendar vs expectations or banking-system liquidity — the rubric's own no-adjustment case is used",
          assumed: true,
        },
        {
          field: "Inflation vs. target",
          selected: inflationLabel,
          delta: inflationDelta,
          basis: `cpi_yoy ${inflation.currentValue.toFixed(2)}% (${inflation.currentDate}) vs the ${inflation.targetPct}% statutory target`,
        },
      ];

      const repoRows = latestObservations(db, "repo_rate");
      const cpiRows = latestObservations(db, "cpi_yoy");
      // Same "stalest input wins" freshness rule as the cells above.
      const latestDate =
        [repoRows[repoRows.length - 1]?.date, cpiRows[cpiRows.length - 1]?.date]
          .filter((d): d is string => d !== undefined)
          .sort()[0] ?? null;

      out.push({
        scoreId: "l1.debt::macro",
        value,
        status: "ok",
        derivedFrom: ["repo_rate", "cpi_yoy"],
        transform: "rubric",
        latestDate,
        rubricInputs,
      });
    }
  }

  // §7.4 metals.gold::momentum / l1.metals::momentum — gold_return_12m,
  // percentile as-is.
  //
  // Built from gold_usd_futures x usd_inr because the direct IBJA series
  // has too little history to clear the percentile floor. The landed-cost
  // wedge cancels in a return, while the FX move does not: the old USD-only
  // implementation omitted an 8.04% rupee depreciation over the year to
  // 2026-09 and materially understated an Indian holder's momentum.
  {
    const series = deriveGoldReturn12mSeries(db);
    const result = autoScoreFromSeries(series, params, "percentile");
    out.push({ scoreId: "l1.metals::momentum", value: result.value, status: result.status, derivedFrom: ["gold_usd_futures", "usd_inr"], transform: "percentile", latestDate: result.latestDate });
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
    // The join itself now lives in deriveRealGsec10ySeries() so the
    // snapshot can publish the very series this percentiles, instead of
    // the UI reconstructing it from raw legs it never ranked.
    const realGsec = deriveRealGsec10ySeries(db);

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
