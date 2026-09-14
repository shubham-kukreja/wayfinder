import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNiftyIndicesAdapter, parseDailySnapshotCsv, NiftyIndicesFetchError } from "../src/adapters/niftyindices.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture() {
  return readFileSync(join(fixturesDir, "niftyindices_daily_snapshot_sample.csv"), "utf-8");
}

// §10.9 — niftyindices.com Daily Snapshot adapter. This fixture is the
// real Daily_Snapshot/ind_close_all_11092026.csv report, captured live
// 2026-09-15 — the exact source that resolved two previously-confirmed
// gaps: Nifty Capital Goods has no matching index on nseindia.com's
// /api/allIndices (nse.ts), but IS a real row here; and this CSV has a
// directly-constructible per-day URL, giving real historical backfill
// where nse.ts's fetchHistory() is a deliberate no-op.
describe("niftyindices.com Daily Snapshot adapter — CSV parsing", () => {
  it("parses Nifty 50's close, P/E, and P/B into their respective series", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.find((o) => o.seriesId === "nifty50_close")?.value).toBe(23398.1);
    expect(observations.find((o) => o.seriesId === "nifty50_pe")?.value).toBe(19.78);
    // Nifty 50 isn't in INDEX_PB_SERIES_MAP (P/B only spec'd for
    // Midcap/Smallcap/Capital Goods) — confirms it's correctly excluded.
    expect(observations.some((o) => o.seriesId === "nifty50_pb")).toBe(false);
  });

  it("parses Nifty 50's Div Yield — feeds the TRI-return approximation (derive.ts's niftyTriApprox12mReturn)", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.find((o) => o.seriesId === "nifty50_div_yield")?.value).toBe(1.21);
  });

  it("parses Nifty Capital Goods — the sector nse.ts's source genuinely cannot reach", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.find((o) => o.seriesId === "sector_pe_capgoods")?.value).toBe(45.38);
    expect(observations.find((o) => o.seriesId === "sector_pb_capgoods")?.value).toBe(9.4);
    // Capital Goods' Open/High/Low are literal "-" in this real fixture
    // (confirms the parser tolerates that row shape) but Closing Index
    // Value is real — must still parse correctly despite the blank OHL.
    expect(observations.find((o) => o.seriesId === "sector_close_capgoods")?.value).toBe(17105.09);
  });

  it("parses Bank/IT sector P/E, matching nse.ts's existing sector_pe_* naming", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.find((o) => o.seriesId === "sector_pe_banking")?.value).toBe(13.39);
    expect(observations.find((o) => o.seriesId === "sector_pe_it")?.value).toBe(18.45);
  });

  it("parses Midcap 150 / Smallcap 250 P/B", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.find((o) => o.seriesId === "midcap150_pb")?.value).toBe(4.31);
    expect(observations.find((o) => o.seriesId === "smallcap250_pb")?.value).toBe(3.53);
  });

  it("stamps every observation with the given isoDate", () => {
    const observations = parseDailySnapshotCsv(loadFixture(), "2026-09-11");
    expect(observations.every((o) => o.date === "2026-09-11")).toBe(true);
    expect(observations.length).toBeGreaterThan(0);
  });

  it("throws honestly when the response isn't a real CSV (non-trading day / HTML error page)", () => {
    const html = "<!DOCTYPE html><html><head><title>Error 404</title></head><body></body></html>";
    expect(() => parseDailySnapshotCsv(html, "2026-09-14")).toThrow(NiftyIndicesFetchError);
  });

  it("declares series covering PE, PB (3 indices), close price, and Nifty 50 div yield", () => {
    const adapter = createNiftyIndicesAdapter();
    expect(adapter.series).toContain("sector_pe_capgoods");
    expect(adapter.series).toContain("sector_pb_capgoods");
    expect(adapter.series).toContain("nifty50_close");
    expect(adapter.series).toContain("sector_close_banking");
    expect(adapter.series).toContain("nifty50_div_yield");
  });
});
