import { describe, it, expect } from "vitest";
import { needsHistoryFetch } from "../src/lib/backtestRunner.js";

const FROM = "2021-09-14";
const TO = "2026-09-21";

// Dense enough to clear the row-count floor; only the dates/fetched_at
// distinguish the cases below.
function series(startDate: string, fetchedAt: string, days = 400) {
  const start = new Date(startDate);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), fetchedAt };
  });
}

describe("needsHistoryFetch", () => {
  it("fetches when nothing is cached", () => {
    expect(needsHistoryFetch([], FROM, TO)).toBe(true);
  });

  it("does not fetch when the cache covers the window start", () => {
    expect(needsHistoryFetch(series(FROM, "2026-09-21T00:00:00Z"), FROM, TO)).toBe(false);
  });

  it("fetches when cache starts late and predates the window (a narrower earlier run)", () => {
    // Fetched BEFORE this window opens, so it never asked for these years.
    const cached = series("2024-01-01", "2021-01-01T00:00:00Z");
    expect(needsHistoryFetch(cached, FROM, TO)).toBe(true);
  });

  it("does NOT re-fetch a fund younger than the window", () => {
    // The live regression: a 2025-launched ETF can never cover a 2021
    // start, but a fetch spanning this window already ran and found
    // nothing earlier — that is inception, not a cache gap. Treating it
    // as a gap re-fetched every chunk on every run.
    const cached = series("2025-04-03", "2026-09-21T00:00:00Z", 362);
    expect(needsHistoryFetch(cached, FROM, TO)).toBe(false);
  });

  it("still fetches a thin cache even when it was probed recently", () => {
    const cached = [{ date: "2026-09-18", fetchedAt: "2026-09-21T00:00:00Z" }];
    expect(needsHistoryFetch(cached, FROM, TO)).toBe(true);
  });

  it("treats a cache starting within the 10-day grace window as covering", () => {
    expect(needsHistoryFetch(series("2021-09-20", "2026-09-21T00:00:00Z"), FROM, TO)).toBe(false);
  });
});
