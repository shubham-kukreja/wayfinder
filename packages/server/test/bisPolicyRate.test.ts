import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBisPolicyRateAdapter,
  parseBisPolicyRateCsv,
  splitCsvLine,
  BisPolicyRateFetchError,
} from "../src/adapters/bisPolicyRate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture() {
  return readFileSync(join(fixturesDir, "bis_policy_rate_sample.csv"), "utf-8");
}

// §8.1 — BIS central bank policy rates for India (WS_CBPOL/M.IN), the
// repo_rate HISTORY that makes equityMacroScore's rbiStance input
// answerable. rbi.org.in's homepage widget is current-value only, and
// the DBnomics mirror of this same dataset is a year stale (ends
// 2025-06 while BIS publishes through 2026-06) — see the file comments
// in bisPolicyRate.ts and dbnomics.ts.
//
// This fixture is a trimmed real response captured live 2026-09-19,
// covering the genuine recent RBI path (5.5 held through November 2025,
// cut to 5.25 in December, held every month since), with one month
// blanked to exercise gap handling.
describe("BIS policy rate adapter — parses the SDMX CSV", () => {
  it("reads the rate in percent with no unit conversion, stamping YYYY-MM-01 dates", () => {
    const observations = parseBisPolicyRateCsv(loadFixture());
    expect(observations.find((o) => o.date === "2025-09-01")?.value).toBe(5.5);
    expect(observations.find((o) => o.date === "2026-06-01")?.value).toBe(5.25);
  });

  it("reproduces the real December 2025 cut and the holds since", () => {
    const observations = parseBisPolicyRateCsv(loadFixture());
    expect(observations.map((o) => [o.date, o.value])).toEqual([
      ["2025-09-01", 5.5],
      ["2025-11-01", 5.5],
      ["2025-12-01", 5.25],
      ["2026-01-01", 5.25],
      ["2026-02-01", 5.25],
      ["2026-03-01", 5.25],
      ["2026-04-01", 5.25],
      ["2026-05-01", 5.25],
      ["2026-06-01", 5.25],
    ]);
  });

  // A repo rate is a step function of discrete MPC decisions, so a gap
  // must not be carried forward — that would invent a rate the central
  // bank never set.
  it("drops a blank OBS_VALUE month rather than filling it", () => {
    const observations = parseBisPolicyRateCsv(loadFixture());
    expect(observations.some((o) => o.date === "2025-10-01")).toBe(false);
    expect(observations.length).toBe(9); // 10 rows in the fixture, 1 blank
  });

  it("writes to the same repo_rate series adapters/rbiRepoRate.ts populates", () => {
    const observations = parseBisPolicyRateCsv(loadFixture());
    expect(observations.every((o) => o.seriesId === "repo_rate")).toBe(true);
  });

  it("returns observations sorted oldest-first, as the derive helpers assume", () => {
    const dates = parseBisPolicyRateCsv(loadFixture()).map((o) => o.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("throws honestly on an empty body", () => {
    expect(() => parseBisPolicyRateCsv("")).toThrow(BisPolicyRateFetchError);
  });

  it("throws honestly when the expected columns are missing (API shape changed)", () => {
    expect(() => parseBisPolicyRateCsv("FREQ,REF_AREA\nM,IN")).toThrow(/missing TIME_PERIOD\/OBS_VALUE/);
  });

  it("throws honestly when the CSV parses but yields no usable observations", () => {
    expect(() => parseBisPolicyRateCsv("TIME_PERIOD,OBS_VALUE\n,\n")).toThrow(/no usable observations/);
  });

  // The column indices are resolved by header NAME. BIS is an SDMX API
  // whose dimension columns can legitimately shift; a hardcoded index
  // would silently read the wrong field instead of failing.
  it("resolves columns by header name, not fixed position", () => {
    const csv = "OBS_VALUE,SOMETHING_NEW,TIME_PERIOD\n5.25,xyz,2026-06\n";
    expect(parseBisPolicyRateCsv(csv)).toEqual([
      expect.objectContaining({ seriesId: "repo_rate", date: "2026-06-01", value: 5.25 }),
    ]);
  });

  // Guards the monthly shape: if BIS ever served a different frequency at
  // this URL, date-stamping a daily period as a month would corrupt the
  // series rather than fail.
  it("skips rows whose period isn't the monthly YYYY-MM shape", () => {
    const csv = "TIME_PERIOD,OBS_VALUE\n2026-06-15,5.25\n2026-06,5.25\n";
    expect(parseBisPolicyRateCsv(csv).map((o) => o.date)).toEqual(["2026-06-01"]);
  });

  it("declares its one series", () => {
    expect(createBisPolicyRateAdapter().series).toEqual(["repo_rate"]);
  });
});

// BIS's CSV carries free-text metadata columns whose values contain
// commas AND are double-quoted, so a plain split(",") mis-aligns every
// column after them — which is exactly where TIME_PERIOD and OBS_VALUE
// live.
describe("splitCsvLine — RFC4180 field splitting", () => {
  it("splits plain unquoted fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas that appear inside a quoted field", () => {
    expect(splitCsvLine('a,"b, still b",c')).toEqual(["a", "b, still b", "c"]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    expect(splitCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("preserves empty trailing fields (a blank OBS_VALUE is meaningful)", () => {
    expect(splitCsvLine("a,,")).toEqual(["a", "", ""]);
  });

  // The real failure this guards: BIS's COMPILATION column contains
  // "From 3 Apr 2001 onwards: official repo overnight rate; from 1 Jan
  // 1946 to 2 Apr 2001: oank rate." — commas and all.
  it("handles a realistic BIS metadata row without shifting later columns", () => {
    const line = 'M,IN,"From 3 Apr 2001 onwards: repo rate, previously bank rate",2026-06,5.25';
    expect(splitCsvLine(line)[3]).toBe("2026-06");
    expect(splitCsvLine(line)[4]).toBe("5.25");
  });
});
