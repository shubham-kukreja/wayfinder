# Missing Data Points — Debt Buckets

6 unfilled score cells (grouped as 4 rows below — rate-cycle and liquidity each share one rubric across the three buckets) plus 1 raw series. Signal weights from `DEFAULT_PARAMS.signalWeights.debt`: carry 0.30, rate_cycle 0.30, spread_cushion 0.25, liquidity 0.15.

| Data point | Dependencies | Description | Freq. of change |
|---|---|---|---|
| Liquid — Rate cycle | Feeds `debt.liquid` (0.30). Rubric: one 12m expected-rate-path selection drives all three rate-cycle cells | Impact of the expected 12m RBI path on liquid funds | 1Q |
| Corporate — Rate cycle | Feeds `debt.corporate` (0.30). Same shared rubric selection | Same rate path, corporate-duration sensitivity | 1Q |
| Gilt — Rate cycle | Feeds `debt.gilt` (0.30). Same shared rubric selection | Same rate path, highest duration sensitivity | 1Q |
| Corporate — Carry | Feeds `debt.corporate` (0.30). Blocked on `aaa_3y` | 3Y AAA yield percentile as corporate carry | 1D once sourced |
| Corporate — Spread cushion | Feeds `debt.corporate` (0.25). Blocked on `aaa_3y` (needs the spread over `gsec_10y`) | Credit-spread buffer available in corporate paper | 1D once sourced |
| **`series.aaa_3y`** (raw series) | Would feed both cells above. `hasLiveSource: false` | 3Y AAA corporate bond yield — no live source at all | 1D once sourced |
| Liquid / Corporate / Gilt — Liquidity | Feeds `debt.{liquid,corporate,gilt}` (0.15). Rubric: one "Normal / Credit-fund stress episode underway" selection drives all three | Redemption safety, standing baseline (90/65/75) except during a credit-fund stress episode (corporate → 40, liquid/gilt → 50) | Event-driven |

## Coverage by bucket

| Bucket | Unfilled | Filled | Unfilled share of score |
|---|---|---|---|
| Liquid | rate_cycle, liquidity | carry ✅ auto (`tbill_1y`), spread_cushion ⚪ constant 50 | 45% |
| Gilt | rate_cycle, liquidity | carry ✅ auto (`gsec_10y`), spread_cushion ⚪ constant 50 | 45% |
| **Corporate** | **carry, rate_cycle, spread_cushion, liquidity** | — | **100%** |

Two structural constants remain in this group: `debt.{liquid,gilt}::spread_cushion` is neutral **by definition** — neither sleeve carries meaningful credit spread, so there is no cushion to score. `debt.corporate::spread_cushion` is deliberately *not* a constant: it is a real signal, blocked on a missing source. `debt.{liquid,corporate,gilt}::liquidity` **moved OUT of the constant set 2026-09-20** — the spec is "set-and-forget EXCEPT IN STRESS," and `debtLiquidityScore()`'s stress override (already implemented in the engine) is now wired to a rubric picker (`debtLiquidityUi`), so it counts as unfilled/opt-in like rate_cycle, not a finished constant. The baseline it reproduces on "Normal" is unchanged (90/65/75).

## Detail

### `series.aaa_3y` — the highest-leverage single gap in the model

One missing series blocks **55% of the corporate bucket's score weight** (carry 0.30 + spread_cushion 0.25). Corporate carries a 0.35 neutral weight within the debt group, second only to liquid's 0.40.

An adapter exists at `packages/server/src/adapters/aaa3y.ts`, but it is a deliberate **always-fails stub**, not a real feed. Every method throws `Aaa3yUnavailableError`, and `health()` returns `ok: false`. It is registered precisely so the series surfaces honestly as failed/missing in the Control Center rather than being silently absent or showing a fabricated number. `dataPointRegistry.ts` marks the entry `hasLiveSource: false`, which makes `rowFromSeries()` force `freshness: "missing"` unconditionally — any value sitting in `mock/snapshot.json` for it is placeholder data and is never surfaced as current.

**Sourcing status, per `docs/DATA_SOURCES.md` (checked live 2026-09-15):**

- FIMMDA posted its own notice, dated 2026-09-11, that FBIL benchmark data has moved off their site.
- FBIL (`fbil.org.in`) is a JS-only Angular SPA with no discovered API.
- FIMMDA's remaining direct download links are stale 2017/2020 sample files.

Both candidate free sources are confirmed dead ends. Unblocking this needs new research or a paid feed — it is not wiring work.

**Related unsourced items** in the same doc, all ❌ Missing, which would serve as alternative routes to a corporate carry read: Category Average YTM for Liquid/Short, Corporate/Medium, and Gilt/Long funds. Value Research (403), Morningstar, Tickertape and AMFI portfolios were all checked and confirmed dead.

### Rate cycle — three cells, one answer

`rateCycleScores(path)` in `packages/engine/src/rubrics.ts` is a single table lookup that returns all three bucket scores at once. `rubricUi.ts` registers the same spec under all three score IDs, so one analyst selection fills three cells:

| Expected 12m rate path | Gilt | Corporate | Liquid |
|---|---|---|---|
| Cuts > 50bp | 80 | 60 | 30 |
| Cuts 25–50bp | 70 | 58 | 40 |
| On hold | 50 | 50 | 55 |
| Hikes 25–50bp | 30 | 40 | 70 |
| Hikes > 50bp | 20 | 35 | 80 |

Gilt swings hardest on the path (highest duration) and corporate sits in between, but **liquid moves in the opposite direction** — cuts hurt a reinvestment-at-lower-rates sleeve while hikes help it. So this one selection is not a single directional view applied three times; it genuinely differentiates the buckets.

**Registry fix (2026-09-20):** the trio previously fell through `dataPointRegistry.ts`'s default to plain `manual`, same bucket as a free-form number box, even though the rubric picker already existed end-to-end. Added to `RUBRIC_PICKER_SCORE_IDS` (the same set `sector.*::cycle_position` already used) so the Control Center now reports `updateType: "opt_in"`, source `"Analyst rubric (no feed answers it)"`, owner `investment_team` — the trio is genuinely one dropdown away from live, not a blocked engineering gap. No free source answers the *forward* 12m path in principle: `rbiPathFromRepoRate()` (used for `l1.debt::macro`) only reads realised `repo_rate` direction into 3 buckets, but this rubric needs the 5-bucket *magnitude* of an *expected* move, which only OIS-implied pricing or an analyst's MPC-guidance read can supply.

This is the **best effort-to-coverage ratio of any unfilled data point in the model**: one selection closes 30% of the score weight on all three debt buckets.

**Why 1Q:** Tracks the MPC cycle. Worth revisiting immediately after any policy surprise.

### Liquidity / redemption safety — three cells, one toggle

`debtLiquidityScore(node, creditStressActive)` in `packages/engine/src/rubrics.ts` already implemented both the baseline and the stress override; it was simply never called anywhere in the pipeline. `rubricUi.ts` now registers `debtLiquidityUi` — a single "Normal" / "Credit-fund stress episode underway" selection — under all three score IDs, same one-selection-drives-three-cells pattern as rate cycle:

| Condition | Gilt | Corporate | Liquid |
|---|---|---|---|
| Normal | 75 | 65 | 90 |
| Credit-fund stress episode underway | 50 | 40 | 50 |

"Normal" reproduces the exact values the structural constant used to freeze (`DEBT_LIQUIDITY_BASELINE`) — picking it once changes nothing about the model's behaviour, it just makes the stress path reachable instead of requiring someone to remember and hand-enter 40/50/50 via the generic manual-score box.

**Why no auto-detection:** "any credit-fund stress episode underway" has no free programmatic source, same class as `debtFundamentalsUi`'s `creditCycle` field (CRISIL/ICRA rating-action summaries, AMC gating events — no adapter, no API). Forcing this into a derivation would mean guessing whether a yield move constitutes "stress," which risks a false positive the analyst never intended. This stays an explicit judgement call.

**Registry change (2026-09-20):** `debt.{liquid,corporate,gilt}::liquidity` moved from `STRUCTURAL_CONSTANT_SCORE_IDS` to `RUBRIC_PICKER_SCORE_IDS` in `dataPointRegistry.ts` (`updateType` constant → opt_in, owner model_admin → investment_team, frequency annual → quarterly/event-driven). `mock/snapshot.json`'s `provenance` field for the trio was updated `static` → `rubric` to match — `InputsView.tsx` only surfaces a cell's rubric picker when the live snapshot's own `provenance` reads `"rubric"`, so this second change was required for the picker to actually be reachable in the UI, not just registered in the engine.

**Why event-driven, not quarterly:** unlike rate cycle (tracks the MPC's scheduled meeting cadence), a credit-fund stress episode is a discrete event with no calendar — the analyst flips it when one starts and flips it back when it resolves.
