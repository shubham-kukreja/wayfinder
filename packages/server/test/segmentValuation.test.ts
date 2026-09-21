import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@wayfinder/engine";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { computeAutoScoreCells } from "../src/pipeline/scoreCells.js";
import { monthEndSample } from "../src/pipeline/percentile.js";
import { parseMultplTable } from "../src/adapters/multpl.js";

// Calculation Guide "Valuation vs own history": segment P/E (and
// optionally P/B) "percentile vs its own 10-15Y MONTHLY history,
// INVERTED."

// Month-end rows for `months` months ending 2026-09, so the history has
// real calendar span rather than a dense recent cluster.
function seedMonthly(
  db: Database.Database,
  seriesId: string,
  months: number,
  valueAt: (i: number) => number
) {
  const rows = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(2026, 8 - (months - 1 - i) + 1, 0)); // month-end
    rows.push({
      seriesId,
      date: d.toISOString().slice(0, 10),
      value: valueAt(i),
      basis: null,
      source: "NIFTYINDICES",
      fetchedAt: "2026-09-20T00:00:00Z",
    });
  }
  insertObservations(db, rows);
}

describe("equity.*::valuation", () => {
  it("inverts the P/E percentile — a cheap segment scores high", () => {
    const db = new Database(":memory:");
    migrate(db);
    // 10 years of month-end P/E falling from 40 to ~20: today is the
    // cheapest reading in its own history, so the inverted score pins high.
    seedMonthly(db, "midcap150_pe", 120, (i) => 40 - i * 0.16);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.mid::valuation"
    )!;

    expect(cell.status).toBe("ok");
    expect(cell.value).toBeGreaterThan(95);
    expect(cell.derivedFrom).toEqual(["midcap150_pe"]); // no P/B seeded
    expect(cell.historySpanYears).toBeGreaterThan(9);
    db.close();
  });

  it("averages the P/E and P/B legs when both have history", () => {
    const db = new Database(":memory:");
    migrate(db);
    // P/E at its cheapest (score ~100), P/B at its dearest (score ~0).
    // The average must land near the middle — which also proves the two
    // legs are percentiled SEPARATELY and then averaged, not pooled.
    seedMonthly(db, "smallcap250_pe", 120, (i) => 40 - i * 0.16);
    seedMonthly(db, "smallcap250_pb", 120, (i) => 2 + i * 0.02);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.small::valuation"
    )!;

    expect(cell.status).toBe("ok");
    expect(cell.transform).toBe("average");
    expect(cell.derivedFrom).toEqual(["smallcap250_pe", "smallcap250_pb"]);
    expect(cell.value).toBeGreaterThan(40);
    expect(cell.value).toBeLessThan(60);
    db.close();
  });

  // TRACEABILITY. The published score has to be reachable from the
  // numbers the trace shows, or the trace is decoration. The legs carry
  // the rank each leg contributed over THIS cell's window, and they must
  // average back to the cell's own value exactly.
  it("emits per-leg rankings that reproduce the published score", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedMonthly(db, "smallcap250_pe", 120, (i) => 40 - i * 0.16);
    seedMonthly(db, "smallcap250_pb", 120, (i) => 2 + i * 0.02);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.small::valuation"
    )!;

    expect(cell.legs).toHaveLength(2);
    // Ordered to match derivedFrom, so the UI can walk them together.
    expect(cell.legs!.map((l) => l.seriesId)).toEqual(cell.derivedFrom);

    for (const leg of cell.legs!) {
      // Inversion is the whole point of the cell: cheap must score high.
      expect(leg.score).toBeCloseTo(100 - leg.percentile, 10);
      // Ranked over the month-end sample, not the raw stored rows. 119,
      // not the 120 seeded: the 10-year window clips the oldest month.
      expect(leg.observations).toBe(119);
      expect(leg.spanYears).toBeGreaterThan(9);
      // August's month-end, not September's: asOfDate is the 20th, and
      // the window ends there, so the 2026-09-30 row is out of scope.
      expect(leg.date).toBe("2026-08-31");
    }

    const mean = cell.legs!.reduce((sum, l) => sum + l.score, 0) / cell.legs!.length;
    expect(mean).toBeCloseTo(cell.value, 10);
    db.close();
  });

  // The single-leg case still has to close, and must not claim a P/B leg
  // it never ranked.
  it("emits one leg, reproducing the score, when only P/E has history", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedMonthly(db, "midcap150_pe", 120, (i) => 40 - i * 0.16);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.mid::valuation"
    )!;

    expect(cell.legs).toHaveLength(1);
    expect(cell.legs![0]!.seriesId).toBe("midcap150_pe");
    expect(cell.legs![0]!.score).toBeCloseTo(cell.value, 10);
    db.close();
  });

  // The leg ranks the value from the MONTH-END SAMPLE, not the series'
  // raw latest row. Those differ whenever a mid-month daily print is the
  // newest row: printing the raw latest next to a percentile taken on a
  // different number is the class of mismatch this whole change removes.
  it("reports the reading it actually ranked, not a later intra-month print", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedMonthly(db, "nifty100_pe", 120, (i) => 40 - i * 0.16);
    // A daily row after the last month-end, at a wildly different level.
    insertObservations(db, [
      {
        seriesId: "nifty100_pe",
        date: "2026-09-20",
        value: 99,
        basis: null,
        source: "NIFTYINDICES",
        fetchedAt: "2026-09-20T00:00:00Z",
      },
    ]);

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.large::valuation"
    )!;

    const leg = cell.legs![0]!;
    // 2026-09-20 IS the month's last row once it exists, so that is what
    // gets ranked — and the leg must report that same 99, never the
    // month-end it displaced.
    expect(leg.date).toBe("2026-09-20");
    expect(leg.value).toBe(99);
    expect(leg.score).toBeCloseTo(cell.value, 10);
    db.close();
  });

  // The bug this whole change existed to fix: a 2-year window answering
  // a question the spec asks of a 10-15 year one. Large/mid scored 97.99
  // and 97.37 off 2.1 years of stored history (live 2026-09-20).
  it("abstains rather than ranking against a window far shorter than the spec's", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedMonthly(db, "nifty100_pe", 12, (i) => 25 - i * 0.4); // 1 year only

    const cell = computeAutoScoreCells(db, DEFAULT_PARAMS, "2026-09-20").find(
      (c) => c.scoreId === "equity.large::valuation"
    )!;

    expect(cell.status).toBe("insufficient_history");
    expect(cell.value).toBe(50);
    expect(cell.historyShortfall).toBe(true);
    db.close();
  });
});

describe("monthEndSample", () => {
  // Percentile rank is computed over stored ROWS, so an unevenly sampled
  // history weights the densest period. Live case: midcap150_pb ranked at
  // the 17.2nd percentile on daily rows and the 77.1st on monthly ones —
  // "cheap" or "expensive" purely from polling frequency.
  it("keeps one row per month, the last dated one", () => {
    const sampled = monthEndSample([
      { date: "2026-08-03", value: 1 },
      { date: "2026-08-31", value: 2 },
      { date: "2026-09-01", value: 3 },
      { date: "2026-09-19", value: 4 },
    ]);

    expect(sampled).toEqual([
      { date: "2026-08-31", value: 2 },
      { date: "2026-09-19", value: 4 },
    ]);
  });
});

describe("multpl.com parser", () => {
  // Trimmed from the live page, captured 2026-09-20. The "&#x2002;"
  // marker is the point of this fixture: it is served UNDECODED, and its
  // literal text contains "2002", so a naive first-number-in-the-cell
  // match stored a YEAR as a P/E ratio. Five of the 120 rows in the
  // 10-year window came back as 2002, which pinned equity.intl::valuation
  // at a clamped 100.
  const FIXTURE = `
    <table id="datatable"><tbody>
      <tr><th>Date</th><th>Value</th></tr>
      <tr><td>Sep 18, 2026</td><td>&dagger;\n26.07</td></tr>
      <tr><td>Jun 1, 2026</td><td>&#x2002;\n25.22</td></tr>
      <tr><td>May 1, 2026</td><td>&#x2002;\n26.09</td></tr>
    </tbody></table>`;

  it("reads the value, not the digits inside an undecoded entity", () => {
    const rows = parseMultplTable(FIXTURE, "sp500_trailing_pe");

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.seriesId === "sp500_trailing_pe")).toBe(true);
    expect(rows[0]).toMatchObject({ date: "2026-09-18", value: 26.07 });
    expect(rows[1]).toMatchObject({ date: "2026-06-01", value: 25.22 });
    // The header row is skipped, and no row carries a year as its value.
    expect(rows.some((r) => r.value > 100)).toBe(false);
  });

  // Same table markup on multpl.com's EPS page — feeds
  // equity.intl::growth_diff's documented US-side substitute
  // (sp500_trailing_eps_real). One parser, two series ids.
  const EPS_FIXTURE = `
    <table id="datatable"><tbody>
      <tr><th>Date</th><th>Value</th></tr>
      <tr><td>Jun 30, 2026</td><td>&#x2002;\n295.36</td></tr>
      <tr><td>May 31, 2026</td><td>&#x2002;\n283.14</td></tr>
    </tbody></table>`;

  it("parses the EPS page's table under the sp500_trailing_eps_real series id", () => {
    const rows = parseMultplTable(EPS_FIXTURE, "sp500_trailing_eps_real");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.seriesId === "sp500_trailing_eps_real")).toBe(true);
    expect(rows[0]).toMatchObject({ date: "2026-06-30", value: 295.36 });
  });
});
