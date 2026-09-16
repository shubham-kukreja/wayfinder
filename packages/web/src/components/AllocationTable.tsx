import type { Allocation } from "@wayfinder/engine";
import { formatPct } from "../lib/format.js";

export function AllocationTable({ allocation }: { allocation: Allocation }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left text-muted">
          <th className="py-2 font-medium">Line item</th>
          <th className="py-2 text-right font-medium">Weight</th>
        </tr>
      </thead>
      <tbody>
        {allocation.rollup.map((r) => (
          <tr key={r.id} className="border-b border-paper-2">
            <td className="py-2 text-ink-2">{r.label}{r.id.startsWith("sleeve.") ? " (sleeve)" : ""}</td>
            <td className="py-2 text-right font-medium tabular-nums text-ink">{formatPct(r.portfolioWeight)}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-2 font-semibold text-ink">Total</td>
          <td className="pt-2 text-right font-semibold tabular-nums text-ink">{formatPct(allocation.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
