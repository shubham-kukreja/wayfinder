import {
  DEBT_SIGNALS,
  EQUITY_SIGNALS,
  L1_SIGNALS,
  METALS_SIGNALS,
  SECTOR_SIGNALS,
  type GroupId,
  type NodeId,
} from "@wayfinder/engine";
import { NODE_LABELS, SECTOR_NODES, TILT_GROUP_NODES } from "@wayfinder/engine";

export type DataPointUpdateType = "automatic" | "opt_in" | "manual" | "derived" | "governance" | "veto" | "raw_series" | "constant";
export type DataPointFrequency = "daily" | "monthly" | "quarterly" | "event_driven" | "annual" | "static";
export type DataPointOwner = "market_data" | "investment_team" | "model_admin" | "system";

export interface DataPointRegistryEntry {
  id: string;
  label: string;
  technicalKey: string;
  modelGroup: GroupId | "vetoes" | "governance";
  updateType: DataPointUpdateType;
  source: string;
  frequency: DataPointFrequency;
  owner: DataPointOwner;
  description: string;
  dependency: string;
  // Only meaningful for updateType "raw_series". False means no adapter
  // exists for this series at all — any value seen in the snapshot is
  // mock-baseline placeholder data, not a real reading, and must never
  // be surfaced as "current" in the Data Points Control Center.
  hasLiveSource?: boolean;
}

const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
  relvalue: "Relative value",
  revisions: "Revisions",
  growth_diff: "Growth differential",
  margin_cycle: "Margin / cycle",
  carry: "Carry",
  rate_cycle: "Rate cycle",
  spread_cushion: "Spread cushion",
  liquidity: "Liquidity",
  ratio_position: "Ratio positioning",
  real_rates: "Real rates",
  industrial: "Industrial demand",
  rel_momentum: "Relative momentum",
  cycle_position: "Cycle position",
};

// Structural constants (§7, provenance "static"): score cells whose value
// encodes a fact about the INSTRUMENT CLASS, not a market view. They are
// set deliberately, reviewed on an annual/strategic cadence, and are
// CORRECT as they stand — they are not awaiting anybody's input.
//
// This set exists to stop them being reported as mock. They live in
// mock/snapshot.json like every other unwired cell, so the "never
// overwritten by a derivation ⇒ mock" rule catches them by default and
// buries 7 finished cells among 40 that genuinely need attention. Each
// value below is cross-checked against the engine's own rubric constants
// (rubrics.ts), not taken on faith from the demo baseline:
//
//   debt.{liquid,gilt,corporate}::liquidity  90 / 75 / 65 — exactly
//     DEBT_LIQUIDITY_BASELINE in rubrics.ts. Liquid funds are near-cash,
//     G-secs trade in a deep sovereign market, corporate paper is thinner.
//   debt.{liquid,gilt}::spread_cushion  50 — neutral BY DEFINITION: neither
//     sleeve carries meaningful credit spread, so there is no cushion to
//     score. (debt.corporate::spread_cushion is deliberately NOT here — it
//     is a real signal, blocked on the missing aaa_3y source.)
//   metals.gold::industrial  50 — gold's industrial demand is a small,
//     stable share of total demand; neutral is the designed answer.
//     (metals.silver::industrial is NOT here — silver is genuinely an
//     industrial metal and that cell tracks a real cycle.)
//   equity.large::growth_diff  50 — large cap is the BASELINE every other
//     segment's growth gap is measured against, so its own gap is zero by
//     construction. rubrics.ts and rubricUi.ts both state "large cap is
//     always 50"; the demo baseline's 45 contradicted that and is
//     corrected in mock/snapshot.json.
const STRUCTURAL_CONSTANT_SCORE_IDS = new Set([
  "debt.liquid::liquidity",
  "debt.gilt::liquidity",
  "debt.corporate::liquidity",
  "debt.liquid::spread_cushion",
  "debt.gilt::spread_cushion",
  "metals.gold::industrial",
  "equity.large::growth_diff",
]);

const AUTO_WIRED_SCORE_IDS = new Set([
  "l1.equity::flows",
  "l1.debt::flows",
  "l1.metals::flows",
  "l1.equity::valuation",
  "l1.equity::momentum",
  "l1.debt::valuation",
  "l1.metals::valuation",
  "l1.metals::fundamentals",
  "l1.metals::momentum",
  "l1.metals::macro",
  "equity.large::valuation",
  "equity.mid::valuation",
  "equity.small::valuation",
  "equity.large::relvalue",
  "equity.mid::relvalue",
  "equity.small::relvalue",
  "debt.gilt::carry",
  "debt.liquid::carry",
  "metals.gold::ratio_position",
  "metals.silver::ratio_position",
  "metals.gold::real_rates",
  "metals.silver::real_rates",
  ...SECTOR_NODES.map((nodeId) => `${nodeId}::valuation`),
  ...SECTOR_NODES.map((nodeId) => `${nodeId}::rel_momentum`),
]);

function scoreEntry(nodeId: NodeId, signalId: string, modelGroup: GroupId): DataPointRegistryEntry {
  const id = `${nodeId}::${signalId}`;
  const isAuto = AUTO_WIRED_SCORE_IDS.has(id);
  const isConstant = STRUCTURAL_CONSTANT_SCORE_IDS.has(id);
  const nodeLabel = NODE_LABELS[nodeId] ?? nodeId;
  const signalLabel = SIGNAL_LABELS[signalId] ?? signalId;
  return {
    id,
    label: `${nodeLabel} - ${signalLabel}`,
    technicalKey: id,
    modelGroup,
    updateType: isConstant ? "constant" : isAuto ? "derived" : "manual",
    source: isConstant ? "Model constant" : isAuto ? "Model pipeline" : "Manual or rubric input",
    frequency: isConstant ? "annual" : isAuto ? "daily" : "quarterly",
    owner: isConstant ? "model_admin" : isAuto ? "system" : "investment_team",
    description: isConstant
      ? `${signalLabel} for ${nodeLabel} — a structural property of the instrument class, not a market view. Reviewed annually.`
      : `${signalLabel} score feeding ${nodeLabel}.`,
    dependency: `${nodeLabel} -> ${signalLabel}`,
  };
}

const scoreEntries: DataPointRegistryEntry[] = [
  ...TILT_GROUP_NODES.l1.flatMap((nodeId) => L1_SIGNALS.map((signalId) => scoreEntry(nodeId, signalId, "l1"))),
  ...TILT_GROUP_NODES.equity.flatMap((nodeId) => EQUITY_SIGNALS.map((signalId) => scoreEntry(nodeId, signalId, "equity"))),
  ...TILT_GROUP_NODES.debt.flatMap((nodeId) => DEBT_SIGNALS.map((signalId) => scoreEntry(nodeId, signalId, "debt"))),
  ...TILT_GROUP_NODES.metals.flatMap((nodeId) => METALS_SIGNALS.map((signalId) => scoreEntry(nodeId, signalId, "metals"))),
  ...SECTOR_NODES.flatMap((nodeId) => SECTOR_SIGNALS.map((signalId) => scoreEntry(nodeId, signalId, "sector"))),
];

const governanceEntries: DataPointRegistryEntry[] = [
  "signalWeights.l1",
  "signalWeights.equity",
  "signalWeights.debt",
  "signalWeights.metals",
  "signalWeights.sector",
  "neutralWeights.l1",
  "neutralWeights.equity",
  "neutralWeights.debt",
  "neutralWeights.metals",
  "maxTilt",
  "sector",
  "normalisation",
  "percentileWindowYears",
  "percentileMinObservations",
  "respectDefinitionBreaks",
].map((key) => ({
  id: `governance.${key}`,
  label: key,
  technicalKey: key,
  modelGroup: "governance",
  updateType: "governance",
  source: "Model parameters",
  frequency: "annual",
  owner: "model_admin",
  description: "Governance parameter with broad model impact.",
  dependency: "Affects allocation engine",
}));

const vetoEntries: DataPointRegistryEntry[] = Object.values(NODE_LABELS).length
  ? [...TILT_GROUP_NODES.equity, ...TILT_GROUP_NODES.debt, ...TILT_GROUP_NODES.metals].map((nodeId) => ({
      id: `veto.${nodeId}`,
      label: `${NODE_LABELS[nodeId]} veto`,
      technicalKey: nodeId,
      modelGroup: "vetoes",
      updateType: "veto",
      source: "Risk gate",
      frequency: "event_driven",
      owner: "investment_team",
      description: "Risk gate that can block overweights but never force underweights.",
      dependency: `Can clamp ${NODE_LABELS[nodeId]} overweight`,
    }))
  : [];

// Small, hand-authored list (not generated) of raw upstream series that
// have no score-cell consumer yet, so they'd otherwise be invisible in
// the Control Center — never shown as an upstreamSeries chip via
// rowFromScore because no score's derivedFrom references them. Keep this
// short and deliberate; series consumed by a score already surface there.
const rawSeriesEntries: DataPointRegistryEntry[] = [
  {
    id: "series.aaa_3y",
    label: "3Y AAA Corporate Bond yield",
    technicalKey: "aaa_3y",
    modelGroup: "debt",
    updateType: "raw_series",
    source: "No live source (FIMMDA/FBIL dead ends, see docs/DATA_SOURCES.md)",
    frequency: "daily",
    owner: "market_data",
    description: "Feeds debt.corporate::carry (not yet wired); tracked standalone until a real source exists.",
    dependency: "Would feed debt.corporate::carry once a real source is found",
    hasLiveSource: false,
  },
];

export const DATA_POINT_REGISTRY: DataPointRegistryEntry[] = [
  ...scoreEntries,
  ...governanceEntries,
  ...vetoEntries,
  ...rawSeriesEntries,
];
