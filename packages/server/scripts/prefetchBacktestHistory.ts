// Pre-fetches NAV history for the top-N candidate funds of every sleeve,
// plus all benchmark indices, into the local SQLite file. That file is
// then shipped to production (see the note on egress below), so a backtest
// there reads history from cache instead of fetching it.
//
// Run with: pnpm exec tsx scripts/prefetchBacktestHistory.ts [years] [perSleeve]
//
// WHY THIS EXISTS, rather than production just fetching its own history:
// Railway's egress to portal.amfiindia.com is throttled to ~1-22KB/s
// against ~1-2MB/s from a normal connection (measured live 2026-09-21
// from inside the container, on both the 24MB history endpoint and the
// ~1MB NAVAll.txt). A single 30-day history chunk is ~24MB, so production
// cannot complete one inside any sane timeout — every attempt aborts
// partway and fetchTrackedNavHistory records it as a gap. Fetching here,
// where the same request takes ~15-25s, and shipping the DB is the way
// around it.
//
// Safe to re-run — insertObservations is an upsert keyed on
// (series_id, date, fetched_at), so re-running only fills gaps.
import { openDb } from "../src/store/db.js";
import { loadConfig } from "../src/config.js";
import { request } from "undici";
import { fetchTrackedNavHistory, fetchSchemeCodesExistingOn, parseNavAllLatest, amfiNavSeriesId } from "../src/adapters/amfiNav.js";
import { fetchBenchmarkHistoryCached, BENCHMARK_INDICES } from "../src/adapters/benchmarkIndex.js";
import { insertObservations, seriesCoverage } from "../src/store/observations.js";
import { addTrackedScheme } from "../src/store/trackedSchemes.js";
import { pickTopFundsPerSleeve } from "../src/lib/defaultFunds.js";

const NAV_LATEST_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

// Default depth. 12 years comfortably covers the 10-year window the UI
// offers plus the percentile/lookback headroom the score cells want, and
// reaches back past the inception of most funds these sleeves resolve to.
const DEFAULT_YEARS = 12;

// How many candidates per sleeve to cache. Every AMFI history chunk is the
// FULL ~14k-scheme universe filtered client-side (see amfiNav.ts), so
// widening from 1 to 5 funds per sleeve costs no extra network time at
// all — only a few more rows written. 5 covers a user switching a leg off
// the default to another well-known fund in the same category.
const DEFAULT_PER_SLEEVE = 5;

async function resolveTopFunds(perSleeve: number) {
  // Same two inputs, same ranking, as GET /api/backtest/default-funds — so
  // the #1 pick here is byte-identical to the default the picker shows.
  const eightYearsAgo = new Date();
  eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);

  const [latestRes, establishedCodes] = await Promise.all([
    request(NAV_LATEST_URL, { method: "GET" }),
    fetchSchemeCodesExistingOn(eightYearsAgo).catch(() => new Set<string>()),
  ]);
  if (latestRes.statusCode !== 200) {
    throw new Error(`AMFI NAV file fetch failed (${latestRes.statusCode}).`);
  }
  const rows = parseNavAllLatest(await latestRes.body.text());
  return pickTopFundsPerSleeve(rows, perSleeve, establishedCodes);
}

async function main() {
  const years = Number(process.argv[2]) || DEFAULT_YEARS;
  const perSleeve = Number(process.argv[3]) || DEFAULT_PER_SLEEVE;

  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const to = new Date();
    const from = new Date(to);
    from.setFullYear(from.getFullYear() - years);
    from.setDate(from.getDate() - 7); // same LOOKBACK_BUFFER_DAYS backtestRunner.ts uses

    console.log(`=== Backtest NAV prefetch ===`);
    console.log(`DB:    ${config.dbPath}`);
    console.log(`Range: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)} (${years}y)`);
    console.log();

    console.log(`Resolving top ${perSleeve} funds per sleeve...`);
    const picks = await resolveTopFunds(perSleeve);
    const bySleeve = new Map<string, typeof picks>();
    for (const p of picks) {
      const list = bySleeve.get(p.sleeveId) ?? [];
      list.push(p);
      bySleeve.set(p.sleeveId, list);
    }
    for (const [sleeveId, list] of bySleeve) {
      console.log(`  ${sleeveId}: ${list.map((p) => p.schemeCode).join(", ")}`);
    }
    console.log(`  ${picks.length} schemes across ${bySleeve.size} sleeves`);
    console.log();

    // Register the same picks as tracked schemes. POST /api/refresh
    // ?sources=amfi_nav drives off this table, and its fetchLatest path
    // reads the ~1MB NAVAll.txt rather than a 24MB history chunk — slow
    // from Railway (~45s at the measured 22KB/s) but completable, unlike
    // history. That is what keeps the shipped history current afterwards:
    // this script supplies the back years, the daily refresh adds today.
    for (const p of picks) {
      addTrackedScheme(db, { schemeCode: p.schemeCode, schemeName: p.schemeName, category: p.sleeveId });
    }
    console.log(`Registered ${picks.length} schemes in tracked_schemes (for the daily NAVAll.txt top-up).`);
    console.log();

    const codes = new Set(picks.map((p) => p.schemeCode));
    console.log(`Fetching NAV history (${Math.ceil((to.getTime() - from.getTime()) / (30 * 864e5))} chunks of ~24MB each)...`);
    const navObs = await fetchTrackedNavHistory(codes, from, to);
    const fetchedAt = new Date().toISOString();
    const written = insertObservations(
      db,
      navObs.map((obs) => {
        const code = obs.raw && typeof obs.raw === "object" && "schemeCode" in obs.raw ? (obs.raw as { schemeCode: string }).schemeCode : null;
        return { seriesId: amfiNavSeriesId(code ?? ""), date: obs.date, value: obs.value, basis: null, source: "AMFI_NAV", fetchedAt };
      })
    );
    console.log(`  wrote ${written} NAV observations`);
    console.log();

    for (const benchmarkId of Object.keys(BENCHMARK_INDICES)) {
      const series = await fetchBenchmarkHistoryCached(db, benchmarkId, from, to);
      console.log(`  ${benchmarkId}: ${Object.keys(series).length} days cached`);
    }
    console.log();

    // Per-scheme coverage, so a fund whose chunks partly failed is visible
    // here rather than surfacing later as a silent missingHistory leg.
    console.log("=== Coverage ===");
    for (const [sleeveId, list] of bySleeve) {
      for (const p of list) {
        const c = seriesCoverage(db, amfiNavSeriesId(p.schemeCode));
        const label = c.observations === 0 ? "EMPTY" : "ok";
        console.log(`  [${label}] ${sleeveId} ${p.schemeCode}: ${c.observations} obs (${c.windowStart ?? "—"} to ${c.windowEnd ?? "—"}) ${p.schemeName}`);
      }
    }

    console.log();
    console.log("Done. Ship the DB with: scripts/shipDbToProduction.sh");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
