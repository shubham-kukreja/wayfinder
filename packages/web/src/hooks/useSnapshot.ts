import { useEffect, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { snapshotSchema } from "@wayfinder/engine";

export interface UseSnapshotResult {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
}

// M3: loads a static fixture over fetch(). Phase 6+ swaps the URL for the
// real GET /api/snapshot endpoint — the shape (a validated Snapshot) does
// not change, so this hook's callers don't need to change either.
export function useSnapshot(url = "/snapshot.json"): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load snapshot: ${res.status}`);
        return res.json();
      })
      .then((raw) => {
        if (cancelled) return;
        const result = snapshotSchema.safeParse(raw);
        if (!result.success) {
          throw new Error(`Snapshot failed schema validation: ${result.error.issues[0]?.message ?? "unknown error"}`);
        }
        setSnapshot(result.data as Snapshot);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { snapshot, loading, error };
}
