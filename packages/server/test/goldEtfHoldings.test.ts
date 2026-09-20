import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGoldEtfArchive, GoldEtfHoldingsFetchError, GOLD_ETF_TONNES_SERIES_ID } from "../src/adapters/goldEtfHoldings.js";

// Fixture: last 30 rows of a real archive captured live 2026-09-20 from
// api.spdrgoldshares.com (2004-11-18 through 2026-09-20 in the real file,
// 5695 rows — trimmed here to keep the fixture small). Includes one real
// "US Holiday" placeholder row (07-Sep-2026, Labor Day) to prove that
// case is dropped, not fabricated.
const FIXTURE_PATH = join(__dirname, "fixtures/gld_historical_archive_sample.xlsx");

describe("parseGoldEtfArchive", () => {
  it("parses real daily Tonnes of Gold observations from the archive", () => {
    const buf = readFileSync(FIXTURE_PATH);
    const observations = parseGoldEtfArchive(buf);
    expect(observations.length).toBeGreaterThan(0);
    for (const o of observations) {
      expect(o.seriesId).toBe(GOLD_ETF_TONNES_SERIES_ID);
      expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(o.value)).toBe(true);
    }
  });

  it("drops the 'US Holiday' placeholder row rather than fabricating a value", () => {
    const buf = readFileSync(FIXTURE_PATH);
    const observations = parseGoldEtfArchive(buf);
    expect(observations.find((o) => o.date === "2026-09-07")).toBeUndefined();
  });

  it("parses the real first and last dates/values in the fixture correctly", () => {
    const buf = readFileSync(FIXTURE_PATH);
    const observations = parseGoldEtfArchive(buf);
    expect(observations[0]).toMatchObject({ date: "2026-08-07", value: 1017.54 });
    expect(observations[observations.length - 1]).toMatchObject({ date: "2026-09-17", value: 1052.84 });
  });

  it("throws GoldEtfHoldingsFetchError on a workbook with no data sheet", () => {
    const XLSX = require("xlsx") as typeof import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Disclaimer text only"]]), "Disclaimer");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(() => parseGoldEtfArchive(buf)).toThrow(GoldEtfHoldingsFetchError);
  });

  it("throws GoldEtfHoldingsFetchError when the expected columns are missing entirely", () => {
    const XLSX = require("xlsx") as typeof import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Disclaimer"]]), "Disclaimer");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Foo: "bar" }]), "Data");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(() => parseGoldEtfArchive(buf)).toThrow(GoldEtfHoldingsFetchError);
  });
});
