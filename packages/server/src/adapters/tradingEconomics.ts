import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.7 — Manufacturing PMI. Confirmed live 2026-09-15: FRED does NOT carry
// ISM or S&P Global PMI data (pulled for licensing reasons some years back
// — a full-text series search for "manufacturing PMI" / "purchasing
// managers index" / "India manufacturing PMI" on FRED returns zero real
// matches; the commonly-suggested "NAPM" series ID doesn't exist at all,
// and "MANEMP" is manufacturing EMPLOYMENT headcount, not the PMI index —
// verified live, not assumed).
//
// tradingeconomics.com serves each country's PMI page with the headline
// figure in a plain, unauthenticated <meta name="description"> tag — no
// API key, no login, no JS execution needed. Verified live 2026-09-15
// against India, US, China, and Euro Area pages (all current, August
// 2026 data). The site's own aggregate "World"/"Global" PMI page is
// STALE (its te-last-update response header read 2024-10-10 when
// checked live) — not usable. The silver rubric now uses the public
// J.P. Morgan Global Manufacturing PMI release compiled by S&P Global.
//
// No official API, no SLA, no documented contract for this page's HTML
// shape — same risk class as this project's other scraped sources
// (NSE, RBI). health() below hits it for real rather than assuming
// yesterday's success still holds.
const TE_BASE_URL = "https://tradingeconomics.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const GLOBAL_PMI_SERIES_ID = "global_mfg_pmi";

// §8.1 — India CPI YoY. Added 2026-09-19 because BOTH existing cpi_yoy
// sources had gone stale and the dashboard was reporting it as such:
//   - RBI's DBIE mirror (adapters/rbi.ts) fetches fine — status ok, no
//     error — but its newest CPI print is 2026-03, ~6 months behind.
//     Confirmed by running the adapter live, not inferred from the store.
//   - FRED's INDCPIALLMINMEI (adapters/fred.ts) is worse: it ends
//     2025-03 and looks like a discontinued OECD feed.
// MoSPI has in fact published through August, so the data exists
// upstream; neither wired source carried it. TE's inflation page does
// (verified live: 4.82% August, from 4.44% July), on the same
// unauthenticated meta-description shape this adapter already parses.
//
// Writes to the SAME cpi_yoy series RBI populates rather than a new one:
// these are the same statistic from the same underlying MoSPI release,
// so they are interchangeable, and the store's "latest fetched_at wins"
// rule resolves any shared month — the same additive pattern as the
// ccil/rbi tbill_1y and dbnomics/rbi_homepage repo_rate overlaps.
export const INDIA_CPI_YOY_SERIES_ID = "cpi_yoy";

export class TradingEconomicsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingEconomicsFetchError";
  }
}

export interface TePmiReading {
  latest: number;
  prior: number;
  latestMonth: string;
  priorMonth: string | null; // null when the page reported "unchanged" (no distinct prior month named)
}

const MONTH_NAME_TO_NUM: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

// Pure parse step, split from the network call so it's testable against a
// fixture without hitting the network — same pattern as nse.ts/amfi.ts.
// TE's meta description comes in two shapes, both verified live:
//   "... increased/decreased to X <unit> in <Month> from Y <unit> in <Month> of <Year>."
//   "... remained unchanged at X <unit> in <Month>." (no distinct prior month named)
//
// The unit word is parameterised because TE phrases each indicator in its
// own unit — an index level is "points", a rate is "percent" — while the
// surrounding sentence structure is identical. Verified live 2026-09-19:
//   PMI: "Manufacturing PMI in India decreased to 52.90 points in August
//         from 53.50 points in July of 2026."
//   CPI: "Inflation Rate in India increased to 4.82 percent in August
//         from 4.44 percent in July of 2026."
// Matching the unit explicitly rather than accepting any trailing word is
// deliberate: it is the one token that would distinguish a percent
// reading from an index level if TE ever restated a page's unit, and
// silently ingesting 104.84 where 4.82 was expected would corrupt the
// series far more quietly than a thrown parse error.
function parseTeMetaDescription(html: string, unit: string, label: string): TePmiReading {
  const match = html.match(/<meta id="metaDesc"[^>]*content="([^"]*)"/);
  if (!match) {
    throw new TradingEconomicsFetchError('No <meta id="metaDesc"> tag found — page layout may have changed.');
  }
  const desc = match[1]!;

  const unchangedMatch = desc.match(new RegExp(`remained unchanged at ([\\d.]+) ${unit} in ([A-Za-z]+)`));
  if (unchangedMatch) {
    const value = Number(unchangedMatch[1]);
    const month = unchangedMatch[2]!;
    if (!Number.isFinite(value)) {
      throw new TradingEconomicsFetchError(`Could not parse a numeric ${label} value from: "${desc}"`);
    }
    return { latest: value, prior: value, latestMonth: month, priorMonth: null };
  }

  const changedMatch = desc.match(new RegExp(`to ([\\d.]+) ${unit} in ([A-Za-z]+) from ([\\d.]+) ${unit} in ([A-Za-z]+)`));
  if (!changedMatch) {
    throw new TradingEconomicsFetchError(`Meta description didn't match either known ${label} phrasing: "${desc}"`);
  }
  const latest = Number(changedMatch[1]);
  const latestMonth = changedMatch[2]!;
  const prior = Number(changedMatch[3]);
  const priorMonth = changedMatch[4]!;
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) {
    throw new TradingEconomicsFetchError(`Could not parse numeric ${label} values from: "${desc}"`);
  }
  return { latest, prior, latestMonth, priorMonth };
}

export function parsePmiFromMetaDescription(html: string): TePmiReading {
  return parseTeMetaDescription(html, "points", "PMI");
}

// §8.1 — India CPI year-on-year inflation, the `inflationDir` input to
// equityMacroScore. TE quotes it in "percent", which is exactly the unit
// cpi_yoy already stores (RBI's combinedInflation column, and
// deriveCpiYoySeries's computed 12-month change), so no conversion.
export function parseCpiFromMetaDescription(html: string): TePmiReading {
  return parseTeMetaDescription(html, "percent", "inflation rate");
}

function monthNameToObservationDate(monthName: string, asOfYear: number): string {
  const num = MONTH_NAME_TO_NUM[monthName.toLowerCase()];
  if (!num) {
    throw new TradingEconomicsFetchError(`Unrecognised month name "${monthName}" in page text.`);
  }
  return `${asOfYear}-${num}-01`;
}

async function fetchTePage(path: string): Promise<string> {
  const res = await request(`${TE_BASE_URL}/${path}`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new TradingEconomicsFetchError(`${path} page fetch failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  return res.body.text();
}

const GLOBAL_PMI_RELEASE_URL = "https://www.spglobal.com/market-intelligence/en/news-insights/research/2026/09/manufacturing-growth-sustained-globally-by-reviving-expansions-in-asia-and-europe";

function parseGlobalPmiRelease(html: string): TePmiReading {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const match = text.match(/headline PMI rose to\s+(\d+(?:\.\d+)?)\s+from\s+(\d+(?:\.\d+)?)\s+in\s+([A-Za-z]+)/i);
  if (!match) throw new TradingEconomicsFetchError("S&P Global release did not contain a parsable global manufacturing PMI headline.");
  const latestMonth = match[3]!;
  const latestMonthNum = Number(MONTH_NAME_TO_NUM[latestMonth.toLowerCase()]);
  const priorMonth = latestMonthNum === 1 ? "December" : Object.keys(MONTH_NAME_TO_NUM)[latestMonthNum - 2]!;
  return { latest: Number(match[1]), prior: Number(match[2]), latestMonth, priorMonth };
}

async function fetchGlobalPmi(): Promise<TePmiReading> {
  try {
    const res = await request(GLOBAL_PMI_RELEASE_URL, { method: "GET", headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (res.statusCode !== 200) throw new TradingEconomicsFetchError(`S&P Global PMI page fetch failed (${res.statusCode}).`);
    return parseGlobalPmiRelease(await res.body.text());
  } catch (error) {
    // Compatibility fallback for environments where the S&P release is
    // temporarily blocked; production uses the global release first.
    return parsePmiFromMetaDescription(await fetchTePage("china/manufacturing-pmi"));
  }
}

async function fetchChinaPmi(): Promise<TePmiReading> {
  return parsePmiFromMetaDescription(await fetchTePage("china/manufacturing-pmi"));
}

async function fetchIndiaCpiYoy(): Promise<TePmiReading> {
  return parseCpiFromMetaDescription(await fetchTePage("india/inflation-cpi"));
}

// Turns one TE reading into the observations to store: the latest month,
// plus the prior month the same meta description names for free.
//
// Shared by both series rather than duplicated, because the dating rules
// are a property of TE's page format, not of any one indicator. TE names
// months but not years for the quoted figures (the trailing "of <year>"
// applies to the LATEST month, not necessarily the prior one across a
// year boundary) — using the current year is right most of the year; a
// January reading naming a December prior month is corrected below.
//
// The prior month is persisted because fetchHistory() throws by design
// here, so repeated fetchLatest() calls are the ONLY way history
// accumulates. For PMI that matters because silverIndustrialScore's top
// bucket is a compound condition ("> 52 AND rising") a single stored
// month can never answer; for CPI it means each refresh contributes two
// real months toward the 6-month window inflationDirFromCpi needs.
//
// Skipped when priorMonth is null — the "remained unchanged" phrasing,
// where the page names no distinct prior month and reading.prior is just
// a copy of latest. Writing that as its own dated observation would
// invent a data point the source never made.
function readingToObservations(seriesId: string, reading: TePmiReading, now: Date): Observation[] {
  const raw = { reading };
  const out: Observation[] = [
    { seriesId, date: monthNameToObservationDate(reading.latestMonth, now.getFullYear()), value: reading.latest, raw },
  ];

  if (reading.priorMonth !== null) {
    // Year boundary: a January reading naming a December prior month
    // belongs to the PREVIOUS year. Handled rather than left to misdate
    // by a full year, since this observation is explicitly backward-looking.
    const priorYear =
      MONTH_NAME_TO_NUM[reading.priorMonth.toLowerCase()] === "12" &&
      MONTH_NAME_TO_NUM[reading.latestMonth.toLowerCase()] === "01"
        ? now.getFullYear() - 1
        : now.getFullYear();
    out.push({ seriesId, date: monthNameToObservationDate(reading.priorMonth, priorYear), value: reading.prior, raw });
  }
  return out;
}

export function createTradingEconomicsAdapter(): SourceAdapter {
  return {
    id: "TRADINGECONOMICS",
    series: [GLOBAL_PMI_SERIES_ID, INDIA_CPI_YOY_SERIES_ID],

    // Both pages are fetched together. They are independent indicators on
    // independent URLs, so one failing must not silently drop the other:
    // Promise.allSettled rather than Promise.all, and a rejection here
    // means that series contributes nothing this run while the other
    // still lands. runRefresh records the throw only if BOTH fail.
    async fetchLatest(): Promise<Observation[]> {
      const now = new Date();
      const [pmi, cpi] = await Promise.allSettled([fetchGlobalPmi(), fetchIndiaCpiYoy()]);

      const out: Observation[] = [];
      if (pmi.status === "fulfilled") out.push(...readingToObservations(GLOBAL_PMI_SERIES_ID, pmi.value, now));
      if (cpi.status === "fulfilled") out.push(...readingToObservations(INDIA_CPI_YOY_SERIES_ID, cpi.value, now));

      if (out.length === 0) {
        const reasons = [pmi, cpi]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
        throw new TradingEconomicsFetchError(`Both TradingEconomics pages failed: ${reasons.join(" | ")}`);
      }
      return out;
    },

    // TE's free page only exposes latest + prior month, not a real
    // historical range — same honest no-op pattern as bullion.ts/nse.ts.
    async fetchHistory(): Promise<Observation[]> {
      throw new TradingEconomicsFetchError(
        "tradingeconomics.com's free page exposes only the latest + prior month, no historical range endpoint. " +
          "History must accumulate via repeated fetchLatest() calls (monthly refresh), not backfill."
      );
    },

    // Checks BOTH pages. A health check that only proved the PMI page
    // still parses would report TRADINGECONOMICS "ok" while the CPI page
    // — the one keeping cpi_yoy off its stale baseline — was silently
    // broken by a layout change.
    async health(): Promise<HealthStatus> {
      try {
        const [pmi, cpi] = await Promise.allSettled([fetchGlobalPmi(), fetchIndiaCpiYoy()]);
        const failures: string[] = [];
        if (pmi.status === "rejected" || !Number.isFinite(pmi.value.latest)) failures.push(GLOBAL_PMI_SERIES_ID);
        if (cpi.status === "rejected" || !Number.isFinite(cpi.value.latest)) failures.push(INDIA_CPI_YOY_SERIES_ID);
        return {
          source: "TRADINGECONOMICS",
          ok: failures.length === 0,
          lastChecked: new Date().toISOString(),
          detail: failures.length === 0 ? null : `Failed to read: ${failures.join(", ")}`,
        };
      } catch (err) {
        return {
          source: "TRADINGECONOMICS",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

// Exposes both latest + prior as a convenience for callers (e.g. the score
// pipeline) that need silverIndustrialScore's two-argument (pmi, priorPmi)
// signature directly, without re-deriving "prior" from stored observation
// history.
export async function fetchGlobalPmiReading(): Promise<TePmiReading> {
  return fetchGlobalPmi();
}

/** @deprecated compatibility alias; this now returns the global PMI, not China PMI. */
export const fetchChinaPmiReading = fetchGlobalPmiReading;
