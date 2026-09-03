import { PDFParse } from "pdf-parse";
import { request } from "undici";
import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// §10.5 — AMFI. Confirmed via direct research + live verification
// 2026-09-03: every "free AMFI API" is a NAV API, not category flows.
// Two real report families exist:
//
//   1. The narrative "AMFI Monthly Note" (amfiindia.com/uploads/... with a
//      hashed filename per month — not predictable, requires a discovery
//      crawl) — rounded, multi-month-column figures, section titles that
//      drift between reports (confirmed: "Monthly flow of MFs" vs
//      "Monthly flow trend of mutual funds" 14 months apart).
//   2. AMFI's own official monthly scheme-category data report, at
//      portal.amfiindia.com/spages/am<mon><yyyy>repo.pdf — a STABLE,
//      CONSTRUCTIBLE url pattern, verified live back to at least 2016.
//      Exact (not rounded) per-category figures, one month per report
//      (no multi-column layout to parse), same table structure every
//      month since it's a fixed regulatory-style filing, not a
//      narrative document with copy changes.
//
// This adapter uses (2) — strictly better on every axis that matters here
// (URL predictability, backfill depth, figure precision, layout
// stability) — chosen after verifying (1)'s working parser against real
// PDFs, then finding (2) during that same verification pass.
const AMFI_REPORT_BASE_URL = "https://portal.amfiindia.com/spages";

export class AmfiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmfiParseError";
  }
}

// Row label -> internal series ID, for the two figures each row carries
// (net inflow/outflow -> flow_*, net AUM -> aum_*). Labels are matched
// case-insensitively against the report's "Scheme Name" column, verified
// against the live March 2026 report.
const ROW_SERIES_MAP: Record<string, { flow?: string; aum?: string }> = {
  "large cap fund": { flow: "flow_largecap", aum: "aum_largecap" },
  "mid cap fund": { flow: "flow_midcap", aum: "aum_midcap" },
  "small cap fund": { flow: "flow_smallcap", aum: "aum_smallcap" },
  "sectoral/thematic funds": { flow: "flow_sectoral", aum: "aum_sectoral" },
  "gold etf": { flow: "flow_goldetf", aum: "aum_goldetf" },
};

// Sub-totals ("Sub Total - I ...", "Sub Total - II ...") give the
// top-line Debt / Equity figures the engine's §7 tables reference as
// flow_duration_3m / aum_duration and (equity) flow_equity_3m / aum_equity.
// These are matched by the roman-numeral group heading that precedes them
// ("I Income/Debt Oriented Schemes", "II Growth/Equity Oriented Schemes"),
// not by row text alone, since "Sub Total" repeats for every group.
const SUBTOTAL_GROUP_MAP: Record<string, { flow: string; aum: string }> = {
  "income/debt oriented schemes": { flow: "flow_duration_3m", aum: "aum_duration" },
  "growth/equity oriented schemes": { flow: "flow_equity_3m", aum: "aum_equity" },
};

const MONTH_NAME_TO_NUM: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function reportUrlFor(year: number, monthIndex0: number): string {
  const monthName = Object.keys(MONTH_NAME_TO_NUM)[monthIndex0]!;
  return `${AMFI_REPORT_BASE_URL}/am${monthName}${year}repo.pdf`;
}

// Parses an Indian-grouped number ("-2,94,987.18" or "1,23,97,731") into a
// JS number. AMFI uses "-" alone for a genuine zero/not-applicable cell.
function parseAmfiNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "-" || cleaned === "" || cleaned === "##") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface ParsedRow {
  label: string;
  netFlow: number | null;
  netAum: number | null;
}

// The report has no delimiters beyond whitespace; a data row is
// "<roman-or-index> <Scheme Name...> <9 numeric-or-dash columns>". Since
// scheme names are free text, the row is parsed from the right: take the
// last 9 whitespace-separated tokens as the numeric columns, everything
// before that (after stripping the leading index token) is the label.
// Verified against the real March 2026 report's exact column count (9,
// including the two segregated-portfolio columns which are usually "-").
const NUMERIC_COLUMN_COUNT = 9;
const NET_FLOW_COLUMN_INDEX = 4; // 0-based within the 9 trailing columns
const NET_AUM_COLUMN_INDEX = 5;

function parseDataRow(line: string): ParsedRow | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < NUMERIC_COLUMN_COUNT + 2) return null; // needs at least index + 1 label word + 9 numbers

  const numericTokens = tokens.slice(-NUMERIC_COLUMN_COUNT);
  // Every trailing token must look numeric-or-dash for this to be a data row.
  if (!numericTokens.every((t) => /^-?[\d,.]+$/.test(t) || t === "-" || t === "##")) return null;

  const labelTokens = tokens.slice(1, tokens.length - NUMERIC_COLUMN_COUNT); // drop the leading Sr/roman index
  const label = labelTokens.join(" ").trim();
  if (!label) return null;

  return {
    label,
    netFlow: parseAmfiNumber(numericTokens[NET_FLOW_COLUMN_INDEX]!),
    netAum: parseAmfiNumber(numericTokens[NET_AUM_COLUMN_INDEX]!),
  };
}

// Same numeric-column extraction as parseDataRow, but without requiring a
// real label — used only for "Sub Total" continuation lines where the
// PDF's wrapping has consumed the label across prior lines, sometimes
// leaving one trailing non-numeric remnant token on this line too (e.g.
// "(i+ii+...+xvi) 318 68,49,320 ..." — the "(i+ii+...)" formula string is
// one token, not a real label). Accepts the last N tokens as the numeric
// columns regardless of what (if anything) precedes them, so long as
// there ARE exactly NUMERIC_COLUMN_COUNT trailing numeric tokens.
function parseNumericOnlyRow(line: string): { netFlow: number | null; netAum: number | null } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < NUMERIC_COLUMN_COUNT) return null;
  const numericTokens = tokens.slice(-NUMERIC_COLUMN_COUNT);
  if (!numericTokens.every((t) => /^-?[\d,.]+$/.test(t) || t === "-" || t === "##")) return null;
  return {
    netFlow: parseAmfiNumber(numericTokens[NET_FLOW_COLUMN_INDEX]!),
    netAum: parseAmfiNumber(numericTokens[NET_AUM_COLUMN_INDEX]!),
  };
}

export function parseAmfiCategoryReport(pdfText: string, reportDate: string): Observation[] {
  const lines = pdfText.split("\n").map((l) => l.trim()).filter(Boolean);
  const observations: Observation[] = [];

  let currentGroup: string | null = null;
  // "I Income/Debt Oriented Schemes" / "II Growth/Equity Oriented Schemes"
  // headings — and their "Sub Total" rows — repeat for Open-ended,
  // Close-ended, and Interval scheme sections (verified live: the same
  // heading text appears 3 times in one report). Only the FIRST match per
  // group (the "A Open ended Schemes" section, which the report lists
  // first and which dominates AUM/flows) is captured; later repeats are
  // ignored rather than silently overwriting the top-line figure with a
  // much smaller close-ended/interval subtotal.
  const capturedGroups = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();

    // Group heading lines look like "I Income/Debt Oriented Schemes" or
    // "II Growth/Equity Oriented Schemes" — track which group we're in so
    // the next "Sub Total" row maps to the right series.
    for (const groupKey of Object.keys(SUBTOTAL_GROUP_MAP)) {
      if (lower.includes(groupKey)) {
        currentGroup = groupKey;
        break;
      }
    }

    if (lower.startsWith("sub total") && currentGroup && !capturedGroups.has(currentGroup)) {
      // The PDF's text extraction wraps "Sub Total - I (i+ii+...)" across
      // a VARIABLE number of lines depending on how many roman numerals
      // the formula string lists (verified live: Group I's 16-term
      // formula wraps across 3 lines before the numbers appear; other
      // groups with shorter formulas wrap less or not at all). Scan
      // forward for the first line that actually parses as a numeric
      // data row, capped at a few lines so an unrelated later row can't
      // be mistaken for this subtotal if the format changes again.
      let row: { netFlow: number | null; netAum: number | null } | null = null;
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        row = parseDataRow(lines[j]!) ?? parseNumericOnlyRow(lines[j]!);
        if (row) break;
      }
      if (row) {
        const mapping = SUBTOTAL_GROUP_MAP[currentGroup]!;
        if (row.netFlow !== null) observations.push({ seriesId: mapping.flow, date: reportDate, value: row.netFlow, raw: { line, group: currentGroup } });
        if (row.netAum !== null) observations.push({ seriesId: mapping.aum, date: reportDate, value: row.netAum, raw: { line, group: currentGroup } });
        capturedGroups.add(currentGroup);
      }
      continue;
    }

    const row = parseDataRow(line);
    if (!row) continue;

    const mapping = ROW_SERIES_MAP[row.label.toLowerCase()];
    if (!mapping) continue; // unmapped category: dropped, not guessed

    if (mapping.flow && row.netFlow !== null) {
      observations.push({ seriesId: mapping.flow, date: reportDate, value: row.netFlow, raw: { line } });
    }
    if (mapping.aum && row.netAum !== null) {
      observations.push({ seriesId: mapping.aum, date: reportDate, value: row.netAum, raw: { line } });
    }
  }

  if (observations.length === 0) {
    throw new AmfiParseError("Parsed zero observations from the category report — its layout may have changed.");
  }

  return observations;
}

export async function parseAmfiCategoryReportPdf(pdfBuffer: Buffer, reportDate: string): Promise<Observation[]> {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  return parseAmfiCategoryReport(result.text, reportDate);
}

export interface AmfiFetchResult {
  observations: Observation[];
  reportDate: string;
  url: string;
}

async function fetchReportFor(year: number, monthIndex0: number): Promise<AmfiFetchResult> {
  const url = reportUrlFor(year, monthIndex0);
  const res = await request(url, { method: "GET" });
  if (res.statusCode !== 200) {
    throw new AmfiParseError(`Failed to download AMFI category report from ${url} (${res.statusCode})`);
  }
  const buffer = Buffer.from(await res.body.arrayBuffer());
  const reportDate = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-01`;
  const observations = await parseAmfiCategoryReportPdf(buffer, reportDate);
  return { observations, reportDate, url };
}

export function createAmfiAdapter(): SourceAdapter {
  async function fetchLatestReport(): Promise<AmfiFetchResult> {
    const now = new Date();
    // AMFI publishes ~10th of the month for the prior month; if we're
    // before the 10th, the latest available report is for two months ago.
    let year = now.getFullYear();
    let monthIndex0 = now.getMonth() - (now.getDate() < 10 ? 2 : 1);
    if (monthIndex0 < 0) {
      monthIndex0 += 12;
      year -= 1;
    }
    return fetchReportFor(year, monthIndex0);
  }

  return {
    id: "AMFI",
    series: [
      ...new Set(
        [...Object.values(ROW_SERIES_MAP), ...Object.values(SUBTOTAL_GROUP_MAP)].flatMap((m) => [m.flow, m.aum].filter(Boolean) as string[])
      ),
    ],

    async fetchLatest(): Promise<Observation[]> {
      const result = await fetchLatestReport();
      return result.observations;
    },

    // Each report covers exactly one month; the predictable URL pattern
    // (verified live back to 2016) means a true historical range can be
    // fetched by requesting every month in range directly, unlike the
    // narrative-PDF approach which only ever exposed a trailing window.
    async fetchHistory(from: Date, to: Date): Promise<Observation[]> {
      const out: Observation[] = [];
      const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      const end = new Date(to.getFullYear(), to.getMonth(), 1);
      while (cursor <= end) {
        try {
          const result = await fetchReportFor(cursor.getFullYear(), cursor.getMonth());
          out.push(...result.observations);
        } catch {
          // A single missing/unreachable month is a gap in the backfill,
          // not a reason to abort the whole range (§9 — a failed fetch is
          // a warning, never an exception, applied here at the per-month
          // granularity a backfill actually operates at).
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return out;
    },

    async health(): Promise<HealthStatus> {
      try {
        const result = await fetchLatestReport();
        return {
          source: "AMFI",
          ok: result.observations.length > 0,
          lastChecked: new Date().toISOString(),
          detail: result.observations.length > 0 ? null : `report downloaded (${result.url}) but zero observations parsed`,
        };
      } catch (err) {
        return {
          source: "AMFI",
          ok: false,
          lastChecked: new Date().toISOString(),
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
