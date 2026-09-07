// §12.2: "Rubric scores get the rubric, not a number box — the user picks
// 'RBI cutting, growth in line, CPI easing' and gets 75." This module
// declares, for every rubric-provenance score cell, the picker fields
// (each a small set of labelled options) and how to evaluate a selection
// into the actual score — wired directly to the real rubric functions in
// rubrics.ts so the UI's options can never drift from the scoring logic
// they're supposed to represent.
import {
  equityMacroScore,
  debtMacroScore,
  debtFundamentalsScore,
  metalsFundamentalsScore,
  growthDiffScore,
  rateCycleScores,
  silverIndustrialScore,
  type RbiStance,
  type GrowthVsExpect,
  type InflationDir,
  type RbiPath,
  type GsecSupply,
  type InflationVsTarget,
  type CreditCycle,
  type SystemLiquidity,
  type CbBuying,
  type EtfHoldings,
  type RbiPath12m,
} from "./rubrics.js";

export interface RubricFieldOption {
  value: string;
  label: string;
}

export interface RubricField {
  key: string;
  label: string;
  options: RubricFieldOption[];
}

export interface RubricUiSpec {
  // The score ID(s) this rubric drives. A single rubric selection can
  // drive more than one score cell (§8.7's rate-cycle table produces
  // gilt/corporate/liquid from one "expected path" selection).
  scoreIds: string[];
  fields: RubricField[];
  // Evaluates a selection (keyed by RubricField.key) into a value per
  // score ID. Returns null for any field left unselected — the caller
  // treats an incomplete selection as "not yet answered," never guesses
  // a default (§1 invariant 4).
  evaluate: (selection: Record<string, string>) => Record<string, number> | null;
}

const RBI_STANCE_OPTIONS: RubricFieldOption[] = [
  { value: "cutting", label: "Cutting / about to cut" },
  { value: "on_hold", label: "On hold" },
  { value: "hiking", label: "Hiking / hawkish" },
];
const GROWTH_VS_EXPECT_OPTIONS: RubricFieldOption[] = [
  { value: "beating", label: "Beating expectations" },
  { value: "in_line", label: "In line" },
  { value: "missing", label: "Missing expectations" },
];
const INFLATION_DIR_OPTIONS: RubricFieldOption[] = [
  { value: "falling", label: "Falling toward target" },
  { value: "rising", label: "Rising" },
];

// §8.1 l1.equity::macro
const equityMacroUi: RubricUiSpec = {
  scoreIds: ["l1.equity::macro"],
  fields: [
    { key: "rbiStance", label: "RBI stance", options: RBI_STANCE_OPTIONS },
    { key: "growthVsExpect", label: "Growth vs. expectations", options: GROWTH_VS_EXPECT_OPTIONS },
    { key: "inflationDir", label: "Inflation direction", options: INFLATION_DIR_OPTIONS },
  ],
  evaluate: (s) => {
    if (!s.rbiStance || !s.growthVsExpect || !s.inflationDir) return null;
    const value = equityMacroScore({
      rbiStance: s.rbiStance as RbiStance,
      growthVsExpect: s.growthVsExpect as GrowthVsExpect,
      inflationDir: s.inflationDir as InflationDir,
    });
    return { "l1.equity::macro": value };
  },
};

// §8.2 l1.debt::macro
const debtMacroUi: RubricUiSpec = {
  scoreIds: ["l1.debt::macro"],
  fields: [
    {
      key: "rbiPath",
      label: "RBI path (next 12m)",
      options: [
        { value: "cuts_expected", label: "Cuts expected" },
        { value: "on_hold", label: "On hold" },
        { value: "hiking", label: "Hiking" },
      ],
    },
    {
      key: "gsecSupply",
      label: "G-Sec supply",
      options: [
        { value: "heavy", label: "Heavy supply / fiscal slippage" },
        { value: "normal", label: "Normal" },
      ],
    },
    {
      key: "inflationVsTarget",
      label: "Inflation vs. target",
      options: [
        { value: "below", label: "Below target" },
        { value: "at_or_above", label: "At or above target" },
      ],
    },
  ],
  evaluate: (s) => {
    if (!s.rbiPath || !s.gsecSupply || !s.inflationVsTarget) return null;
    const value = debtMacroScore({
      rbiPath: s.rbiPath as RbiPath,
      gsecSupply: s.gsecSupply as GsecSupply,
      inflationVsTarget: s.inflationVsTarget as InflationVsTarget,
    });
    return { "l1.debt::macro": value };
  },
};

// §8.3 l1.debt::fundamentals
const debtFundamentalsUi: RubricUiSpec = {
  scoreIds: ["l1.debt::fundamentals"],
  fields: [
    {
      key: "creditCycle",
      label: "Credit cycle",
      options: [
        { value: "quiet", label: "Quiet" },
        { value: "rising_downgrades", label: "Rising downgrades / credit event" },
      ],
    },
    {
      key: "systemLiquidity",
      label: "System liquidity",
      options: [
        { value: "surplus", label: "Comfortable surplus" },
        { value: "tight", label: "Deficit / tight" },
      ],
    },
  ],
  evaluate: (s) => {
    if (!s.creditCycle || !s.systemLiquidity) return null;
    const value = debtFundamentalsScore({
      creditCycle: s.creditCycle as CreditCycle,
      systemLiquidity: s.systemLiquidity as SystemLiquidity,
    });
    return { "l1.debt::fundamentals": value };
  },
};

// §8.5 l1.metals::fundamentals
const metalsFundamentalsUi: RubricUiSpec = {
  scoreIds: ["l1.metals::fundamentals"],
  fields: [
    {
      key: "cbBuying",
      label: "Central bank gold buying",
      options: [
        { value: "above_average", label: "Above 5Y average" },
        { value: "below_average", label: "Below 5Y average" },
      ],
    },
    {
      key: "etfHoldings",
      label: "ETF holdings (3M)",
      options: [
        { value: "rising", label: "Rising" },
        { value: "falling", label: "Falling" },
      ],
    },
  ],
  evaluate: (s) => {
    if (!s.cbBuying || !s.etfHoldings) return null;
    const value = metalsFundamentalsScore({
      cbBuying: s.cbBuying as CbBuying,
      etfHoldings: s.etfHoldings as EtfHoldings,
    });
    return { "l1.metals::fundamentals": value };
  },
};

// §8.6 equity growth differential — one per segment (mid/small/intl);
// large cap is always static 50, not a rubric.
function growthDiffUi(segment: "mid" | "small" | "intl", scoreId: string): RubricUiSpec {
  return {
    scoreIds: [scoreId],
    fields: [
      {
        key: "gapPp",
        label: "FY+1 EPS growth gap vs. large cap",
        options: [
          { value: "8", label: "≥ +8pp" },
          { value: "5", label: "+3 to +8pp" },
          { value: "0", label: "-3 to +3pp" },
          { value: "-5", label: "-8 to -3pp" },
          { value: "-10", label: "< -8pp" },
        ],
      },
    ],
    evaluate: (s) => {
      if (!s.gapPp) return null;
      const value = growthDiffScore(Number(s.gapPp), segment);
      return { [scoreId]: value };
    },
  };
}

// §8.7 debt rate-cycle — one selection drives 3 score cells.
const RATE_CYCLE_OPTIONS: RubricFieldOption[] = [
  { value: "cuts_gt_50bp", label: "Cuts > 50bp" },
  { value: "cuts_25_50bp", label: "Cuts 25-50bp" },
  { value: "on_hold", label: "On hold" },
  { value: "hikes_25_50bp", label: "Hikes 25-50bp" },
  { value: "hikes_gt_50bp", label: "Hikes > 50bp" },
];
const rateCycleUi: RubricUiSpec = {
  scoreIds: ["debt.gilt::rate_cycle", "debt.corporate::rate_cycle", "debt.liquid::rate_cycle"],
  fields: [{ key: "path", label: "Expected 12m rate path", options: RATE_CYCLE_OPTIONS }],
  evaluate: (s) => {
    if (!s.path) return null;
    const scores = rateCycleScores(s.path as RbiPath12m);
    return {
      "debt.gilt::rate_cycle": scores.gilt,
      "debt.corporate::rate_cycle": scores.corporate,
      "debt.liquid::rate_cycle": scores.liquid,
    };
  },
};

// §8.8 silver industrial demand
const silverIndustrialUi: RubricUiSpec = {
  scoreIds: ["metals.silver::industrial"],
  fields: [
    {
      key: "pmiLevel",
      label: "Global manufacturing PMI",
      options: [
        { value: "high_rising", label: "> 52 and rising" },
        { value: "mid", label: "50-52" },
        { value: "low", label: "< 50" },
      ],
    },
    {
      key: "capexNewsflow",
      label: "Solar/EV capex newsflow",
      options: [
        { value: "strong", label: "Strong" },
        { value: "normal", label: "Normal" },
      ],
    },
  ],
  evaluate: (s) => {
    if (!s.pmiLevel || !s.capexNewsflow) return null;
    // silverIndustrialScore takes (pmi, priorPmi, strongCapex) — the UI
    // exposes only the derived bucket, not raw PMI figures, so synth
    // representative pmi/priorPmi values that land in the chosen bucket.
    const [pmi, priorPmi] = s.pmiLevel === "high_rising" ? [53, 51] : s.pmiLevel === "mid" ? [51, 51] : [48, 49];
    const value = silverIndustrialScore(pmi, priorPmi, s.capexNewsflow === "strong");
    return { "metals.silver::industrial": value };
  },
};

// Keyed by the score ID it drives, so the Inputs UI can look up "does
// this score have a rubric picker" in O(1). Multi-score rubrics (rate
// cycle) are registered under each of their score IDs, pointing at the
// same spec.
export const RUBRIC_UI_BY_SCORE_ID: Record<string, RubricUiSpec> = {};
function register(spec: RubricUiSpec) {
  for (const id of spec.scoreIds) RUBRIC_UI_BY_SCORE_ID[id] = spec;
}
register(equityMacroUi);
register(debtMacroUi);
register(debtFundamentalsUi);
register(metalsFundamentalsUi);
register(growthDiffUi("mid", "equity.mid::growth_diff"));
register(growthDiffUi("small", "equity.small::growth_diff"));
register(growthDiffUi("intl", "equity.intl::growth_diff"));
register(rateCycleUi);
register(silverIndustrialUi);
