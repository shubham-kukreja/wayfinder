import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDbNomicsAdapter, parseDbNomicsReserves, DbNomicsFetchError } from "../src/adapters/dbnomics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture() {
  return JSON.parse(readFileSync(join(fixturesDir, "dbnomics_gold_reserves_sample.json"), "utf-8"));
}

// §10.10 — DBnomics adapter, the Central Bank gold buying data point.
// This fixture is a trimmed real response (8 of 829 real monthly
// observations, with one value nulled to test gap handling) captured
// live 2026-09-15 from IMF IFS series M.W00.RAFAGOLDV_OZT via
// api.db.nomics.world — confirmed live: no auth, no Cloudflare wall,
// unlike World Gold Council's own Goldhub Excel downloads.
describe("DBnomics adapter — parses IMF IFS global gold reserves", () => {
  it("converts millions of troy ounces to tonnes and stamps YYYY-MM-01 dates", () => {
    const observations = parseDbNomicsReserves(loadFixture());
    const nov = observations.find((o) => o.date === "2024-11-01");
    // 1165.73422169337 million troy oz * 31.1034768 = 36259.5...tonnes
    expect(nov?.value).toBeCloseTo(1165.73422169337 * 31.1034768, 2);
  });

  it("drops a null observation (a genuine IMF reporting gap) rather than guessing a value", () => {
    const observations = parseDbNomicsReserves(loadFixture());
    expect(observations.some((o) => o.date === "2025-02-01")).toBe(false);
    // 8 periods in the fixture, 1 null -> 7 real observations.
    expect(observations.length).toBe(7);
  });

  it("every observation uses the same series ID", () => {
    const observations = parseDbNomicsReserves(loadFixture());
    expect(observations.every((o) => o.seriesId === "cb_gold_reserves_tonnes")).toBe(true);
  });

  it("throws honestly when the response carries an errors field", () => {
    expect(() => parseDbNomicsReserves({ series: { docs: [] }, errors: ["bad series code"] } as any)).toThrow(DbNomicsFetchError);
  });

  it("throws honestly when the response has no series docs", () => {
    expect(() => parseDbNomicsReserves({ series: { docs: [] } } as any)).toThrow(/no series docs/i);
  });

  it("declares its one series", () => {
    const adapter = createDbNomicsAdapter();
    expect(adapter.series).toEqual(["cb_gold_reserves_tonnes"]);
  });
});
