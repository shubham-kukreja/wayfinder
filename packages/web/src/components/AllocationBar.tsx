import type { Allocation } from "@wayfinder/engine";
import { formatPct } from "../lib/format.js";

// §12.2: stacked proportional bar, not sunburst/donut — angular comparison
// at 2.5% vs 2.4% is unreadable and precision matters more than novelty
// here. The sector sleeve must read as visibly carved out of equity, not
// as a peer segment.
const SEGMENT_COLORS: Record<string, string> = {
  "equity.large": "#1d4ed8",
  "equity.mid": "#3b82f6",
  "equity.small": "#60a5fa",
  "equity.intl": "#93c5fd",
  "debt.liquid": "#15803d",
  "debt.corporate": "#22c55e",
  "debt.gilt": "#86efac",
  "metals.gold": "#b45309",
  "metals.silver": "#d1d5db",
};
const SLEEVE_COLOR = "#7c3aed";

export function AllocationBar({ allocation }: { allocation: Allocation }) {
  return (
    <div>
      <div className="flex h-10 w-full overflow-hidden rounded-md border border-neutral-200">
        {allocation.rollup.map((r) => {
          const isSleeve = r.id.startsWith("sleeve.");
          const color = isSleeve ? SLEEVE_COLOR : SEGMENT_COLORS[r.id] ?? "#9ca3af";
          return (
            <div
              key={r.id}
              style={{ width: `${r.portfolioWeight * 100}%`, backgroundColor: color }}
              className={isSleeve ? "border-x border-dashed border-white/60" : ""}
              title={`${r.label}: ${formatPct(r.portfolioWeight)}`}
            />
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {allocation.rollup.map((r) => {
          const isSleeve = r.id.startsWith("sleeve.");
          const color = isSleeve ? SLEEVE_COLOR : SEGMENT_COLORS[r.id] ?? "#9ca3af";
          return (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
              <span className="text-neutral-600">{r.label}{isSleeve ? " (sleeve)" : ""}</span>
              <span className="ml-auto font-medium tabular-nums text-neutral-900">{formatPct(r.portfolioWeight)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
