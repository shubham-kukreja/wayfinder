import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@wayfinder/engine";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { computeAutoScoreCells } from "../src/pipeline/scoreCells.js";
import { historySpanYears } from "../src/pipeline/percentile.js";

// Calculation Guide, SECTOR SATELLITE: sector P/E "percentile vs its own
// 10Y history, INVERTED". The guard under test is that DEPTH is measured
// in calendar span, not row count — daily data clears a 24-row floor in
// a month while covering no history at all (sector_pe_capgoods held 81
// rows spanning 0.26 years and scored 95.0, live 2026-09-20).
function seed(db: Database.Database, seriesId: string, startIso: string, days: number) {
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(`${startIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    // Rising P/E, so the latest reading is the most expensive => score ~0.
    rows.push({ seriesId, date: d.toISOString().slice(0, 10), value: 10 + i * 0.01, basis: null, source: "NIFTYINDICES", fetchedAt: "2026-09-20T00:00:00Z" });
  }
  insertObservations(db, rows);
}

describe("sector.*::valuation — history depth is span, not row count", () => {
  it("abstains on a short history that clears the observation floor", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db, "sector_pe_capgoods", "2026-06-14", 81); // 81 rows, ~0.22y

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find((c) => c.scoreId === "sector.capgoods::valuation")!;

    expect(cell.status).toBe("insufficient_history");
    expect(cell.value).toBe(50);
    db.close();
  });

  it("ranks and inverts once the history is deep enough", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db, "sector_pe_it", "2024-01-01", 800); // ~2.2 years

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find((c) => c.scoreId === "sector.it::valuation")!;

    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("inverted");
    // Latest reading is the highest P/E in the series => 100th %ile => score 0.
    expect(cell.value).toBeLessThan(5);
    // Shortfall is reported, not hidden: 2.2y is real but short of 10y.
    expect(cell.historyShortfall).toBe(true);
    expect(cell.historySpanYears).toBeGreaterThan(2);
    db.close();
  });

  it("historySpanYears measures calendar span, not observations", () => {
    expect(historySpanYears([{ date: "2026-06-14" }, { date: "2026-09-18" }])).toBeCloseTo(0.26, 1);
    expect(historySpanYears([{ date: "2026-01-01" }])).toBe(0);
  });
});

// Calculation Guide, SECTOR SATELLITE: rel_momentum = "Average of the
// sector index's 6M and 12M return minus Nifty's over the same windows;
// percentile vs history, AS-IS." The guard here is stricter than
// valuation's because the 12M lookback consumes the first year of
// closes before ANY observation exists — sector_close_capgoods (81 rows
// from 2026-06-14) derived an empty series and the cell silently kept
// its mock baseline of 80.0 while ranking for sleeve entry.
describe("sector.*::rel_momentum — abstains when the 12M lookback leaves nothing", () => {
  it("derives nothing from under 12 months of closes, and says so", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db, "sector_close_capgoods", "2026-06-14", 81);
    seed(db, "nifty50_close", "2024-01-01", 800);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find((c) => c.scoreId === "sector.capgoods::rel_momentum")!;

    expect(cell.status).toBe("insufficient_history");
    expect(cell.value).toBe(50);
    expect(cell.historyShortfall).toBe(true);
    db.close();
  });

  it("scores AS-IS once enough relative history exists", () => {
    const db = new Database(":memory:");
    migrate(db);
    // Sector rises faster than the Nifty => positive relative momentum,
    // and the latest reading is the strongest => high percentile, NOT inverted.
    seed(db, "sector_close_it", "2024-01-01", 800);
    seed(db, "nifty50_close", "2024-01-01", 800);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find((c) => c.scoreId === "sector.it::rel_momentum")!;

    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("percentile"); // AS-IS, never inverted
    expect(cell.derivedFrom).toEqual(["sector_close_it", "nifty50_close"]);
    db.close();
  });
});
