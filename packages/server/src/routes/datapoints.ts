import type { FastifyInstance } from "fastify";
import {
  SCORE_MAP,
  scoreMapEntry,
  seriesRole,
  type ScoreMapEntry,
  type ScoreState,
  type SeriesState,
  type VetoState,
} from "@wayfinder/engine";
import { DATA_POINT_REGISTRY, type DataPointRegistryEntry } from "../dataPointRegistry.js";
import { loadConfig } from "../config.js";
import { openDb } from "../store/db.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";

type FreshnessState = "current" | "stale" | "failed" | "missing" | "overridden";

// How often a series' SOURCE actually publishes a new observation, in
// days. A flat "stale after 7 days" threshold was flagging cells fed
// entirely by monthly government/AMFI data as stale within a week of a
// perfectly normal print, alongside genuinely overdue daily feeds — the
// two cases look identical under one number but mean completely
// different things to a reader. This maps each series to its own
// publication rhythm; a cell's threshold is the SLOWEST of its declared
// series (see cellStaleDaysThreshold below), so a cell that joins a
// daily price to a monthly macro print is judged by the monthly leg,
// not the daily one.
//
// Values are the source's real cadence plus a grace window (source
// cadence is a promise about when the NEXT print lands, not a deadline
// that expires the instant it passes) — roughly source-cadence + 40%,
// rounded, so a monthly series isn't flagged the day after 30 days.
// Series absent from this map fall back to DEFAULT_STALE_DAYS.
//
// Sourced from each adapter's own file comments:
//   fred.ts        — INDIRLTLT01STM/INDCPIALLMINMEI, OECD-sourced, monthly
//   rbi.ts         — DBIE mirror CPI/T-bill tables, monthly
//   tradingeconomics.ts — PMI/CPI calendar prints, monthly
//   amfi.ts        — AMFI scheme-category flows/AUM, monthly
//   dbnomics.ts    — IMF IFS gold reserves; monthly cadence but a
//                    confirmed multi-month mirror lag on top (see that
//                    adapter's file comment) — given extra room rather
//                    than flagged "stale" every single day it runs behind
//   bisPolicyRate.ts/rbiRepoRate.ts — RBI repo rate, event-driven on the
//                    ~bimonthly MPC calendar, not a fixed cadence
//   niftyindices.ts/nse.ts/bullion.ts/yahoo*.ts — daily market data
const SERIES_CADENCE_DAYS: Record<string, number> = {
  // Monthly government/macro prints (~30d cadence + grace)
  gsec_10y: 45,
  cpi_index: 45,
  cpi_yoy: 45,
  global_mfg_pmi: 45,
  // Monthly AMFI scheme-category data
  flow_equity_3m: 45,
  aum_equity: 45,
  flow_duration_3m: 45,
  aum_duration: 45,
  flow_goldetf: 45,
  aum_goldetf: 45,
  // Monthly, but with a documented extra mirror lag on top of the
  // source's own publication delay — given real headroom rather than
  // reporting "stale" on effectively every refresh.
  cb_gold_reserves_tonnes: 120,
  // Event-driven on the RBI MPC's ~bimonthly meeting calendar, not a
  // fixed cadence — closer to bimonthly than monthly in practice.
  repo_rate: 75,
};

const DEFAULT_STALE_DAYS = 7;

// The cell's own threshold is the SLOWEST of its declared series' —
// joining one daily leg to one monthly leg makes the whole cell a
// monthly-cadence read, since it cannot be any fresher than its
// slowest input.
function cellStaleDaysThreshold(sourceStates: SeriesState[]): number {
  if (sourceStates.length === 0) return DEFAULT_STALE_DAYS;
  return Math.max(...sourceStates.map((s) => SERIES_CADENCE_DAYS[s.id] ?? DEFAULT_STALE_DAYS));
}
type RowState = "published" | "draft_override" | "validation_error";

interface DataPointRow extends DataPointRegistryEntry {
  currentValue: number | boolean | string | null;
  unit: string;
  score: number | null;
  freshness: FreshnessState;
  lastUpdated: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  state: RowState;
  provenance: string | null;
  confidence: string | null;
  upstreamSeries: string[];
  sourceStatuses: Array<{ id: string; status: SeriesState["status"]; latestDate: string | null; staleDays: number | null }>;
  // True when the value shown is still the static demo baseline rather
  // than a real reading/derivation. Surfaced explicitly in the Control
  // Center so a placeholder can never be mistaken for a live number.
  mock: boolean;
  mockReason: string | null;
  // True for a cell that is serving a real default but has never been
  // ANSWERED by the person who owns it — every rubric input is still
  // the table's own no-adjustment case. Distinct from `mock` (the value
  // is defensible, not demo filler) and from freshness (nothing is
  // stale; it was simply never decided). Without this, "live" quietly
  // covers both "computed from a feed" and "nobody has looked at it".
  awaitingInput: boolean;
}

export function scoreFreshness(
  score: ScoreState | undefined,
  sourceStates: SeriesState[],
  mapEntry?: ScoreMapEntry
): FreshnessState {
  if (!score) return "missing";
  // A mock baseline is NOT an override, whatever provenance it carries.
  // The sector cycle-position cells surfaced this: they are rubric cells
  // nobody has answered yet, and reporting them "overridden" claimed a
  // deliberate human decision that has not happened. Check mock first.
  if (score.mock) return "missing";
  if (score.provenance === "manual") return "overridden";
  if (sourceStates.some((s) => s.status === "failed")) return "failed";
  // `insufficient_history` on a SERIES means it cannot support a
  // PERCENTILE — that is the only thing SeriesState's floor
  // (percentileMinObservations, 24) measures. For a percentile cell that
  // is fatal and the row must read "missing". For a RUBRIC cell it is
  // irrelevant: a rubric is a bucket lookup over the latest one or two
  // readings, so it is fully answerable on a series that will never
  // clear a percentile floor. metals.silver::industrial is the clearest
  // case — global_mfg_pmi holds exactly 2 observations BY DESIGN
  // (fetchHistory() throws; the rubric wants latest + prior), so gating
  // on the percentile floor reported a genuinely computed,
  // non-mock score as "missing" and hid real work behind a
  // floor it never needed. Only suppress a rubric cell when it has no
  // usable upstream reading at all.
  //
  // The same reasoning extends past rubrics to any cell that percentiles
  // a DERIVED quantity rather than a leg. l1.debt::valuation ranks
  // (gsec_10y - cpi_yoy): the derived real-yield series clears the floor
  // with 161 observations and the cell scores 70, but cpi_yoy on its own
  // holds 5 stored rows and reports `insufficient_history`, so this gate
  // marked a fully computed cell "missing" and the UI announced "No
  // observation has ever been stored for this point" above a live score
  // (confirmed live 2026-09-19). A leg's percentile floor is only
  // load-bearing where that leg's OWN percentile is an input — which is
  // exactly what seriesRole() records.
  const isRubric = score.transform === "rubric";
  // With no map entry the cell's derivation is undeclared, so fall back
  // to the old conservative rule (treat the leg as percentiled) rather
  // than silently promoting an unknown cell to "current". Only a
  // DECLARED "raw" role exempts a leg from the floor.
  const blocksPercentile = (s: SeriesState): boolean =>
    s.status === "insufficient_history" && (!mapEntry || seriesRole(mapEntry, s.id) === "percentile");
  if (!isRubric && sourceStates.some(blocksPercentile)) return "missing";
  // A non-rubric cell whose legs are all "raw" still needs SOMETHING
  // behind it: if no leg has any reading at all, there was nothing to
  // derive from.
  if (!isRubric && sourceStates.length > 0 && sourceStates.every((s) => s.latestDate === null)) return "missing";
  if (isRubric && sourceStates.length > 0 && sourceStates.every((s) => s.latestDate === null)) return "missing";
  if (score.staleDays !== null && score.staleDays > cellStaleDaysThreshold(sourceStates)) return "stale";
  if (score.provenance === "default") return "missing";
  return "current";
}

// The date a score cell was actually computed FOR.
//
// Deliberately the OLDEST leg date, not the newest. A cell that joins
// legs by month can only be as current as its slowest leg: the max date
// claims a freshness the number does not have. l1.debt::valuation
// reported "observed 1 Aug 2026" off cpi_yoy's August print while the
// score was computed on July's yield, which is the one month the join
// could resolve (confirmed live 2026-09-19) — §1 invariant 5, freshness
// must never be silently overstated.
// Newest leg date — the right answer for "when did anything here last
// move", which is what lastUpdated falls back to. Distinct from
// computedForDate below; do not merge them.
function latestSeriesDate(states: SeriesState[]): string | null {
  const dates = states.map((s) => s.latestDate).filter((date): date is string => !!date).sort();
  return dates[dates.length - 1] ?? null;
}

// Prefers the date the PIPELINE says the score was computed from, and
// only falls back to the oldest leg when the cell doesn't report one
// (manual cells, the mock baseline).
//
// The oldest-leg heuristic is a lower bound, not the answer: a cell
// whose derived series ends where its legs last OVERLAPPED can be older
// than every individual leg. l1.metals::valuation reported "observed 31
// Mar 2026" off CPI's last month while the real-gold join had in fact
// resolved earlier, and before the gold gap was filled it was computed
// from January against legs that both ran later still.
export function observedAtFor(score: ScoreState | undefined, states: SeriesState[]): string | null {
  if (score?.computedForDate) return score.computedForDate;
  const dates = states.map((s) => s.latestDate).filter((date): date is string => !!date).sort();
  return dates[0] ?? null;
}

function rowFromScore(entry: DataPointRegistryEntry, score: ScoreState | undefined, seriesById: Record<string, SeriesState>): DataPointRow {
  const mappedSeries = SCORE_MAP.find((cell) => cell.scoreId === entry.id)?.series ?? [];
  const derivedFrom = score?.derivedFrom ?? [];
  const upstreamSeries = derivedFrom.includes("series:example") && mappedSeries.length > 0 ? mappedSeries : derivedFrom;
  const sourceStates = upstreamSeries.map((id) => seriesById[id]).filter((s): s is SeriesState => !!s);
  // A constant has no feed to be stale against — it is current until the
  // annual review changes it, so it never enters the freshness funnel.
  const freshness =
    entry.updateType === "constant" ? "current" : scoreFreshness(score, sourceStates, scoreMapEntry(entry.id));
  return {
    ...entry,
    currentValue: score?.value ?? null,
    unit: "score",
    score: score?.value ?? null,
    freshness,
    lastUpdated: score?.enteredAt ?? score?.computedAt ?? latestSeriesDate(sourceStates),
    observedAt: observedAtFor(score, sourceStates),
    fetchedAt: null,
    state: score?.provenance === "manual" ? "draft_override" : "published",
    provenance: score?.provenance ?? null,
    confidence: score?.confidence ?? null,
    upstreamSeries,
    sourceStatuses: sourceStates.map((s) => ({ id: s.id, status: s.status, latestDate: s.latestDate, staleDays: s.staleDays })),
    // A structural constant lives in the mock baseline like every other
    // unwired cell, so buildCurrentSnapshot's "never overwritten by a
    // derivation ⇒ mock" rule flags it. That rule is right in general and
    // wrong here: these values are deliberate, verified against the
    // engine's own rubric constants, and complete. Reporting them as mock
    // buries 7 finished cells among the 40 that genuinely need input.
    mock: entry.updateType === "constant" ? false : score?.mock ?? true,
    mockReason: entry.updateType === "constant" ? null : score?.mockReason ?? null,
    // Every rubric input still sitting on its assumed default means the
    // cell is unanswered, however live its value is.
    awaitingInput:
      entry.updateType === "opt_in" &&
      score?.provenance !== "manual" &&
      (score?.rubricInputs?.length ?? 0) > 0 &&
      (score?.rubricInputs ?? []).every((input) => input.assumed === true),
  };
}

function rowFromGovernance(entry: DataPointRegistryEntry): DataPointRow {
  return {
    ...entry,
    currentValue: "Configured",
    unit: "parameter",
    score: null,
    freshness: "current",
    lastUpdated: null,
    observedAt: null,
    fetchedAt: null,
    state: "published",
    provenance: "static",
    confidence: null,
    upstreamSeries: [],
    sourceStatuses: [],
    // Governance parameters are real configured values, not demo filler.
    mock: false,
    mockReason: null,
    awaitingInput: false,
  };
}

function rowFromVeto(entry: DataPointRegistryEntry, veto: VetoState | undefined): DataPointRow {
  return {
    ...entry,
    currentValue: veto?.active ?? false,
    unit: "boolean",
    score: null,
    freshness: veto?.provenance === "manual" && veto.active ? "overridden" : "current",
    lastUpdated: null,
    observedAt: null,
    fetchedAt: null,
    state: veto?.provenance === "manual" ? "draft_override" : "published",
    provenance: veto?.provenance ?? "auto",
    confidence: null,
    upstreamSeries: veto?.triggeredBy ?? [],
    sourceStatuses: [],
    // A veto is a real on/off gate; "inactive" is a genuine state.
    mock: false,
    mockReason: null,
    awaitingInput: false,
  };
}

function rowFromSeries(entry: DataPointRegistryEntry, seriesState: SeriesState | undefined): DataPointRow {
  // hasLiveSource === false means no adapter exists for this series at
  // all — any snapshot.series entry for it is leftover mock-baseline
  // placeholder data (see packages/engine/scripts/gen-fixtures.ts),
  // never a real reading. Report it as "missing" unconditionally rather
  // than let the baseline's fake "ok" status read as current/trustworthy.
  if (entry.hasLiveSource === false) {
    return {
      ...entry,
      currentValue: null,
      unit: "%",
      score: null,
      freshness: "missing",
      lastUpdated: null,
      observedAt: null,
      fetchedAt: null,
      state: "published",
      provenance: null,
      confidence: null,
      upstreamSeries: [],
      sourceStatuses: [],
      mock: true,
      mockReason: entry.source,
    awaitingInput: false,
    };
  }
  // No SeriesState key at all is itself the "missing" signal for a series
  // with zero real observations and no score consumer (buildSeriesState()
  // only ever runs off a score cell's derivedFrom backfill). The
  // status==="failed"/"insufficient_history" branches below are for
  // forward-compatibility only, mirroring scoreFreshness()'s semantics,
  // in case this function is later reused for a series that does get
  // derivedFrom-backfilled.
  const freshness: FreshnessState = !seriesState
    ? "missing"
    : seriesState.status === "failed"
      ? "failed"
      : seriesState.status === "insufficient_history"
        ? "missing"
        : seriesState.staleDays !== null && seriesState.staleDays > (SERIES_CADENCE_DAYS[seriesState.id] ?? DEFAULT_STALE_DAYS)
          ? "stale"
          : "current";
  return {
    ...entry,
    awaitingInput: false,
    currentValue: seriesState?.latest ?? null,
    unit: "%",
    score: null,
    freshness,
    lastUpdated: seriesState?.latestDate ?? null,
    observedAt: seriesState?.latestDate ?? null,
    fetchedAt: null,
    state: "published",
    provenance: seriesState ? "auto" : null,
    confidence: null,
    upstreamSeries: [],
    sourceStatuses: seriesState
      ? [{ id: seriesState.id, status: seriesState.status, latestDate: seriesState.latestDate, staleDays: seriesState.staleDays }]
      : [],
    mock: seriesState?.mock ?? true,
    mockReason: seriesState?.mock === false ? null : "Static demo baseline — no stored observations.",
  };
}

function buildRows(): { rows: DataPointRow[]; summary: Record<string, number> } {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const { snapshot } = buildCurrentSnapshot(db);
    const rows = DATA_POINT_REGISTRY.map((entry) => {
      if (entry.updateType === "governance") return rowFromGovernance(entry);
      if (entry.updateType === "veto") return rowFromVeto(entry, snapshot.vetoes[entry.technicalKey as keyof typeof snapshot.vetoes]);
      if (entry.updateType === "raw_series") return rowFromSeries(entry, snapshot.series[entry.technicalKey]);
      return rowFromScore(entry, snapshot.scores[entry.id], snapshot.series);
    });
    const summary = rows.reduce<Record<string, number>>(
      (acc, row) => {
        acc.total = (acc.total ?? 0) + 1;
        acc[row.freshness] = (acc[row.freshness] ?? 0) + 1;
        acc[row.updateType] = (acc[row.updateType] ?? 0) + 1;
        if (row.mock) acc.mock = (acc.mock ?? 0) + 1;
        else acc.live = (acc.live ?? 0) + 1;
        if (row.awaitingInput) acc.awaitingInput = (acc.awaitingInput ?? 0) + 1;
        // NOTE: no explicit "constant" tally — acc[row.updateType] above
        // already counts it, and the Constants tab reads that key.
        return acc;
      },
      { total: 0 }
    );
    return { rows, summary };
  } finally {
    db.close();
  }
}

export function registerDatapointsRoute(app: FastifyInstance): void {
  app.get("/api/datapoints", async (_req, reply) => {
    try {
      return buildRows();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
