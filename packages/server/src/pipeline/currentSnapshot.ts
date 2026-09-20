import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  computeAllocation,
  snapshotSchema,
  SECTOR_NODES,
  rateCycleScores,
  debtLiquidityScore,
  type DebtLiquidityNode,
  type SeriesSource,
  type Snapshot,
} from "@wayfinder/engine";
import { computeAutoScoreCells } from "./scoreCells.js";
import { buildSeriesState } from "./buildSeriesState.js";
import { storedSeriesIds } from "../store/observations.js";
import {
  deriveIndiaUsValuationGapSeries,
  deriveRealGsec10ySeries,
  deriveFlowRatio3mSeries,
  deriveBondIndexReturn12mSeries,
  deriveRealGoldPriceSeries,
  cpiIndexSpliced,
  deriveFlowMean3mSeries,
  deriveGoldReturn12mSeries,
  deriveGoldReturn6mSeries,
  deriveUsReal10y6mChangeSeries,
  goldParabolic6mReturn,
  deriveGoldSilverRatio20ySeries,
} from "./derive.js";
import { computePercentile } from "./percentile.js";
import { allManualScores, allManualVetoes } from "../store/manual.js";
import { loadCurrentParams } from "../store/params.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_SNAPSHOT_PATH = join(__dirname, "../../../../mock/snapshot.json");

// §9 veto.parabolic: a >40% six-month move in gold. Spec-fixed, not a
// tunable - it lives here rather than in Params because no governance
// parameter row exists for it.
const PARABOLIC_6M_THRESHOLD = 0.4;

export interface CurrentSnapshotResult {
  snapshot: Snapshot;
  recomputedIds: string[];
}

// The single source of truth for "what is the current snapshot right
// now," used by GET /api/snapshot, POST /api/refresh, and POST
// /api/snapshots alike — previously each route re-implemented this
// (mock baseline + computeAutoScoreCells overlay) independently, which
// meant GET /api/snapshot never reflected anything a prior POST
// /api/refresh had fetched and stored. This function always reads
// whatever is currently in the store, regardless of whether a refresh
// just ran in this same request or an hour ago, so "current state" means
// the same thing everywhere it's asked.
//
// Layering, in order (later steps override earlier ones, per §1
// invariant 5 — provenance is always visible, so every override also
// updates the score/param's recorded provenance, not just its value):
//   1. Mock baseline (scores, vetoes, params) — the starting point until
//      the full 85-cell pipeline and NSE exist.
//   2. computeAutoScoreCells() — auto/rubric cells recomputed from
//      whatever the store's observations table currently holds.
//   3. Saved params (store/params.ts, id "current") — a user's edited
//      weights/caps from POST /api/params, if any have been saved.
//   4. Manual scores/vetoes (store/manual.ts) — a human's deliberate
//      entry always wins over an automated derivation; this is the
//      whole point of "manual" provenance existing as a category.
export function buildCurrentSnapshot(db: Database.Database, asOf: string = new Date().toISOString()): CurrentSnapshotResult {
  const raw = JSON.parse(readFileSync(MOCK_SNAPSHOT_PATH, "utf-8"));
  raw.asOf = asOf;

  // Everything starts as mock, because everything literally IS mock at
  // this point — the baseline above is a static demo file. Each layer
  // below clears the flag on whatever it genuinely replaces with store
  // data. This is the inverse of the old approach (tag nothing, assume
  // real), which let a never-overwritten baseline value be served with
  // "auto" provenance and no indication it was invented. §1 invariant 5.
  for (const s of Object.values(raw.scores) as Array<Record<string, unknown>>) {
    s.mock = true;
    s.mockReason = "Not wired to a live derivation — static demo baseline.";
  }
  for (const s of Object.values(raw.series) as Array<Record<string, unknown>>) {
    s.mock = true;
  }

  const savedParams = loadCurrentParams(db);
  if (savedParams) raw.params = savedParams;

  const asOfDate = asOf.slice(0, 10);
  const recomputed = computeAutoScoreCells(db, raw.params, asOfDate);
  const recomputedIds: string[] = [];
  for (const cell of recomputed) {
    if (cell.status !== "ok") {
      // Insufficient history: we still leave the baseline's VALUE alone
      // (overwriting with a fresh 50 would itself be a guess, and the
      // baseline at least carries the demo's intent). But the cell must
      // not keep claiming "auto" provenance as though it were computed —
      // that is exactly the silent-fallback case this flag exists for.
      // Name the series that fell short so the reason is actionable.
      raw.scores[cell.scoreId] = {
        ...raw.scores[cell.scoreId],
        mock: true,
        mockReason:
          cell.historySpanYears !== undefined
            ? `Wired, but only ${cell.historySpanYears.toFixed(2)} years of ${cell.derivedFrom.join(" x ")} history is stored — too short to rank "vs its own history" meaningfully.`
            : `Wired, but insufficient history to compute — needs ${raw.params.percentileMinObservations} observations from ${cell.derivedFrom.join(" x ")}.`,
        derivedFrom: cell.derivedFrom,
      };
      continue;
    }
    // staleDays reflects the age of the observation the value was ACTUALLY
    // computed from, not always 0 — a derived series can join sources with
    // different publication lags (e.g. l1.equity::momentum month-joins
    // FRED's gsec_10y, which can trail nifty50_close by months), so
    // hardcoding 0 here would silently overstate freshness. §1 invariant 5:
    // provenance must stay visible, freshness included.
    const staleDays = cell.latestDate ? Math.max(0, Math.round((new Date(asOfDate).getTime() - new Date(cell.latestDate).getTime()) / 86_400_000)) : 0;
    raw.scores[cell.scoreId] = {
      ...raw.scores[cell.scoreId],
      value: cell.value,
      provenance: cell.transform === "rubric" ? "rubric" : "auto",
      transform: cell.transform,
      derivedFrom: cell.derivedFrom,
      computedAt: asOf,
      staleDays,
      computedForDate: cell.latestDate,
      mock: false,
      mockReason: null,
      // Rubric cells only — the per-field choices behind the score, so
      // the UI can show the arithmetic instead of just the total.
      rubricInputs: cell.rubricInputs ?? null,
      // Windowed percentile cells — the real depth behind the ranking,
      // so a 2-year percentile cannot present as a 10-year one.
      historySpanYears: cell.historySpanYears ?? null,
      historyShortfall: cell.historyShortfall ?? false,
    };
    recomputedIds.push(cell.scoreId);

  }

  // Overlay snapshot.series from the observations table — EVERY series
  // the store actually holds, not just ones a score cell happens to
  // consume, and unconditionally rather than only where the baseline
  // lacks an entry.
  //
  // This previously ran per-cell over cell.derivedFrom and skipped any
  // id the mock baseline already had ("mock baseline already covers
  // this one"). That guard meant the 20 series shipped in the baseline
  // could never be refreshed from the store: /api/snapshot served
  // nifty100_pe as 101.31 (not even a P/E — the baseline's filler) while
  // the store held 520 real observations with a latest of 19.43. Any UI
  // reading snapshot.series for a derivation trace showed a raw value
  // that contradicted the score computed from that very series.
  for (const seriesId of storedSeriesIds(db)) {
    const state = buildSeriesState(db, seriesId, asOfDate, raw.params.percentileMinObservations);
    if (state) raw.series[seriesId] = { ...state, mock: false };
  }

  // Publish the DERIVED series that score cells actually percentile.
  // They are computed in-pipeline and live in no table, so the loop above
  // (which walks stored series only) cannot reach them — leaving the UI
  // with nothing to show but each raw leg's own percentile, which is not
  // what was ranked and openly contradicts the score (gsec_10y at 28.6
  // against a cell scoring 70, live 2026-09-19). Same reasoning as the
  // overlay comment above: a trace must never display a number that
  // disagrees with the score it claims to explain.
  //
  // Publishing the ranked quantity also makes the percentile STEP of each
  // formula showable. Without it a flows trace could say "rank the ratio
  // against its own history" and then jump straight to the final score
  // with nothing in between — the reader has no way to check 18.5.
  const publishDerived = (
    id: string,
    rows: Array<{ date: string; value: number }>,
    sourceLegId: string,
    fallbackSource: SeriesSource
  ) => {
    if (rows.length === 0) return;
    const last = rows[rows.length - 1]!;
    const pct = computePercentile(
      rows.map((o) => o.value),
      last.value,
      raw.params.percentileMinObservations
    );
    raw.series[id] = {
      id,
      latest: last.value,
      latestDate: last.date,
      percentile: pct.status === "ok" ? pct.percentile : null,
      observations: rows.length,
      windowStart: rows[0]!.date,
      // Derived, not fetched: it inherits a leg's provenance rather than
      // claiming a source of its own.
      source: raw.series[sourceLegId]?.source ?? fallbackSource,
      status: pct.status === "ok" ? "ok" : "insufficient_history",
      staleDays: Math.max(0, Math.round((new Date(asOfDate).getTime() - new Date(last.date).getTime()) / 86_400_000)),
      error: null,
      mock: false,
    };
  };

  publishDerived("real_gsec_10y", deriveRealGsec10ySeries(db), "gsec_10y", "FRED");
  publishDerived("flow_ratio_equity_3m", deriveFlowRatio3mSeries(db, "flow_equity_3m", "aum_equity"), "flow_equity_3m", "AMFI");
  publishDerived("flow_ratio_duration_3m", deriveFlowRatio3mSeries(db, "flow_duration_3m", "aum_duration"), "flow_duration_3m", "AMFI");
  publishDerived("bond_index_return_12m", deriveBondIndexReturn12mSeries(db), "bond_index_close", "NIFTYINDICES");
  publishDerived("real_gold_inr", deriveRealGoldPriceSeries(db), "gold_inr", "IBJA");
  publishDerived("flow_goldetf_3m", deriveFlowMean3mSeries(db, "flow_goldetf"), "flow_goldetf", "AMFI");
  publishDerived("gold_return_12m_inr", deriveGoldReturn12mSeries(db), "gold_usd_futures", "YAHOO_METALS");
  publishDerived("gold_return_6m_inr", deriveGoldReturn6mSeries(db), "gold_usd_futures", "YAHOO_METALS");
  publishDerived("us_real_10y_6m_change_bp", deriveUsReal10y6mChangeSeries(db), "us_real_10y", "FRED");
  publishDerived("gold_silver_ratio_20y", deriveGoldSilverRatio20ySeries(db, raw.params.percentileMinObservations), "gold_usd_futures", "YAHOO_METALS");
  // The SPLICED CPI, i.e. the deflator actually used. snapshot.series
  // carries cpi_index as stored, whose latest row is RBI's ~104.84 on
  // the post-rebase base — showing that beside a deflation performed on
  // the FRED-scale spliced series would restate the arithmetic wrong by
  // the splice factor itself.
  // equity.intl::valuation's gap adjustment. Without publishing it the
  // trace could only show each leg's own P/E, neither of which is the
  // quantity whose percentile selects the +/-5-10 band.
  publishDerived("india_us_valuation_gap", deriveIndiaUsValuationGapSeries(db), "nifty100_pe", "NIFTYINDICES");
  publishDerived("cpi_index_spliced", cpiIndexSpliced(db).rows, "cpi_index", "FRED");

  // Gold industrial demand is explicitly neutral in the workbook; it has
  // no external input and must not inherit the demo baseline's fake lineage.
  raw.scores["metals.gold::industrial"] = {
    ...raw.scores["metals.gold::industrial"], value: 50, provenance: "static", transform: "static",
    derivedFrom: [], computedAt: null, staleDays: 0, mock: false, mockReason: null,
  };

  // Sector cycle-position cells carry a real rubric (start 50; stage
  // +15/0/-15; overhang -10 — sectorCyclePositionScore in rubrics.ts)
  // but no feed that can answer it, so the pipeline never emits them and
  // they keep the mock baseline's "manual" provenance. That matters
  // beyond labelling: the Analyst Inputs view only renders a rubric
  // PICKER for cells whose provenance is "rubric", so leaving them
  // "manual" gave the one set of cells that most needs the picker a bare
  // number instead. Marked here rather than in the baseline file so the
  // rubric stays the single source of truth for which cells have one.
  //
  // Still mock: nobody has answered the rubric yet. A manual entry below
  // overrides this, exactly as it does for every other cell.
  for (const nodeId of SECTOR_NODES) {
    const scoreId = `${nodeId}::cycle_position`;
    // Default to the rubric's OWN neutral case (mid-cycle, no overhang
    // = 50) rather than keeping the demo baseline's spread of
    // 55/45/55/60/70/50/40/35. Those numbers were demo filler, not
    // anyone's judgement, and they were doing real work: capgoods' 70
    // was propping up its sleeve qualification while three of its four
    // signals were also mock. 50 is the honest unanswered value — §1
    // invariant 4, "a missing signal scores 50, never a guess" — and it
    // is what sectorCyclePositionScore returns for the no-adjustment
    // case, so the default and the rubric can never disagree.
    //
    // NOT flagged mock: the value is a real, defensible model position
    // (deliberately neutral), so it counts as live. But it is marked
    // with rubricInputs carrying assumed: true, so "live" can never be
    // read as "somebody looked at this" — the UI shows the default as a
    // default. An analyst's saved answer overrides it below.
    raw.scores[scoreId] = {
      ...raw.scores[scoreId],
      value: 50,
      provenance: "rubric",
      transform: "rubric",
      mock: false,
      mockReason: null,
      rubricInputs: [
        {
          field: "Cycle stage",
          selected: "Mid-cycle",
          delta: 0,
          basis: "No data feed can answer this — the rubric's own neutral case is used until an analyst picks a stage.",
          assumed: true,
        },
        {
          field: "Regulatory / disruption overhang",
          selected: "None",
          delta: 0,
          basis: "No data feed can answer this — the rubric's own no-adjustment case is used until an analyst answers.",
          assumed: true,
        },
      ],
    };
  }

  // Debt rate-cycle — one picker drives 3 score cells (§8.7). No free
  // source answers "expected 12m RBI path" (only realised repo-rate
  // direction exists, a backward-looking proxy already spent on
  // l1.debt::macro), so default to "On hold" — rateCycleScores' own
  // neutral case (50/50/55) — until an analyst picks a path. Same
  // "assumed: true" treatment as sector cycle-position: live, not mock,
  // but visibly unanswered.
  {
    const defaultPath = "on_hold" as const;
    const scores = rateCycleScores(defaultPath);
    const rateCycleNodes: Record<"gilt" | "corporate" | "liquid", string> = {
      gilt: "debt.gilt::rate_cycle",
      corporate: "debt.corporate::rate_cycle",
      liquid: "debt.liquid::rate_cycle",
    };
    for (const [node, scoreId] of Object.entries(rateCycleNodes) as [keyof typeof scores, string][]) {
      raw.scores[scoreId] = {
        ...raw.scores[scoreId],
        value: scores[node],
        provenance: "rubric",
        transform: "rubric",
        mock: false,
        mockReason: null,
        rubricInputs: [
          {
            field: "Expected 12m rate path",
            selected: "On hold",
            delta: 0,
            basis: "No free source prices the forward 12m RBI path — the rubric's own on-hold case is used until an analyst picks a path.",
            assumed: true,
          },
        ],
      };
    }
  }

  // Debt liquidity/redemption safety — "set-and-forget except in
  // stress" (§7.3). No free source detects a credit-fund stress episode,
  // so default to "Normal", which reproduces the exact frozen baseline
  // (90/65/75) until an analyst flags stress.
  {
    const debtLiquidityNodes: DebtLiquidityNode[] = ["gilt", "corporate", "liquid"];
    for (const node of debtLiquidityNodes) {
      const scoreId = `debt.${node}::liquidity`;
      raw.scores[scoreId] = {
        ...raw.scores[scoreId],
        value: debtLiquidityScore(node, false),
        provenance: "rubric",
        transform: "rubric",
        mock: false,
        mockReason: null,
        rubricInputs: [
          {
            field: "Market condition",
            selected: "Normal",
            delta: 0,
            basis: "No free source detects a credit-fund stress episode — the rubric's own normal-conditions baseline is used until an analyst flags stress.",
            assumed: true,
          },
        ],
      };
    }
  }

  const manualScores = allManualScores(db);
  for (const m of manualScores) {
    raw.scores[m.scoreId] = {
      ...raw.scores[m.scoreId],
      value: m.value,
      provenance: "manual",
      transform: "none",
      derivedFrom: [],
      computedAt: null,
      enteredAt: m.enteredAt,
      note: m.note,
      confidence: m.confidence,
      staleDays: 0,
      // A human deliberately entered this number. It is not a computed
      // reading, but it is not demo filler either — the whole point of
      // "manual" provenance is that it is a real, owned input.
      mock: false,
      mockReason: null,
    };
  }

  // §9 veto.parabolic - "if return >40% in 6M the parabolic veto fires
  // regardless of this score."
  //
  // The metals momentum spec names this veto explicitly as the companion
  // to its own score ("score 92, but check veto"), and veto.parabolic
  // existed only as a VetoId in the type union - nothing ever set it, so
  // the spec's "regardless of this score" clause could not fire at all.
  //
  // Applied BEFORE the manual overlay below, so a human's deliberate
  // veto decision still wins on the same node. Fires on the same INR
  // gold series the momentum cell ranks, so the two can never disagree
  // about what gold did. A null 6-month return (not enough history)
  // leaves the veto untouched rather than reading as "not triggered."
  {
    const sixMonth = goldParabolic6mReturn(db, asOfDate);
    if (sixMonth !== null && sixMonth > PARABOLIC_6M_THRESHOLD) {
      for (const nodeId of ["l1.metals", "metals.gold"] as const) {
        raw.vetoes[nodeId] = {
          active: true,
          triggeredBy: ["veto.parabolic"],
          provenance: "auto",
          detail: `Gold (INR) returned ${(sixMonth * 100).toFixed(1)}% over 6 months, above the ${(
            PARABOLIC_6M_THRESHOLD * 100
          ).toFixed(0)}% parabolic threshold.`,
          hadEffect: true, // recomputed below via computeAllocation's per-node vetoActive
        };
      }
    }
  }

  const manualVetoes = allManualVetoes(db);
  for (const v of manualVetoes) {
    raw.vetoes[v.nodeId] = {
      active: v.active,
      triggeredBy: [],
      provenance: "manual",
      detail: v.detail,
      hadEffect: raw.vetoes[v.nodeId]?.hadEffect ?? true, // recomputed below via computeAllocation's per-node vetoActive
    };
  }

  const scoreValues = Object.fromEntries(Object.entries(raw.scores).map(([k, v]: [string, any]) => [k, v.value]));
  const vetoValues = Object.fromEntries(Object.entries(raw.vetoes as Record<string, { active: boolean }>).map(([k, v]) => [k, v.active]));
  raw.allocation = computeAllocation(scoreValues, vetoValues, raw.params);

  // hadEffect needs the freshly computed allocation to know whether a
  // veto's clamp actually changed anything (§9: "vetoes on already-
  // underweight nodes do nothing — say so rather than flashing red").
  for (const v of manualVetoes) {
    for (const group of Object.values(raw.allocation.groups) as Array<{ nodes: Record<string, { rawTilt: number }> }>) {
      const node = group.nodes[v.nodeId];
      if (node) raw.vetoes[v.nodeId].hadEffect = node.rawTilt > 0;
    }
  }

  const result = snapshotSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Current snapshot failed schema validation: ${JSON.stringify(result.error.issues)}`);
  }

  return { snapshot: result.data as Snapshot, recomputedIds };
}
