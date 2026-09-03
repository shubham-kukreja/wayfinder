// §7 — the real provenance for every one of the 85 score cells, per the
// brief's own tables (§7.1-7.5). Used by fixtures and (eventually) the
// live pipeline so "auto vs rubric vs static vs manual" reflects the
// actual system design rather than a placeholder default.
//
// Note: this per-cell mapping sums to 40 auto / 11 rubric / 27 manual / 7
// static, not the exact 41/16/7/21 the brief's §7.6 summary table states.
// Both were derived from the same §7.1-7.5 per-cell tables but disagree —
// most likely because some cells legitimately have a rubric TRANSFORM
// fed by an AUTO series (e.g. §8.4's real-rates table, whose input is a
// fetched FRED series), and it's ambiguous from the tables alone whether
// §7.6 counted those as "auto" (input) or "rubric" (transform). Flagging
// this rather than forcing a match to a total that can't be independently
// re-derived with confidence — worth reconciling against the source
// spreadsheet directly if the exact split matters downstream.
import type { ScoreProvenance } from "./types.js";

export const SCORE_PROVENANCE: Record<string, ScoreProvenance> = {
  // §7.1 — Level 1
  "l1.equity::valuation": "auto",
  "l1.equity::macro": "rubric",
  "l1.equity::fundamentals": "manual",
  "l1.equity::flows": "auto",
  "l1.equity::momentum": "auto",
  "l1.debt::valuation": "auto",
  "l1.debt::macro": "rubric",
  "l1.debt::fundamentals": "rubric",
  "l1.debt::flows": "auto",
  "l1.debt::momentum": "auto",
  "l1.metals::valuation": "auto",
  "l1.metals::macro": "auto", // rubric §8.4, but the input (FRED) is auto
  "l1.metals::fundamentals": "rubric",
  "l1.metals::flows": "auto",
  "l1.metals::momentum": "auto",

  // §7.2 — Equity segments
  "equity.large::valuation": "auto",
  "equity.mid::valuation": "auto",
  "equity.small::valuation": "auto",
  "equity.intl::valuation": "manual",
  "equity.large::relvalue": "auto",
  "equity.mid::relvalue": "auto",
  "equity.small::relvalue": "auto",
  "equity.intl::relvalue": "manual",
  "equity.large::revisions": "manual",
  "equity.mid::revisions": "manual",
  "equity.small::revisions": "manual",
  "equity.intl::revisions": "manual",
  "equity.large::growth_diff": "static",
  "equity.mid::growth_diff": "rubric",
  "equity.small::growth_diff": "rubric",
  "equity.intl::growth_diff": "rubric",
  "equity.large::margin_cycle": "manual",
  "equity.mid::margin_cycle": "manual",
  "equity.small::margin_cycle": "manual",
  "equity.intl::margin_cycle": "manual",

  // §7.3 — Debt buckets
  "debt.liquid::carry": "auto",
  "debt.corporate::carry": "auto",
  "debt.gilt::carry": "auto",
  "debt.liquid::rate_cycle": "rubric",
  "debt.corporate::rate_cycle": "rubric",
  "debt.gilt::rate_cycle": "rubric",
  "debt.liquid::spread_cushion": "static",
  "debt.corporate::spread_cushion": "auto",
  "debt.gilt::spread_cushion": "static",
  "debt.liquid::liquidity": "static",
  "debt.corporate::liquidity": "static",
  "debt.gilt::liquidity": "static",

  // §7.4 — Precious metals
  "metals.gold::ratio_position": "auto",
  "metals.silver::ratio_position": "auto",
  "metals.gold::real_rates": "auto", // rubric §8.4, input is auto (FRED)
  "metals.silver::real_rates": "auto",
  "metals.gold::industrial": "static",
  "metals.silver::industrial": "rubric",

  // §7.5 — Sectors (x8), same 4-signal shape per sector
  ...Object.fromEntries(
    ["banking", "it", "pharma", "auto", "capgoods", "fmcg", "energy", "metals"].flatMap((sector) => [
      [`sector.${sector}::valuation`, "auto" as ScoreProvenance],
      [`sector.${sector}::revisions`, "manual" as ScoreProvenance],
      [`sector.${sector}::rel_momentum`, "auto" as ScoreProvenance],
      [`sector.${sector}::cycle_position`, "manual" as ScoreProvenance],
    ])
  ),
};
