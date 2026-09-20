---
name: wire-data-point
description: Wire or verify ONE Wayfinder score cell end to end — Excel formula → source points → external fetch → score calculation → server+UI → trace → minimal test. Use when asked to fix, verify, wire, or unblock a data point / score cell (e.g. "wire debt.corporate::carry", "verify l1.equity::macro", "the metals valuation number looks wrong").
---

# Wire / verify one data point

One cell, all nine steps, in order. Do not batch cells — the honesty invariants below only hold if each cell's evidence is checked on its own.

**Two flows.** Decide at step 0 and say which you are in:
- **WIRE** — the cell is `mock`/manual and needs a live derivation. All 9 steps.
- **VERIFY** — the cell already computes; the number is suspect. **Skip step 5.** Steps 6-9 become "confirm or correct."

Read `docs/PIPELINE_ARCHITECTURE.md` first if you do not already have the pipeline in context. `docs/DATA_SOURCES.md` is the authoritative per-source status — update it whenever an adapter's status changes.

---

## Step 0 — Identify the cell

Get to one exact `nodeId::signalId` key. If the user named a symptom ("metals number is wrong") rather than a key, find the cell first and confirm it back before touching anything.

```bash
# Live state of every cell: value, provenance, mock flag
cd packages/server && npx tsx -e '...buildCurrentSnapshot...'   # see step 9 harness
```

Read `packages/server/src/dataPointRegistry.ts` to see whether it is `derived`, `manual`, `constant`, `governance` or `veto`. **A `constant` is not broken** — the 7 structural constants (`debt.*::liquidity`, `debt.{liquid,gilt}::spread_cushion`, `metals.gold::industrial`, `equity.large::growth_diff`) are deliberate and complete. Do not "fix" one into a derivation.

State plainly: cell id, current value, provenance, mock/live, and which flow you are in.

---

## Step 1 — Read the exact formula from the Excel workbook

`docs/MultiAsset_Allocation_Framework_v2.xlxs (2).xlsx` is the **spec of record**. The code comments cite it (`§7.1`, `§8.4`, "Calculation Guide row 11"); when code and workbook disagree, the workbook wins unless a code comment documents a live-verified reason to deviate.

Sheets → `xl/worksheets/sheetN.xml`, in workbook order:
`1` Export Summary · `2` README · `3` Weights & Rules · **`4` Calculation Guide** · `5` L1 Asset Classes · `6` Equity Segments · `7` Debt Buckets · `8` Precious Metals · `9` Sector Satellite · `10` Portfolio Rollup · **`11` Data Trackers** · `12` Monitoring & Review

```bash
cd /Users/shubhamkukreja/arvia/wayfinder && python3 -c "
import zipfile,re,sys
SHEET=4   # 4 = Calculation Guide, 11 = Data Trackers, 5-9 = per-group tabs
z=zipfile.ZipFile('docs/MultiAsset_Allocation_Framework_v2.xlxs (2).xlsx')
ss=re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode(), re.S)
strs=[''.join(re.findall(r'<t[^>]*>(.*?)</t>',s,re.S)) for s in ss]
for r in re.findall(r'<row[^>]*>(.*?)</row>', z.read(f'xl/worksheets/sheet{SHEET}.xml').decode(), re.S):
    cells=re.findall(r'<c r=\"[A-Z]+\d+\"(?: s=\"\d+\")?(?: t=\"(\w+)\")?[^>]*>(?:<v>(.*?)</v>)?', r)
    vals=[(strs[int(v)] if t=='s' and v else (v or '')) for t,v in cells]
    line=' | '.join(v for v in vals if v)
    if line.strip(): print(line)
" | grep -i "<your signal keyword>"
```

The Calculation Guide's **"THE UNIVERSAL RECIPE"** header block states the default: compute the quantity → percentile it against its own history → invert if high = unattractive. Each row then gives *Signal | Exact calculation step by step | Data source | Worked example*. Quote the exact calculation text and the worked example into your notes — the worked example is what you reconcile against in step 7.

---

## Step 2 — Derive the source points needed

From the formula, list every input. For each, name:

- the **internal series id** it would use (match existing naming — `sector_pe_*`, `flow_*`/`aum_*`, `*_close`; never invent a parallel scheme for a series that exists)
- whether it is already in the store, and at what depth
- whether it is a **raw leg** or gets **percentiled on its own**

```bash
sqlite3 packages/server/data/wayfinder.db \
  "SELECT series_id, source, COUNT(*) n, MIN(date), MAX(date) FROM observations
   WHERE source<>'AMFI_NAV' GROUP BY series_id, source ORDER BY series_id;"
```

Then check `packages/engine/src/scoreMap.ts` for an existing entry, and `packages/server/src/pipeline/derive.ts` for a derivation helper you can reuse rather than rewrite.

---

## Step 3 — Classify each source point

This determines the code path. Get it wrong and the score is wrong in a way that still looks plausible.

| Type | What it means | Path |
|---|---|---|
| **Level / single metric** | a rate, price, index level, P/E | `autoScore(db, id, params, transform)` |
| **Derived quantity** | difference, ratio, return, spread of ≥2 legs | build the series in `derive.ts`, then `autoScoreFromSeries()` |
| **Percentile input** | this series' *own* percentile enters the score | `seriesRole: "percentile"` — gets a distribution strip |
| **Raw operand** | only the latest *value* is used, as an operand or rubric input | `seriesRole: "raw"` — **no** strip |
| **Discrete / rubric** | a band, direction or category lookup | a table in `engine/src/rubrics.ts` + `rubricInputs[]` |
| **Percentage vs percentage-point** | a level (5.25%) vs a change (+25bp) | convert explicitly; `× 100` for pp→bp |

**The single most common mistake:** assuming a percentile cell percentiles its legs. It usually does not — it percentiles a *derivation* of them. `l1.debt::valuation` ranks `gsec_10y − cpi_yoy`, so neither leg's own percentile is an input. Record this per-series in `scoreMap.ts`'s `seriesRoles`; `seriesRole()` defaults conservatively and only a **declared** `"raw"` exempts a leg from the percentile floor.

Also fix the **join granularity** now: exact-date join for same-source pairs (`derivedRatioSeries`), **year-month** join for cross-source pairs (`derivedDifferenceSeries`) — FRED and RBI publish on different days of the month, and an exact-date join there silently yields zero rows.

---

## Step 4 — Find a credible free source *(WIRE only — skip for VERIFY)*

Priority order, highest first:

1. **A series already in the store** — free, already backfilled.
2. **An already-wired adapter that can emit one more series.** 15 adapters exist; extending one beats writing one. Check whether the payload already carries the field (Midcap/Smallcap P/B were in the NSE response all along, just unmapped).
3. **A new adapter on a source with a real API** — FRED, DBnomics, BIS.
4. **A new scraped adapter** — last resort, no SLA.

Rules:
- **Free and unauthenticated wins.** Note rate limits (metals.dev is 100 req/**month**).
- **Prefer history.** A latest-only source cannot clear the 24-observation percentile floor for months. This is why several cells prefer Yahoo COMEX futures over the IBJA benchmark.
- **Additive, never a rename.** If a new source covers a series another adapter writes, write the **same** series id — "latest `fetched_at` wins" resolves it with no preference logic.
- **A near-match is not a match.** Never substitute a different instrument/tenor to clear the floor. `fred.ts` documents refusing an interbank rate for the 364-day T-bill over a systematic ~0.5pp gap: *a wrong number with enough observations to look confident is worse than an honest `insufficient_history`.* If nothing credible exists, stop and record it in `docs/DATA_SOURCES.md` and `docs/missing_data_points/` — that is a complete, correct outcome.
- **A documented substitute is allowed where a near-match is not** — but only when the substitute is ranked against *its own* history, so both sides of the comparison are the same metric. `multpl.ts` stores S&P **trailing** P/E for a cell whose spec names **forward** P/E: written to its own series id (never into `sp500_fwd_pe`), with the ~40% level gap stated in the adapter, on the score cell, and on the face of the trace. The test is whether a reader could mistake it for the specified input. If they could, it is a near-match; fix the labelling or drop it.

### 4b — If the metric is rubric-shaped or needs analyst judgement

Some signals have no derivable source *in principle*, not just no free one: consensus EPS revisions, forward guidance tone, capacity-utilisation colour, "is credit accelerating." **Do not force these into a derivation, and do not leave them silently at a mock baseline.** Route them to analyst input instead:

1. **Add the cell to the analyst-input set** — `updateType: "manual"`, owner `investment_team`, in `packages/server/src/dataPointRegistry.ts`. That is what puts it in front of a human in the Control Center rather than hiding it among the wired cells.
2. **Assign an explicit default / fallback value**, and say in a code comment *why that number* — the rubric's own no-adjustment case where one exists (50 for a free-standing signal, per §1 invariant 1), or the structural constant where the instrument class genuinely fixes it.
3. **Mark it assumed.** For a rubric field, that is `rubricInputs[]` with `assumed: true` and a `basis` naming the missing source. For a whole cell, it is `mock`/`mockReason` stating that this point awaits analyst entry — never a bare 50 that reads as a computed result.
4. **Record it in `docs/missing_data_points/`** with what a human would have to look at to fill it in.

The invariant this serves: *a number a human owns is legitimate; a number nobody owns is not.* A manual score with `provenance: "manual"` is a real owned input and is correctly **not** flagged mock. The failure mode to avoid is the third state — an unowned default sitting in a wired-looking cell.

---

## Step 5 — Verify the value against an independent reading

**Always run this step, both flows.** Use WebSearch/WebFetch to get one reliable published figure for each source point, and reconcile against what the store holds or the API returned.

- Same source is acceptable if it is the publisher's own page.
- Reconcile **units and scale** explicitly: ₹/10g vs ₹/kg, % vs bp, index base year, crore vs million.
- A CPI-deflated figure must use the **spliced** index (`cpi_index_spliced`), not raw `cpi_index` — the RBI rebase means mixing them restates the arithmetic by the splice factor.
- Note the **as-of date** of both readings. A mismatch is often the real bug.

Write down: value fetched, value published, source URL, date, and whether they agree. If they disagree, that discrepancy is the finding — resolve it before writing any code.

---

## Step 6 — Plug in the formula

Now write the derivation, in this order:

1. **`packages/server/src/pipeline/derive.ts`** — a `deriveXSeries(db)` returning `Array<{date, value}>` for the ranked quantity, if the cell needs one. Generate it for **every historical date**, not just today: the universal recipe needs a history to percentile against. Watch the O(n²) trap — use the existing binary-search `lastRowAtOrBeforeDate`, not a per-date filter/pop.
2. **`packages/server/src/pipeline/scoreCells.ts`** — push a `ScoreCellResult` in `computeAutoScoreCells()`. Set `derivedFrom` to the real legs, the right `transform`, and `latestDate` = the date the value was **actually** computed from (for a join, the date the join last resolved — not any leg's own latest).
3. **`packages/engine/src/scoreMap.ts`** — add the entry with `seriesRoles` per step 3.
4. **Rubric cells** — the table goes in `packages/engine/src/rubrics.ts`; `scoreCells.ts` builds the `rubricInputs[]` array with `{field, selected, delta, basis}` per field, using the spec's own wording for `field`. An input with no source uses the rubric's **no-adjustment** case with `assumed: true` and a `basis` saying why. Never silently pick a side.
   - **Any adjustment the score applies must be reported, not left for the UI to re-derive.** `rubricInputs[]` is the channel for this even on a cell that is otherwise a percentile. `equity.intl::valuation` selects a ±5-10 point band from the India-US gap's percentile over a 10Y month-end window, while the *published* `SeriesState.percentile` for that same series is computed over its entire stored history — 3.4 vs 10.2 live, two different bands. A trace that recomputed the band from the published number printed −5 beside a score built with −10. Emit the applied delta; let the trace read it.
5. **`packages/server/src/dataPointRegistry.ts`** — add the id to `AUTO_WIRED_SCORE_IDS`.
6. **New derived series the UI must show** — add a `publishDerived(...)` line in `currentSnapshot.ts`. Without it the trace can only show each raw leg's percentile, which contradicts the score.

Reconcile the result against the workbook's worked example before moving on.

---

## Step 7 — Update server + UI

- If a new series was added: register the adapter in `routes/refresh.ts` (`AVAILABLE_SOURCES` + `buildAdapters`) and, if it supports history, in `scripts/backfill.ts`.
- **Run the backfill** if the cell needs ≥24 observations, then re-check the cell is not still `insufficient_history`.
- Update `docs/DATA_SOURCES.md` — the status legend (✅ Live / ⚠️ Proxy / ❌ Missing) is the source of truth for "is X actually live," not memory.
- The Control Center row needs nothing per-cell; it is generated. But confirm the row's **freshness** is right — see `scoreFreshness()` in `routes/datapoints.ts`. If a fully-computed cell reads `missing`, the cause is almost always a leg with `insufficient_history` whose `seriesRole` was not declared `"raw"`.

---

## Step 8 — Fix the trace

The trace is what the user sees on selecting the data point and clicking **view exact formula**. It is not optional garnish — invariant: *a trace must never display a number that disagrees with the score it claims to explain.*

`packages/web/src/components/ScoreFormulaTraces.tsx`:
1. Write a `<XTrace>` component using the existing `TraceHeading` / `Formula` / `InputRow` / `Step` primitives.
2. Add a `case "<scoreId>":` to `ScoreFormulaTrace`'s switch.
3. **Add the id to `hasScoreFormulaTrace()`'s array** — easy to forget, and the UI silently falls back to the generic trace without it.

Rules:
- Every number shown is read from the snapshot or derived from it **by the same arithmetic the server used** — never re-fetched, never approximated.
- Show the percentile **step**, not just the final score, so the reader can check it.
- Distribution strip **only** where `seriesRole` is `"percentile"`. A strip on a raw operand invites attributing the score to a percentile that never entered the calculation.
- Rubric cells render `rubricInputs[]` — field, selected option, signed delta, basis — and mark `assumed` inputs visibly.
- The generic `SignalDerivationTrace` in `CalculationInspector.tsx` already covers the plain one-series-percentiled case; only write a bespoke trace when the cell is genuinely more than that.

---

## Step 9 — Minimal test, then hand off

**Keep it small — one focused test, not a suite.** Match the repo's vitest style (`packages/server/test/*.test.ts`, fixtures in `test/fixtures/`). Cover the one thing that would actually break:

- new adapter → parse a trimmed real fixture (name the capture date in a comment)
- new derivation → the arithmetic, on a tiny in-memory series
- new score cell → it produces `ok` + the expected value from seeded observations

Live-network tests go in `*.live.test.ts`, separate from the unit test.

```bash
cd packages/server && npx vitest run test/<name>.test.ts
```

**Then verify against the running system, not just the function.** Per the user's standing rule: restart the dev server after engine/server changes and confirm the value live — a passing unit test is not evidence the cell is right end to end.

```bash
# from repo root, in a scratchpad file (imports need absolute paths under tsx)
cat > "$SCRATCHPAD/probe.ts" <<'EOF'
import {openDb} from "/Users/shubhamkukreja/arvia/wayfinder/packages/server/src/store/db.js";
import {buildCurrentSnapshot} from "/Users/shubhamkukreja/arvia/wayfinder/packages/server/src/pipeline/currentSnapshot.js";
const db=openDb("/Users/shubhamkukreja/arvia/wayfinder/packages/server/data/wayfinder.db");
const {snapshot}=buildCurrentSnapshot(db);
const id="<scoreId>";
console.log(id, JSON.stringify(snapshot.scores[id],null,2));
db.close();
EOF
cd packages/server && npx tsx "$SCRATCHPAD/probe.ts"
```

Check: `mock: false`, the right `provenance`, a sane `computedForDate`, and `derivedFrom` naming the real legs.

**Finally, prompt the user to check**, with:
- cell id, old value → new value
- the formula applied, and the workbook row it came from
- the external reading it was verified against, with the URL and as-of date
- anything still assumed (rubric no-adjustment cases) or still blocked
- where to look in the UI: Control Center → the row → **view exact formula**

---

## Invariants — these override convenience

1. **A missing signal scores 50, never a guess.**
2. **Provenance stays visible.** Every override updates provenance; `staleDays`/`computedForDate` reflect the observation actually used; `mock`/`mockReason` are explicit.
3. **Never invent a number a source does not give.** Drop non-numeric values; do not map a near-match index; do not pick a side on an unsourced rubric input.
4. **A failed fetch is a warning, never an exception.**
5. **Append-only.** Never `UPDATE`/`DELETE` observations; a revision is a new row with a later `fetched_at`.
6. **A trace must never display a number that disagrees with its score.**
7. **Honest `insufficient_history` beats a confident wrong number.**
8. **"Percentile vs its own history" is a claim about a WINDOW and a SAMPLING RATE, not just a row count.** `percentileMinObservations` counts rows; the spec constrains calendar time. Two failure modes, both live-confirmed:
   - *Too short a window.* `equity.{large,mid}::valuation` scored 97.99/97.37 — "cheapest in a decade" — off a 2.1-year history, because `autoScore()` ranks against every stored row with no windowing and the backfill defaulted to 760 days. Check `historySpanYears` against the spec's window before believing any percentile; use the span guard + `historyShortfall`, don't just clear the row floor.
   - *Uneven sampling inside the window.* A month-end backfill spliced onto a daily refresh weights the recent period ~20:1 per unit of calendar time. `midcap150_pb` ranked at the 17th percentile on daily rows and the 77th on monthly ones — the same number reading cheap or expensive purely from polling frequency. Where the spec says "monthly history," sample month-end (`monthEndSample()`) before percentiling.
