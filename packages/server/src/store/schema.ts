import type Database from "better-sqlite3";

// §11.2 — append-only store. Revisions insert a new row with a later
// fetched_at; latest wins on read. This preserves the audit trail needed
// when a source revises a published figure (RBI/MOSPI do this) and a
// percentile moves for no visible reason otherwise.
export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      series_id  TEXT NOT NULL,
      date       TEXT NOT NULL,
      value      REAL NOT NULL,
      basis      TEXT,
      source     TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (series_id, date, fetched_at)
    );

    CREATE INDEX IF NOT EXISTS idx_observations_series_date
      ON observations (series_id, date);

    CREATE TABLE IF NOT EXISTS manual_scores (
      score_id   TEXT PRIMARY KEY,
      value      REAL NOT NULL,
      note       TEXT,
      confidence TEXT,
      entered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manual_vetoes (
      node_id    TEXT PRIMARY KEY,
      active     INTEGER NOT NULL,
      detail     TEXT,
      entered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS params (
      id         TEXT PRIMARY KEY,
      json       TEXT NOT NULL,
      label      TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id         TEXT PRIMARY KEY,
      label      TEXT,
      json       TEXT NOT NULL,
      is_review  INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fetch_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source       TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT NOT NULL,
      error        TEXT,
      rows_written INTEGER NOT NULL DEFAULT 0
    );
  `);
}
