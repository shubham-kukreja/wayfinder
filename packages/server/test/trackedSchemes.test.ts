import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/store/schema.js";
import { addTrackedScheme, deactivateTrackedScheme, listTrackedSchemes } from "../src/store/trackedSchemes.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe("tracked_schemes — the runtime allowlist AMFI NAV's adapter reads instead of a fixed series list", () => {
  it("adds a scheme and lists it back as active", () => {
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "Axis Children's Fund", isinGrowth: "INF846K01WO1" });
    const schemes = listTrackedSchemes(db);
    expect(schemes).toHaveLength(1);
    expect(schemes[0]).toMatchObject({ schemeCode: "135762", schemeName: "Axis Children's Fund", active: true });
  });

  it("upserts on re-add — a scheme code added twice does not duplicate, its name/ISIN refresh instead", () => {
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "Old Name" });
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "New Name" });
    const schemes = listTrackedSchemes(db);
    expect(schemes).toHaveLength(1);
    expect(schemes[0]!.schemeName).toBe("New Name");
  });

  it("deactivate soft-deletes: the scheme stays in the full list but drops from the active-only list", () => {
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "Axis Children's Fund" });
    deactivateTrackedScheme(db, "135762");

    expect(listTrackedSchemes(db, { activeOnly: true })).toHaveLength(0);
    const all = listTrackedSchemes(db);
    expect(all).toHaveLength(1);
    expect(all[0]!.active).toBe(false);
  });

  it("re-adding a deactivated scheme reactivates it", () => {
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "Axis Children's Fund" });
    deactivateTrackedScheme(db, "135762");
    addTrackedScheme(db, { schemeCode: "135762", schemeName: "Axis Children's Fund" });

    expect(listTrackedSchemes(db, { activeOnly: true })).toHaveLength(1);
  });
});
