import type { Snapshot } from "@wayfinder/engine";
import { API_BASE_URL } from "./constants.js";

export interface ReviewListItem {
  id: string;
  label: string | null;
  createdAt: string;
  isReview: boolean;
  parentId: string | null;
  published: boolean;
  actor: string | null;
}

export async function listReviews(): Promise<ReviewListItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots`);
  if (!res.ok) throw new Error(`Failed to list reviews: ${res.status}`);
  return res.json();
}

export async function saveReview(label: string | null): Promise<{ id: string; label: string | null; createdAt: string }> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label ?? undefined }),
  });
  if (!res.ok) throw new Error(`Failed to save review: ${res.status}`);
  return res.json();
}

export async function publishReview(label: string | null, reason?: string): Promise<{
  id: string;
  label: string | null;
  parentId: string | null;
  actor: string;
  createdAt: string;
  reason: string | null;
  diff: { totalChanges: number; changedScores: unknown[]; changedVetoes: unknown[]; paramsChanged: boolean };
}> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: label ?? undefined, reason }),
  });
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

// "Load" a review means viewing its frozen state read-only — reviews
// are immutable by design, so this never mutates the live/draft state.
export async function getReview(id: string): Promise<Snapshot> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots/${id}`);
  if (!res.ok) throw new Error(`Failed to load review: ${res.status}`);
  return res.json();
}

// Any saved entry (review or published version) can be deleted, per
// this project's own decision — no special-casing published rows.
export async function deleteReview(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/snapshots/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete review: ${res.status}`);
}
