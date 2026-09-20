import { useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote, SuggestionMenuController, type DefaultReactSuggestionItem } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { Snapshot } from "@wayfinder/engine";
import { noteSchema, mentionInlineContent, type NoteBlock } from "./blocknoteSchema.js";
import { buildSnapshotCandidates, fetchSnapshotVersionCandidates, filterCandidates, type MentionCandidate } from "../../lib/mentionIndex.js";
import { legacyBodyToBlocks } from "../../lib/legacyNoteMigration.js";
import { WIDGET_TITLES } from "./NoteWidgetBlock.js";

// BlockNote is the editor now (see MEMORY / commit history for why:
// dragging a widget or a paragraph anywhere in the note, and undo/redo,
// both come from BlockNote's own block model and ProseMirror history
// instead of the hand-rolled contentEditable + DOM-surgery approach this
// replaced). A note's `body` is stored as this editor's JSON block array,
// serialized to a string for the same `body: string` column the server has
// always had — the server treats it as opaque either way (see
// routes/notes.ts). A note saved by the *old* editor has a body that's
// still the legacy `{{token}}` string; isBlockNoteBody below tells the two
// apart, and legacyBodyToBlocks does the one-time conversion on read. The
// note re-saves in the new format on its very next autosave.
function isBlockNoteBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith("[") || trimmed.length === 0;
}

export function serializeNoteBody(blocks: NoteBlock[]): string {
  return JSON.stringify(blocks);
}

function parseNoteBody(body: string, candidateById: Map<string, MentionCandidate>): unknown[] {
  if (!body.trim()) return [{ type: "paragraph", content: [] }];
  if (isBlockNoteBody(body)) {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Falls through to legacy parsing — a body that merely starts with
      // "[" by coincidence (it doesn't, in practice) would land here too.
    }
  }
  return legacyBodyToBlocks(body, candidateById);
}

export function NoteEditor({
  body,
  onChange,
  snapshot,
  placeholder,
  autoFocus,
}: {
  body: string;
  onChange: (body: string) => void;
  snapshot: Snapshot | null;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const localCandidates = useMemo(() => (snapshot ? buildSnapshotCandidates(snapshot) : []), [snapshot]);
  const [versionCandidates, setVersionCandidates] = useState<MentionCandidate[]>([]);
  useEffect(() => {
    fetchSnapshotVersionCandidates().then(setVersionCandidates).catch(() => {});
  }, []);
  const candidates = useMemo(() => [...localCandidates, ...versionCandidates], [localCandidates, versionCandidates]);
  const candidateById = useMemo(() => {
    const map = new Map<string, MentionCandidate>();
    for (const c of candidates) map.set(`${c.entityType}:${c.entityId}`, c);
    return map;
  }, [candidates]);

  // The initial document is built once per note (id change, effectively —
  // NoteEditor is remounted by NoteEditorView's `key={id}` — see
  // NoteEditorView.tsx) so typing never fights a re-parse of `body`. A
  // live mention chip's label/value catches up via the repaint effect
  // below instead of a full document replace.
  const initialContent = useMemo(() => parseNoteBody(body, candidateById), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useCreateBlockNote({
    schema: noteSchema,
    initialContent: initialContent as never,
    placeholders: { emptyDocument: placeholder, default: "" },
  });

  const lastSerialized = useRef(serializeNoteBody(editor.document as NoteBlock[]));

  // A legacy note's `body` prop is still the old {{token}} string until the
  // first edit — NoteEditorView's reference rail and refs-on-save both read
  // that raw prop, so without this they'd see no refs at all for a note
  // that's only ever been opened, never edited. Reporting the migrated
  // body once on mount closes that gap and doubles as the note's upgrade
  // to the new format the moment it's viewed.
  useEffect(() => {
    if (!isBlockNoteBody(body)) onChange(lastSerialized.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoFocus) editor.focus();
  }, [autoFocus, editor]);

  // Repaints existing mention chips in place when their live value/label
  // arrives after mount (the snapshot fetch, the versions fetch) — mirrors
  // the previous editor's behavior instead of forcing the whole document
  // to re-render.
  useEffect(() => {
    if (candidateById.size === 0) return;
    for (const block of editor.document) {
      if (!Array.isArray(block.content)) continue;
      let dirty = false;
      const nextContent = block.content.map((inline) => {
        if (inline.type !== "mention") return inline;
        const props = inline.props as { entityType: string; entityId: string; label: string; value: string; color: string };
        const candidate = candidateById.get(`${props.entityType}:${props.entityId}`);
        if (!candidate) return inline;
        if (candidate.label === props.label && (candidate.value ?? "") === props.value && candidate.color === props.color) return inline;
        dirty = true;
        return { ...inline, props: { ...props, label: candidate.label, value: candidate.value ?? "", color: candidate.color } };
      });
      if (dirty) editor.updateBlock(block, { content: nextContent as never });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateById]);

  function handleChange() {
    const next = serializeNoteBody(editor.document as NoteBlock[]);
    if (next === lastSerialized.current) return;
    lastSerialized.current = next;
    onChange(next);
  }

  const mentionItems = useMemo(
    () =>
      (query: string): DefaultReactSuggestionItem[] =>
        filterCandidates(candidates, query).map((c) => ({
          title: c.label,
          subtext: c.meta,
          group: TYPE_GROUP_LABEL[c.entityType],
          onItemClick: () => editor.insertInlineContent([mentionInlineContent(c), " "]),
        })),
    [candidates, editor],
  );

  const widgetItems: DefaultReactSuggestionItem[] = useMemo(
    () =>
      WIDGET_MENU_ITEMS.map((w) => ({
        title: WIDGET_TITLES[w.type] ?? w.type,
        subtext: w.description,
        group: "Widgets",
        onItemClick: () => {
          const widgetId = crypto.randomUUID();
          const currentBlock = editor.getTextCursorPosition().block;
          editor.insertBlocks(
            [{ type: "widget", props: { widgetType: w.type, size: "medium", widgetId } } as never],
            currentBlock,
            currentBlock.content && Array.isArray(currentBlock.content) && currentBlock.content.length > 0 ? "after" : "before",
          );
        },
      })),
    [editor],
  );

  return (
    <div className="note-editor-shell">
      <BlockNoteView editor={editor} onChange={handleChange} theme="light" slashMenu={false} className="wf-blocknote">
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => [...mentionItems(query), ...filterMenuItems(widgetItems, query)]}
        />
      </BlockNoteView>
    </div>
  );
}

const TYPE_GROUP_LABEL: Record<MentionCandidate["entityType"], string> = {
  datapoint: "Data points",
  sleeve: "Sleeves",
  signal: "Asset classes",
  rubric: "Rubrics",
  snapshot: "Versions",
};

const WIDGET_MENU_ITEMS: Array<{ type: string; description: string }> = [
  { type: "allocation", description: "Asset classes and sleeves, live" },
  { type: "heatmap", description: "Signal x asset-class grid, live" },
  { type: "table", description: "Sleeve weights as a plain table, live" },
  { type: "status", description: "Freshness, vetoes, qualifying sectors — one line" },
];

function filterMenuItems(items: DefaultReactSuggestionItem[], query: string): DefaultReactSuggestionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.subtext?.toLowerCase().includes(q));
}
