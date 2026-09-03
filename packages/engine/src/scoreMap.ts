// Declarative 85-score derivation table (§7). Populated in Phase 4/5 once
// adapters exist. Each entry names its provenance and transform so the
// pipeline (server-side) and the Inputs UI can both read from one source
// of truth instead of scattered logic.

export type Provenance = "auto" | "rubric" | "static" | "manual" | "default";
export type Transform = "percentile" | "inverted" | "average" | "rubric" | "static" | "none";

export interface ScoreMapEntry {
  scoreId: string;
  provenance: Provenance;
  series: string[];
  transform: Transform;
}

// §7 cells this project can compute end-to-end today, given the series
// FRED/bullion/AMFI adapters actually fetch (see
// packages/server/src/pipeline/scoreCells.ts for the derivation logic —
// this table is the declarative index of what that module implements,
// kept in the engine package so the Inputs UI can reference provenance
// without importing server-only code). All other §7 cells remain
// "manual"/"default" per scoreProvenance.ts until NSE and the rest of
// RBI's series are wired in.
export const SCORE_MAP: ScoreMapEntry[] = [
  { scoreId: "l1.equity::flows", provenance: "auto", series: ["flow_equity_3m", "aum_equity"], transform: "inverted" },
  { scoreId: "l1.debt::flows", provenance: "auto", series: ["flow_duration_3m", "aum_duration"], transform: "inverted" },
  { scoreId: "l1.metals::flows", provenance: "auto", series: ["flow_goldetf"], transform: "inverted" },
  { scoreId: "metals.gold::ratio_position", provenance: "auto", series: ["gold_inr", "silver_inr"], transform: "inverted" },
  { scoreId: "metals.silver::ratio_position", provenance: "auto", series: ["gold_inr", "silver_inr"], transform: "percentile" },
  { scoreId: "l1.metals::momentum", provenance: "auto", series: ["gold_inr"], transform: "percentile" },
  { scoreId: "metals.gold::real_rates", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
  { scoreId: "metals.silver::real_rates", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
  { scoreId: "l1.metals::macro", provenance: "rubric", series: ["us_real_10y"], transform: "rubric" },
];
