// Frozen node IDs — never hardcode these as string literals outside this file's type.
export type L1NodeId = "l1.equity" | "l1.debt" | "l1.metals";
export type EquityNodeId = "equity.large" | "equity.mid" | "equity.small" | "equity.intl";
export type DebtNodeId = "debt.liquid" | "debt.corporate" | "debt.gilt";
export type MetalsNodeId = "metals.gold" | "metals.silver";
export type SectorNodeId =
  | "sector.banking"
  | "sector.it"
  | "sector.pharma"
  | "sector.auto"
  | "sector.capgoods"
  | "sector.fmcg"
  | "sector.energy"
  | "sector.metals";

export type TiltNodeId = L1NodeId | EquityNodeId | DebtNodeId | MetalsNodeId;
export type NodeId = TiltNodeId | SectorNodeId;

export type TiltGroupId = "l1" | "equity" | "debt" | "metals";
export type GroupId = TiltGroupId | "sector";

export const L1_SIGNALS = ["valuation", "macro", "fundamentals", "flows", "momentum"] as const;
export const EQUITY_SIGNALS = ["valuation", "relvalue", "revisions", "growth_diff", "margin_cycle"] as const;
export const DEBT_SIGNALS = ["carry", "rate_cycle", "spread_cushion", "liquidity"] as const;
export const METALS_SIGNALS = ["ratio_position", "real_rates", "industrial"] as const;
export const SECTOR_SIGNALS = ["valuation", "revisions", "rel_momentum", "cycle_position"] as const;

export type L1Signal = (typeof L1_SIGNALS)[number];
export type EquitySignal = (typeof EQUITY_SIGNALS)[number];
export type DebtSignal = (typeof DEBT_SIGNALS)[number];
export type MetalsSignal = (typeof METALS_SIGNALS)[number];
export type SectorSignal = (typeof SECTOR_SIGNALS)[number];

export type SignalId = L1Signal | EquitySignal | DebtSignal | MetalsSignal | SectorSignal;

// Score key format: `${nodeId}::${signalId}`
export type ScoreKey = `${NodeId}::${SignalId}`;

export type NormalisationMode = "proportional" | "zero_sum";

export interface Params {
  signalWeights: {
    l1: Record<L1Signal, number>;
    equity: Record<EquitySignal, number>;
    debt: Record<DebtSignal, number>;
    metals: Record<MetalsSignal, number>;
    sector: Record<SectorSignal, number>;
  };
  neutralWeights: {
    l1: Record<L1NodeId, number>;
    equity: Record<EquityNodeId, number>;
    debt: Record<DebtNodeId, number>;
    metals: Record<MetalsNodeId, number>;
  };
  maxTilt: Record<TiltGroupId, number>;
  sector: {
    sleeveCap: number;
    maxSectors: number;
    threshold: number;
  };
  normalisation: NormalisationMode;
  percentileWindowYears: number;
  percentileMinObservations: number;
  respectDefinitionBreaks: boolean;
}

export interface TiltNodeResult {
  composite: number;
  rawTilt: number;
  tilt: number;
  prelim: number;
  final: number;
  neutral: number;
  vsNeutralRaw: number;
  vsNeutralFinal: number;
  vetoActive: boolean;
}

export interface Allocation {
  groups: Record<
    TiltGroupId,
    {
      nodes: Record<string, TiltNodeResult>;
    }
  >;
  sector: {
    composites: Record<SectorNodeId, number>;
    qualifying: SectorNodeId[];
    held: SectorNodeId[];
    sleeve: number;
    perSector: number;
  };
  rollup: Array<{
    id: string;
    label: string;
    groupWeight: number;
    withinGroup: number;
    portfolioWeight: number;
  }>;
  total: number;
}

export type Vetoes = Partial<Record<NodeId, boolean>>;
export type Scores = Record<string, number>;

// §13 — the Snapshot payload.
export type SeriesId = string;
export type VetoId =
  | "veto.flow_froth"
  | "veto.parabolic"
  | "veto.currency_stress"
  | "veto.liquidity"
  | "veto.earnings_collapse"
  | "veto.credit_event";

export type SeriesSource = "FRED" | "NSE" | "AMFI" | "RBI" | "IBJA" | "MANUAL";
export type SeriesStatus = "ok" | "stale" | "failed" | "insufficient_history" | "manual";

export interface SeriesState {
  id: SeriesId;
  latest: number | null;
  latestDate: string | null;
  percentile: number | null;
  observations: number;
  windowStart: string | null;
  source: SeriesSource;
  status: SeriesStatus;
  staleDays: number | null;
  error: string | null;
}

export type ScoreProvenance = "auto" | "rubric" | "static" | "manual" | "default";
export type ScoreTransform = "percentile" | "inverted" | "average" | "rubric" | "static" | "none";
export type Confidence = "high" | "medium" | "low";

export interface ScoreState {
  value: number;
  provenance: ScoreProvenance;
  derivedFrom: string[];
  transform: ScoreTransform;
  computedAt: string | null;
  enteredAt: string | null;
  staleDays: number | null;
  note: string | null;
  confidence: Confidence | null;
}

export interface VetoState {
  active: boolean;
  triggeredBy: VetoId[];
  provenance: "auto" | "manual";
  detail: string | null;
  hadEffect: boolean;
}

export type WarningSeverity = "info" | "warn" | "error";

export interface Warning {
  severity: WarningSeverity;
  code: string;
  message: string;
  affects: string[];
}

export interface FetchLogEntry {
  source: string;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "failed" | "partial";
  error: string | null;
  rowsWritten: number;
}

export interface Snapshot {
  asOf: string;
  schemaVersion: "1.0";
  series: Record<SeriesId, SeriesState>;
  scores: Record<string, ScoreState>;
  vetoes: Record<NodeId, VetoState>;
  params: Params;
  allocation: Allocation;
  fetchLog: FetchLogEntry[];
  warnings: Warning[];
}
