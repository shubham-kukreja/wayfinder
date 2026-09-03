import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeAllocation } from "../src/compute.js";
import { DEFAULT_PARAMS, SECTOR_NODES, TILT_GROUP_NODES } from "../src/constants.js";
import { SCORE_PROVENANCE } from "../src/scoreProvenance.js";
import { DEBT_SIGNALS, EQUITY_SIGNALS, L1_SIGNALS, METALS_SIGNALS, SECTOR_SIGNALS } from "../src/types.js";
import type {
  NodeId,
  Params,
  Scores,
  ScoreState,
  SeriesState,
  Snapshot,
  Vetoes,
  VetoState,
  Warning,
} from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockDir = join(__dirname, "../../../mock");

const ALL_NODE_SIGNALS: Array<[NodeId, readonly string[]]> = [
  ...TILT_GROUP_NODES.l1.map((n) => [n, L1_SIGNALS] as [NodeId, readonly string[]]),
  ...TILT_GROUP_NODES.equity.map((n) => [n, EQUITY_SIGNALS] as [NodeId, readonly string[]]),
  ...TILT_GROUP_NODES.debt.map((n) => [n, DEBT_SIGNALS] as [NodeId, readonly string[]]),
  ...TILT_GROUP_NODES.metals.map((n) => [n, METALS_SIGNALS] as [NodeId, readonly string[]]),
  ...SECTOR_NODES.map((n) => [n, SECTOR_SIGNALS] as [NodeId, readonly string[]]),
];

function allScoreKeys(): string[] {
  const keys: string[] = [];
  for (const [nodeId, signals] of ALL_NODE_SIGNALS) {
    for (const s of signals) keys.push(`${nodeId}::${s}`);
  }
  return keys;
}

function buildScoreStates(
  scores: Scores,
  opts: {
    provenance?: (key: string) => ScoreState["provenance"];
    staleDays?: (key: string) => number | null;
  } = {}
): Record<string, ScoreState> {
  const out: Record<string, ScoreState> = {};
  for (const key of allScoreKeys()) {
    const value = scores[key] ?? 50;
    const provenance = opts.provenance ? opts.provenance(key) : "auto";
    out[key] = {
      value,
      provenance,
      derivedFrom: provenance === "default" || provenance === "manual" ? [] : ["series:example"],
      transform:
        provenance === "static" ? "static" : provenance === "default" ? "none" : provenance === "rubric" ? "rubric" : provenance === "manual" ? "none" : "percentile",
      computedAt: provenance === "default" ? null : "2026-09-03T06:00:00Z",
      enteredAt: provenance === "manual" ? "2026-08-15T00:00:00Z" : null,
      staleDays: opts.staleDays ? opts.staleDays(key) : 0,
      note: null,
      confidence: provenance === "manual" ? "medium" : null,
    };
  }
  return out;
}

function buildVetoStates(vetoes: Vetoes, allocation: ReturnType<typeof computeAllocation>): Record<NodeId, VetoState> {
  const out: Partial<Record<NodeId, VetoState>> = {};
  for (const [nodeId, active] of Object.entries(vetoes) as Array<[NodeId, boolean]>) {
    if (!active) continue;
    let hadEffect = true;
    for (const group of Object.values(allocation.groups)) {
      const node = group.nodes[nodeId];
      if (node) {
        hadEffect = node.rawTilt > 0; // clamp only had an effect if raw tilt was positive
      }
    }
    out[nodeId] = {
      active: true,
      triggeredBy: ["veto.earnings_collapse"],
      provenance: "manual",
      detail: "Manually flagged for this fixture.",
      hadEffect,
    };
  }
  return out as Record<NodeId, VetoState>;
}

const SERIES_IDS = [
  "earnings_yield_gap",
  "nifty50_pe",
  "nifty100_pe",
  "midcap150_pe",
  "smallcap250_pe",
  "real_gsec_10y",
  "gsec_10y",
  "tbill_1y",
  "aaa_3y",
  "aaa_spread",
  "real_gold_price",
  "gold_inr",
  "silver_inr",
  "gold_silver_ratio",
  "us_real_10y",
  "nifty50_tr",
  "bond_index_tr",
  "flow_equity_3m",
  "flow_duration_3m",
  "flow_goldetf_3m",
];

function buildSeriesStates(status: SeriesState["status"] = "ok"): Record<string, SeriesState> {
  const out: Record<string, SeriesState> = {};
  for (const id of SERIES_IDS) {
    out[id] = {
      id,
      latest: status === "insufficient_history" ? 22.4 : 100 + Math.random() * 10,
      latestDate: "2026-09-01",
      percentile: status === "insufficient_history" || status === "failed" ? null : 55,
      observations: status === "insufficient_history" ? 3 : 180,
      windowStart: status === "insufficient_history" ? "2026-06-01" : "2016-09-01",
      source: id.startsWith("gold") || id.startsWith("silver") ? "IBJA" : id.startsWith("flow") ? "AMFI" : id.startsWith("us_real") ? "FRED" : "NSE",
      status,
      staleDays: status === "stale" ? 60 : 2,
      error: status === "failed" ? "fetch timeout after 15s" : null,
    };
  }
  return out;
}

function writeSnapshot(filename: string, snapshot: Snapshot) {
  writeFileSync(join(mockDir, filename), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote mock/${filename}`);
}

// ---- 1. snapshot.json — healthy, reproduces §5.2 exactly ----
{
  const scores: Scores = {
    "l1.equity::valuation": 45, "l1.debt::valuation": 65, "l1.metals::valuation": 35,
    "l1.equity::macro": 55, "l1.debt::macro": 60, "l1.metals::macro": 60,
    "l1.equity::fundamentals": 55, "l1.debt::fundamentals": 55, "l1.metals::fundamentals": 65,
    "l1.equity::flows": 40, "l1.debt::flows": 55, "l1.metals::flows": 30,
    "l1.equity::momentum": 60, "l1.debt::momentum": 45, "l1.metals::momentum": 75,

    "equity.large::valuation": 55, "equity.mid::valuation": 35, "equity.small::valuation": 25, "equity.intl::valuation": 40,
    "equity.large::relvalue": 60, "equity.mid::relvalue": 30, "equity.small::relvalue": 20, "equity.intl::relvalue": 45,
    "equity.large::revisions": 50, "equity.mid::revisions": 55, "equity.small::revisions": 45, "equity.intl::revisions": 60,
    "equity.large::growth_diff": 45, "equity.mid::growth_diff": 60, "equity.small::growth_diff": 55, "equity.intl::growth_diff": 65,
    "equity.large::margin_cycle": 55, "equity.mid::margin_cycle": 40, "equity.small::margin_cycle": 30, "equity.intl::margin_cycle": 50,

    "debt.liquid::carry": 55, "debt.corporate::carry": 60, "debt.gilt::carry": 65,
    "debt.liquid::rate_cycle": 40, "debt.corporate::rate_cycle": 55, "debt.gilt::rate_cycle": 70,
    "debt.liquid::spread_cushion": 50, "debt.corporate::spread_cushion": 45, "debt.gilt::spread_cushion": 50,
    "debt.liquid::liquidity": 90, "debt.corporate::liquidity": 65, "debt.gilt::liquidity": 75,

    "metals.gold::ratio_position": 40, "metals.silver::ratio_position": 60,
    "metals.gold::real_rates": 65, "metals.silver::real_rates": 55,
    "metals.gold::industrial": 50, "metals.silver::industrial": 55,

    "sector.banking::valuation": 60, "sector.banking::revisions": 55, "sector.banking::rel_momentum": 50, "sector.banking::cycle_position": 55,
    "sector.it::valuation": 55, "sector.it::revisions": 40, "sector.it::rel_momentum": 35, "sector.it::cycle_position": 45,
    "sector.pharma::valuation": 50, "sector.pharma::revisions": 65, "sector.pharma::rel_momentum": 60, "sector.pharma::cycle_position": 55,
    "sector.auto::valuation": 45, "sector.auto::revisions": 55, "sector.auto::rel_momentum": 55, "sector.auto::cycle_position": 60,
    "sector.capgoods::valuation": 60, "sector.capgoods::revisions": 75, "sector.capgoods::rel_momentum": 80, "sector.capgoods::cycle_position": 70,
    "sector.fmcg::valuation": 55, "sector.fmcg::revisions": 45, "sector.fmcg::rel_momentum": 40, "sector.fmcg::cycle_position": 50,
    "sector.energy::valuation": 60, "sector.energy::revisions": 50, "sector.energy::rel_momentum": 45, "sector.energy::cycle_position": 40,
    "sector.metals::valuation": 55, "sector.metals::revisions": 45, "sector.metals::rel_momentum": 50, "sector.metals::cycle_position": 35,
  };
  const vetoes: Vetoes = { "equity.small": true };
  const allocation = computeAllocation(scores, vetoes, DEFAULT_PARAMS);

  const snapshot: Snapshot = {
    asOf: "2026-09-03T06:00:00Z",
    schemaVersion: "1.0",
    series: buildSeriesStates("ok"),
    scores: buildScoreStates(scores, {
      provenance: (key) => SCORE_PROVENANCE[key] ?? "auto",
      staleDays: (key) => (SCORE_PROVENANCE[key] === "manual" ? 12 : 0),
    }),
    vetoes: buildVetoStates(vetoes, allocation),
    params: DEFAULT_PARAMS,
    allocation,
    fetchLog: [
      { source: "FRED", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:02Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "IBJA", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:03Z", status: "ok", error: null, rowsWritten: 2 },
      { source: "RBI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:04Z", status: "ok", error: null, rowsWritten: 5 },
      { source: "NSE", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:06Z", status: "ok", error: null, rowsWritten: 20 },
      { source: "AMFI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:08Z", status: "ok", error: null, rowsWritten: 8 },
    ],
    warnings: [],
  };
  writeSnapshot("snapshot.json", snapshot);
}

// ---- 2. snapshot-degraded.json — AMFI + NSE failed, 12 series stale >45d, 6 scores fell back to default ----
{
  const scores: Scores = {};
  for (const key of allScoreKeys()) scores[key] = 50 + (Math.random() * 20 - 10);
  const defaultKeys = allScoreKeys().slice(0, 6);
  for (const key of defaultKeys) scores[key] = 50;

  const vetoes: Vetoes = {};
  const allocation = computeAllocation(scores, vetoes, DEFAULT_PARAMS);

  const series = buildSeriesStates("ok");
  let staleCount = 0;
  for (const id of Object.keys(series)) {
    if (series[id]!.source === "AMFI" || series[id]!.source === "NSE") {
      series[id] = { ...series[id]!, status: "failed", error: "fetch failed: 3 retries exhausted", latest: null, percentile: null };
    } else if (staleCount < 12) {
      series[id] = { ...series[id]!, status: "stale", staleDays: 47 + staleCount };
      staleCount++;
    }
  }

  const scoreStates = buildScoreStates(scores, {
    provenance: (key) => (defaultKeys.includes(key) ? "default" : "auto"),
  });

  const warnings: Warning[] = [
    { severity: "error", code: "source_failed", message: "AMFI fetch failed after 3 retries", affects: ["flow_equity_3m", "flow_duration_3m", "flow_goldetf_3m"] },
    { severity: "error", code: "source_failed", message: "NSE fetch failed after 3 retries", affects: ["nifty50_pe", "nifty100_pe", "midcap150_pe", "smallcap250_pe"] },
    { severity: "warn", code: "stale_series", message: "12 series have not refreshed within their expected cadence", affects: Object.keys(series).filter((id) => series[id]!.status === "stale") },
    { severity: "info", code: "default_fallback", message: "6 scores have no fetched or manual input and are defaulting to 50", affects: defaultKeys },
  ];

  const snapshot: Snapshot = {
    asOf: "2026-09-03T06:00:00Z",
    schemaVersion: "1.0",
    series,
    scores: scoreStates,
    vetoes: {},
    params: DEFAULT_PARAMS,
    allocation,
    fetchLog: [
      { source: "FRED", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:02Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "IBJA", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:03Z", status: "ok", error: null, rowsWritten: 2 },
      { source: "RBI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:04Z", status: "ok", error: null, rowsWritten: 5 },
      { source: "NSE", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:19Z", status: "failed", error: "timeout after 15s (3 attempts)", rowsWritten: 0 },
      { source: "AMFI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:19Z", status: "failed", error: "PDF parse failed: layout mismatch", rowsWritten: 0 },
    ],
    warnings,
  };
  writeSnapshot("snapshot-degraded.json", snapshot);
}

// ---- 3. snapshot-cold-start.json — 3 observations per series, almost all insufficient_history, nearly all scores 50 ----
{
  const scores: Scores = {};
  for (const key of allScoreKeys()) scores[key] = 50;
  // A couple of manual/static scores can still be entered even cold.
  scores["debt.liquid::liquidity"] = 90;
  scores["debt.corporate::liquidity"] = 65;
  scores["debt.gilt::liquidity"] = 75;
  scores["equity.large::growth_diff"] = 50;

  const vetoes: Vetoes = {};
  const allocation = computeAllocation(scores, vetoes, DEFAULT_PARAMS);

  const series = buildSeriesStates("insufficient_history");

  const scoreStates = buildScoreStates(scores, {
    provenance: (key) => (["debt.liquid::liquidity", "debt.corporate::liquidity", "debt.gilt::liquidity", "equity.large::growth_diff"].includes(key) ? "static" : "default"),
  });

  const warnings: Warning[] = [
    { severity: "warn", code: "insufficient_history", message: "All series have fewer than 24 observations; the allocation is neutral by default and not yet informative", affects: Object.keys(series) },
  ];

  const snapshot: Snapshot = {
    asOf: "2026-09-03T06:00:00Z",
    schemaVersion: "1.0",
    series,
    scores: scoreStates,
    vetoes: {},
    params: DEFAULT_PARAMS,
    allocation,
    fetchLog: [
      { source: "FRED", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:02Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "IBJA", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:03Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "RBI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:04Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "NSE", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:06Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "AMFI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:08Z", status: "ok", error: null, rowsWritten: 1 },
    ],
    warnings,
  };
  writeSnapshot("snapshot-cold-start.json", snapshot);
}

// ---- 4. snapshot-extreme.json — composites at 15 and 88, three vetoes firing, two sectors qualifying, sleeve fully deployed ----
{
  const scores: Scores = {};
  for (const key of allScoreKeys()) scores[key] = 50;

  // Drive l1.equity composite low (~15) and l1.debt composite high (~88).
  for (const s of L1_SIGNALS) scores[`l1.equity::${s}`] = 15;
  for (const s of L1_SIGNALS) scores[`l1.debt::${s}`] = 88;
  for (const s of L1_SIGNALS) scores[`l1.metals::${s}`] = 50;

  // Two qualifying sectors, well above threshold.
  for (const s of SECTOR_SIGNALS) scores["sector.capgoods::" + s] = 85;
  for (const s of SECTOR_SIGNALS) scores["sector.banking::" + s] = 78;

  const vetoes: Vetoes = {
    "equity.small": true,
    "metals.silver": true,
    "debt.corporate": true,
  };
  for (const s of EQUITY_SIGNALS) scores[`equity.small::${s}`] = 20;
  for (const s of METALS_SIGNALS) scores[`metals.silver::${s}`] = 85; // parabolic veto firing but had-effect since raw tilt positive
  for (const s of DEBT_SIGNALS) scores[`debt.corporate::${s}`] = 25;

  const allocation = computeAllocation(scores, vetoes, DEFAULT_PARAMS);

  const scoreStates = buildScoreStates(scores);
  const series = buildSeriesStates("ok");

  const warnings: Warning[] = [
    { severity: "warn", code: "veto_active", message: "3 vetoes are currently active", affects: ["equity.small", "metals.silver", "debt.corporate"] },
    { severity: "info", code: "cap_binding", message: "Tilt caps are binding on l1.equity and l1.debt", affects: ["l1.equity", "l1.debt"] },
  ];

  const snapshot: Snapshot = {
    asOf: "2026-09-03T06:00:00Z",
    schemaVersion: "1.0",
    series,
    scores: scoreStates,
    vetoes: buildVetoStates(vetoes, allocation),
    params: DEFAULT_PARAMS,
    allocation,
    fetchLog: [
      { source: "FRED", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:02Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "IBJA", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:03Z", status: "ok", error: null, rowsWritten: 2 },
      { source: "RBI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:04Z", status: "ok", error: null, rowsWritten: 5 },
      { source: "NSE", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:06Z", status: "ok", error: null, rowsWritten: 20 },
      { source: "AMFI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:08Z", status: "ok", error: null, rowsWritten: 8 },
    ],
    warnings,
  };
  writeSnapshot("snapshot-extreme.json", snapshot);
}

// ---- 5. snapshot-empty-sleeve.json — no sector qualifies, sleeve 0, core equity unscaled ----
{
  const scores: Scores = {};
  for (const key of allScoreKeys()) scores[key] = 50;
  // Keep all sector composites below the 70 threshold.
  for (const nodeId of SECTOR_NODES) {
    for (const s of SECTOR_SIGNALS) scores[`${nodeId}::${s}`] = 55;
  }
  // Mildly interesting L1/segment tilts so it doesn't look identical to all-50.
  scores["l1.equity::valuation"] = 58;
  scores["l1.debt::carry"] = 62;
  scores["equity.large::valuation"] = 60;

  const vetoes: Vetoes = {};
  const allocation = computeAllocation(scores, vetoes, DEFAULT_PARAMS);

  const scoreStates = buildScoreStates(scores);
  const series = buildSeriesStates("ok");

  const warnings: Warning[] = [];

  const snapshot: Snapshot = {
    asOf: "2026-09-03T06:00:00Z",
    schemaVersion: "1.0",
    series,
    scores: scoreStates,
    vetoes: {},
    params: DEFAULT_PARAMS,
    allocation,
    fetchLog: [
      { source: "FRED", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:02Z", status: "ok", error: null, rowsWritten: 1 },
      { source: "IBJA", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:03Z", status: "ok", error: null, rowsWritten: 2 },
      { source: "RBI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:04Z", status: "ok", error: null, rowsWritten: 5 },
      { source: "NSE", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:06Z", status: "ok", error: null, rowsWritten: 20 },
      { source: "AMFI", startedAt: "2026-09-03T06:00:00Z", finishedAt: "2026-09-03T06:00:08Z", status: "ok", error: null, rowsWritten: 8 },
    ],
    warnings,
  };
  writeSnapshot("snapshot-empty-sleeve.json", snapshot);
}

console.log("All 5 fixtures generated.");
