import type { NoteEntityType } from "./notesApi.js";

// Walks a BlockNote document (as stored: JSON.parse'd blocks, or the
// legacy {{token}} string already migrated into a block array by the
// editor before this ever runs) and pulls out every mention inline node —
// this is what feeds both the server-side `refs` list (for "referenced by"
// lookups) and the note view's own reference rail.
export interface NoteRef {
  entityType: NoteEntityType;
  entityId: string;
  position: number;
}

export function extractRefsFromBody(body: string): NoteRef[] {
  if (!body.trim()) return [];
  let blocks: unknown;
  try {
    blocks = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(blocks)) return [];

  const refs: NoteRef[] = [];
  let position = 0;
  walkBlocks(blocks, (entityType, entityId) => {
    refs.push({ entityType, entityId, position: position++ });
  });
  return refs;
}

function walkBlocks(blocks: unknown[], onMention: (entityType: NoteEntityType, entityId: string) => void): void {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const b = block as { content?: unknown; children?: unknown[] };
    if (Array.isArray(b.content)) {
      for (const inline of b.content) {
        if (inline && typeof inline === "object" && (inline as { type?: string }).type === "mention") {
          const props = (inline as { props?: { entityType?: string; entityId?: string } }).props;
          if (props?.entityType && props.entityId) onMention(props.entityType as NoteEntityType, props.entityId);
        }
      }
    }
    if (Array.isArray(b.children) && b.children.length > 0) walkBlocks(b.children, onMention);
  }
}

// Flattens a stored body (BlockNote JSON, or an unmigrated legacy
// {{token}} string — see NotesView's list preview, the one place a note's
// body is shown without ever going through the editor) into plain text for
// a one-line snippet.
export function bodyToPlainText(body: string): string {
  if (!body.trim()) return "";
  let blocks: unknown;
  try {
    blocks = JSON.parse(body);
  } catch {
    return legacyBodyToPlainText(body);
  }
  if (!Array.isArray(blocks)) return legacyBodyToPlainText(body);

  const parts: string[] = [];
  const walk = (list: unknown[]) => {
    for (const block of list) {
      if (!block || typeof block !== "object") continue;
      const b = block as { content?: unknown; children?: unknown[] };
      if (Array.isArray(b.content)) {
        for (const inline of b.content) {
          if (!inline || typeof inline !== "object") continue;
          const i = inline as { type?: string; text?: string; props?: { label?: string } };
          if (i.type === "text" && i.text) parts.push(i.text);
          else if (i.type === "mention" && i.props?.label) parts.push(i.props.label);
        }
      }
      if (Array.isArray(b.children) && b.children.length > 0) walk(b.children);
    }
  };
  walk(blocks);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function legacyBodyToPlainText(body: string): string {
  const withoutWidgets = body.replace(/\{\{widget:[\w-]+:(?:small|medium|large|full):[\w-]+\}\}/g, "");
  const withoutTokens = withoutWidgets.replace(/\{\{(?:datapoint|sleeve|signal|rubric|snapshot):([^{}]+)\}\}/g, "$1");
  const withoutMarkdown = withoutTokens
    .split("\n")
    .map((line) => line.replace(/^#\s+/, "").replace(/^[-*]\s+/, ""))
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1");
  return withoutMarkdown.replace(/\s+/g, " ").trim();
}

export interface ExtractedWidgetRef {
  widgetId: string;
  widgetType: string;
}

export function extractWidgetsFromBody(body: string): ExtractedWidgetRef[] {
  if (!body.trim()) return [];
  let blocks: unknown;
  try {
    blocks = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(blocks)) return [];

  const widgets: ExtractedWidgetRef[] = [];
  const walk = (list: unknown[]) => {
    for (const block of list) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: string; props?: { widgetType?: string; widgetId?: string }; children?: unknown[] };
      if (b.type === "widget" && b.props?.widgetId && b.props.widgetType) {
        widgets.push({ widgetId: b.props.widgetId, widgetType: b.props.widgetType });
      }
      if (Array.isArray(b.children) && b.children.length > 0) walk(b.children);
    }
  };
  walk(blocks);
  return widgets;
}
