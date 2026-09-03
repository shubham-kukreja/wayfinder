import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { latestObservations } from "../src/store/observations.js";
import { recentFetchLog } from "../src/store/fetchLog.js";
import { runRefresh } from "../src/pipeline/refresh.js";
import type { SourceAdapter } from "../src/adapters/types.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function fakeAdapter(id: string, behavior: "ok" | "fail" | "timeout"): SourceAdapter {
  return {
    id,
    series: [`${id.toLowerCase()}_series`],
    async fetchLatest() {
      if (behavior === "fail") throw new Error(`${id} deliberately failed`);
      if (behavior === "timeout") await new Promise(() => {}); // never resolves
      return [{ seriesId: `${id.toLowerCase()}_series`, date: "2026-09-01", value: 42 }];
    },
    async fetchHistory() {
      return [];
    },
    async health() {
      return { source: id, ok: behavior === "ok", lastChecked: new Date().toISOString(), detail: null };
    },
  };
}

// §11.5's exact contract: fan out in parallel, never fail globally, one
// dead source yields a warning while the rest still update.
describe("runRefresh — §11.5 contract", () => {
  it("all sources succeeding: appends observations, no warnings", async () => {
    const adapters = [fakeAdapter("SourceA", "ok"), fakeAdapter("SourceB", "ok")];
    const { fetchLog, warnings } = await runRefresh(db, adapters);

    expect(fetchLog).toHaveLength(2);
    expect(fetchLog.every((e) => e.status === "ok")).toBe(true);
    expect(warnings).toHaveLength(0);

    expect(latestObservations(db, "sourcea_series")).toHaveLength(1);
    expect(latestObservations(db, "sourceb_series")).toHaveLength(1);
  });

  it("one source failing does not block the others (never fails globally)", async () => {
    const adapters = [fakeAdapter("SourceA", "ok"), fakeAdapter("SourceB", "fail")];
    const { fetchLog, warnings } = await runRefresh(db, adapters);

    expect(fetchLog).toHaveLength(2);
    const aEntry = fetchLog.find((e) => e.source === "SourceA")!;
    const bEntry = fetchLog.find((e) => e.source === "SourceB")!;
    expect(aEntry.status).toBe("ok");
    expect(bEntry.status).toBe("failed");
    expect(bEntry.error).toMatch(/deliberately failed/);

    // SourceA's data still landed despite SourceB's failure.
    expect(latestObservations(db, "sourcea_series")).toHaveLength(1);
    expect(latestObservations(db, "sourceb_series")).toHaveLength(0);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("source_failed");
    expect(warnings[0]!.affects).toContain("sourceb_series");
  });

  it("a hanging source times out rather than blocking the refresh forever", async () => {
    const adapters = [fakeAdapter("SourceA", "ok"), fakeAdapter("SourceSlow", "timeout")];
    const { fetchLog, warnings } = await runRefresh(db, adapters, 200); // short timeout for a fast test

    const slowEntry = fetchLog.find((e) => e.source === "SourceSlow")!;
    expect(slowEntry.status).toBe("failed");
    expect(slowEntry.error).toMatch(/timed out/);
    expect(warnings.some((w) => w.message.includes("timed out"))).toBe(true);
  });

  it("writes a fetch_log row per source, queryable afterward", async () => {
    await runRefresh(db, [fakeAdapter("SourceA", "ok"), fakeAdapter("SourceB", "fail")]);
    const log = recentFetchLog(db);
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  it("never throws, even with all sources failing", async () => {
    const adapters = [fakeAdapter("SourceA", "fail"), fakeAdapter("SourceB", "fail")];
    await expect(runRefresh(db, adapters)).resolves.toBeDefined();
  });
});
