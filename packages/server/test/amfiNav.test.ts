import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNavAllLatest, parseNavHistoryChunk, amfiNavSeriesId, createAmfiNavAdapter } from "../src/adapters/amfiNav.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture(filename: string): string {
  return readFileSync(join(fixturesDir, filename), "utf-8");
}

// Fixtures are trimmed slices of the two REAL AMFI NAV endpoints
// (downloaded live 2026-09-16 — same "test against the real thing"
// approach amfi.ts's category-report tests use): the latest-snapshot file
// (Code;ISIN;ISIN2;Name;Plan;Option;NAV;Date) and one 7-day range from the
// historical endpoint (Code;Name;Plan;Option;ISIN;ISIN2;NAV;Date) — note
// the different column order between the two, confirmed live.
describe("AMFI NAV adapter — parses real NAV file formats", () => {
  it("parses the latest-snapshot format (Code;ISIN;ISIN2;Name;Plan;Option;NAV;Date)", () => {
    const rows = parseNavAllLatest(loadFixture("amfi_nav_latest_sample.txt"));
    expect(rows.length).toBeGreaterThan(0);

    const axis = rows.find((r) => r.schemeCode === "135762");
    expect(axis).toEqual({ schemeCode: "135762", schemeName: "Axis Children's Fund", nav: 29.5645, date: "2026-09-15" });
  });

  it("drops rows with a genuine 0.0000 NAV (segregated/distressed schemes) rather than treating zero as a real price", () => {
    const rows = parseNavAllLatest(loadFixture("amfi_nav_latest_sample.txt"));
    const zeroNavRow = rows.find((r) => r.schemeCode === "148304");
    expect(zeroNavRow).toBeUndefined();
  });

  it("skips blank lines and category/AMC header lines, not just the column-header row", () => {
    const rows = parseNavAllLatest(loadFixture("amfi_nav_latest_sample.txt"));
    expect(rows.every((r) => r.schemeCode !== "" && r.schemeName !== "")).toBe(true);
  });

  it("parses the historical-range format (Code;Name;Plan;Option;ISIN;ISIN2;NAV;Date) — different column order than the latest endpoint", () => {
    const rows = parseNavHistoryChunk(loadFixture("amfi_nav_history_sample.txt"));
    expect(rows.length).toBeGreaterThan(0);

    const taurus = rows.find((r) => r.schemeCode === "139619" && r.date === "2024-01-01");
    expect(taurus).toEqual({
      schemeCode: "139619",
      schemeName: "Taurus Investor Education Pool - Unclaimed Dividend - Growth",
      nav: 10,
      date: "2024-01-01",
    });
  });

  it("amfiNavSeriesId namespaces scheme codes so they can't collide with any macro series", () => {
    expect(amfiNavSeriesId("135762")).toBe("amfi_nav:135762");
  });
});

describe("createAmfiNavAdapter — SourceAdapter wrapper over a runtime tracked-scheme list", () => {
  it("reports one series per tracked scheme code, unlike every other adapter's fixed compile-time list", () => {
    const adapter = createAmfiNavAdapter(["135762", "139619"]);
    expect(adapter.id).toBe("AMFI_NAV");
    expect(adapter.series).toEqual(["amfi_nav:135762", "amfi_nav:139619"]);
  });

  it("reports a healthy (not failed) status when no schemes are tracked — an empty tracked list is a valid state, not an error", async () => {
    const adapter = createAmfiNavAdapter([]);
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.detail).toContain("No schemes are currently tracked");
  });
});
