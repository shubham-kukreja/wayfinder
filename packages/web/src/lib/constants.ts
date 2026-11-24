// Navigation follows the system's real fault line: the published snapshot
// Overview reads, the draft every model surface edits, and the gate between
// them. Grouping by that means each heading is one sentence — what you act
// on, what you tune, how tuning becomes acting — rather than a bag labelled
// "Workspace" holding the answer, the docs and the publish gate at once.
export const ALLOCATION_ROUTES: Array<{ path: string; label: string }> = [{ path: "/overview", label: "Overview" }];

// Fund research, served by core-jobs-service (/v1) rather than the legacy
// server: category rankings of mutual funds from the fund-scoring model.
export const FUNDS_ROUTES: Array<{ path: string; label: string }> = [{ path: "/funds", label: "Fund Rankings" }];

// Its own group, not folded into Allocation: this isn't a state of the
// published/draft model, it's a separate workspace with its own queue of
// runs — a "what you're testing" surface, distinct from "what you hold"
// (Allocation) or "what you're tuning" (Model).
export const BACKTESTING_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/backtest/new", label: "New Run" },
  { path: "/backtest/runs", label: "Run History" },
];

export const MODEL_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/model/signals", label: "Signals" },
  { path: "/model/datapoints", label: "Data Points" },
  // Parameters and Analyst Inputs merged into one "Overrides" surface: both
  // were "edit a draft, preview it live, save explicitly" pages against the
  // same allocation engine, just split by input type (weights/caps vs.
  // scores) — that split is now a tab inside the page, not a separate route.
  { path: "/model/overrides", label: "Overrides" },
];

// The three governance surfaces are separate routes rather than tabs: they
// serve different readers on different days — deciding now, reconstructing a
// past decision, and checking what is due — so each deserves its own URL.
export const GOVERNANCE_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/reviews/decide", label: "Compare & Publish" },
  { path: "/reviews/history", label: "History" },
  { path: "/reviews/cadence", label: "Cadence" },
];

// A single flat link, not a collapsible group: there is only one Notes
// surface today (the list, which opens into a note), so a group header
// whose only child repeats its own label ("Notes ▾ / Notes") would just be
// a wrapper around itself. Revisit if a second Notes-area page (e.g. a
// per-entity notes view) is ever added.
export const NOTES_ROUTE: { path: string; label: string } = { path: "/notes", label: "Notes" };

// Reference material, deliberately outside the groups: Methodology is the
// one page that never changes with the data, so it is not a state of the
// model the way the grouped surfaces are.
export const REFERENCE_ROUTES: Array<{ path: string; label: string }> = [{ path: "/methodology", label: "Methodology" }];


// Dev-only fixture switcher. The live server only serves the healthy
// snapshot so far (GET /api/snapshot — see routes/snapshot.ts), so the
// mock fixtures remain how the other four required states (§12.4) are
// reached and demoed until the server can produce them itself.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
export const CURRENT_SNAPSHOT_URL = `${API_BASE_URL}/api/snapshot`;
export const DRAFT_SNAPSHOT_URL = `${API_BASE_URL}/api/snapshot/draft`;
export const PUBLISHED_SNAPSHOT_URL = `${API_BASE_URL}/api/snapshot/published`;

export const FIXTURES: Array<{ id: string; label: string; url: string }> = [
  { id: "live", label: "Live draft", url: CURRENT_SNAPSHOT_URL },
  { id: "published", label: "Published", url: PUBLISHED_SNAPSHOT_URL },
  { id: "healthy", label: "Healthy (mock)", url: "/snapshot.json" },
  { id: "degraded", label: "Degraded (mock)", url: "/snapshot-degraded.json" },
  { id: "cold-start", label: "Cold start (mock)", url: "/snapshot-cold-start.json" },
  { id: "extreme", label: "Extreme (mock)", url: "/snapshot-extreme.json" },
  { id: "empty-sleeve", label: "Empty sleeve (mock)", url: "/snapshot-empty-sleeve.json" },
];
