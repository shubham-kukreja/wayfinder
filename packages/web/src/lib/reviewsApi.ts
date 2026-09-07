import { API_BASE_URL } from "./constants.js";

export interface ReviewListItem {
  id: string;
  label: string | null;
  createdAt: string;
  isReview: boolean;
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
