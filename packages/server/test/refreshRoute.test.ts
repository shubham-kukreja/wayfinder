import { describe, expect, it } from "vitest";
import { parseRequestedSources, buildAdapters, AVAILABLE_SOURCES } from "../src/routes/refresh.js";
import { loadConfig } from "../src/config.js";

describe("parseRequestedSources — POST /api/refresh?sources=... (§13.1, §11.5)", () => {
  it("defaults to every registered source — a full refresh now includes the slow headless-browser adapters too", () => {
    const result = parseRequestedSources(undefined);
    expect(result).toEqual([...AVAILABLE_SOURCES]);
  });

  it("accepts a comma-separated list, trimmed and lowercased", () => {
    const result = parseRequestedSources(" FRED, Bullion ,amfi");
    expect(result).toEqual(["fred", "bullion", "amfi"]);
  });

  it("rbi must be explicitly requested", () => {
    const result = parseRequestedSources("rbi");
    expect(result).toEqual(["rbi"]);
  });

  it("yahoo must be explicitly requested (slow constituent aggregation)", () => {
    const result = parseRequestedSources("yahoo");
    expect(result).toEqual(["yahoo"]);
  });

  it("tradingeconomics must be explicitly requested", () => {
    const result = parseRequestedSources("tradingeconomics");
    expect(result).toEqual(["tradingeconomics"]);
  });

  it("yahoo_metals must be explicitly requested", () => {
    const result = parseRequestedSources("yahoo_metals");
    expect(result).toEqual(["yahoo_metals"]);
  });

  it("niftyindices must be explicitly requested", () => {
    const result = parseRequestedSources("niftyindices");
    expect(result).toEqual(["niftyindices"]);
  });

  it("dbnomics must be explicitly requested", () => {
    const result = parseRequestedSources("dbnomics");
    expect(result).toEqual(["dbnomics"]);
  });

  it("rbi_homepage can be requested independently of rbi (the slow headless-browser mirror)", () => {
    const result = parseRequestedSources("rbi_homepage");
    expect(result).toEqual(["rbi_homepage"]);
  });

  it("rejects an unknown source name with a clear error, not a silent no-op", () => {
    const result = parseRequestedSources("bogus");
    expect(result).toEqual({ error: expect.stringContaining("Unknown source(s): bogus") });
  });

  it("ccil must be explicitly requested (headless-browser CCIL ZCYC scrape)", () => {
    const result = parseRequestedSources("ccil");
    expect(result).toEqual(["ccil"]);
  });

  it("every available source name is buildable", () => {
    const config = loadConfig();
    const adapters = buildAdapters([...AVAILABLE_SOURCES], config);
    // 13 source names -> 13 adapter instances, though "rbi" and
    // "rbi_homepage" both report id "RBI" (two different mechanisms
    // fetching different RBI-sourced series — the dbie.rbihub.in mirror
    // vs. rbi.org.in's own homepage), so the id list has only 12 unique
    // values. "ccil" reports id "CCIL" — a distinct source writing to
    // the same tbill_1y series "rbi" (dbie.rbihub.in) already populates.
    // "aaa3y" reports id "AAA3Y_MOCK" — an intentional always-fails
    // adapter (see adapters/aaa3y.ts) so aaa_3y surfaces honestly as
    // missing/failed rather than being silently absent.
    expect(adapters).toHaveLength(13);
    expect(adapters.map((a) => a.id).sort()).toEqual([
      "AAA3Y_MOCK",
      "AMFI",
      "CCIL",
      "DBNOMICS",
      "FRED",
      "IBJA",
      "NIFTYINDICES",
      "NSE",
      "RBI",
      "RBI",
      "TRADINGECONOMICS",
      "YAHOO",
      "YAHOO_METALS",
    ]);
  });

  it("buildAdapters only includes the requested sources", () => {
    const config = loadConfig();
    const adapters = buildAdapters(["fred"], config);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]!.id).toBe("FRED");
  });
});
