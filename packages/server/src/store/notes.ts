import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// A note stands on its own — it isn't filed "under" any one data point,
// sleeve or snapshot. Anything it discusses is recorded as a reference
// instead (see note_refs in schema.ts), so a note can mention several
// entities, or none, and any entity can ask "which notes mention me".
export type NoteEntityType = "datapoint" | "sleeve" | "signal" | "rubric" | "snapshot";

export interface NoteReference {
  entityType: NoteEntityType;
  entityId: string;
  position: number;
}

export interface NoteWidget {
  id: string;
  widgetType: string;
  config: unknown;
  size: "small" | "medium" | "full";
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
  widgets: NoteWidget[];
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

interface NoteRow {
  id: string;
  title: string | null;
  body: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

function readRefs(db: Database.Database, noteId: string): NoteReference[] {
  return db
    .prepare(`SELECT entity_type as entityType, entity_id as entityId, position FROM note_refs WHERE note_id = ? ORDER BY position ASC`)
    .all(noteId) as NoteReference[];
}

function readWidgets(db: Database.Database, noteId: string): NoteWidget[] {
  const rows = db
    .prepare(`SELECT id, widget_type as widgetType, config_json as configJson, size, position FROM note_widgets WHERE note_id = ? ORDER BY position ASC`)
    .all(noteId) as Array<{ id: string; widgetType: string; configJson: string; size: NoteWidget["size"]; position: number }>;
  return rows.map((r) => ({ id: r.id, widgetType: r.widgetType, config: JSON.parse(r.configJson), size: r.size, position: r.position }));
}

function writeRefs(db: Database.Database, noteId: string, refs: NoteReference[]): void {
  db.prepare(`DELETE FROM note_refs WHERE note_id = ?`).run(noteId);
  const insert = db.prepare(`INSERT INTO note_refs (note_id, entity_type, entity_id, position) VALUES (?, ?, ?, ?)`);
  for (const ref of refs) insert.run(noteId, ref.entityType, ref.entityId, ref.position);
}

function writeWidgets(db: Database.Database, noteId: string, widgets: Array<Omit<NoteWidget, "id"> & { id?: string }>): NoteWidget[] {
  db.prepare(`DELETE FROM note_widgets WHERE note_id = ?`).run(noteId);
  const insert = db.prepare(`INSERT INTO note_widgets (id, note_id, widget_type, config_json, size, position) VALUES (?, ?, ?, ?, ?, ?)`);
  return widgets.map((w) => {
    const id = w.id ?? randomUUID();
    insert.run(id, noteId, w.widgetType, JSON.stringify(w.config ?? {}), w.size, w.position);
    return { id, widgetType: w.widgetType, config: w.config ?? {}, size: w.size, position: w.position };
  });
}

export interface CreateNoteInput {
  title?: string | null;
  body: string;
  author?: string | null;
  refs?: NoteReference[];
  widgets?: Array<Omit<NoteWidget, "id">>;
}

export function createNote(db: Database.Database, input: CreateNoteInput): Note {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO notes (id, title, body, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    input.title ?? null,
    input.body,
    input.author ?? null,
    now,
    now,
  );
  writeRefs(db, id, input.refs ?? []);
  const widgets = writeWidgets(db, id, input.widgets ?? []);
  return { id, title: input.title ?? null, body: input.body, author: input.author ?? null, createdAt: now, updatedAt: now, refs: input.refs ?? [], widgets };
}

export interface UpdateNoteInput {
  title?: string | null;
  body?: string;
  refs?: NoteReference[];
  widgets?: Array<Omit<NoteWidget, "id"> & { id?: string }>;
}

export function updateNote(db: Database.Database, id: string, input: UpdateNoteInput): Note | undefined {
  const existing = db.prepare(`SELECT id, title, body, author, created_at as createdAt, updated_at as updatedAt FROM notes WHERE id = ?`).get(id) as
    | NoteRow
    | undefined;
  if (!existing) return undefined;

  const now = new Date().toISOString();
  const title = input.title !== undefined ? input.title : existing.title;
  const body = input.body !== undefined ? input.body : existing.body;
  db.prepare(`UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?`).run(title, body, now, id);

  if (input.refs !== undefined) writeRefs(db, id, input.refs);
  const widgets = input.widgets !== undefined ? writeWidgets(db, id, input.widgets) : readWidgets(db, id);

  return {
    id,
    title,
    body,
    author: existing.author,
    createdAt: existing.createdAt,
    updatedAt: now,
    refs: input.refs !== undefined ? input.refs : readRefs(db, id),
    widgets,
  };
}

export function getNote(db: Database.Database, id: string): Note | undefined {
  const row = db.prepare(`SELECT id, title, body, author, created_at as createdAt, updated_at as updatedAt FROM notes WHERE id = ?`).get(id) as
    | NoteRow
    | undefined;
  if (!row) return undefined;
  return { ...row, refs: readRefs(db, id), widgets: readWidgets(db, id) };
}

export function deleteNote(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
  return result.changes > 0;
}

// Newest-first, optionally filtered by a case-insensitive substring match on
// title or body — this backs both the plain "recent notes" list and the
// search box on the same page.
export function listNotes(db: Database.Database, search?: string): NoteListItem[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.body, n.author, n.created_at as createdAt, n.updated_at as updatedAt,
              (SELECT COUNT(*) FROM note_refs r WHERE r.note_id = n.id) as refCount
       FROM notes n
       ${search ? "WHERE n.title LIKE @q OR n.body LIKE @q" : ""}
       ORDER BY n.updated_at DESC`,
    )
    .all(search ? { q: `%${search}%` } : {}) as NoteListItem[];
  return rows;
}

// Reverse lookup: every note that mentions a given entity, newest first.
// This is what lets a data point's own page show "referenced in 4 notes"
// without the entity needing to know about notes at all.
export function listNotesByEntity(db: Database.Database, entityType: NoteEntityType, entityId: string): NoteListItem[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.body, n.author, n.created_at as createdAt, n.updated_at as updatedAt,
              (SELECT COUNT(*) FROM note_refs r2 WHERE r2.note_id = n.id) as refCount
       FROM notes n
       JOIN note_refs r ON r.note_id = n.id
       WHERE r.entity_type = ? AND r.entity_id = ?
       ORDER BY n.updated_at DESC`,
    )
    .all(entityType, entityId) as NoteListItem[];
  return rows;
}

// Counts per entity in one query, so a list view (e.g. Data Point Control
// Center) can show "N notes" on every row without one query per row.
export function countNotesByEntity(db: Database.Database, entityType: NoteEntityType): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT r.entity_id as entityId, COUNT(DISTINCT r.note_id) as count
       FROM note_refs r WHERE r.entity_type = ? GROUP BY r.entity_id`,
    )
    .all(entityType) as Array<{ entityId: string; count: number }>;
  return Object.fromEntries(rows.map((r) => [r.entityId, r.count]));
}
