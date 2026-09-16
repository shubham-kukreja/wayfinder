import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { migrate } from "../src/store/schema.js";
import { saveParams, loadCurrentParams } from "../src/store/params.js";
import {
  allManualScores,
  allManualVetoes,
  clearManualScores,
  clearManualVetoes,
  upsertManualScore,
  upsertManualVeto,
} from "../src/store/manual.js";
import type { Snapshot } from "@wayfinder/engine";

let db: Database.Database;
let snap: Snapshot;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  snap = JSON.parse(readFileSync(new URL("../../../mock/snapshot.json", import.meta.url), "utf-8"));
});

// Reverting restores the inputs a user authors — params and manual overrides
// — and must not merge into whatever is currently set. These pin the
// replace-not-merge semantics the route depends on.
describe("revert — restoring authored inputs", () => {
  it("clearManualScores removes overrides added since the target snapshot", () => {
    upsertManualScore(db, { scoreId: "l1.equity::macro", value: 70, note: "old", confidence: null, enteredAt: "2026-01-01T00:00:00Z" });
    upsertManualScore(db, { scoreId: "l1.debt::flows", value: 30, note: "added later", confidence: null, enteredAt: "2026-02-01T00:00:00Z" });
    expect(allManualScores(db)).toHaveLength(2);

    clearManualScores(db);
    expect(allManualScores(db)).toHaveLength(0);
  });

  it("restores exactly the manual scores a snapshot recorded, dropping the rest", () => {
    upsertManualScore(db, { scoreId: "l1.debt::flows", value: 30, note: "added later", confidence: null, enteredAt: "2026-02-01T00:00:00Z" });

    // What the route does: wipe, then replay the snapshot's manual entries.
    const target = { ...snap, scores: { ...snap.scores } };
    target.scores["l1.equity::macro"] = {
      ...target.scores["l1.equity::macro"]!,
      value: 70,
      provenance: "manual",
      enteredAt: "2026-01-01T00:00:00Z",
      note: "reviewed",
      confidence: null,
    };

    clearManualScores(db);
    for (const [scoreId, state] of Object.entries(target.scores)) {
      if (state.provenance !== "manual") continue;
      upsertManualScore(db, {
        scoreId,
        value: state.value,
        note: state.note ?? null,
        confidence: state.confidence ?? null,
        enteredAt: state.enteredAt ?? "2026-03-01T00:00:00Z",
      });
    }

    const rows = allManualScores(db);
    const expectedCount = Object.values(target.scores).filter((s) => s.provenance === "manual").length;
    expect(rows).toHaveLength(expectedCount);

    const restored = rows.find((r) => r.scoreId === "l1.equity::macro")!;
    expect(restored.value).toBe(70);
    expect(restored.note).toBe("reviewed");
    expect(restored.enteredAt).toBe("2026-01-01T00:00:00Z");

    // The override added after the snapshot is gone, not merged through.
    expect(rows.find((r) => r.scoreId === "l1.debt::flows")).toBeUndefined();
  });

  it("clearManualVetoes drops vetoes not present in the target", () => {
    upsertManualVeto(db, { nodeId: "equity.small", active: true, detail: "stale", enteredAt: "2026-02-01T00:00:00Z" });
    expect(allManualVetoes(db)).toHaveLength(1);
    clearManualVetoes(db);
    expect(allManualVetoes(db)).toHaveLength(0);
  });

  it("restores the target's params over whatever is current", () => {
    const reverted = { ...snap.params, maxTilt: { ...snap.params.maxTilt, l1: 0.99 } };
    saveParams(db, "current", snap.params, null, "2026-01-01T00:00:00Z");
    saveParams(db, "current", reverted, null, "2026-02-01T00:00:00Z");
    expect(loadCurrentParams(db)!.maxTilt.l1).toBe(0.99);

    saveParams(db, "current", snap.params, null, "2026-03-01T00:00:00Z");
    expect(loadCurrentParams(db)!.maxTilt.l1).toBe(snap.params.maxTilt.l1);
  });
});
