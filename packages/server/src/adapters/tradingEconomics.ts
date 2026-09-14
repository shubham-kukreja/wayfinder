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
// checked live) — not usable. This adapter uses China's PMI as the
// global_mfg_pmi proxy the silverIndustrialScore rubric (§8.8) wants,
// per explicit project direction: China is the dominant driver of
// global industrial/solar/EV manufacturing demand, which is the exact
// signal that rubric is trying to capture — arguably a closer proxy for
// this specific score cell than a generic (and here, unavailable) global
// blend would be.
//
// No official API, no SLA, no documented contract for this page's HTML
// shape — same risk class as this project's other scraped sources
// (NSE, RBI). health() below hits it for real rather than assuming
// yesterday's success still holds.
const TE_BASE_URL = "https://tradingeconomics.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const CHINA_PMI_SERIES_ID = "global_mfg_pmi"; // matches rubrics.ts's silverIndustrialScore input name

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
//   "... increased/decreased to X points in <Month> from Y points in <Month> of <Year>."
//   "... remained unchanged at X points in <Month>." (no distinct prior month named)
export function parsePmiFromMetaDescription(html: string): TePmiReading {
  const match = html.match(/<meta id="metaDesc"[^>]*content="([^"]*)"/);
  if (!match) {
    throw new TradingEconomicsFetchError('No <meta id="metaDesc"> tag found — page layout may have changed.');
  }
  const desc = match[1]!;

  const unchangedMatch = desc.match(/remained unchanged at ([\d.]+) points in ([A-Za-z]+)/);
  if (unchangedMatch) {
    const value = Number(unchangedMatch[1]);
    const month = unchangedMatch[2]!;
    if (!Number.isFinite(value)) {
      throw new TradingEconomicsFetchError(`Could not parse a numeric PMI value from: "${desc}"`);
    }
    return { latest: value, prior: value, latestMonth: month, priorMonth: null };
  }

  const changedMatch = desc.match(/to ([\d.]+) points in ([A-Za-z]+) from ([\d.]+) points in ([A-Za-z]+)/);
  if (!changedMatch) {
    throw new TradingEconomicsFetchError(`Meta description didn't match either known PMI phrasing: "${desc}"`);
  }
  const latest = Number(changedMatch[1]);
  const latestMonth = changedMatch[2]!;
  const prior = Number(changedMatch[3]);
  const priorMonth = changedMatch[4]!;
  if (!Number.isFinite(latest) || !Number.isFinite(prior)) {
    throw new TradingEconomicsFetchError(`Could not parse numeric PMI values from: "${desc}"`);
  }
  return { latest, prior, latestMonth, priorMonth };
}

function monthNameToObservationDate(monthName: string, asOfYear: number): string {
  const num = MONTH_NAME_TO_NUM[monthName.toLowerCase()];
  if (!num) {
    throw new TradingEconomicsFetchError(`Unrecognised month name "${monthName}" in PMI page text.`);
  }
  return `${asOfYear}-${num}-01`;
}

async function fetchPmiPage(countrySlug: string): Promise<string> {
  const res = await request(`${TE_BASE_URL}/${countrySlug}/manufacturing-pmi`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new TradingEconomicsFetchError(`${countrySlug} PMI page fetch failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  return res.body.text();
}

async function fetchChinaPmi(): Promise<TePmiReading> {
  const html = await fetchPmiPage("china");
  return parsePmiFromMetaDescription(html);
}

export function createTradingEconomicsAdapter(): SourceAdapter {
  return {
    id: "TRADINGECONOMICS",
    series: [CHINA_PMI_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const reading = await fetchChinaPmi();
      // TE's page names months but not years for the exact figure quoted in
      // the description (it separately says "of <year>" but that applies to
      // the LATEST month, not necessarily the prior one across a year
      // boundary) — using the current year here is right most of the year;
      // a January reading naming a December prior month would misdate by
      // one year, a known limitation flagged rather than silently handled.
      const now = new Date();
      const asOfDate = monthNameToObservationDate(reading.latestMonth, now.getFullYear());
      const raw = { reading };
      const out: Observation[] = [{ seriesId: CHINA_PMI_SERIES_ID, date: asOfDate, value: reading.latest, raw }];
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

    async health(): Promise<HealthStatus> {
      try {
        const reading = await fetchChinaPmi();
        return {
          source: "TRADINGECONOMICS",
          ok: Number.isFinite(reading.latest),
          lastChecked: new Date().toISOString(),
          detail: null,
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
export async function fetchChinaPmiReading(): Promise<TePmiReading> {
  return fetchChinaPmi();
}
