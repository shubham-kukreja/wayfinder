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

// Intentionally empty here — see §7 tables. Filled in during Phase 4/5
// alongside the adapters and pipeline that produce the inputs each entry needs.
export const SCORE_MAP: ScoreMapEntry[] = [];
