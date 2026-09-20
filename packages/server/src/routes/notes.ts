import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  listNotesByEntity,
  updateNote,
  type NoteEntityType,
  type NoteReference,
  type NoteWidget,
} from "../store/notes.js";
import { loadConfig } from "../config.js";

const ENTITY_TYPES: NoteEntityType[] = ["datapoint", "sleeve", "signal", "rubric", "snapshot"];
const WIDGET_SIZES: NoteWidget["size"][] = ["small", "medium", "full"];

interface RefBody {
  entityType?: string;
  entityId?: string;
  position?: number;
}

interface WidgetBody {
  id?: string;
  widgetType?: string;
  config?: unknown;
  size?: string;
  position?: number;
}

interface NoteBody {
  title?: string | null;
  body?: string;
  author?: string;
  refs?: RefBody[];
  widgets?: WidgetBody[];
}

function parseRefs(raw: RefBody[] | undefined): NoteReference[] | undefined {
  if (raw === undefined) return undefined;
  return raw.map((r, i) => {
    if (typeof r.entityType !== "string" || !ENTITY_TYPES.includes(r.entityType as NoteEntityType)) {
      throw new Error(`Each ref needs an 'entityType' of ${ENTITY_TYPES.join(", ")}.`);
    }
    if (typeof r.entityId !== "string" || r.entityId.length === 0) {
      throw new Error("Each ref needs a non-empty string 'entityId'.");
    }
    return { entityType: r.entityType as NoteEntityType, entityId: r.entityId, position: r.position ?? i };
  });
}

function parseWidgets(raw: WidgetBody[] | undefined): Array<Omit<NoteWidget, "id"> & { id?: string }> | undefined {
  if (raw === undefined) return undefined;
  return raw.map((w, i) => {
    if (typeof w.widgetType !== "string" || w.widgetType.length === 0) {
      throw new Error("Each widget needs a non-empty string 'widgetType'.");
    }
    const size = (w.size ?? "medium") as NoteWidget["size"];
    if (!WIDGET_SIZES.includes(size)) {
      throw new Error(`'size', if given, must be one of ${WIDGET_SIZES.join(", ")}.`);
    }
    return { id: w.id, widgetType: w.widgetType, config: w.config ?? {}, size, position: w.position ?? i };
  });
}

// Notes are a standalone workspace: freeform text that can mention any
// number of data points, sleeves, signals, rubrics or past versions (see
// store/notes.ts), plus embedded widgets like a live allocation bar.
export function registerNotesRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string; entityType?: string; entityId?: string } }>("/api/notes", async (req, reply) => {
    const { q, entityType, entityId } = req.query;
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      if (entityType || entityId) {
        if (!entityType || !entityId) {
          reply.code(400);
          return { error: "Both 'entityType' and 'entityId' are required together." };
        }
        if (!ENTITY_TYPES.includes(entityType as NoteEntityType)) {
          reply.code(400);
          return { error: `'entityType' must be one of ${ENTITY_TYPES.join(", ")}.` };
        }
        return { notes: listNotesByEntity(db, entityType as NoteEntityType, entityId) };
      }
      return { notes: listNotes(db, q) };
    } finally {
      db.close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/notes/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const note = getNote(db, req.params.id);
      if (!note) {
        reply.code(404);
        return { error: `No note with id '${req.params.id}'.` };
      }
      return note;
    } finally {
      db.close();
    }
  });

  app.post<{ Body: NoteBody }>("/api/notes", async (req, reply) => {
    const { title, body, author, refs, widgets } = req.body ?? ({} as NoteBody);
    if (typeof body !== "string") {
      reply.code(400);
      return { error: "Body must include a string 'body' (the note text)." };
    }

    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const note = createNote(db, { title: title ?? null, body, author: author ?? null, refs: parseRefs(refs), widgets: parseWidgets(widgets) });
      reply.code(201);
      return note;
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  app.patch<{ Params: { id: string }; Body: NoteBody }>("/api/notes/:id", async (req, reply) => {
    const { title, body, refs, widgets } = req.body ?? ({} as NoteBody);
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const note = updateNote(db, req.params.id, { title, body, refs: parseRefs(refs), widgets: parseWidgets(widgets) });
      if (!note) {
        reply.code(404);
        return { error: `No note with id '${req.params.id}'.` };
      }
      return note;
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  });

  app.delete<{ Params: { id: string } }>("/api/notes/:id", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    try {
      const removed = deleteNote(db, req.params.id);
      if (!removed) {
        reply.code(404);
        return { error: `No note with id '${req.params.id}'.` };
      }
      reply.code(204);
      return null;
    } finally {
      db.close();
    }
  });
}
