// Declarative 85-score derivation table (§7). Populated in Phase 4/5 once
// adapters exist. Each entry names its provenance and transform so the
// pipeline (server-side) and the Inputs UI can both read from one source
// of truth instead of scattered logic.

export type Provenance = "auto" | "rubric" | "static" | "manual" | "default";
export type Transform = "percentile" | "inverted" | "average" | "rubric" | "static" | "none";

// How ONE upstream series enters its cell's arithmetic. A cell-level
// transform cannot answer this: l1.debt::valuation is a "percentile"
// cell, but it percentiles the DERIVED real yield (gsec_10y - cpi_yoy),
// so NEITHER leg's own percentile is an input. Rendering a distribution
// strip per leg there showed gsec_10y at the 29th percentile beside a
// score of 70, and an empty strip for cpi_yoy implying a history problem
// the cell does not have (both confirmed live 2026-09-19).
//
//   "percentile" - this series' OWN percentile is an input to the score.
//                  Show the strip AND the number.
//   "raw"        - only the series' latest VALUE is used (it is an
//                  operand of a derivation, or a rubric input). Show the
//                  number alone; a strip would be decoration that
//                  contradicts the score.
export type SeriesRole = "percentile" | "raw";

export interface ScoreMapEntry {
  scoreId: string;
  provenance: Provenance;
  series: string[];
  transform: Transform;
  // Per-series roles, keyed by series id. A series absent from this map
  // falls back to the cell-level rule in seriesRole() below.
  seriesRoles?: Record<string, SeriesRole>;
}

// What role a given series plays in a given cell's calculation.
//
// The default is deliberately conservative: a strip is only drawn where
// the map SAYS that series was percentiled on its own. For a multi-series
// percentile cell the ranked quantity is almost always a derivation of
// the legs rather than a leg itself, so guessing "percentile" from the
// cell-level transform is what produced the contradiction above. A
// single-series percentile/inverted cell is the one case where the leg
// and the ranked quantity are necessarily the same thing.
export function seriesRole(entry: ScoreMapEntry | undefined, seriesId: string): SeriesRole {
  if (!entry) return "raw";
  const declared = entry.seriesRoles?.[seriesId];
  if (declared) return declared;
  const isPercentileCell = entry.transform === "percentile" || entry.transform === "inverted";
  if (isPercentileCell && entry.series.length === 1) return "percentile";
  return "raw";
}

export function scoreMapEntry(scoreId: string): ScoreMapEntry | undefined {
  return SCORE_MAP.find((e) => e.scoreId === scoreId);
}

// §7 cells this project can compute end-to-end today, given the series
// FRED/bullion/AMFI/RBI adapters actually fetch (see
// packages/server/src/pipeline/scoreCells.ts for the derivation logic —
// this table is the declarative index of what that module implements,
// kept in the engine package so the Inputs UI can reference provenance
// without importing server-only code). All other §7 cells remain
// "manual"/"default" per scoreProvenance.ts until NSE and debt.corporate's
// AAA yield source are wired in.
export const SCORE_MAP: ScoreMapEntry[] = [
  { scoreId: "l1.equity::flows", provenance: "auto", series: ["flow_equity_3m", "aum_equity"], transform: "inverted" },
  { scoreId: "l1.debt::flows", provenance: "auto", series: ["flow_duration_3m", "aum_duration"], transform: "inverted" },
  // Percentiles the DERIVED 3-month mean flow, not the raw monthly
  // series, so the leg is an operand and gets no distribution strip.
  {
    scoreId: "l1.metals::flows",
    provenance: "auto",
    series: ["flow_goldetf"],
    transform: "inverted",
    seriesRoles: { flow_goldetf: "raw" },
  },
  // The runtime prefers the Yahoo COMEX gold/silver futures pair because
  // IBJA spot has no historical endpoint. Both are operands of the
  // derived ratio, so neither raw level receives a percentile strip.
  { scoreId: "metals.gold::ratio_position", provenance: "auto", series: ["gold_usd_futures", "silver_usd_futures"], transform: "inverted", seriesRoles: { gold_usd_futures: "raw", silver_usd_futures: "raw" } },
  { scoreId: "metals.silver::ratio_position", provenance: "auto", series: ["gold_usd_futures", "silver_usd_futures"], transform: "percentile", seriesRoles: { gold_usd_futures: "raw", silver_usd_futures: "raw" } },
  // Percentiles the DERIVED 12-month gold return, not the price level —
  // and computes it from gold_usd_futures x usd_inr rather than the short
  // direct gold_inr history. Both legs are operands of that return, so
  // neither raw level's own percentile is an input.
  {
    scoreId: "l1.metals::momentum",
    provenance: "auto",
    series: ["gold_usd_futures", "usd_inr"],
    transform: "percentile",
    seriesRoles: { gold_usd_futures: "raw", usd_inr: "raw" },
  },
  { scoreId: "metals.gold::real_rates", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
  { scoreId: "metals.silver::real_rates", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
  { scoreId: "l1.metals::macro", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
  { scoreId: "l1.debt::valuation", provenance: "auto", series: ["gsec_10y", "cpi_yoy"], transform: "percentile" },
  // Percentiles the DERIVED 12-month return of the index, not the index
  // LEVEL, so the leg is an operand and gets no distribution strip.
  {
    scoreId: "l1.debt::momentum",
    provenance: "auto",
    series: ["bond_index_close"],
    transform: "percentile",
    seriesRoles: { bond_index_close: "raw" },
  },
  { scoreId: "debt.gilt::carry", provenance: "auto", series: ["gsec_10y"], transform: "percentile" },
  { scoreId: "debt.liquid::carry", provenance: "auto", series: ["tbill_1y"], transform: "percentile" },
  // Part (b) percentiles nifty50_pe ITSELF (inverted); part (a)
  // percentiles the derived earnings-yield gap, for which gsec_10y is
  // only an operand. So the two legs genuinely differ in role.
  {
    scoreId: "l1.equity::valuation",
    provenance: "auto",
    series: ["nifty50_pe", "gsec_10y"],
    transform: "percentile",
    seriesRoles: { nifty50_pe: "percentile", gsec_10y: "raw" },
  },
  { scoreId: "l1.metals::valuation", provenance: "auto", series: ["gold_inr", "cpi_index"], transform: "inverted" },
  // Calculation Guide "Valuation vs own history" — each leg is
  // percentiled on its OWN 10Y monthly history and inverted, then the two
  // inverted scores are averaged ("optionally average with the same on
  // P/B"). So BOTH legs are genuinely "percentile" here — unlike the
  // relvalue cells below, which percentile a SPREAD and therefore treat
  // their legs as raw operands. Both get a distribution strip.
  {
    scoreId: "equity.large::valuation",
    provenance: "auto",
    series: ["nifty100_pe", "nifty100_pb"],
    transform: "average",
    seriesRoles: { nifty100_pe: "percentile", nifty100_pb: "percentile" },
  },
  {
    scoreId: "equity.mid::valuation",
    provenance: "auto",
    series: ["midcap150_pe", "midcap150_pb"],
    transform: "average",
    seriesRoles: { midcap150_pe: "percentile", midcap150_pb: "percentile" },
  },
  {
    scoreId: "equity.small::valuation",
    provenance: "auto",
    series: ["smallcap250_pe", "smallcap250_pb"],
    transform: "average",
    seriesRoles: { smallcap250_pe: "percentile", smallcap250_pb: "percentile" },
  },
  // The S&P leg IS percentiled on its own history (inverted). nifty100_pe
  // is an operand of the India-US gap whose percentile only selects a
  // +/-5-10 point adjustment band — India's own valuation percentile is
  // NOT the score, so a strip on it would invite reading this cell as a
  // view on Indian large caps.
  {
    scoreId: "equity.intl::valuation",
    provenance: "auto",
    series: ["sp500_trailing_pe", "nifty100_pe"],
    transform: "inverted",
    seriesRoles: { sp500_trailing_pe: "percentile", nifty100_pe: "raw" },
  },
  { scoreId: "equity.mid::relvalue", provenance: "auto", series: ["midcap150_pe", "nifty100_pe"], transform: "inverted" },
  { scoreId: "equity.small::relvalue", provenance: "auto", series: ["smallcap250_pe", "nifty100_pe"], transform: "inverted" },
  { scoreId: "equity.large::relvalue", provenance: "auto", series: ["midcap150_pe", "smallcap250_pe", "nifty100_pe"], transform: "average" },
  // Percentiles the DERIVED nifty100_pe - sp500_trailing_pe spread, not
  // either leg's own history — same "spread, not either level" reasoning
  // as the mid/small/large relvalue cells above. TRAILING P/E substituted
  // for the spec's forward P/E on both legs (sp500_fwd_pe has no usable
  // history — see scoreCells.ts).
  { scoreId: "equity.intl::relvalue", provenance: "auto", series: ["nifty100_pe", "sp500_trailing_pe"], transform: "percentile" },
  // Percentiles the DERIVED 3M change in segment trailing EPS (index
  // close ÷ trailing P/E), a documented substitute for the spec's
  // upgrade/downgrade breadth or consensus-EPS fallback — see
  // scoreCells.ts and docs/missing_data_points/. Both legs are operands
  // of that derived quantity, not percentiled on their own, so neither
  // gets a distribution strip.
  {
    scoreId: "equity.large::revisions",
    provenance: "auto",
    series: ["nifty100_close", "nifty100_pe"],
    transform: "percentile",
    seriesRoles: { nifty100_close: "raw", nifty100_pe: "raw" },
  },
  {
    scoreId: "equity.mid::revisions",
    provenance: "auto",
    series: ["midcap150_close", "midcap150_pe"],
    transform: "percentile",
    seriesRoles: { midcap150_close: "raw", midcap150_pe: "raw" },
  },
  {
    scoreId: "equity.small::revisions",
    provenance: "auto",
    series: ["smallcap250_close", "smallcap250_pe"],
    transform: "percentile",
    seriesRoles: { smallcap250_close: "raw", smallcap250_pe: "raw" },
  },
  // RUBRIC cells: growthDiffScore() bands the DERIVED 12M trailing-EPS
  // growth gap vs Large Cap, a documented substitute for the spec's
  // consensus FY+1 EPS growth gap — see scoreCells.ts and
  // docs/missing_data_points/equity-segments.md. All legs are operands of
  // that derived gap, not percentiled on their own, so none gets a
  // distribution strip (rubricInputs[] carries the applied band/delta
  // instead — same channel equity.intl::valuation's adjustment uses).
  {
    scoreId: "equity.mid::growth_diff",
    provenance: "auto",
    series: ["midcap150_close", "midcap150_pe", "nifty100_close", "nifty100_pe"],
    transform: "rubric",
    seriesRoles: { midcap150_close: "raw", midcap150_pe: "raw", nifty100_close: "raw", nifty100_pe: "raw" },
  },
  {
    scoreId: "equity.small::growth_diff",
    provenance: "auto",
    series: ["smallcap250_close", "smallcap250_pe", "nifty100_close", "nifty100_pe"],
    transform: "rubric",
    seriesRoles: { smallcap250_close: "raw", smallcap250_pe: "raw", nifty100_close: "raw", nifty100_pe: "raw" },
  },
  // Same rubric, but the gap's US leg is sp500_trailing_eps_real
  // (multpl.com, inflation-adjusted — see adapters/multpl.ts) against
  // nifty100's nominal trailing-EPS growth. Two stacked deviations from
  // the spec's consensus input, both stated in rubricInputs[].basis.
  {
    scoreId: "equity.intl::growth_diff",
    provenance: "auto",
    series: ["sp500_trailing_eps_real", "nifty100_close", "nifty100_pe"],
    transform: "rubric",
    seriesRoles: { sp500_trailing_eps_real: "raw", nifty100_close: "raw", nifty100_pe: "raw" },
  },
  // Percentiles the DERIVED blended relative return
  // ((sector6m - nifty6m) + (sector12m - nifty12m)) / 2, NOT either
  // index level. Both closes are operands of that spread, so neither
  // raw level's own percentile is an input and neither gets a
  // distribution strip — a strip on nifty50_close here would invite
  // reading the market's own percentile as the sector's momentum score.
  ...["banking", "it", "pharma", "auto", "fmcg", "energy", "metals", "capgoods"].map(
    (sector): ScoreMapEntry => ({
      scoreId: `sector.${sector}::rel_momentum`,
      provenance: "auto",
      series: [`sector_close_${sector}`, "nifty50_close"],
      transform: "percentile",
      seriesRoles: { [`sector_close_${sector}`]: "raw", nifty50_close: "raw" },
    })
  ),
  // §8.8 — rubric lookup over the latest + prior global_mfg_pmi reading,
  // not a percentile cell, so it needs two real months rather than
  // percentileMinObservations. See scoreCells.ts for the strongSolarEvCapex
  // argument, which has no adapter and is passed as the rubric's own
  // no-adjustment case.
  { scoreId: "metals.silver::industrial", provenance: "rubric", series: ["global_mfg_pmi"], transform: "rubric" },
  // §8.1 — rubric lookup over repo_rate (6-month stance direction) and
  // cpi_yoy (6-month inflation direction), not a percentile cell. Its
  // third rubric input, growthVsExpect, has no free consensus source and
  // is passed as the rubric's own no-adjustment case — see
  // scoreCells.ts for why an actual print without an expectation can't
  // answer it.
  { scoreId: "l1.equity::macro", provenance: "rubric", series: ["repo_rate", "cpi_yoy"], transform: "rubric" },
  // §8.2 — rubric lookup over repo_rate (6-month path direction) and
  // cpi_yoy (level vs the statutory 4% target). Its third input,
  // gsecSupply, has no free source (see DATA_SOURCES.md's banking-system
  // liquidity row) and is passed as the rubric's own no-adjustment case.
  { scoreId: "l1.debt::macro", provenance: "rubric", series: ["repo_rate", "cpi_yoy"], transform: "rubric" },
];
