import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.11 — RBI Repo Rate. Confirmed live 2026-09-15: rbi.org.in's own
// homepage has a plain, server-rendered "Policy Rates" accordion table —
// no JS, no auth, no Cloudflare. This is a DIFFERENT source than
// adapters/rbi.ts, which scrapes the dbie.rbihub.in mirror via a headless
// browser (AG Grid) — that mirror's own ~350-page catalog was confirmed
// (2026-09-03) to have NO repo_rate series at all. The repo rate simply
// isn't in DBIE's tabular data catalog; it's a live policy-stance figure
// RBI publishes as a homepage widget instead.
//
// This is a CURRENT VALUE, not a dated historical snapshot — the table
// has no "as of" date next to it (unlike the Exchange Rates widget on
// the same page, which does), so the observation is stamped with
// today's fetch date. No historical range exists on this page — repo
// rate history would need RBI's monetary-policy-statement archive
// (individual press releases per rate change), a different and much
// higher-effort source; fetchHistory() is a deliberate no-op here, same
// honest pattern as bullion.ts/nse.ts.
const RBI_HOMEPAGE_URL = "https://www.rbi.org.in";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const REPO_RATE_SERIES_ID = "repo_rate";

export class RbiRepoRateFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RbiRepoRateFetchError";
  }
}

// Pure parse step, split from the network call — same pattern as every
// other adapter in this project. Matches "Policy Repo Rate" as a <th>,
// then the percentage in the following <td> (format confirmed live:
// "Policy Repo Rate</th><td>:\n  5.25%</td>", with a leading colon and
// whitespace/newlines before the number).
export function parseRepoRateFromHomepage(html: string): number {
  const match = html.match(/Policy Repo Rate\s*<\/th>\s*<td>\s*:\s*([\d.]+)%/);
  if (!match) {
    throw new RbiRepoRateFetchError('Could not find a "Policy Repo Rate" entry in the RBI homepage HTML — its layout may have changed.');
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new RbiRepoRateFetchError(`Matched a repo rate label but the value "${match[1]}" isn't numeric.`);
  }
  return value;
}

async function fetchRepoRate(): Promise<number> {
  const res = await request(RBI_HOMEPAGE_URL, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new RbiRepoRateFetchError(`RBI homepage fetch failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  const html = await res.body.text();
  return parseRepoRateFromHomepage(html);
}

export function createRbiRepoRateAdapter(): SourceAdapter {
  return {
    id: "RBI",
    series: [REPO_RATE_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      const value = await fetchRepoRate();
      const asOfDate = new Date().toISOString().slice(0, 10);
      return [{ seriesId: REPO_RATE_SERIES_ID, date: asOfDate, value, raw: { source: "rbi.org.in homepage" } }];
    },

    // No historical archive on this page — see file-level comment.
    async fetchHistory(): Promise<Observation[]> {
      throw new RbiRepoRateFetchError(
        "rbi.org.in's homepage shows only the CURRENT repo rate, no historical range. " +
          "History must accumulate via repeated fetchLatest() calls (a rate that changes infrequently), not backfill."
      );
    },

    async health(): Promise<HealthStatus> {
      try {
        const value = await fetchRepoRate();
        return {
          source: "RBI",
          ok: Number.isFinite(value) && value > 0,
          lastChecked: new Date().toISOString(),
          detail: null,
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
