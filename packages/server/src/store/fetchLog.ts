import type Database from "better-sqlite3";
import type { FetchLogEntry } from "@wayfinder/engine";

export function insertFetchLog(db: Database.Database, entry: FetchLogEntry): void {
  db.prepare(
    `
    INSERT INTO fetch_log (source, started_at, finished_at, status, error, rows_written)
    VALUES (@source, @startedAt, @finishedAt, @status, @error, @rowsWritten)
    `
  ).run(entry);
}

export function recentFetchLog(db: Database.Database, source?: string, limit = 20): FetchLogEntry[] {
  const rows = source
    ? db
        .prepare(
          `SELECT source, started_at as startedAt, finished_at as finishedAt, status, error, rows_written as rowsWritten
           FROM fetch_log WHERE source = ? ORDER BY started_at DESC LIMIT ?`
        )
        .all(source, limit)
    : db
        .prepare(
          `SELECT source, started_at as startedAt, finished_at as finishedAt, status, error, rows_written as rowsWritten
           FROM fetch_log ORDER BY started_at DESC LIMIT ?`
        )
        .all(limit);
  return rows as FetchLogEntry[];
}

export function lastSuccess(db: Database.Database, source: string): FetchLogEntry | undefined {
  return db
    .prepare(
      `SELECT source, started_at as startedAt, finished_at as finishedAt, status, error, rows_written as rowsWritten
       FROM fetch_log WHERE source = ? AND status = 'ok' ORDER BY started_at DESC LIMIT 1`
    )
    .get(source) as FetchLogEntry | undefined;
}
