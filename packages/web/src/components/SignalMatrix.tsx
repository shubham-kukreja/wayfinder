import { NODE_LABELS } from "@wayfinder/engine";
import { formatScore } from "../lib/format.js";
import { SIGNAL_LABELS } from "../lib/signalLabels.js";

// §14 of the UX spec ("Signal Matrix") - replaces spreadsheet-style input
// blocks with a compact, interactive matrix: rows are signals, columns are the
// nodes in that group. Each cell is a small inline bar (not a giant colored
// heatmap tile, per the spec's explicit preference), clickable to open
// CalculationInspector with that exact node::signal selected.

function nodeLabel(nodeId: string): string {
  return (NODE_LABELS as Record<string, string>)[nodeId] ?? nodeId;
}

// Color used sparingly, only for meaningful extremes (spec's own instruction)
// - most cells stay neutral, only genuinely attractive/unattractive scores get
// a tint.
function cellTone(value: number): string {
  if (value >= 70) return "bg-brand-500";
  if (value >= 58) return "bg-brand-200";
  if (value <= 30) return "bg-danger-500";
  if (value <= 42) return "bg-danger-200";
  return "bg-line";
}

// Squared-off track, taller than a hairline so the fill is readable at a
// glance, with a neutral marker at 50: a score's distance from that midpoint is
// what actually drives a tilt, so the bar shows where it sits rather than only
// how long it is.
function InlineBar({ value }: { value: number }) {
  return (
    <div className="relative h-2.5 w-full min-w-[56px] overflow-hidden bg-paper-2">
      <span className={`block h-full ${cellTone(value)}`} style={{ width: `${value}%` }} />
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/25" aria-hidden="true" />
    </div>
  );
}

export function SignalMatrix({
  title,
  signals,
  nodes,
  scores,
  composites,
  weights,
  onSelect,
}: {
  title: string;
  signals: readonly string[];
  nodes: readonly string[];
  scores: Record<string, number>;
  composites: Record<string, number>;
  weights?: Record<string, number>;
  onSelect: (nodeSignalId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th className="w-40 py-2 text-[11px] font-bold uppercase tracking-eyebrow text-muted">Signal</th>
            {weights && (
              <th className="w-16 py-2 text-right text-[11px] font-bold uppercase tracking-eyebrow text-muted">Weight</th>
            )}
            {nodes.map((nodeId) => (
              <th key={nodeId} className="py-2 text-right text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                {nodeLabel(nodeId)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal} className="border-b border-line last:border-b-0">
              <td className="py-3 pr-4 text-[13px] text-ink-2">{SIGNAL_LABELS[signal] ?? signal}</td>
              {weights && (
                <td className="py-3 pr-4 text-right text-[12px] tabular-nums text-muted">
                  {weights[signal] !== undefined ? `×${weights[signal]!.toFixed(2)}` : "—"}
                </td>
              )}
              {nodes.map((nodeId) => {
                const value = scores[`${nodeId}::${signal}`] ?? 50;
                // What this signal actually pushes into the composite: its
                // distance from neutral, scaled by the policy weight.
                const push = weights?.[signal] !== undefined ? (value - 50) * weights[signal]! : null;
                return (
                  <td key={nodeId} className="py-3 pl-4">
                    <button
                      type="button"
                      onClick={() => onSelect(`${nodeId}::${signal}`)}
                      className="flex w-full flex-col items-stretch gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors duration-100 ease-in hover:bg-paper-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      title={`${nodeLabel(nodeId)} · ${SIGNAL_LABELS[signal] ?? signal}: ${formatScore(value)} — click for calculation detail`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold tabular-nums text-ink">{formatScore(value)}</span>
                        {push !== null && (
                          <span
                            className={`text-[11px] tabular-nums ${
                              push > 0.2 ? "text-brand-800" : push < -0.2 ? "text-danger-500" : "text-muted"
                            }`}
                          >
                            {push >= 0 ? "+" : ""}
                            {push.toFixed(1)}
                          </span>
                        )}
                      </span>
                      <InlineBar value={value} />
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          {/* A hairline in the same weight as the row dividers, with extra
              padding above it — the composite reads as a summary of the rows
              rather than as a rule cutting the table in half. */}
          <tr className="border-t border-line">
            <td className="pb-1 pr-4 pt-5 text-[13px] font-semibold text-ink">Composite</td>
            {weights && <td className="pb-1 pt-5" />}
            {nodes.map((nodeId) => (
              <td key={nodeId} className="pb-1 pl-4 pt-5">
                <button
                  type="button"
                  onClick={() => onSelect(nodeId)}
                  className="w-full rounded-sm px-1.5 py-1 text-right text-[15px] font-bold tabular-nums text-ink transition-colors duration-100 ease-in hover:bg-paper-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  title={`${nodeLabel(nodeId)} composite — click for full breakdown`}
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
