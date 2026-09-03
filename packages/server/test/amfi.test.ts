import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { parseAmfiCategoryReport, AmfiParseError } from "../src/adapters/amfi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

async function extractText(filename: string): Promise<string> {
  const buffer = readFileSync(join(fixturesDir, filename));
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

// Parses two REAL AMFI category-wise monthly reports (downloaded live
// 2026-09-03 from the predictable portal.amfiindia.com URL, 14 months
// apart) — the risk in this adapter is entirely "does the row parser
// survive AMFI's actual report layout," which only real PDFs can test.
describe("AMFI adapter — parses real category-wise monthly reports", () => {
  it("parses March 2026 report: top-line equity/debt flow and AUM subtotals", async () => {
    const text = await extractText("amfi_category_mar2026.pdf");
    const observations = parseAmfiCategoryReport(text, "2026-03-01");

    const equityFlow = observations.find((o) => o.seriesId === "flow_equity_3m");
    expect(equityFlow?.value).toBe(40450.26); // "Sub Total - II ... 40,450.26 31,97,698.15 ..."

    const equityAum = observations.find((o) => o.seriesId === "aum_equity");
    expect(equityAum?.value).toBe(3197698.15);

    const debtFlow = observations.find((o) => o.seriesId === "flow_duration_3m");
    expect(debtFlow?.value).toBe(-294987.18); // "Sub Total - I ... -2,94,987.18 16,51,502.37 ..."

    const debtAum = observations.find((o) => o.seriesId === "aum_duration");
    expect(debtAum?.value).toBe(1651502.37);
  });

  it("parses individual category rows (large/mid/small-cap, sectoral, gold ETF)", async () => {
    const text = await extractText("amfi_category_mar2026.pdf");
    const observations = parseAmfiCategoryReport(text, "2026-03-01");

    const largeCapFlow = observations.find((o) => o.seriesId === "flow_largecap");
    expect(largeCapFlow?.value).toBe(2997.84); // "Large Cap Fund ... 2,997.84 3,66,045.49 ..."

    const smallCapFlow = observations.find((o) => o.seriesId === "flow_smallcap");
    expect(smallCapFlow?.value).toBe(6263.56);

    const sectoralFlow = observations.find((o) => o.seriesId === "flow_sectoral");
    expect(sectoralFlow?.value).toBe(2698.82);

    const goldFlow = observations.find((o) => o.seriesId === "flow_goldetf");
    expect(goldFlow?.value).toBe(2265.68);
    const goldAum = observations.find((o) => o.seriesId === "aum_goldetf");
    expect(goldAum?.value).toBe(171468.35);
  });

  it("parses January 2025 report (14 months earlier — layout stability + 'Sub Total' line-wrap check)", async () => {
    const text = await extractText("amfi_category_jan2025.pdf");
    const observations = parseAmfiCategoryReport(text, "2025-01-01");

    // Jan-2025's "Sub Total - I" wraps onto a second line in the raw PDF
    // text extraction ("Sub Total - I" / "(i+ii+...) 318 68,49,320 ...")
    // — this specifically exercises that continuation-line handling.
    const debtFlow = observations.find((o) => o.seriesId === "flow_duration_3m");
    expect(debtFlow?.value).toBe(128652.58);
    const debtAum = observations.find((o) => o.seriesId === "aum_duration");
    expect(debtAum?.value).toBe(1706315.14);

    const goldFlow = observations.find((o) => o.seriesId === "flow_goldetf");
    expect(goldFlow?.value).toBe(3751.42); // "GOLD ETF ... 3,751.42 51,839.39 ..."
  });

  it("throws AmfiParseError (not a silent empty result) on unparseable input", () => {
    expect(() => parseAmfiCategoryReport("not a real report", "2026-01-01")).toThrow(AmfiParseError);
  });
});
