import type Database from "better-sqlite3";

export interface ObservationRow {
  seriesId: string;
  date: string;
  value: number;
  basis: string | null;
  source: string;
  fetchedAt: string;
}

export function insertObservations(db: Database.Database, rows: ObservationRow[]): number {
  const stmt = db.prepare(`
    INSERT INTO observations (series_id, date, value, basis, source, fetched_at)
    VALUES (@seriesId, @date, @value, @basis, @source, @fetchedAt)
    ON CONFLICT (series_id, date, fetched_at) DO NOTHING
  `);
  const insertMany = db.transaction((items: ObservationRow[]) => {
    let written = 0;
    for (const row of items) {
      const result = stmt.run(row);
      written += result.changes;
    }
    return written;
  });
  return insertMany(rows);
}

// "Latest wins on read": for each (series_id, date), take the row with the
// most recent fetched_at. This is how a later revision supersedes an
// earlier observation without ever deleting the earlier row.
export function latestObservations(
  db: Database.Database,
  seriesId: string,
  opts: { from?: string; to?: string } = {}
): ObservationRow[] {
  const params = {
    seriesId,
    from: opts.from ?? null,
    to: opts.to ?? null,
  };
  const rows = db
    .prepare(
      `
      SELECT o.series_id as seriesId, o.date, o.value, o.basis, o.source, o.fetched_at as fetchedAt
      FROM observations o
      INNER JOIN (
        SELECT series_id, date, MAX(fetched_at) as max_fetched_at
        FROM observations
        WHERE series_id = @seriesId
          AND (@from IS NULL OR date >= @from)
          AND (@to IS NULL OR date <= @to)
        GROUP BY series_id, date
      ) latest
        ON o.series_id = latest.series_id
        AND o.date = latest.date
        AND o.fetched_at = latest.max_fetched_at
      WHERE o.series_id = @seriesId
      ORDER BY o.date ASC
      `
    )
    .all(params) as ObservationRow[];
  return rows;
}

export function latestObservation(db: Database.Database, seriesId: string): ObservationRow | undefined {
  const rows = latestObservations(db, seriesId);
  return rows[rows.length - 1];
}

export function seriesCoverage(
  db: Database.Database,
  seriesId: string
): { observations: number; windowStart: string | null; windowEnd: string | null } {
  const rows = latestObservations(db, seriesId);
  return {
    observations: rows.length,
    windowStart: rows[0]?.date ?? null,
    windowEnd: rows[rows.length - 1]?.date ?? null,
  };
}
