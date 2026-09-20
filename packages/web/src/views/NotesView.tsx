import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Kicker } from "../components/ui/index.js";
import { createNote, listNotes, type NoteListItem } from "../lib/notesApi.js";

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

// The list page shows a plain-text preview, so a mention token collapses to
// just its entity id — legible without needing the full candidate lookup
// (live value, color) that only the open note itself resolves.
function snippet(body: string, max = 160): string {
  const withoutTokens = body.replace(/\{\{(?:datapoint|sleeve|signal|rubric|snapshot):([^{}]+)\}\}/g, "$1");
  const flat = withoutTokens.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

// The landing surface for notes: search and "new note" sit above a plain
// reverse-chronological list, and that's the whole page — a note itself
// opens full-screen in NoteEditorView rather than inline here, so this
// view never needs to render more than one note's content at a time.
export function NotesView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      listNotes(query || undefined).then((rows) => {
        if (!cancelled) setNotes(rows);
      });
    }, query ? 150 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

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
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Kicker>Governance</Kicker>
          <h1 className="mt-1 text-2xl font-extrabold tracking-display text-ink">Notes</h1>
        </div>
        <Button onClick={handleNewNote} disabled={creating}>
          New note
        </Button>
      </div>

      <label className="relative mb-6 flex w-full items-center">
        <span className="sr-only">Search notes</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" />
        </svg>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-sm border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          placeholder="Search notes"
        />
      </label>

      {notes === null && <div className="py-10 text-center text-sm text-muted">Loading…</div>}

      {notes !== null && notes.length === 0 && (
        <Card className="py-10 text-center">
          <p className="text-sm text-muted">{query ? `No notes match "${query}".` : "No notes yet."}</p>
        </Card>
      )}

      {notes !== null && notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => navigate(`/notes/${note.id}`)}
              className="w-full rounded-lg border border-line bg-paper p-4 text-left transition-colors duration-100 ease-in hover:bg-paper-2"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="truncate text-[15px] font-bold text-ink">{note.title || "Untitled note"}</h2>
                <span className="shrink-0 text-xs text-muted">{relativeTime(note.updatedAt)}</span>
              </div>
              {note.body && <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{snippet(note.body)}</p>}
              {note.refCount > 0 && (
                <p className="mt-2 text-xs font-semibold text-muted">
                  {note.refCount} reference{note.refCount === 1 ? "" : "s"}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
