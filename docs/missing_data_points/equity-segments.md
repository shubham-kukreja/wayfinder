# Missing Data Points — Equity Segments

7 unfilled cells (was 13 — `equity.{large,mid,small}::revisions` wired 2026-09-20, `equity.{mid,small,intl}::growth_diff` wired 2026-09-20, see below). `equity.*::margin_cycle` (4 cells) were investigated 2026-09-20 and left deliberately manual — see below, not re-derivable without new evidence. Signal weights from `DEFAULT_PARAMS.signalWeights.equity`: valuation 0.30, relvalue 0.20, revisions 0.20, growth_diff 0.15, margin_cycle 0.15.

| Data point | Dependencies | Description | Freq. of change |
|---|---|---|---|
| Large Cap — Margin / cycle | Feeds `equity.large` (0.15). Investigated 2026-09-20 — no repeatable free source (see below) | Where large-cap margins sit in the profit cycle | 1Q |
| Mid Cap — Margin / cycle | Feeds `equity.mid` (0.15). Same dead ends as large cap, plus no segment-level margin breakout at all | Mid-cap margin cycle position | 1Q |
| Small Cap — Margin / cycle | Feeds `equity.small` (0.15). Same dead ends as large cap, plus no segment-level margin breakout at all | Small-cap margin cycle position | 1Q |
| International — Valuation | Feeds `equity.intl` (0.30). `sp500_fwd_pe` adapter is **live** but has ~4 days of history vs. the 24 observations required | S&P 500 forward P/E percentile, inverted | 1D once wired |
| International — Relative value | Feeds `equity.intl` (0.20). No source for intl-vs-India relative valuation | International valuation vs. Indian equity | 1M |
| International — Revisions | Feeds `equity.intl` (0.20). No proxy exists (no global consensus EPS source; Nifty/S&P closes aren't a like-for-like earnings comparison) | Global analyst earnings revision breadth | 1M |
| International — Margin / cycle | Feeds `equity.intl` (0.15). US aggregate-margin candidate source (GuruFocus) bot-walled; investigated 2026-09-20 | Global margin cycle position | 1Q |

## Coverage by segment

| Segment | Unfilled | Filled | Unfilled share of score |
|---|---|---|---|
| Large Cap | margin_cycle ❌ manual (investigated, dead end) | valuation ✅ auto, relvalue ✅ auto, revisions ⚠️ auto (proxy), growth_diff ⚪ constant 50 | 15% |
| Mid Cap | margin_cycle ❌ manual (investigated, dead end) | valuation ✅ auto, relvalue ✅ auto, revisions ⚠️ auto (proxy), growth_diff ⚠️ auto (proxy) | 15% |
| Small Cap | margin_cycle ❌ manual (investigated, dead end) | valuation ✅ auto, relvalue ✅ auto, revisions ⚠️ auto (proxy), growth_diff ⚠️ auto (proxy) | 15% |
| **International** | **3 of 5** (valuation, relvalue, growth_diff wired; revisions + margin_cycle ❌ open, both investigated dead ends) | valuation once wired ✅, relvalue ✅, growth_diff ⚠️ auto (proxy) | **~50%** (revisions 0.20 + margin_cycle 0.15) |

`equity.large::growth_diff` is a structural constant, not a gap: large cap is the baseline every other segment's growth gap is measured against, so its own gap is zero by construction and the cell is always 50.

## Detail

### International — was the whole segment manual, now 2 of 5 signals live-proxy

`equity.intl` was, until 2026-09-20, the only node in the model where **every** signal was unfilled. It carries a 0.20 neutral weight within the equity group (`DEFAULT_PARAMS.neutralWeights.equity`) — second only to large cap's 0.45 — so this mattered disproportionately. `relvalue` (wired earlier 2026-09-20) and `growth_diff` (wired same day, see below) are now `auto`/`derived` proxies; `valuation` unblocks itself around late October per the note below; `revisions` and `margin_cycle` remain open.

### International — Valuation (`equity.intl::valuation`)

**The only cell in this document that unblocks itself.** This is a blocked item, not an oversight — `docs/DATA_SOURCES.md` records the reasoning as of 2026-09-17:

- The `sp500_fwd_pe` adapter is **live and verified** (`adapters/yahoo.ts`), aggregating `total constituent marketCap / total constituent forward earnings` across ~500 S&P 500 tickers.
- It is a **percentile-vs-history** cell, same shape as `equity.{large,mid,small}::valuation`, so it needs `percentileMinObservations` = **24** observations.
- The series has ~13 rows spanning 4 calendar days (2026-09-14 → 09-17), and `fetchHistory()` throws by design because no historical source for constituent-level forward P/E exists.
- Wiring it today would percentile today's value against ~4 days of its own history — a meaningless number dressed as a real score.

**Unblocks around late October 2026**, roughly 5 trading weeks from 2026-09-14, once ~24 daily refreshes have accumulated. At that point it is a one-line addition to `computeAutoScoreCells()` matching the existing pattern:

```ts
const result = autoScore(db, "sp500_fwd_pe", params, "inverted");
out.push({ scoreId: "equity.intl::valuation", value: result.value, status: result.status,
           derivedFrom: ["sp500_fwd_pe"], transform: "inverted", latestDate: result.latestDate });
```

**Correction to `docs/DATA_SOURCES.md`:** that file describes the adapter as "opt-in via `?sources=yahoo` (not in the default refresh set)". That note is stale. `parseRequestedSources()` in `packages/server/src/routes/refresh.ts` now defaults to `[...AVAILABLE_SOURCES]` when no `sources` param is given, and `yahoo` is in that list — a plain `POST /api/refresh` does fetch it. So the observation count accumulates on any default refresh, and the late-October estimate holds as long as the refresh runs daily.

### Growth differential — mid/small/intl wired 2026-09-20

Rubric-driven, `growthDiffScore(gapPp, segment)`. One field — FY+1 EPS growth gap vs. large cap:

| Selection | Score |
|---|---|
| ≥ +8pp | 75 |
| +3 to +8pp | 60 |
| −3 to +3pp | 50 |
| −8 to −3pp | 40 |
| < −8pp | 25 |

International gets **+5** on top of the band result, then clamps to 0–100.

`equity.{mid,small,intl}::growth_diff` are now `auto`/`derived`, wired via a **documented proxy**, same shape as the revisions cells: 12-month (YoY) change in segment trailing EPS minus the same for Nifty 100 (`deriveSegmentGrowthGapSeries` in `pipeline/derive.ts`), banded through `growthDiffScore()` — this is a rubric cell, so the latest gap value drives the score directly, no percentile step. `equity.large::growth_diff` is untouched — it stays the structural constant (zero gap by construction).

**This is not the spec's input**, same caveat as revisions: trailing EPS growth is reported earnings momentum, not analysts' forward FY+1 estimate, and the two can disagree at cycle turns.

**International carries a SECOND stacked deviation.** The US leg needed its own EPS series — `sp500_trailing_pe` only gives a ratio, not a level. `multpl.com/s-p-500-earnings/table/by-month` (same adapter as `sp500_trailing_pe`, a different page) publishes one, back to 1871, 358 rows backfilled 1996→2026, stored as `sp500_trailing_eps_real`. But that page's own label is **"12-month real earnings per share — inflation adjusted, constant dollars"** — confirmed live: its Jun-2026 value (295.36) sits ~14% below a nominal TTM EPS reading for essentially the same period (336.92, GuruFocus), too large a gap to be reporting lag alone. So the US leg's 12M change is a REAL growth rate, while the India leg (`nifty100_close ÷ nifty100_pe`, 12M change) is NOMINAL INR — no deflator applied. The gap this cell computes is real-US-growth minus nominal-India-growth (`deriveIntlGrowthGapSeries`), which drifts from a clean comparison whenever US and India CPI inflation diverge over the trailing year. Both deviations (trailing-vs-consensus, real-vs-nominal) are stated in `rubricInputs[].basis` and the trace.

Live 2026-09-20: mid +17.4pp gap → 75, small −2.8pp gap → 50, intl +18.2pp gap → 80 (75 banded + 5 intl bonus).

### Revisions — large/mid/small wired 2026-09-20, intl still manual

`equity.{large,mid,small}::revisions` are now `auto`/`derived`, wired via a **documented proxy**: 3M change in segment trailing EPS (`nifty100_close ÷ nifty100_pe` etc., new `nifty100_close`/`midcap150_close`/`smallcap250_close` series mapped in `adapters/niftyindices.ts`), percentiled AS-IS against its own 10Y month-end history (`deriveTrailingEps3mChangeSeries` in `pipeline/derive.ts`, wired in `scoreCells.ts`).

**This is not the spec's input.** The spec wants upgrade/downgrade breadth or consensus FY+1 EPS change — genuinely forward analyst estimates. Trailing EPS is backward (moves on reporting, not revision). This exact substitute was built, tested, and **explicitly rejected** for the 8 `sector.*::revisions` cells (see [sector-satellite.md](sector-satellite.md)) because trailing and consensus EPS can point opposite directions at cycle turns — precisely when a 0.20-weight signal should be most informative. It was wired here anyway on explicit instruction, with the deviation stated in `derivedFrom`, `rubricInputs[].basis`, and the trace. Treat these three cells' `revisions` score with that caveat in mind; it is a **proxy for earnings momentum, not for what analysts think will happen next**.

`equity.intl::revisions` has **no equivalent proxy** — no free global consensus source exists, and comparing Nifty vs. S&P closes is not a like-for-like earnings measure — so it remains pure manual score entry.

**Why 1M:** Consensus estimate revisions (and this proxy) are published and move monthly. Stamping these quarterly (as the registry does today for the still-manual intl cell) understates how fast they go stale.

### Margin / cycle — investigated 2026-09-20, deliberately NOT wired

`equity.{large,mid,small,intl}::margin_cycle` (4 cells, 0.15 weight each) was run end-to-end through the wire-data-point flow and stopped at the source step for every leg. Recording the dead ends so this is not re-derived.

**What the spec asks for** (Calculation Guide, "Margin / cycle position"): *"Segment aggregate EBITDA margin percentile vs own history, INVERTED (peak margins = mean-reversion risk), averaged with a cycle rubric: credit growth accelerating +10, capacity utilization >75% +5 (both favour domestic mid/small), else 0/negative. International: use US margin percentile inverted."* Three independent quantities, all dead ends:

**1. Segment aggregate EBITDA margin — no repeatable source for any segment.**

| Source | Outcome |
|---|---|
| NSE's free quarterly "Corporate Performance Review" PDF (`nsearchives.nseindia.com`) | **The only real candidate found**, plain unauthenticated GET, no bot-wall. Reports Nifty 50 / Nifty 500 / Nifty 500 ex-Nifty 50 EBITDA margin each quarter — genuinely covers large cap. Does **NOT** break out Nifty Midcap 150 or Nifty Smallcap 250 specifically anywhere in the document (confirmed reading the full Sept 2026 vintage, Vol. 8 Issue 1) — mid/small have no equivalent even if the large-cap leg worked. |
| Same NSE PDF, for the large-cap leg specifically | **Has no repeatable discovery mechanism.** The PDF's filename embeds an unpredictable slug+timestamp (`Q1FY27_Corporate_Earnings_Review_v1.0_20260911_20260916121318.pdf`) that cannot be constructed from the quarter alone, unlike AMFI's `am<mon><yyyy>repo.pdf` pattern. No static NSE page or working `nseindia.com` API endpoint was found listing past or current EPR reports (tried the same cookie-harvest pattern `nse.ts` already uses against several plausible `/api/` paths — none returned a report index). The only reason this session has the Sept 2026 content at all is that a web search happened to surface its exact URL — not a mechanism an adapter's scheduled refresh can repeat. |
| Same NSE PDF, even if discovery were solved | The "Quarterly EBITDA margin trend" it shows (Figure 16 style) is a **rendered chart image**, not a data table — the PDF gives only the current quarter's point value in text, no exportable history. With `percentileMinObservations = 24` and a quarterly cadence, a percentile-vs-own-history leg here would need **~6 years** of quarterly refreshes to clear the floor even with discovery solved — far slower than any other cell in this project. |
| GuruFocus's dedicated "S&P 500 Operating Margin" indicator page (candidate for the intl US leg) | 403 Forbidden on a bare unauthenticated GET (checked live 2026-09-20) — bot-walled. |
| CSIMarket, DQYDJ, MacroTrends (other margin aggregators surfaced by search) | Not checked in depth once the pattern (aggregator sites gate structured margin data) was confirmed on the first two; same class of source as the already-documented consensus-EPS dead ends. |

**2. Credit growth accelerating — no queryable series.** RBI publishes bank credit growth commentary in narrative form (e.g. "20% YoY credit growth in Q1FY27" inside the NSE PDF above), but no clean structured series was found. RBI's own sectoral-credit-deployment page (`rbi.org.in/Scripts/Data_Sectoral_Deployment.aspx`) sits behind the same bot-wall as (3) below.

**3. Capacity utilization >75% (RBI OBICUS) — confirmed bot-walled dead end.** The spec names RBI OBICUS explicitly. `dbie.rbihub.in` (the third-party DBIE mirror this project already scrapes for CPI/T-bills via `adapters/rbi.ts`) has no OBICUS page in its catalog (checked its `/growth` section directly — only Index of Industrial Production is listed). RBI's own publications index page (`rbi.org.in/Scripts/QuarterlyPublications.aspx?head=...`) does link one live PDF (`rbidocs.rbi.org.in/rdocs/Publications/PDFs/OBICUS...PDF`), but fetching it returns a TSPD anti-bot challenge page, not the PDF — confirmed live 2026-09-20, and `rbi.org.in`'s own homepage (already scraped successfully by `adapters/rbiRepoRate.ts`) showed the same challenge signature on this check, suggesting either a site-wide change or a fingerprinting difference from that adapter's exact request shape. Worth re-checking if `rbiRepoRate.ts` ever needs revisiting for an unrelated reason.

**Net: all three sub-quantities are dead for every segment**, not just the hardest one. Unlike `revisions` and `growth_diff`, there is no documented-substitute path available here — a trailing-EBITDA-margin proxy would face the same real-vs-nominal-style caveats as those cells but additionally has no history-bearing source to build one from at all. All 4 cells stay `provenance: "manual"`, held at the neutral 50 (rubric's own no-adjustment case — `mock/snapshot.json` previously held 55/40/30/50, stale demo filler predating this investigation; corrected to 50 across all four 2026-09-20, same "unowned number dressed as a result" fix already applied to `equity.large::growth_diff`'s baseline).

**What would unblock this:** any source publishing (a) segment-level aggregate EBITDA margin with real history in machine-readable form — ACE Equity, Bloomberg, a paid CMIE Prowess/LSEG feed (the NSE PDF's own stated sources), or (b) a working, repeatable path to NSE's Corporate Performance Review archive (its own site navigation, not search-engine discovery) even without solving the 6-year accumulation problem, or (c) any working path past RBI's current bot-wall for OBICUS/credit data.

**Why 1Q:** Margin cycle position turns on reported quarterly results.
