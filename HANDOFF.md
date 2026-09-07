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
| AMFI adapter | Done, live-verified. `fetchHistory(from, to)` genuinely supports arbitrary date ranges (predictable monthly PDF URL pattern), verified back to ~2016. Not yet wired into `scripts/backfill.ts`. |
| RBI adapter | Partial. Headless-browser scrape of an RBI data mirror (AG Grid pagination). Covers `cpi_index`, `cpi_yoy`, `tbill_1y` (183–364 day bucket). `fetchHistory()` only returns whatever trailing window the mirror displays (~15 months for CPI) — **not** a true long-range backfill. `gsec_10y` intentionally sourced from FRED instead (RBI mirror's own "yield" page turned out to be a price/turnover index). `repo_rate` confirmed absent from the mirror's ~350-page catalog — no source found anywhere free. |
| NSE adapter | **Not implemented.** See "NSE — open problem" below. Blocks ~19 score cells (equity/sector valuation and momentum). |
| BSE (investigated as NSE substitute) | Built, live-tested, then **reverted**. Its P/E/P/B/yield columns are identical across unrelated indices for the same period — broken on BSE's own backend, not a client bug. Do not retry without new evidence it's fixed. |
| Score derivation pipeline (`pipeline/scoreCells.ts`) | 12 of 85 cells computed from real fetched data: `l1.equity::flows`, `l1.debt::flows`, `l1.metals::flows` (flow/AUM ratios), `metals.gold::ratio_position`, `metals.silver::ratio_position` (gold/silver ratio), `l1.metals::momentum` (approximation), `metals.gold::real_rates`, `metals.silver::real_rates`, `l1.metals::macro` (§8.4 rubric), `l1.debt::valuation` (gsec_10y − cpi_yoy), `debt.gilt::carry`, `debt.liquid::carry`. The other 73 cells still come from the mock baseline. |
| Web dashboard | Done. All 5 surfaces (Allocation, Drivers, Inputs, Parameters, History & Review), all 5 required UI states (cold-start, degraded, extreme, empty-sleeve, healthy). |
| Rubric-picker UI | Done. Declarative specs (`RUBRIC_UI_BY_SCORE_ID`) wired directly to the real scoring functions so UI options can't drift from scoring logic. |
| Persistence API | Done. `POST /api/scores`, `/api/vetoes`, `/api/params` (all validated, all recompute allocation honestly, no silent auto-persist — "looking vs deciding" per §12.5). `POST /api/refresh?sources=fred,bullion,amfi,rbi` (RBI opt-in, ~19s due to headless browser). `POST /api/snapshots` + `GET /api/snapshots` (save/list reviews). |
| Backfill script (`scripts/backfill.ts`) | `backfillFred()` and `backfillAmfi()` both implemented and live-verified — AMFI backfilled 67 monthly observations (2021–2026) across all 12 series, past the 24-observation minimum. This flips `l1.equity::flows`, `l1.debt::flows`, `l1.metals::flows` from stuck-at-50/`insufficient_history` to real percentile-based `auto` scores immediately (confirmed live via `/api/snapshot`), instead of waiting ~2 years for monthly `fetchLatest` to accumulate. Bullion and NSE remain skipped (no historical endpoint / no adapter). RBI is now skipped with an accurate message (its `fetchHistory` only exposes a short trailing window, not a true range — nothing to backfill). |
| Scheduler | Not built. Refresh is manual (button/API call) only. |

**Tests:** 147 passing (77 engine + 70 server) as of last full run.

## NSE — the open problem

No working adapter. Investigated across 3 sessions, documented in full inline in `packages/server/src/adapters/nse.ts` (read this file before attempting again — it has exact payloads tried, exact failure modes, and explicit "don't retry this" notes). Summary:

- No official API. The old undocumented scraper endpoint (`Backpage.aspx/getpepbHistoricaldataDBtoString`) is dead (redirects to a login page now).
- Real current flow is a 2-step cascade on `niftyindices.com/reports/historical-data`: select index type → POST to `/BackPage/gethistoricaltypeSubindexdata` → (presumably) drill into an index list → submit for the actual P/E/P/B/TRI data.
- **Cookie-transplant works**: harvest Akamai bot-manager cookies (`bm_sv`, `ak_bmsc`) via one real headless-browser navigation, then make subsequent calls with a plain HTTP client (undici) — confirmed live, avoids the flaky in-page JS entirely.
- **Blocker**: the index-list drill-down payload was never captured. `indexgroup` does not branch the response the way assumed (returns the same 4-category list regardless of value tried). The real key/endpoint for "categories → actual index list" is unknown.
- Site has a real, recurring rate limit (~10–15 requests triggers it); space out any future attempts.
- BSE was tried as a substitute and is a dead end (see above) — don't retry without proof BSE's ratio columns are fixed.
- Next step, if resumed: capture a **real human** browser session's full network trace clicking all the way through to a populated dropdown and a submitted report — automated attempts have twice failed to reliably trigger the site's own JS to observe this.

## Immediate next steps (roughly by leverage)

1. ~~Wire AMFI's real `fetchHistory` into `scripts/backfill.ts`~~ — done; live-verified, 3 score cells now real instead of mock-50.
2. **Decide on a bullion/IBJA history source** — metals.dev's free tier has no range endpoint; need to pick a supplementary archive (never identified in this project) or accept gold/silver history will always be a live-forward accumulation, no backfill.
3. **NSE** — either attempt the "real human browser network trace" next step above, or accept NSE-derived cells stay manual indefinitely and design the Inputs UI around that being a permanent state, not a temporary gap.
4. **Extend `computeAutoScoreCells`** — several more cells are derivable from series adapters *already fetch* but pipeline logic hasn't been written for yet (check `pipeline/scoreCells.ts`'s inline comments for exactly which ones are still mock-baseline despite having live source data).
5. **Scheduler** — periodic refresh isn't built; currently manual only.
6. **`debt.corporate::carry`** and **`repo_rate`** — no free source found for either; may need to accept these as permanently manual.

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
