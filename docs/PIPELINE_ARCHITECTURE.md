# Wayfinder Pipeline Architecture

**External data → Control Center data points → score parameters → score calculation → model allocation.**

Written 2026-09-20 against `develop`. Every count and number in the "live state" sections was produced by running `buildCurrentSnapshot()` against `packages/server/data/wayfinder.db` on that date, not inferred from code reading.

---

## 0. The one-paragraph version

Sixteen adapters scrape or call sixteen external sources and append raw `(series_id, date, value, source, fetched_at)` rows into one append-only SQLite table. A derivation layer turns those raw series into the *quantities the model actually ranks* (real yields, 12-month returns, 3-month flow ratios, gold/silver ratios). Each derived quantity is percentile-ranked against its own trailing history — or fed into a discrete rubric table — to produce a **0-100 score** for one `node::signal` cell. There are 85 such cells. A weighted sum of a node's signal scores gives its **composite** (also 0-100); the composite's distance from 50 becomes a **tilt** applied to a fixed neutral weight; tilts are renormalised within each group and multiplied down the tree to get **portfolio weights**. The Data Points Control Center is the operator-facing view over the whole chain, and its central job is to say honestly which of the 85 cells are real and which are still demo baseline.

---

## 1. The five stages

```
┌─ STAGE 1: EXTERNAL SOURCES ────────────────────────────────────────────┐
│ FRED · NSE · niftyindices · AMFI · RBI (×2) · CCIL · metals.dev/IBJA   │
│ Yahoo (×2) · TradingEconomics · DBnomics · BIS · AMFI NAV              │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ packages/server/src/adapters/*.ts
                             │ SourceAdapter.fetchLatest() / fetchHistory()
                             ▼
┌─ STAGE 2: OBSERVATION STORE ───────────────────────────────────────────┐
│ SQLite `observations` — APPEND ONLY                                    │
│ PK (series_id, date, fetched_at); "latest fetched_at wins" on read     │
│ 55 distinct series live today                                          │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ packages/server/src/pipeline/derive.ts
                             ▼
┌─ STAGE 3: DERIVED QUANTITIES ──────────────────────────────────────────┐
│ real_gsec_10y = gsec_10y − cpi_yoy      gold_silver_ratio_20y          │
│ nifty TRI 12m return − gsec_10y          flow_ratio_equity_3m          │
│ real_gold_inr = gold_usd × usd_inr ÷ cpi bond_index_return_12m  …      │
│ These, not the raw legs, are what gets percentiled.                    │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ pipeline/scoreCells.ts + percentile.ts
                             │ engine/rubrics.ts
                             ▼
┌─ STAGE 4: THE 85 SCORE CELLS (0-100) ──────────────────────────────────┐
│ scores["l1.equity::valuation"] = 63.2  (percentile, auto)              │
│ scores["l1.equity::macro"]     = 45.0  (rubric)                        │
│ 41 live / 44 still mock baseline as of 2026-09-20                      │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ packages/engine/src/compute.ts
                             ▼
┌─ STAGE 5: ALLOCATION ──────────────────────────────────────────────────┐
│ composite → tilt → prelim → renormalise → portfolio weight             │
│ Equity 70.3% / Debt 23.5% / Metals 6.3%  (sums to exactly 1.0)         │
└────────────────────────────────────────────────────────────────────────┘
```

The one function that runs stages 2→5 in order is **`buildCurrentSnapshot()`** (`packages/server/src/pipeline/currentSnapshot.ts`). It is the single source of truth for "what is the current state," shared by `GET /api/snapshot`, `POST /api/refresh`, `POST /api/snapshots`, and `GET /api/datapoints`.

---

## 2. Stage 1 — Where the external data actually comes from

This is the highest-risk part of the system: **almost none of it is a supported API.** Most sources are scrapes of HTML or PDF with no SLA, chosen after documented dead ends. Per-adapter detail lives in `docs/DATA_SOURCES.md`; this is the structural summary.

### 2.1 The sixteen adapters

| Adapter file | `id` | Endpoint / mechanism | Auth | Series written | History? |
|---|---|---|---|---|---|
| `fred.ts` | `FRED` | `api.stlouisfed.org/fred/series/observations` — real JSON API | **API key required** (v2, Nov 2025+) | `us_real_10y` (DFII10), `gsec_10y` (INDIRLTLT01STM), `cpi_index` (INDCPIALLMINMEI), `usd_inr` (DEXINUS) | ✅ full |
| `nse.ts` | `NSE` | `nseindia.com/api/allIndices` — cookie-harvest then JSON | none (browser UA + Referer) | `nifty50_pe`, `nifty100_pe`, `midcap150_pe/pb`, `smallcap250_pe/pb`, `sector_pe_*` ×7 | ❌ latest only (Akamai blocks historical paths) |
| `niftyindices.ts` | `NIFTYINDICES` | `niftyindices.com/Daily_Snapshot/ind_close_all_DDMMYYYY.csv` | none | same `*_pe/pb` names **plus** `sector_pe_capgoods`, `nifty50_close`, `sector_close_*` ×8, `nifty50_div_yield`, `bond_index_close` | ✅ per-day CSV backfill |
| `amfi.ts` | `AMFI` | `portal.amfiindia.com/spages/am<mon><yyyy>repo.pdf` — **PDF parse** | none | `flow_*`/`aum_*` for largecap, midcap, smallcap, sectoral, goldetf, equity total, duration total | ✅ constructible URL per month |
| `amfiNav.ts` | `AMFI_NAV` | `NAVAll.txt` + `DownloadNAVHistoryReport_Po.aspx` | none | `amfi_nav:<scheme_code>` (runtime allowlist from `tracked_schemes`) | ✅ |
| `rbi.ts` | `RBI` | `dbie.rbihub.in` — **headless Playwright**, AG Grid pagination | none | `cpi_index`, `cpi_yoy`, `tbill_1y` | ✅ (slow, ~19s) |
| `rbiRepoRate.ts` | `RBI` | `rbi.org.in` homepage HTML regex | none | `repo_rate` | ❌ current value only |
| `ccil.ts` | `CCIL` | `ccilindia.com/tenorwise-indicative-yields` — Playwright, `#dtTable` | none | `tbill_1y` (364D row — better than RBI's bucket average) | ❌ today only |
| `bullion.ts` | `IBJA` | `api.metals.dev/v1/latest` | **API key**, 100 req/**month** | `gold_inr`, `silver_inr` | ❌ latest only |
| `yahooMetals.ts` | `YAHOO_METALS` | `query1.finance.yahoo.com` v8 chart + v7 quote, cookie+crumb | none | `gold_usd_futures` (GC=F), `silver_usd_futures` (SI=F), `gold_etf_shares_outstanding` (GLD+IAU) | ✅ 25 years |
| `yahoo.ts` | `YAHOO` | Yahoo v7 quote + **Wikipedia** for the S&P 500 constituent list | none | `sp500_fwd_pe` (aggregated over ~500 tickers) | ❌ |
| `tradingEconomics.ts` | `TRADINGECONOMICS` | `tradingeconomics.com/...` — **meta-description scrape** | none | `global_mfg_pmi`, `cpi_yoy` | ❌ latest + prior only |
| `dbnomics.ts` | `DBNOMICS` | `api.db.nomics.world/v22/.../IMF/IFS/M.W00.RAFAGOLDV_OZT` | none | `cb_gold_reserves_tonnes` | ✅ |
| `bisPolicyRate.ts` | `BIS` | `stats.bis.org/api/v2/data/.../WS_CBPOL/1.0/M.IN?format=csv` | none | `repo_rate` (history back to 2006) | ✅ |
| `multpl.ts` | `MULTPL` | `multpl.com/s-p-500-pe-ratio/table/by-month` — static HTML table | none | `sp500_trailing_pe` (**trailing**, substituted for the spec's forward P/E) | ✅ monthly to 1871 |
| `aaa3y.ts` | `AAA3Y_MOCK` | **no real source** — placeholder | — | `aaa_3y` | ❌ |

### 2.2 Four structural patterns worth knowing

**Multiple adapters deliberately write the same series.** `repo_rate` comes from BIS (238 monthly rows, history), DBnomics (110 rows), and the RBI homepage (today's value). `tbill_1y` comes from both RBI's mirror and CCIL. `cpi_yoy` from both RBI and TradingEconomics. `sector_pe_*` from both NSE and niftyindices. This is intentional: the store's "latest `fetched_at` wins per (series, date)" rule resolves overlaps with no preference logic, so a new better source is purely additive. One adapter supplies depth (history/backfill), another supplies currency (today's print).

**Latest-only sources must accumulate.** NSE, CCIL, metals.dev, TradingEconomics and the RBI homepage have no historical endpoint, so their `fetchHistory()` is a deliberate no-op. Their history only exists if the daily refresh actually runs. This is why `gold_inr` holds 16 rows while `gold_usd_futures` holds 2,185 — and why several score cells prefer the Yahoo futures pair over IBJA spot despite IBJA being the benchmark.

**Failure is a warning, never an exception.** `runRefresh()` (`pipeline/refresh.ts`) fans out to all adapters with `Promise.allSettled` + a per-source timeout (15s default, 45s when RBI/Yahoo/CCIL are in the batch). A dead source produces a `fetch_log` row, a `source_failed` warning, and nothing else — the other sources still write.

**Known holes, honestly tracked.** `aaa_3y` (3Y AAA corporate yield — FIMMDA and FBIL both confirmed dead ends) blocks `debt.corporate::carry` and `debt.corporate::spread_cushion`. Category-average YTMs for debt buckets, banking-system liquidity, analyst consensus EPS revisions, and G-sec supply expectations have no free source at all. `docs/missing_data_points/` breaks these down by model group.

### 2.3 Live store coverage (2026-09-20)

55 distinct series. Depth is very uneven and that unevenness directly determines which cells can compute:

- **Deep (1,000+ rows):** `us_real_10y` 25,029 · `usd_inr` 10,013 · `gold_usd_futures` 2,185 · `silver_usd_futures` 2,184 · all niftyindices `*_pe/_close` 2,083 each (from 2024-08)
- **Adequate (100-1,000):** `gsec_10y` 897 (from 2011) · `cpi_index` 669 FRED + 28 RBI · `cb_gold_reserves_tonnes` 439 · AMFI flow/AUM series ~337-357 each (from 2021) · `repo_rate` 238 BIS · `sector_*_capgoods` 278 (from 2026-06) · `bond_index_close` 73 monthly
- **Thin (<50):** `tbill_1y` 40+16 · `global_mfg_pmi` 21 (2 distinct months, by design) · `cpi_yoy` 18 RBI + 4 TE · `gold_inr`/`silver_inr` 16 · `sp500_fwd_pe` 15 · `gold_etf_shares_outstanding` 15

The percentile floor is `percentileMinObservations = 24`. Anything under that returns `insufficient_history` → the cell keeps its baseline value but is flagged `mock`.

---

## 3. Stage 2 — The observation store

`packages/server/src/store/schema.ts`, `observations.ts`.

```sql
CREATE TABLE observations (
  series_id TEXT, date TEXT, value REAL, basis TEXT,
  source TEXT, fetched_at TEXT,
  PRIMARY KEY (series_id, date, fetched_at)
);
```

Append-only by design. A revision (RBI and MoSPI both revise published figures) inserts a new row with a later `fetched_at`; the old row survives for audit. Two read functions matter:

- **`latestObservations(db, seriesId)`** — collapses each date to the row with the max `fetched_at`. The normal read.
- **`latestObservationsBySource(db, seriesId)`** — latest per *(date, source)*. Needed only for the CPI splice: FRED and RBI both publish 2025-01..03, and the plain read hid the overlap that the splice needs to compute a rebase factor.

Other tables: `manual_scores`, `manual_vetoes` (human overrides), `params` (saved governance parameters), `snapshots` (published allocations of record), `fetch_log`, `tracked_schemes`, `users`.

---

## 4. Stage 3 — Derivation: what actually gets ranked

`packages/server/src/pipeline/derive.ts` (1,118 lines) is the most conceptually important file in the repo and the easiest to misread.

**The core insight: the model almost never percentiles a raw series.** It percentiles a *derived quantity*. `l1.debt::valuation` is a "percentile" cell, but what it ranks is `gsec_10y − cpi_yoy` — so neither leg's own percentile is an input to the score. Getting this wrong produced a real, documented bug: the UI showed `gsec_10y` at the 29th percentile next to a cell scoring 70.

This is why `packages/engine/src/scoreMap.ts` carries a per-series **`SeriesRole`**:

- `"percentile"` — this series' *own* percentile is an input. Draw the distribution strip.
- `"raw"` — the series is only an *operand* of a derivation. Show the number; a strip would contradict the score.

`seriesRole()` defaults conservatively: a strip is drawn only where the map explicitly says the series was percentiled on its own, or where the cell is single-series percentile/inverted (the one case where leg and ranked quantity are necessarily identical).

### 4.1 The derived series catalogue

| Derived series | Formula | Legs | Feeds |
|---|---|---|---|
| `real_gsec_10y` | `gsec_10y − cpi_yoy`, joined **by year-month** | FRED, RBI/TE | `l1.debt::valuation` |
| `us_real_10y_6m_change_bp` | `(now − 6m ago) × 100` | FRED DFII10 | `metals.{gold,silver}::real_rates`, `l1.metals::macro` |
| `gold_silver_ratio_20y` | `gold_usd_futures ÷ silver_usd_futures`, clipped to 20y | Yahoo Metals | both `::ratio_position` cells |
| `real_gold_inr` | `gold_usd_futures × usd_inr ÷ cpi_index_spliced` | Yahoo, FRED, FRED+RBI | `l1.metals::valuation` |
| `cpi_index_spliced` | FRED series rebased onto RBI's post-rebase base using the overlap window | FRED + RBI | the deflator above |
| `gold_return_12m_inr` / `_6m_` | trailing INR gold return | Yahoo × FRED | `l1.metals::momentum`; 6m drives `veto.parabolic` |
| `flow_ratio_equity_3m` | 3-month mean of `flow_equity_3m ÷ aum_equity` | AMFI | `l1.equity::flows` |
| `flow_ratio_duration_3m` | same for debt | AMFI | `l1.debt::flows` |
| `flow_goldetf_3m` | 3-month mean flow (no AUM denominator — spec names none) | AMFI | `l1.metals::flows` |
| `bond_index_return_12m` | 12m return of the Nifty Composite G-sec TR Index | niftyindices | `l1.debt::momentum` |
| Nifty excess return | `TRI 12m return − gsec_10y`, per historical date | niftyindices + FRED | `l1.equity::momentum` |
| Earnings-yield gap | `1/nifty50_pe − gsec_10y` | NSE/niftyindices + FRED | `l1.equity::valuation` (half of it) |
| Mid/Small−Large P/E spread | `midcap150_pe − nifty100_pe` etc. | niftyindices | `equity.{mid,small,large}::relvalue` |
| `india_us_valuation_gap` | `nifty100_pe − sp500_trailing_pe`, joined by **year-month** | niftyindices + multpl | `equity.intl::valuation`'s ±5-10 adjustment |
| Sector relative momentum | sector close return − Nifty 50 return | niftyindices | `sector.*::rel_momentum` ×8 |
| `deriveCpiYoySeries` | YoY of the spliced CPI index | FRED + RBI | the real-yield join |

### 4.2 Three derivation subtleties that are load-bearing

**Join granularity differs by pair.** `derivedRatioSeries()` joins on **exact date** (correct for same-source AMFI pairs). `derivedDifferenceSeries()` joins on **year-month** — FRED's OECD-sourced `gsec_10y` and RBI's month-end CPI publish on different days, so an exact-date join silently yields zero matches.

**A joined cell can be older than every one of its legs.** If gold runs to September and CPI to March, the join last resolves in March. Reporting either leg's own latest date overstates the number's age. This is exactly why `ScoreState` carries a separate **`computedForDate`** — the date the value was *actually* computed from — distinct from any leg's `latestDate`.

**Calendar lookback vs. previous-print.** Trend helpers (`usReal10y6mChangeBp`, `goldEtfHoldingsTrend`) use "closest observation at or before target date," because stored history is not a dense gap-free series and a fixed row-count shift would misalign against elapsed calendar time. But `globalMfgPmiReadings` deliberately does *not*: the rubric's condition is "> 52 **AND rising**", meaning up versus the immediately preceding *published* month, so it takes the last two **distinct** dates and returns null unless two genuinely distinct dates exist. TE's adapter rewrites the same monthly figure on every refresh run, so treating those duplicate rows as "unchanged, therefore not rising" would fabricate a trend from a single data point.

---

## 5. Stage 4 — The 85 score cells

### 5.1 The ID grid

A score key is `` `${nodeId}::${signalId}` ``. Node and signal vocabularies are frozen in `packages/engine/src/types.ts`:

| Group | Nodes | Signals | Cells |
|---|---|---|---|
| **l1** | `l1.equity`, `l1.debt`, `l1.metals` | valuation, macro, fundamentals, flows, momentum | 15 |
| **equity** | `equity.{large,mid,small,intl}` | valuation, relvalue, revisions, growth_diff, margin_cycle | 20 |
| **debt** | `debt.{liquid,corporate,gilt}` | carry, rate_cycle, spread_cushion, liquidity | 12 |
| **metals** | `metals.{gold,silver}` | ratio_position, real_rates, industrial | 6 |
| **sector** | 8 sectors (banking, it, pharma, auto, capgoods, fmcg, energy, metals) | valuation, revisions, rel_momentum, cycle_position | 32 |
| | | | **85** |

Every score is **0-100, where 50 is neutral**. §1 invariant 4: *a missing signal scores 50, never a guess* — enforced in `compute.ts`'s `getScore()`.

### 5.2 The five provenances

| Provenance | Meaning | Transform |
|---|---|---|
| `auto` | percentile-ranked from stored/derived history | `percentile`, `inverted`, `average` |
| `rubric` | discrete lookup table over one or two readings | `rubric` |
| `static` | structural constant about the instrument class | `static` |
| `manual` | a human deliberately entered it | `none` |
| `default` | nothing wired; still baseline | — |

`inverted` means `100 − percentile`. It applies where high = *unattractive*: a high P/E (expensive), a high relative inflow (crowded), a high real gold price (rich). Both directions appear on the same derived series in one place — `gold_silver_ratio_20y` is ranked `inverted` for gold and as-is for silver, from one shared series, so the two cells can never disagree about what the ratio did.

### 5.3 Percentile mechanics

`pipeline/percentile.ts` implements **Excel `PERCENTRANK` semantics** (interpolated, inclusive) deliberately, so results reconcile against the source spreadsheet (`docs/MultiAsset_Allocation_Framework_v2.xlxs (2).xlsx`) during migration. Below the min → 0, above the max → 1, exact match ranks at the *first* occurrence in the sorted array (not an interpolated midpoint of a duplicate run).

Governance parameters that control it: `percentileWindowYears: 10`, `percentileMinObservations: 24`, `respectDefinitionBreaks: true` (NSE Apr-2021, AMFI Apr-2019 definition breaks clip the window start).

### 5.4 Rubric tables (`packages/engine/src/rubrics.ts`)

A rubric starts at 50 and adds signed deltas from discrete conditions, clamped 0-100. Implemented:

| §  | Function | Inputs | Range |
|---|---|---|---|
| 8.1 | `equityMacroScore` | RBI stance (±20), growth vs expect (±10), inflation direction (±5) | 15-85 |
| 8.2 | `debtMacroScore` | RBI path (+20/−15), G-sec supply (−10), inflation vs 4% target (+10) | 25-80 |
| 8.3 | `debtFundamentalsScore` | credit cycle (+10/−25), system liquidity (±10) | 15-70 |
| 8.4 | `realRatesScore` | 6m change in US 10Y real yield, bp — 5 bands gold / 4 silver | 25-75 |
| 8.5 | `metalsFundamentalsScore` | CB buying vs 5Y avg (+15/−10), ETF holdings (±10) | 30-75 |
| 8.6 | `growthDiffScore` | EPS growth gap vs large cap, pp — 5 bands; intl +5 | 25-80 |
| 8.7 | `rateCycleScores` | RBI 12m path → one input, three outputs (gilt/corporate/liquid) | 20-80 |
| 8.8 | `silverIndustrialScore` | PMI band (compound: >52 **and** rising), solar/EV capex +5 | 35-75 |
| 7.3 | `debtLiquidityScore` | static baseline 90/65/75, drops to 50/40/50 under credit stress | — |

**Rubrics abstain rather than assume.** Where a rubric input has no source, the code passes the rubric's own *no-adjustment* case and records it in `rubricInputs[].assumed = true` with a basis string explaining why. Currently assumed: `growthVsExpect: "in_line"` (no free analyst-consensus source), `gsecSupply: "normal"` (no borrowing-calendar source), `strongSolarEvCapex: false` (qualitative newsflow, no adapter).

That `rubricInputs` array exists because a rubric score is a *sum of discrete choices* — "45" is unauditable without knowing that stance read `on_hold` and inflation read `rising`. Each entry carries the field name in the spec's own wording, the option selected, the signed delta, and a human-readable basis like `"repo_rate 5.25% unchanged vs 5.25% six months ago (2026-03-01)"`. Percentile cells need no equivalent — their input series and percentile are already on `SeriesState`.

### 5.5 Live cell state (2026-09-20)

**49 of 85 cells live; 36 still mock baseline** (was 41/44 before the 2026-09-20 valuation work). Provenance breakdown as served: auto 38, rubric 22, manual 18, static 7. (The 40 "recomputed" count in the refresh warning counts cells the pipeline overwrote this run; `metals.gold::industrial` is set separately as a structural constant.)

Live: all 12 `l1.*` valuation/macro/flows/momentum cells · `equity.{large,mid,small,intl}::valuation` · `equity.{large,mid,small}::relvalue` · `debt.{liquid,gilt}::carry` · both `metals.*::{ratio_position,real_rates,industrial}` · all 8 `sector.*::valuation` · 7 of 8 `sector.*::rel_momentum` (capgoods has only 278 close rows from 2026-06).

Not computable, by cause:
- **No source exists:** `debt.corporate::{carry,spread_cushion}` (`aaa_3y`), all `*::revisions` (analyst EPS consensus), all `sector.*::cycle_position`, `equity.*::margin_cycle`, `equity.{mid,small,intl}::growth_diff`, `l1.{equity,debt}::fundamentals`
- **Structural constants, correct as they stand (7):** `debt.{liquid,gilt,corporate}::liquidity` (90/75/65), `debt.{liquid,gilt}::spread_cushion` (50 — neither sleeve carries meaningful credit spread), `metals.gold::industrial` (50), `equity.large::growth_diff` (50 — large cap is the baseline every other gap is measured against, so its own gap is zero by construction)

### 5.6 Assembly order in `buildCurrentSnapshot()`

Later layers override earlier ones, and **every override also updates the recorded provenance** (§1 invariant 5 — provenance is always visible):

0. Load `mock/snapshot.json` and tag **everything** `mock: true`. This is the inverse of the old approach ("tag nothing, assume real"), which let a never-overwritten baseline value be served with `auto` provenance and no indication it was invented. Each layer below clears the flag on what it genuinely replaces.
1. Saved params from `store/params.ts` (id `current`), if any.
2. `computeAutoScoreCells()` — the auto/rubric recomputation. On `insufficient_history` the value is left alone (overwriting with a fresh 50 would itself be a guess) but the cell stays flagged `mock` with a reason naming the series that fell short.
3. Overlay `snapshot.series` from **every** stored series (`storedSeriesIds()`), unconditionally. An earlier version skipped ids the baseline already had, so `/api/snapshot` served `nifty100_pe` as 101.31 — not even a P/E — while the store held 520 real observations reading 19.43.
4. Publish the **derived** series (`real_gsec_10y`, `flow_ratio_*`, `cpi_index_spliced`, …). They live in no table, so step 3 can't reach them, and without them a trace could only show each raw leg's own percentile — the number that openly contradicts the score.
5. `metals.gold::industrial` → 50, `static`.
6. Manual scores overlay (`provenance: "manual"`, `mock: false` — a human's deliberate entry is a real owned input, not demo filler).
7. **`veto.parabolic`** — fires automatically when the 6-month INR gold return exceeds **40%**, clamping `l1.metals` and `metals.gold`. Applied *before* the manual veto overlay so a human decision still wins on the same node. Fires on the same INR gold series the momentum cell ranks.
8. Manual vetoes overlay.
9. `computeAllocation(scoreValues, vetoValues, params)`.
10. Recompute each veto's `hadEffect` from the fresh allocation — §9: a veto on an already-underweight node does nothing, and should say so rather than flashing red.
11. Validate the whole thing against `snapshotSchema` (Zod). A failure throws rather than serving a malformed snapshot.

---

## 6. Stage 5 — Allocation

`packages/engine/src/compute.ts`. Pure, synchronous, no I/O — it takes `(scores, vetoes, params, sleeveHistory)` and returns an `Allocation`. The web app calls the *identical* function client-side for live what-if tuning.

### 6.1 The tilt chain, per group

```
1. composite  = Σ (score_signal × weight_signal)                    → 0-100
2. rawTilt    = ((composite − 50) / 50) × maxTilt[group]            → ±maxTilt
3. (zero_sum only) demean rawTilts across the group
4. tilt       = vetoActive ? min(rawTilt, 0) : rawTilt              → veto clamps overweight only
5. prelim     = neutralWeight × (1 + tilt)
6. final      = prelim / Σ prelim                                   → renormalise to 1
```

Step 4 is the whole semantics of a veto: **it can block an overweight but can never force an underweight.** Step 6 is why weights always sum to exactly 1 regardless of tilts.

### 6.2 Default governance parameters

```
signalWeights.l1     valuation .30  macro .20  fundamentals .20  flows .15  momentum .15
signalWeights.equity valuation .30  relvalue .20  revisions .20  growth_diff .15  margin_cycle .15
signalWeights.debt   carry .30  rate_cycle .30  spread_cushion .25  liquidity .15
signalWeights.metals ratio_position .40  real_rates .35  industrial .25
signalWeights.sector valuation .30  revisions .30  rel_momentum .25  cycle_position .15

neutralWeights.l1     equity .55  debt .35  metals .10
neutralWeights.equity large .45  mid .20  small .15  intl .20
neutralWeights.debt   liquid .40  corporate .35  gilt .25
neutralWeights.metals gold .75  silver .25

maxTilt  l1 .20  equity .30  debt .30  metals .25
sector   sleeveCap .15  maxSectors 2  threshold 70  maxConsecutiveQuarters 4
normalisation "proportional"   percentileWindowYears 10
percentileMinObservations 24   respectDefinitionBreaks true
```

Note `neutralWeights.l1` sums to 1.00 but the live `neutral` fields read 68.97/24.14/6.90% — the renormalisation in step 6 is applied to the neutral baseline too, so the comparison is like-for-like.

### 6.3 The sector satellite (separate mechanism)

Sectors do **not** go through the tilt chain. They are a carve-out from equity:

1. Composite per sector = weighted sum of its 4 signals.
2. **Mandatory rotation:** any sector already held `maxConsecutiveQuarters` (4) is forced out this quarter regardless of composite, freeing its slot.
3. Qualifying = composite ≥ `threshold` (70), not vetoed, not rotated out — sorted descending.
4. Held = top `maxSectors` (2).
5. `sleeve = sleeveCap × (held / maxSectors)` — so one qualifier gets 7.5%, two get the full 15%, zero gets 0%.
6. `perSector = sleeve / held.length`.

The sleeve is carved out of equity, not added alongside it: core equity segments are scaled by `coreScale = 1 − sleeve`, and each sleeve row's portfolio weight is `finalEquity × perSector`.

### 6.4 The rollup

`portfolioWeight` for a leaf = `L1 final × within-group final`, with equity segments additionally × `coreScale`. `total` sums all rollup rows and is **1.0000** in the live snapshot.

### 6.5 Live allocation (2026-09-20)

| Node | composite | neutral | final |
|---|---|---|---|
| `l1.equity` | 60.8 | 68.97% | **70.3%** |
| `l1.debt` | 48.8 | 24.14% | **23.5%** |
| `l1.metals` | 32.9 | 6.90% | **6.3%** |

Sector sleeve: `capgoods` + `banking` held, sleeve = 15% (both slots filled). Rollup total = 1.0000.

Metals at composite 32.9 is a meaningful underweight signal, driven by `ratio_position` (weight .40) and `real_rates` (.35) — the two heaviest metals signals, and both live.

---

## 7. The Data Points Control Center

`GET /api/datapoints` (`packages/server/src/routes/datapoints.ts`) → `packages/web/src/views/DataPointControlCenterView.tsx`.

### 7.1 What it is

The operator view over the entire chain. It calls `buildCurrentSnapshot()` and joins it against `DATA_POINT_REGISTRY` (`packages/server/src/dataPointRegistry.ts`), which enumerates every controllable point in the model:

- **85 score cells** — from the frozen node × signal grid
- **15 governance parameters** — signal weights ×5, neutral weights ×4, maxTilt, sector config, normalisation, percentile window/floor, definition breaks
- **9 veto gates** — one per equity/debt/metals node
- **1 raw series** — `series.aaa_3y`, hand-listed because it has no score consumer yet and would otherwise be invisible (`hasLiveSource: false` forces it to report `missing` unconditionally, so the baseline's fake "ok" can't read as trustworthy)

Each row carries `updateType` (`derived` | `manual` | `constant` | `governance` | `veto` | `raw_series`), owner (`market_data` | `investment_team` | `model_admin` | `system`), frequency, upstream series chips with per-series status, provenance, `observedAt`, and the `mock`/`mockReason` pair.

### 7.2 Freshness — where most of the subtlety is

`scoreFreshness()` maps to one of six states: `current` · `due` (>7d) · `stale` (>45d) · `failed` · `missing` · `overridden`. Three rules exist because each fixed a specific live bug:

1. **`mock` ⇒ `missing`**, whatever provenance the baseline claims. A demo value must never sit in the Control Center reading "current."

2. **A leg's `insufficient_history` only blocks the cell if that leg's own percentile is an input.** `SeriesState.status === "insufficient_history"` measures exactly one thing: can this series support a percentile. That is fatal for a percentile cell and irrelevant for a rubric. `metals.silver::industrial` is the clearest case — `global_mfg_pmi` holds 2 observations *by design* (the rubric wants latest + prior), so gating on the percentile floor reported a genuinely computed score as "missing." The same reasoning extends past rubrics to any cell that percentiles a *derived* quantity: `l1.debt::valuation` ranks a real-yield series with 161 observations and scores 70, but `cpi_yoy` alone holds 5 rows — so the old gate marked a fully computed cell "missing" and the UI announced "No observation has ever been stored for this point" above a live score. `seriesRole()` is what records which legs are actually load-bearing. With no map entry the old conservative rule still applies, rather than silently promoting an unknown cell to "current."

3. **`observedAt` prefers `computedForDate`**, falling back to the **oldest** leg date, never the newest. A cell joining legs by month can only be as current as its slowest leg — and can be older still, because the derived series ends where the legs last *overlapped*. The oldest-leg heuristic is a lower bound, not the answer; `computedForDate` is the answer when the pipeline reports one.

Structural constants bypass the freshness funnel entirely (`updateType === "constant"` → `current`, `mock: false`). They live in `mock/snapshot.json` like every other unwired cell, so the general "never overwritten ⇒ mock" rule catches them — correct in general, wrong here, and it buried 7 finished cells among the 40 that genuinely need attention. Each of the 7 values is cross-checked against the engine's own rubric constants rather than taken on faith from the demo baseline.

### 7.3 Refresh

`POST /api/refresh[?sources=fred,amfi,...]` — no param fans out to all 15 adapters, including the slow Playwright ones. The response is a full `Snapshot` plus a `partial_pipeline` warning stating literally how many of 85 cells were recomputed from this run. Mutating routes require either `Authorization: Bearer <token>` (session from `POST /api/login`) or a static `x-api-secret` header; reads are public.

---

## 8. Design invariants

These recur throughout the code and explain most decisions that look odd in isolation:

1. **A missing signal scores 50, never a guess.** (`getScore()`, every `insufficient_history` path.)
2. **Provenance is always visible, freshness included.** Every override updates provenance; `staleDays` reflects the observation actually computed from, not `asOf`; `mock`/`mockReason` are explicit fields on the wire.
3. **Never invent a number a source doesn't give.** Non-numeric `pe`/`pb` values are dropped rather than defaulted. Capital Goods was left out of `nse.ts` rather than mapped to the nearest-sounding index. A rubric with no source for an input uses the rubric's own no-adjustment case and *says so* (`assumed: true`).
4. **A failed fetch is a warning, never an exception.**
5. **Append-only, latest-fetch-wins.** Revisions never delete history.
6. **A trace must never display a number that disagrees with the score it claims to explain.** This single rule motivated `SeriesRole`, the derived-series publication step, and the `rubricInputs` array.
7. **A wrong number with enough observations to look confident is worse than an honest `insufficient_history`.** (Stated verbatim in `fred.ts`, on why an interbank rate wasn't substituted for the 364-day T-bill: a systematic ~0.5pp gap would have ranked today's yield against the wrong distribution and silently biased `debt.liquid::carry`.)

---

## 9. File map

| Concern | File |
|---|---|
| Node/signal vocabulary, `Snapshot` shape | `packages/engine/src/types.ts` |
| Wire validation | `packages/engine/src/schema.ts` |
| Default params, labels, group membership | `packages/engine/src/constants.ts` |
| **Allocation math** | `packages/engine/src/compute.ts` |
| Rubric tables (§8) | `packages/engine/src/rubrics.ts` |
| Declarative cell→series index + `SeriesRole` | `packages/engine/src/scoreMap.ts` |
| External adapters (15) | `packages/server/src/adapters/*.ts` |
| Store schema + read rules | `packages/server/src/store/{schema,observations}.ts` |
| **Derived quantities** | `packages/server/src/pipeline/derive.ts` |
| **Cell computation** | `packages/server/src/pipeline/scoreCells.ts` |
| Percentile (Excel PERCENTRANK) | `packages/server/src/pipeline/percentile.ts` |
| **Snapshot assembly (the spine)** | `packages/server/src/pipeline/currentSnapshot.ts` |
| Adapter fan-out | `packages/server/src/pipeline/refresh.ts` |
| Control Center registry | `packages/server/src/dataPointRegistry.ts` |
| Control Center API | `packages/server/src/routes/datapoints.ts` |
| Control Center UI | `packages/web/src/views/DataPointControlCenterView.tsx` |
| Per-cell arithmetic traces | `packages/web/src/components/ScoreFormulaTraces.tsx` |
| Allocation UI | `packages/web/src/components/AllocationBar.tsx`, `views/OverviewView.tsx` |
| Historical backfill CLI | `packages/server/scripts/backfill.ts` |
| **Source-by-source status (authoritative)** | `docs/DATA_SOURCES.md` |
| Gaps by model group | `docs/missing_data_points/` |
