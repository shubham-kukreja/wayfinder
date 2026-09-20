# Missing Data Points — L1 Asset Classes

Signal weights from `DEFAULT_PARAMS.signalWeights.l1`: valuation 0.30, macro 0.20, fundamentals 0.20, flows 0.15, momentum 0.15.

## Count

The registry marks **5** L1 cells manual. Checked against the source spec's exact formulas (see [Equity — full spec audit](#equity--full-spec-audit) below), 2 further cells were auto-wired but only partially implemented their formula — **both fixed 2026-09-18**, so the remaining gap is the original **5**, all of which need either an analyst selection or a new source.

**Also found while fixing those:** `aum_equity` and `flow_equity_3m` hold **corrupt values for Aug-2026** — a live data bug, unrelated to the formula work. See [Data bug](#data-bug-corrupt-aug-2026-amfi-row) below.

| Cell | Registry | vs. spec formula | Work needed |
|---|---|---|---|
| `l1.equity::valuation` | ✅ auto | ✅ **Fixed 2026-09-18** | Part (b) + averaging now implemented |
| `l1.equity::flows` | ✅ auto | ✅ **Fixed 2026-09-18** | 3M averaging now applied in the pipeline |
| `l1.equity::momentum` | ✅ auto | ✅ Matches | None |
| `l1.equity::macro` | ⚠️ partly wired | Rubric matches spec; 2 of 3 inputs now derived | Analyst selection for growth vs. expectations |
| `l1.equity::fundamentals` | ❌ manual | — | New source + wiring |
| `l1.debt::macro` | ❌ manual | — | Analyst selection |
| `l1.debt::fundamentals` | ❌ manual | — | Analyst selection |
| `l1.debt::momentum` | ❌ manual | — | New source + wiring |

`l1.metals` has no unfilled cells — all five of its L1 signals are auto-wired.

## Registry-missing cells

| Data point | Dependencies | Description | Freq. of change |
|---|---|---|---|
| Equity — Macro | Feeds `l1.equity` (0.20). Rubric: RBI stance + growth vs. expectations + inflation direction | Macro regime read for equity — is policy easing, is growth beating, is CPI falling | 1Q |
| Equity — Fundamentals | Feeds `l1.equity` (0.20). No adapter; needs Nifty 100 earnings revision breadth | Earnings health of the broad equity market | 1M |
| Debt — Macro | Feeds `l1.debt` (0.20). Rubric: RBI 12m path + G-Sec supply + inflation vs. target | Rate and fiscal regime for bonds | 1Q |
| Debt — Fundamentals | Feeds `l1.debt` (0.20). Rubric: credit cycle + system liquidity | Credit-cycle and liquidity health of the debt sleeve | 1Q |
| Debt — Momentum | Feeds `l1.debt` (0.15). No adapter; needs a CRISIL/Nifty composite bond index total return | Trailing return momentum of the bond market | 1M |

## Sources needed

| Need | Source per spec | Status in this repo |
|---|---|---|
| Nifty 100 earnings revision breadth | Brokerage strategy reports (most publish monthly); ACE Equity / Bloomberg | ❌ **Researched and confirmed dead 2026-09-20** — see `docs/DATA_SOURCES.md`. Five candidates checked live (Moneycontrol, Tickertape, NSE, BSE, Trendlyne); Tickertape has real per-stock consensus-EPS fields but no index-level aggregate and insufficient history even per-stock. |
| Nifty 50 P/E **10–15Y history** | niftyindices.com | ✅ **Source already wired** — `niftyindices.ts` maps Nifty 50 → `nifty50_pe` and has a real `fetchHistory()`. Needs a backfill run, not a new source (`DATA_SOURCES.md`'s "latest-only" note refers to `nse.ts` only) |
| RBI policy stance; PMI / GST / IIP vs. consensus | RBI statements, monthly prints | ❌ Manual judgment. `global_mfg_pmi` exists but no consensus-comparison data |
| Banking system liquidity surplus/deficit | RBI LAF / CCIL | ❌ Confirmed dead ends — feeds `debtMacroScore`'s `gsecSupply` |
| Composite bond index total return | CRISIL / Nifty bond indices | ❌ No adapter |
| AMFI net flows + AUM by category | AMFI monthly | ✅ Live. 3M averaging added 2026-09-18. ⚠️ **Aug-2026 rows are corrupt** for both the equity and debt sub-totals — see [Data bug](#data-bug-corrupt-aug-2026-amfi-row) |
| 10Y G-sec yield | Rates log | ✅ Live (`gsec_10y`, FRED `INDIRLTLT01STM`) |
| Nifty 50 total return index | NSE | ⚠️ Live as a documented approximation (price return + trailing div yield); no free true-TRI source exists |

**One source unlocks the most:** revision breadth. It fills `l1.equity::fundamentals` here, and the same data class fills 12 `revisions` cells across the equity and sector groups. See [analysis.md](analysis.md).

## Equity — full spec audit

The source spec defines all five `l1.equity` signals. Each is checked against the implementation below.

### (1) Valuation — ✅ both parts now implemented (fixed 2026-09-18)

**Spec:** two parts, then average.

- **(a)** Earnings-yield gap = `(100 / Nifty 50 trailing P/E) − 10Y G-sec yield`. Build monthly history; score = PERCENTRANK of current gap × 100, **AS-IS** (high gap = equity cheap vs. bonds = attractive).
- **(b)** Nifty P/E percentile vs. its own 10–15Y history, **INVERTED**: score = `100 − percentile`.
- **Final = (a + b) / 2.**

*Worked example from the spec:* P/E 22 → earnings yield 4.55%; 10Y = 6.75% → gap = −2.2%. Gap at 30th %ile → (a) = 30. P/E 22 at 55th %ile → (b) = 100 − 55 = 45. Score = (30 + 45) / 2 ≈ 38.

**Was:** `deriveEarningsYieldGapSeries()` computed part (a) exactly — `(100 / peRow.value) - gsecYield`, joined to `gsec_10y` by year-month — and the cell returned that alone. Part (b) and the averaging step did not exist.

**Now:** `deriveNiftyPeSeries()` (new, in `derive.ts`) supplies the raw `nifty50_pe` history for part (b); `scoreCells.ts` percentiles it `inverted`, percentiles the gap `percentile`, and averages the two. `transform` on the result changed from `"percentile"` to `"average"`, matching the convention `equity.large::relvalue` already used.

Both parts must clear `percentileMinObservations` independently — if either is short the cell reports `insufficient_history` at neutral 50 rather than scoring on whichever half happens to be ready.

**Measured effect on live data** (2026-09-18, against the real store):

| | Value |
|---|---|
| part (a) — earnings-yield gap percentile, as-is | 65.56 (605 obs) |
| part (b) — Nifty P/E percentile, inverted | 98.91 (645 obs) |
| **old** — part (a) alone | **65.56** |
| **new** — (a + b) / 2 | **82.24** |

A 17-point move on the single heaviest-weighted signal in the model (0.30 of `l1.equity`). The two parts read the market very differently right now — the earnings-yield gap looks moderately attractive, while the P/E percentile says the index is near the cheapest end of its own history (P/E 19.67 with only 1.1% of stored history below it). That divergence is exactly what the spec's two-part construction exists to capture.

**⚠️ Caveat on part (b)'s history depth.** The stored `nifty50_pe` history runs from **2024-08-15**, roughly 2 years — the spec asks for **10–15Y**. Two years does not contain a full valuation cycle, so part (b) currently percentiles against an unrepresentatively narrow range, which is part of why it reads so extreme. The cell is now *formula-correct*; it is not yet *history-correct*.

Fixing that is a backfill, not new research: `niftyindices.ts` maps `"Nifty 50" → nifty50_pe` and has a real day-by-day `fetchHistory()`. Until the backfill is run, treat part (b)'s contribution as directionally right but overstated at the extremes. Also note `percentileWindowYears` is 10 — once the deeper history lands, the window will start clipping it as intended.

**Apparent blocker:** part (b) needs 10–15Y of Nifty 50 P/E history, and `docs/DATA_SOURCES.md` lists `nifty50_pe` against NSE `api/allIndices` as "latest-only, no history endpoint found."

**That blocker is stale — the history path already exists.** `adapters/niftyindices.ts` maps `"Nifty 50" → nifty50_pe` in its P/E column map, and its `fetchHistory(from, to)` is a **real backfill** (one Daily Snapshot CSV request per calendar day, skipping non-trading days), explicitly contrasted in its own comments with `nse.ts`'s deliberate no-op. Both adapters write to the same `nifty50_pe` series name, exactly as they do for the sector P/Es.

So part (b) needs **no new source and no new adapter** — only a history backfill run over the desired window, then the part (a)/(b) averaging logic in `derive.ts`. The practical constraint is that backfill cost is one HTTP request per calendar day, so 10–15Y is ~3,650–5,500 requests; worth running as a one-off seeding job rather than on the normal refresh path.

Two things to confirm before relying on this: how far back the Daily Snapshot CSVs actually remain available (the file notes confirm sector history "back to at least 2021", which is short of the spec's 10–15Y), and whether `percentileWindowYears: 10` should be relaxed if the real history turns out shorter.

### (2) Macro / cycle support — ❌ manual, rubric matches spec exactly

**Spec:** rubric, no history needed. Start at 50. RBI cutting or clearly about to cut **+20**; on hold **0**; hiking or hawkish **−20**. Growth beating expectations **+10**; missing **−10**. Inflation falling toward target **+5**; rising **−5**. Clamp 0–100.

*Worked example:* RBI cut once, more expected (+20), growth in line (0), CPI easing (+5) → 50 + 25 = **75**.

**Implemented:** `equityMacroScore()` in `packages/engine/src/rubrics.ts` matches this **exactly** — same start, same deltas, same clamp. The picker is registered in `rubricUi.ts` with all three fields. `evaluate()` returns `null` on a partial selection rather than defaulting, per the project's never-guess invariant.

**No engineering work needed.** This cell is waiting on an analyst selection only.

**Sources for the inputs:** RBI policy statements (stance), monthly PMI / GST / IIP prints vs. consensus (growth), CPI prints (inflation direction). None are wired as data — all three are analyst reads today.

### (3) Fundamentals — ❌ fully missing

**Spec:** earnings revision breadth = `upgrades ÷ (upgrades + downgrades)` for Nifty 100 constituents, monthly. Score = PERCENTRANK of current breadth vs. 5Y+ history × 100, **AS-IS**.

**Documented fallback:** if breadth can't be sourced, substitute *% change in Nifty consensus FY+1 EPS over the last 3 months*, percentiled the same way.

*Worked example:* breadth = 0.48 → history percentile 60 → score **60**.

**Implemented:** nothing. No adapter, no rubric — pure manual score entry.

**Source needed:** brokerage strategy reports (most publish revision breadth monthly), or ACE Equity / Bloomberg. Neither is a free programmatic source. **Researched and confirmed dead 2026-09-20** — see `docs/DATA_SOURCES.md` for the full five-candidate writeup (Moneycontrol, Tickertape, NSE, BSE, Trendlyne). Now a documented dead end the same way `aaa_3y` is.

Note the fallback needs consensus FY+1 EPS, which is **the same data the 3 `growth_diff` rubrics need** to be answered honestly. One source would serve both.

**Frequency is 1M, not 1Q.** Breadth is a monthly series by construction. The registry stamps it `quarterly` along with every other manual cell.

### (4) Flows & sentiment (contrarian) — ✅ 3M averaging now applied (fixed 2026-09-18)

**Spec:** **3-month average** of total active equity fund net flows (AMFI) as % of equity AUM. Percentile vs. history, then **INVERT**: score = `100 − percentile`. Euphoric inflows = low score.

*Worked example:* 3M avg flows at 85th %ile → score = 100 − 85 = **15** (crowd is all-in → unattractive).

**Implemented:** `scoreCells.ts` computes `derivedRatioSeries(db, "flow_equity_3m", "aum_equity")` and scores it `inverted`. The ratio and the inversion are both correct.

**Was missing: the 3-month averaging.** Despite the `_3m` suffix, `flow_equity_3m` is a **single month's** net flow. `adapters/amfi.ts` maps it straight from AMFI's "Growth/Equity Oriented Schemes" sub-total row for that month via `SUBTOTAL_GROUP_MAP`, and no rolling step existed in the adapter, in `derivedRatioSeries()`, or anywhere in the pipeline. The series name asserted a transform the code never performed.

**Now:** `deriveFlowRatio3mSeries()` (new, in `derive.ts`) takes the trailing 3-observation mean of the flow, then divides by that date's AUM. Applied to **both** `l1.equity::flows` and `l1.debt::flows`, which had the identical defect.

Two deliberate choices in the implementation:

- **Flow is averaged before dividing by AUM, not after.** The spec reads "3-month average of flows … as % of AUM". A mean of ratios would also smooth the AUM denominator, which is a stock, not a flow — it should be read at the ratio's own date.
- **Leading rows are dropped, not partially averaged.** A 1- or 2-month mean is a different statistic, not a rougher version of a 3M one. Cost: the cell needs 26 raw months to reach the 24-observation floor instead of 24. Both boundaries are covered by tests.

**No new source was needed** — `aum_equity` and the monthly flow are both live.

**Measured effect on live data:** on the clean history through Jul-2026, raw-monthly scores **75.76** and the 3M average scores **78.13** — close, as expected when flows are trending smoothly. The averaging earns its keep on the noisy months, which is precisely where the next section comes in.

### Data bug: corrupt Aug-2026 AMFI row

Surfaced while verifying the flows fix against the live store. **Not caused by these changes** — it is bad data that the old raw-monthly path happened to mask.

| Series | Jul-2026 | **Aug-2026** | Expected magnitude |
|---|---|---|---|
| `aum_equity` | 3,836,192.44 | **4,039.73** | ~3.9 million — off by ~1000x |
| `flow_equity_3m` | 24,697.39 | **−14.35** | ~25,000 |

The Aug-2026 AMFI parse is wrong for both the flow and the AUM. The resulting ratio is ~450x every other month in the series.

**Effect on the score**, equity flows:

| | With corrupt Aug row | Excluding it (Jul as latest) |
|---|---|---|
| raw monthly (old) | 97.01 | 75.76 |
| 3M average (new) | **0.00** | 78.13 |

Both methods are wrong when fed the corrupt row; they just fail in opposite directions, because the ratio's numerator and denominator are broken in opposite ways. The honest reading is the right-hand column: **~76–78**, where the two methods agree closely.

**The debt sub-total is corrupt in the same way** (checked, not assumed):

| Series | Jul-2026 | **Aug-2026** |
|---|---|---|
| `aum_duration` | 1,933,342.32 | **11,492.54** |
| `flow_duration_3m` | 187,511.32 | **−1,098.03** |

So `l1.debt::flows` is affected identically. The **Gold ETF series is clean** — `aum_goldetf` 173,301 → 191,166 and `flow_goldetf` 1,558 → 2,596 are both plausible, so `l1.metals::flows` is unaffected.

That both roman-numeral sub-total groups broke while the named "gold etf" row survived points at `SUBTOTAL_GROUP_MAP`'s heading-based matching in `adapters/amfi.ts`, not at a general units change — the sub-total rows are located by the group heading that precedes them, and AMFI appears to have changed that structure in the August file.

I have **not** fixed this: it is an adapter-parsing bug, separate from the formula work asked for here. Flagging it so neither flows number is trusted until it's addressed.

### (5) Momentum (12M relative) — ✅ matches spec

**Spec:** Nifty 50 total-return 12M % minus 10Y G-sec yield (equity excess return). Percentile vs. history, **AS-IS**.

*Worked example:* Nifty 12M TR = 14%, yield 6.75% → excess 7.25% → 55th %ile → score **55**.

**Implemented:** `deriveNiftyMomentumSeries()` builds the full excess-return history — for each date, `triApproxFromRows(...) * 100 - gsecYield`, with `gsec_10y` joined by year-month — and `scoreCells.ts` scores it `percentile` (as-is). Both sides in percentage points. Matches the spec's formula and transform.

**Documented approximation:** no free true-TRI source exists (NSE has no TRI field; niftyindices.com's snapshot carries only a distinct "Nifty 50 Futures TR Index"; investing.com's `NIFTRI` is 403 bot-blocked). `niftyTriApprox12mReturn()` approximates TRI as price return + trailing dividend yield. Per `docs/DATA_SOURCES.md`, this applies a single point-in-time yield across the whole 12-month window, so it diverges from AMFI's published TRI whenever the yield itself moved materially — not basis-point accurate, but the right shape.

## Detail

### Equity — Macro (`l1.equity::macro`)

Rubric-driven, `equityMacroScore()` in `packages/engine/src/rubrics.ts`. Starts at 50 and clamps to 0–100:

| Input | Options and deltas |
|---|---|
| RBI stance | Cutting / about to cut **+20**, On hold **0**, Hiking / hawkish **−20** |
| Growth vs. expectations | Beating **+10**, In line **0**, Missing **−10** |
| Inflation direction | Falling toward target **+5**, Rising **−5** |

Range 15–85. The picker is fully built (`rubricUi.ts`); it needs an analyst selection, not engineering work. All three inputs must be answered — `evaluate()` returns `null` on a partial selection rather than defaulting, per the project's never-guess invariant.

**Update 2026-09-19 — two of the three inputs are now derived automatically** (`scoreCells.ts`, `derive.ts`):

- `rbiStance` ← `rbiStanceFromRepoRate()`, the direction of the `repo_rate` move over 6 months. Real history now exists: BIS's `WS_CBPOL/M.IN` (954 monthly observations back to 1946) via the DBnomics adapter, alongside rbi.org.in's live current-rate widget. Only the *realised* rate move is read; the forward-looking "clearly about to cut" / "hawkish" half of the rubric's wording is left to the analyst rather than keyword-matched off policy prose.
- `inflationDir` ← `inflationDirFromCpi()`, the direction of `cpi_yoy` over 6 months, reading the same directly-fetched-plus-derived CPI picture `l1.debt::valuation` uses.
- `growthVsExpect` **remains analyst input.** "Beating/missing expectations" needs a consensus, and none is freely scrapable — TradingEconomics' India calendar renders its actual-vs-consensus table in JS with no rows in the server HTML (confirmed live 2026-09-19). Actual prints are available (GDP +7.80% Q2, IIP +6.70% July, PMI 52.90 August) but an actual without an expectation cannot answer this input. It is passed as the rubric's own no-adjustment `in_line` (+0) case, keeping the automatic value the honest centre of the range.

**Live status:** the cell currently abstains. Both derived inputs must resolve or nothing is emitted, and `rbiStance` returns `null` today because BIS's mirror ends 2025-06 while the homepage reads today — a ~15-month hole that both helpers refuse to measure across (12-month staleness bound). It resolves when the mirror catches up. See [../DATA_SOURCES.md](../DATA_SOURCES.md).

**Why 1Q:** RBI stance changes on the MPC cycle (~6 meetings/year), and the growth/inflation reads move on quarterly prints. A single policy surprise can force a mid-quarter revisit.

### Equity — Fundamentals (`l1.equity::fundamentals`)

Pure manual score entry — no rubric spec and no adapter. Would need aggregate Nifty EPS growth or earnings breadth, which shares the same missing upstream as every `revisions` cell in the equity and sector groups. See [analysis.md](analysis.md) for the consolidated consensus-estimates gap.

**Why 1Q:** Tracks the Indian earnings season.

### Debt — Macro (`l1.debt::macro`)

Rubric-driven, `debtMacroScore()`. Inputs: RBI path over the next 12m (cuts expected / on hold / hiking), G-Sec supply (heavy supply or fiscal slippage / normal), inflation vs. target (below / at or above).

**Partially blocked upstream.** The `gsecSupply` input is meant to be informed by banking-system liquidity surplus/deficit, which has **no live source** — `docs/DATA_SOURCES.md` records RBI's `BS_LAF_Search.aspx` as an auction *calendar*, not settled injection/absorption amounts, and CCIL's Market Liquidity Indicators page as a navigation stub. The rubric still works on analyst judgment; it just has no data feed backing that one field.

**Why 1Q:** Same MPC cadence as equity macro.

### Debt — Fundamentals (`l1.debt::fundamentals`)

Rubric-driven, `debtFundamentalsScore()`. Inputs: credit cycle (quiet / rising downgrades or credit event), system liquidity (comfortable surplus / deficit or tight).

Shares the unsourced banking-system-liquidity dependency with Debt — Macro above. One source would improve both cells' inputs.

**Why 1Q, 1W on an event:** The credit cycle is normally slow, but a downgrade wave or a single credit event flips the first input immediately and should trigger an out-of-cycle review.

### Debt — Momentum (`l1.debt::momentum`)

Explicitly called out as not computable in `scoreCells.ts`'s header comment: needs a CRISIL or Nifty composite bond index total return, and no adapter fetches one. This is a genuine sourcing gap, not a wiring gap — unlike `l1.equity::momentum`, which was solved with a TRI approximation from `nifty50_close` + `nifty50_div_yield`.

**Why 1M:** A trailing return series on a bond index; monthly re-reads are sufficient for a percentile-vs-history cell.
