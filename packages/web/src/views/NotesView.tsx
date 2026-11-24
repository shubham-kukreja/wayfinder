import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/index.js";
import { createNote, listNotes, type NoteListItem } from "../lib/notesApi.js";
import { bodyToPlainText } from "../lib/noteRefs.js";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// The list page shows a plain-text preview: a mention chip collapses to
// just its label, and a widget block drops out entirely since there's no
// plain-text stand-in for a live chart.
function snippet(body: string, max = 160): string {
  const flat = bodyToPlainText(body);
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

// The landing surface for notes: search and "new note" sit above a plain
// reverse-chronological list, and that's the whole page — a note itself
// opens full-screen in NoteEditorView rather than inline here, so this
// view never needs to render more than one note's content at a time.
// Laid out like every other model surface (DataPointControlCenterView,
// OverviewView): a bordered header card with an eyebrow + count, a compact
// search field, and tight hairline-divided rows rather than floating
// padded cards.
export function NotesView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(
      () => {
        listNotes(query || undefined).then((rows) => {
          if (!cancelled) setNotes(rows);
        });
      },
      query ? 150 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const referencedCount = useMemo(() => (notes ?? []).filter((n) => n.refCount > 0).length, [notes]);

  async function handleNewNote() {
    setCreating(true);
    try {
      const note = await createNote({ body: "" });
      navigate(`/notes/${note.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Governance</p>
          <h1 className="mt-1 font-display text-xl text-ink sm:text-2xl">Notes</h1>
        </div>
        <Button variant="dark" size="sm" onClick={handleNewNote} disabled={creating}>
          New note
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-lg font-bold text-ink">{notes?.length ?? "—"}</span>
          <span className="ml-1.5 text-[13px] text-muted">
            note{notes?.length === 1 ? "" : "s"} · {referencedCount} with references
          </span>
        </div>
        {/* Matches TopBar's own search field exactly: filled bg-paper-2,
            no border, h-11 — this is the same control, not a smaller
            lookalike of it. */}
        <label className="relative flex w-full items-center sm:w-80">
          <span className="sr-only">Search notes</span>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M12.8 12.8L17 17" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 w-full border-0 bg-paper-2 pl-12 pr-4 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
            placeholder="Search notes"
          />
        </label>
      </div>

      {notes === null && <div className="py-10 text-center text-sm text-muted">Loading…</div>}

      {notes !== null && notes.length === 0 && (
        <div className="py-10 text-center text-sm text-muted">{query ? `No notes match "${query}".` : "No notes yet."}</div>
      )}

      {notes !== null && notes.length > 0 && (
        <div className="flex flex-col">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => navigate(`/notes/${note.id}`)}
              className="flex w-full flex-col gap-1 border-t border-line py-3.5 text-left transition-colors duration-100 ease-in first:border-t-0 hover:bg-paper-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[13.5px] font-bold text-ink">{note.title || "Untitled note"}</h2>
                  {note.refCount > 0 && (
                    <span className="shrink-0 bg-paper-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                      {note.refCount} ref{note.refCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                {note.body && <p className="mt-1 truncate text-[12.5px] text-muted">{snippet(note.body)}</p>}
              </div>
              <span className="shrink-0 text-[12px] text-muted sm:pt-0.5">
                {relativeTime(note.updatedAt)}
                {note.author && ` · ${note.author}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
