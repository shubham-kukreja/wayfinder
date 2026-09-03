// Declarative rubric tables (§8). Populated in Phase 4 once real adapter
// inputs (RBI stance, NSE/AMFI-derived signals, PMI, etc.) are wired up.
// Each rubric is a pure function/table over a small set of discrete inputs
// so the UI can render the conditions as selectable options.

export interface RubricCondition<TInput> {
  label: string;
  test: (input: TInput) => boolean;
  delta: number;
}

export interface Rubric<TInput> {
  id: string;
  start: number;
  conditions: RubricCondition<TInput>[];
}

export function evalRubric<TInput>(rubric: Rubric<TInput>, input: TInput): number {
  let score = rubric.start;
  for (const cond of rubric.conditions) {
    if (cond.test(input)) score += cond.delta;
  }
  return Math.max(0, Math.min(100, score));
}

// §8.4 Real rates lookup table — fully automatic from FRED (us_real_10y_6m_change, bp).
export function realRatesScore(changeBp: number, metal: "gold" | "silver"): number {
  if (metal === "gold") {
    if (changeBp < -50) return 75;
    if (changeBp < -10) return 60;
    if (changeBp <= 10) return 50;
    if (changeBp <= 50) return 40;
    return 25;
  }
  if (changeBp < -50) return 65;
  if (changeBp < -10) return 57;
  if (changeBp <= 10) return 50;
  if (changeBp <= 50) return 45;
  return 35;
}

// §8.1 Equity macro — start 50, clamp 0-100.
export type RbiStance = "cutting" | "on_hold" | "hiking";
export type GrowthVsExpect = "beating" | "in_line" | "missing";
export type InflationDir = "falling" | "rising";

export interface EquityMacroInput {
  rbiStance: RbiStance;
  growthVsExpect: GrowthVsExpect;
  inflationDir: InflationDir;
}

export function equityMacroScore(input: EquityMacroInput): number {
  let score = 50;
  if (input.rbiStance === "cutting") score += 20;
  else if (input.rbiStance === "hiking") score -= 20;
  if (input.growthVsExpect === "beating") score += 10;
  else if (input.growthVsExpect === "missing") score -= 10;
  if (input.inflationDir === "falling") score += 5;
  else score -= 5;
  return Math.max(0, Math.min(100, score));
}

// §8.2 Debt macro — start 50.
export type RbiPath = "cuts_expected" | "on_hold" | "hiking";
export type GsecSupply = "heavy" | "normal";
export type InflationVsTarget = "below" | "at_or_above";

export interface DebtMacroInput {
  rbiPath: RbiPath;
  gsecSupply: GsecSupply;
  inflationVsTarget: InflationVsTarget;
}

export function debtMacroScore(input: DebtMacroInput): number {
  let score = 50;
  if (input.rbiPath === "cuts_expected") score += 20;
  else if (input.rbiPath === "hiking") score -= 15;
  if (input.gsecSupply === "heavy") score -= 10;
  if (input.inflationVsTarget === "below") score += 10;
  return Math.max(0, Math.min(100, score));
}

// §8.3 Debt fundamentals — start 50.
export type CreditCycle = "quiet" | "rising_downgrades";
export type SystemLiquidity = "surplus" | "tight";

export interface DebtFundamentalsInput {
  creditCycle: CreditCycle;
  systemLiquidity: SystemLiquidity;
}

export function debtFundamentalsScore(input: DebtFundamentalsInput): number {
  let score = 50;
  if (input.creditCycle === "quiet") score += 10;
  else score -= 25;
  if (input.systemLiquidity === "surplus") score += 10;
  else score -= 10;
  return Math.max(0, Math.min(100, score));
}

// §8.5 Metals fundamentals — start 50.
export type CbBuying = "above_average" | "below_average";
export type EtfHoldings = "rising" | "falling";

export interface MetalsFundamentalsInput {
  cbBuying: CbBuying;
  etfHoldings: EtfHoldings;
}

export function metalsFundamentalsScore(input: MetalsFundamentalsInput): number {
  let score = 50;
  if (input.cbBuying === "above_average") score += 15;
  else score -= 10;
  if (input.etfHoldings === "rising") score += 10;
  else score -= 10;
  return Math.max(0, Math.min(100, score));
}

// §8.6 Equity growth differential — input: segment consensus FY+1 EPS growth
// minus large cap's, in percentage points. Large cap is always 50 (§7.2).
// International adds +5 for the structural INR-depreciation tailwind.
export function growthDiffScore(gapPp: number, segment: "mid" | "small" | "intl"): number {
  let score: number;
  if (gapPp >= 8) score = 75;
  else if (gapPp >= 3) score = 60;
  else if (gapPp >= -3) score = 50;
  else if (gapPp >= -8) score = 40;
  else score = 25;
  if (segment === "intl") score += 5;
  return Math.max(0, Math.min(100, score));
}

// §8.7 Debt rate-cycle — one input, three outputs (gilt/corporate/liquid).
export type RbiPath12m = "cuts_gt_50bp" | "cuts_25_50bp" | "on_hold" | "hikes_25_50bp" | "hikes_gt_50bp";

export interface RateCycleScores {
  gilt: number;
  corporate: number;
  liquid: number;
}

const RATE_CYCLE_TABLE: Record<RbiPath12m, RateCycleScores> = {
  cuts_gt_50bp: { gilt: 80, corporate: 60, liquid: 30 },
  cuts_25_50bp: { gilt: 70, corporate: 58, liquid: 40 },
  on_hold: { gilt: 50, corporate: 50, liquid: 55 },
  hikes_25_50bp: { gilt: 30, corporate: 40, liquid: 70 },
  hikes_gt_50bp: { gilt: 20, corporate: 35, liquid: 80 },
};

export function rateCycleScores(path: RbiPath12m): RateCycleScores {
  return RATE_CYCLE_TABLE[path];
}

// §8.8 Silver industrial demand — input global_mfg_pmi (manual series).
// The table's top bucket is a compound condition ("> 52 AND rising"), not a
// level alone, so this takes the prior reading too rather than silently
// dropping the trend requirement.
// +5 if solar/EV capex newsflow is strong. Gold is always 50 on this signal (§7.4).
export function silverIndustrialScore(pmi: number, priorPmi: number, strongSolarEvCapex: boolean): number {
  let score: number;
  if (pmi > 52 && pmi > priorPmi) score = 70;
  else if (pmi >= 50) score = 55;
  else score = 35;
  if (strongSolarEvCapex) score += 5;
  return Math.max(0, Math.min(100, score));
}
