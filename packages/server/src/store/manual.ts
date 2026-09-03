import type Database from "better-sqlite3";
import type { Confidence } from "@wayfinder/engine";

export interface ManualScoreRow {
  scoreId: string;
  value: number;
  note: string | null;
  confidence: Confidence | null;
  enteredAt: string;
}

export function upsertManualScore(db: Database.Database, row: ManualScoreRow): void {
  db.prepare(
    `
    INSERT INTO manual_scores (score_id, value, note, confidence, entered_at)
    VALUES (@scoreId, @value, @note, @confidence, @enteredAt)
    ON CONFLICT (score_id) DO UPDATE SET
      value = excluded.value,
      note = excluded.note,
      confidence = excluded.confidence,
      entered_at = excluded.entered_at
    `
  ).run(row);
}

export function getManualScore(db: Database.Database, scoreId: string): ManualScoreRow | undefined {
  return db.prepare(`SELECT score_id as scoreId, value, note, confidence, entered_at as enteredAt FROM manual_scores WHERE score_id = ?`).get(scoreId) as
    | ManualScoreRow
    | undefined;
}

export function allManualScores(db: Database.Database): ManualScoreRow[] {
  return db.prepare(`SELECT score_id as scoreId, value, note, confidence, entered_at as enteredAt FROM manual_scores`).all() as ManualScoreRow[];
}

export interface ManualVetoRow {
  nodeId: string;
  active: boolean;
  detail: string | null;
  enteredAt: string;
}

export function upsertManualVeto(db: Database.Database, row: ManualVetoRow): void {
  db.prepare(
    `
    INSERT INTO manual_vetoes (node_id, active, detail, entered_at)
    VALUES (@nodeId, @active, @detail, @enteredAt)
    ON CONFLICT (node_id) DO UPDATE SET
      active = excluded.active,
      detail = excluded.detail,
      entered_at = excluded.entered_at
    `
  ).run({ ...row, active: row.active ? 1 : 0 });
}

export function allManualVetoes(db: Database.Database): ManualVetoRow[] {
  const rows = db.prepare(`SELECT node_id as nodeId, active, detail, entered_at as enteredAt FROM manual_vetoes`).all() as Array<
    Omit<ManualVetoRow, "active"> & { active: number }
  >;
  return rows.map((r) => ({ ...r, active: r.active === 1 }));
}
