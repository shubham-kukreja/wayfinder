// One-off backfill: pre-fetches 10 years of NAV history for every default-
// fund scheme plus all 5 benchmark indices, so a backtest's first run
// against them hits the observations cache instead of a live AMFI/Yahoo
// fetch. Run with: pnpm exec tsx scripts/prefetchBacktestHistory.ts
//
// Safe to re-run — fetchTrackedNavHistory/fetchBenchmarkHistoryCached both
// write through insertObservations, which is an upsert (see store/db.ts's
// schema), so this only ever fills gaps.
import { openDb } from "../src/store/db.js";
import { loadConfig } from "../src/config.js";
import { fetchTrackedNavHistory } from "../src/adapters/amfiNav.js";
import { fetchBenchmarkHistoryCached, BENCHMARK_INDICES } from "../src/adapters/benchmarkIndex.js";
import { insertObservations } from "../src/store/observations.js";
import { amfiNavSeriesId } from "../src/adapters/amfiNav.js";

// The 16 sleeve default funds (same set packages/server/src/lib/defaultFunds.ts
// picks for a fresh New Run) — the schemes an out-of-the-box backtest
// actually needs, not the full trackedSchemes list (which is for the
// unrelated recurring-refresh pipeline).
const DEFAULT_FUND_CODES = [
  "119018", "118668", "119589", "119517", "118701", "133791", "120520",
  "119781", "153415", "118589", "118537", "135810", "150643", "119591",
  "119028", "154216",
];

async function main() {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  try {
    const to = new Date();
    const from = new Date(to);
    from.setFullYear(from.getFullYear() - 10);
    from.setDate(from.getDate() - 7); // same LOOKBACK_BUFFER_DAYS backtestRunner.ts uses

    console.log(`Fetching NAV history for ${DEFAULT_FUND_CODES.length} schemes, ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}...`);
    const navObs = await fetchTrackedNavHistory(new Set(DEFAULT_FUND_CODES), from, to);
    const now = new Date().toISOString();
    const navRows = navObs.map((obs) => {
      const code = obs.raw && typeof obs.raw === "object" && "schemeCode" in obs.raw ? (obs.raw as { schemeCode: string }).schemeCode : null;
      return { seriesId: amfiNavSeriesId(code ?? ""), date: obs.date, value: obs.value, basis: null, source: "AMFI_NAV", fetchedAt: now };
    });
    const navWritten = insertObservations(db, navRows);
    console.log(`  wrote ${navWritten} NAV observations`);

    for (const benchmarkId of Object.keys(BENCHMARK_INDICES)) {
      console.log(`Fetching benchmark history for ${benchmarkId}...`);
      const series = await fetchBenchmarkHistoryCached(db, benchmarkId, from, to);
      console.log(`  ${benchmarkId}: ${Object.keys(series).length} days cached`);
    }

    console.log("Done.");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
