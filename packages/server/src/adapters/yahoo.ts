import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.6 — S&P 500 Forward P/E. Live-checked 2026-09-15: Yahoo Finance does
// NOT publish a forward P/E for the index itself (^GSPC's quoteSummary
// returns an empty forwardPE field) — confirmed live, not assumed. The
// only way to get this figure is to aggregate it from all ~500
// constituents' own forwardPE + marketCap, same approach as the standard
// "weighted harmonic P/E" method: index forward P/E = total market cap /
// total forward earnings, where each constituent's forward earnings =
// marketCap / forwardPE.
//
// Two real HTTP dependencies, both live-verified 2026-09-15:
//   1. Constituent list: en.wikipedia.org's "List of S&P 500 companies"
//      article has a real (non-JS-rendered) HTML table with a stable
//      `id="constituents"` anchor — 501 tickers extracted live. Fragile in
//      the usual "a public wiki page's markup can change" sense, but nothing
//      more exotic than that; no bot-wall encountered.
//   2. Per-ticker forwardPE + marketCap: Yahoo's `v7/finance/quote` endpoint
//      requires a crumb token, obtained via a real (undocumented but
//      currently free, no-login) cookie+crumb handshake:
//        a. GET https://fc.yahoo.com to seed a session cookie
//        b. GET query1.finance.yahoo.com/v1/test/getcrumb (with that cookie)
//           -> returns a plain-text crumb
//        c. GET v7/finance/quote?symbols=...&crumb=... (with the same
//           cookie) -> batched quote data, confirmed up to 300 symbols in
//           one request (2 requests cover the full ~501-ticker list,
//           not 501 individual calls).
//      No official SLA on this flow — Yahoo's unofficial quote API is
//      known to rotate/rate-limit without notice. health() below hits it
//      for real rather than assuming yesterday's success still holds.
const WIKIPEDIA_SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const YAHOO_COOKIE_SEED_URL = "https://fc.yahoo.com";
const YAHOO_CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Batch size headroom under the 300 confirmed live — leaves margin against
// URL-length limits without re-verifying the exact ceiling each time.
const BATCH_SIZE = 250;

export const SP500_FWD_PE_SERIES_ID = "sp500_fwd_pe";

export class YahooFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YahooFetchError";
  }
}

// Pure parse step, split out from the network call for the same reason
// nse.ts / amfi.ts split their row-mapping out — testable against a fixture
// without hitting Wikipedia. Table structure verified live 2026-09-15:
// each constituent row's first <td> contains a single <a> whose text is
// the ticker, inside the table anchored by id="constituents".
// Split from the "is this a real full page" guard below so the extraction
// regex itself can be unit-tested against a small trimmed fixture without
// needing all ~500 real rows present.
export function extractTickersFromConstituentsTable(html: string): string[] {
  const start = html.indexOf('id="constituents"');
  if (start === -1) {
    throw new YahooFetchError('Wikipedia S&P 500 page has no id="constituents" table — its layout may have changed.');
  }
  const end = html.indexOf("</table>", start);
  const tableHtml = end === -1 ? html.slice(start) : html.slice(start, end);
  const matches = [...tableHtml.matchAll(/<tr id="[^"]*">\s*<td[^>]*><a[^>]*>([A-Z.\-]+)<\/a><\/td>/g)];
  return matches.map((m) => m[1]!);
}

export function parseSp500TickersFromWikipediaHtml(html: string): string[] {
  const tickers = extractTickersFromConstituentsTable(html);
  if (tickers.length < 400) {
    // The S&P 500 has ~500-503 constituents (share-class splits like
    // BRK-B/GOOGL+GOOG mean the exact count drifts); under 400 means the
    // table markup likely changed rather than the index shrinking.
    throw new YahooFetchError(`Only extracted ${tickers.length} tickers from the Wikipedia table — expected ~500. Page layout may have changed.`);
  }
  return tickers;
}

interface YahooQuoteResult {
  symbol: string;
  forwardPE?: number;
  marketCap?: number;
}

interface YahooQuoteResponse {
  quoteResponse: {
    result: YahooQuoteResult[];
    error: unknown;
  };
}

// Pure aggregation step: weighted-harmonic-mean forward P/E across
// constituents, same formula as the standard index-level P/E construction
// (§ this file's header comment) — index forward earnings = sum of each
// constituent's (marketCap / forwardPE), index forward P/E = total
// marketCap / total forward earnings. Constituents missing either field
// (funds/recent listings sometimes have no forwardPE) are dropped, not
// guessed.
export function aggregateForwardPe(quotes: YahooQuoteResult[]): number {
  let totalMarketCap = 0;
  let totalForwardEarnings = 0;
  for (const q of quotes) {
    if (!q.forwardPE || !q.marketCap || q.forwardPE <= 0) continue;
    totalMarketCap += q.marketCap;
    totalForwardEarnings += q.marketCap / q.forwardPE;
  }
  if (totalForwardEarnings === 0) {
    throw new YahooFetchError("No constituents had both forwardPE and marketCap — cannot aggregate an index-level figure.");
  }
  return totalMarketCap / totalForwardEarnings;
}

async function fetchSp500Tickers(): Promise<string[]> {
  const res = await request(WIKIPEDIA_SP500_URL, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new YahooFetchError(`Wikipedia S&P 500 page fetch failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const html = await res.body.text();
  return parseSp500TickersFromWikipediaHtml(html);
}

// Cookie + crumb handshake — see file-level comment for why this exists.
// Returns the cookie header value to replay on the quote request.
async function getCookieAndCrumb(): Promise<{ cookie: string; crumb: string }> {
  const seedRes = await request(YAHOO_COOKIE_SEED_URL, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT },
  });
  await seedRes.body.text();
  const setCookie = seedRes.headers["set-cookie"];
  const cookieHeaders = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookieHeaders.map((h) => h.split(";")[0]).join("; ");
  if (!cookie) {
    throw new YahooFetchError(`No cookie returned from ${YAHOO_COOKIE_SEED_URL} (status ${seedRes.statusCode}).`);
  }

  const crumbRes = await request(YAHOO_CRUMB_URL, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Cookie: cookie },
  });
  const crumb = (await crumbRes.body.text()).trim();
  if (crumbRes.statusCode !== 200 || !crumb || crumb.includes("<")) {
    throw new YahooFetchError(`Failed to obtain a Yahoo Finance crumb (status ${crumbRes.statusCode}): ${crumb.slice(0, 200)}`);
  }
  return { cookie, crumb };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchQuotesBatch(symbols: string[], cookie: string, crumb: string): Promise<YahooQuoteResult[]> {
  const params = new URLSearchParams({ symbols: symbols.join(","), crumb });
  const res = await request(`${YAHOO_QUOTE_URL}?${params.toString()}`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", Cookie: cookie },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new YahooFetchError(`Yahoo quote batch failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const data = (await res.body.json()) as YahooQuoteResponse;
  if (data.quoteResponse.error) {
    throw new YahooFetchError(`Yahoo quote batch returned an error: ${JSON.stringify(data.quoteResponse.error)}`);
  }
  return data.quoteResponse.result ?? [];
}

async function fetchAggregatedForwardPe(): Promise<number> {
  const tickers = await fetchSp500Tickers();
  const { cookie, crumb } = await getCookieAndCrumb();
  const batches = chunk(tickers, BATCH_SIZE);
  const allQuotes: YahooQuoteResult[] = [];
  for (const batch of batches) {
    const quotes = await fetchQuotesBatch(batch, cookie, crumb);
    allQuotes.push(...quotes);
  }
  return aggregateForwardPe(allQuotes);
}

export function createYahooAdapter(): SourceAdapter {
  return {
    id: "YAHOO",
    series: [SP500_FWD_PE_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const value = await fetchAggregatedForwardPe();
      const asOfDate = new Date().toISOString().slice(0, 10);
      return [{ seriesId: SP500_FWD_PE_SERIES_ID, date: asOfDate, value, raw: { constituentAggregation: true } }];
    },

    // Yahoo's unofficial quote endpoint exposes only current values, no
    // historical range for this aggregation (and re-deriving a historical
    // index-level forward P/E would need historical constituent-level
    // forwardPE too, which isn't available at all) — same honest no-op
    // pattern as bullion.ts / nse.ts fetchHistory().
    async fetchHistory(): Promise<Observation[]> {
      throw new YahooFetchError(
        "No historical source for constituent-level forward P/E exists — this adapter can only aggregate today's snapshot. " +
          "History must accumulate via repeated fetchLatest() calls (daily refresh), not backfill."
      );
    },

    async health(): Promise<HealthStatus> {
      try {
        const value = await fetchAggregatedForwardPe();
        return {
          source: "YAHOO",
          ok: Number.isFinite(value) && value > 0,
          lastChecked: new Date().toISOString(),
          detail: null,
        };
      } catch (err) {
        return {
          source: "YAHOO",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
