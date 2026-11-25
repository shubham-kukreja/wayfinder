// Baskets are the client archetypes (Archetype Table v1): design inputs for
// the model portfolios, answering "who is each model portfolio for?". Each
// is defined on time horizon, risk capacity, primary goal and liquidity
// needs. `profile` is the core risk profile (model portfolio) serving the
// archetype. For now every archetype uses the Balanced model; each gets its
// own once its neutral weights are set.

export interface Basket {
  id: string;
  code: string;
  name: string;
  horizon: string;
  riskCapacity: string;
  goal: string;
  liquidity: string;
  profile: string | null;
  /** Who it is for, in a sentence, for the basket page. */
  who: string;
}

export const BASKETS: Basket[] = [
  { id: "a1", code: "A1", name: "Young Accumulator", horizon: "Long (10+y)", riskCapacity: "High", goal: "Wealth accumulation", liquidity: "Low", profile: "balanced", who: "Early in a career, decades from needing the money, and able to ride out deep drawdowns while the corpus compounds" },
  { id: "a2", code: "A2", name: "Goal-Bound Saver", horizon: "Short (<3y)", riskCapacity: "Low", goal: "Capital preservation (for a defined goal)", liquidity: "High", profile: "balanced", who: "Saving for a dated goal under three years away, a home down payment or a fee, where the money must be there on the day" },
  {
    id: "a3a",
    code: "A3a",
    name: "Near-Retiree",
    horizon: "Long (10+y)",
    riskCapacity: "Limited",
    goal: "Accumulating, transitioning to preservation",
    liquidity: "Medium",
    profile: "balanced", who: "A few years from retirement, still adding, and starting to protect what has been built",
  },
  {
    id: "a3b-i",
    code: "A3b-i",
    name: "Constrained Retiree",
    horizon: "Medium (5–10y rolling)",
    riskCapacity: "Low",
    goal: "Capital preservation + income generation; corpus must last",
    liquidity: "Medium–High",
    profile: "balanced", who: "Retired, drawing an income from a corpus that has to last, with little room for a bad sequence of returns",
  },
  {
    id: "a3b-ii",
    code: "A3b-ii",
    name: "Endowed Retiree",
    horizon: "Long (rolling, multi-generational)",
    riskCapacity: "Medium",
    goal: "Income generation + legacy capital growth; corpus exceeds lifetime needs",
    liquidity: "Medium",
    profile: "balanced", who: "Retired with more than they will need, drawing income while the surplus grows for the next generation",
  },
  {
    id: "a4",
    code: "A4",
    name: "Affluent Professional",
    horizon: "Medium–Long (5–10y)",
    riskCapacity: "Balanced (medium–high)",
    goal: "Wealth accumulation, transitioning to preservation",
    liquidity: "Low–Medium",
    profile: "balanced", who: "Earning well, investing a share of a growing income for the next five to ten years, and slowly shifting from growth to keeping what is made",
  },
  {
    id: "a5",
    code: "A5",
    name: "Mid-Career Goal Funder",
    horizon: "Medium (3–7y)",
    riskCapacity: "Medium",
    goal: "Wealth accumulation toward a defined, dated goal",
    liquidity: "Medium",
    profile: "balanced", who: "Mid-career and funding a known goal three to seven years out, a child's education or a home",
  },
];

export const basketById = (id: string | undefined) => BASKETS.find((b) => b.id === id) ?? null;
export const basketLabel = (b: Basket) => `${b.code} · ${b.name}`;
