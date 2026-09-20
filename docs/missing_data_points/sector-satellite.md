# Missing Data Points — Sector Satellite

16 unfilled cells — the same two signals missing across all 8 sectors. Signal weights from `DEFAULT_PARAMS.signalWeights.sector`: valuation 0.30, revisions 0.30, rel_momentum 0.25, cycle_position 0.15.

| Data point | Dependencies | Description | Freq. of change |
|---|---|---|---|
| Banking — Revisions | Feeds `sector.banking` (0.30) | Direction of analyst earnings revisions for the sector | 1M |
| Banking — Cycle position | Feeds `sector.banking` (0.15) | Where the sector sits in its own business cycle | 1Q |
| IT — Revisions | Feeds `sector.it` (0.30) | Same | 1M |
| IT — Cycle position | Feeds `sector.it` (0.15) | Same | 1Q |
| Pharma — Revisions | Feeds `sector.pharma` (0.30) | Same | 1M |
| Pharma — Cycle position | Feeds `sector.pharma` (0.15) | Same | 1Q |
| Auto — Revisions | Feeds `sector.auto` (0.30) | Same | 1M |
| Auto — Cycle position | Feeds `sector.auto` (0.15) | Same | 1Q |
| Capital Goods — Revisions | Feeds `sector.capgoods` (0.30) | Same | 1M |
| Capital Goods — Cycle position | Feeds `sector.capgoods` (0.15) | Same | 1Q |
| FMCG — Revisions | Feeds `sector.fmcg` (0.30) | Same | 1M |
| FMCG — Cycle position | Feeds `sector.fmcg` (0.15) | Same | 1Q |
| Energy — Revisions | Feeds `sector.energy` (0.30) | Same | 1M |
| Energy — Cycle position | Feeds `sector.energy` (0.15) | Same | 1Q |
| Metals — Revisions | Feeds `sector.metals` (0.30) | Same | 1M |
| Metals — Cycle position | Feeds `sector.metals` (0.15) | Same | 1Q |

None of these 16 cells has a rubric picker — they are all pure manual score entry.

## Revisions — investigated 2026-09-20, deliberately NOT wired

`sector.*::revisions` (8 cells, 0.30 weight each — the joint-heaviest sector
signal) was run end-to-end through the wire-data-point flow and stopped at the
source step. Recording the dead ends so this is not re-derived.

**What the spec asks for** (Calculation Guide, SECTOR SATELLITE): *"Sector
revision breadth or 3M change in sector consensus EPS, percentile vs history,
AS-IS. Add +5 if the last results season showed beats > misses for the sector,
−5 if reverse."* Both primary quantities are **forward-looking analyst
estimates**; the ±5 modifier needs results-season beat/miss tallies.

**Sources checked, all dead for this purpose:**

| Source | Outcome |
|---|---|
| niftyindices.com | Publishes trailing P/E, P/B, Div Yield only. No consensus or forward EPS anywhere — forward P/E is not an NSE/Nifty Indices product; it depends on broker estimates. |
| NSE `api/allIndices` | Trailing figures only, same limitation. |
| TradingEconomics | Already wired for PMI/CPI. Its India calendar renders actual-vs-consensus in JS with no rows in server HTML — the same wall hit for `l1.equity::macro`'s `growthVsExpect` on 2026-09-19. |
| FMP / Twelve Data / EODHD / Apify | Do carry consensus and revision counts, but Indian sector-level coverage is paid-tier; no free unauthenticated path. |
| tickjournal.com | Publishes a market-cap-weighted Nifty IT EPS, but does not state whether it is trailing or forward, and gives no date. Unusable without that. |

**The substitute that was built, tested, and rejected.** Trailing EPS is
cleanly derivable from data already in the store as `sector_close_X ÷
sector_pe_X`, and its 3-month change yields a well-behaved series (banking: 566
observations, −7.7%..+9.9%, only 6 sign flips in 566 steps). It was rejected
anyway, because it is statistically convincing and semantically wrong:

> **Trailing EPS moves when companies REPORT. Consensus EPS moves when analysts
> REVISE.** These can point in opposite directions at exactly the moments that
> matter — a sector whose earnings have just collapsed shows trailing EPS
> falling (scored bearish) while analysts may be upgrading forward estimates on
> the turnaround. Wiring it would make the cell confidently backwards at cycle
> turns, which is precisely when a 0.30-weight signal decides sleeve entry.

This is the same rule `adapters/fred.ts` applies to the 364-day T-bill: *a wrong
number with enough observations to look confident is worse than an honest
`insufficient_history`.* The cells stay manual until a real consensus feed
exists.

**What would unblock them:** any source publishing per-sector consensus FY+1 EPS
or upgrade/downgrade counts monthly — ACE Equity, Bloomberg, Refinitiv, or a
paid tier of FMP/Twelve Data. This is the same missing input behind the 4
`equity.*::revisions` cells, the 3 `growth_diff` rubrics and
`l1.equity::fundamentals` — 16 cells on one source.

## The pattern is uniform

Every sector is filled and unfilled identically:

| Signal | Weight | Status |
|---|---|---|
| valuation | 0.30 | ✅ Auto — `sector_pe_*`, inverted percentile |
| rel_momentum | 0.25 | ✅ Auto — `sector_close_*` vs. `nifty50_close`, 6M/12M average excess return |
| **revisions** | **0.30** | ❌ Manual, all 8 sectors |
| **cycle_position** | **0.15** | ❌ Manual, all 8 sectors |

**45% of every sector score is analyst judgment**, and `revisions` alone is the joint-highest-weighted signal in the group, tied with valuation.

## Why this group matters disproportionately

The sector satellite is gated by `DEFAULT_PARAMS.sector`: `threshold: 70`, `maxSectors: 2`, `sleeveCap: 0.15`, `maxConsecutiveQuarters: 4`. A sector only earns an allocation when its composite **crosses 70**.

With valuation and rel_momentum supplying at most `0.30 + 0.25 = 0.55` of the weight, a sector cannot reach 70 on auto-wired signals alone unless those two are both extremely strong. The manual 45% is frequently what decides whether a sector clears the threshold and takes real money — so these 16 cells are not low-stakes filler, they are often the deciding vote on the only discretionary sleeve in the model.

## Detail

### Revisions (8 cells, 0.30 each)

Needs per-sector consensus EPS revision breadth. No adapter, and `docs/DATA_SOURCES.md` has no candidate source row for it. This is the same missing upstream as the 4 equity-segment revisions cells and `l1.equity::fundamentals` — 13 cells in total across the model depend on one class of data that is nowhere sourced. See [analysis.md](analysis.md).

**Why 1M:** Consensus revisions are republished monthly and can turn well inside a quarter. The registry currently stamps these `quarterly`, which understates their decay rate.

### Cycle position (8 cells, 0.15 each)

Where the sector sits in its own business cycle — a qualitative judgment with no rubric and no candidate source. Of every gap in this document these are the most inherently analyst-driven; a rubric picker (in the style of the existing rate-cycle or growth-diff pickers) would at least make the answers consistent and auditable across sectors, even without a data feed behind it.

**Why 1Q:** Business-cycle position turns on reported quarterly results and does not meaningfully move faster.
