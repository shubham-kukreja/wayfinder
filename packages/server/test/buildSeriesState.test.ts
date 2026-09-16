import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { insertObservations } from "../src/store/observations.js";
import { buildSeriesState } from "../src/pipeline/buildSeriesState.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function seed(seriesId: string, date: string, value: number, source = "NIFTYINDICES") {
  insertObservations(db, [{ seriesId, date, value, basis: null, source, fetchedAt: "2026-09-15T00:00:00Z" }]);
}

describe("buildSeriesState — backfilling snapshot.series entries the mock baseline predates", () => {
  it("returns null when the series has no observations at all", () => {
    expect(buildSeriesState(db, "nonexistent_series", "2026-09-15", 24)).toBeNull();
  });

  it("builds a real SeriesState from the latest observation and its own trailing history", () => {
    for (let i = 0; i < 30; i++) {
      seed("test_series", `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i);
    }
    const state = buildSeriesState(db, "test_series", "2026-09-15", 24);
    expect(state).not.toBeNull();
    expect(state!.id).toBe("test_series");
    expect(state!.latest).toBe(129); // last seeded value (100 + 29)
    expect(state!.latestDate).toBe("2026-01-30");
    expect(state!.observations).toBe(30);
    expect(state!.windowStart).toBe("2026-01-01");
    expect(state!.source).toBe("NIFTYINDICES");
    expect(state!.status).toBe("ok");
    expect(state!.percentile).toBe(100); // the latest value is also the highest ever seen
  });

  it("reports insufficient_history status and a null percentile below the minimum observation floor", () => {
    seed("sparse_series", "2026-09-01", 50);
    seed("sparse_series", "2026-09-05", 55);
    const state = buildSeriesState(db, "sparse_series", "2026-09-15", 24);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("insufficient_history");
    expect(state!.percentile).toBeNull();
    expect(state!.observations).toBe(2);
  });

  it("computes staleDays as the gap between asOfDate and the latest observation's date", () => {
    for (let i = 0; i < 30; i++) {
      seed("stale_check", `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i);
    }
    const state = buildSeriesState(db, "stale_check", "2026-02-10", 24); // 11 days after 2026-01-30
    expect(state!.staleDays).toBe(11);
  });

  it("staleDays is 0 when the latest observation is dated exactly asOfDate", () => {
    for (let i = 0; i < 30; i++) {
      seed("fresh_check", `2026-01-${String(i + 1).padStart(2, "0")}`, 100 + i);
    }
    const state = buildSeriesState(db, "fresh_check", "2026-01-30", 24);
    expect(state!.staleDays).toBe(0);
  });
});
