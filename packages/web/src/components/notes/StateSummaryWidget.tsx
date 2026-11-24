import { useEffect, useState } from "react";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
import { coreFetch } from "../../lib/coreApi.js";

// One line: data freshness, active vetoes, qualifying sectors — the model's
// state from core, dropped into a note as a quick "what shape was the model
// in" check without a chart's visual weight.
export function StateSummaryWidget() {
  const { data, allocation, loading, error } = useCoreAllocation();
  const [stale, setStale] = useState<number | null>(null);
  useEffect(() => {
    coreFetch<{ totals: { by_freshness?: Record<string, number> } }>("/v1/registry")
      .then((r) => setStale(r.totals.by_freshness?.stale ?? 0))
      .catch(() => setStale(null));
  }, []);

  if (error) return <p className="text-xs text-muted">Model state unavailable: {error}</p>;
  if (loading || !data || !allocation) return <div className="h-5 w-full animate-pulse bg-paper-2" />;

  const asOf = new Date(`${data.version.as_of}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const parts = [`Data current as of ${asOf}`];
  if (stale) parts.push(`${stale} score${stale === 1 ? "" : "s"} stale`);
  if (data.vetoes.length > 0) parts.push(`${data.vetoes.length} veto${data.vetoes.length === 1 ? "" : "es"} active`);
  const held = allocation.sector.held.length;
  parts.push(held > 0 ? `${held} sector${held === 1 ? "" : "s"} qualifying` : "no sectors qualifying");
  return <p className="text-[13px] text-ink-2">{parts.join(" · ")}</p>;
}
