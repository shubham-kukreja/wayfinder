// Human labels for signal keys. Lives here rather than inside SignalMatrix so
// the Parameters editors use the same wording as the matrix — those pages were
// previously showing raw keys like "growth_diff" and "rel_momentum".
export const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
  relvalue: "Relative value",
  revisions: "Revisions",
  growth_diff: "Growth differential",
  eps_growth_diff: "Growth differential", // core-jobs-service key
  margin_cycle: "Margin / cycle",
  carry: "Carry",
  rate_cycle: "Rate cycle",
  spread_cushion: "Spread cushion",
  credit_spread: "Spread cushion", // core-jobs-service key
  liquidity: "Liquidity",
  ratio_position: "Ratio positioning",
  ratio: "Ratio positioning", // core-jobs-service key
  real_rates: "Real rates",
  industrial: "Industrial demand",
  // Sector sleeve signals — absent from the matrix's original map, which is
  // why the Parameters page fell back to showing the raw keys.
  rel_momentum: "Relative momentum",
  cycle_position: "Cycle position",
  cycle: "Cycle position", // core-jobs-service key
};

export function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key;
}
