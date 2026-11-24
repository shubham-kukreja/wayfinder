import type { Allocation, SectorNodeId, Snapshot, TiltGroupId, TiltNodeResult } from "@wayfinder/engine";
import { NODE_LABELS, SECTOR_NODES, TILT_GROUP_NODES } from "@wayfinder/engine";
import { CoreApiError, coreFetch } from "./coreApi.js";

// Overview reads its allocation from core-jobs-service
// (GET /v1/portfolios/{portfolio}/allocation): core's engine computed every
// number. This module turns that response into the engine's Allocation type,
// so the page's components render core's results; nothing is recomputed in
// the browser.

type StepValues = Record<string, number | boolean>;

export interface PortfolioAllocation {
  portfolio: string;
  version: {
    id: string | null;
    /** The model run; absent for a live evaluation of the draft. */
    run_id?: string;
    /** The draft revision, for a live evaluation of the draft. */
    rev?: number;
    kind: "published" | "review" | "draft";
    as_of: string;
    published_at: string | null;
    config_version: number;
  };
  compare: "neutral" | "previous";
  asset_classes: Array<{ node: string; weight: number; compare: number; composite?: number }>;
  sleeves: Array<{
    node: string;
    group: string;
    weight: number;
    within_group: number;
    neutral: number;
    compare: number;
    delta: number;
    veto: boolean;
    sleeve: boolean;
  }>;
  drivers: Record<string, Record<string, number>>;
  vetoes: Array<{ node: string; source: "rule" | "override" }>;
  steps: Record<string, StepValues>;
  scorecards: Record<
    string,
    { parent?: string; buckets: string[]; tilt_cap?: number; score_series: string; signals: Array<{ key: string; weight: number }> }
  >;
  warnings: Array<Record<string, unknown>>;
}

/**
 * The published allocation; if nothing is published yet, the newest run
 * (fallbackUsed: true), as the legacy page fell back to the draft.
 */
export async function loadPortfolioAllocation(portfolio = "core"): Promise<{ data: PortfolioAllocation; fallbackUsed: boolean }> {
  const path = `/v1/portfolios/${encodeURIComponent(portfolio)}/allocation`;
  try {
    return { data: await coreFetch<PortfolioAllocation>(`${path}?version=published`), fallbackUsed: false };
  } catch (err) {
    if (!(err instanceof CoreApiError && err.status === 404)) throw err;
    return { data: await coreFetch<PortfolioAllocation>(`${path}?version=draft`), fallbackUsed: true };
  }
}

const num = (v: number | boolean | undefined): number => (typeof v === "number" ? v : 0);

/** Builds the engine's Allocation from core's run. */
export function toAllocation(p: PortfolioAllocation): Allocation {
  const step = (node: string) => p.steps[node] ?? {};
  const sleeveByNode = new Map(p.sleeves.map((s) => [s.node, s]));
  const classByNode = new Map(p.asset_classes.map((a) => [a.node, a]));

  const groupNodes = (group: TiltGroupId): Record<string, TiltNodeResult> => {
    const card = p.scorecards[group];
    const cap = card?.tilt_cap ?? 0;
    const ids = card?.buckets ?? TILT_GROUP_NODES[group];
    // Within-group neutral weights: the asset classes' own for l1, else
    // each sleeve's share of its group's neutral weight.
    const neutralOf = (id: string): number => {
      if (group === "l1") return classByNode.get(id)?.compare ?? 0;
      const s = sleeveByNode.get(id);
      if (!s) return 0;
      const groupNeutral = p.sleeves.filter((x) => x.group === s.group && !x.sleeve).reduce((sum, x) => sum + x.neutral, 0);
      return groupNeutral > 0 ? s.neutral / groupNeutral : 0;
    };
    const out: Record<string, TiltNodeResult> = {};
    for (const id of ids) {
      const st = step(id);
      const drivers = p.drivers[id] ?? {};
      const composite = num(st.composite);
      const tilt = num(st.tilt);
      const final = num(st.weight);
      const neutral = neutralOf(id);
      out[id] = {
        composite,
        contributions: (card?.signals ?? []).map((sig) => {
          const score = drivers[sig.key] ?? 50; // core scores a missing signal 50
          return { signalId: sig.key, score, weight: sig.weight, contribution: score * sig.weight };
        }),
        rawTilt: ((composite - 50) / 50) * cap,
        tilt,
        prelim: num(st.prelim),
        final,
        neutral,
        vsNeutralRaw: tilt,
        vsNeutralFinal: final - neutral,
        vetoActive: st.veto === true,
      };
    }
    return out;
  };

  const sectorIds = (p.scorecards.sector?.buckets ?? SECTOR_NODES) as SectorNodeId[];
  const composites = Object.fromEntries(sectorIds.map((id) => [id, num(step(id).composite)])) as Record<SectorNodeId, number>;
  const qualifying = sectorIds.filter((id) => step(id).qualifies === true);
  const held = sectorIds.filter((id) => step(id).held === true);
  const sectorLines = p.sleeves.filter((s) => s.sleeve);
  const sleeve = sectorLines.reduce((sum, s) => sum + s.within_group, 0);

  return {
    groups: {
      l1: { nodes: groupNodes("l1") },
      equity: { nodes: groupNodes("equity") },
      debt: { nodes: groupNodes("debt") },
      metals: { nodes: groupNodes("metals") },
    },
    sector: {
      composites,
      qualifying,
      held,
      sleeve,
      perSector: held.length > 0 ? sleeve / held.length : 0,
      rotatedOut: [],
      sleeveHistory: {},
    },
    rollup: p.sleeves.map((s) => ({
      id: s.node,
      label: NODE_LABELS[s.node as keyof typeof NODE_LABELS] ?? s.node,
      groupWeight: classByNode.get(s.group)?.weight ?? 0,
      withinGroup: s.within_group,
      portfolioWeight: s.weight,
    })),
    total: p.sleeves.reduce((sum, s) => sum + s.weight, 0),
  };
}

/** Each bucket's signal scores, keyed "<node>::<signal>" like the engine's. */
export function scoresFrom(p: PortfolioAllocation): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [node, signals] of Object.entries(p.drivers)) {
    for (const [signal, v] of Object.entries(signals)) {
      if (signal !== "composite") out[`${node}::${signal}`] = v;
    }
  }
  return out;
}

/**
 * The few snapshot fields the calculation inspector reads (scores, tilt
 * caps, as-of date), built from core's run. Score formula traces are not
 * included: they come from core's explain endpoint.
 */
export function inspectorSnapshot(p: PortfolioAllocation): Snapshot {
  const scores = Object.fromEntries(
    Object.entries(scoresFrom(p)).map(([key, value]) => [
      key,
      {
        value,
        provenance: "auto",
        derivedFrom: [],
        transform: "none",
        computedAt: null,
        enteredAt: null,
        staleDays: null,
        note: null,
        confidence: null,
      },
    ]),
  );
  const maxTilt = Object.fromEntries((["l1", "equity", "debt", "metals"] as const).map((g) => [g, p.scorecards[g]?.tilt_cap ?? 0]));
  return { asOf: p.version.as_of, scores, series: {}, vetoes: {}, params: { maxTilt } } as unknown as Snapshot;
}
