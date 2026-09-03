import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { insertObservations, latestObservations, seriesCoverage } from "../src/store/observations.js";
import { upsertManualScore, getManualScore, upsertManualVeto, allManualVetoes } from "../src/store/manual.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe("observations — append-only, latest wins on read", () => {
  it("inserts and reads back a series", () => {
    insertObservations(db, [
      { seriesId: "gsec_10y", date: "2026-01-31", value: 7.1, basis: null, source: "RBI", fetchedAt: "2026-02-01T00:00:00Z" },
      { seriesId: "gsec_10y", date: "2026-02-28", value: 7.2, basis: null, source: "RBI", fetchedAt: "2026-03-01T00:00:00Z" },
    ]);
    const rows = latestObservations(db, "gsec_10y");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.value).toBe(7.1);
    expect(rows[1]!.value).toBe(7.2);
  });

  it("a later fetched_at for the same date supersedes the earlier one on read", () => {
    insertObservations(db, [
      { seriesId: "gsec_10y", date: "2026-01-31", value: 7.1, basis: null, source: "RBI", fetchedAt: "2026-02-01T00:00:00Z" },
    ]);
    // RBI revises the January figure a month later.
    insertObservations(db, [
      { seriesId: "gsec_10y", date: "2026-01-31", value: 7.15, basis: null, source: "RBI", fetchedAt: "2026-03-01T00:00:00Z" },
    ]);
    const rows = latestObservations(db, "gsec_10y");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(7.15);

    // Both rows still exist in the underlying table — audit trail preserved.
    const allRows = db.prepare("SELECT * FROM observations WHERE series_id = ?").all("gsec_10y");
    expect(allRows).toHaveLength(2);
  });

  it("seriesCoverage reports observation count and window", () => {
    insertObservations(db, [
      { seriesId: "nifty50_pe", date: "2020-01-31", value: 20, basis: "standalone", source: "NSE", fetchedAt: "2020-02-01T00:00:00Z" },
      { seriesId: "nifty50_pe", date: "2021-05-31", value: 25, basis: "consolidated", source: "NSE", fetchedAt: "2021-06-01T00:00:00Z" },
    ]);
    const coverage = seriesCoverage(db, "nifty50_pe");
    expect(coverage.observations).toBe(2);
    expect(coverage.windowStart).toBe("2020-01-31");
    expect(coverage.windowEnd).toBe("2021-05-31");
  });
});

describe("manual scores and vetoes", () => {
  it("upserts and reads a manual score", () => {
    upsertManualScore(db, { scoreId: "equity.large::revisions", value: 62, note: "Broker call", confidence: "medium", enteredAt: "2026-09-01T00:00:00Z" });
    const row = getManualScore(db, "equity.large::revisions");
    expect(row?.value).toBe(62);
    expect(row?.confidence).toBe("medium");

    // Upsert replaces.
    upsertManualScore(db, { scoreId: "equity.large::revisions", value: 65, note: "Updated call", confidence: "high", enteredAt: "2026-09-02T00:00:00Z" });
    const updated = getManualScore(db, "equity.large::revisions");
    expect(updated?.value).toBe(65);
  });

  it("upserts a manual veto with boolean round-trip", () => {
    upsertManualVeto(db, { nodeId: "debt.corporate", active: true, detail: "Credit event", enteredAt: "2026-09-01T00:00:00Z" });
    const vetoes = allManualVetoes(db);
    expect(vetoes).toHaveLength(1);
    expect(vetoes[0]!.active).toBe(true);
    expect(vetoes[0]!.nodeId).toBe("debt.corporate");
  });
});
