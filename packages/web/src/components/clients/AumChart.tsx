import { useMemo, useRef, useState } from "react";
import { RANGES, type Point, type Range } from "../../lib/aum.js";
import { formatRupees, formatRupeesCompact } from "../../lib/backtestFormat.js";

// AUM over time: a green area on a quiet panel, value ticks on the left,
// dates along the bottom, a hover readout, and range buttons below.

const W = 800;
const H = 300;
const PAD = { top: 16, right: 0, bottom: 28, left: 64 };

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
const fmtFull = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) return [min];
  const raw = (max - min) / (count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= max + step / 2; v += step) out.push(v);
  return out;
}

export function AumChart({
  points,
  range,
  onRange,
  loading,
  ranges = RANGES,
}: {
  points: Point[];
  range: Range;
  /** Omit to hide the range buttons (when the page has its own toggle). */
  onRange?: (r: Range) => void;
  loading?: boolean;
  ranges?: Range[];
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const vals = points.map((p) => p.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = (max - min) * 0.08 || max * 0.02 || 1;
    min = Math.max(0, min - pad);
    max = max + pad;
    const ticks = niceTicks(min, max);
    min = Math.min(min, ticks[0]!);
    max = Math.max(max, ticks[ticks.length - 1]!);
    const x = (i: number) =>
      PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const line = points
      .map(
        (p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`,
      )
      .join("");
    const area = `${line}L${x(points.length - 1).toFixed(1)},${H - PAD.bottom}L${x(0).toFixed(1)},${H - PAD.bottom}Z`;
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      Math.round(f * (points.length - 1)),
    );
    return { x, y, line, area, ticks, xTicks };
  }, [points]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geo || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(
      ((px - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1),
    );
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  const hp = hover != null ? points[hover] : null;

  return (
    <div className="flex flex-col">
      <div className="relative bg-[#F5F5F5]">
        {geo ? (
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="block h-[300px] w-full"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`AUM from ${fmtFull(points[0]!.date)} to ${fmtFull(points[points.length - 1]!.date)}`}
          >
            <defs>
              {/* Altruist's area: solid bright green fading out toward the axis. */}
              <linearGradient id="aum-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#2CD46B" stopOpacity="1" />
                <stop offset="55%" stopColor="#2CD46B" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#2CD46B" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            {geo.ticks.map((t) => (
              <line
                key={t}
                x1={PAD.left}
                x2={W}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke="currentColor"
                className="text-line"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={geo.area} fill="url(#aum-fill)" />
            <path
              d={geo.line}
              fill="none"
              stroke="#22C55E"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            {hp && (
              <line
                x1={geo.x(hover!)}
                x2={geo.x(hover!)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="currentColor"
                className="text-ink"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-[13px] text-muted">
            {loading ? "Loading values…" : "No history yet"}
          </div>
        )}
        {/* Axis labels as HTML so they do not stretch with the SVG. */}
        {geo && (
          <>
            {geo.ticks.map((t) => (
              <span
                key={t}
                className="pointer-events-none absolute left-3 -translate-y-1/2 text-[10px] tabular-nums text-muted"
                style={{ top: `${(geo.y(t) / H) * 100}%` }}
              >
                {formatRupeesCompact(t)}
              </span>
            ))}
            {geo.xTicks.map((i, k) => (
              <span
                key={k}
                className={`pointer-events-none absolute bottom-1.5 whitespace-nowrap text-[10px] text-muted ${k === 0 ? "" : k === 4 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${(geo.x(i) / W) * 100}%` }}
              >
                {fmtDay(points[i]!.date)}
              </span>
            ))}
          </>
        )}
        {hp && geo && (
          <div
            className="pointer-events-none absolute top-3 z-10 border border-line bg-paper px-3 py-2 text-[12px] shadow-md"
            style={{
              left: `${Math.min(80, Math.max(8, (geo.x(hover!) / W) * 100))}%`,
            }}
          >
            <p className="text-muted">{fmtFull(hp.date)}</p>
            <p className="text-[14px] font-semibold tabular-nums text-ink">
              {formatRupees(Math.round(hp.value))}
            </p>
          </div>
        )}
      </div>
      {onRange && (
        <div
          className="flex items-center justify-center gap-1 py-3"
          role="group"
          aria-label="Range"
        >
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              aria-pressed={r === range}
              className={`h-7 min-w-[40px] rounded-sm px-2 text-[12px] font-semibold transition-colors duration-100 ease-in ${
                r === range
                  ? "bg-[#F0F0F0] text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
