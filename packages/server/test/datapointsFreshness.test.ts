import { describe, it, expect } from "vitest";
import type { ScoreState, SeriesState } from "@wayfinder/engine";
import { scoreMapEntry, seriesRole } from "@wayfinder/engine";
import { scoreFreshness, observedAtFor } from "../src/routes/datapoints.js";

// A SeriesState that cannot support a percentile: `insufficient_history`
// is the store's report that a series has fewer than
// percentileMinObservations (24) rows. It says nothing about whether the
// series has a usable CURRENT reading.
function shortSeries(id: string, latestDate: string | null = "2026-08-01"): SeriesState {
  return {
    id,
    latest: 51.5,
    latestDate,
    percentile: null,
    observations: 2,
    windowStart: "2026-07-01",
    source: "TRADINGECONOMICS",
    status: "insufficient_history",
    staleDays: 0,
    error: null,
    mock: false,
  } as SeriesState;
}

function score(overrides: Partial<ScoreState> = {}): ScoreState {
  return {
    value: 55,
    provenance: "rubric",
    derivedFrom: ["global_mfg_pmi"],
    transform: "rubric",
    computedAt: "2026-09-19T14:21:22.146Z",
    enteredAt: null,
    staleDays: 0,
    note: null,
    confidence: null,
    mock: false,
    mockReason: null,
    ...overrides,
  } as ScoreState;
}

describe("scoreFreshness — percentile floor must not suppress rubric cells", () => {
  // The regression this guards: metals.silver::industrial and
  // l1.equity::macro are genuinely computed, non-mock rubric scores, but
  // both read "missing" in the Control Center because an upstream series
  // could not clear a PERCENTILE floor that a rubric never consults.
  it("reports a rubric cell as current even when its series cannot support a percentile", () => {
    expect(scoreFreshness(score(), [shortSeries("global_mfg_pmi")])).toBe("current");
  });

  it("still reports a PERCENTILE cell as missing on the same short series", () => {
    const percentileCell = score({ transform: "percentile", provenance: "auto" });
    expect(scoreFreshness(percentileCell, [shortSeries("sp500_fwd_pe")])).toBe("missing");
  });

  it("does NOT suppress a percentile cell whose legs are declared raw (l1.debt::valuation)", () => {
    // The live regression: l1.debt::valuation percentiles the DERIVED
    // real yield (161 obs, scores 70), but cpi_yoy holds 5 stored rows
    // and reports insufficient_history. Gating on the leg marked a
    // computed cell "missing" and the UI announced "No observation has
    // ever been stored for this point" above a live score.
    const cell = score({ transform: "percentile", provenance: "auto" });
    const entry = scoreMapEntry("l1.debt::valuation");
    expect(entry).toBeDefined();
    expect(seriesRole(entry, "cpi_yoy")).toBe("raw");
    expect(seriesRole(entry, "gsec_10y")).toBe("raw");
    expect(scoreFreshness(cell, [shortSeries("cpi_yoy")], entry)).toBe("current");
  });

  it("an undeclared cell keeps the conservative floor even with a short leg", () => {
    // No SCORE_MAP entry means the derivation is unknown; an unknown
    // cell must not be promoted to "current" by the raw-leg exemption.
    const cell = score({ transform: "percentile", provenance: "auto" });
    expect(scoreMapEntry("l1.equity::fundamentals")).toBeUndefined();
    expect(scoreFreshness(cell, [shortSeries("sp500_fwd_pe")], scoreMapEntry("l1.equity::fundamentals"))).toBe("missing");
  });

  it("still suppresses a percentile cell when NO leg has any reading", () => {
    const cell = score({ transform: "percentile", provenance: "auto" });
    expect(scoreFreshness(cell, [shortSeries("cpi_yoy", null)], scoreMapEntry("l1.debt::valuation"))).toBe("missing");
  });

  it("reports observedAt as the date the score was COMPUTED FOR, not a leg's latest", () => {
    // The live regression: l1.metals::valuation joins gold to CPI by
    // month, so the real series ends where the two last OVERLAPPED —
    // which can be earlier than BOTH legs. Reporting a leg's date
    // overstated how current the number was. computedForDate is what
    // the pipeline actually computed from, so it wins when present.
    const cell = score({ transform: "inverted", provenance: "auto", computedForDate: "2026-03-31" });
    const legs = [
      { ...shortSeries("gold_usd_futures"), latestDate: "2026-09-18", observations: 300, status: "ok" },
      { ...shortSeries("cpi_index"), latestDate: "2026-09-01", observations: 300, status: "ok" },
    ] as SeriesState[];
    expect(observedAtFor(cell, legs)).toBe("2026-03-31");
  });

  it("falls back to the OLDEST leg when the cell reports no computed-for date", () => {
    // Manual cells and the mock baseline carry no computedForDate; the
    // oldest leg is still the right lower bound there.
    const cell = score({ transform: "inverted", provenance: "auto" });
    const legs = [
      { ...shortSeries("a"), latestDate: "2026-09-18" },
      { ...shortSeries("b"), latestDate: "2026-07-01" },
    ] as SeriesState[];
    expect(observedAtFor(cell, legs)).toBe("2026-07-01");
  });

  it("suppresses a rubric cell when no upstream series has any reading at all", () => {
    expect(scoreFreshness(score(), [shortSeries("global_mfg_pmi", null)])).toBe("missing");
  });

  it("a failed upstream still wins over the rubric exemption", () => {
    const failed = { ...shortSeries("global_mfg_pmi"), status: "failed" } as SeriesState;
    expect(scoreFreshness(score(), [failed])).toBe("failed");
  });

  it("a mock rubric baseline is still missing, not current", () => {
    const mockCell = score({ mock: true, mockReason: "Static demo baseline." });
    expect(scoreFreshness(mockCell, [shortSeries("global_mfg_pmi")])).toBe("missing");
  });

  it("a manual override still reports as overridden", () => {
    expect(scoreFreshness(score({ provenance: "manual" }), [shortSeries("global_mfg_pmi")])).toBe("overridden");
  });
});
