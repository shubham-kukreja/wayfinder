import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { NoteEditor } from "../components/notes/NoteEditor.js";
import { ReferenceRail } from "../components/notes/ReferenceRail.js";
import { deleteNote, getNote, updateNote, type Note } from "../lib/notesApi.js";
import { extractRefsFromBody } from "../lib/noteRefs.js";
import { buildSnapshotCandidates, type MentionCandidate } from "../lib/mentionIndex.js";
import { useSnapshot } from "../hooks/useSnapshot.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../lib/constants.js";

type SaveState = "saved" | "saving" | "unsaved";

// A regular page inside the app shell (same left sidebar and top bar as
// every other view) rather than its own isolated screen — the note is the
// main column, and the reference panel is a fixed right-hand rail sized
// like Data Point Control Center's own detail panel: always visible, not a
// collapsible strip.
//
// Undo/redo is BlockNote's own (ProseMirror history, Cmd+Z/Cmd+Shift+Z
// while focus is in the editor) rather than anything this view tracks —
// the previous hand-rolled undo stack here fought the old contentEditable
// editor's own DOM rebuilds and was a source of real bugs (a debounced
// save racing an undo could silently overwrite it). BlockNote's history is
// scoped to the ProseMirror document itself, so it doesn't have that
// failure mode.
export function NoteEditorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { snapshot } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      setNote(n);
      setTitle(n.title ?? "");
      setBody(n.body);
    });
  }, [id]);

  function persist(next: { title?: string; body?: string }, currentBody: string, currentTitle: string) {
    if (!id) return;
    setSaveState("saving");
    const nextBody = next.body ?? currentBody;
    const nextTitle = next.title ?? currentTitle;
    updateNote(id, { title: nextTitle, body: nextBody, refs: extractRefsFromBody(nextBody) })
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("unsaved"));
  }

  function scheduleSave(next: { title?: string; body?: string }) {
    setSaveState("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next, body, title), 600);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    scheduleSave({ title: value });
  }

  function handleBodyChange(value: string) {
    setBody(value);
    scheduleSave({ body: value });
  }

  async function handleConfirmDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteNote(id);
      navigate("/notes");
    } catch {
      setDeleting(false);
    }
  }

  const referenced = useMemo(() => resolveReferences(body, snapshot), [body, snapshot]);

  if (!note) {
    return <div className="px-6 py-10 text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="flex w-full flex-col lg:flex-row">
      <main className="min-w-0 px-6 py-4 sm:px-10 sm:py-6 lg:flex-[4] lg:px-14">
        <div className="mb-5 flex items-center justify-between gap-4">
          <button type="button" onClick={() => navigate("/notes")} className="flex items-center gap-1.5 px-1 py-1 text-[13px] font-semibold text-muted transition-colors duration-100 ease-in hover:text-ink">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
            Notes
          </button>
          <div className="flex items-center gap-5">
            <SaveIndicator state={saveState} />
            <button type="button" onClick={() => setConfirmingDelete(true)} className="text-[13px] font-semibold text-muted transition-colors duration-100 ease-in hover:text-danger-500">
              Delete
            </button>
          </div>
        </div>

        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled note"
          className="w-full border-none bg-transparent font-display text-2xl font-bold leading-tight text-ink outline-none placeholder:text-muted/70 sm:text-3xl"
        />

        <div className="mt-7">
          <NoteEditor key={id} body={body} onChange={handleBodyChange} snapshot={snapshot} placeholder='Write freely. Type "/" to reference a data point, sleeve, version — or add a widget.' autoFocus />
        </div>
      </main>

      <ReferenceRail referenced={referenced} />

      {confirmingDelete && (
        <DeleteNoteDialog
          noteTitle={title || "Untitled note"}
          deleting={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

function DeleteNoteDialog({
  noteTitle,
  deleting,
  onCancel,
  onConfirm,
}: {
  noteTitle: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delete-note-title">
      <div className="w-full max-w-sm border border-line bg-paper p-5 shadow-xl">
        <h2 id="delete-note-title" className="text-[15px] font-semibold text-ink">
          Delete "{noteTitle}"?
        </h2>
        <p className="mt-1.5 text-[13px] leading-5 text-muted">This cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="inline-flex h-8 items-center border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex h-8 items-center bg-danger-500 px-3 text-[13px] font-semibold text-white transition duration-100 ease-in hover:brightness-[1.1] disabled:pointer-events-none disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved" : "Saved";
  const dotClass = state === "saved" ? "bg-brand-600" : state === "saving" ? "bg-muted" : "bg-danger-500";
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function resolveReferences(body: string, snapshot: Snapshot | null): MentionCandidate[] {
  const refs = extractRefsFromBody(body);
  if (refs.length === 0) return [];
  const candidates = snapshot ? buildSnapshotCandidates(snapshot) : [];
  const byId = new Map(candidates.map((c) => [`${c.entityType}:${c.entityId}`, c]));
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const ref of refs) {
    const key = `${ref.entityType}:${ref.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(byId.get(key) ?? { entityType: ref.entityType, entityId: ref.entityId, label: ref.entityId, meta: "", value: null, color: "#8A8A90" });
  }
  return out;
}
