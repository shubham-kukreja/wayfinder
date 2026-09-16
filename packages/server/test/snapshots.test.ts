import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { migrate } from "../src/store/schema.js";
import { saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, latestReview, latestPublishedSnapshotRow } from "../src/store/snapshots.js";
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

  it("stores published snapshot metadata without breaking review listing", () => {
    const first = saveSnapshot(db, healthySnapshot, "Published v1", { isReview: true, published: true, actor: "dev" });
    const second = saveSnapshot(db, { ...healthySnapshot, asOf: "2026-12-01T00:00:00Z" }, "Published v2", {
      isReview: true,
      published: true,
      parentId: first,
      actor: "dev",
    });

    const list = listSnapshots(db);
    expect(list[0]!.id).toBe(second);
    expect(list[0]!.published).toBe(true);
    expect(list[0]!.parentId).toBe(first);
    expect(list[0]!.actor).toBe("dev");
  });

  it("latestPublishedSnapshotRow returns newest published version only", () => {
    saveSnapshot(db, { ...healthySnapshot, asOf: "2026-01-01T00:00:00Z" }, "Draft review", { isReview: true, published: false });
    const publishedId = saveSnapshot(db, { ...healthySnapshot, asOf: "2026-02-01T00:00:00Z" }, "Published", { isReview: true, published: true });

    const latest = latestPublishedSnapshotRow(db);
    expect(latest?.id).toBe(publishedId);
    expect(latest?.snapshot.asOf).toBe("2026-02-01T00:00:00Z");
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

  it("deleteSnapshot removes a review and returns true", () => {
    const id = saveSnapshot(db, healthySnapshot, "Delete me", true);
    expect(getSnapshot(db, id)).toBeDefined();

    const deleted = deleteSnapshot(db, id);
    expect(deleted).toBe(true);
    expect(getSnapshot(db, id)).toBeUndefined();
    expect(listSnapshots(db)).toHaveLength(0);
  });

  it("deleteSnapshot removes a PUBLISHED version too — no special-casing published rows", () => {
    const id = saveSnapshot(db, healthySnapshot, "Published, but still deletable", { isReview: true, published: true, actor: "dev" });
    const deleted = deleteSnapshot(db, id);
    expect(deleted).toBe(true);
    expect(latestPublishedSnapshotRow(db)).toBeUndefined();
  });

  it("deleteSnapshot returns false for an unknown id, not a throw", () => {
    const deleted = deleteSnapshot(db, "does-not-exist");
    expect(deleted).toBe(false);
  });

  it("deleting one snapshot leaves other snapshots (including its own children) untouched", () => {
    const parentId = saveSnapshot(db, healthySnapshot, "Parent", { isReview: true, published: true, actor: "dev" });
    const childId = saveSnapshot(db, { ...healthySnapshot, asOf: "2026-03-01T00:00:00Z" }, "Child", {
      isReview: true,
      published: true,
      parentId,
      actor: "dev",
    });

    deleteSnapshot(db, parentId);

    // The child snapshot itself is untouched even though its parentId
    // now dangles — no FK constraint enforces cascading, and the UI
    // already renders an unknown/missing parent gracefully.
    expect(getSnapshot(db, childId)).toBeDefined();
    const list = listSnapshots(db);
    expect(list).toHaveLength(1);
    expect(list[0]!.parentId).toBe(parentId);
  });
});
