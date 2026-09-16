import type Database from "better-sqlite3";

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

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
      reason     TEXT,
      actor      TEXT,
      entered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manual_vetoes (
      node_id    TEXT PRIMARY KEY,
      active     INTEGER NOT NULL,
      detail     TEXT,
      reason     TEXT,
      expiry     TEXT,
      actor      TEXT,
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
      parent_id  TEXT,
      published  INTEGER NOT NULL DEFAULT 0,
      actor      TEXT,
      created_at TEXT NOT NULL
    );

    -- Login credentials. Only ever stores an argon2id hash; the plaintext
    -- password is never written anywhere, including logs.
    CREATE TABLE IF NOT EXISTS users (
      email         TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      last_login_at TEXT
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

    -- AMFI publishes ~14,000 live schemes with no server-side filter, so
    -- unlike every other adapter's small fixed series list, "which schemes
    -- to pull NAV history for" is a runtime allowlist, not a compile-time
    -- constant. observations.series_id for a tracked scheme is
    -- "amfi_nav:<scheme_code>" — no schema change needed there.
    CREATE TABLE IF NOT EXISTS tracked_schemes (
      scheme_code TEXT PRIMARY KEY,
      scheme_name TEXT NOT NULL,
      isin_growth TEXT,
      category    TEXT,
      added_at    TEXT NOT NULL,
      active      INTEGER NOT NULL DEFAULT 1
    );
  `);

  ensureColumn(db, "manual_scores", "reason", "TEXT");
  ensureColumn(db, "manual_scores", "actor", "TEXT");
  ensureColumn(db, "manual_vetoes", "reason", "TEXT");
  ensureColumn(db, "manual_vetoes", "expiry", "TEXT");
  ensureColumn(db, "manual_vetoes", "actor", "TEXT");
  ensureColumn(db, "snapshots", "parent_id", "TEXT");
  ensureColumn(db, "snapshots", "published", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "snapshots", "actor", "TEXT");
  // The publish route has always accepted a reason and echoed it back in its
  // response, but had nowhere to put it — so the one field the audit trail
  // most depends on was silently dropped on write.
  ensureColumn(db, "snapshots", "reason", "TEXT");
}
