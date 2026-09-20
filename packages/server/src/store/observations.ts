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

// Latest-per-(date, SOURCE), rather than latest-per-date.
//
// latestObservations() collapses each date to one row, so when two
// adapters both publish a month, the later FETCH wins and the other
// source's reading for that month becomes invisible. That is the right
// rule for reading a series, but it hides exactly the information a
// SPLICE needs: which months the two sources genuinely both cover.
// cpi_index is the live case — FRED and RBI both publish 2025-01..03,
// but RBI was fetched later, so the plain read made FRED look like it
// stopped in 2024-12 and the overlap disappeared.
export function latestObservationsBySource(
  db: Database.Database,
  seriesId: string
): Map<string, Array<{ date: string; value: number }>> {
  const rows = db
    .prepare(
      `
      SELECT o.date, o.value, o.source
      FROM observations o
      INNER JOIN (
        SELECT series_id, date, source, MAX(fetched_at) as max_fetched_at
        FROM observations
        WHERE series_id = @seriesId
        GROUP BY series_id, date, source
      ) latest
        ON o.series_id = latest.series_id
        AND o.date = latest.date
        AND o.source = latest.source
        AND o.fetched_at = latest.max_fetched_at
      WHERE o.series_id = @seriesId
      ORDER BY o.date ASC
      `
    )
    .all({ seriesId }) as Array<{ date: string; value: number; source: string }>;

  const bySource = new Map<string, Array<{ date: string; value: number }>>();
  for (const r of rows) {
    const list = bySource.get(r.source) ?? [];
    list.push({ date: r.date, value: r.value });
    bySource.set(r.source, list);
  }
  return bySource;
}

export function latestObservation(db: Database.Database, seriesId: string): ObservationRow | undefined {
  const rows = latestObservations(db, seriesId);
  return rows[rows.length - 1];
}

// Every series id the observations table currently holds at least one
// row for. Used by currentSnapshot.ts to overlay real readings onto the
// mock baseline's snapshot.series without needing a hardcoded list of
// which series exist — a new adapter's series shows up automatically.
// Excludes the per-scheme NAV feed (series ids shaped "amfi_nav:<code>",
// source AMFI_NAV) and the backtest benchmark cache (series ids shaped
// "bt_index:<benchmarkId>", source BACKTEST_INDEX_DAILY — daily-sampled,
// unlike nifty50_close's deliberate month-end sampling for the scoring
// pipeline; mixing the two into one series would corrupt the percentile
// window's calendar-span assumption). Both are scheme/backtest-level
// rows, not model series — deliberately outside SeriesSource's enum and
// must never reach snapshot.series.
export function storedSeriesIds(db: Database.Database): string[] {
  return db
    .prepare("SELECT DISTINCT series_id FROM observations WHERE source NOT IN ('AMFI_NAV', 'BACKTEST_INDEX_DAILY') ORDER BY series_id")
    .all()
    .map((r) => (r as { series_id: string }).series_id);
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
