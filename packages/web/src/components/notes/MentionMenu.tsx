import { useEffect, useRef, useState } from "react";
import type { MentionCandidate } from "../../lib/mentionIndex.js";

const TYPE_LABEL: Record<MentionCandidate["entityType"], string> = {
  datapoint: "Data points",
  sleeve: "Sleeves",
  signal: "Asset classes",
  rubric: "Rubrics",
  snapshot: "Versions",
};

const TYPE_LETTER: Record<MentionCandidate["entityType"], string> = {
  datapoint: "D",
  sleeve: "S",
  signal: "A",
  rubric: "R",
  snapshot: "V",
};

// The "/" palette. It groups by entity type (mirroring the same grouping
// the rest of the app already uses — Data Points, Sleeves, asset classes),
// and every row already shows the entity's current value so picking the
// right one doesn't require leaving the sentence to go check.
export function MentionMenu({
  query,
  candidates,
  style,
  onPick,
  onClose,
}: {
  query: string;
  candidates: MentionCandidate[];
  style: { top: number; left: number };
  onPick: (candidate: MentionCandidate) => void;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (candidates[activeIndex]) {
          e.preventDefault();
          onPick(candidates[activeIndex]!);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [candidates, activeIndex, onPick, onClose]);

  useEffect(() => {
    const el = containerRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let groups: Array<[MentionCandidate["entityType"], MentionCandidate[]]> = [];
  const seen = new Set<MentionCandidate["entityType"]>();
  for (const c of candidates) {
    if (!seen.has(c.entityType)) {
      seen.add(c.entityType);
      groups.push([c.entityType, []]);
    }
    groups.find(([t]) => t === c.entityType)![1].push(c);
  }

  let runningIndex = 0;

  return (
    <div
      className="absolute z-20 w-[340px] overflow-hidden rounded-lg border border-line bg-paper shadow-xl"
      style={{ top: style.top, left: style.left }}
    >
      <div className="border-b border-line px-3 py-2 text-[12px] text-muted">
        Reference <span className="font-semibold text-ink">/{query}</span>
      </div>
      <div ref={containerRef} className="max-h-[280px] overflow-y-auto p-1.5">
        {candidates.length === 0 && <div className="px-2.5 py-4 text-center text-[12px] text-muted">No matches</div>}
        {groups.map(([type, items]) => (
          <div key={type}>
            <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-eyebrow text-muted">{TYPE_LABEL[type]}</div>
            {items.map((c) => {
              const index = runningIndex++;
              return (
                <button
                  key={`${c.entityType}:${c.entityId}`}
                  type="button"
                  data-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onPick(c)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${index === activeIndex ? "bg-lilac" : ""}`}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold text-white"
                    style={{ background: c.color }}
                  >
                    {TYPE_LETTER[type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink">{c.label}</div>
                    <div className="truncate text-[11px] text-muted">{c.meta}</div>
                  </span>
                  {c.value && <span className="shrink-0 font-mono text-[12px] text-ink-2">{c.value}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
