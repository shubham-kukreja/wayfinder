import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { buildCurrentSnapshot } from "../src/pipeline/currentSnapshot.js";

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
});
