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

    -- A note is freestanding text; it doesn't live "under" any one entity.
    -- Any data point, sleeve, signal, rubric or snapshot it discusses is
    -- recorded in note_refs instead, so a note can mention several things
    -- (or none) and any entity can ask "which notes mention me".
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT,
      body       TEXT NOT NULL,
      author     TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS note_refs (
      note_id     TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      position    INTEGER NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_note_refs_note ON note_refs (note_id);
    CREATE INDEX IF NOT EXISTS idx_note_refs_entity ON note_refs (entity_type, entity_id);

    -- A saved backtest scenario: named, so several can sit side-by-side for
    -- comparison rather than each run overwriting the last. legs_json holds
    -- the fund/amount/date inputs; result is never stored here — it's
    -- recomputed from live NAV history on open, same "recomputed, never
    -- frozen at insert time" pattern the note widgets already use, so a
    -- reopened scenario reflects NAV data fetched since it was saved.
    CREATE TABLE IF NOT EXISTS backtest_scenarios (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      legs_json    TEXT NOT NULL,
      benchmark_id TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    -- A queued/running/finished backtest run. Separate from
    -- backtest_scenarios (a saved named INPUT split, no result attached) —
    -- a job is one execution of a backtest, with its own status, timing
    -- and result. status transitions: queued -> running -> completed|failed,
    -- or queued -> cancelled if removed before the worker picks it up.
    -- Only one row is ever "running" at a time (see pipeline/backtestQueue.ts)
    -- — the single-worker, strictly-sequential design the UI's "only one
    -- runs, others show queued" requirement depends on.
    CREATE TABLE IF NOT EXISTS backtest_jobs (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      legs_json    TEXT NOT NULL,
      benchmark_id TEXT NOT NULL,
      status       TEXT NOT NULL,
      eta_seconds  REAL,
      result_json  TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      finished_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_backtest_jobs_status_created
      ON backtest_jobs (status, created_at);
  `);

  // Embedded widgets (the allocation bar, the model-drivers heatmap) used to
  // live in their own table, ordered separately from the text they sit
  // alongside. They're now {{widget:type:size:id}} tokens inline in the same
  // body string as everything else — which is what lets a widget be dropped
  // mid-paragraph, not just appended after the text — so the table (and any
  // row an earlier build wrote to it) is no longer read or written.
  db.exec(`DROP TABLE IF EXISTS note_widgets;`);

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
