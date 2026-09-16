import type { NodeId } from "@wayfinder/engine";
import { NODE_LABELS } from "@wayfinder/engine";
import { formatScore } from "../lib/format.js";

// §14 of the UX spec ("Signal Matrix") - replaces spreadsheet-style
// input blocks with a compact, interactive matrix: rows are signals
// (valuation/macro/fundamentals/flows/momentum for L1, or the
// segment-specific signal set for L2), columns are the nodes in that
// group. Each cell is a small inline bar (not a giant colored heatmap
// tile, per the spec's explicit preference), clickable to open
// CalculationInspector with that exact node::signal selected.
const SIGNAL_LABELS: Record<string, string> = {
  valuation: "Valuation",
  macro: "Macro",
  fundamentals: "Fundamentals",
  flows: "Flows",
  momentum: "Momentum",
  relvalue: "Relative value",
  revisions: "Revisions",
  growth_diff: "Growth differential",
  margin_cycle: "Margin / cycle",
  carry: "Carry",
  rate_cycle: "Rate cycle",
  spread_cushion: "Spread cushion",
  liquidity: "Liquidity",
  ratio_position: "Ratio positioning",
  real_rates: "Real rates",
  industrial: "Industrial demand",
};

// Color used sparingly, only for meaningful extremes (spec's own
// instruction) - most cells stay neutral gray, only genuinely
// attractive/unattractive scores get a tint.
function cellTone(value: number): string {
  if (value >= 70) return "bg-brand-500";
  if (value >= 58) return "bg-brand-300";
  if (value <= 30) return "bg-danger-500";
  if (value <= 42) return "bg-danger-500/50";
  return "bg-neutral-300";
}

function InlineBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-neutral-900">{formatScore(value)}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-100">
        <span className={`block h-full rounded-full ${cellTone(value)}`} style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}

export function SignalMatrix({
  title,
  signals,
  nodes,
  scores,
  composites,
  onSelect,
}: {
  title: string;
  signals: readonly string[];
  nodes: readonly NodeId[];
  scores: Record<string, number>;
  composites: Partial<Record<NodeId, number>>;
  onSelect: (nodeSignalId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400">
            <th className="py-2 font-medium">Signal</th>
            {nodes.map((nodeId) => (
              <th key={nodeId} className="py-2 text-right font-medium">
                {NODE_LABELS[nodeId]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal} className="border-b border-neutral-100 last:border-0">
              <td className="py-2.5 text-neutral-700">{SIGNAL_LABELS[signal] ?? signal}</td>
              {nodes.map((nodeId) => {
                const value = scores[`${nodeId}::${signal}`] ?? 50;
                return (
                  <td key={nodeId} className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onSelect(`${nodeId}::${signal}`)}
                      className="ml-auto rounded-md px-1.5 py-1 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
                      title={`${NODE_LABELS[nodeId]} · ${SIGNAL_LABELS[signal] ?? signal}: ${formatScore(value)} — click for calculation detail`}
                    >
                      <InlineBar value={value} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="py-2.5 font-semibold text-neutral-900">Composite</td>
            {nodes.map((nodeId) => (
              <td key={nodeId} className="py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => onSelect(nodeId)}
                  className="ml-auto rounded-md px-1.5 py-1 font-semibold tabular-nums text-neutral-950 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
                  title={`${NODE_LABELS[nodeId]} composite — click for full breakdown`}
                >
                  {formatScore(composites[nodeId] ?? 50)}
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
