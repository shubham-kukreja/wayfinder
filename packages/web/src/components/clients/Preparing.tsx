import { useEffect, useState } from "react";
import { segmentColor } from "../AllocationBar.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";

// A short moment in place of a section that is being worked out (the funds
// for an amount, the trades for a rebalance): the model's sleeves fill in
// one by one, in their own colours, while a line says what is happening.
// About 3.6s, or a short fade when the viewer prefers reduced motion.

const TOTAL_MS = 3600;
const REDUCED_MS = 800;

export function Preparing({ lines, onDone, className = "" }: { lines: string[]; onDone: () => void; className?: string }) {
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
  // Segments fill across the first 85% of the time, the last one just
  // before the page opens.
  const step = rows.length > 0 ? (TOTAL_MS * 0.85) / rows.length : 0;

  return (
    <div className={`flex min-h-[360px] items-center justify-center rounded-xl border border-line bg-paper ${className}`} role="status" aria-live="polite">
      <div className="w-full max-w-md px-8">
        <div className="flex h-1.5 w-full gap-px bg-paper-2">
          {rows.map((r, i) => (
            <span
              key={r.id}
              className={`h-full origin-left ${reduced ? "" : "animate-fill-x"}`}
              style={{
                width: `${r.portfolioWeight * 100}%`,
                backgroundColor: segmentColor(r.id, allocation ?? undefined),
                animationDelay: `${i * step}ms`,
                animationDuration: `${Math.round(step)}ms`,
              }}
            />
          ))}
        </div>
        <p key={line} className={`mt-4 text-center text-[14px] text-ink ${reduced ? "" : "animate-rise-in"}`}>
          {lines[line]}
        </p>
      </div>
    </div>
  );
}
