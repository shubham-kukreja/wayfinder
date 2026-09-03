import type Database from "better-sqlite3";
import type { Params } from "@wayfinder/engine";

export function saveParams(db: Database.Database, id: string, params: Params, label: string | null, createdAt: string): void {
  db.prepare(
    `
    INSERT INTO params (id, json, label, created_at)
    VALUES (@id, @json, @label, @createdAt)
    ON CONFLICT (id) DO UPDATE SET json = excluded.json, label = excluded.label, created_at = excluded.created_at
    `
  ).run({ id, json: JSON.stringify(params), label, createdAt });
}

export function loadParams(db: Database.Database, id: string): Params | undefined {
  const row = db.prepare(`SELECT json FROM params WHERE id = ?`).get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Params) : undefined;
}

export function loadCurrentParams(db: Database.Database): Params | undefined {
  return loadParams(db, "current");
}
