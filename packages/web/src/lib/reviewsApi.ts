import type { Allocation } from "@wayfinder/engine";
import { coreFetch, CoreApiError } from "./coreApi.js";
import { toAllocation, type PortfolioAllocation } from "./portfolioApi.js";

// Saved reviews and published versions on core-jobs-service: /v1/versions
// (list, save, publish, delete, revert) and /v1/versions/compare. The types
// are the ones the governance screens were built on; this module maps
// core's records onto them.

export interface ReviewListItem {
  id: string;
  label: string | null;
  createdAt: string;
  isReview: boolean;
  parentId: string | null;
  published: boolean;
  actor: string | null;
  reason: string | null;
}

interface CoreVersion {
  id: string;
  kind: "review" | "published";
  status: "active" | "superseded" | "saved";
  label: string | null;
  reason: string | null;
  as_of: string;
  created_by: { id: string; name: string } | null;
  created_at: string;
  published_at: string | null;
}

interface CoreCreated {
  id: string;
  kind: "review" | "published";
  status: string;
  frozen_inputs?: number;
  superseded?: string | null;
}

type Value = number | boolean | string | null;

interface CoreComparison {
  totals: { changes: number; scores: number; vetoes: number; parameters: number };
  allocation_moves: Array<{ node: string; from: number; to: number; delta: number }>;
  inputs: Array<{ key: string; kind: "score" | "veto" | "parameter"; source?: string; from?: Value; to?: Value }>;
}

const toItem = (v: CoreVersion): ReviewListItem => ({
  id: v.id,
  label: v.label,
  createdAt: v.created_at,
  isReview: v.kind === "review",
  parentId: null,
  published: v.kind === "published",
  actor: v.created_by?.name ?? null,
  reason: v.reason,
});

export async function listReviews(): Promise<ReviewListItem[]> {
  const res = await coreFetch<{ data: CoreVersion[] }>("/v1/versions?limit=100");
  return res.data.map(toItem);
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function saveReview(label: string | null, reason?: string): Promise<{ id: string; label: string | null; createdAt: string }> {
  const res = await coreFetch<CoreCreated>("/v1/versions", json({ kind: "review", label: label ?? undefined, reason }));
  return { id: res.id, label, createdAt: new Date().toISOString() };
}

export interface DiffSummary {
  totalChanges: number;
  changedScores: Array<{ id: string; before: number | null; after: number; provenance: string }>;
  changedVetoes: Array<{ id: string; before: boolean | null; after: boolean }>;
  paramsChanged: boolean;
}

function toDiff(c: CoreComparison): DiffSummary {
  const scores: DiffSummary["changedScores"] = [];
  const vetoes: DiffSummary["changedVetoes"] = [];
  for (const i of c.inputs) {
    if (i.kind === "score" && typeof i.to === "number") {
      scores.push({ id: i.key, before: typeof i.from === "number" ? i.from : null, after: i.to, provenance: i.source ?? "auto" });
    } else if (i.kind === "veto") {
      vetoes.push({ id: i.key, before: typeof i.from === "boolean" ? i.from : null, after: i.to === true });
    }
  }
  return { totalChanges: c.totals.changes, changedScores: scores, changedVetoes: vetoes, paramsChanged: c.totals.parameters > 0 };
}

async function compare(a: string, b: string): Promise<CoreComparison> {
  return coreFetch<CoreComparison>(`/v1/versions/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
}

// Nothing published yet: everything is compared against neutral.
async function compareWithPublished(b: string): Promise<{ hasPublished: boolean; c: CoreComparison }> {
  try {
    return { hasPublished: true, c: await compare("published", b) };
  } catch (err) {
    if (!(err instanceof CoreApiError && err.status === 404)) throw err;
    return { hasPublished: false, c: await compare("neutral", b) };
  }
}

// `fromSnapshotId` promotes an existing saved review to published, freezing
// exactly the state that was reviewed. Omitted, it publishes the draft.
export async function publishReview(
  label: string | null,
  reason?: string,
  fromSnapshotId?: string,
): Promise<{ id: string; label: string | null; diff: DiffSummary }> {
  const { c } = await compareWithPublished(fromSnapshotId ?? "draft");
  const res = fromSnapshotId
    ? await coreFetch<CoreCreated>(`/v1/versions/${encodeURIComponent(fromSnapshotId)}/publish`, { method: "POST" })
    : await coreFetch<CoreCreated>("/v1/versions", json({ kind: "published", label: label ?? undefined, reason }));
  return { id: res.id, label, diff: toDiff(c) };
}

export interface DraftStatus {
  hasPublishedVersion: boolean;
  latestPublishedId: string | null;
  draftAsOf: string;
  diff: DiffSummary;
}

export async function getDraftStatus(): Promise<DraftStatus> {
  const { hasPublished, c } = await compareWithPublished("draft");
  return { hasPublishedVersion: hasPublished, latestPublishedId: null, draftAsOf: new Date().toISOString().slice(0, 10), diff: toDiff(c) };
}

export interface SnapshotDiff {
  from: string | null;
  to: string;
  diff: DiffSummary;
  /** False when `from` is nothing (a first publish): no allocation moves. */
  hasBefore: boolean;
  /** The `to` side's allocation. */
  after: Allocation;
  /** Sleeve weight moves from `from` to `to`, as 0–1 fractions. */
  moves: Array<{ id: string; before: number; after: number; delta: number }>;
}

async function allocationOf(ref: string): Promise<PortfolioAllocation> {
  return coreFetch<PortfolioAllocation>(`/v1/portfolios/core/allocation?version=${encodeURIComponent(ref)}`);
}

// Diffs any two entries. Either id may be "draft" (the current unsaved
// state); `from` may be omitted to diff an entry against nothing.
export async function getSnapshotDiff(to: string, from?: string | null): Promise<SnapshotDiff> {
  const [c, after] = await Promise.all([compare(from ?? "neutral", to), allocationOf(to)]);
  return {
    from: from ?? null,
    to,
    diff: toDiff(c),
    hasBefore: Boolean(from),
    after: toAllocation(after),
    moves: c.allocation_moves.map((m) => ({ id: m.node, before: m.from, after: m.to, delta: m.delta })),
  };
}

export interface FrozenReview {
  allocation: Allocation;
  vetoes: Array<{ node: string; source: string }>;
}

// "Load" a review means viewing its frozen state read-only — versions are
// immutable, so this never touches the draft.
export async function getReview(id: string): Promise<FrozenReview> {
  const data = await allocationOf(id);
  return { allocation: toAllocation(data), vetoes: data.vetoes };
}

// Restores the draft to a saved entry's parameters and manual scores;
// auto-fetched scores stay live.
export async function revertToSnapshot(id: string): Promise<{ revertedTo: string; restoredManualScores: number; restoredManualVetoes: number }> {
  const res = await coreFetch<{ rev: number; compare: CoreComparison }>(`/v1/versions/${encodeURIComponent(id)}/revert`, json({ mode: "manual_and_params" }));
  return { revertedTo: id, restoredManualScores: res.compare.totals.scores, restoredManualVetoes: res.compare.totals.vetoes };
}

// Any saved entry can be deleted except the active published version.
export async function deleteReview(id: string): Promise<void> {
  try {
    await coreFetch(`/v1/versions/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof CoreApiError && err.status === 404)) throw err;
  }
}
