import { useEffect, useState } from "react";
import { segmentColor } from "../AllocationBar.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";

// A short moment between clicking Invest more or Rebalance and the next
// page: the model's sleeves fill in one by one, in their own colours, while
// a line says what is being worked out. About 1.6s, or a brief fade when the
// viewer prefers reduced motion.

const TOTAL_MS = 1600;
const REDUCED_MS = 500;

export function PrepareOverlay({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const { allocation } = useCoreAllocation();
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [line, setLine] = useState(0);

  useEffect(() => {
    const total = reduced ? REDUCED_MS : TOTAL_MS;
    const per = total / lines.length;
    const timers = lines.slice(1).map((_, i) => setTimeout(() => setLine(i + 1), per * (i + 1)));
    const done = setTimeout(onDone, total);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, []);

  const rows = allocation?.rollup.filter((r) => r.portfolioWeight > 0.0005) ?? [];
  const step = rows.length > 0 ? (TOTAL_MS * 0.7) / rows.length : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-[2px]" role="status" aria-live="polite">
      <div className="w-full max-w-md px-8">
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-paper-2">
          {rows.map((r, i) => (
            <span
              key={r.id}
              className={`h-full origin-left ${reduced ? "" : "animate-fill-x"}`}
              style={{ width: `${r.portfolioWeight * 100}%`, backgroundColor: segmentColor(r.id, allocation ?? undefined), animationDelay: `${i * step}ms` }}
            />
          ))}
        </div>
        <p key={line} className={`mt-5 text-center text-[15px] text-ink ${reduced ? "" : "animate-rise-in"}`}>
          {lines[line]}
        </p>
        <p className="mt-1 text-center text-[12px] tabular-nums text-muted">
          {rows.length > 0 ? `${rows.length} sleeves in the model` : " "}
        </p>
      </div>
    </div>
  );
}
