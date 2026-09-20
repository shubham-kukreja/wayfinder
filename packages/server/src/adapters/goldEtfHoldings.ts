import { request } from "undici";
import * as XLSX from "xlsx";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §8.5 (Calculation Guide row 23) etfHoldings input for
// metalsFundamentalsScore — "Global gold ETF holdings rising 3M: +10;
// falling: -10." Previously sourced from Yahoo Finance's v7/finance/quote
// `sharesOutstanding` field (adapters/yahooMetals.ts,
// gold_etf_shares_outstanding), which is confirmed LATEST-ONLY: that
// endpoint has no historical range, so the trend derivation
// (goldEtfHoldingsTrend() in pipeline/derive.ts, which needs an
// observation from ~3 calendar months before asOfDate) could never
// resolve until ~3 months of daily refreshes had accumulated from
// scratch.
//
// FIX (2026-09-20): SPDR (the GLD trust's own sponsor, State Street /
// World Gold Trust Services) publishes an official historical-archive
// API at api.spdrgoldshares.com, discovered via a download link on
// spdrgoldshares.com/usa/gld/. Confirmed live: no auth, no Cloudflare
// wall (unlike WGC's own Goldhub Excel, which returns HTTP 403 — see
// dbnomics.ts's file comment), `access-control-allow-origin: *`, daily
// cache (`cache-control: public, s-maxage=86400`). Returns a genuine
// .xlsx workbook whose second sheet ("US GLD Historical Archive") carries
// a DAILY "Tonnes of Gold" column back to 2004-11-18 (5695 real rows
// confirmed live) — the trust's actual physical gold holdings, a more
// direct creation/redemption flow measure than sharesOutstanding, and
// with enough real history to answer the 3M trend on day one instead of
// waiting for it to accumulate.
//
// SCOPE: GLD only, not GLD+IAU combined like the old Yahoo series. GLD
// alone is the single largest physically-backed gold ETF (~$150B AUM,
// confirmed live via the same archive's NAV column) and is the standard
// reference used for "gold ETF holdings" in market commentary; IAU
// (BlackRock/iShares) has no equivalent no-auth archive endpoint found
// (its fund page links a BlackRock document-download API gated the same
// way as other BlackRock product data, not retried here). Stored as its
// own series (`gold_etf_tonnes`), NOT merged into
// `gold_etf_shares_outstanding` — different fund scope (GLD alone vs
// GLD+IAU) and different unit (tonnes vs raw share count), so conflating
// them would silently change what past values in that series meant.
// yahooMetals.ts's gold_etf_shares_outstanding fetch is left in place
// (still real, still latest-only) but is no longer what
// goldEtfHoldingsTrend() reads.
export const GOLD_ETF_TONNES_SERIES_ID = "gold_etf_tonnes";

const ARCHIVE_URL = "https://api.spdrgoldshares.com/api/v1/historical-archive?product=gld&exchange=NYSE&lang=en";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DATE_COL = "Date";
const TONNES_COL = "Tonnes of Gold";

export class GoldEtfHoldingsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldEtfHoldingsFetchError";
  }
}

// The archive's Date column is a plain string like "18-Nov-2004", not an
// Excel date serial (confirmed live: xlsx.js returns it as a JS string,
// not a number) — parsed by hand rather than trusting Date's own
// "DD-Mon-YYYY" parsing, which is locale-dependent in Node.
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseArchiveDate(raw: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, day, monAbbr, year] = m as unknown as [string, string, string, string];
  const month = MONTHS[monAbbr];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

export function parseGoldEtfArchive(buffer: Buffer): Observation[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const dataSheetName = workbook.SheetNames.find((name) => name !== "Disclaimer") ?? workbook.SheetNames[1];
  const sheet = dataSheetName ? workbook.Sheets[dataSheetName] : undefined;
  if (!sheet) {
    throw new GoldEtfHoldingsFetchError("GLD archive workbook had no data sheet (expected a second sheet alongside 'Disclaimer').");
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 0 });
  const out: Observation[] = [];
  for (const row of rows) {
    const rawDate = row[DATE_COL];
    const rawTonnes = row[TONNES_COL];
    if (typeof rawDate !== "string" || typeof rawTonnes !== "number" || !Number.isFinite(rawTonnes)) continue; // "US Holiday" rows and similar non-data rows: dropped, not guessed
    const date = parseArchiveDate(rawDate);
    if (!date) continue;
    out.push({ seriesId: GOLD_ETF_TONNES_SERIES_ID, date, value: rawTonnes, raw: { fund: "GLD", column: TONNES_COL } });
  }
  if (out.length === 0) {
    throw new GoldEtfHoldingsFetchError(`GLD archive parsed but yielded zero valid observations — check for a column-header change (expected "${DATE_COL}" / "${TONNES_COL}").`);
  }
  return out;
}

async function fetchArchiveBuffer(): Promise<Buffer> {
  const res = await request(ARCHIVE_URL, { method: "GET", headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new GoldEtfHoldingsFetchError(`SPDR GLD archive request failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.body.arrayBuffer());
}

export function createGoldEtfHoldingsAdapter(): SourceAdapter {
  return {
    id: "GOLD_ETF_HOLDINGS",
    series: [GOLD_ETF_TONNES_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const observations = parseGoldEtfArchive(await fetchArchiveBuffer());
      return observations.length > 0 ? [observations[observations.length - 1]!] : [];
    },

    // The archive is the FULL history on every request (no range params
    // supported by the endpoint, confirmed live) — filtered to the
    // requested window rather than re-fetched per range.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const observations = parseGoldEtfArchive(await fetchArchiveBuffer());
      return observations.filter((o) => {
        const d = new Date(o.date);
        return d >= from && d <= to;
      });
    },

    async health(): Promise<HealthStatus> {
      try {
        const observations = parseGoldEtfArchive(await fetchArchiveBuffer());
        return {
          source: "GOLD_ETF_HOLDINGS",
          ok: observations.length > 0,
          lastChecked: new Date().toISOString(),
          detail: observations.length > 0 ? null : "GLD archive parsed to zero observations",
        };
      } catch (err) {
        return {
          source: "GOLD_ETF_HOLDINGS",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
