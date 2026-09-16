import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./schema.js";

export function openDb(path: string): Database.Database {
  // better-sqlite3 creates a missing database FILE but not its parent
  // directory — a missing one fails every request with the opaque
  // "Cannot open database because the directory does not exist". That bites
  // on a fresh deploy whose volume mount path and DB_PATH don't line up, so
  // create the directory rather than 500 on every route.
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
