import { useEffect, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { snapshotSchema } from "@wayfinder/engine";

export interface UseSnapshotResult {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  fallbackUsed: boolean;
}

// M3: loads a static fixture over fetch(). Phase 6+ swaps the URL for the
// real GET /api/snapshot endpoint — the shape (a validated Snapshot) does
// not change, so this hook's callers don't need to change either.
export function useSnapshot(url = "/snapshot.json", fallbackUrl?: string): UseSnapshotResult {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFallbackUsed(false);

    const load = async (targetUrl: string): Promise<Snapshot> => {
      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error(`Failed to load snapshot: ${res.status}`);
      const raw = await res.json();
      const result = snapshotSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`Snapshot failed schema validation: ${result.error.issues[0]?.message ?? "unknown error"}`);
      }
      return result.data as Snapshot;
    };

    load(url)
      .catch(async (err) => {
        if (!fallbackUrl) throw err;
        const fallback = await load(fallbackUrl);
        if (!cancelled) setFallbackUsed(true);
        return fallback;
      })
      .then((res) => {
        if (cancelled) return;
        setSnapshot(res);
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
  }, [url, fallbackUrl]);

  return { snapshot, loading, error, fallbackUsed };
}
