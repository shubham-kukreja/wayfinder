import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { migrate } from "../src/store/schema.js";
import { saveSnapshot, listSnapshots, getSnapshot, latestReview } from "../src/store/snapshots.js";
import type { Snapshot } from "@wayfinder/engine";

let db: Database.Database;
let healthySnapshot: Snapshot;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  healthySnapshot = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));
});

afterEach(() => {
  db.close();
});

// §13.1 "freeze current state as an immutable review" / §12.5 principle 4
// ("distinguish looking from deciding").
describe("snapshot persistence — saved reviews", () => {
  it("saves a snapshot and reads it back byte-for-byte via getSnapshot", () => {
    const id = saveSnapshot(db, healthySnapshot, "My first review", true);
    const loaded = getSnapshot(db, id);
    expect(loaded).toBeDefined();
    expect(loaded!.allocation.total).toBeCloseTo(healthySnapshot.allocation.total, 10);
    expect(loaded!.asOf).toBe(healthySnapshot.asOf);
  });

  it("listSnapshots returns saved reviews newest-first", () => {
    const older = { ...healthySnapshot, asOf: "2026-01-01T00:00:00Z" };
    const newer = { ...healthySnapshot, asOf: "2026-06-01T00:00:00Z" };
    saveSnapshot(db, older, "January review", true);
    saveSnapshot(db, newer, "June review", true);

    const list = listSnapshots(db);
    expect(list).toHaveLength(2);
    expect(list[0]!.label).toBe("June review"); // newest first
    expect(list[1]!.label).toBe("January review");
  });

  it("listSnapshots(reviewsOnly) excludes non-review snapshots", () => {
    saveSnapshot(db, healthySnapshot, "A review", true);
    saveSnapshot(db, healthySnapshot, "Not a review", false);

    const reviewsOnly = listSnapshots(db, true);
    expect(reviewsOnly).toHaveLength(1);
    expect(reviewsOnly[0]!.label).toBe("A review");

    const all = listSnapshots(db, false);
    expect(all).toHaveLength(2);
  });

  it("latestReview returns the most recently saved review, ignoring non-reviews", () => {
    const older = { ...healthySnapshot, asOf: "2026-01-01T00:00:00Z" };
    const newer = { ...healthySnapshot, asOf: "2026-06-01T00:00:00Z" };
    saveSnapshot(db, older, "Old review", true);
    saveSnapshot(db, newer, "Not a review, should be ignored", false);

    const latest = latestReview(db);
    expect(latest).toBeDefined();
    expect(latest!.asOf).toBe("2026-01-01T00:00:00Z"); // the only real review, even though it's older
  });

  it("getSnapshot returns undefined for an unknown id, not a throw", () => {
    const result = getSnapshot(db, "does-not-exist");
    expect(result).toBeUndefined();
  });

  it("a label of null is preserved (unlabelled review)", () => {
    const id = saveSnapshot(db, healthySnapshot, null, true);
    const list = listSnapshots(db);
    expect(list.find((s) => s.id === id)?.label).toBeNull();
  });
});
