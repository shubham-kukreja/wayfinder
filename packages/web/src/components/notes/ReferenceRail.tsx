import { useNavigate } from "react-router-dom";
import type { MentionCandidate } from "../../lib/mentionIndex.js";

const ENTITY_ROUTE: Record<MentionCandidate["entityType"], (id: string) => string> = {
  datapoint: () => "/model/datapoints",
  sleeve: () => "/overview",
  signal: () => "/overview",
  rubric: () => "/model/overrides",
  snapshot: (id) => `/reviews/history?open=${encodeURIComponent(id)}`,
};

// Always visible as a real column (roughly a 4:1 split against the note,
// matched by flex-[4]/flex-[1] on the two sides) at desktop widths — the
// same permanence as Data Point Control Center's own right-hand detail
// panel, not a collapsible strip that has to be reopened every visit. Below
// `lg` there's no room for a sidebar next to the note at all, so it drops
// out of the flex row (NoteEditorView switches to flex-col there) and
// becomes an ordinary block underneath the note instead of a tall column.
export function ReferenceRail({ referenced }: { referenced: MentionCandidate[] }) {
  const navigate = useNavigate();

  return (
    <aside className="w-full shrink-0 border-t border-line bg-paper-2 px-10 py-6 lg:sticky lg:top-0 lg:h-screen lg:flex-1 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <span className="text-xs font-bold uppercase tracking-eyebrow text-muted">Referenced</span>

      <div className="mt-3 flex flex-col">
        {referenced.length === 0 && <p className="pt-1 text-[12px] text-muted">Type "/" in the note to reference a data point, sleeve, or version.</p>}
        {referenced.map((c) => (
          <button
            key={`${c.entityType}:${c.entityId}`}
            type="button"
            onClick={() => navigate(ENTITY_ROUTE[c.entityType](c.entityId))}
            className="flex items-center justify-between gap-2 border-t border-line py-2.5 text-left transition-colors duration-100 ease-in first:border-t-0 first:pt-0 hover:text-ink"
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
    </aside>
  );
}
