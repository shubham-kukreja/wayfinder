import type { Browser, Page } from "playwright-core";
import { chromium } from "playwright-core";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.3 — RBI. DBIE has NO stable programmatic path (confirmed via direct
// research + live probing 2026-09-03): it's a session-based Cognos BI
// portal with no documented API, and its own domain has migrated three
// times (dbieold -> dbie -> data.rbi.org.in/DBIE).
//
// This adapter targets dbie.rbihub.in instead — a third-party static
// mirror (NOT RBI, no SLA) explicitly built by scraping DBIE. Its own
// /docs page states it is "not a live feed," pre-rendered from a
// scraping pipeline someone else maintains. Chosen per explicit user
// direction after RBI's own portal was confirmed to have no viable
// alternative.
//
// The mirror itself has no JSON API either — series pages render an
// AG Grid data table server-side with no export button. This adapter
// drives the grid with a real (headless) browser, paging through AG
// Grid's built-in pagination (data-ref="btNext"/aria-disabled) and
// collecting rows keyed by row-id since AG Grid splits pinned-left
// columns from scrollable data columns into separate DOM containers that
// must be joined by row-id, not read as one contiguous row. Two distinct
// page shapes have been found so far (RBI_PAGES handles both):
//   - CPI defaults to showing one month; needs "All months" picked
//     explicitly in a <select>, and its columns are semantic col-ids
//     (month, commodity, combinedIndex, ...).
//   - The treasury-bills yield page has NO select controls at all —
//     shows its full ~300-observation history by default — and AG
//     Grid's col-ids there are bare numeric indices ("0", "1", ...), not
//     semantic names.
const RBIHUB_BASE_URL = "https://dbie.rbihub.in";

// gsec_10y is deliberately NOT here — the only "yield" page found on this
// mirror (yield-of-sgl-transactions-in-government-dated-securities) turned
// out to be a price/turnover index, not a yield (confirmed live
// 2026-09-03; see adapters/fred.ts, which sources gsec_10y from FRED's
// INDIRLTLT01STM instead). repo_rate has no dedicated series anywhere in
// this mirror's ~350-page catalog as of the same date.
export type RbiSeriesId = "cpi_index" | "cpi_yoy" | "tbill_1y";

interface RbiPageConfig {
  path: string;
  // The AG Grid col-id to read per internal series. Pages differ in
  // whether they need a month/period selector at all: CPI defaults to a
  // single-month view and needs "All months" picked explicitly; the
  // treasury-bills yield page (verified 2026-09-03) shows its full
  // ~300-observation history by default with no selector present.
  // monthSelectLabel is only applied when the page actually has selects.
  monthSelectLabel?: string;
  dateColId: string; // the col-id holding the period/date for each row
  commodityFilter?: string; // for pages with a commodity/instrument column
  columnMap: Partial<Record<RbiSeriesId, string>>;
}

// Verified 2026-09-03 against the live mirror.
const RBI_PAGES: RbiPageConfig[] = [
  {
    // /prices/consumer-price-index renders an AG Grid with columns month,
    // commodity, status, ruralIndex, ruralInflation, urbanIndex,
    // urbanInflation, combinedIndex, combinedInflation. "All months" is a
    // real option in the second <select> on the page (the first is the
    // CPI base-year selector) — without picking it, the grid defaults to
    // showing only the latest month.
    path: "/prices/consumer-price-index",
    monthSelectLabel: "All months",
    dateColId: "month",
    commodityFilter: "A) General Index",
    columnMap: { cpi_index: "combinedIndex", cpi_yoy: "combinedInflation" },
  },
  {
    // /tables/yield-of-sgl-transactions-in-treasury-bills has NO select
    // controls at all — it shows its full history (306 observations as
    // of 2026-09-03) by default, paginated. Columns are period plus one
    // yield column per maturity bucket in days, but (unlike CPI's page)
    // AG Grid's col-ids here are bare numeric indices, not semantic
    // names — verified live: col-id "0" = header "183TO364 (INR)"
    // (yield %), "1" = "92TO182 (INR)", "2" = "15TO91 (INR)", "3" =
    // "UPTOTO14 (INR)". The 183-364 day bucket (col "0") is the closest
    // available match to a 1-year T-bill yield — RBI doesn't auction
    // exactly 365-day bills, so this is the nearest real bucket, not an
    // exact 1y tenor.
    path: "/tables/yield-of-sgl-transactions-in-treasury-bills",
    dateColId: "period",
    columnMap: { tbill_1y: "0" },
  },
];

export class RbiScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RbiScrapeError";
  }
}

interface GridRow {
  [colId: string]: string | undefined;
}

async function extractAllPages(page: Page, dateColId: string, commodityFilter: string | undefined): Promise<GridRow[]> {
  const collected = new Map<string, GridRow>();
  const nextBtn = page.locator("[data-ref='btNext']");

  for (let pageIndex = 0; pageIndex < 30; pageIndex++) {
    const rows = await page.evaluate(() => {
      const byRowId: Record<string, Record<string, string | undefined>> = {};
      document.querySelectorAll(".ag-cell").forEach((c) => {
        const rowEl = c.closest("[row-id]");
        if (!rowEl) return;
        const rowId = rowEl.getAttribute("row-id")!;
        if (!byRowId[rowId]) byRowId[rowId] = {};
        byRowId[rowId][c.getAttribute("col-id") ?? ""] = c.textContent?.trim();
      });
      return Object.values(byRowId);
    });

    for (const row of rows as GridRow[]) {
      if (!row[dateColId]) continue;
      if (commodityFilter && row["commodity"] !== commodityFilter) continue;
      collected.set(row[dateColId]!, row);
    }

    const ariaDisabled = await nextBtn.getAttribute("aria-disabled").catch(() => "true");
    if (ariaDisabled === "true") break;
    await nextBtn.click();
    // The grid re-renders after pagination; a fixed wait is used rather
    // than networkidle since AG Grid's internal re-render doesn't
    // necessarily fire a new network request.
    await page.waitForTimeout(700);
  }

  return [...collected.values()];
}

async function scrapePage(page: Page, config: RbiPageConfig): Promise<GridRow[]> {
  await page.goto(`${RBIHUB_BASE_URL}${config.path}`, { waitUntil: "networkidle", timeout: 30000 });

  // Only pages that declare monthSelectLabel need the period-select step
  // (verified live: CPI defaults to a single month and needs "All
  // months" picked; the treasury-bills yield page has no selects at all
  // and shows its full history by default).
  if (config.monthSelectLabel) {
    const selects = await page.$$("select");
    if (selects.length < 2) {
      throw new RbiScrapeError(
        `Expected at least 2 <select> controls on ${config.path}, found ${selects.length}. The mirror's page layout may have changed.`
      );
    }
    // The second select is the period/month selector on the pages this
    // adapter targets (verified live 2026-09-03); the first is a base-year
    // or unit selector. This ordering assumption is exactly the kind of
    // thing that breaks silently on a redesign — health() below is meant
    // to catch that early.
    await selects[1]!.selectOption({ label: config.monthSelectLabel }).catch(() => {
      throw new RbiScrapeError(`"${config.monthSelectLabel}" option not found in the period selector on ${config.path}.`);
    });
    await page.waitForTimeout(1500);
  }

  const rows = await extractAllPages(page, config.dateColId, config.commodityFilter);
  if (rows.length === 0) {
    throw new RbiScrapeError(`No rows extracted from ${config.path} — the grid's column IDs or structure may have changed.`);
  }
  return rows;
}

function parseNumeric(text: string | undefined): number | null {
  if (!text || text === "-" || text === "") return null;
  const cleaned = text.replace(/%/g, "").replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export interface RbiAdapterConfig {
  headless?: boolean;
  // playwright-core ships no browser binary. Either run `npx playwright
  // install chromium` so the default lookup succeeds, or pass the path to
  // an existing Chromium/Chrome install explicitly (e.g. Playwright's own
  // cache dir, or a system Chrome). Left undefined, chromium.launch() uses
  // Playwright's normal resolution and throws a clear error if no browser
  // is found — this adapter does not silently no-op on a missing browser.
  executablePath?: string;
}

export function createRbiAdapter(config: RbiAdapterConfig = {}): SourceAdapter {
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

  async function scrapeAllSeries(): Promise<Observation[]> {
    return withBrowser(async (page) => {
      const out: Observation[] = [];
      for (const pageConfig of RBI_PAGES) {
        const rows = await scrapePage(page, pageConfig);
        for (const [internalId, colId] of Object.entries(pageConfig.columnMap)) {
          for (const row of rows) {
            const value = parseNumeric(row[colId!]);
            if (value === null) continue;
            const rawDate = row[pageConfig.dateColId]!;
            // CPI's dateColId ("month") holds "YYYY-MM" and needs a day
            // appended; the treasury-bills page's dateColId ("period")
            // already holds a full "YYYY-MM-DD" date. Normalise on
            // whichever shape is present rather than assuming one.
            const date = /^\d{4}-\d{2}$/.test(rawDate) ? `${rawDate}-01` : rawDate;
            out.push({
              seriesId: internalId,
              date,
              value,
              raw: row,
            });
          }
        }
      }
      return out;
    });
  }

  return {
    id: "RBI",
    series: RBI_PAGES.flatMap((p) => Object.keys(p.columnMap)),

    async fetchLatest(): Promise<Observation[]> {
      const all = await scrapeAllSeries();
      const bySeriesLatest = new Map<string, Observation>();
      for (const obs of all) {
        const existing = bySeriesLatest.get(obs.seriesId);
        if (!existing || obs.date > existing.date) bySeriesLatest.set(obs.seriesId, obs);
      }
      return [...bySeriesLatest.values()];
    },

    // The mirror's per-page "All months" view returns whatever trailing
    // window it's configured to show (confirmed 15 months on the CPI page
    // as of 2026-09-03) — there is no from/to range parameter to request
    // a specific window, so fetchHistory returns the same full set
    // fetchLatest's scrape produces and lets the caller filter.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const all = await scrapeAllSeries();
      return all.filter((o) => {
        const d = new Date(o.date);
        return d >= from && d <= to;
      });
    },

    async health(): Promise<HealthStatus> {
      try {
        const rows = await withBrowser((page) => scrapePage(page, RBI_PAGES[0]!));
        return {
          source: "RBI",
          ok: rows.length > 0,
          lastChecked: new Date().toISOString(),
          detail: rows.length > 0 ? null : "scrape returned zero rows",
        };
      } catch (err) {
        return {
          source: "RBI",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
