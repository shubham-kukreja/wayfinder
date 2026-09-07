import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.4 — NSE / niftyindices.com. NOT YET IMPLEMENTED. Live-investigated
// 2026-09-03; findings kept here so a future attempt doesn't restart from
// zero.
//
// Status: no official API (confirmed, matches §10.4). The undocumented
// endpoint historically referenced by third-party scrapers
// (Backpage.aspx/getpepbHistoricaldataDBtoString) no longer exists — it
// now redirects to a Sitefinity login page and drops the POST body,
// producing a 411 from plain HTTP clients. The site is NOT IP-banned:
// a real headless-browser session reaches https://www.niftyindices.com
// /reports/historical-data fine (200 OK).
//
// The REAL current data flow (found via live network-request sniffing,
// not documentation) is a two-step cascade on that page:
//   1. User selects an index type in <select id="ddlHistoricaltypee">
//      (Equity / Fixed Income / Multi Asset). This fires a POST to
//      /BackPage/gethistoricaltypeSubindexdata with body
//      {"cinfo":{"indextype":"Equity","indexgroup":"Historical Index Data"}}
//      which is meant to populate <select id="ddlHistoricaltypeeindex">
//      with the actual list of indices (NIFTY 50, NIFTY BANK, etc.).
//   2. Presumably a further selection + the "Submit" button
//      (#btndailyreport) triggers the actual P/E/P/B/TRI data fetch —
//      NOT YET REACHED, see below.
//
// BLOCKER (session 1, 2026-09-03): step 1's change handler is bound via
// jQuery (`events: ["change"]` confirmed via jQuery._data() on the live
// page) but firing it programmatically (Playwright's selectOption(),
// native dispatchEvent, and an explicit jQuery .trigger("change") —
// including all three at once) was UNRELIABLE: it fired the real request
// in roughly 1 of 8 attempts with no code difference between attempts.
//
// SESSION 2 (2026-09-08) FINDINGS — real progress, still not cracked:
//
//   1. COOKIE TRANSPLANT WORKS. Navigate once with a real (headless)
//      browser to https://www.niftyindices.com/reports/historical-data,
//      extract context.cookies() (the load-bearing ones are Akamai's
//      bot-manager tokens: bm_sv, ak_bmsc, plus ASP.NET_SessionId), then
//      make ALL subsequent requests with a plain HTTP client (undici) —
//      NOT another browser page. Verified live: this got a real 200
//      with real JSON from /BackPage/gethistoricaltypeSubindexdata.
//      This fully sidesteps the flaky jQuery-trigger problem from
//      session 1 — you never need to fire that event again once you
//      have the cookies, only replicate the request shape.
//
//   2. Calling fetch() FROM INSIDE THE PAGE'S OWN JS CONTEXT (via
//      page.evaluate) does NOT work reliably — confirmed live that the
//      request is sent (observed via the `request` event) but the page
//      silently closes before any response/requestfinished event fires,
//      with no crash event, no dialog, no console error, no navigation
//      logged. This looks like active anti-automation reacting to a
//      script-initiated fetch to that specific endpoint (as opposed to
//      one fired by a real DOM event), not a timing race. Don't pursue
//      this path further — use the cookie-transplant approach (finding
//      1) instead, which avoids page.evaluate entirely after the
//      initial cookie-harvesting navigation.
//
//   3. THE EXACT cinfo PAYLOAD FOR THE INDEX-LIST STEP IS STILL UNKNOWN.
//      {"cinfo":{"indextype":"Equity","indexgroup":"Broad Market Indices"}}
//      (a guess based on the visible category names: "Broad Market
//      Indices", "Sectoral Indices", "Strategy Indices", "Thematic
//      Indices" — captured live from the actual first-level response)
//      returned the SAME category list back, not an index list — so
//      "indexgroup" alone isn't the right key/value to drill down with.
//      The correct 2nd request's payload was never captured because the
//      flaky change-trigger (finding as of session 1) didn't fire during
//      the session-2 attempts to watch it happen. NEXT STEP: retry
//      watching the real UI click-through (patiently, possibly many
//      attempts) SPECIFICALLY to capture the exact request body for
//      when ddlHistoricaltypeeSubindex successfully populates — once
//      that shape is known, the whole remaining chain can likely be
//      replicated via cookie-transplant + undici with no further browser
//      interaction needed.
//
//   4. RATE LIMITING IS REAL AND RECURRING. Both sessions independently
//      hit a point where the site became unreachable (curl timeout /
//      ERR_ABORTED / connection refused) after a burst of ~10-15
//      requests within a few minutes, recovering only after a pause.
//      Any future attempt should space out requests deliberately (a few
//      seconds minimum between calls) rather than iterating quickly.
//
// Until the index-list payload is cracked, all ~19 NSE-dependent score
// cells (§7.2 equity segment valuation/relvalue, §7.5 sector valuation/
// rel_momentum) are MANUAL — same provenance as PMI (§10.6). Do not
// build a partial/silent adapter around this; an adapter that throws
// honestly is better than one that returns stale or wrong data.

export class NseNotImplementedError extends Error {
  constructor() {
    super(
      "NSE adapter is not implemented — see src/adapters/nse.ts for the investigation notes. " +
        "All NSE-dependent scores are manual for now."
    );
    this.name = "NseNotImplementedError";
  }
}

// Series this adapter WOULD cover once built, so the score pipeline and
// UI can already reference these IDs as "known but currently manual"
// rather than as an unknown string.
export const NSE_SERIES_IDS = [
  "nifty50_pe",
  "nifty100_pe",
  "midcap150_pe",
  "smallcap250_pe",
  "nifty50_tr",
  "sector_pe_banking",
  "sector_pe_it",
  "sector_pe_pharma",
  "sector_pe_auto",
  "sector_pe_capgoods",
  "sector_pe_fmcg",
  "sector_pe_energy",
  "sector_pe_metals",
  "sector_tr_banking",
  "sector_tr_it",
  "sector_tr_pharma",
  "sector_tr_auto",
  "sector_tr_capgoods",
  "sector_tr_fmcg",
  "sector_tr_energy",
  "sector_tr_metals",
] as const;

export function createNseAdapter(): SourceAdapter {
  return {
    id: "NSE",
    series: [...NSE_SERIES_IDS],

    async fetchLatest(): Promise<Observation[]> {
      throw new NseNotImplementedError();
    },

    async fetchHistory(): Promise<Observation[]> {
      throw new NseNotImplementedError();
    },

    async health(): Promise<HealthStatus> {
      return {
        source: "NSE",
        ok: false,
        lastChecked: new Date().toISOString(),
        detail: "Adapter not implemented. See src/adapters/nse.ts investigation notes.",
      };
    },
  };
}
