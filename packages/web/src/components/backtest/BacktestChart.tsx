import { useMemo, useState } from "react";
import type { BacktestPoint } from "../../lib/backtestApi.js";

// Inline SVG line chart, not a charting library — the app has none installed
// and this is the only place that needs one so far. Two series (portfolio,
// benchmark), both indexed to their own first point rather than raw rupee
// values, so the lines are comparable in shape even when the invested
// amounts scaling them differ (a benchmark "same money, same dates" series
// legitimately starts at the same value as the portfolio, but this keeps
// the chart correct if that ever isn't true).
const WIDTH = 900;
const HEIGHT = 340;
const PADDING = { top: 16, right: 16, bottom: 28, left: 56 };

function pathFor(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

export function BacktestChart({ series }: { series: BacktestPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { portfolioPath, benchmarkPath, points, yTicks, minY, maxY } = useMemo(() => {
    if (series.length === 0) {
      return { portfolioPath: "", benchmarkPath: "", points: [], yTicks: [], minY: 0, maxY: 0 };
    }
    const values = series.flatMap((p) => [p.portfolioValue, p.benchmarkValue]);
    const minY = Math.min(...values);
    const maxY = Math.max(...values);
    const span = maxY - minY || 1;
    const plotW = WIDTH - PADDING.left - PADDING.right;
    const plotH = HEIGHT - PADDING.top - PADDING.bottom;

    const xFor = (i: number) => PADDING.left + (i / Math.max(1, series.length - 1)) * plotW;
    const yFor = (v: number) => PADDING.top + plotH - ((v - minY) / span) * plotH;

    const portfolioPoints = series.map((p, i) => ({ x: xFor(i), y: yFor(p.portfolioValue) }));
    const benchmarkPoints = series.map((p, i) => ({ x: xFor(i), y: yFor(p.benchmarkValue) }));

    const yTicks = [minY, minY + span / 2, maxY];

    return {
      portfolioPath: pathFor(portfolioPoints),
      benchmarkPath: pathFor(benchmarkPoints),
      points: series.map((p, i) => ({ ...p, x: xFor(i) })),
      yTicks,
      minY,
      maxY,
    };
  }, [series]);

  if (series.length === 0) {
    return <div className="flex h-[340px] items-center justify-center text-sm text-muted">No data to chart.</div>;
  }

  const hovered = hoverIndex !== null ? series[hoverIndex] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
          let closest = 0;
          let closestDist = Infinity;
          points.forEach((p, i) => {
            const d = Math.abs(p.x - relX);
            if (d < closestDist) {
              closestDist = d;
              closest = i;
            }
          });
          setHoverIndex(closest);
        }}
      >
        {yTicks.map((tick, i) => {
          const plotH = HEIGHT - PADDING.top - PADDING.bottom;
          const span = maxY - minY || 1;
          const y = PADDING.top + plotH - ((tick - minY) / span) * plotH;
          return (
            <g key={i}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="#E3E3E3" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#767676">
                {tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick.toFixed(0)}
              </text>
            </g>
          );
        })}

        <path d={benchmarkPath} fill="none" stroke="#767676" strokeWidth={2} strokeDasharray="4 3" />
        <path d={portfolioPath} fill="none" stroke="#01BC48" strokeWidth={2.5} />

        {hoverIndex !== null && points[hoverIndex] && (
          <line
            x1={points[hoverIndex]!.x}
            x2={points[hoverIndex]!.x}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
            stroke="#3A3A3A"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}
      </svg>

      <div className="mt-2 flex items-center gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-brand-700" /> Your allocation
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-muted" /> Benchmark
        </span>
      </div>

      {hovered && (
        <div className="absolute right-2 top-2 rounded-sm border border-line bg-paper px-3 py-2 text-xs shadow-sm">
          <div className="font-medium text-ink">{hovered.date}</div>
          <div className="text-ink-2">
            Portfolio: <span className="font-medium tabular-nums text-ink">₹{hovered.portfolioValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="text-ink-2">
            Benchmark: <span className="font-medium tabular-nums text-ink">₹{hovered.benchmarkValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
