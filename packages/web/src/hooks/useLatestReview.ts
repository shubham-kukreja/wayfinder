import { useEffect, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { snapshotSchema } from "@wayfinder/engine";
import { API_BASE_URL } from "../lib/constants.js";
import { listReviews } from "../lib/reviewsApi.js";

export function useLatestReview(): { review: Snapshot | null; loading: boolean } {
  const [review, setReview] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listReviews()
      .then(async (reviews) => {
        const latest = reviews.find((r) => r.isReview);
        if (!latest) return null;
        const res = await fetch(`${API_BASE_URL}/api/snapshots/${latest.id}`);
        if (!res.ok) return null;
        const raw = await res.json();
        const parsed = snapshotSchema.safeParse(raw);
        return parsed.success ? (parsed.data as Snapshot) : null;
      })
      .then((snapshot) => {
        if (!cancelled) setReview(snapshot);
      })
      .catch(() => {
        if (!cancelled) setReview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { review, loading };
}
