import type { Snapshot } from "@wayfinder/engine";

function formatAsOf(asOf: string): string {
  const d = new Date(asOf);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function StateSummary({ snapshot }: { snapshot: Snapshot }) {
  const staleCount = Object.values(snapshot.series).filter((s) => s.status === "stale" || s.status === "failed").length;
  const activeVetoes = Object.values(snapshot.vetoes).filter((v) => v.active).length;
  const qualifyingSectors = snapshot.allocation.sector.held.length;

  const parts: string[] = [`Data current as of ${formatAsOf(snapshot.asOf)}`];
  if (staleCount > 0) parts.push(`${staleCount} score${staleCount === 1 ? "" : "s"} stale`);
  if (activeVetoes > 0) parts.push(`${activeVetoes} veto${activeVetoes === 1 ? "" : "es"} active`);
  parts.push(qualifyingSectors > 0 ? `${qualifyingSectors} sector${qualifyingSectors === 1 ? "" : "s"} qualifying` : "no sectors qualifying");

  return <p className="text-sm text-neutral-500">{parts.join(" · ")}</p>;
}
