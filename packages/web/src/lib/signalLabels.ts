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
  margin_cycle: "Margin / cycle",
  carry: "Carry",
  rate_cycle: "Rate cycle",
  spread_cushion: "Spread cushion",
  liquidity: "Liquidity",
  ratio_position: "Ratio positioning",
  real_rates: "Real rates",
  industrial: "Industrial demand",
  // Sector sleeve signals — absent from the matrix's original map, which is
  // why the Parameters page fell back to showing the raw keys.
  rel_momentum: "Relative momentum",
  cycle_position: "Cycle position",
};

export function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key;
}
