import { API_BASE_URL } from "./constants.js";
import { apiFetch, apiFetchJson } from "./apiFetch.js";

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

export async function listNotes(search?: string): Promise<NoteListItem[]> {
  const query = search ? `?q=${encodeURIComponent(search)}` : "";
  const res = await fetch(`${API_BASE_URL}/api/notes${query}`);
  if (!res.ok) throw new Error(`Failed to load notes: ${res.status}`);
  const data = (await res.json()) as { notes: NoteListItem[] };
  return data.notes;
}

export async function listNotesByEntity(entityType: NoteEntityType, entityId: string): Promise<NoteListItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/notes?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
  if (!res.ok) throw new Error(`Failed to load notes: ${res.status}`);
  const data = (await res.json()) as { notes: NoteListItem[] };
  return data.notes;
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetch(`${API_BASE_URL}/api/notes/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to load note: ${res.status}`);
  return res.json();
}

export interface NoteInput {
  title?: string | null;
  body: string;
  author?: string | null;
  refs?: NoteReference[];
}

export async function createNote(input: NoteInput): Promise<Note> {
  const res = await apiFetchJson("/api/notes", "POST", input);
  if (!res.ok) throw new Error(`Failed to create note: ${res.status}`);
  return res.json();
}

export async function updateNote(id: string, input: Partial<NoteInput>): Promise<Note> {
  const res = await apiFetchJson(`/api/notes/${encodeURIComponent(id)}`, "PATCH", input);
  if (!res.ok) throw new Error(`Failed to save note: ${res.status}`);
  return res.json();
}

export async function deleteNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete note: ${res.status}`);
}
