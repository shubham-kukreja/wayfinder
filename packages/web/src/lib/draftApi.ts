import type { Params } from "@wayfinder/engine";
import { coreFetch, pathKey } from "./coreApi.js";
import type { PortfolioAllocation } from "./portfolioApi.js";

// The shared draft on core-jobs-service (/v1/draft). Overrides edits it:
// this module maps core's config and risk profile onto the editors' Params
// shape, and turns edited Params back into draft edits.

export interface CoreSignal {
  key: string;
  weight: number;
}

export interface CoreConfig {
  normalisation: string;
  missing_score: number;
  scorecards: Record<string, { parent?: string; buckets: string[]; tilt_cap: number; score_series: string; signals: CoreSignal[] }>;
  sector_satellite?: {
    sectors: string[];
    signals: CoreSignal[];
    sleeve_cap: number;
    max_sectors: number;
    qualify_threshold: number;
    max_quarters_held: number;
  };
  governance: { percentile_window_years: number; percentile_min_observations: number; respect_definition_breaks: boolean };
}

export interface CoreDraft {
  model: string;
  rev: number;
  config: CoreConfig;
  overrides: Array<{ key: string; value: number | boolean | string | null }>;
  risk_profile: { key: string; version: number; neutral_weights: Record<string, number> };
  updated_at: string;
}

export type DraftEdit =
  | { op: "set_param"; path: string; value: number | string | boolean }
  | { op: "set_score"; key: string; value: number }
  | { op: "set_rubric"; key: string; conditions: Record<string, string> }
  | { op: "clear_override"; key: string }
  | { op: "set_neutral"; key: string; value: number };

export interface DraftPreview {
  allocation: Record<string, number>;
  sleeves: Record<string, number>;
  diff_vs_saved: Array<{ node: string; from: number; to: number; delta: number }>;
  portfolio: PortfolioAllocation;
}

export const draftApi = {
  get: () => coreFetch<CoreDraft>("/v1/draft"),
  allocation: () => coreFetch<PortfolioAllocation>("/v1/portfolios/core/allocation?version=draft"),
  evaluate: (rev: number, edits: DraftEdit[], signal?: AbortSignal) =>
    coreFetch<DraftPreview>(
      "/v1/draft/evaluate",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev, edits }) },
      signal,
    ),
  apply: (rev: number, edits: DraftEdit[], reason: string) =>
    coreFetch<{ rev: number }>("/v1/draft", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rev, edits, reason }),
    }),
  fragility: (perturbation = 0.1) =>
    coreFetch<{ perturbation: number; rollups: Array<{ node: string; min: number; max: number; range_pp: number }> }>("/v1/signals/fragility", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perturbation }),
    }),
  sensitivity: () => coreFetch<{ rows: Array<{ key: string; impact_pp: number }> }>("/v1/signals/sensitivity?limit=200"),
};

const TILT_GROUPS = ["l1", "equity", "debt", "metals"] as const;

/** Core's draft as the editors' Params. */
export function toParams(d: CoreDraft): Params {
  const c = d.config;
  const nw = d.risk_profile.neutral_weights;
  const weights = (signals: CoreSignal[] | undefined) => Object.fromEntries((signals ?? []).map((s) => [s.key, s.weight]));
  const neutral = (g: string) => Object.fromEntries((c.scorecards[g]?.buckets ?? []).map((b) => [b, nw[b] ?? 0]));
  const sat = c.sector_satellite;
  return {
    signalWeights: {
      l1: weights(c.scorecards.l1?.signals),
      equity: weights(c.scorecards.equity?.signals),
      debt: weights(c.scorecards.debt?.signals),
      metals: weights(c.scorecards.metals?.signals),
      sector: weights(sat?.signals),
    },
    neutralWeights: { l1: neutral("l1"), equity: neutral("equity"), debt: neutral("debt"), metals: neutral("metals") },
    maxTilt: Object.fromEntries(TILT_GROUPS.map((g) => [g, c.scorecards[g]?.tilt_cap ?? 0])),
    sector: {
      sleeveCap: sat?.sleeve_cap ?? 0,
      maxSectors: sat?.max_sectors ?? 0,
      threshold: sat?.qualify_threshold ?? 0,
      maxConsecutiveQuarters: sat?.max_quarters_held ?? 0,
    },
    normalisation: c.normalisation,
    percentileWindowYears: c.governance?.percentile_window_years ?? 0,
    percentileMinObservations: c.governance?.percentile_min_observations ?? 0,
    respectDefinitionBreaks: c.governance?.respect_definition_breaks ?? false,
  } as unknown as Params;
}

const changed = (a: number | string | undefined, b: number | string | undefined) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b;

/** The draft edits that turn base into next (both from toParams of d). */
export function paramEdits(d: CoreDraft, base: Params, next: Params): DraftEdit[] {
  const out: DraftEdit[] = [];
  const c = d.config;
  const sw = (p: Params, g: string) => (p.signalWeights as unknown as Record<string, Record<string, number>>)[g] ?? {};
  for (const g of TILT_GROUPS) {
    (c.scorecards[g]?.signals ?? []).forEach((s, i) => {
      if (changed(sw(base, g)[s.key], sw(next, g)[s.key])) {
        out.push({ op: "set_param", path: `/scorecards/${g}/signals/${i}/weight`, value: sw(next, g)[s.key] ?? 0 });
      }
    });
    if (changed(base.maxTilt[g], next.maxTilt[g])) out.push({ op: "set_param", path: `/scorecards/${g}/tilt_cap`, value: next.maxTilt[g] });
    const bn = (base.neutralWeights as unknown as Record<string, Record<string, number>>)[g] ?? {};
    const nn = (next.neutralWeights as unknown as Record<string, Record<string, number>>)[g] ?? {};
    for (const node of Object.keys(nn)) {
      if (changed(bn[node], nn[node])) out.push({ op: "set_neutral", key: node, value: nn[node] ?? 0 });
    }
  }
  (c.sector_satellite?.signals ?? []).forEach((s, i) => {
    if (changed(sw(base, "sector")[s.key], sw(next, "sector")[s.key])) {
      out.push({ op: "set_param", path: `/sector_satellite/signals/${i}/weight`, value: sw(next, "sector")[s.key] ?? 0 });
    }
  });
  const sectorPaths: Array<[keyof Params["sector"], string]> = [
    ["sleeveCap", "sleeve_cap"],
    ["maxSectors", "max_sectors"],
    ["threshold", "qualify_threshold"],
    ["maxConsecutiveQuarters", "max_quarters_held"],
  ];
  for (const [k, path] of sectorPaths) {
    if (changed(base.sector[k], next.sector[k])) out.push({ op: "set_param", path: `/sector_satellite/${path}`, value: next.sector[k] });
  }
  if (base.normalisation !== next.normalisation) out.push({ op: "set_param", path: "/normalisation", value: next.normalisation });
  return out;
}

// ---- rubrics (GET /v1/rubrics/{key}) ----

export interface CoreRubric {
  key: string;
  base: number;
  clamp: number[] | null;
  conditions: Array<{ id: string; series: string; label: string; options: Array<{ id: string; add: number }> }>;
  current: { score: number; answered_at: string; stale_days: number; answers: Record<string, string> } | null;
}

export const rubricApi = {
  get: (key: string) => coreFetch<CoreRubric>(`/v1/rubrics/${pathKey(key)}`),
};

/** A rubric's score for these answers: base + points, clamped. Null until every condition is answered. */
export function rubricScore(r: CoreRubric, answers: Record<string, string>): number | null {
  let v = r.base;
  for (const c of r.conditions) {
    const opt = c.options.find((o) => o.id === answers[c.id]);
    if (!opt) return null;
    v += opt.add;
  }
  if (r.clamp && r.clamp.length === 2) v = Math.max(r.clamp[0]!, Math.min(r.clamp[1]!, v));
  return v;
}
