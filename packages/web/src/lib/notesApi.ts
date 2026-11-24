import { coreFetch } from "./coreApi.js";

// Notes live in core-jobs-service (/v1/notes), copied from the legacy server
// with the same shape. The types below are the ones the screens already use;
// this module maps them to and from the /v1 wire format.

export type NoteEntityType = "datapoint" | "sleeve" | "signal" | "rubric" | "snapshot";
export type NoteWidgetSize = "small" | "medium" | "large" | "full";

export interface NoteReference {
  entityType: NoteEntityType;
  entityId: string;
  position: number;
}

// A widget has no row of its own — it's a "widget" block in the note's
// BlockNote document, same as a mention is an inline node within a text
// block. This type describes one pulled out of the body (see
// lib/noteRefs.ts), not a server record.
export interface NoteWidget {
  id: string;
  widgetType: string;
  size: NoteWidgetSize;
  position: number;
}

export interface Note {
  id: string;
  title: string | null;
  body: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  refs: NoteReference[];
}

export interface NoteListItem {
  id: string;
  title: string | null;
  body: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  refCount: number;
}

// ---- /v1 wire format ----

interface WireRef {
  kind: string;
  key: string;
  position: number;
}

interface WireNote {
  id: string;
  title: string | null;
  body: string;
  author: { id: string; name: string };
  refs: WireRef[];
  created_at: string;
  updated_at: string;
}

const EDITOR_KINDS: ReadonlySet<string> = new Set<NoteEntityType>(["datapoint", "sleeve", "signal", "rubric", "snapshot"]);

function fromWire(n: WireNote): Note {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    author: n.author.name,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    // Kinds the editor has no mention type for (set by other /v1 clients)
    // are left out rather than shown as broken mentions.
    refs: n.refs
      .filter((r) => EDITOR_KINDS.has(r.kind))
      .map((r) => ({ entityType: r.kind as NoteEntityType, entityId: r.key, position: r.position })),
  };
}

function toListItem(n: WireNote): NoteListItem {
  const { refs: _refs, ...rest } = fromWire(n);
  return { ...rest, refCount: n.refs.length };
}

function toWire(input: Partial<NoteInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined) out.title = input.title;
  if (input.body !== undefined) out.body = input.body;
  if (input.refs !== undefined) out.refs = input.refs.map((r) => ({ kind: r.entityType, key: r.entityId, position: r.position }));
  return out;
}

// Lists are paged on the server; the notes screen shows them all, so this
// follows the cursor (bounded, as a guard).
async function listAll(params: URLSearchParams): Promise<NoteListItem[]> {
  const out: NoteListItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams(params);
    q.set("limit", "200");
    if (cursor) q.set("cursor", cursor);
    const res: { data: WireNote[]; next_cursor: string | null } = await coreFetch(`/v1/notes?${q}`);
    out.push(...res.data.map(toListItem));
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export async function listNotes(search?: string): Promise<NoteListItem[]> {
  const q = new URLSearchParams();
  if (search) q.set("q", search.slice(0, 100));
  return listAll(q);
}

export async function listNotesByEntity(entityType: NoteEntityType, entityId: string): Promise<NoteListItem[]> {
  return listAll(new URLSearchParams({ ref_kind: entityType, ref_key: entityId }));
}

export async function getNote(id: string): Promise<Note> {
  return fromWire(await coreFetch<WireNote>(`/v1/notes/${encodeURIComponent(id)}`));
}

export interface NoteInput {
  title?: string | null;
  body: string;
  /** Ignored: the server records the signed-in user as the author. */
  author?: string | null;
  refs?: NoteReference[];
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function createNote(input: NoteInput): Promise<Note> {
  return fromWire(await coreFetch<WireNote>("/v1/notes", json("POST", toWire(input))));
}

export async function updateNote(id: string, input: Partial<NoteInput>): Promise<Note> {
  return fromWire(await coreFetch<WireNote>(`/v1/notes/${encodeURIComponent(id)}`, json("PATCH", toWire(input))));
}

export async function deleteNote(id: string): Promise<void> {
  await coreFetch<void>(`/v1/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
}
