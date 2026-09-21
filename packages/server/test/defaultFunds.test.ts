import { describe, it, expect } from "vitest";
import type { NavRow } from "../src/adapters/amfiNav.js";
import { pickDefaultFunds, pickTopFundsPerSleeve } from "../src/lib/defaultFunds.js";

function row(schemeCode: string, schemeName: string, nav: number, plan?: string, option?: string): NavRow {
  return { schemeCode, schemeName, nav, date: "2026-09-21", plan, option };
}

// Four Large Cap Funds that differ on exactly the three ranking axes, so
// ordering failures point at a specific rule rather than "the sort moved".
const LARGE_CAP = [
  row("new-direct-growth", "Zeta Large Cap Fund", 500, "Direct Plan", "Growth"),
  row("old-regular-growth", "Beta Large Cap Fund", 100, "Regular Plan", "Growth"),
  row("old-direct-idcw", "Gamma Large Cap Fund", 200, "Direct Plan", "IDCW"),
  row("old-direct-growth", "Alpha Large Cap Fund", 50, "Direct Plan", "Growth"),
];
const ESTABLISHED = new Set(["old-regular-growth", "old-direct-idcw", "old-direct-growth"]);

describe("pickTopFundsPerSleeve", () => {
  it("ranks established over a higher-NAV newcomer, then Direct+Growth, then NAV", () => {
    const picks = pickTopFundsPerSleeve(LARGE_CAP, 4, ESTABLISHED);
    expect(picks.map((p) => p.schemeCode)).toEqual([
      "old-direct-growth", // established + Direct + Growth
      "old-direct-idcw", // established + Direct, loses Growth
      "old-regular-growth", // established, loses Direct
      "new-direct-growth", // not established — ranked last despite the top NAV
    ]);
  });

  it("agrees with pickDefaultFunds on the winner", () => {
    const [top] = pickTopFundsPerSleeve(LARGE_CAP, 5, ESTABLISHED);
    const [chosen] = pickDefaultFunds(LARGE_CAP, ESTABLISHED);
    expect(top!.schemeCode).toBe(chosen!.schemeCode);
  });

  it("returns every candidate when a sleeve has fewer than perSleeve matches", () => {
    const picks = pickTopFundsPerSleeve(LARGE_CAP.slice(0, 2), 5, ESTABLISHED);
    expect(picks).toHaveLength(2);
  });

  it("skips sleeves with no match rather than emitting an empty pick", () => {
    const picks = pickTopFundsPerSleeve([row("x", "Some Unmatched Scheme", 10)], 5, ESTABLISHED);
    expect(picks).toEqual([]);
  });

  it("spends slots on distinct funds, not plan/option variants of one fund", () => {
    // AMFI lists every plan/option combination as its own scheme code.
    const variants = [
      row("tata-dg", "Tata Pharma and Healthcare Fund", 40, "Direct Plan", "Growth"),
      row("tata-di", "Tata Pharma and Healthcare Fund", 38, "Direct Plan", "IDCW"),
      row("tata-rg", "Tata Pharma and Healthcare Fund", 36, "Regular Plan", "Growth"),
      row("mirae-dg", "Mirae Pharma and Healthcare Fund", 20, "Direct Plan", "Growth"),
    ];
    const picks = pickTopFundsPerSleeve(variants, 3, new Set(variants.map((v) => v.schemeCode)));

    expect(picks.map((p) => p.schemeCode)).toEqual(["tata-dg", "mirae-dg"]);
  });

  it("keeps each sleeve's picks under its own sleeveId", () => {
    const rows = [...LARGE_CAP, row("liq", "Delta Liquid Fund", 30, "Direct Plan", "Growth")];
    const picks = pickTopFundsPerSleeve(rows, 2, ESTABLISHED);
    const bySleeve = new Map<string, string[]>();
    for (const p of picks) bySleeve.set(p.sleeveId, [...(bySleeve.get(p.sleeveId) ?? []), p.schemeCode]);

    expect(bySleeve.get("equity.large")).toHaveLength(2);
    expect(bySleeve.get("debt.liquid")).toEqual(["liq"]);
  });
});
