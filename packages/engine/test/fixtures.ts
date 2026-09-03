import type { Scores } from "../src/types.js";

// §5.1 — current live values from the spreadsheet.
export const HEALTHY_SCORES: Scores = {
  // L1
  "l1.equity::valuation": 45,
  "l1.debt::valuation": 65,
  "l1.metals::valuation": 35,
  "l1.equity::macro": 55,
  "l1.debt::macro": 60,
  "l1.metals::macro": 60,
  "l1.equity::fundamentals": 55,
  "l1.debt::fundamentals": 55,
  "l1.metals::fundamentals": 65,
  "l1.equity::flows": 40,
  "l1.debt::flows": 55,
  "l1.metals::flows": 30,
  "l1.equity::momentum": 60,
  "l1.debt::momentum": 45,
  "l1.metals::momentum": 75,

  // Equity segments
  "equity.large::valuation": 55,
  "equity.mid::valuation": 35,
  "equity.small::valuation": 25,
  "equity.intl::valuation": 40,
  "equity.large::relvalue": 60,
  "equity.mid::relvalue": 30,
  "equity.small::relvalue": 20,
  "equity.intl::relvalue": 45,
  "equity.large::revisions": 50,
  "equity.mid::revisions": 55,
  "equity.small::revisions": 45,
  "equity.intl::revisions": 60,
  "equity.large::growth_diff": 45,
  "equity.mid::growth_diff": 60,
  "equity.small::growth_diff": 55,
  "equity.intl::growth_diff": 65,
  "equity.large::margin_cycle": 55,
  "equity.mid::margin_cycle": 40,
  "equity.small::margin_cycle": 30,
  "equity.intl::margin_cycle": 50,

  // Debt
  "debt.liquid::carry": 55,
  "debt.corporate::carry": 60,
  "debt.gilt::carry": 65,
  "debt.liquid::rate_cycle": 40,
  "debt.corporate::rate_cycle": 55,
  "debt.gilt::rate_cycle": 70,
  "debt.liquid::spread_cushion": 50,
  "debt.corporate::spread_cushion": 45,
  "debt.gilt::spread_cushion": 50,
  "debt.liquid::liquidity": 90,
  "debt.corporate::liquidity": 65,
  "debt.gilt::liquidity": 75,

  // Metals
  "metals.gold::ratio_position": 40,
  "metals.silver::ratio_position": 60,
  "metals.gold::real_rates": 65,
  "metals.silver::real_rates": 55,
  "metals.gold::industrial": 50,
  "metals.silver::industrial": 55,

  // Sectors
  "sector.banking::valuation": 60,
  "sector.banking::revisions": 55,
  "sector.banking::rel_momentum": 50,
  "sector.banking::cycle_position": 55,

  "sector.it::valuation": 55,
  "sector.it::revisions": 40,
  "sector.it::rel_momentum": 35,
  "sector.it::cycle_position": 45,

  "sector.pharma::valuation": 50,
  "sector.pharma::revisions": 65,
  "sector.pharma::rel_momentum": 60,
  "sector.pharma::cycle_position": 55,

  "sector.auto::valuation": 45,
  "sector.auto::revisions": 55,
  "sector.auto::rel_momentum": 55,
  "sector.auto::cycle_position": 60,

  "sector.capgoods::valuation": 60,
  "sector.capgoods::revisions": 75,
  "sector.capgoods::rel_momentum": 80,
  "sector.capgoods::cycle_position": 70,

  "sector.fmcg::valuation": 55,
  "sector.fmcg::revisions": 45,
  "sector.fmcg::rel_momentum": 40,
  "sector.fmcg::cycle_position": 50,

  "sector.energy::valuation": 60,
  "sector.energy::revisions": 50,
  "sector.energy::rel_momentum": 45,
  "sector.energy::cycle_position": 40,

  "sector.metals::valuation": 55,
  "sector.metals::revisions": 45,
  "sector.metals::rel_momentum": 50,
  "sector.metals::cycle_position": 35,
};

export const HEALTHY_VETOES = { "equity.small": true };
