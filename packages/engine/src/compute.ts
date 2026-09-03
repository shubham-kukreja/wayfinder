import {
  DEFAULT_PARAMS,
  NODE_LABELS,
  SECTOR_NODES,
  TILT_GROUP_NODES,
} from "./constants.js";
import type {
  Allocation,
  DebtSignal,
  EquitySignal,
  L1Signal,
  MetalsSignal,
  NodeId,
  Params,
  SectorNodeId,
  SectorSignal,
  Scores,
  TiltGroupId,
  TiltNodeResult,
  Vetoes,
} from "./types.js";
import { DEBT_SIGNALS, EQUITY_SIGNALS, L1_SIGNALS, METALS_SIGNALS, SECTOR_SIGNALS } from "./types.js";

const GROUP_SIGNALS: Record<TiltGroupId, readonly string[]> = {
  l1: L1_SIGNALS,
  equity: EQUITY_SIGNALS,
  debt: DEBT_SIGNALS,
  metals: METALS_SIGNALS,
};

function getScore(scores: Scores, nodeId: string, signalId: string): number {
  const key = `${nodeId}::${signalId}`;
  const value = scores[key];
  // §1 invariant 4: a missing signal scores 50, never a guess.
  return value === undefined ? 50 : value;
}

function composite(
  scores: Scores,
  nodeId: string,
  group: TiltGroupId,
  weights: Record<string, number>
): number {
  let sum = 0;
  for (const signal of GROUP_SIGNALS[group]) {
    sum += getScore(scores, nodeId, signal) * (weights[signal] ?? 0);
  }
  return sum;
}

function computeTiltGroup(
  group: TiltGroupId,
  scores: Scores,
  vetoes: Vetoes,
  params: Params
): { nodes: Record<string, TiltNodeResult>; composites: Record<string, number> } {
  const nodeIds = TILT_GROUP_NODES[group];
  const signalWeights = params.signalWeights[group] as Record<string, number>;
  const neutralWeights = params.neutralWeights[group] as Record<string, number>;
  const maxTilt = params.maxTilt[group];

  const composites: Record<string, number> = {};
  const rawTilts: Record<string, number> = {};
  const tilts: Record<string, number> = {};

  for (const nodeId of nodeIds) {
    const c = composite(scores, nodeId, group, signalWeights);
    composites[nodeId] = c;
    rawTilts[nodeId] = ((c - 50) / 50) * maxTilt;
  }

  if (params.normalisation === "zero_sum") {
    // Demean raw tilts across the group before applying veto clamp, preserving sign.
    const mean = nodeIds.reduce((s, id) => s + rawTilts[id]!, 0) / nodeIds.length;
    for (const nodeId of nodeIds) {
      rawTilts[nodeId] = rawTilts[nodeId]! - mean;
    }
  }

  for (const nodeId of nodeIds) {
    const vetoActive = !!vetoes[nodeId];
    const raw = rawTilts[nodeId]!;
    tilts[nodeId] = vetoActive ? Math.min(raw, 0) : raw;
  }

  const prelim: Record<string, number> = {};
  let prelimSum = 0;
  for (const nodeId of nodeIds) {
    const neutral = neutralWeights[nodeId] ?? 0;
    const p = neutral * (1 + tilts[nodeId]!);
    prelim[nodeId] = p;
    prelimSum += p;
  }

  const nodes: Record<string, TiltNodeResult> = {};
  for (const nodeId of nodeIds) {
    const neutral = neutralWeights[nodeId] ?? 0;
    const final = prelimSum === 0 ? 0 : prelim[nodeId]! / prelimSum;
    const vetoActive = !!vetoes[nodeId];
    nodes[nodeId] = {
      composite: composites[nodeId]!,
      rawTilt: rawTilts[nodeId]!,
      tilt: tilts[nodeId]!,
      prelim: prelim[nodeId]!,
      final,
      neutral,
      vsNeutralRaw: tilts[nodeId]!,
      vsNeutralFinal: final - neutral,
      vetoActive,
    };
  }

  return { nodes, composites };
}

function computeSector(
  scores: Scores,
  vetoes: Vetoes,
  params: Params
): Allocation["sector"] {
  const weights = params.signalWeights.sector as Record<SectorSignal, number>;
  const composites: Record<string, number> = {};

  for (const nodeId of SECTOR_NODES) {
    let sum = 0;
    for (const signal of SECTOR_SIGNALS) {
      sum += getScore(scores, nodeId, signal) * (weights[signal] ?? 0);
    }
    composites[nodeId] = sum;
  }

  const qualifying = SECTOR_NODES.filter(
    (nodeId) => composites[nodeId]! >= params.sector.threshold && !vetoes[nodeId]
  ).sort((a, b) => composites[b]! - composites[a]!);

  const held = qualifying.slice(0, params.sector.maxSectors);
  const sleeve = params.sector.sleeveCap * (held.length / params.sector.maxSectors);
  const perSector = held.length > 0 ? sleeve / held.length : 0;

  return {
    composites: composites as Record<SectorNodeId, number>,
    qualifying: qualifying as SectorNodeId[],
    held: held as SectorNodeId[],
    sleeve,
    perSector,
  };
}

export function computeAllocation(
  scores: Scores,
  vetoes: Vetoes,
  params: Params = DEFAULT_PARAMS
): Allocation {
  const l1 = computeTiltGroup("l1", scores, vetoes, params);
  const equity = computeTiltGroup("equity", scores, vetoes, params);
  const debt = computeTiltGroup("debt", scores, vetoes, params);
  const metals = computeTiltGroup("metals", scores, vetoes, params);
  const sector = computeSector(scores, vetoes, params);

  const finalEquity = l1.nodes["l1.equity"]!.final;
  const finalDebt = l1.nodes["l1.debt"]!.final;
  const finalMetals = l1.nodes["l1.metals"]!.final;
  const coreScale = 1 - sector.sleeve;

  const rollup: Allocation["rollup"] = [];

  for (const nodeId of TILT_GROUP_NODES.equity) {
    const withinGroup = equity.nodes[nodeId]!.final;
    const portfolioWeight = finalEquity * withinGroup * coreScale;
    rollup.push({
      id: nodeId,
      label: NODE_LABELS[nodeId as NodeId],
      groupWeight: finalEquity,
      withinGroup,
      portfolioWeight,
    });
  }

  for (const sectorId of sector.held) {
    rollup.push({
      id: `sleeve.${sectorId.split(".")[1]}`,
      label: NODE_LABELS[sectorId],
      groupWeight: finalEquity,
      withinGroup: sector.perSector,
      portfolioWeight: finalEquity * sector.perSector,
    });
  }

  for (const nodeId of TILT_GROUP_NODES.debt) {
    const withinGroup = debt.nodes[nodeId]!.final;
    const portfolioWeight = finalDebt * withinGroup;
    rollup.push({
      id: nodeId,
      label: NODE_LABELS[nodeId as NodeId],
      groupWeight: finalDebt,
      withinGroup,
      portfolioWeight,
    });
  }

  for (const nodeId of TILT_GROUP_NODES.metals) {
    const withinGroup = metals.nodes[nodeId]!.final;
    const portfolioWeight = finalMetals * withinGroup;
    rollup.push({
      id: nodeId,
      label: NODE_LABELS[nodeId as NodeId],
      groupWeight: finalMetals,
      withinGroup,
      portfolioWeight,
    });
  }

  const total = rollup.reduce((s, r) => s + r.portfolioWeight, 0);

  return {
    groups: {
      l1: { nodes: l1.nodes },
      equity: { nodes: equity.nodes },
      debt: { nodes: debt.nodes },
      metals: { nodes: metals.nodes },
    },
    sector,
    rollup,
    total,
  };
}
