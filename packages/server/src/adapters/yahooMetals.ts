import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.8 — Historical Gold/Silver ratio backfill, and Gold ETF shares
// outstanding (a real flow proxy for metalsFundamentalsScore's
// etfHoldings input). Confirmed live 2026-09-15.
//
// PROBLEM THIS SOLVES: metals.gold/silver::ratio_position (rubrics fed by
// derivedRatioSeries(gold_inr, silver_inr) in scoreCells.ts) is stuck at
// insufficient_history because bullion.ts's IBJA-benchmarked adapter
// (metals.dev free tier) has NO historical range endpoint at all —
// history only accumulates one point per day going forward.
//
// FIX: Yahoo Finance's `v8/finance/chart` endpoint (NOT the crumb-gated
// quote/quoteSummary endpoints yahoo.ts uses for the S&P 500 adapter —
// this one needs no authentication at all, confirmed live) serves real
// daily OHLC history for COMEX gold/silver futures (GC=F, SI=F) going
// back 5+ years at daily granularity (1260 observations for a 5y/1d
// request, confirmed live). This is a DIFFERENT instrument than IBJA's
// physical INR spot price (USD futures vs INR spot) — stored as its own
// series (gold_usd_futures / silver_usd_futures), NOT written into
// gold_inr/silver_inr, so IBJA's own identity (used elsewhere for
// absolute price levels and l1.metals::momentum) stays uncorrupted by a
// different currency/instrument. The RATIO of gold:silver is what
// matters for ratio_position, and that ratio is currency-agnostic as
// long as both legs share a currency — which USD futures do, same as
// INR spot does — so this is a legitimate substitute for that one
// specific score cell's history, not a silent proxy pretending to be
// the exact IBJA number.
//
// ALSO: gold_etf_shares_outstanding — SPDR Gold Shares (GLD) and
// iShares Gold Trust (IAU) `sharesOutstanding` field, tracked daily.
// Confirmed live via the SAME crumb+cookie flow yahoo.ts already
// implements for the S&P 500 adapter (v7/finance/quote). Shares
// outstanding changes directly reflect ETF creation/redemption activity
// — a real flow proxy, more precise than price/volume momentum — for
// metalsFundamentalsScore's etfHoldings input (currently manual-only).
// This is raw data; deriving the "rising"/"falling" bucket from a 3-month
// trend is left to the score-cell derivation layer (scoreCells.ts), not
// this adapter, matching this project's split between fetch (adapters)
// and interpretation (pipeline).
//
// NOTE what this file does NOT solve: World Gold Council central bank
// gold-buying data (cbBuying) — WGC's Goldhub Excel downloads are
// Cloudflare-blocked ("Access denied" confirmed live 2026-09-15, same
// class of wall as nseindia.com/niftyindices.com). That stays manual.
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_COOKIE_SEED_URL = "https://fc.yahoo.com";
const YAHOO_CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const GOLD_USD_FUTURES_SERIES_ID = "gold_usd_futures";
export const SILVER_USD_FUTURES_SERIES_ID = "silver_usd_futures";
export const GOLD_ETF_SHARES_OUTSTANDING_SERIES_ID = "gold_etf_shares_outstanding";

export class YahooMetalsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YahooMetalsFetchError";
  }
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: { quote: Array<{ close: (number | null)[] }> };
    }> | null;
    error: unknown;
  };
}

// Pure parse step, testable against a fixture without hitting the network
// — same split as this project's other adapters.
export function parseChartObservations(json: YahooChartResponse, seriesId: string): Observation[] {
  if (json.chart.error) {
    throw new YahooMetalsFetchError(`Yahoo chart response carried an error: ${JSON.stringify(json.chart.error)}`);
  }
  const result = json.chart.result?.[0];
  if (!result) {
    throw new YahooMetalsFetchError("Yahoo chart response had no result — symbol may be invalid or delisted.");
  }
  const { timestamp, indicators } = result;
  const closes = indicators.quote[0]?.close ?? [];
  const out: Observation[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined || !Number.isFinite(close)) continue; // a non-trading day gap: dropped, not guessed
    const date = new Date(timestamp[i]! * 1000).toISOString().slice(0, 10);
    out.push({ seriesId, date, value: close, raw: { timestamp: timestamp[i], symbol: seriesId } });
  }
  return out;
}

async function fetchChartHistory(symbol: string, seriesId: string, range: string, interval: string): Promise<Observation[]> {
  const params = new URLSearchParams({ range, interval });
  const res = await request(`${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?${params.toString()}`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new YahooMetalsFetchError(`Yahoo chart request for ${symbol} failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const json = (await res.body.json()) as YahooChartResponse;
  return parseChartObservations(json, seriesId);
}

// Same cookie+crumb handshake as yahoo.ts's S&P 500 adapter — kept as its
// own copy here rather than a shared import, since these two adapters are
// independently disable-able (a Yahoo chart-endpoint outage shouldn't take
// down the S&P 500 aggregation and vice versa) and the duplication is
// small (§ this project doesn't share cross-adapter internals elsewhere
// either — nse.ts and rbi.ts each have their own cookie handling).
async function getCookieAndCrumb(): Promise<{ cookie: string; crumb: string }> {
  const seedRes = await request(YAHOO_COOKIE_SEED_URL, { method: "GET", headers: { "User-Agent": USER_AGENT } });
  await seedRes.body.text();
  const setCookie = seedRes.headers["set-cookie"];
  const cookieHeaders = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookieHeaders.map((h) => h.split(";")[0]).join("; ");
  if (!cookie) {
    throw new YahooMetalsFetchError(`No cookie returned from ${YAHOO_COOKIE_SEED_URL} (status ${seedRes.statusCode}).`);
  }
  const crumbRes = await request(YAHOO_CRUMB_URL, { method: "GET", headers: { "User-Agent": USER_AGENT, Cookie: cookie } });
  const crumb = (await crumbRes.body.text()).trim();
  if (crumbRes.statusCode !== 200 || !crumb || crumb.includes("<")) {
    throw new YahooMetalsFetchError(`Failed to obtain a Yahoo Finance crumb (status ${crumbRes.statusCode}): ${crumb.slice(0, 200)}`);
  }
  return { cookie, crumb };
}

interface YahooQuoteResult {
  symbol: string;
  sharesOutstanding?: number;
}
interface YahooQuoteResponse {
  quoteResponse: { result: YahooQuoteResult[]; error: unknown };
}

// GLD + IAU combined shares outstanding as a single global-proxy figure —
// the two largest physically-backed gold ETFs, same "dominant proxy"
// reasoning this project already applied to China's PMI as the
// global_mfg_pmi proxy.
export async function fetchGoldEtfSharesOutstanding(): Promise<number> {
  const { cookie, crumb } = await getCookieAndCrumb();
  const params = new URLSearchParams({ symbols: "GLD,IAU", crumb });
  const res = await request(`${YAHOO_QUOTE_URL}?${params.toString()}`, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", Cookie: cookie },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new YahooMetalsFetchError(`Yahoo quote request for GLD/IAU failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const data = (await res.body.json()) as YahooQuoteResponse;
  if (data.quoteResponse.error) {
    throw new YahooMetalsFetchError(`Yahoo quote response carried an error: ${JSON.stringify(data.quoteResponse.error)}`);
  }
  let total = 0;
  for (const q of data.quoteResponse.result ?? []) {
    if (q.sharesOutstanding) total += q.sharesOutstanding;
  }
  if (total === 0) {
    throw new YahooMetalsFetchError("Neither GLD nor IAU returned a sharesOutstanding figure.");
  }
  return total;
}

export function createYahooMetalsAdapter(): SourceAdapter {
  return {
    id: "YAHOO_METALS",
    series: [GOLD_USD_FUTURES_SERIES_ID, SILVER_USD_FUTURES_SERIES_ID, GOLD_ETF_SHARES_OUTSTANDING_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const [gold, silver] = await Promise.all([
        fetchChartHistory("GC=F", GOLD_USD_FUTURES_SERIES_ID, "5d", "1d"),
        fetchChartHistory("SI=F", SILVER_USD_FUTURES_SERIES_ID, "5d", "1d"),
      ]);
      const sharesOutstanding = await fetchGoldEtfSharesOutstanding();
      const asOfDate = new Date().toISOString().slice(0, 10);
      const latestGold = gold.length > 0 ? [gold[gold.length - 1]!] : [];
      const latestSilver = silver.length > 0 ? [silver[silver.length - 1]!] : [];
      const etfObservation: Observation = {
        seriesId: GOLD_ETF_SHARES_OUTSTANDING_SERIES_ID,
        date: asOfDate,
        value: sharesOutstanding,
        raw: { symbols: ["GLD", "IAU"] },
      };
      return [...latestGold, ...latestSilver, etfObservation];
    },

    // Real history exists for the futures series (confirmed live: 5y at
    // daily granularity, ~1260 observations) — Yahoo's chart endpoint caps
    // how far back a single daily-interval request reaches before
    // auto-downsampling, so a `from`/`to` range wider than ~5-6y falls back
    // to whatever the "10y" preset actually returns (monthly-equivalent
    // sparsity, confirmed live: 104 points for a 10y/1mo request) rather
    // than failing outright. gold_etf_shares_outstanding has NO historical
    // range on this endpoint (v7/finance/quote is latest-only) — dropped
    // from the returned set, not fabricated.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const yearsSpan = (to.getTime() - from.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const range = yearsSpan <= 6 ? "5y" : "10y";
      const interval = yearsSpan <= 6 ? "1d" : "1mo";
      const [gold, silver] = await Promise.all([
        fetchChartHistory("GC=F", GOLD_USD_FUTURES_SERIES_ID, range, interval),
        fetchChartHistory("SI=F", SILVER_USD_FUTURES_SERIES_ID, range, interval),
      ]);
      const inRange = (o: Observation) => {
        const d = new Date(o.date);
        return d >= from && d <= to;
      };
      return [...gold.filter(inRange), ...silver.filter(inRange)];
    },

    async health(): Promise<HealthStatus> {
      try {
        const gold = await fetchChartHistory("GC=F", GOLD_USD_FUTURES_SERIES_ID, "5d", "1d");
        return {
          source: "YAHOO_METALS",
          ok: gold.length > 0,
          lastChecked: new Date().toISOString(),
          detail: gold.length > 0 ? null : "GC=F chart request returned zero observations",
        };
      } catch (err) {
        return {
          source: "YAHOO_METALS",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
