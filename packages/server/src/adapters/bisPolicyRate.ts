import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §8.1 — RBI policy repo rate HISTORY, the missing half of the
// equityMacroScore rubric's rbiStance input.
//
// Three sources touch repo_rate, and the split is deliberate:
//   - adapters/rbiRepoRate.ts scrapes rbi.org.in's homepage widget. That
//     is the LIVE CURRENT rate and nothing else — its fetchHistory()
//     throws by design — so "is the RBI cutting?", a comparison against
//     ~6 months ago, has nothing to compare against on its own.
//   - adapters/dbnomics.ts mirrors this same BIS dataset. It was wired
//     first, and its history is real, but the MIRROR IS STALE:
//     confirmed live 2026-09-19, DBnomics' copy ends 2025-06 while BIS
//     itself publishes through 2026-06. That 12-month mirror lag left a
//     hole wide enough that rbiStanceFromRepoRate() refused to measure
//     across it (12-month staleness bound) and l1.equity::macro abstained.
//   - THIS adapter goes to BIS directly and closes that hole.
//
// BIS's SDMX REST API is plain, unauthenticated CSV — no key, no
// Cloudflare, no JS. Confirmed live 2026-09-19: 966 monthly observations
// 1946-01 through 2026-06, whose recent tail carries the real RBI path
// the mirror was missing entirely (5.5 held through 2025-11, cut to 5.25
// in 2025-12, held every month since — which is exactly the "four
// consecutive holds" the RBI's own August statement describes).
//
// MONTHLY (M.IN), not the daily D.IN series: the daily series is riddled
// with "NA" non-business-day gaps, and end-of-month is the right
// granularity for a 6-month stance comparison anyway — the rubric asks
// which direction policy has moved, not on which day.
//
// This does NOT replace rbiRepoRate.ts. BIS still trails the live widget
// by a couple of months (a normal statistical-publication lag, not a
// mirror failure), so the two compose: BIS supplies the history, the
// homepage supplies today. Both write the same repo_rate series and the
// store's "latest fetched_at wins" rule resolves any shared date, the
// same additive pattern as the ccil/rbi tbill_1y overlap.
const BIS_CBPOL_URL = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/M.IN?format=csv";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const REPO_RATE_SERIES_ID = "repo_rate";

export class BisPolicyRateFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BisPolicyRateFetchError";
  }
}

// BIS's CSV carries free-text metadata columns (COMPILATION,
// SUPP_INFO_BREAKS) whose values contain commas AND are double-quoted,
// so a plain split(",") mis-aligns every column after them. This is a
// minimal RFC4180 field splitter: quoted fields may contain commas, and
// "" inside a quoted field is a literal quote.
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

// Pure parse step, split from the network call — same pattern as every
// other adapter in this project.
//
// Columns are resolved BY HEADER NAME rather than by fixed index: this is
// an SDMX response whose dimension columns can legitimately shift, and a
// hardcoded index would silently read the wrong field rather than fail.
//
// No unit conversion — BIS publishes the policy rate in percent, exactly
// the unit rbiRepoRate.ts already writes and the stance comparison wants.
//
// Rows with an empty OBS_VALUE are dropped rather than carried forward: a
// repo rate is a step function of discrete MPC decisions, so interpolating
// a gap would invent a rate the central bank never set (§1 invariant 4).
export function parseBisPolicyRateCsv(csvText: string): Observation[] {
  const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new BisPolicyRateFetchError("BIS returned an empty response body.");
  }

  const header = splitCsvLine(lines[0]!);
  const periodIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (periodIdx === -1 || valueIdx === -1) {
    throw new BisPolicyRateFetchError(
      `BIS CSV is missing TIME_PERIOD/OBS_VALUE columns — the API's response shape may have changed. Header: ${lines[0]!.slice(0, 200)}`
    );
  }

  const out: Observation[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const period = cols[periodIdx]?.trim();
    const rawValue = cols[valueIdx]?.trim();
    if (!period || !rawValue) continue;
    // Guard the monthly "YYYY-MM" shape explicitly: if BIS ever served a
    // different frequency at this URL, silently date-stamping it would
    // corrupt the series rather than fail loudly.
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    // "YYYY-MM" -> "YYYY-MM-01", this project's monthly-series convention.
    out.push({ seriesId: REPO_RATE_SERIES_ID, date: `${period}-01`, value, raw: { period, source: "BIS/WS_CBPOL/M.IN" } });
  }

  if (out.length === 0) {
    throw new BisPolicyRateFetchError("BIS CSV parsed but contained no usable observations.");
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchPolicyRateSeries(): Promise<Observation[]> {
  const res = await request(BIS_CBPOL_URL, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "text/csv, */*" },
  });
  if (res.statusCode !== 200) {
    const body = await res.body.text();
    throw new BisPolicyRateFetchError(`BIS request failed (${res.statusCode}): ${body.slice(0, 300)}`);
  }
  return parseBisPolicyRateCsv(await res.body.text());
}

export function createBisPolicyRateAdapter(): SourceAdapter {
  return {
    id: "BIS",
    series: [REPO_RATE_SERIES_ID],

    // Real history in one request — no pagination needed, so fetchLatest()
    // and fetchHistory() share the same fetch; the store handles
    // upsert-by-date like any other bulk fetch.
    //
    // fetchLatest returns BIS's newest published month, which trails
    // rbi.org.in's live widget by a normal publication lag. Deliberately
    // not suppressed: a BIS row for an older month is real history, not a
    // competing answer for today.
    async fetchLatest(): Promise<Observation[]> {
      const all = await fetchPolicyRateSeries();
      return all.length > 0 ? [all[all.length - 1]!] : [];
    },

    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const all = await fetchPolicyRateSeries();
      return all.filter((o) => {
        const d = new Date(o.date);
        return d >= from && d <= to;
      });
    },

    async health(): Promise<HealthStatus> {
      try {
        const all = await fetchPolicyRateSeries();
        return {
          source: "BIS",
          ok: all.length > 0,
          lastChecked: new Date().toISOString(),
          detail: all.length > 0 ? null : "BIS returned zero observations",
        };
      } catch (err) {
        return {
          source: "BIS",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
