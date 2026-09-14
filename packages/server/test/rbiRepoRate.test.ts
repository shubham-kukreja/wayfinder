import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRbiRepoRateAdapter, parseRepoRateFromHomepage, RbiRepoRateFetchError } from "../src/adapters/rbiRepoRate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function loadFixture() {
  return readFileSync(join(fixturesDir, "rbi_homepage_sample.html"), "utf-8");
}

// §10.11 — RBI repo rate adapter. This fixture is a trimmed real excerpt
// of rbi.org.in's homepage "Policy Rates" accordion, captured live
// 2026-09-15 — confirmed plain server-rendered HTML, no JS/auth needed.
// A different, faster source than adapters/rbi.ts's dbie.rbihub.in
// headless-browser scrape, which was confirmed (2026-09-03) to have no
// repo_rate series at all in its ~350-page catalog.
describe("RBI repo rate adapter — parses rbi.org.in's homepage Policy Rates table", () => {
  it("extracts the Policy Repo Rate percentage, tolerating whitespace/newlines around the value", () => {
    const value = parseRepoRateFromHomepage(loadFixture());
    expect(value).toBe(5.25);
  });

  it("does not accidentally match the Standing Deposit Facility Rate or MSF Rate (different labels)", () => {
    const value = parseRepoRateFromHomepage(loadFixture());
    expect(value).not.toBe(5.0); // SDF
    expect(value).not.toBe(5.5); // MSF
  });

  it("throws honestly when the Policy Repo Rate label is missing (layout changed)", () => {
    expect(() => parseRepoRateFromHomepage("<html><body>no rates here</body></html>")).toThrow(RbiRepoRateFetchError);
  });

  it("declares its one series (repo_rate)", () => {
    const adapter = createRbiRepoRateAdapter();
    expect(adapter.series).toEqual(["repo_rate"]);
  });

  it("fetchHistory() throws honestly — no historical range on this page", async () => {
    const adapter = createRbiRepoRateAdapter();
    await expect(adapter.fetchHistory(new Date(), new Date())).rejects.toThrow(/no historical range/i);
  });
});
