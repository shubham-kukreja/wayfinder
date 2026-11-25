// Baskets are the client archetypes (Archetype Table v1): design inputs for
// the model portfolios, answering "who is each model portfolio for?". Each
// is defined on time horizon, risk capacity, primary goal and liquidity
// needs. `profile` is the core risk profile (model portfolio) serving the
// archetype; null where that model portfolio is not set up yet.

export interface Basket {
  id: string;
  code: string;
  name: string;
  horizon: string;
  riskCapacity: string;
  goal: string;
  liquidity: string;
  profile: string | null;
}

export const BASKETS: Basket[] = [
  { id: "a1", code: "A1", name: "Young Accumulator", horizon: "Long (10+y)", riskCapacity: "High", goal: "Wealth accumulation", liquidity: "Low", profile: null },
  { id: "a2", code: "A2", name: "Goal-Bound Saver", horizon: "Short (<3y)", riskCapacity: "Low", goal: "Capital preservation (for a defined goal)", liquidity: "High", profile: null },
  {
    id: "a3a",
    code: "A3a",
    name: "Near-Retiree",
    horizon: "Long (10+y)",
    riskCapacity: "Limited",
    goal: "Accumulating, transitioning to preservation",
    liquidity: "Medium",
    profile: null,
  },
  {
    id: "a3b-i",
    code: "A3b-i",
    name: "Constrained Retiree",
    horizon: "Medium (5–10y rolling)",
    riskCapacity: "Low",
    goal: "Capital preservation + income generation; corpus must last",
    liquidity: "Medium–High",
    profile: null,
  },
  {
    id: "a3b-ii",
    code: "A3b-ii",
    name: "Endowed Retiree",
    horizon: "Long (rolling, multi-generational)",
    riskCapacity: "Medium",
    goal: "Income generation + legacy capital growth; corpus exceeds lifetime needs",
    liquidity: "Medium",
    profile: null,
  },
  {
    id: "a4",
    code: "A4",
    name: "Affluent Professional",
    horizon: "Medium–Long (5–10y)",
    riskCapacity: "Balanced (medium–high)",
    goal: "Wealth accumulation, transitioning to preservation",
    liquidity: "Low–Medium",
    profile: "balanced",
  },
  {
    id: "a5",
    code: "A5",
    name: "Mid-Career Goal Funder",
    horizon: "Medium (3–7y)",
    riskCapacity: "Medium",
    goal: "Wealth accumulation toward a defined, dated goal",
    liquidity: "Medium",
    profile: null,
  },
];

export const basketById = (id: string | undefined) => BASKETS.find((b) => b.id === id) ?? null;
export const basketLabel = (b: Basket) => `${b.code} · ${b.name}`;
