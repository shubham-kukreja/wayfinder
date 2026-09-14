# Wayfinder — Handoff

Multi-asset portfolio allocation dashboard for the Indian market, replacing a Google Sheet. TypeScript pnpm monorepo: `packages/engine` (pure compute, shared client/server), `packages/server` (Fastify + SQLite), `packages/web` (React/Vite/Tailwind).

Repo: `https://github.com/shubham-kukreja/wayfinder.git`, branch `develop` (do not push to `main`). 22 commits at time of writing; working tree has uncommitted changes in progress (new adapters + pipeline wiring from the 2026-09-15 data-sources session) — run `git status` for current state, don't trust a commit count recorded here.

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
| NSE adapter | **Implemented, live-verified — different domain than the original blocker.** `nseindia.com/api/allIndices` (cookie-harvest + plain fetch, no Akamai challenge on this endpoint) returns P/E/P/B/dividend-yield for 139 indices; covers all 4 broad indices + 7 of 8 sectors (no NSE index matches "Capital Goods" — that gap is now filled by niftyindices.com instead, see below). **Latest-only from NSE itself**: no historical index-level endpoint found on this domain (guessed paths hit real Akamai 503s) — `fetchHistory()` throws by design, same limitation as bullion. No TRI field either. See "NSE — resolved (partially)" below. |
| niftyindices.com adapter (`adapters/niftyindices.ts`) | **Implemented 2026-09-15, live-verified — the original niftyindices.com blocker is resolved via a different, simpler endpoint than the one 4 sessions chased.** The Daily Snapshot CSV (`/Daily_Snapshot/ind_close_all_DDMMYYYY.csv`) has a real "Nifty Capital Goods" row with P/E/P/B/Div Yield and real historical closing-price backfill (back to at least 2021) — fixes the Capital Goods gap (8/8 sectors now covered) and feeds an approximated Nifty 50 TRI 12M return for `l1.equity::momentum` (`deriveNiftyMomentumSeries()` in `pipeline/derive.ts`). The original blocker (the 2-step drill-down cascade on `/reports/historical-data`) remains genuinely unresolved — kept as "still a dead end" below, but is now moot for P/E purposes since this CSV covers it a different way. |
| BSE (investigated as NSE substitute) | Built, live-tested, then **reverted**. Its P/E/P/B/yield columns are identical across unrelated indices for the same period — broken on BSE's own backend, not a client bug. Do not retry without new evidence it's fixed. |
| CCIL adapter (`adapters/ccil.ts`) | Implemented 2026-09-15. Headless-browser (Playwright) scrape of `ccilindia.com/tenorwise-indicative-yields` — a real HTML table once rendered, no JSON/CSV export. Writes to the same `tbill_1y` series the RBI mirror already populates (a more precise 364D-security yield vs. RBI's interpolated 183–364 day bucket average); "latest `fetched_at` wins" so whichever adapter ran most recently is served. Opt-in via `?sources=ccil` (headless-browser cost). Kept at ⚠️ Proxy, not upgraded to Live — a 364-day bill still isn't an exact 365-day tenor, a real-world fact, not an adapter limitation. |
| RBI repo rate adapter (`adapters/rbiRepoRate.ts`) | Implemented 2026-09-15. `repo_rate` was confirmed absent from the DBIE mirror's catalog — instead scrapes RBI's own homepage's plain server-rendered "Policy Rates" accordion table (no JS/auth/Cloudflare). Current-value only, `fetchHistory()` throws by design. In the **default** refresh set (fast, single request). No score-cell consumer yet — `debtMacroScore`'s `rbiPath` input is a qualitative forward-looking bucket, not a raw level reading, so this is fetched/stored but not rubric-wired. |
| TradingEconomics adapter (`adapters/tradingEconomics.ts`) | Implemented 2026-09-15. Scrapes the headline PMI figure from a plain unauthenticated `<meta name="description">` tag on `tradingeconomics.com/china/manufacturing-pmi` (China used as the `global_mfg_pmi` proxy per explicit project direction — China is the dominant driver of the exact industrial-demand signal `silverIndustrialScore` targets). No historical range; `fetchHistory()` throws by design. Opt-in via `?sources=tradingeconomics`. **Known bug**: `fetchLatest()` stamps the observation with the current calendar year unconditionally — if the site is showing December's PMI while the fetch runs in January, the observation gets mis-dated into the wrong year. Not yet fixed. |
| Yahoo Finance adapter (`adapters/yahoo.ts`) | Implemented 2026-09-15. S&P 500 forward P/E via aggregation: Wikipedia's constituent list (HTML table scrape) + Yahoo's unofficial `v7/finance/quote` batch endpoint (crumb+cookie handshake, ~2 requests for ~501 tickers) for per-ticker forwardPE+marketCap, combined as a weighted-harmonic-mean P/E. Also powers the gold ETF holdings trend (GLD+IAU combined `sharesOutstanding`, same crumb flow) — trend derivation built (`goldEtfHoldingsTrend()`) but not yet wired into a score cell (needs `cbBuying` too, see dbnomics.ts below). Undocumented API, no SLA. Opt-in via `?sources=yahoo` (not in default set — slower). |
| Yahoo Metals adapter (`adapters/yahooMetals.ts`) | Implemented 2026-09-15. COMEX GC=F/SI=F futures via Yahoo's `v8/finance/chart` (no auth needed, unlike the quote endpoint above) — real historical daily data, unlike bullion.ts's latest-only IBJA feed. `metals.gold/silver::ratio_position` now prefers this futures pair once it clears the percentile-history floor, falling back to `gold_inr`/`silver_inr` otherwise. Opt-in via `?sources=yahoo_metals`. |
| DBnomics adapter (`adapters/dbnomics.ts`) | Implemented 2026-09-15. Free mirror (db.nomics.world) of IMF International Financial Statistics, no key/Cloudflare — used after World Gold Council's own Goldhub Excel was confirmed Cloudflare-blocked (403). Fetches global official gold reserves (`cb_gold_reserves_tonnes`, 829 monthly observations back to 1950). `centralBankGoldBuyingTrend()` (`pipeline/derive.ts`) derives the above/below-5Y-average bucket. `l1.metals::fundamentals` is now wired end-to-end in `scoreCells.ts` (combines this with the Yahoo-derived ETF holdings trend, only computed when both halves succeed). Opt-in via `?sources=dbnomics`. |
| Score derivation pipeline (`pipeline/scoreCells.ts`) | Substantially more cells now wired than the original 12 + 10 NSE cells described in earlier handoffs — current live-wired cells include the original 12, 10 NSE valuation cells, plus `sector.capgoods::valuation` (niftyindices.com), `l1.equity::momentum` (niftyindices.com approximation), and `l1.metals::fundamentals` (dbnomics.ts + yahoo.ts). NSE's own 11 series remain latest-only (no historical endpoint on that domain) — each daily refresh adds exactly 1 observation, so the 24-observation percentile floor takes ~24 consecutive days of refreshes to clear without a scheduler. Check `docs/DATA_SOURCES.md` for the authoritative, per-series up-to-date status — it is the source of truth for "is X actually live," this table is a snapshot. |
| Web dashboard | Done. All 5 surfaces (Allocation, Drivers, Inputs, Parameters, History & Review), all 5 required UI states (cold-start, degraded, extreme, empty-sleeve, healthy). |
| Rubric-picker UI | Done. Declarative specs (`RUBRIC_UI_BY_SCORE_ID`) wired directly to the real scoring functions so UI options can't drift from scoring logic. |
| Persistence API | Done. `POST /api/scores`, `/api/vetoes`, `/api/params` (all validated, all recompute allocation honestly, no silent auto-persist — "looking vs deciding" per §12.5). `POST /api/refresh?sources=...` — default set is `fred,bullion,amfi,nse,rbi_homepage`; `rbi` (DBIE/CPI), `ccil`, and `yahoo`/`yahoo_metals`/`dbnomics`/`tradingeconomics` remain opt-in (headless-browser cost or slower multi-request patterns). `POST /api/snapshots` + `GET /api/snapshots` (save/list reviews). |
| Backfill script (`scripts/backfill.ts`) | `backfillFred()` and `backfillAmfi()` both implemented and live-verified — AMFI backfilled 67 monthly observations (2021–2026) across all 12 series, past the 24-observation minimum. This flips `l1.equity::flows`, `l1.debt::flows`, `l1.metals::flows` from stuck-at-50/`insufficient_history` to real percentile-based `auto` scores immediately (confirmed live via `/api/snapshot`), instead of waiting ~2 years for monthly `fetchLatest` to accumulate. Bullion and NSE remain skipped (no historical endpoint / no adapter). RBI is now skipped with an accurate message (its `fetchHistory` only exposes a short trailing window, not a true range — nothing to backfill). |
| Scheduler | Not built. Refresh is manual (button/API call) only. |

**Tests:** See `docs/DATA_SOURCES.md` and each adapter's test file for current counts — several new adapters (niftyindices, ccil, rbiRepoRate, tradingEconomics, yahoo, yahooMetals, dbnomics) were added 2026-09-15 with their own unit + live (network-gated, `RUN_LIVE_TESTS=1`) test files; run `pnpm test` for the authoritative current total rather than trusting a number recorded here.

## NSE — resolved (partially): a different domain works

`niftyindices.com` (see below) remains genuinely blocked — 4 sessions across this project never cracked its drill-down payload. But session 4 (2026-09-08) found `nseindia.com` (the *main* NSE site, a different domain entirely) exposes `/api/allIndices` with no equivalent Akamai challenge: harvest cookies from a normal page load, then GET the endpoint with those cookies + a browser User-Agent — clean JSON back, no bot-manager fight. This is now the adapter (`packages/server/src/adapters/nse.ts`), live-verified.

**What it covers**: P/E/P/B/dividend-yield for all 4 broad indices (Nifty 50/100, Midcap 150, Smallcap 250) and 7 of 8 sectors (Banking, IT, Pharma, Auto, FMCG, Energy, Metals — no NSE index matches "Capital Goods"). The 8th sector (Capital Goods) is now covered too, via the separate niftyindices.com Daily Snapshot CSV adapter (see below) writing to the same `sector_pe_*` series names.

**What it doesn't cover from this domain specifically**:
- **No historical range on `nseindia.com` itself.** Guessed historical-index endpoint names (`/api/historical/generateIndexWiseHistoricalData`, `/api/historical/indicesHistory`) both hit real Akamai 503s with injected bot-manager sensor JS — that stricter protection tier exists on this domain too, just not on `/api/allIndices`. `fetchHistory()` throws by design (same pattern as bullion's metals.dev limitation). **Practical effect**: each daily refresh adds exactly 1 observation to these 11 NSE-only series; the 24-observation percentile floor won't be crossed for ~24 consecutive days of refreshes without a scheduler (see next steps).
- **No TRI (total-return-index) field** anywhere in the NSE payload — only price-return figures. This is why `l1.equity::momentum` is instead approximated via the niftyindices.com Daily Snapshot CSV (see next section), not this adapter.
- This one endpoint being reachable today isn't a guarantee it stays that way — nseindia.com is a known bot-protected domain in general; `health()` is a real live check, not assumed.

## niftyindices.com — resolved via a different endpoint (2026-09-15); original drill-down blocker still open

The Daily Snapshot CSV (`niftyindices.com/Daily_Snapshot/ind_close_all_DDMMYYYY.csv`, `adapters/niftyindices.ts`) is a **directly-constructible, unauthenticated daily URL** — a completely different, much simpler path than the drill-down cascade 4 sessions chased on `/reports/historical-data`. It has a real "Nifty Capital Goods" row (P/E/P/B/Div Yield) fixing the last sector gap, plus real historical closing-price history per index (confirmed live back to at least 2021) — used to build a Nifty 50 TRI-approximation 12M return for `l1.equity::momentum` (`deriveNiftyMomentumSeries()` in `pipeline/derive.ts`; price-return + trailing dividend yield, **not** an exact TRI — will diverge from AMFI's real published TRI 1Y return whenever yield itself moved materially over the window; see `docs/DATA_SOURCES.md` for the full honesty note). Its CSV column parsing is currently **positional** (fixed column indices, not header-name lookup) — a real fragility flagged in review 2026-09-15, not yet fixed: a future column reorder on niftyindices.com's end would silently write wrong values rather than fail loudly.

The **original** blocker (3 sessions, 2026-09-03 to 2026-09-08, the `/reports/historical-data` 2-step drill-down cascade) remains genuinely unresolved — kept here only so a future attempt at that fuller TRI/historical drill-down data doesn't restart from zero. It's lower priority now since both the P/E gap and an (approximate) momentum signal are covered a different way:

- No official API. The old undocumented scraper endpoint (`Backpage.aspx/getpepbHistoricaldataDBtoString`) is dead (redirects to a login page now).
- Real current flow is a 2-step cascade on `niftyindices.com/reports/historical-data`: select index type → POST to `/BackPage/gethistoricaltypeSubindexdata` → (presumably) drill into an index list → submit for the actual P/E/P/B/TRI data.
- **Cookie-transplant works**: harvest Akamai bot-manager cookies (`bm_sv`, `ak_bmsc`) via one real headless-browser navigation, then make subsequent calls with a plain HTTP client (undici) — confirmed live, avoids the flaky in-page JS entirely.
- **Blocker**: the index-list drill-down payload was never captured. `indexgroup` does not branch the response the way assumed (returns the same 4-category list regardless of value tried). The real key/endpoint for "categories → actual index list" is unknown.
- Site has a real, recurring rate limit (~10–15 requests triggers it); space out any future attempts.
- BSE was tried as a substitute and is a dead end (see above) — don't retry without proof BSE's ratio columns are fixed.
- Next step, if resumed (only worth it for TRI/historical data, since P/E is now covered another way): capture a **real human** browser session's full network trace clicking all the way through to a populated dropdown and a submitted report — automated attempts have twice failed to reliably trigger the site's own JS to observe this.

## Immediate next steps (roughly by leverage)

1. ~~Wire AMFI's real `fetchHistory` into `scripts/backfill.ts`~~ — done; live-verified, 3 score cells now real instead of mock-50.
2. ~~NSE adapter~~ — done via `nseindia.com/api/allIndices`; 11 series, P/E-based valuation only, live-verified.
3. ~~Capital Goods sector gap + equity momentum approximation~~ — done 2026-09-15 via the niftyindices.com Daily Snapshot CSV adapter (`adapters/niftyindices.ts`).
4. **Fix `tradingEconomics.ts` year-stamping bug** (found in review 2026-09-15, not yet fixed): `fetchLatest()` stamps the PMI observation with the current calendar year unconditionally — if the site shows December's PMI while the fetch runs in January, the observation is mis-dated into the wrong year. Small fix, real correctness bug.
5. **Fix `niftyindices.ts`'s positional CSV parsing** (found in review 2026-09-15, not yet fixed): reads columns by fixed index rather than by header name, despite checking the header line exists. Correct against today's fixture but has no defense against niftyindices.com reordering columns — would silently write wrong valuation-feeding data instead of failing loudly.
6. **Scheduler** — still the highest-leverage structural item. Periodic refresh isn't built; currently manual only. Without it, NSE's 11 latest-only cells (and any other latest-only source) can't practically accumulate the ~24-observation history their percentile floor needs — someone has to remember to click refresh daily for 24 days straight.
7. **Decide on a bullion/IBJA history source** — metals.dev's free tier has no range endpoint; the Yahoo Finance futures pair (`gold_usd_futures`/`silver_usd_futures`) now covers the ratio-position score cell as a same-signal substitute, but IBJA's actual INR spot price (`gold_inr`/`silver_inr`) still has no historical backfill.
8. **niftyindices.com's original drill-down (TRI/full historical data)** — only worth attempting if the momentum approximation's honesty caveat (see above) turns out to matter enough in practice; P/E valuation and an approximate momentum signal are now both covered a different way.
9. **Extend `computeAutoScoreCells`** further — check `pipeline/scoreCells.ts`'s inline comments for cells still mock-baseline despite having live source data (e.g. RBI repo rate and CPI feeding macro rubrics qualitatively — raw series fetched but rubric derivation not written for `rbiPath`-style bucketed inputs; sector 6M/12M relative price return, raw price history exists via niftyindices.ts but the return calc + score-cell wiring is separate follow-up).
10. **`debt.corporate::carry`**, category-average YTM (liquid/corporate/gilt funds), and banking-system liquidity surplus/deficit — no free source found for any of these after multiple rounds of investigation; likely permanently manual. See `docs/DATA_SOURCES.md` for the full trail of what was checked and ruled out.

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
