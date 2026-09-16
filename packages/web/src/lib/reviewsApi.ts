import type { Snapshot } from "@wayfinder/engine";
import { API_BASE_URL } from "./constants.js";
import { apiFetch, apiFetchJson } from "./apiFetch.js";

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

export async function listReviews(): Promise<ReviewListItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots`);
  if (!res.ok) throw new Error(`Failed to list reviews: ${res.status}`);
  return res.json();
}

export async function saveReview(
  label: string | null,
  reason?: string
): Promise<{ id: string; label: string | null; createdAt: string }> {
  const res = await apiFetchJson("/api/snapshots", "POST", { label: label ?? undefined, reason });
  if (!res.ok) throw new Error(`Failed to save review: ${res.status}`);
  return res.json();
}

// `fromSnapshotId` promotes an existing saved review to published, freezing
// exactly the state that was reviewed. Omitted, it publishes current state.
export async function publishReview(label: string | null, reason?: string, fromSnapshotId?: string): Promise<{
  id: string;
  label: string | null;
  parentId: string | null;
  actor: string;
  createdAt: string;
  reason: string | null;
  diff: { totalChanges: number; changedScores: unknown[]; changedVetoes: unknown[]; paramsChanged: boolean };
}> {
  const res = await apiFetchJson("/api/snapshots/publish", "POST", { label: label ?? undefined, reason, fromSnapshotId });
  if (!res.ok) throw new Error(`Failed to publish review: ${res.status}`);
  return res.json();
}

export interface DraftStatus {
  hasPublishedVersion: boolean;
  latestPublishedId: string | null;
  draftAsOf: string;
  diff: { totalChanges: number; changedScores: Array<{ id: string; before: number | null; after: number; provenance: string }>; changedVetoes: Array<{ id: string; before: boolean | null; after: boolean }>; paramsChanged: boolean };
}

export async function getDraftStatus(): Promise<DraftStatus> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots/draft-status`);
  if (!res.ok) throw new Error(`Failed to load draft status: ${res.status}`);
  return res.json();
}

export interface SnapshotDiff {
  from: string | null;
  to: string;
  diff: DraftStatus["diff"];
  // Enough of each snapshot to recompute its allocation locally, so the
  // comparison can show what the changed inputs did to the portfolio and
  // not just which inputs moved.
  before: Pick<Snapshot, "asOf" | "scores" | "vetoes" | "params"> | null;
  after: Pick<Snapshot, "asOf" | "scores" | "vetoes" | "params">;
}

// Diffs any two saved entries. Either id may be the literal "draft" to
// compare against the current unsaved state; `from` may be omitted to
// diff an entry against nothing.
export async function getSnapshotDiff(to: string, from?: string | null): Promise<SnapshotDiff> {
  const params = new URLSearchParams({ to });
  if (from) params.set("from", from);
  const res = await fetch(`${API_BASE_URL}/api/snapshots/diff?${params}`);
  if (!res.ok) throw new Error(`Failed to compare versions: ${res.status}`);
  return res.json();
}

// "Load" a review means viewing its frozen state read-only — reviews
// are immutable by design, so this never mutates the live/draft state.
export async function getReview(id: string): Promise<Snapshot> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots/${id}`);
  if (!res.ok) throw new Error(`Failed to load review: ${res.status}`);
  return res.json();
}

// Restores the draft to a saved entry's authored inputs — params and manual
// overrides. Auto-derived scores are re-derived from the stored observations
// rather than written back, and observations themselves are untouched.
export async function revertToSnapshot(id: string): Promise<{
  revertedTo: string;
  restoredManualScores: number;
  restoredManualVetoes: number;
}> {
  const res = await apiFetchJson(`/api/snapshots/${id}/revert`, "POST", {});
  if (!res.ok) throw new Error(`Failed to revert: ${res.status}`);
  return res.json();
}

// Any saved entry (review or published version) can be deleted, per
// this project's own decision — no special-casing published rows.
export async function deleteReview(id: string): Promise<void> {
  const res = await apiFetch(`/api/snapshots/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete review: ${res.status}`);
}
