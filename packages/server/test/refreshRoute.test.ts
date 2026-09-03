import { describe, expect, it } from "vitest";
import { parseRequestedSources, buildAdapters, AVAILABLE_SOURCES } from "../src/routes/refresh.js";
import { loadConfig } from "../src/config.js";

describe("parseRequestedSources — POST /api/refresh?sources=... (§13.1, §11.5)", () => {
  it("defaults to fred, bullion, amfi — RBI is opt-in only", () => {
    const result = parseRequestedSources(undefined);
    expect(result).toEqual(["fred", "bullion", "amfi"]);
  });

  it("accepts a comma-separated list, trimmed and lowercased", () => {
    const result = parseRequestedSources(" FRED, Bullion ,amfi");
    expect(result).toEqual(["fred", "bullion", "amfi"]);
  });

  it("rbi must be explicitly requested", () => {
    const result = parseRequestedSources("rbi");
    expect(result).toEqual(["rbi"]);
  });

  it("rejects an unknown source name with a clear error, not a silent no-op", () => {
    const result = parseRequestedSources("bogus");
    expect(result).toEqual({ error: expect.stringContaining("Unknown source(s): bogus") });
  });

  it("every available source name is buildable", () => {
    const config = loadConfig();
    const adapters = buildAdapters([...AVAILABLE_SOURCES], config);
    expect(adapters).toHaveLength(4);
    expect(adapters.map((a) => a.id).sort()).toEqual(["AMFI", "FRED", "IBJA", "RBI"]);
  });

  it("buildAdapters only includes the requested sources", () => {
    const config = loadConfig();
    const adapters = buildAdapters(["fred"], config);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.id).toBe("FRED");
  });
});
