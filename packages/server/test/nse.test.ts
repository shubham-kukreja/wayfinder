import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNseAdapter, mapIndexRowsToObservations } from "../src/adapters/nse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixtureRows() {
  const raw = readFileSync(join(fixturesDir, "nse_allIndices_sample.json"), "utf-8");
  return JSON.parse(raw).data;
}

// §10.4 — NSE adapter, built against nseindia.com's /api/allIndices
// (a different, less-protected domain than niftyindices.com, which
// remains unreachable — see the file-level comment in adapters/nse.ts).
// This fixture is a trimmed real response captured live 2026-09-08.
describe("NSE adapter — maps nseindia.com/api/allIndices rows to observations", () => {
  it("maps confirmed broad + sector indices to their internal series IDs", () => {
    const observations = mapIndexRowsToObservations(loadFixtureRows(), "2026-09-08");

    const nifty50 = observations.find((o) => o.seriesId === "nifty50_pe");
    expect(nifty50?.value).toBe(20.1);

    const nifty100 = observations.find((o) => o.seriesId === "nifty100_pe");
    expect(nifty100?.value).toBe(19.92);

    const midcap150 = observations.find((o) => o.seriesId === "midcap150_pe");
    expect(midcap150?.value).toBe(28.84);

    const smallcap250 = observations.find((o) => o.seriesId === "smallcap250_pe");
    expect(smallcap250?.value).toBe(34.11);

    const bankPe = observations.find((o) => o.seriesId === "sector_pe_banking");
    expect(bankPe?.value).toBe(13.51);

    expect(observations.find((o) => o.seriesId === "sector_pe_it")?.value).toBe(19.14);
    expect(observations.find((o) => o.seriesId === "sector_pe_pharma")?.value).toBe(41.3);
    expect(observations.find((o) => o.seriesId === "sector_pe_auto")?.value).toBe(32.18);
    expect(observations.find((o) => o.seriesId === "sector_pe_fmcg")?.value).toBe(31.63);
    expect(observations.find((o) => o.seriesId === "sector_pe_energy")?.value).toBe(14.73);
    expect(observations.find((o) => o.seriesId === "sector_pe_metals")?.value).toBe(16.01);
  });

  it("drops unmapped indices (e.g. NIFTY NEXT 50 — not in this project's 85-cell schema) rather than guessing a series ID", () => {
    const observations = mapIndexRowsToObservations(loadFixtureRows(), "2026-09-08");
    expect(observations.some((o) => (o.raw as { index?: string })?.index === "NIFTY NEXT 50")).toBe(false);
    // 11 mapped indices in the fixture; NIFTY NEXT 50 and the "-" g-sec row are excluded.
    expect(observations.length).toBe(11);
  });

  it("drops rows with a non-numeric pe ('-') instead of guessing a value", () => {
    const observations = mapIndexRowsToObservations(loadFixtureRows(), "2026-09-08");
    const gsec = observations.find((o) => (o.raw as { index?: string })?.index === "NIFTY COMPOSITE G-SEC INDEX");
    expect(gsec).toBeUndefined();
  });

  it("stamps every observation with the given asOfDate (latest-only source, no historical date in the payload)", () => {
    const observations = mapIndexRowsToObservations(loadFixtureRows(), "2026-09-08");
    expect(observations.every((o) => o.date === "2026-09-08")).toBe(true);
  });

  it("declares the 11 series it currently covers (P/E only — no TRI field on this source, no Capital Goods index match)", () => {
    const adapter = createNseAdapter();
    expect(adapter.series).toEqual([
      "nifty50_pe",
      "nifty100_pe",
      "midcap150_pe",
      "smallcap250_pe",
      "sector_pe_banking",
      "sector_pe_it",
      "sector_pe_pharma",
      "sector_pe_auto",
      "sector_pe_fmcg",
      "sector_pe_energy",
      "sector_pe_metals",
    ]);
  });

  it("fetchHistory() throws honestly — no historical index-level endpoint found on this domain", async () => {
    const adapter = createNseAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical/i);
  });
});
