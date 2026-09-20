# Missing Data Points — Cross-cutting Analysis

Patterns across all 40 unfilled data points, and what closing each gap would actually buy.

## Distribution

| Category | Rows | Share |
|---|---|---|
| [Sector Satellite](sector-satellite.md) | 16 | 40% |
| [Equity Segments](equity-segments.md) | 13 | 33% |
| [L1 Asset Classes](l1-asset-classes.md) | 5 | 13% |
| [Debt Buckets](debt-buckets.md) | 5 + 1 series | 15% |

By signal type, ignoring category:

| Signal | Cells | Rubric exists? |
|---|---|---|
| revisions | 12 | ❌ No |
| cycle_position | 8 | ❌ No |
| margin_cycle | 4 | ❌ No |
| growth_diff | 3 | ✅ Yes |
| rate_cycle | 3 | ✅ Yes (one selection drives all 3) |
| macro | 2 | ✅ Yes |
| fundamentals | 2 | ✅ Yes for `l1.debt`; ❌ none for `l1.equity` |
| valuation | 1 | n/a — adapter live, awaiting history |
| relvalue | 1 | ❌ No |
| carry | 1 | n/a — blocked on `aaa_3y` |
| spread_cushion | 1 | n/a — blocked on `aaa_3y` |
| momentum | 1 | ❌ No |

**9 of the 39 unfilled score cells have a working rubric picker** — the 2 macro cells, `l1.debt::fundamentals`, 3 growth_diff, and 3 rate_cycle. For those, the model is waiting on an analyst, not on engineering. The other 30 are manual number entry with no structured guidance.

(`rubricUi.ts` registers 9 specs covering 11 score IDs; the other two — `l1.metals::fundamentals` and `metals.silver::industrial` — are already auto-derived from real series, so they are not gaps. Their rubric pickers remain available as the manual-override path.)

## The three gaps worth acting on

### 1. Consensus EPS estimates — 13 cells, one missing data class

`revisions` across 4 equity segments and 8 sectors, plus `l1.equity::fundamentals`, all depend on consensus forward-earnings data that is sourced nowhere in the project. It is also the input an analyst needs to answer the 3 `growth_diff` rubrics honestly, so the real blast radius is **16 of 40 rows**.

Weight controlled: 0.30 on every sector composite, 0.20 on every equity segment, 0.20 on `l1.equity`.

`docs/DATA_SOURCES.md` has **no candidate source row** for this at all — unlike `aaa_3y` or banking-system liquidity, which have documented dead ends. Nobody has researched it yet. That makes it the highest-value open research question in the data layer, and the one gap here where the next step is "go look", not "the sources are dead".

### 2. `aaa_3y` — 1 series, 55% of a bucket

One series blocks `debt.corporate::carry` (0.30) and `debt.corporate::spread_cushion` (0.25). Unlike gap #1 this has been researched thoroughly and both free paths are confirmed dead (FIMMDA notice dated 2026-09-11 that FBIL data moved off-site; FBIL is a JS-only Angular SPA; remaining download links are 2017/2020 samples). Alternative routes — category-average YTM from Value Research, Morningstar, Tickertape, AMFI portfolios — were also all checked and confirmed dead.

Realistic options: a paid feed, a broker/terminal export, or accepting a documented proxy. Not solvable by more scraping effort on the known sources.

### 3. Rate cycle — 3 cells, one analyst selection

Already fully built. `rateCycleScores()` + the registered `rubricUi` spec mean one "expected 12m rate path" pick fills 30% of the score weight on all three debt buckets simultaneously. Best effort-to-coverage ratio in the model, and it needs no engineering at all.

## Unblocks on its own

`equity.intl::valuation` is the only row here with a live adapter. `sp500_fwd_pe` is fetching, but as a percentile-vs-history cell it needs 24 observations and had ~13 rows over 4 calendar days as of 2026-09-17. Expected to clear around **late October 2026**, after which wiring it is one `autoScore(db, "sp500_fwd_pe", params, "inverted")` call.

Worth a calendar reminder — nothing in the system will announce that it has become wireable.

## Frequency mismatch in the registry

`scoreEntry()` in `packages/server/src/dataPointRegistry.ts` stamps **every** manual cell `frequency: "quarterly"`:

```ts
frequency: isConstant ? "annual" : isAuto ? "daily" : "quarterly",
```

That is right for the cycle/macro cells and wrong for the 12 `revisions` cells, which move monthly. The Control Center's freshness funnel drives `due` at >7 days stale and `stale` at >45 days (`scoreFreshness()` in `routes/datapoints.ts`), so a monthly-moving cell reviewed on a quarterly cadence spends most of its life displaying a number the market has already moved past — while the UI reports it as on-schedule.

Two options, neither taken yet:

1. Add a per-signal frequency override so `revisions` reads `monthly`.
2. Leave the cadence and accept that quarterly review is the deliberate governance choice.

Worth an explicit decision rather than leaving it as an artifact of a one-line ternary.

## What is deliberately not in this document

- **7 structural constants** — correct as they stand, not awaiting input. `rowFromScore()` explicitly overrides their `mock` flag to `false` so they don't bury the genuinely-unfilled cells; the same reasoning applies to excluding them here.
- **15 governance parameters** — configured model parameters, not sourced values.
- **9 vetoes** — event-driven risk gates. "Inactive" is a real state, not a missing one.
- **39 auto-wired cells** — computed end-to-end from real adapter series.

Note that several auto-wired cells carry documented approximations (the Nifty TRI proxy for `l1.equity::momentum`, the USD-denominated gold return for `l1.metals::momentum`, `strongSolarEvCapex` hardcoded `false` for `metals.silver::industrial`). Those are data-*quality* caveats recorded in `docs/DATA_SOURCES.md` and the `scoreCells.ts` comments — a different problem from the coverage gaps tracked here.
