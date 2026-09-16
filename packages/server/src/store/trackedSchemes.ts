import type Database from "better-sqlite3";

export interface TrackedScheme {
  schemeCode: string;
  schemeName: string;
  isinGrowth: string | null;
  category: string | null;
  addedAt: string;
  active: boolean;
}

interface TrackedSchemeRow {
  schemeCode: string;
  schemeName: string;
  isinGrowth: string | null;
  category: string | null;
  addedAt: string;
  active: number;
}

function toTrackedScheme(row: TrackedSchemeRow): TrackedScheme {
  return { ...row, active: row.active === 1 };
}

export function addTrackedScheme(
  db: Database.Database,
  scheme: { schemeCode: string; schemeName: string; isinGrowth?: string | null; category?: string | null }
): void {
  db.prepare(
    `
    INSERT INTO tracked_schemes (scheme_code, scheme_name, isin_growth, category, added_at, active)
    VALUES (@schemeCode, @schemeName, @isinGrowth, @category, @addedAt, 1)
    ON CONFLICT (scheme_code) DO UPDATE SET
      scheme_name = excluded.scheme_name,
      isin_growth = excluded.isin_growth,
      category = excluded.category,
      active = 1
    `
  ).run({
    schemeCode: scheme.schemeCode,
    schemeName: scheme.schemeName,
    isinGrowth: scheme.isinGrowth ?? null,
    category: scheme.category ?? null,
    addedAt: new Date().toISOString(),
  });
}

export function deactivateTrackedScheme(db: Database.Database, schemeCode: string): void {
  db.prepare(`UPDATE tracked_schemes SET active = 0 WHERE scheme_code = ?`).run(schemeCode);
}

export function listTrackedSchemes(db: Database.Database, opts: { activeOnly?: boolean } = {}): TrackedScheme[] {
  const rows = (
    opts.activeOnly
      ? db
          .prepare(
            `SELECT scheme_code as schemeCode, scheme_name as schemeName, isin_growth as isinGrowth,
                    category, added_at as addedAt, active
             FROM tracked_schemes WHERE active = 1 ORDER BY scheme_name ASC`
          )
          .all()
      : db
          .prepare(
            `SELECT scheme_code as schemeCode, scheme_name as schemeName, isin_growth as isinGrowth,
                    category, added_at as addedAt, active
             FROM tracked_schemes ORDER BY scheme_name ASC`
          )
          .all()
  ) as TrackedSchemeRow[];
  return rows.map(toTrackedScheme);
}
