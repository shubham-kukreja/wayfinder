import { useNavigate } from "react-router-dom";
import type { MentionCandidate } from "../../lib/mentionIndex.js";

const ENTITY_ROUTE: Record<MentionCandidate["entityType"], (id: string) => string> = {
  datapoint: () => "/model/datapoints",
  sleeve: () => "/overview",
  signal: () => "/overview",
  rubric: () => "/model/inputs",
  snapshot: (id) => `/reviews/history?open=${encodeURIComponent(id)}`,
};

// Collapsed to a slim rail by default so the note itself keeps the whole
// page — expanding it doesn't navigate anywhere or lose the note, it just
// widens this one column. Expanded state lives in the parent (not here) so
// the sticky header can reserve space for the rail instead of being covered
// by it — a `fixed` panel can't push sibling layout on its own.
export function ReferenceRail({
  referenced,
  expanded,
  onExpandedChange,
}: {
  referenced: MentionCandidate[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const navigate = useNavigate();

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => onExpandedChange(true)}
        aria-label="Expand references"
        className="fixed right-0 top-0 z-10 flex h-screen w-9 flex-col items-center gap-3 border-l border-line bg-paper-2 pt-6 text-muted hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3l-5 5 5 5M10 3l5 5-5 5" />
        </svg>
        {referenced.length > 0 && (
          <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-paper" style={{ writingMode: "horizontal-tb" }}>
            {referenced.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed right-0 top-0 z-10 flex h-screen w-72 flex-col border-l border-line bg-paper-2">
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Referenced</span>
        <button type="button" onClick={() => onExpandedChange(false)} aria-label="Collapse references" className="text-muted hover:text-ink">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3l5 5-5 5M6 3L1 8l5 5" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {referenced.length === 0 && <p className="pt-2 text-[12px] text-muted">Type "/" in the note to reference a data point, sleeve, or version.</p>}
        <div className="flex flex-col">
          {referenced.map((c) => (
            <button
              key={`${c.entityType}:${c.entityId}`}
              type="button"
              onClick={() => navigate(ENTITY_ROUTE[c.entityType](c.entityId))}
              className="flex items-center justify-between gap-2 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">{c.label}</span>
                  <span className="block truncate text-[11px] text-muted">{c.meta}</span>
                </span>
              </span>
              {c.value && <span className="shrink-0 font-mono text-[12px] text-ink-2">{c.value}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
