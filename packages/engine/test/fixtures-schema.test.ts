import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotSchema } from "../src/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockDir = join(__dirname, "../../../mock");

const FIXTURES = [
  "snapshot.json",
  "snapshot-degraded.json",
  "snapshot-cold-start.json",
  "snapshot-extreme.json",
  "snapshot-empty-sleeve.json",
];

describe("M0 — mock fixtures validate against the zod schema", () => {
  for (const file of FIXTURES) {
    it(`${file} is a valid Snapshot`, () => {
      const raw = JSON.parse(readFileSync(join(mockDir, file), "utf-8"));
      const result = snapshotSchema.safeParse(raw);
      if (!result.success) {
        console.error(result.error.format());
      }
      expect(result.success).toBe(true);
    });

    it(`${file} has all 85 score keys present`, () => {
      const raw = JSON.parse(readFileSync(join(mockDir, file), "utf-8"));
      expect(Object.keys(raw.scores).length).toBe(85);
    });

    it(`${file} allocation totals 1.0 within 0.0005`, () => {
      const raw = JSON.parse(readFileSync(join(mockDir, file), "utf-8"));
      expect(Math.abs(raw.allocation.total - 1.0)).toBeLessThan(0.0005);
    });
  }

  it("snapshot.json reproduces §5.2 exactly", () => {
    const raw = JSON.parse(readFileSync(join(mockDir, "snapshot.json"), "utf-8"));
    const byId = Object.fromEntries(raw.allocation.rollup.map((r: any) => [r.id, r.portfolioWeight]));
    expect(byId["equity.large"]).toBeCloseTo(0.2348, 3);
    expect(byId["debt.gilt"]).toBeCloseTo(0.0927, 3);
    expect(byId["metals.gold"]).toBeCloseTo(0.074, 3);
    expect(raw.allocation.sector.held).toEqual(["sector.capgoods"]);
  });
});
