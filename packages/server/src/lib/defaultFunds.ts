import type { NavRow } from "../adapters/amfiNav.js";

// Maps each backtest sleeve to a default fund, matched by NAME PATTERN
// against the free AMFI NAV universe. AMFI publishes NO structured
// per-scheme category field on any free endpoint (confirmed live
// 2026-09-20 — the only category signal AMFI gives for free is
// amfi.ts's monthly CATEGORY-LEVEL flow/AUM report, which has no
// per-scheme breakdown at all) — scheme name is the only free signal that
// reliably encodes category, which is how every other free/retail tool
// against this data source does it too.
//
// Keys match packages/engine/src/compute.ts's rollup row ids exactly —
// the L2 core nodes keep their NodeId ("equity.large", "debt.liquid", …),
// but a HELD sector tilt is rolled up under "sleeve.<sector>" (e.g.
// "sleeve.banking" for sector.banking — see compute.ts's
// `sleeve.${sectorId.split(".")[1]}`), NOT under the NodeId "sector.banking"
// itself. Using "sector.*" here would silently never match any rollup row
// the frontend actually receives.
//
// Patterns are checked in order against schemeName; the first regex that
// matches wins. Ordered from most to least specific so e.g. "Banking and
// Financial Services Fund" (sleeve.banking) is tried before a broader
// "Banking" pattern could ever exist and mis-claim it.
const SLEEVE_NAME_PATTERNS: Record<string, RegExp> = {
  "equity.large": /\blarge\s*cap\s*fund\b/i,
  "equity.mid": /\bmid\s*cap\s*fund\b/i,
  "equity.small": /\bsmall\s*cap\s*fund\b/i,
  "equity.intl": /\b(us equity|global equity|nasdaq|international equity fund|international fund)\b/i,
  "debt.liquid": /\bliquid fund\b/i,
  "debt.corporate": /\bcorporate bond fund\b/i,
  "debt.gilt": /\bgilt fund\b/i,
  "metals.gold": /\bgold (etf|fund)\b/i,
  "metals.silver": /\bsilver (etf|fund)\b/i,
  "sleeve.banking": /\bbanking (and|&) financial services fund\b/i,
  "sleeve.it": /\b(technology|it) fund\b/i,
  "sleeve.pharma": /\bpharma (and|&) healthcare fund\b/i,
  "sleeve.auto": /\b(automotive|auto) (opportunities )?(fund|index fund)\b/i,
  // No standalone "Capital Goods Fund" exists in the free AMFI universe
  // (confirmed live 2026-09-20 — only manufacturing/infra funds, which are
  // a different, broader thematic, not a clean substitute) — sleeve.capgoods
  // deliberately has no pattern and is left without a default.
  "sleeve.fmcg": /\bconsumption fund\b/i,
  "sleeve.energy": /\b(resources? (and|&) (new )?energy|energy) fund\b/i,
  "sleeve.metals": /\bnifty metal (etf|fof|index fund)\b/i,
};

// Preference order among plan/option variants for the same underlying
// scheme name match — Direct plan (lowest expense ratio, what a rational
// new allocation should default to) and Growth option (NAV reflects total
// return; IDCW payouts would need adjustment this app doesn't do), in that
// priority order.
function planScore(row: NavRow): number {
  const plan = (row.plan ?? "").toLowerCase();
  const option = (row.option ?? "").toLowerCase();
  let score = 0;
  if (plan.includes("direct")) score += 2;
  if (option.includes("growth")) score += 1;
  return score;
}

export interface DefaultFundPick {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
}

// Picks one default fund per sleeve from the full AMFI universe. Where
// several schemes match a sleeve's pattern (the common case — dozens of
// AMCs each run a "Large Cap Fund"), ranks by:
//
//   1. Existed as of `establishedSince` (an old-universe scheme-code set
//      from fetchSchemeCodesExistingOn) — established funds first.
//   2. Direct plan + Growth option (lowest cost, NAV = total return).
//   3. Highest NAV among the remaining ties, as a weak same-cohort proxy
//      for "longer-running" — NAV alone is NOT used across the
//      established/new boundary any more: it broke for commodity-tracking
//      ETFs (a gold/silver ETF's NAV tracks the metal price, not fund
//      age, so a brand-new gold ETF can out-NAV a decade-old one purely
//      because gold got more expensive). Confirmed live 2026-09-20: the
//      old NAV-only ranking picked "Choice Gold ETF" (launched
//      2025-11-07) and "360 ONE Silver ETF" (launched 2025-04-03) as
//      metals.gold/metals.silver defaults — both too young for this app's
//      5-year default backtest window, silently producing "no NAV
//      history found for this date" on every leg using them.
//
// If NO candidate for a sleeve existed as of `establishedSince` (every
// match is a genuinely new category), falls back to the same-cohort
// ranking among all candidates rather than picking nothing — a young
// default is still better than an empty picker.
export function pickDefaultFunds(rows: NavRow[], establishedCodes: ReadonlySet<string> = new Set()): DefaultFundPick[] {
  const picks: DefaultFundPick[] = [];

  for (const [sleeveId, pattern] of Object.entries(SLEEVE_NAME_PATTERNS)) {
    const candidates = rows.filter((r) => pattern.test(r.schemeName));
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const establishedDiff = Number(establishedCodes.has(b.schemeCode)) - Number(establishedCodes.has(a.schemeCode));
      if (establishedDiff !== 0) return establishedDiff;
      const scoreDiff = planScore(b) - planScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.nav - a.nav;
    });

    const best = candidates[0]!;
    picks.push({ sleeveId, schemeCode: best.schemeCode, schemeName: best.schemeName });
  }

  return picks;
}
