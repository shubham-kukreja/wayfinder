import { useEffect, useRef, useState, type RefObject } from "react";
import type { Allocation } from "@wayfinder/engine";
import { segmentSwatchStyle, stickyClassTotals, stickySegments } from "./AllocationBar.js";
import { formatPct } from "../lib/format.js";

// Height of the sticky TopBar (44px search field + 16px padding either side).
// The strip parks directly beneath it and hands over at the same line.
const TOP_BAR_HEIGHT = 76;

// A condensed stand-in for the full allocation band, shown only once the real
// one has scrolled away. It carries the two things worth keeping on screen
// while editing weights below — the proportions and the numbers — and drops
// everything else the full bar does: hover, selection, tooltips, neutral
// markers, parent rails and the legend chips.
export function StickyAllocationBar({ allocation, watch }: { allocation: Allocation; watch: RefObject<HTMLElement> }) {
  const [pinned, setPinned] = useState(false);

  // Fires on the full bar leaving the top of the viewport rather than on a
  // scroll offset, so the handoff stays correct however the page above it
  // reflows (banner, wrapped header, narrow viewport).
  useEffect(() => {
    const target = watch.current;
    if (!target) return;
    // The top margin pulls the trigger line down to the underside of the
    // TopBar, so the strip takes over exactly as the full bar disappears
    // behind it rather than a bar's height later.
    const observer = new IntersectionObserver(([entry]) => setPinned(!entry!.isIntersecting), {
      threshold: 0,
      rootMargin: `-${TOP_BAR_HEIGHT}px 0px 0px 0px`,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [watch]);

  const segments = stickySegments(allocation);
  const classTotals = stickyClassTotals(allocation);

  return (
    // The sticky box itself is zero-height and stays in the layout for the
    // whole page; the strip hangs off it absolutely, so appearing and
    // disappearing never reflows the content underneath.
    //
    // `top` clears the sticky TopBar, and the z-index stays below that bar's
    // z-20 so the strip tucks under the navbar rather than sliding over it.
    <div className="sticky z-10 h-0" style={{ top: TOP_BAR_HEIGHT }}>
      <div
        aria-hidden={!pinned}
        className={`absolute inset-x-0 top-0 -mx-6 border-b border-line bg-paper/95 px-6 backdrop-blur transition-opacity duration-150 ease-in ${
          pinned ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex items-center gap-4 py-2.5">
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-eyebrow text-muted">Live allocation</span>
          {/* Lines only: a thin band of flat fills, no labels inside it. */}
          <div className="flex h-2 min-w-0 flex-1 overflow-hidden">
            {segments.map((segment) => (
              <span
                key={segment.id}
                className="min-w-[2px]"
                style={{ width: `${segment.weight * 100}%`, ...segmentSwatchStyle(segment.id, allocation) }}
                title={`${segment.label}: ${formatPct(segment.weight)}`}
              />
            ))}
          </div>
          {/* Percentages for the three asset classes — the sleeve-level splits
              stay in the full bar above rather than crowding this strip. */}
          <div className="flex shrink-0 items-center gap-3">
            {classTotals.map((cls) => (
              <span key={cls.id} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: cls.color }} />
                <span className="text-[12px] font-semibold tabular-nums text-ink">{formatPct(cls.weight, 1)}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
