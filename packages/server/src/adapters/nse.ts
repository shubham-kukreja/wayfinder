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
// BLOCKER: step 1's change handler is bound via jQuery (`events: ["change"]`
// confirmed via jQuery._data() on the live page) but firing it
// programmatically (Playwright's selectOption(), native dispatchEvent,
// and an explicit jQuery .trigger("change") — including all three at
// once) was UNRELIABLE: it fired the real request in roughly 1 of 8
// attempts with no code difference between attempts, strongly suggesting
// a client-side timing race in the page's own JS initialisation (a
// handler bound asynchronously after some other init step completes)
// rather than a deliberate anti-automation measure. Likely fixable with
// either (a) polling for a readiness signal before dispatching the event
// (unidentified what that signal is), or (b) a retry loop that dispatches
// the trigger repeatedly until the network response is observed. Neither
// was implemented — this needs a fresh, unhurried debugging pass.
//
// Until this is solved, all ~19 NSE-dependent score cells (§7.2 equity
// segment valuation/relvalue, §7.5 sector valuation/rel_momentum) are
// MANUAL — same provenance as PMI (§10.6). Do not build a partial/silent
// adapter around this; an adapter that throws honestly is better than
// one that returns stale or wrong data.

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
