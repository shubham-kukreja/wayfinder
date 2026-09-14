# Session Summary — 2026-09-15

Data-sourcing and engine-correctness pass on the Wayfinder multi-asset allocation framework. Full detail on every data point lives in `docs/DATA_SOURCES.md` — this file is the narrative version, with emphasis on what was **approximated** and what's a **real blocker**.

## Engine fixes (not data-sourcing)

1. **Debt liquidity/safety rubric** — `metals.gold/silver::ratio_position`-style scoring was missing for `debt.liquidity`. Added `debtLiquidityScore()` in `rubrics.ts` with the spec's fixed baselines (Liquid 90 / Corporate 65 / Gilt 75, credit-stress overrides).
2. **Sector sleeve 4-quarter rotation** — the governance rule "no sector held more than 4 consecutive quarters" wasn't enforced anywhere. Added `SleeveHistory` tracking and forced rotation in `compute.ts`.

Both matched against the source spreadsheet (`docs/MultiAsset_Allocation_Framework_v2...xlsx`) to confirm exact rules before implementing.

## New data adapters built this session

| Adapter | Series | Status |
|---|---|---|
| `adapters/yahoo.ts` | `sp500_fwd_pe` | ✅ Live — S&P 500 forward P/E via constituent aggregation (Yahoo has no index-level figure) |
| `adapters/yahooMetals.ts` | `gold_usd_futures`, `silver_usd_futures`, `gold_etf_shares_outstanding` | ✅ Live — real historical gold/silver ratio (metals.dev has none); ETF flow proxy |
| `adapters/tradingEconomics.ts` | `global_mfg_pmi` | ✅ Live — Manufacturing PMI (China as global proxy) |
| `adapters/niftyindices.ts` | `sector_pe_*`, `sector_close_*`, `nifty50_div_yield` | ✅ Live — sector P/E incl. Capital Goods, real historical index backfill |
| `adapters/dbnomics.ts` | `cb_gold_reserves_tonnes` | ✅ Live — central bank gold reserves (WGC blocked; IMF via DBnomics instead) |
| `adapters/rbiRepoRate.ts` | `repo_rate` | ✅ Live — plain scrape of RBI's own homepage |
| `adapters/ccil.ts` | `tbill_1y` (2nd source) | ✅ Live — CCIL ZCYC, a more precise 1Y T-bill proxy |

All with real live-verified tests (unit + gated live tests), fixtures captured from actual responses, not synthetic data.

## ⚠️ Approximations — real, but not exact

These are wired and working, but **do not treat their output as precise** — they stand in for data that genuinely isn't available free:

### 1. Nifty 50 TRI 12-month return
**No real Total Return Index source exists free.** NSE has no TRI field; niftyindices.com only has a distinct "Nifty 50 Futures TR Index" (different product); investing.com's `NIFTRI` ticker is bot-blocked.

**Approximation used**: `12M TRI return ≈ (price return over 12M) × (1 + trailing Div Yield) − 1`, computed in `derive.ts`'s `niftyTriApprox12mReturn()` / `deriveNiftyMomentumSeries()`, feeding `l1.equity::momentum` (per the source spec's row 11: "Nifty 50 TRI 12M% minus 10Y G-sec yield, percentiled").

**Why it's not exact**: applies a single point-in-time dividend yield across the whole 12-month window. Diverges from AMFI's real published TRI return whenever yield itself moved meaningfully during that period. Not basis-point-accurate — treat as directionally reasonable, not precise.

### 2. 1Y T-bill yield
**India doesn't auction an exact 365-day bill** — the closest real instruments are 182-day and 364-day bills. Both sources used (RBI mirror's 183–364 day bucket average, and CCIL's specific 364-day security) are proxies for this structural reason, not an adapter limitation. Kept at this understanding even after CCIL was added as a second, more precise source (a real security's yield vs. an interpolated bucket average) — the underlying gap (no exact 1Y instrument) can't be fixed by a better adapter.

## ❌ Confirmed blockers — no free path found

Investigated thoroughly (multiple leads each, live-verified, not just assumed) — these remain manual-entry only:

### 1. 3Y AAA Corporate Bond yield
- FIMMDA (the traditional source) posted its own notice that benchmark data moved to FBIL.
- FBIL (`fbil.org.in`) turned out to be a JS-only Angular SPA. Found FBIL's real underlying JSON API (`wasdm/{product}/fetch`) but **no corporate-bond product exists on it** — confirmed by testing every plausible product name.
- **Genuinely no free automated source.** Manual: check FBIL's site directly, or market commentary from financial news sites.

### 2. Category Average YTM (Liquid/Corporate/Gilt funds)
Four separate leads tried, all dead:
- Value Research — confirmed 403 Cloudflare-blocked.
- Morningstar India — no category-overview page found via site nav.
- Tickertape's MF screener — found a real working API, but it only returns NAV/AUM/returns, never YTM or Modified Duration (these consumer tools appear to deliberately withhold portfolio-quality metrics to protect paid data products).
- AMFI's suggested portfolio-disclosure page — dead URL, not findable via AMFI's own nav either.
- **Manual**: Value Research or Morningstar in a normal browser (not a script) — both work fine for a human, just not for automation.

### 3. Banking system liquidity (LAF surplus/deficit)
- Found the real RBI page (`BS_LAF_Search.aspx`) — but it turned out to be an **auction calendar**, not settled daily amounts.
- CCIL's "Market Liquidity Indicators" page is real but is a navigation landing page with no data; its most relevant link is a **monthly report listing**, not daily figures, and measures a different thing (G-Sec liquidity, not banking-system LAF).
- RBI's press-release RSS feed has real pre-auction *notices* (repo/VRRR amounts, tenor) but not settled *results* — computing true net liquidity would mean parsing and netting several different press-release types, real non-trivial work not attempted this session.
- **Manual**: check RBI's daily Money Market Operations press releases directly and net Absorptions (SDF + reverse repo) − Injections (repo + MSF) by hand.

## Fabricated sources encountered (flag for future sessions)

Several pasted suggestions this session referenced products that turned out not to exist on live-checking:
- **"Parse.bot RBI Data API"** — parse.bot is a real generic no-code scraper SaaS, but has no such RBI-specific product. Referenced twice (for repo rate and for LAF data) — both times fabricated.
- Various FRED series IDs (`NAPM` for PMI, `GOLDPMGBD228NLBM`/`SLVPRUSD` for gold/silver) — none exist on FRED; it discontinued this class of licensed data years ago.
- Several guessed direct-download URLs (WGC's Excel, niftyindices.com's report links) that 404'd — the real links had to be found by reading the live page's actual markup, not guessed from a plausible-looking pattern.

**Lesson carried through the session**: never trust a suggested URL/series-ID/product name without a live check. Every fix in this session was verified against a real HTTP response before any code was written.

## Score cells still not wired (data exists, rubric wiring doesn't)

- `sector.*::rel_momentum` — real closing-price history now exists (`sector_close_*` via niftyindices.ts) but the 6M/12M relative-return calculation itself isn't derived yet.
- `l1.metals::fundamentals`'s `etfHoldings` half — the raw `gold_etf_shares_outstanding` trend derivation (`goldEtfHoldingsTrend()`) is built and wired into the full cell alongside `cbBuying`.
- `repo_rate` and India-specific PMI — both fetched/stored but have no rubric consumer in the current 85-cell model (not oversights — verified no score cell asks for them).

## Final data-source tally

**31 Live / 0 Partial / 5 Missing** (of the spec's ~36 tracked data points), up from roughly 20/2/10 at the start of this session. Full per-item detail, live-verification dates, and exact file paths are in `docs/DATA_SOURCES.md`.
