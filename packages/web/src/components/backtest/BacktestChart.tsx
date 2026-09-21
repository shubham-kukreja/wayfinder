import { useMemo, useState } from "react";
import type { BacktestPoint } from "../../lib/backtestApi.js";

const WIDTH = 960;
const HEIGHT = 390;
const PADDING = { top: 18, right: 20, bottom: 48, left: 62 };
const ALLOCATION_COLOR = "#0FAE62";
const BENCHMARK_COLOR = "#D2B640";

type ChartRange = "1M" | "3M" | "1Y" | "3Y" | "5Y" | "ALL";
const RANGES: ChartRange[] = ["1M", "3M", "1Y", "3Y", "5Y", "ALL"];

function cutoffFor(range: ChartRange, endDate: string): string | null {
  if (range === "ALL") return null;
  const date = new Date(`${endDate}T00:00:00`);
  if (range === "1M") date.setMonth(date.getMonth() - 1);
  if (range === "3M") date.setMonth(date.getMonth() - 3);
  if (range === "1Y") date.setFullYear(date.getFullYear() - 1);
  if (range === "3Y") date.setFullYear(date.getFullYear() - 3);
  if (range === "5Y") date.setFullYear(date.getFullYear() - 5);
  return date.toISOString().slice(0, 10);
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function niceStep(span: number, targetTicks = 5): number {
  const rough = span / Math.max(1, targetTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function formatAxisPct(value: number): string {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatAxisDate(date: string, range: ChartRange): string {
  const value = new Date(`${date}T00:00:00`);
  if (range === "1M" || range === "3M") return value.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return value.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function BacktestChart({ series }: { series: BacktestPoint[] }) {
  const [range, setRange] = useState<ChartRange>("5Y");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const visibleSeries = useMemo(() => {
    if (series.length === 0) return [];
    const cutoff = cutoffFor(range, series[series.length - 1]!.date);
    if (!cutoff) return series;
    const filtered = series.filter((point) => point.date >= cutoff);
    return filtered.length >= 2 ? filtered : series.slice(-2);
  }, [range, series]);

  const chart = useMemo(() => {
    if (visibleSeries.length === 0) return null;
    const plottedSeries =
      visibleSeries.length <= 180
        ? visibleSeries
        : Array.from({ length: 180 }, (_, index) => visibleSeries[Math.round((index / 179) * (visibleSeries.length - 1))]!);
    const plotWidth = WIDTH - PADDING.left - PADDING.right;
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const values = plottedSeries.flatMap((point) => [point.portfolioReturnPct, point.benchmarkReturnPct]);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const rawSpan = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
    const step = niceStep(rawSpan * 1.18);
    const min = Math.floor((rawMin - rawSpan * 0.08) / step) * step;
    const max = Math.ceil((rawMax + rawSpan * 0.08) / step) * step || step;
    const span = max - min || 1;
    const xFor = (index: number) => PADDING.left + (index / Math.max(1, plottedSeries.length - 1)) * plotWidth;
    const yFor = (value: number) => PADDING.top + plotHeight - ((value - min) / span) * plotHeight;
    const allocationPoints = plottedSeries.map((point, index) => ({ x: xFor(index), y: yFor(point.portfolioReturnPct) }));
    const benchmarkPoints = plottedSeries.map((point, index) => ({ x: xFor(index), y: yFor(point.benchmarkReturnPct) }));
    const yTicks: Array<{ value: number; y: number }> = [];
    for (let value = min; value <= max + step * 0.001; value += step) yTicks.push({ value, y: yFor(value) });
    const xTickCount = Math.min(5, plottedSeries.length);
    const xTickIndexes = Array.from(new Set(Array.from({ length: xTickCount }, (_, index) => Math.round((index / Math.max(1, xTickCount - 1)) * (plottedSeries.length - 1)))));
    return {
      allocationPath: linePath(allocationPoints),
      benchmarkPath: linePath(benchmarkPoints),
      yTicks,
      xTicks: xTickIndexes.map((index) => ({ x: xFor(index), date: plottedSeries[index]!.date })),
      points: plottedSeries.map((point, index) => ({
        ...point,
        x: xFor(index),
        allocationY: allocationPoints[index]!.y,
        benchmarkY: benchmarkPoints[index]!.y,
      })),
    };
  }, [visibleSeries]);

  if (!chart) return <div className="flex h-[390px] items-center justify-center text-sm text-muted">No data to chart.</div>;

  const hovered = hoverIndex === null ? null : chart.points[hoverIndex];

  return (
    <div>
      <div className="relative rounded-lg bg-[#F6F8F4] px-3 pb-2 pt-4 sm:px-5">
        <div className="flex items-center gap-6 pl-[42px] text-[12px] font-semibold text-ink-2">
          <span className="inline-flex items-center gap-2"><span className="h-[3px] w-5 bg-[#0FAE62]" />Your allocation</span>
          <span className="inline-flex items-center gap-2"><span className="h-[3px] w-5 bg-[#D2B640]" />Benchmark</span>
        </div>

        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mt-2 block w-full"
          role="img"
          aria-label="Percentage return of the allocation and benchmark over time"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
            let nearest = 0;
            let distance = Infinity;
            chart.points.forEach((point, index) => {
              const nextDistance = Math.abs(point.x - x);
              if (nextDistance < distance) {
                nearest = index;
                distance = nextDistance;
              }
            });
            setHoverIndex(nearest);
          }}
        >
          <text x="17" y={(PADDING.top + HEIGHT - PADDING.bottom) / 2} transform={`rotate(-90 17 ${(PADDING.top + HEIGHT - PADDING.bottom) / 2})`} fill="#767676" fontSize="11" fontWeight="600" textAnchor="middle">RETURN</text>
          {chart.yTicks.map((tick) => (
            <g key={tick.value}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={tick.y} y2={tick.y} stroke="#E2E6DE" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={PADDING.left - 10} y={tick.y + 4} fill="#767676" fontFamily="IBM Plex Mono, monospace" fontSize="11" textAnchor="end">{formatAxisPct(tick.value)}</text>
            </g>
          ))}
          <line x1={PADDING.left} x2={PADDING.left} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="#BFC5BC" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom} stroke="#BFC5BC" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {chart.xTicks.map((tick) => (
            <g key={`${tick.date}-${tick.x}`}>
              <line x1={tick.x} x2={tick.x} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom + 5} stroke="#BFC5BC" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={tick.x} y={HEIGHT - PADDING.bottom + 22} fill="#767676" fontSize="11" fontWeight="600" textAnchor="middle">{formatAxisDate(tick.date, range)}</text>
            </g>
          ))}

          <path d={chart.benchmarkPath} fill="none" stroke={BENCHMARK_COLOR} strokeWidth="3.5" strokeLinejoin="miter" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
          <path d={chart.allocationPath} fill="none" stroke={ALLOCATION_COLOR} strokeWidth="4" strokeLinejoin="miter" strokeLinecap="butt" vectorEffect="non-scaling-stroke" />

          {hovered && (
            <>
              <line x1={hovered.x} x2={hovered.x} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="#9EA69A" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
              <circle cx={hovered.x} cy={hovered.benchmarkY} r="5" fill={BENCHMARK_COLOR} stroke="#FFFFFF" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              <circle cx={hovered.x} cy={hovered.allocationY} r="5" fill={ALLOCATION_COLOR} stroke="#FFFFFF" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </>
          )}
        </svg>

        {hovered && (
          <div className="pointer-events-none absolute top-12 z-20 min-w-[202px] border border-line bg-paper px-3 py-2.5 text-xs shadow-lg" style={{ left: `min(${(hovered.x / WIDTH) * 100}%, calc(100% - 216px))` }}>
            <div className="mb-2 font-semibold text-ink">{new Date(hovered.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            <div className="flex items-center justify-between gap-5"><span className="inline-flex items-center gap-1.5 text-ink-2"><span className="h-[3px] w-3 bg-[#0FAE62]" />Allocation</span><span className="font-mono font-semibold tabular-nums text-ink">{formatPct(hovered.portfolioReturnPct)}</span></div>
            <div className="mt-0.5 flex justify-between gap-5 text-[11px] text-muted"><span>Value</span><span className="font-mono tabular-nums">₹{hovered.portfolioValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></div>
            <div className="mt-2 flex items-center justify-between gap-5"><span className="inline-flex items-center gap-1.5 text-ink-2"><span className="h-[3px] w-3 bg-[#D2B640]" />Benchmark</span><span className="font-mono font-semibold tabular-nums text-ink">{formatPct(hovered.benchmarkReturnPct)}</span></div>
            <div className="mt-0.5 flex justify-between gap-5 text-[11px] text-muted"><span>Value</span><span className="font-mono tabular-nums">₹{hovered.benchmarkValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></div>
            <div className="mt-2 flex justify-between gap-5 border-t border-line pt-2 text-[11px]"><span className="text-muted">Gap</span><span className="font-mono font-semibold tabular-nums text-ink">{formatPct(hovered.portfolioReturnPct - hovered.benchmarkReturnPct)}</span></div>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 sm:gap-4" aria-label="Chart range">
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setRange(option);
              setHoverIndex(null);
            }}
            aria-pressed={range === option}
            className={`min-w-12 rounded-full px-3 py-2 text-xs font-bold transition-colors duration-100 ${range === option ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
