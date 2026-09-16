# Wayfinder Dashboard Rebuild Progress Tracker

Tracks implementation of the Wayfinder Dashboard Rebuild MVP plan. Keep this file updated whenever a meaningful decision, implementation step, test result, or blocker changes.

## Source Plan

This tracker follows:

- `docs/multi_asset_dashboard_product_ux_spec.md`
- The user-provided **"Wayfinder Dashboard Rebuild - MVP Implementation Plan"**

The MVP scope is:

- Overview
- Model Explorer
- Data Point Control Center
- Calculation Inspector
- Reviews & Audit

Explicitly deferred:

- Fund Explorer
- CAS import
- Portfolio Diagnosis
- Transition Plan
- Auth/roles
- Scheduler

## Current State

- Dashboard app is running locally.
- Existing surfaces: Allocation, Drivers, Inputs, Parameters, History & Review.
- Backend/data pipeline has active uncommitted changes; do not revert unrelated work.
- Known docs/code drift exists, so implementation should be verified against source code before relying on older notes.
- Current web app is a flat tab dashboard; target is a routed product shell with Overview, Model subroutes, Data Point Control Center, Calculation Inspector, and Reviews & Audit.
- Existing engine/adapters are mature and must not be broken.

## Working Principles

- Preserve core allocation invariants from `HANDOFF.md`.
- `buildCurrentSnapshot` remains the single source of truth for current state.
- Keep provenance visible for every auto/manual/default value.
- Do not add advice language to the UI.
- Missing or failed data must remain neutral/default with honest status, never guessed.
- Prefer focused changes that match existing React/Vite/Tailwind patterns.
- Verify with build/tests and a browser smoke test when UI changes land.
- Work in feature slices: functional/data-model first, then frontend structure, then visual/animation polish.
- Do not block earlier read-side slices on draft/publish semantics from Slice 4.

## Status Legend

- `Todo` - not started.
- `In Progress` - currently being worked.
- `Blocked` - needs a decision, data source, or external condition.
- `Done` - implemented and verified.

## MVP Slices

| Slice | Status | Goal | Notes |
|---|---|---|---|
| Slice 0 - Foundation: routing shell | In Progress | Add React Router and route-based IA without visual regressions. | Routes added: `/overview`, `/model/allocation`, `/model/signals`, `/model/datapoints`, `/model/methodology`, `/reviews`. Dependencies added: `react-router-dom`, `framer-motion`. Needs browser click-through of edit/save/review flows. |
| Slice 1 - Morphing L1/L2 Allocation Bar | In Progress | Build the signature Overview/Detail allocation bar. | Functional pass added: Overview/Detail depth, URL query state, parent rails, click selection, veto glyphs, neutral-delta tooltips, Framer Motion width/layout transitions, reduced-motion fallback, and mobile parent-group detail rows. Inspector linkage and richer keyboard/ARIA polish still pending. |
| Slice 2 - Calculation Inspector | In Progress | Add inspectable causal chain from raw input to final portfolio weight. | Engine now exposes per-signal composite contributions on `TiltNodeResult`; schema accepts new field while defaulting old fixtures to empty rows. First Overview inspector drawer added for node/signal selection with formula, substitution, contribution table, and allocation stages. Needs broader entry points, lineage metadata, before/after draft support, and deeper sector-sleeve lineage. |
| Slice 3 - Data Point Control Center | In Progress | Build data registry with freshness, provenance, ownership, grouping, and impact placeholder. | Added static registry, `GET /api/datapoints`, summary counts, URL-addressable search/grouping/selection, registry list, read-only live impact pane, and explicit per-source refresh with post-refresh registry reload. Still needs manual-update actions, richer source cadence semantics, and draft preview/publish integration. |
| Slice 4 - Draft/Publish + Reviews & Audit | In Progress | Add draft/publish semantics, immutable versions, diffs, audit, and live impact sidebar. | Added additive schema fields for manual audit metadata and snapshot versioning (`parent_id`, `published`, `actor`), publish route, changed-input diff summary, published/review timeline badges, and publish action in Reviews. Added explicit `/api/snapshot/draft` and `/api/snapshot/published`; Overview reads published first and falls back to draft if no published version exists. Added `/api/snapshots/draft-status`, nav unpublished-change badge, Reviews draft impact summary, and a shared draft-status banner on Model routes. Still needs full draft isolation for edits and reason/expiry UI on manual edits. |

## Cross-Cutting Decisions

| Decision | Status | Notes |
|---|---|---|
| Add React Router in Slice 0 | Accepted | URL-addressable IA is foundational and should not be retrofitted later. |
| Add Framer Motion in Slice 0 | Accepted | Cheap dependency; only used once Slice 1 polish begins. |
| Data-point registry is static TS, not DB table | Accepted | Design-time metadata keyed by score ID, joined with live state at query time. |
| Scheduler deferred | Accepted | Freshness copy must be honest: time since manual refresh, not true SLA tracking. |
| Auth/roles deferred | Accepted | Single-user tool; use static actor string for audit records later. |

## Current UI Audit

| Area | Current Shape | Product Gap | Likely Next Move |
|---|---|---|---|
| Navigation | Five top-level tabs plus a visible fixture switcher. | Reads like a developer harness; no product-level status, refresh, or review context in the chrome. | Separate product navigation from dev fixtures; add current snapshot/freshness/review status affordances. |
| Allocation | Narrow page with state summary, cold-start banner, allocation bar, and simple table. | Shows the answer, but not enough context for a decision review. | Add decision cockpit: current weights, deltas vs neutral/review, major constraints, freshness, and sector sleeve state. |
| Drivers | Composite bars, attribution vs review, sensitivity list. | Good ingredients but low scan hierarchy; explanations are terse and score-key oriented. | Promote the top drivers, show score provenance/status, and group sensitivity by sleeve/node. |
| Inputs | All 85 scores grouped by provenance and sorted by impact. | Powerful but raw; score IDs dominate, manual/rubric workflows need more review safety. | Add search/filter, readable labels, stale/default callouts, manual edit affordances, and clearer unsaved state. |
| Parameters | Local parameter preview, save/reset, weight editors, neutral unlock, fragility test. | Useful admin surface, but dense and risky; policy edits need stronger guardrails. | Split policy vs tuning, show before/after allocation impact, and make normalization/fragility easier to interpret. |
| History & Review | Save review plus list of reviews and raw series distribution table. | Review workflow is underdeveloped; distribution table is useful but buried and not triaged. | Make reviews comparable, expose audit trail, and create a dedicated data health/freshness section. |
| Visual System | Tailwind, neutral palette, small cards/tables, simple bars. | Clean but skeletal; density and hierarchy need product polish without becoming decorative. | Establish dashboard primitives: page header, status chips, metric rows, compact panels, data tables, and empty/error states. |

## Immediate Backlog

1. Browser-smoke `/overview` with live snapshot and the fixture states.
2. Browser-smoke new route map: `/model/allocation`, `/model/signals`, `/model/datapoints`, `/model/methodology`, `/reviews`.
3. Decide whether the dev fixture switcher stays visible during MVP work or moves behind a dev-only affordance.
4. Continue Slice 1 polish: keyboard-focused segment navigation, richer aria labels, and final visual comparison against spec proportions.
5. Continue draft isolation: make manual score/veto/param edits visibly draft-only with live impact before publish.

## Slice Verification Checklist

| Slice | Required Verification |
|---|---|
| Slice 0 | App loads at every target route; existing score edit, parameter edit, refresh, and review save flows still work. |
| Slice 1 | L1/L2 widths reconcile with real allocation totals; L2 rollup matches `Allocation.rollup`; keyboard navigation and aria labels work; mobile behavior matches parent-first decomposition. |
| Slice 2 | Contribution rows sum exactly to displayed composite; engine tests pass; all-50 identity still produces neutral weights. |
| Slice 3 | Registry summary counts reconcile with rows; spot-check all five data-point types; freshness states match documented semantics. |
| Slice 4 | Manual edit creates unpublished draft impact; publish creates immutable snapshot/version; audit row includes actor/reason/timestamp; published/draft behavior matches plan. |

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-09-15 | Created this tracker in `docs/DASHBOARD_PROGRESS.md`. | The dashboard overhaul is large enough to need explicit progress tracking. |
| 2026-09-15 | Treat the next phase as a dense product dashboard overhaul, not a marketing redesign. | The tool is a decision-support cockpit for repeated analytical review. |
| 2026-09-15 | Keep the first implementation batches small and surface-led. | There are active backend changes and several interconnected UI surfaces. |
| 2026-09-15 | Rebased tracker on the user-provided MVP implementation plan. | The actual plan is slice-based and more specific than the initial repo-doc audit. |

## Change Log

| Date | Change | Verification |
|---|---|---|
| 2026-09-15 | Added dashboard progress tracker. | Not run; documentation-only change. |
| 2026-09-15 | Added first current UI audit and updated workstream statuses. | Read current web views/components; documentation-only change. |
| 2026-09-15 | Updated tracker to follow Slices 0-4 from the actual Dashboard Rebuild MVP plan. | Documentation-only change. |
| 2026-09-15 | Added route-based shell, initial `/overview` page, and functional Overview/Detail allocation bar pass. | `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added Framer Motion transitions, reduced-motion behavior, and mobile parent-group detail rows to the allocation bar. | `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added composite contribution rows to engine allocation output and first Calculation Inspector drawer on Overview. | `pnpm --filter @wayfinder/engine test` passed; `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added Data Point Control Center backend registry/API and first three-pane frontend page. | `pnpm --filter @wayfinder/server typecheck` passed; `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added first Reviews & Audit publish/versioning foundation. | `pnpm --filter @wayfinder/server test` passed; `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added explicit draft/published snapshot endpoints and migrated Overview to published-first loading with draft fallback. | `pnpm --filter @wayfinder/server test` passed; `pnpm --filter @wayfinder/web build` passed. |
| 2026-09-15 | Added draft-status endpoint plus nav badge and Reviews draft impact summary. | `pnpm --filter @wayfinder/server test` passed; `pnpm --filter @wayfinder/web build` passed; API server restarted and `/api/snapshots/draft-status` returned 200. |
| 2026-09-15 | Added shared unpublished-draft banner to Model routes with a direct Reviews link. | `pnpm --filter @wayfinder/web build` passed; live draft-status endpoint returned 200. |
| 2026-09-15 | Enabled explicit per-source refresh in the Data Point Control Center, including all-source option, loading/error state, and registry reload. | `pnpm --filter @wayfinder/web build` passed; live `GET /api/datapoints` returned 200 with 109 rows. |

## Open Questions

- Should fixture switching remain visible in the product UI, move behind a dev flag, or be removed from normal use?
- Should `/model/datapoints` be implemented first as the Slice 3 Data Point Control Center route, while existing `InputsView` temporarily lives at `/model/signals`?
- For Slice 4, should `GET /api/snapshot` switch to published-only exactly as the plan says, or should there be separate draft/published endpoints to preserve current editing behavior during migration?
