import type { NoteEntityType } from "./notesApi.js";

// A mention is stored in the note body as a plain-text token —
// {{datapoint:l1.equity::valuation}} — rather than as HTML. That keeps the
// body a plain string (easy to store, diff, and search with a LIKE query)
// while still letting the editor render each token as a live chip and pull
// out exactly which entities a note references.
const TOKEN_RE = /\{\{(datapoint|sleeve|signal|rubric|snapshot):([^{}]+)\}\}/g;

export interface ParsedSegment {
  type: "text" | "mention";
  text?: string;
  entityType?: NoteEntityType;
  entityId?: string;
}

export function mentionToken(entityType: NoteEntityType, entityId: string): string {
  return `{{${entityType}:${entityId}}}`;
}

export function parseBody(body: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(body))) {
    if (match.index > lastIndex) segments.push({ type: "text", text: body.slice(lastIndex, match.index) });
    segments.push({ type: "mention", entityType: match[1] as NoteEntityType, entityId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ type: "text", text: body.slice(lastIndex) });
  return segments;
}

export function extractRefs(body: string): Array<{ entityType: NoteEntityType; entityId: string; position: number }> {
  const refs: Array<{ entityType: NoteEntityType; entityId: string; position: number }> = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let position = 0;
  while ((match = TOKEN_RE.exec(body))) {
    refs.push({ entityType: match[1] as NoteEntityType, entityId: match[2]!, position: position++ });
  }
  return refs;
}
