# Missing Data Points — Index

Every Data Point Control Center row that is **not filled by an external source** and is **not a structural constant**. These are the cells a human has to answer today, either through the rubric picker or a manual score entry.

## Scope — how this set was derived

The registry (`packages/server/src/dataPointRegistry.ts`) generates one row per `nodeId::signalId` pair, then classifies it:

| Class | Count | In this doc? | Why |
|---|---|---|---|
| Auto-wired score cells (`AUTO_WIRED_SCORE_IDS`) | 39 | ❌ No | Computed end-to-end by `computeAutoScoreCells()` from real adapter series. |
| Structural constants (`STRUCTURAL_CONSTANT_SCORE_IDS`) | 7 | ❌ No | Encode a fact about the instrument class, not a market view. Correct as they stand; reviewed annually. |
| **Manual / unfilled score cells** | **39** | ✅ Yes | No adapter, or an adapter that exists but cannot yet clear the percentile floor. |
| Raw series with `hasLiveSource: false` | 1 | ✅ Yes | `series.aaa_3y` — tracked standalone so it stays visible. |
| Governance parameters | 15 | ❌ No | Configured model parameters, not sourced values. |
| Vetoes | 9 | ❌ No | Event-driven risk gates, not sourced values. |

**Total in scope: 40** (39 score cells + 1 raw series) out of 85 score cells.

## Category files

| File | Rows | Unfilled weight concentration |
|---|---|---|
| [L1 — Asset Classes](l1-asset-classes.md) | 5 | Macro + fundamentals across equity and debt |
| [Equity Segments](equity-segments.md) | 13 | All of `equity.intl`; revisions + margin cycle everywhere |
| [Debt Buckets](debt-buckets.md) | 5 + 1 series | 55% of `debt.corporate` blocked on one series |
| [Sector Satellite](sector-satellite.md) | 16 | 45% of every sector score, ×8 sectors |
| [Cross-cutting analysis](analysis.md) | — | Patterns, leverage ranking, what to source first |

## Frequency-of-change legend

How often the underlying reality moves enough to warrant a new answer — **not** how often the cell is currently reviewed (`scoreEntry()` stamps every manual cell `quarterly` regardless).

| Code | Meaning |
|---|---|
| 1D | Daily — a market price or yield |
| 1W | Weekly |
| 1M | Monthly — consensus estimate revisions, monthly prints |
| 1Q | Quarterly — earnings seasons, policy cycles |
| 1Y | Annual — structural review |

## Reading the dependency column

`Feeds X (0.NN)` means the cell is an input to composite `X` at that signal weight, per `DEFAULT_PARAMS.signalWeights` in `packages/engine/src/constants.ts`. Weights within each group sum to 1.0, so the number is the direct share of that node's score this cell controls.
