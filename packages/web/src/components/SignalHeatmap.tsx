import { formatScore } from "../lib/format.js";

// Signals x asset classes as a tile grid, shaded on a single green ramp from
// the score in each cell.
export interface HeatmapCell {
  nodeId: string;
  signalId: string;
  score: number;
}

// One ramp built off the brand green (#3ECF5F), every stop sharing its exact
// hue so the grid reads as part of the product rather than as a stray chart
// palette. Darker means a stronger score. A single hue can't separate low from
// high by colour alone, so the score stays printed in every cell and the tint
// carries only the at-a-glance pattern.
const BANDS = [
  { min: 70, fill: "#2BAB48", text: "text-ink", label: "70+" },
  { min: 58, fill: "#4BD26A", text: "text-ink", label: "58–69" },
  { min: 43, fill: "#8DE2A0", text: "text-ink", label: "43–57" },
  { min: 30, fill: "#C6F1D0", text: "text-ink", label: "30–42" },
  { min: -Infinity, fill: "#EBFAEE", text: "text-ink-2", label: "<30" },
] as const;

function bandFor(score: number): (typeof BANDS)[number] {
  return BANDS.find((band) => score >= band.min)!;
}

// Tile height and the table's row gap, shared so the legend strip can be sized
// to exactly the rows it spans. ROW_GAP must track `border-spacing-1.5` below.
const CELL_H = 44;
const ROW_GAP = 6;

export function SignalHeatmap({
  signals,
  signalLabels,
  nodes,
  nodeLabels,
  scores,
  composites,
  onSelect,
}: {
  signals: readonly string[];
  signalLabels: Record<string, string>;
  nodes: readonly string[];
  nodeLabels: Record<string, string>;
  scores: Record<string, number>;
  composites: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      {/* The tile field is a square overall, not each cell: 3 columns x 5 rows
          means equal-width cells have to be wider than tall for the field to
          come out square. 76x44 with a 4px gap lands exactly on 236x236. */}
      <div className="overflow-x-auto">
        <table className="mx-auto border-separate border-spacing-1.5 text-[13px]">
          {/* The row-label and legend columns are given matching widths so the
              tile field itself lands centred, rather than the table centring
              while the tiles sit off to one side. */}
          <colgroup>
            <col className="w-[100px]" />
            {nodes.map((nodeId) => (
              <col key={nodeId} className="w-[76px]" />
            ))}
            <col className="w-[100px]" />
          </colgroup>
          <thead>
            <tr>
              <td />
              {nodes.map((nodeId) => (
                <th key={nodeId} className="truncate pb-3 text-center text-[11px] font-bold uppercase tracking-eyebrow text-muted">
                  {nodeLabels[nodeId] ?? nodeId}
                </th>
              ))}
              <td />
            </tr>
          </thead>
          <tbody>
            {/* The scale rides along inside the table rather than sitting
                beside it: the browser then keeps it level with the tiles for
                free, instead of the two being held in step by a hand-tuned
                offset that font metrics can break. */}
            {signals.map((signalId, rowIndex) => (
              <tr key={signalId}>
                  <th scope="row" className="truncate pr-5 text-right text-[12px] font-normal text-ink-2">
                    {signalLabels[signalId] ?? signalId}
                  </th>
                  {nodes.map((nodeId) => {
                    const score = scores[`${nodeId}::${signalId}`] ?? 50;
                    const cellBand = bandFor(score);
                    return (
                      <td key={nodeId} className="p-0">
                        <button
                          type="button"
                          onClick={() => onSelect(`${nodeId}::${signalId}`)}
                          title={`${nodeLabels[nodeId] ?? nodeId} · ${signalLabels[signalId] ?? signalId}: ${formatScore(score)}`}
                          style={{ backgroundColor: cellBand.fill, height: CELL_H }}
                          className={`flex w-[76px] items-center justify-center text-[13px] font-semibold tabular-nums transition-opacity duration-100 ease-in hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink ${cellBand.text}`}
                        >
                          {formatScore(score)}
                        </button>
                      </td>
                    );
                  })}
                  {/* One cell spanning every row carries the whole scale, so
                      the swatches form a continuous strip rather than five
                      chips separated by the table's row spacing. */}
                  {rowIndex === 0 && (
                    <td rowSpan={signals.length} className="p-0 pl-8 align-top">
                      {/* Height is stated outright rather than inherited: a
                          rowSpan cell gives its children no resolved height to
                          size against, so percentage heights collapse to zero.
                          It matches the rows it spans — 5 tiles plus the 4 gaps
                          between them. */}
                      <div
                        className="flex flex-col"
                        style={{ height: signals.length * CELL_H + (signals.length - 1) * ROW_GAP }}
                      >
                        {BANDS.map((legendBand) => (
                          <div key={legendBand.label} className="flex min-h-0 flex-1 items-stretch gap-2">
                            <span className="w-3 shrink-0" style={{ backgroundColor: legendBand.fill }} aria-hidden="true" />
                            <span className="flex items-center text-[10px] text-muted">{legendBand.label}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  )}
              </tr>
            ))}
            {/* Composite is the weighted result of the column above, not
                another signal in it — so it sits outside the tile field as
                plain figures under a rule, rather than as more boxes. */}
            <tr>
              <th scope="row" className="truncate pr-5 pt-3 text-right text-[12px] font-semibold text-ink">
                Composite
              </th>
              {nodes.map((nodeId) => (
                <td key={nodeId} className="p-0 pt-3">
                  <button
                    type="button"
                    onClick={() => onSelect(nodeId)}
                    title={`${nodeLabels[nodeId] ?? nodeId} composite`}
                    className="flex h-9 w-[76px] items-center justify-center border-t border-line text-[13px] font-bold tabular-nums text-ink transition-colors duration-100 ease-in hover:bg-paper-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  >
                    {formatScore(composites[nodeId] ?? 50)}
                  </button>
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
