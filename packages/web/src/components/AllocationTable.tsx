import type { Allocation } from "@wayfinder/engine";
import { formatPct } from "../lib/format.js";

export function AllocationTable({ allocation }: { allocation: Allocation }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-2 font-medium">Line item</th>
          <th className="py-2 text-right font-medium">Weight</th>
        </tr>
      </thead>
      <tbody>
        {allocation.rollup.map((r) => (
          <tr key={r.id} className="border-b border-neutral-100">
            <td className="py-2 text-neutral-800">{r.label}{r.id.startsWith("sleeve.") ? " (sleeve)" : ""}</td>
            <td className="py-2 text-right font-medium tabular-nums text-neutral-900">{formatPct(r.portfolioWeight)}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-2 font-semibold text-neutral-900">Total</td>
          <td className="pt-2 text-right font-semibold tabular-nums text-neutral-900">{formatPct(allocation.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
