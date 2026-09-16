import type Database from "better-sqlite3";
import type { Snapshot } from "@wayfinder/engine";
import { randomUUID } from "node:crypto";

export interface SaveSnapshotOptions {
  isReview: boolean;
  parentId?: string | null;
  published?: boolean;
  actor?: string | null;
  reason?: string | null;
}

export interface SnapshotListItem {
  id: string;
  label: string | null;
  createdAt: string;
  isReview: boolean;
  parentId: string | null;
  published: boolean;
  actor: string | null;
  reason: string | null;
}

export function saveSnapshot(db: Database.Database, snapshot: Snapshot, label: string | null, isReviewOrOptions: boolean | SaveSnapshotOptions): string {
  const options: SaveSnapshotOptions =
    typeof isReviewOrOptions === "boolean"
      ? { isReview: isReviewOrOptions, published: false, parentId: null, actor: null, reason: null }
      : isReviewOrOptions;
  const id = randomUUID();
  db.prepare(
    `
    INSERT INTO snapshots (id, label, json, is_review, parent_id, published, actor, reason, created_at)
    VALUES (@id, @label, @json, @isReview, @parentId, @published, @actor, @reason, @createdAt)
    `
  ).run({
    id,
    label,
    json: JSON.stringify(snapshot),
    isReview: options.isReview ? 1 : 0,
    parentId: options.parentId ?? null,
    published: options.published ? 1 : 0,
    actor: options.actor ?? null,
    reason: options.reason ?? null,
    createdAt: snapshot.asOf,
  });
  return id;
}

export function listSnapshots(db: Database.Database, reviewsOnly = false): SnapshotListItem[] {
  const rows = db
    .prepare(
      `SELECT id, label, created_at as createdAt, is_review as isReview, parent_id as parentId, published, actor, reason
       FROM snapshots ${reviewsOnly ? "WHERE is_review = 1" : ""} ORDER BY created_at DESC`
    )
    .all() as Array<{ id: string; label: string | null; createdAt: string; isReview: number; parentId: string | null; published: number; actor: string | null; reason: string | null }>;
  return rows.map((r) => ({ ...r, isReview: r.isReview === 1, published: r.published === 1 }));
}

export function getSnapshot(db: Database.Database, id: string): Snapshot | undefined {
  const row = db.prepare(`SELECT json FROM snapshots WHERE id = ?`).get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as Snapshot) : undefined;
}

// Deletes a saved review or published version by id. Any entry is
// deletable (both reviews and published versions) per this project's
// own decision — the audit trail is a convenience for this single-user
// tool, not a compliance requirement enforced against the user's own
// wishes. Returns true if a row was actually removed, so the route can
// tell "already gone" apart from "delete succeeded."
export function deleteSnapshot(db: Database.Database, id: string): boolean {
  const result = db.prepare(`DELETE FROM snapshots WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function latestReview(db: Database.Database): Snapshot | undefined {
  const row = db.prepare(`SELECT json FROM snapshots WHERE is_review = 1 ORDER BY created_at DESC LIMIT 1`).get() as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as Snapshot) : undefined;
}

export function latestPublishedSnapshotRow(db: Database.Database): { id: string; snapshot: Snapshot } | undefined {
  const row = db.prepare(`SELECT id, json FROM snapshots WHERE published = 1 ORDER BY created_at DESC LIMIT 1`).get() as
    | { id: string; json: string }
    | undefined;
  return row ? { id: row.id, snapshot: JSON.parse(row.json) as Snapshot } : undefined;
}
