import type { Browser, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.12 — CCIL Zero Coupon Yield Curve, a BETTER SOURCE for the same
// tbill_1y series adapters/rbi.ts already populates — not a new series.
//
// adapters/rbi.ts sources tbill_1y from dbie.rbihub.in's
// yield-of-sgl-transactions-in-treasury-bills page, whose "183TO364"
// column is a BUCKET average across all 183-364 day bills traded that
// day — the nearest available proxy, since India doesn't auction an
// exact 365-day bill. Confirmed live 2026-09-15: CCIL's own
// tenorwise-indicative-yields page (its Zero Coupon Yield Curve /
// benchmark indicative-yield table) publishes a "364D" row keyed to one
// SPECIFIC real security (e.g. "364 DTB (09/09/2027)"), with its actual
// market YTM — a real instrument's yield, not an interpolated/averaged
// bucket. Still not an exact 365-day tenor (see below), but a more
// precise single-security figure than RBI's mirror offers.
//
// The page (Liferay-based, confirmed live) renders exactly ONE plain
// HTML <table id="dtTable"> after network settles — no AG Grid, no
// React hydration wait needed beyond networkidle, and no auth/cookie
// dance. Columns confirmed live: Date | Tenor Bucket | Security | YTM
// (%). Tenor Bucket values seen: 91D, 182D, 364D (three T-bill buckets),
// then 1Y-2Y, 4Y-5Y, 9Y-10Y, 13Y-15Y, 28Y-30Y (G-Sec buckets), plus two
// state-development-loan rows (5Y, 10Y) — "364D" is unambiguous, there
// is exactly one row with that exact tenor-bucket label.
//
// No date-range picker or historical-data control was found on this
// page (confirmed both in an earlier research pass and re-checked live
// while building this adapter) — it shows only today's snapshot.
// fetchHistory() is therefore a deliberate no-op, same honest pattern as
// bullion.ts/nse.ts/yahoo.ts: history must accumulate via repeated
// fetchLatest() calls (daily refresh), not backfill.
//
// Still labelled a PROXY at the series-catalog level (see
// docs/DATA_SOURCES.md) — 364 days is the closest real instrument to a
// 365-day tenor, but it is not an exact 1-year bill; India simply
// doesn't auction one.
const CCIL_ZCYC_URL = "https://www.ccilindia.com/tenorwise-indicative-yields";

export const TBILL_1Y_SERIES_ID = "tbill_1y";
const TARGET_TENOR_BUCKET = "364D";

export class CcilScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CcilScrapeError";
  }
}

export interface CcilYieldRow {
  date: string; // as published, "DD-MM-YYYY"
  tenorBucket: string;
  security: string;
  ytmPercent: number;
}

// Pure parse step, split from the network/DOM call — same pattern as
// every other adapter in this project (parseDailySnapshotCsv in
// niftyindices.ts, parseRepoRateFromHomepage in rbiRepoRate.ts, etc).
// Takes structured row data (already extracted from the DOM by the live
// wrapper below) rather than raw HTML, since Playwright's own DOM
// extraction is the natural place to turn <tr>/<td> into plain arrays —
// re-parsing HTML text with regex here would just duplicate that.
export function parseTbill1yFromRows(rows: string[][]): CcilYieldRow[] {
  if (rows.length === 0) {
    throw new CcilScrapeError("CCIL ZCYC table had no data rows — the page's markup may have changed.");
  }
  const parsed: CcilYieldRow[] = [];
  for (const cells of rows) {
    if (cells.length < 4) continue;
    const [date, tenorBucket, security, ytmText] = cells as [string, string, string, string];
    const ytmPercent = Number(ytmText.replace(/,/g, ""));
    if (!Number.isFinite(ytmPercent)) continue;
    parsed.push({ date: date.trim(), tenorBucket: tenorBucket.trim(), security: security.trim(), ytmPercent });
  }
  if (parsed.length === 0) {
    throw new CcilScrapeError("CCIL ZCYC table rows were present but none parsed as valid date/tenor/security/yield rows.");
  }
  return parsed;
}

export function findTbill1yRow(rows: CcilYieldRow[]): CcilYieldRow {
  const matches = rows.filter((r) => r.tenorBucket === TARGET_TENOR_BUCKET);
  if (matches.length === 0) {
    throw new CcilScrapeError(
      `No row with Tenor Bucket "${TARGET_TENOR_BUCKET}" found in the CCIL ZCYC table — its tenor-bucket labels may have changed.`
    );
  }
  if (matches.length > 1) {
    throw new CcilScrapeError(
      `Found ${matches.length} rows with Tenor Bucket "${TARGET_TENOR_BUCKET}" — expected exactly one unambiguous 364-day security.`
    );
  }
  return matches[0]!;
}

// "DD-MM-YYYY" (confirmed live format, e.g. "11-09-2026") -> "YYYY-MM-DD".
function normaliseDate(ddmmyyyy: string): string {
  const match = ddmmyyyy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    throw new CcilScrapeError(`CCIL ZCYC date "${ddmmyyyy}" didn't match the expected DD-MM-YYYY format.`);
  }
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

export interface CcilAdapterConfig {
  headless?: boolean;
  // playwright-core ships no browser binary — see rbi.ts's identical
  // config field for the full explanation. Left undefined,
  // chromium.launch() uses Playwright's normal resolution and throws a
  // clear error if no browser is found.
  executablePath?: string;
}

export function createCcilAdapter(config: CcilAdapterConfig = {}): SourceAdapter {
  async function withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({
        headless: config.headless ?? true,
        executablePath: config.executablePath,
        args: ["--no-sandbox"],
      });
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await browser?.close();
    }
  }

  async function scrapeRows(page: Page): Promise<string[][]> {
    await page.goto(CCIL_ZCYC_URL, { waitUntil: "networkidle", timeout: 30000 });

    const tableCount = await page.locator("table").count();
    if (tableCount === 0) {
      throw new CcilScrapeError("No <table> found on the CCIL ZCYC page — its layout may have changed.");
    }

    const rows = await page.locator("table").first().evaluate((table) => {
      return Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")
      );
    });
    return rows;
  }

  async function fetchTbill1y(): Promise<CcilYieldRow> {
    const rawRows = await withBrowser(scrapeRows);
    const parsed = parseTbill1yFromRows(rawRows);
    return findTbill1yRow(parsed);
  }

  return {
    id: "CCIL",
    series: [TBILL_1Y_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const row = await fetchTbill1y();
      return [
        {
          seriesId: TBILL_1Y_SERIES_ID,
          date: normaliseDate(row.date),
          value: row.ytmPercent,
          raw: row,
        },
      ];
    },

    // No historical range on this page — see file-level comment.
    async fetchHistory(): Promise<Observation[]> {
      throw new CcilScrapeError(
        "CCIL's tenorwise-indicative-yields page shows only today's snapshot table, no historical range. " +
          "History must accumulate via repeated fetchLatest() calls (a daily refresh), not backfill."
      );
    },

    async health(): Promise<HealthStatus> {
      try {
        const row = await fetchTbill1y();
        return {
          source: "CCIL",
          ok: Number.isFinite(row.ytmPercent) && row.ytmPercent > 0,
          lastChecked: new Date().toISOString(),
          detail: null,
        };
      } catch (err) {
        return {
          source: "CCIL",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
