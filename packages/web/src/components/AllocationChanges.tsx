import type { Allocation } from "@wayfinder/engine";
import { formatSignedPct } from "../lib/format.js";
import { segmentSwatchStyle } from "./AllocationBar.js";

// Live-vs-draft, not draft-vs-policy-neutral: AllocationBar's own
// compare="neutral" mode answers "how far is this from policy", which is a
// different question from "what would saving this draft actually change".
// This card answers the second one, so a reviewer can see the effect of an
// unsaved edit before committing to it.
const MIN_VISIBLE_DELTA = 0.0005;

const L1_LABELS: Record<string, string> = { "l1.equity": "Equity", "l1.debt": "Debt", "l1.metals": "Metals" };

export function AllocationChanges({ live, draft, depth }: { live: Allocation; draft: Allocation; depth: "overview" | "detail" }) {
  const rows =
    depth === "overview"
      ? (["l1.equity", "l1.debt", "l1.metals"] as const)
          .map((id) => ({ id, label: L1_LABELS[id]!, draftWeight: draft.groups.l1.nodes[id]!.final, liveWeight: live.groups.l1.nodes[id]!.final }))
          .map((row) => ({ ...row, delta: row.draftWeight - row.liveWeight }))
          .filter((row) => Math.abs(row.delta) > MIN_VISIBLE_DELTA)
      : (() => {
          const liveById = new Map(live.rollup.map((r) => [r.id, r]));
          return draft.rollup
            .map((r) => ({ id: r.id, label: r.label, draftWeight: r.portfolioWeight, liveWeight: liveById.get(r.id)?.portfolioWeight ?? 0 }))
            .map((row) => ({ ...row, delta: row.draftWeight - row.liveWeight }))
            .filter((row) => Math.abs(row.delta) > MIN_VISIBLE_DELTA);
        })();
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return (
    <div className="border border-line bg-paper">
      <div className="border-b border-line bg-paper-2 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-ink">What this draft changes</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">No difference from the saved allocation yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0" style={segmentSwatchStyle(row.id, draft)} />
                <span className="truncate text-ink-2">{row.label}</span>
              </span>
              <span className={`shrink-0 font-mono tabular-nums font-medium ${row.delta > 0 ? "text-brand-800" : "text-danger-500"}`}>
                {formatSignedPct(row.delta, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
