import { parseLines, type ParsedSegment } from "./mentionTokens.js";
import type { MentionCandidate } from "./mentionIndex.js";
import type { NoteEntityType, NoteWidgetSize } from "./notesApi.js";

// One-time, read-path-only conversion from the old editor's plain-text
// token body ("# heading\n- bullet {{datapoint:x}} {{widget:table:full:id}}")
// into BlockNote's block tree. Runs whenever a note is opened whose stored
// body doesn't already parse as BlockNote JSON (see isBlockNoteBody in
// NoteEditor) — the note is re-saved in the new format the next time it
// autosaves, so this only ever runs once per note.
export function legacyBodyToBlocks(body: string, candidateById: Map<string, MentionCandidate>): unknown[] {
  const lines = parseLines(body);
  const blocks: unknown[] = [];

  for (const line of lines) {
    // A widget token that was the entire line (the common case — widgets
    // render as their own block, never sharing a line with text) becomes a
    // widget block; otherwise the line becomes a paragraph/heading/bullet
    // with inline content.
    const onlyWidget = line.segments.length === 1 && line.segments[0]!.type === "widget";
    if (onlyWidget) {
      const seg = line.segments[0]!;
      blocks.push({
        type: "widget",
        props: { widgetType: seg.widgetType, size: seg.widgetSize as NoteWidgetSize, widgetId: seg.widgetId },
      });
      continue;
    }

    const content = line.segments.flatMap((seg) => segmentToInline(seg, candidateById));
    if (line.kind === "heading") {
      blocks.push({ type: "heading", props: { level: 2 }, content });
    } else if (line.kind === "bullet") {
      blocks.push({ type: "bulletListItem", content });
    } else if (content.length > 0) {
      blocks.push({ type: "paragraph", content });
    } else {
      blocks.push({ type: "paragraph", content: [] });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }];
}

function segmentToInline(seg: ParsedSegment, candidateById: Map<string, MentionCandidate>): unknown[] {
  if (seg.type === "text") {
    return seg.text ? [{ type: "text", text: seg.text, styles: {} }] : [];
  }
  if (seg.type === "bold") {
    return [{ type: "text", text: seg.text ?? "", styles: { bold: true } }];
  }
  if (seg.type === "mention" && seg.entityType && seg.entityId) {
    const candidate = candidateById.get(`${seg.entityType}:${seg.entityId}`);
    return [
      {
        type: "mention",
        props: {
          entityType: seg.entityType as NoteEntityType,
          entityId: seg.entityId,
          label: candidate?.label ?? seg.entityId,
          value: candidate?.value ?? "",
          color: candidate?.color ?? "#8A8A90",
        },
      },
    ];
  }
  // A widget token stranded mid-line (rare — the editor always inserted
  // widgets as their own line) is dropped rather than rendered inline;
  // BlockNote widget blocks are block-level only.
  return [];
}
