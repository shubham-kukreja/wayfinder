import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// Calculation Guide "Valuation vs own history" (International) —
// S&P 500 P/E vs its own history, inverted.
//
// WHAT THE SPEC ASKS FOR vs WHAT THIS SUPPLIES — read before using this
// series. The spec names S&P 500 **FORWARD** P/E ("multpl.com or broker
// data for S&P fwd P/E"). multpl.com does NOT publish forward P/E. What
// it publishes, and what this adapter stores, is **TRAILING** twelve-month
// "as reported" P/E. These are materially different numbers on the same
// index at the same moment: confirmed live 2026-09-20, trailing read
// 26.07 while our own Yahoo-derived sp500_fwd_pe read 18.66 — a ~40% gap,
// because forward P/E divides by forecast earnings that are almost always
// above trailing realised ones.
//
// So this is a documented SUBSTITUTE, not the specified input, and it is
// stored under its own series id (sp500_trailing_pe) rather than written
// into sp500_fwd_pe. Writing it into the forward series would have been
// the §1 invariant-3 violation this project has refused elsewhere (see
// fred.ts on the 364-day T-bill): a wrong number with enough observations
// to look confident is worse than an honest insufficient_history.
//
// WHY SUBSTITUTE AT ALL. The percentile the spec wants is "vs its own
// history," and history is exactly what the forward series does not have:
// sp500_fwd_pe is Yahoo-aggregated across ~500 tickers at request time,
// latest-only, and held 6 distinct dates spanning 5 days as of
// 2026-09-20. It cannot answer "where does today sit in its own 10-year
// distribution" for years. multpl.com's trailing series has 1,870 monthly
// rows back to 1871. Ranking today's trailing P/E against its OWN
// trailing history is internally consistent — both sides of the
// comparison are the same metric — so the percentile is meaningful even
// though the level is not the level the spec names. The deviation is
// recorded on the score cell itself so the UI states it rather than
// implying the spec was followed.
//
// Mechanism: a plain unauthenticated GET of a static HTML page with a
// single <table id="datatable">. No API, no key, no cookie handshake, no
// bot-wall encountered (confirmed live 2026-09-20). Last resort by the
// source-priority order — a scrape with no SLA — but the only free source
// found carrying a decade-plus of S&P valuation history.
const MULTPL_URL = "https://www.multpl.com/s-p-500-pe-ratio/table/by-month";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// equity.intl::growth_diff — "US EPS growth minus India's," same rubric as
// equity.{mid,small}::growth_diff, +5 structural INR-depreciation bonus.
// The spec wants CONSENSUS FY+1 EPS growth; no free source publishes that
// for the S&P 500 (FactSet/LSEG/NYSE MAC Desk are all paywalled, confirmed
// live 2026-09-20) — same missing-consensus class as revisions.
//
// DOCUMENTED SUBSTITUTE, TWO STACKED DEVIATIONS, both real and both stated
// here because neither is small enough to bury in a comment on the score
// cell alone:
//
// (1) TRAILING vs CONSENSUS, same class of deviation as sp500_trailing_pe
//     above and as equity.{large,mid,small}::revisions' trailing-EPS
//     proxy: trailing EPS moves on REPORTING, consensus FY+1 moves on
//     analyst REVISION. They can disagree at cycle turns.
// (2) REAL vs NOMINAL. multpl.com's EPS-by-month page (unlike its P/E
//     page) is NOT a raw reported dollar figure — its own page states
//     "12-month real earnings per share — inflation adjusted, constant
//     [latest month] dollars." Confirmed live 2026-09-20: this page's
//     Jun-2026 value (295.36) sits ~14% below a nominal nominal TTM EPS
//     reading for essentially the same period (336.92, GuruFocus) — too
//     large a gap to be reporting lag alone, confirming a genuine
//     real-vs-nominal difference, not just a naming quirk. A YoY %
//     change computed off this series is therefore a REAL EPS growth
//     rate. The India-side leg (Nifty trailing EPS, from
//     nifty100_close ÷ nifty100_pe) has no equivalent deflation applied,
//     so it is a NOMINAL INR growth rate. The gap this cell computes is
//     real-US-growth minus nominal-India-growth, not a clean like-for-like
//     comparison — a further approximation on top of (1), most visible
//     when India CPI inflation diverges from US CPI inflation over the
//     trailing year. Recorded on the score cell and the trace, not just
//     here.
//
// Wired anyway on explicit instruction: this is still the best free
// history available (monthly back to 1871, same adapter/parser as
// sp500_trailing_pe — just a different multpl.com page), and the
// alternative was leaving the cell on a static manual baseline forever.
const MULTPL_EARNINGS_URL = "https://www.multpl.com/s-p-500-earnings/table/by-month";
export const SP500_TRAILING_EPS_REAL_SERIES_ID = "sp500_trailing_eps_real";

export const SP500_TRAILING_PE_SERIES_ID = "sp500_trailing_pe";

export class MultplFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultplFetchError";
  }
}

// "Sep 18, 2026" -> "2026-09-18". Returns null for anything that doesn't
// parse, so a header row or a footnote line is skipped rather than
// stored as a NaN-dated observation.
const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseMultplDate(text: string): string | null {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})$/.exec(decodeEntities(text).trim());
  if (!m) return null;
  const month = MONTHS[m[1]!];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2]!.padStart(2, "0")}`;
}

// Values carry a leading marker then the number: either "†" (estimate)
// or the RAW, UNDECODED entity "&#x2002;" (an em-space used as a
// no-marker placeholder).
//
// That undecoded entity is a live trap, and it bit: its literal text
// contains the digits "2002", so a naive "first number in the cell" match
// returns 2002 — a YEAR parsed as a P/E ratio. It looked plausible enough
// to store (confirmed 2026-09-20: 5 of the 120 rows in the 10-year window
// came back as 2002, which pushed the S&P percentile to 0.8 and pinned
// equity.intl::valuation at a clamped 100).
//
// So: decode the entities FIRST, then take the number. Decoding turns
// &#x2002; into whitespace, leaving the real value as the only digits in
// the cell.
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function parseMultplValue(text: string): number | null {
  const cleaned = decodeEntities(text).replace(/,/g, "");
  const m = /-?\d+(?:\.\d+)?/.exec(cleaned);
  if (!m) return null;
  const value = Number(m[0]);
  return Number.isFinite(value) ? value : null;
}

// Pure parse step, split from the network call so it's unit-testable
// against a fixture — the same split every other adapter here uses.
// Parameterized by seriesId so the P/E and EPS pages (identical table
// markup, confirmed live 2026-09-20) share one parser.
export function parseMultplTable(html: string, seriesId: string): Observation[] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  if (!rows || rows.length === 0) {
    throw new MultplFetchError("No table rows found — multpl.com's page structure likely changed.");
  }

  const out: Observation[] = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      c[1]!.replace(/<[^>]+>/g, "").trim()
    );
    if (cells.length !== 2) continue;
    const date = parseMultplDate(cells[0]!);
    if (date === null) continue; // header row ("Date","Value")
    const value = parseMultplValue(cells[1]!);
    if (value === null) continue; // §1 invariant 3: drop, never default
    out.push({ seriesId, date, value, raw: { row: cells } });
  }

  if (out.length === 0) {
    throw new MultplFetchError("Table found but no rows parsed — multpl.com's row format likely changed.");
  }
  return out;
}

async function fetchTable(url: string, seriesId: string): Promise<Observation[]> {
  const res = await request(url, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new MultplFetchError(`multpl.com returned ${res.statusCode}: ${body.slice(0, 300)}`);
  }
  return parseMultplTable(await res.body.text(), seriesId);
}

export function createMultplAdapter(): SourceAdapter {
  const pages: Array<{ url: string; seriesId: string }> = [
    { url: MULTPL_URL, seriesId: SP500_TRAILING_PE_SERIES_ID },
    { url: MULTPL_EARNINGS_URL, seriesId: SP500_TRAILING_EPS_REAL_SERIES_ID },
  ];

  return {
    id: "MULTPL",
    series: pages.map((p) => p.seriesId),

    // The page serves the WHOLE monthly history on every request, so
    // "latest" is just the most recent row of it. Returning only that row
    // keeps a daily refresh cheap to store; fetchHistory returns the rest.
    async fetchLatest(): Promise<Observation[]> {
      const out: Observation[] = [];
      for (const p of pages) {
        const all = await fetchTable(p.url, p.seriesId);
        out.push(all.reduce((a, b) => (a.date >= b.date ? a : b)));
      }
      return out;
    },

    // One request per page covers any range — each page is a single
    // static table back to 1871, so there is no pagination or per-period
    // fetch here (unlike niftyindices.ts's per-day CSV). Filtering
    // happens locally.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const fromIso = from.toISOString().slice(0, 10);
      const toIso = to.toISOString().slice(0, 10);
      const out: Observation[] = [];
      for (const p of pages) {
        const all = await fetchTable(p.url, p.seriesId);
        out.push(...all.filter((o) => o.date >= fromIso && o.date <= toIso));
      }
      return out;
    },

    async health(): Promise<HealthStatus> {
      try {
        const details: string[] = [];
        for (const p of pages) {
          const rows = await fetchTable(p.url, p.seriesId);
          const latest = rows.reduce((a, b) => (a.date >= b.date ? a : b));
          details.push(`${p.seriesId}: ${rows.length} monthly rows; latest ${latest.date} = ${latest.value}`);
        }
        return {
          source: "MULTPL",
          ok: true,
          lastChecked: new Date().toISOString(),
          detail: details.join(" | "),
        };
      } catch (err) {
        return {
          source: "MULTPL",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
