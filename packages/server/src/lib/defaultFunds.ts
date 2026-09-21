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
//
// `recentlyEstablishedCodes` is an OPTIONAL second, nearer probe that
// breaks exactly that fallback case. The single 8-year gate is binary, so
// within a category where nothing is 8 years old — silver ETFs, none of
// which predate 2022 — every candidate ties on it and rank 3 (highest
// NAV) decides. For a metal-tracking fund NAV is the metal price, not
// fund age, so that systematically re-selected the YOUNGEST fund: the
// 2025-04-03 360 ONE Silver ETF beat four 2022 funds, and a 5-year
// backtest then reported that leg as missingHistory with zero value.
// Confirmed live 2026-09-21. A probe a few years back separates the 2022
// cohort from the 2025 one and the older fund wins, without changing any
// sleeve where the 8-year gate already decides.
export function pickDefaultFunds(
  rows: NavRow[],
  establishedCodes: ReadonlySet<string> = new Set(),
  recentlyEstablishedCodes: ReadonlySet<string> = new Set()
): DefaultFundPick[] {
  return pickTopFundsPerSleeve(rows, 1, establishedCodes, recentlyEstablishedCodes).map(({ sleeveId, schemeCode, schemeName }) => ({
    sleeveId,
    schemeCode,
    schemeName,
  }));
}

// The same ranking pickDefaultFunds uses, but keeping the top `perSleeve`
// candidates instead of only the winner. Exists for the NAV prefetch
// (scripts/prefetchBacktestHistory.ts): production cannot fetch AMFI
// history itself — Railway's egress to portal.amfiindia.com is throttled
// to ~1-22KB/s against ~1-2MB/s from a normal connection (measured live
// 2026-09-21 from inside the container, on both the 24MB history endpoint
// and the ~1MB NAVAll.txt), so a 24MB chunk there would need hours. The
// history is therefore fetched locally and shipped in the SQLite file,
// and caching several candidates per sleeve rather than just the default
// means switching a leg to the 2nd/3rd choice in the picker still hits
// cache instead of a fetch production cannot complete.
//
// This does NOT cover an arbitrary fund chosen through the search box —
// there are ~14k schemes and no way to pre-cache them all. Those legs
// still fall back to a live fetch and will be slow/fail on production
// until that egress problem is solved.
export function pickTopFundsPerSleeve(
  rows: NavRow[],
  perSleeve: number,
  establishedCodes: ReadonlySet<string> = new Set(),
  recentlyEstablishedCodes: ReadonlySet<string> = new Set()
): DefaultFundPick[] {
  const picks: DefaultFundPick[] = [];

  for (const [sleeveId, pattern] of Object.entries(SLEEVE_NAME_PATTERNS)) {
    const candidates = rows.filter((r) => pattern.test(r.schemeName));
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const establishedDiff = Number(establishedCodes.has(b.schemeCode)) - Number(establishedCodes.has(a.schemeCode));
      if (establishedDiff !== 0) return establishedDiff;
      // Only bites where the 8-year gate tied — i.e. a category too new
      // for any candidate to clear it. Keeps NAV from deciding by proxy
      // for "most recently launched at a high unit price".
      const recentDiff = Number(recentlyEstablishedCodes.has(b.schemeCode)) - Number(recentlyEstablishedCodes.has(a.schemeCode));
      if (recentDiff !== 0) return recentDiff;
      const scoreDiff = planScore(b) - planScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.nav - a.nav;
    });

    // One entry per distinct scheme NAME. AMFI lists every plan/option
    // variant as its own scheme code, so without this a sleeve's slots
    // fill with e.g. five Direct/Regular × Growth/IDCW rows of the same
    // Tata fund — five codes, one actual fund. The sort already put each
    // name's best variant first, so keeping the first occurrence keeps
    // that choice while spending the remaining slots on real alternatives.
    const seenNames = new Set<string>();
    for (const row of candidates) {
      if (seenNames.size >= perSleeve) break;
      const name = row.schemeName.trim().toLowerCase();
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      picks.push({ sleeveId, schemeCode: row.schemeCode, schemeName: row.schemeName });
    }
  }

  return picks;
}
