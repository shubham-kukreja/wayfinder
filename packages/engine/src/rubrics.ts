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
