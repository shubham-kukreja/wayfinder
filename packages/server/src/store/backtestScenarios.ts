import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface BacktestLeg {
  sleeveId: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  date: string; // ISO
}

export interface BacktestScenario {
  id: string;
  label: string;
  legs: BacktestLeg[];
  benchmarkId: string;
  createdAt: string;
  updatedAt: string;
}

interface BacktestScenarioRow {
  id: string;
  label: string;
  legsJson: string;
  benchmarkId: string;
  createdAt: string;
  updatedAt: string;
}

function toScenario(row: BacktestScenarioRow): BacktestScenario {
  return {
    id: row.id,
    label: row.label,
    legs: JSON.parse(row.legsJson) as BacktestLeg[],
    benchmarkId: row.benchmarkId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listBacktestScenarios(db: Database.Database): BacktestScenario[] {
  const rows = db
    .prepare(
      `SELECT id, label, legs_json as legsJson, benchmark_id as benchmarkId, created_at as createdAt, updated_at as updatedAt
       FROM backtest_scenarios ORDER BY created_at DESC`
    )
    .all() as BacktestScenarioRow[];
  return rows.map(toScenario);
}

export function getBacktestScenario(db: Database.Database, id: string): BacktestScenario | null {
  const row = db
    .prepare(
      `SELECT id, label, legs_json as legsJson, benchmark_id as benchmarkId, created_at as createdAt, updated_at as updatedAt
       FROM backtest_scenarios WHERE id = ?`
    )
    .get(id) as BacktestScenarioRow | undefined;
  return row ? toScenario(row) : null;
}

export function saveBacktestScenario(
  db: Database.Database,
  input: { id?: string; label: string; legs: BacktestLeg[]; benchmarkId: string }
): BacktestScenario {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const legsJson = JSON.stringify(input.legs);

  db.prepare(
    `INSERT INTO backtest_scenarios (id, label, legs_json, benchmark_id, created_at, updated_at)
     VALUES (@id, @label, @legsJson, @benchmarkId, @createdAt, @updatedAt)
     ON CONFLICT (id) DO UPDATE SET
       label = excluded.label,
       legs_json = excluded.legs_json,
       benchmark_id = excluded.benchmark_id,
       updated_at = excluded.updated_at`
  ).run({ id, label: input.label, legsJson, benchmarkId: input.benchmarkId, createdAt: now, updatedAt: now });

  return getBacktestScenario(db, id)!;
}

export function deleteBacktestScenario(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM backtest_scenarios WHERE id = ?`).run(id);
}
