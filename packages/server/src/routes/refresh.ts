import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { createFredAdapter, FRED_SERIES } from "../adapters/fred.js";
import { createBullionAdapter, BULLION_SERIES } from "../adapters/bullion.js";
import { createAmfiAdapter } from "../adapters/amfi.js";
import { createRbiAdapter } from "../adapters/rbi.js";
import { createRbiRepoRateAdapter } from "../adapters/rbiRepoRate.js";
import { createCcilAdapter } from "../adapters/ccil.js";
import { createNseAdapter } from "../adapters/nse.js";
import { createNiftyIndicesAdapter } from "../adapters/niftyindices.js";
import { createYahooAdapter } from "../adapters/yahoo.js";
import { createYahooMetalsAdapter } from "../adapters/yahooMetals.js";
import { createTradingEconomicsAdapter } from "../adapters/tradingEconomics.js";
import { createDbNomicsAdapter } from "../adapters/dbnomics.js";
import { createAaa3yAdapter } from "../adapters/aaa3y.js";
import { createAmfiNavAdapter } from "../adapters/amfiNav.js";
import { runRefresh } from "../pipeline/refresh.js";
import { buildCurrentSnapshot } from "../pipeline/currentSnapshot.js";
import { loadConfig } from "../config.js";
import { listTrackedSchemes } from "../store/trackedSchemes.js";
import type { SourceAdapter } from "../adapters/types.js";
import type Database from "better-sqlite3";

// §11.5 / §13.1 POST /api/refresh[?sources=fred,bullion,amfi,rbi,nse,yahoo].
// Default (no query param) now fans out to EVERY registered adapter,
// slow headless-browser ones (RBI, CCIL, Yahoo) included — a full
// refresh is expected to take longer as a result; pass ?sources=... to
// request a fast, partial subset instead. RBI (the dbie.rbihub.in
// mirror, adapters/rbi.ts) spins up a real headless browser per call
// (multi-second). rbi_homepage (adapters/rbiRepoRate.ts) is
// a SEPARATE, fast, plain-HTTP source for just the repo rate — RBI's
// DBIE mirror has no repo_rate series at all (confirmed 2026-09-03), so
// this scrapes rbi.org.in's own homepage widget instead; distinct
// source name so it isn't bundled into RBI's slow headless-browser path.
// §13.1 documents this exact pattern
// ("POST /api/refresh?series=a,b,c -> partial refresh"); this uses
// source names rather than series names since that's the granularity a
// user/scheduler actually chooses at (§11.5: "per-source refresh
// exposed"). ccil (adapters/ccil.ts) writes to the SAME tbill_1y series
// rbi.ts populates (a specific 364-day security's real market yield, a
// better source than RBI's mirror's 183-364-day bucket average) — not a
// new series, so it needs no preference/fallback logic on top of the
// store's existing "latest fetched_at wins" rule.
export const AVAILABLE_SOURCES = [
  "fred",
  "bullion",
  "amfi",
  "rbi",
  "rbi_homepage",
  "ccil",
  "nse",
  "niftyindices",
  "yahoo",
  "yahoo_metals",
  "tradingeconomics",
  "dbnomics",
  "aaa3y",
  "amfi_nav",
] as const;
export type SourceName = (typeof AVAILABLE_SOURCES)[number];

export function parseRequestedSources(sourcesParam: string | undefined): SourceName[] | { error: string } {
  const requested = sourcesParam ? sourcesParam.split(",").map((s) => s.trim().toLowerCase()) : [...AVAILABLE_SOURCES];
  const invalid = requested.filter((s) => !AVAILABLE_SOURCES.includes(s as SourceName));
  if (invalid.length > 0) {
    return { error: `Unknown source(s): ${invalid.join(", ")}. Available: ${AVAILABLE_SOURCES.join(", ")}` };
  }
  return requested as SourceName[];
}

// Takes `db` (unlike every other adapter builder here) only for
// amfi_nav: its series list isn't known until the tracked_schemes table
// is read at request time, unlike every other adapter's fixed compile-time
// series list — see adapters/amfiNav.ts's file-level comment.
export function buildAdapters(names: SourceName[], config: ReturnType<typeof loadConfig>, db: Database.Database): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  if (names.includes("fred")) out.push(createFredAdapter({ apiKey: config.fredApiKey, series: FRED_SERIES }));
  if (names.includes("bullion")) out.push(createBullionAdapter({ apiKey: config.metalsDevApiKey, series: BULLION_SERIES }));
  if (names.includes("amfi")) out.push(createAmfiAdapter());
  if (names.includes("rbi")) out.push(createRbiAdapter({ executablePath: config.chromiumExecutablePath }));
  if (names.includes("rbi_homepage")) out.push(createRbiRepoRateAdapter());
  if (names.includes("ccil")) out.push(createCcilAdapter({ executablePath: config.chromiumExecutablePath }));
  if (names.includes("nse")) out.push(createNseAdapter());
  if (names.includes("niftyindices")) out.push(createNiftyIndicesAdapter());
  if (names.includes("yahoo")) out.push(createYahooAdapter());
  if (names.includes("yahoo_metals")) out.push(createYahooMetalsAdapter());
  if (names.includes("tradingeconomics")) out.push(createTradingEconomicsAdapter());
  if (names.includes("dbnomics")) out.push(createDbNomicsAdapter());
  if (names.includes("aaa3y")) out.push(createAaa3yAdapter());
  if (names.includes("amfi_nav")) {
    const trackedCodes = listTrackedSchemes(db, { activeOnly: true }).map((s) => s.schemeCode);
    out.push(createAmfiNavAdapter(trackedCodes));
  }
  return out;
}

// Honesty gap, stated plainly rather than hidden: only the score cells
// computeAutoScoreCells() actually implements (§7 cells reachable from
// FRED/bullion/AMFI/RBI series — see pipeline/scoreCells.ts, currently
// 12 of 85) are recomputed from the newly stored observations. Every
// other cell still comes from the mock baseline unchanged. This is real
// progress over serving a static file (the pipeline that WOULD compute
// the rest doesn't exist yet — NSE and most of RBI aren't wired in), but
// it is not the full 85-cell pipeline; the response's warnings say so
// explicitly rather than presenting every number as freshly computed.
export function registerRefreshRoute(app: FastifyInstance): void {
  app.post<{ Querystring: { sources?: string } }>("/api/refresh", async (req, reply) => {
    const config = loadConfig();
    const db = openDb(config.dbPath);

    try {
      const requested = parseRequestedSources(req.query.sources);
      if ("error" in requested) {
        reply.code(400);
        return requested;
      }

      const adapters = buildAdapters(requested, config, db);
      // RBI's live test (test/rbi.live.test.ts) took ~19s end-to-end
      // (browser launch + page navigation + AG Grid pagination) — give
      // every source in this batch a longer timeout when RBI is among
      // them rather than let it get cut off by the default 15s. Yahoo's
      // constituent-aggregation (Wikipedia fetch + cookie/crumb handshake +
      // 2 batch quote requests for ~500 tickers) gets the same treatment.
      const timeoutMs = requested.includes("rbi") || requested.includes("yahoo") || requested.includes("ccil") ? 45000 : undefined;

      const { fetchLog, warnings } = await runRefresh(db, adapters, timeoutMs);

      const asOf = new Date().toISOString();
      let built;
      try {
        built = buildCurrentSnapshot(db, asOf);
      } catch (err) {
        reply.code(500);
        return { error: err instanceof Error ? err.message : String(err) };
      }
      const { snapshot, recomputedIds } = built;

      snapshot.fetchLog = fetchLog;
      snapshot.warnings = [
        ...warnings,
        {
          severity: "info",
          code: "partial_pipeline",
          message: `${recomputedIds.length} of 85 scores were recomputed from this refresh's fetched data (${recomputedIds.join(", ")}); the rest remain the baseline snapshot's values until the full derivation pipeline covers them.`,
          affects: recomputedIds,
        },
      ];

      return snapshot;
    } finally {
      db.close();
    }
  });
}
