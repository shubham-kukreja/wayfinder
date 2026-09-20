import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { NoteEditor } from "../components/notes/NoteEditor.js";
import { NoteWidgetBlock } from "../components/notes/NoteWidgetBlock.js";
import { ReferenceRail } from "../components/notes/ReferenceRail.js";
import { deleteNote, getNote, updateNote, type Note, type NoteWidget, type NoteWidgetSize } from "../lib/notesApi.js";
import { extractRefs } from "../lib/mentionTokens.js";
import { buildSnapshotCandidates, type MentionCandidate } from "../lib/mentionIndex.js";
import { useSnapshot } from "../hooks/useSnapshot.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../lib/constants.js";

type SaveState = "saved" | "saving" | "unsaved";

// Deliberately its own page, not a route nested under the app shell: opening
// a note means seeing *that note* — full width, full height — with nothing
// from Overview, Signals or any other surface competing for the screen.
// Only the reference rail survives, and it starts collapsed to a 36px strip.
export function NoteEditorView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { snapshot } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [widgets, setWidgets] = useState<NoteWidget[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [showWidgetMenu, setShowWidgetMenu] = useState(false);
  const [railExpanded, setRailExpanded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      setNote(n);
      setTitle(n.title ?? "");
      setBody(n.body);
      setWidgets(n.widgets);
    });
  }, [id]);

  const persist = useCallback(
    (next: { title?: string; body?: string; widgets?: NoteWidget[] }) => {
      if (!id) return;
      setSaveState("saving");
      const refs = extractRefs(next.body ?? body);
      updateNote(id, {
        title: next.title ?? title,
        body: next.body ?? body,
        refs,
        widgets: (next.widgets ?? widgets).map((w) => ({ id: w.id, widgetType: w.widgetType, config: w.config, size: w.size, position: w.position })),
      })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("unsaved"));
    },
    [id, body, title, widgets],
  );

  function scheduleSave(next: { title?: string; body?: string; widgets?: NoteWidget[] }) {
    setSaveState("unsaved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 600);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    scheduleSave({ title: value });
  }

  function handleBodyChange(value: string) {
    setBody(value);
    scheduleSave({ body: value });
  }

  function insertWidget(widgetType: string) {
    const next: NoteWidget = { id: crypto.randomUUID(), widgetType, config: {}, size: "medium", position: widgets.length };
    const nextWidgets = [...widgets, next];
    setWidgets(nextWidgets);
    setShowWidgetMenu(false);
    scheduleSave({ widgets: nextWidgets });
  }

  function resizeWidget(widgetId: string, size: NoteWidgetSize) {
    const nextWidgets = widgets.map((w) => (w.id === widgetId ? { ...w, size } : w));
    setWidgets(nextWidgets);
    scheduleSave({ widgets: nextWidgets });
  }

  function removeWidget(widgetId: string) {
    const nextWidgets = widgets.filter((w) => w.id !== widgetId);
    setWidgets(nextWidgets);
    scheduleSave({ widgets: nextWidgets });
  }

  async function handleDelete() {
    if (!id) return;
    await deleteNote(id);
    navigate("/notes");
  }

  const referenced = useMemo(() => resolveReferences(body, snapshot), [body, snapshot]);

  if (!note) {
    return <div className="flex h-screen w-screen items-center justify-center text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen w-full bg-paper">
      <header
        className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-6 py-3 backdrop-blur transition-[padding-right] duration-150 ease-in-out"
        style={{ paddingRight: railExpanded ? 288 + 24 : undefined }}
      >
        <button type="button" onClick={() => navigate("/notes")} className="flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Notes
        </button>
        <div className="flex items-center gap-4">
          <SaveIndicator state={saveState} />
          <button type="button" onClick={handleDelete} className="text-[13px] font-semibold text-muted hover:text-danger-500">
            Delete
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] px-6 pb-32 pt-10">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled note"
          className="w-full border-none bg-transparent text-3xl font-extrabold tracking-display text-ink outline-none placeholder:text-muted"
        />
        <p className="mt-1.5 text-[12.5px] text-muted">
          {new Date(note.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
        </p>

        <div className="mt-6">
          {widgets
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((w) => (
              <NoteWidgetBlock key={w.id} widget={w} onResize={(size) => resizeWidget(w.id, size)} onRemove={() => removeWidget(w.id)} />
            ))}
        </div>

        <div className="relative mt-2">
          <NoteEditor body={body} onChange={handleBodyChange} snapshot={snapshot} placeholder='Write freely. Type "/" to reference a data point, sleeve or version.' autoFocus />

          <div className="relative mt-6 inline-block">
            <button
              type="button"
              onClick={() => setShowWidgetMenu((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12.5px] font-semibold text-muted hover:border-ink hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
              Add widget
            </button>
            {showWidgetMenu && (
              <div className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-paper shadow-xl">
                <button type="button" onClick={() => insertWidget("allocation")} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-paper-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-lilac text-[11px] font-bold text-indigo">A</span>
                  <span>
                    <div className="text-[13px] font-semibold text-ink">Allocation bar</div>
                    <div className="text-[11px] text-muted">Live, resizable</div>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ReferenceRail referenced={referenced} expanded={railExpanded} onExpandedChange={setRailExpanded} />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved" : "Saved";
  const dotClass = state === "saved" ? "bg-brand-500" : state === "saving" ? "bg-warn-200" : "bg-danger-500";
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function resolveReferences(body: string, snapshot: Snapshot | null): MentionCandidate[] {
  const refs = extractRefs(body);
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
