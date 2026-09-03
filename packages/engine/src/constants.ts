import type { Params, NodeId } from "./types.js";

export const DEFAULT_PARAMS: Params = {
  signalWeights: {
    l1: { valuation: 0.3, macro: 0.2, fundamentals: 0.2, flows: 0.15, momentum: 0.15 },
    equity: { valuation: 0.3, relvalue: 0.2, revisions: 0.2, growth_diff: 0.15, margin_cycle: 0.15 },
    debt: { carry: 0.3, rate_cycle: 0.3, spread_cushion: 0.25, liquidity: 0.15 },
    metals: { ratio_position: 0.4, real_rates: 0.35, industrial: 0.25 },
    sector: { valuation: 0.3, revisions: 0.3, rel_momentum: 0.25, cycle_position: 0.15 },
  },
  neutralWeights: {
    l1: { "l1.equity": 0.55, "l1.debt": 0.35, "l1.metals": 0.1 },
    equity: { "equity.large": 0.45, "equity.mid": 0.2, "equity.small": 0.15, "equity.intl": 0.2 },
    debt: { "debt.liquid": 0.4, "debt.corporate": 0.35, "debt.gilt": 0.25 },
    metals: { "metals.gold": 0.75, "metals.silver": 0.25 },
  },
  maxTilt: { l1: 0.2, equity: 0.3, debt: 0.3, metals: 0.25 },
  sector: { sleeveCap: 0.15, maxSectors: 2, threshold: 70 },
  normalisation: "proportional",
  percentileWindowYears: 10,
  percentileMinObservations: 24,
  respectDefinitionBreaks: true,
};

export const NODE_LABELS: Record<NodeId, string> = {
  "l1.equity": "Equity",
  "l1.debt": "Debt",
  "l1.metals": "Precious Metals",
  "equity.large": "Large Cap",
  "equity.mid": "Mid Cap",
  "equity.small": "Small Cap",
  "equity.intl": "International",
  "debt.liquid": "Liquid",
  "debt.corporate": "Corporate",
  "debt.gilt": "Gilt",
  "metals.gold": "Gold",
  "metals.silver": "Silver",
  "sector.banking": "Banking",
  "sector.it": "IT",
  "sector.pharma": "Pharma",
  "sector.auto": "Auto",
  "sector.capgoods": "Capital Goods",
  "sector.fmcg": "FMCG",
  "sector.energy": "Energy",
  "sector.metals": "Metals",
};

export const GROUP_LABELS: Record<string, string> = {
  l1: "Asset Classes",
  equity: "Equity Segments",
  debt: "Debt Buckets",
  metals: "Precious Metals",
  sector: "Sector Satellite",
};

export const TILT_GROUP_NODES: Record<"l1" | "equity" | "debt" | "metals", NodeId[]> = {
  l1: ["l1.equity", "l1.debt", "l1.metals"],
  equity: ["equity.large", "equity.mid", "equity.small", "equity.intl"],
  debt: ["debt.liquid", "debt.corporate", "debt.gilt"],
  metals: ["metals.gold", "metals.silver"],
};

export const SECTOR_NODES: NodeId[] = [
  "sector.banking",
  "sector.it",
  "sector.pharma",
  "sector.auto",
  "sector.capgoods",
  "sector.fmcg",
  "sector.energy",
  "sector.metals",
];
