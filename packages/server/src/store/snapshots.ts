import type Database from "better-sqlite3";
import type { Snapshot } from "@wayfinder/engine";
import { randomUUID } from "node:crypto";

export function saveSnapshot(db: Database.Database, snapshot: Snapshot, label: string | null, isReview: boolean): string {
  const id = randomUUID();
  db.prepare(
    `
    INSERT INTO snapshots (id, label, json, is_review, created_at)
    VALUES (@id, @label, @json, @isReview, @createdAt)
    `
  ).run({
    id,
    label,
    json: JSON.stringify(snapshot),
    isReview: isReview ? 1 : 0,
    createdAt: snapshot.asOf,
  });
  return id;
}

export function listSnapshots(db: Database.Database, reviewsOnly = false): Array<{ id: string; label: string | null; createdAt: string; isReview: boolean }> {
  const rows = db
    .prepare(
      `SELECT id, label, created_at as createdAt, is_review as isReview FROM snapshots ${reviewsOnly ? "WHERE is_review = 1" : ""} ORDER BY created_at DESC`
    )
    .all() as Array<{ id: string; label: string | null; createdAt: string; isReview: number }>;
  return rows.map((r) => ({ ...r, isReview: r.isReview === 1 }));
}

export function getSnapshot(db: Database.Database, id: string): Snapshot | undefined {
  const row = db.prepare(`SELECT json FROM snapshots WHERE id = ?`).get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Snapshot) : undefined;
}

export function latestReview(db: Database.Database): Snapshot | undefined {
  const row = db.prepare(`SELECT json FROM snapshots WHERE is_review = 1 ORDER BY created_at DESC LIMIT 1`).get() as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as Snapshot) : undefined;
}
