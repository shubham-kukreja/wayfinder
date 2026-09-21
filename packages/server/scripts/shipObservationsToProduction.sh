#!/usr/bin/env bash
# Ships locally-prefetched observations to the production Railway volume.
#
# WHY: Railway's egress to portal.amfiindia.com runs at ~1-22KB/s against
# ~1-2MB/s locally (measured 2026-09-21 from inside the container), so
# production cannot fetch a ~24MB AMFI history chunk inside any sane
# timeout. History is fetched locally (scripts/prefetchBacktestHistory.ts)
# and the resulting rows are shipped here.
#
# MERGES, never swaps the file. The server holds wayfinder.db open in WAL
# mode, so overwriting it under a live process risks corruption. Instead
# this pipes a gzipped SQL dump over `railway ssh` stdin and INSERTs it
# through SQLite itself. observations is append-only with PRIMARY KEY
# (series_id, date, fetched_at), so INSERT OR IGNORE is idempotent and
# re-running only fills gaps.
#
# Usage: scripts/shipObservationsToProduction.sh [series_id_prefix ...]
#   Defaults to the backtest series (fund NAVs + benchmark indices)
#   rather than the whole observations table, which also holds the
#   scoring pipeline's series.
set -euo pipefail

cd "$(dirname "$0")/.."

PREFIXES=("${@:-amfi_nav: bt_index:}")
# shellcheck disable=SC2206
PREFIXES=(${PREFIXES[*]})

# Build "series_id LIKE 'a:%' OR series_id LIKE 'b:%'" from the prefixes.
WHERE=""
for p in "${PREFIXES[@]}"; do
  [ -n "$WHERE" ] && WHERE="$WHERE OR "
  WHERE="${WHERE}series_id LIKE '${p}%'"
done

LOCAL_DB="${DB_PATH:-./data/wayfinder.db}"
DUMP=/tmp/wayfinder-observations.sql.gz

if [ ! -f "$LOCAL_DB" ]; then
  echo "Local DB not found at $LOCAL_DB" >&2
  exit 1
fi

echo "=== Shipping observations to production ==="
echo "Source: $LOCAL_DB"
echo "Filter: $WHERE"
echo

# Values are quoted by SQLite itself (quote()), so a scheme name with an
# apostrophe cannot break the generated SQL.
#
# tracked_schemes rides along because the daily top-up
# (POST /api/refresh?sources=amfi_nav) drives off that table — shipping
# history without it would leave production with the rows but nothing
# keeping them current.
{
  sqlite3 "$LOCAL_DB" "
    SELECT 'INSERT OR IGNORE INTO observations (series_id,date,value,basis,source,fetched_at) VALUES ('
        || quote(series_id) || ',' || quote(date) || ',' || value || ','
        || quote(basis) || ',' || quote(source) || ',' || quote(fetched_at) || ');'
    FROM observations
    WHERE $WHERE;
  "
  sqlite3 "$LOCAL_DB" "
    SELECT 'INSERT INTO tracked_schemes (scheme_code,scheme_name,isin_growth,category,added_at,active) VALUES ('
        || quote(scheme_code) || ',' || quote(scheme_name) || ',' || quote(isin_growth) || ','
        || quote(category) || ',' || quote(added_at) || ',' || active
        || ') ON CONFLICT (scheme_code) DO UPDATE SET scheme_name=excluded.scheme_name, category=excluded.category, active=excluded.active;'
    FROM tracked_schemes;
  "
} | gzip > "$DUMP"

ROWS=$(gzip -dc "$DUMP" | wc -l | tr -d ' ')
SIZE=$(wc -c < "$DUMP" | tr -d ' ')
echo "Prepared $ROWS rows (${SIZE} bytes gzipped)"

if [ "$ROWS" = "0" ]; then
  echo "Nothing to ship." >&2
  exit 1
fi

echo "Uploading and merging..."
# Wrapped in a transaction so a dropped connection leaves the DB unchanged
# rather than half-merged.
railway ssh -- "cat > /tmp/obs.sql.gz \
  && gzip -dc /tmp/obs.sql.gz > /tmp/obs.sql \
  && node -e \"
    const Database = require('/app/node_modules/better-sqlite3');
    const fs = require('fs');
    const db = new Database('/data/wayfinder.db');
    const before = db.prepare('SELECT COUNT(*) c FROM observations').get().c;
    db.exec('BEGIN');
    try { db.exec(fs.readFileSync('/tmp/obs.sql','utf8')); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    const after = db.prepare('SELECT COUNT(*) c FROM observations').get().c;
    console.log('observations: ' + before + ' -> ' + after + ' (+' + (after-before) + ')');
    db.close();
  \" \
  && rm -f /tmp/obs.sql /tmp/obs.sql.gz" < "$DUMP"

echo
echo "Done."
