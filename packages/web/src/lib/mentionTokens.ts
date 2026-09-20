import type { NoteEntityType, NoteWidgetSize } from "./notesApi.js";

// Both a mention and a widget live in the note body as a plain-text token —
// {{datapoint:l1.equity::valuation}} or {{widget:allocation:medium:<id>}} —
// rather than as HTML or a separate ordered list. That keeps the whole note
// (text AND widget placement) a single plain string: easy to store, diff,
// and search with a LIKE query, and it's what lets a widget sit anywhere in
// the text a mention could — including mid-paragraph — because it's woven
// into the same linear stream instead of bolted on as a block appended
// after the text.
const MENTION_RE = /\{\{(datapoint|sleeve|signal|rubric|snapshot):([^{}]+)\}\}/g;
const WIDGET_RE = /\{\{widget:([\w-]+):(small|medium|large|full):([\w-]+)\}\}/g;
const TOKEN_RE = /\{\{(?:(datapoint|sleeve|signal|rubric|snapshot):([^{}]+)|widget:([\w-]+):(small|medium|large|full):([\w-]+))\}\}/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;

export type LineKind = "heading" | "bullet" | null;

export interface ParsedSegment {
  type: "text" | "mention" | "widget" | "bold" | "newline";
  text?: string;
  entityType?: NoteEntityType;
  entityId?: string;
  widgetType?: string;
  widgetSize?: NoteWidgetSize;
  widgetId?: string;
}

export function mentionToken(entityType: NoteEntityType, entityId: string): string {
  return `{{${entityType}:${entityId}}}`;
}

export function widgetToken(widgetType: string, size: NoteWidgetSize, widgetId: string): string {
  return `{{widget:${widgetType}:${size}:${widgetId}}}`;
}

// Parses one line's worth of body text (no newlines) into text / mention /
// widget / bold segments — bold is nested one level ({{...}} tokens never
// occur inside a **bold** span, so this two-pass split is enough).
function parseLineSegments(line: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(line))) {
    if (match.index > lastIndex) segments.push(...parseBoldSegments(line.slice(lastIndex, match.index)));
    if (match[1]) {
      segments.push({ type: "mention", entityType: match[1] as NoteEntityType, entityId: match[2] });
    } else {
      segments.push({ type: "widget", widgetType: match[3], widgetSize: match[4] as NoteWidgetSize, widgetId: match[5] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) segments.push(...parseBoldSegments(line.slice(lastIndex)));
  return segments;
}

function parseBoldSegments(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  BOLD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOLD_RE.exec(text))) {
    if (match.index > lastIndex) segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    segments.push({ type: "bold", text: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", text: text.slice(lastIndex) });
  return segments;
}

export interface ParsedLine {
  kind: LineKind;
  segments: ParsedSegment[];
}

// Splits the whole body into lines first (a heading/bullet marker only
// means anything at the very start of a line) and parses each line's
// content separately — the newline characters between lines are not part
// of any line's own segment list, since the caller (NoteEditor's
// renderSegments) re-inserts a <br> between lines itself.
export function parseLines(body: string): ParsedLine[] {
  return body.split("\n").map((line) => {
    const headingMatch = /^# (.*)$/.exec(line);
    if (headingMatch) return { kind: "heading" as const, segments: parseLineSegments(headingMatch[1]!) };
    const bulletMatch = /^[-*] (.*)$/.exec(line);
    if (bulletMatch) return { kind: "bullet" as const, segments: parseLineSegments(bulletMatch[1]!) };
    return { kind: null, segments: parseLineSegments(line) };
  });
}


export function extractRefs(body: string): Array<{ entityType: NoteEntityType; entityId: string; position: number }> {
  const refs: Array<{ entityType: NoteEntityType; entityId: string; position: number }> = [];
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let position = 0;
  while ((match = MENTION_RE.exec(body))) {
    refs.push({ entityType: match[1] as NoteEntityType, entityId: match[2]!, position: position++ });
  }
  return refs;
}

export interface ExtractedWidget {
  id: string;
  widgetType: string;
  size: NoteWidgetSize;
  position: number;
}

// Widget "position" here is the widget's ordinal within the body (its
// left-to-right order among tokens), not a stored layout index — moving a
// widget in the text by editing simply changes where it's found next parse.
export function extractWidgets(body: string): ExtractedWidget[] {
  const widgets: ExtractedWidget[] = [];
  WIDGET_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let position = 0;
  while ((match = WIDGET_RE.exec(body))) {
    widgets.push({ widgetType: match[1]!, size: match[2] as NoteWidgetSize, id: match[3]!, position: position++ });
  }
  return widgets;
}
