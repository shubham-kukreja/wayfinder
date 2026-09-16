import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { DEFAULT_PARAMS } from "@wayfinder/engine";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { upsertManualScore, upsertManualVeto } from "../src/store/manual.js";
import { saveParams } from "../src/store/params.js";
import { buildCurrentSnapshot } from "../src/pipeline/currentSnapshot.js";

function mockBaselineHasNoEntryFor(seriesId: string): boolean {
  const baseline = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));
  return !(seriesId in baseline.series);
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe("buildCurrentSnapshot — single source of truth for 'current state'", () => {
  it("with an empty store, returns the mock baseline unchanged (0 recomputed)", () => {
    const { snapshot, recomputedIds } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(recomputedIds).toHaveLength(0);
    expect(snapshot.asOf).toBe("2026-09-08T00:00:00Z");
    expect(Object.keys(snapshot.scores)).toHaveLength(85);
    expect(Math.abs(snapshot.allocation.total - 1)).toBeLessThan(0.0005);
  });

  it("reflects observations already in the store, independent of when they were fetched", () => {
    // Seed enough history for a real percentile — this simulates data
    // that arrived from a PRIOR refresh call, not one happening now.
    const rows = Array.from({ length: 30 }, (_, i) => ({
      seriesId: "gold_inr",
      date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      value: 5000 + i * 20,
      basis: null,
      source: "IBJA",
      fetchedAt: "2026-01-01T00:00:00Z",
    }));
    const silverRows = rows.map((r) => ({ ...r, seriesId: "silver_inr", value: 60 }));
    insertObservations(db, [...rows, ...silverRows]);

    const { snapshot, recomputedIds } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(recomputedIds).toContain("metals.gold::ratio_position");
    expect(snapshot.scores["metals.gold::ratio_position"]!.provenance).toBe("auto");
  });

  it("calling it twice in a row with the same store state returns the same result (idempotent read)", () => {
    const first = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    const second = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(first.snapshot.allocation.total).toBeCloseTo(second.snapshot.allocation.total, 10);
    expect(first.recomputedIds).toEqual(second.recomputedIds);
  });

  it("a manual score override always wins over an auto-recomputed value for the same cell", () => {
    // Seed enough history so metals.gold::ratio_position would normally
    // be recomputed as "auto" (per the earlier test) -- then manually
    // override it and confirm the manual entry wins.
    const rows = Array.from({ length: 30 }, (_, i) => ({
      seriesId: "gold_inr",
      date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      value: 5000 + i * 20,
      basis: null,
      source: "IBJA",
      fetchedAt: "2026-01-01T00:00:00Z",
    }));
    const silverRows = rows.map((r) => ({ ...r, seriesId: "silver_inr", value: 60 }));
    insertObservations(db, [...rows, ...silverRows]);
    upsertManualScore(db, {
      scoreId: "metals.gold::ratio_position",
      value: 42,
      note: "Broker override",
      confidence: "high",
      enteredAt: "2026-09-08T00:00:00Z",
    });

    const { snapshot } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(snapshot.scores["metals.gold::ratio_position"]!.value).toBe(42);
    expect(snapshot.scores["metals.gold::ratio_position"]!.provenance).toBe("manual");
    expect(snapshot.scores["metals.gold::ratio_position"]!.note).toBe("Broker override");
  });

  it("a saved params object (POST /api/params -> store/params.ts) is used instead of the mock baseline's params", () => {
    const customParams = { ...DEFAULT_PARAMS, maxTilt: { ...DEFAULT_PARAMS.maxTilt, l1: 0.05 } };
    saveParams(db, "current", customParams, null, "2026-09-08T00:00:00Z");

    const { snapshot } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(snapshot.params.maxTilt.l1).toBe(0.05);
  });

  it("a manual veto is reflected in the snapshot's vetoes and clamps the allocation", () => {
    upsertManualVeto(db, { nodeId: "debt.corporate", active: true, detail: "Credit event", enteredAt: "2026-09-08T00:00:00Z" });
    const { snapshot } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    expect(snapshot.vetoes["debt.corporate"]!.active).toBe(true);
    expect(snapshot.vetoes["debt.corporate"]!.provenance).toBe("manual");
    expect(snapshot.vetoes["debt.corporate"]!.detail).toBe("Credit event");
    expect(snapshot.allocation.groups.debt.nodes["debt.corporate"]!.vetoActive).toBe(true);
  });

  // Regression test for a real bug found via a browser smoke test:
  // debt.gilt::carry (and every other auto cell) was hardcoded to
  // staleDays: 0 regardless of how old the observation it was actually
  // computed from was. In production this masked a real ~3-month gap
  // between FRED's gsec_10y (which trails) and NSE/niftyindices' daily
  // series, silently presenting a stale June value as if it were fresh
  // in September. staleDays must now reflect the true age of the
  // observation the CURRENT value came from, not always 0.
  it("staleDays reflects the real age of the observation a score was computed from, not always 0", () => {
    // gsec_10y's last observation is ~90 days before asOfDate — a
    // realistic stand-in for FRED's real publication lag.
    const rows = Array.from({ length: 30 }, (_, i) => ({
      seriesId: "gsec_10y",
      date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      value: 6 + i * 0.05,
      basis: null,
      source: "FRED",
      fetchedAt: "2026-06-01T00:00:00Z",
    }));
    insertObservations(db, rows);

    const asOf = "2026-09-08T00:00:00Z"; // ~90 days after the last 2026-06-01 row
    const { snapshot } = buildCurrentSnapshot(db, asOf);

    const giltCarry = snapshot.scores["debt.gilt::carry"]!;
    expect(giltCarry.provenance).toBe("auto");
    expect(giltCarry.staleDays).toBeGreaterThan(60); // NOT 0 — the last real observation is ~90 days old
  });

  // Regression test for a real gap found while adding l1.equity::momentum's
  // derivation trace: snapshot.series is seeded from the static mock
  // baseline and never gets new entries for series a NEWER adapter
  // introduced after the baseline was authored (niftyindices.ts's
  // nifty50_close/nifty50_div_yield postdate it) — so a score cell's
  // derivedFrom could point at a series with literally no snapshot.series
  // entry, even though real observations exist in the store for it.
  it("backfills snapshot.series for a derivedFrom series the mock baseline has no entry for at all", () => {
    expect(mockBaselineHasNoEntryFor("nifty50_close")).toBe(true); // sanity-check the premise
    expect(mockBaselineHasNoEntryFor("nifty50_div_yield")).toBe(true);

    const closeRows = Array.from({ length: 400 }, (_, i) => {
      const d = new Date("2025-01-01T00:00:00Z");
      d.setDate(d.getDate() + i);
      return { seriesId: "nifty50_close", date: d.toISOString().slice(0, 10), value: 20000 + i * 5, basis: null, source: "NIFTYINDICES", fetchedAt: "2026-09-15T00:00:00Z" };
    });
    const divYieldRows = closeRows.map((r) => ({ ...r, seriesId: "nifty50_div_yield", value: 1.2 }));
    // deriveNiftyMomentumSeries (feeding l1.equity::momentum) needs ALL
    // THREE series present to produce even one excess-return observation
    // — without gsec_10y too, this cell stays insufficient_history and
    // the backfill-under-test never runs (the loop `continue`s before
    // reaching it). gsec_10y already has a mock-baseline entry, so this
    // doesn't itself test the backfill path, it just unblocks the cell.
    const gsecRows = Array.from({ length: 20 }, (_, i) => {
      const year = 2025 + Math.floor(i / 12);
      const month = (i % 12) + 1;
      return { seriesId: "gsec_10y", date: `${year}-${String(month).padStart(2, "0")}-01`, value: 6.75, basis: null, source: "FRED", fetchedAt: "2026-09-15T00:00:00Z" };
    });
    insertObservations(db, [...closeRows, ...divYieldRows, ...gsecRows]);

    const { snapshot } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");

    expect(snapshot.series["nifty50_close"]).toBeDefined();
    expect(snapshot.series["nifty50_close"]!.latest).toBe(closeRows[closeRows.length - 1]!.value);
    expect(snapshot.series["nifty50_close"]!.observations).toBe(400);
    expect(snapshot.series["nifty50_close"]!.source).toBe("NIFTYINDICES");

    expect(snapshot.series["nifty50_div_yield"]).toBeDefined();
    expect(snapshot.series["nifty50_div_yield"]!.latest).toBe(1.2);
  });

  it("does NOT overwrite a series the mock baseline already covers, even if it's also in derivedFrom", () => {
    // gold_inr is a real mock-baseline series; seeding fresh observations
    // for it must not clobber snapshot.series["gold_inr"] with a
    // DB-derived reconstruction — the baseline's own entry wins.
    const rows = Array.from({ length: 30 }, (_, i) => ({
      seriesId: "gold_inr",
      date: `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      value: 5000 + i * 20,
      basis: null,
      source: "IBJA",
      fetchedAt: "2026-01-01T00:00:00Z",
    }));
    insertObservations(db, rows);

    const { snapshot } = buildCurrentSnapshot(db, "2026-09-08T00:00:00Z");
    // The mock baseline's own gold_inr entry (whatever value it has) is
    // untouched — only genuinely MISSING series get backfilled.
    const baseline = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));
    expect(snapshot.series["gold_inr"]!.latest).toBe(baseline.series.gold_inr.latest);
  });

  it("staleDays is 0 when the score's underlying observation is dated exactly asOfDate", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      seriesId: "gsec_10y",
      date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      value: 6 + i * 0.05,
      basis: null,
      source: "FRED",
      fetchedAt: "2026-09-08T00:00:00Z",
    }));
    insertObservations(db, rows);

    const lastDate = rows[rows.length - 1]!.date; // e.g. 2026-06-01
    const { snapshot } = buildCurrentSnapshot(db, `${lastDate}T00:00:00Z`);
    expect(snapshot.scores["debt.gilt::carry"]!.staleDays).toBe(0);
  });
});
