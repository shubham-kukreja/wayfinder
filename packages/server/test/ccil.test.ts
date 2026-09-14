import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { CcilScrapeError, createCcilAdapter, findTbill1yRow, parseTbill1yFromRows, TBILL_1Y_SERIES_ID } from "../src/adapters/ccil.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

// The adapter's live scraper extracts rows straight from the DOM via
// page.evaluate() (Playwright, not available here) — this helper
// reproduces the same tbody-tr/td -> string[][] extraction with cheerio
// so the pure parse function can be tested against a real captured
// fixture, same shape the live path feeds it.
function rowsFromFixtureHtml(html: string): string[][] {
  const $ = load(html);
  const rows: string[][] = [];
  $("table").first().find("tbody tr").each((_, tr) => {
    const cells: string[] = [];
    $(tr)
      .find("td")
      .each((_i, td) => {
        cells.push($(td).text().trim());
      });
    rows.push(cells);
  });
  return rows;
}

function loadFixtureRows() {
  return rowsFromFixtureHtml(readFileSync(join(fixturesDir, "ccil_zcyc_sample.html"), "utf-8"));
}

// §10.12 — CCIL ZCYC adapter. Fixture captured live 2026-09-15 from
// https://www.ccilindia.com/tenorwise-indicative-yields — confirmed a
// single plain HTML <table id="dtTable"> with columns Date | Tenor
// Bucket | Security | YTM (%), the "364D" row unambiguous (exactly one
// match) among 91D/182D/364D T-bill buckets, five G-Sec tenor buckets,
// and two SDL rows.
describe("CCIL ZCYC adapter — parses the tenorwise-indicative-yields table", () => {
  it("parses all rows from the real fixture into structured yield rows", () => {
    const rows = parseTbill1yFromRows(loadFixtureRows());
    expect(rows.length).toBe(10);
    expect(rows[0]).toEqual({
      date: "11-09-2026",
      tenorBucket: "91D",
      security: "91 DTB (10/12/2026)",
      ytmPercent: 5.2089,
    });
  });

  it("finds the unambiguous 364D row and its real security/yield", () => {
    const rows = parseTbill1yFromRows(loadFixtureRows());
    const row = findTbill1yRow(rows);
    expect(row.tenorBucket).toBe("364D");
    expect(row.security).toBe("364 DTB (09/09/2027)");
    expect(row.ytmPercent).toBe(5.9148);
  });

  it("does not accidentally match the 1Y-2Y G-Sec bucket or other tenors", () => {
    const rows = parseTbill1yFromRows(loadFixtureRows());
    const row = findTbill1yRow(rows);
    expect(row.ytmPercent).not.toBe(6.3309); // 1Y-2Y GS 2029
    expect(row.ytmPercent).not.toBe(5.6174); // 182D
  });

  it("throws honestly when there are no data rows (layout changed)", () => {
    expect(() => parseTbill1yFromRows([])).toThrow(CcilScrapeError);
  });

  it("throws honestly when no row matches the 364D tenor bucket", () => {
    const rows = parseTbill1yFromRows([["11-09-2026", "91D", "91 DTB (10/12/2026)", "5.2089"]]);
    expect(() => findTbill1yRow(rows)).toThrow(/No row with Tenor Bucket "364D"/);
  });

  it("throws honestly on an ambiguous duplicate 364D row", () => {
    const dupRows = [
      ["11-09-2026", "364D", "364 DTB (09/09/2027)", "5.9148"],
      ["11-09-2026", "364D", "364 DTB (some-other-date)", "5.90"],
    ];
    const rows = parseTbill1yFromRows(dupRows);
    expect(() => findTbill1yRow(rows)).toThrow(/Found 2 rows/);
  });

  it("declares its one series (tbill_1y — same series as adapters/rbi.ts, a better source for it)", () => {
    const adapter = createCcilAdapter();
    expect(adapter.series).toEqual([TBILL_1Y_SERIES_ID]);
  });

  it("fetchHistory() throws honestly — no historical range on this page", async () => {
    const adapter = createCcilAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical range/i);
  });
});
