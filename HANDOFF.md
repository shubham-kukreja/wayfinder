# Wayfinder — Handoff

Multi-asset portfolio allocation dashboard for the Indian market, replacing a Google Sheet. TypeScript pnpm monorepo: `packages/engine` (pure compute, shared client/server), `packages/server` (Fastify + SQLite), `packages/web` (React/Vite/Tailwind).

Repo: `https://github.com/shubham-kukreja/wayfinder.git`, branch `develop` (do not push to `main`). 19 commits at time of writing, clean tree.

## Core invariants (non-negotiable — read before changing engine code)

- 85 score cells (0–100 attractiveness scores) → composites → tilts (capped deviations from neutral) → weights → final allocation summing to 100%.
- All-50 scores must produce exactly neutral weights.
- Neutral weights are policy, not signal.
- Vetoes clamp overweights to zero only — never used to force an underweight.
- A missing signal scores 50 (neutral) — **never guessed**. `status: "insufficient_history"` cells report 50 honestly.
- Provenance is always visible: every score/series carries auto / rubric / static / manual / default provenance. Manual always wins over auto in layering.
- Refresh never silently overwrites human input (manual scores/vetoes survive a refresh).
- A failed data-source fetch is a warning, never an exception — `POST /api/refresh` never fails globally; per-source isolation.
- No advice language anywhere in the UI (this is a decision-support tool, not a recommendation engine).

## What's built and verified

| Area | Status |
|---|---|
| Engine (pure compute) | Done. `computeAllocation(scores, vetoes, params)`. 77 tests passing. No I/O, no `Date.now()`, no randomness — fully deterministic. |
| SQLite store | Done. Append-only `observations` table ("latest wins" via `MAX(fetched_at)` join), manual scores/vetoes, params, snapshots (reviews), fetch log. |
| FRED adapter | Done, live-verified. `DFII10`→`us_real_10y`, `INDIRLTLT01STM`→`gsec_10y`. Backfill works: 5,002 daily observations, 2006–2026. |
| Bullion/IBJA adapter (metals.dev) | Done for latest values only. Free tier has **no historical range endpoint** — `fetchHistory()` throws `BullionConfigError` by design. Backfilling gold/silver history needs a separate archive source (not identified). |
| AMFI adapter | Done, live-verified. `fetchHistory(from, to)` genuinely supports arbitrary date ranges (predictable monthly PDF URL pattern), verified back to ~2016. Wired into `scripts/backfill.ts`. |
| RBI adapter | Partial. Headless-browser scrape of an RBI data mirror (AG Grid pagination). Covers `cpi_index`, `cpi_yoy`, `tbill_1y` (183–364 day bucket). `fetchHistory()` only returns whatever trailing window the mirror displays (~15 months for CPI) — **not** a true long-range backfill. `gsec_10y` intentionally sourced from FRED instead (RBI mirror's own "yield" page turned out to be a price/turnover index). `repo_rate` confirmed absent from the mirror's ~350-page catalog — no source found anywhere free. |
| NSE adapter | **Implemented, live-verified — different domain than the original blocker.** `nseindia.com/api/allIndices` (cookie-harvest + plain fetch, no Akamai challenge on this endpoint) returns P/E/P/B/dividend-yield for 139 indices; covers 11 of the ~19 target series (all 4 broad indices + 7 of 8 sectors — no NSE index matches "Capital Goods", left manual). **Latest-only**: no historical index-level endpoint found (guessed paths hit real Akamai 503s) — `fetchHistory()` throws by design, same limitation as bullion. No TRI field either, so momentum/rel_momentum cells stay unreachable from this source — P/E-based valuation only. See "NSE — resolved (partially)" below; the original niftyindices.com blocker is now moot since a different domain works. |
| BSE (investigated as NSE substitute) | Built, live-tested, then **reverted**. Its P/E/P/B/yield columns are identical across unrelated indices for the same period — broken on BSE's own backend, not a client bug. Do not retry without new evidence it's fixed. |
| Score derivation pipeline (`pipeline/scoreCells.ts`) | 22 of 85 cells now have derivation logic wired: the original 12 (`l1.equity::flows`, `l1.debt::flows`, `l1.metals::flows`, `metals.gold::ratio_position`, `metals.silver::ratio_position`, `l1.metals::momentum` (approximation), `metals.gold::real_rates`, `metals.silver::real_rates`, `l1.metals::macro`, `l1.debt::valuation`, `debt.gilt::carry`, `debt.liquid::carry`) plus 10 new NSE-derived cells: `equity.large::valuation` (nifty100_pe), `equity.mid::valuation` (midcap150_pe), `equity.small::valuation` (smallcap250_pe), and `sector.{banking,it,pharma,auto,fmcg,energy,metals}::valuation`. **But these 10 new cells report `insufficient_history` and still show mock-baseline values as of this write** — NSE has no historical backfill, so each daily refresh adds exactly 1 observation; the 24-observation percentile floor (`percentileMinObservations`) won't be crossed for ~24 days of consecutive refreshes. This is a real, honest gap, not a bug — confirmed via `/api/refresh?sources=nse` on 2026-09-07 (observations stored correctly, `computeAutoScoreCells` correctly returns `status: "insufficient_history"`, `currentSnapshot.ts` correctly leaves the baseline untouched per its own invariant). The other 63 cells still come from the mock baseline. |
| Web dashboard | Done. All 5 surfaces (Allocation, Drivers, Inputs, Parameters, History & Review), all 5 required UI states (cold-start, degraded, extreme, empty-sleeve, healthy). |
| Rubric-picker UI | Done. Declarative specs (`RUBRIC_UI_BY_SCORE_ID`) wired directly to the real scoring functions so UI options can't drift from scoring logic. |
| Persistence API | Done. `POST /api/scores`, `/api/vetoes`, `/api/params` (all validated, all recompute allocation honestly, no silent auto-persist — "looking vs deciding" per §12.5). `POST /api/refresh?sources=fred,bullion,amfi,nse,rbi` (default now includes NSE; RBI still opt-in, ~19s due to headless browser). `POST /api/snapshots` + `GET /api/snapshots` (save/list reviews). |
| Backfill script (`scripts/backfill.ts`) | `backfillFred()` and `backfillAmfi()` both implemented and live-verified — AMFI backfilled 67 monthly observations (2021–2026) across all 12 series, past the 24-observation minimum. This flips `l1.equity::flows`, `l1.debt::flows`, `l1.metals::flows` from stuck-at-50/`insufficient_history` to real percentile-based `auto` scores immediately (confirmed live via `/api/snapshot`), instead of waiting ~2 years for monthly `fetchLatest` to accumulate. Bullion and NSE remain skipped (no historical endpoint / no adapter). RBI is now skipped with an accurate message (its `fetchHistory` only exposes a short trailing window, not a true range — nothing to backfill). |
| Scheduler | Not built. Refresh is manual (button/API call) only. |

**Tests:** 149 passing (77 engine + 72 server) as of last full run, plus 8 skipped-by-default live tests for NSE/AMFI/RBI (network-gated, `RUN_LIVE_TESTS=1`).

## NSE — resolved (partially): a different domain works

`niftyindices.com` (see below) remains genuinely blocked — 4 sessions across this project never cracked its drill-down payload. But session 4 (2026-09-08) found `nseindia.com` (the *main* NSE site, a different domain entirely) exposes `/api/allIndices` with no equivalent Akamai challenge: harvest cookies from a normal page load, then GET the endpoint with those cookies + a browser User-Agent — clean JSON back, no bot-manager fight. This is now the adapter (`packages/server/src/adapters/nse.ts`), live-verified.

**What it covers**: P/E for all 4 broad indices (Nifty 50/100, Midcap 150, Smallcap 250) and 7 of 8 sectors (Banking, IT, Pharma, Auto, FMCG, Energy, Metals — no NSE index matches "Capital Goods", left manual, not guessed). 11 series total, feeding `equity.{large,mid,small}::valuation` and `sector.{7 sectors}::valuation`.

**What it doesn't cover**:
- **No historical range.** Guessed historical-index endpoint names (`/api/historical/generateIndexWiseHistoricalData`, `/api/historical/indicesHistory`) both hit real Akamai 503s with injected bot-manager sensor JS — that stricter protection tier exists on this domain too, just not on `/api/allIndices`. `fetchHistory()` throws by design (same pattern as bullion's metals.dev limitation). **Practical effect**: each daily refresh adds exactly 1 observation to these 11 series; the 24-observation percentile floor won't be crossed for ~24 consecutive days of refreshes, and there's no scheduler yet (see next steps) so this requires either manual daily refresh clicks or building the scheduler first.
- **No TRI (total-return-index) field** anywhere in the payload — only price-return figures. Momentum/`rel_momentum` cells (`l1.equity::momentum`, `sector.*::rel_momentum`) stay unreachable from this source.
- This one endpoint being reachable today isn't a guarantee it stays that way — nseindia.com is a known bot-protected domain in general; `health()` is a real live check, not assumed.

## niftyindices.com — still a dead end, don't retry without new evidence

The original blocker (3 sessions, 2026-09-03 to 2026-09-08), now moot since nseindia.com's `/api/allIndices` covers the P/E need — kept here only so a future attempt at niftyindices.com's fuller TRI/historical data doesn't restart from zero:

- No official API. The old undocumented scraper endpoint (`Backpage.aspx/getpepbHistoricaldataDBtoString`) is dead (redirects to a login page now).
- Real current flow is a 2-step cascade on `niftyindices.com/reports/historical-data`: select index type → POST to `/BackPage/gethistoricaltypeSubindexdata` → (presumably) drill into an index list → submit for the actual P/E/P/B/TRI data.
- **Cookie-transplant works**: harvest Akamai bot-manager cookies (`bm_sv`, `ak_bmsc`) via one real headless-browser navigation, then make subsequent calls with a plain HTTP client (undici) — confirmed live, avoids the flaky in-page JS entirely.
- **Blocker**: the index-list drill-down payload was never captured. `indexgroup` does not branch the response the way assumed (returns the same 4-category list regardless of value tried). The real key/endpoint for "categories → actual index list" is unknown.
- Site has a real, recurring rate limit (~10–15 requests triggers it); space out any future attempts.
- BSE was tried as a substitute and is a dead end (see above) — don't retry without proof BSE's ratio columns are fixed.
- Next step, if resumed (only worth it for TRI/historical data, since P/E is now covered another way): capture a **real human** browser session's full network trace clicking all the way through to a populated dropdown and a submitted report — automated attempts have twice failed to reliably trigger the site's own JS to observe this.

## Immediate next steps (roughly by leverage)

1. ~~Wire AMFI's real `fetchHistory` into `scripts/backfill.ts`~~ — done; live-verified, 3 score cells now real instead of mock-50.
2. ~~NSE adapter~~ — done via `nseindia.com/api/allIndices` (different domain than the original niftyindices.com blocker); 11 series, P/E-based valuation only, live-verified. **But scheduler (below) is now the actual blocker to these cells showing real scores** — no historical backfill exists for NSE, so the 24-observation percentile floor only fills via ~24 daily refreshes, and refresh is still manual-only.
3. **Scheduler** — now the highest-leverage item. Periodic refresh isn't built; currently manual only. Without it, NSE's 11 new cells (and any future latest-only source) can't practically accumulate the history they need — someone would have to remember to click refresh daily for 24 days straight.
4. **Decide on a bullion/IBJA history source** — metals.dev's free tier has no range endpoint; need to pick a supplementary archive (never identified in this project) or accept gold/silver history will always be a live-forward accumulation, no backfill.
5. **niftyindices.com TRI/historical data** — only worth attempting if momentum/rel_momentum cells matter enough to justify another run at the "real human browser network trace" approach; P/E valuation is now covered a different way.
6. **Extend `computeAutoScoreCells`** further — check `pipeline/scoreCells.ts`'s inline comments for which cells are still mock-baseline despite having live source data (e.g. RBI's cpi_yoy/tbill_1y feeding §8.1/§8.2 macro rubrics — the raw series are fetched but the rubric derivation isn't written).
7. **`debt.corporate::carry`** and **`repo_rate`** — no free source found for either; may need to accept these as permanently manual.

## Running it locally

```
cd packages/server && npx tsx src/index.ts       # API on :3001
cd packages/web && npx vite --port 5173 --host   # dashboard on :5173
```

`GET /api/snapshot` and `POST /api/refresh` both route through `packages/server/src/pipeline/currentSnapshot.ts::buildCurrentSnapshot` — this is the single source of truth for "current state" (mock baseline → auto score cells → saved params → manual overrides, manual always wins). Do not reintroduce a second independent "current state" path — that was a real bug fixed earlier (GET and POST had diverged).

## Attribution for commits/PRs from this repo

Commits end with:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mivsf7vyFfCthxFEC56Ncg
```
PR descriptions end with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Mivsf7vyFfCthxFEC56Ncg
```
(Confirm with the user whether a new session means a new link should replace this.)
