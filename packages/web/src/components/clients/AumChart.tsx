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

/** Fritsch–Carlson monotone cubic through the points, as an SVG path. */
function monotonePath(pts: Array<[number, number]>): string {
  const n = pts.length;
  const dx = (i: number) => pts[i + 1]![0] - pts[i]![0];
  const slope = (i: number) => (pts[i + 1]![1] - pts[i]![1]) / dx(i);
  const m: number[] = new Array(n).fill(0);
  m[0] = slope(0);
  m[n - 1] = slope(n - 2);
  for (let i = 1; i < n - 1; i++) {
    const a = slope(i - 1);
    const b = slope(i);
    m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b); // harmonic mean keeps the curve monotone
  }
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx(i) / 3;
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    d += `C${(x0 + h).toFixed(1)},${(y0 + m[i]! * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1]! * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

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

  // Altruist draws broad, smooth moves: thin the daily series to about 48
  // points (keeping the first and last) and draw a monotone cubic through
  // them, so the curve never overshoots the real values between points.
  const shown = useMemo(() => {
    const n = 48;
    if (points.length <= n) return points;
    const step = (points.length - 1) / (n - 1);
    return Array.from({ length: n }, (_, i) => points[Math.round(i * step)]!);
  }, [points]);

  const geo = useMemo(() => {
    if (shown.length < 2) return null;
    const vals = shown.map((p) => p.value);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    const pad = (max - min) * 0.08 || max * 0.02 || 1;
    min = Math.max(0, min - pad);
    max = max + pad;
    const ticks = niceTicks(min, max);
    min = Math.min(min, ticks[0]!);
    max = Math.max(max, ticks[ticks.length - 1]!);
    const x = (i: number) => PAD.left + (i / (shown.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const line = monotonePath(shown.map((p, i) => [x(i), y(p.value)]));
    // The fill runs to the very bottom, under the date labels, where it fades out.
    const area = `${line}L${x(shown.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (shown.length - 1)));
    return { x, y, line, area, ticks, xTicks };
  }, [shown]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geo || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(
      ((px - PAD.left) / (W - PAD.left - PAD.right)) * (shown.length - 1),
    );
    setHover(Math.max(0, Math.min(shown.length - 1, i)));
  }

  const hp = hover != null ? shown[hover] : null;

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
              {/* Altruist's area: soft green, fading to white at the very bottom. */}
              <linearGradient id="aum-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#6CD77C" />
                <stop offset="55%" stopColor="#6CD77C" />
                <stop offset="100%" stopColor="#FFFFFF" />
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
              stroke="#3E8E41"
              strokeWidth="2"
              strokeLinejoin="round"
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
                className="pointer-events-none absolute left-4 -translate-y-1/2 text-[12px] tabular-nums text-muted"
                style={{ top: `${(geo.y(t) / H) * 100}%` }}
              >
                {formatRupeesCompact(t)}
              </span>
            ))}
            {geo.xTicks.map((i, k) => (
              <span
                key={k}
                className={`pointer-events-none absolute bottom-2 whitespace-nowrap text-[12px] text-muted/70 ${k === 0 ? "" : k === 4 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${(geo.x(i) / W) * 100}%` }}
              >
                {fmtDay(shown[i]!.date)}
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
          className="flex items-center justify-center gap-4 py-4"
          role="group"
          aria-label="Range"
        >
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRange(r)}
              aria-pressed={r === range}
              className={`h-8 min-w-11 rounded-md px-2.5 text-[13px] transition-colors duration-150 ease-out ${
                r === range
                  ? "bg-[#F2F2F2] font-bold text-ink underline underline-offset-4"
                  : "text-ink-2 hover:text-ink"
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
