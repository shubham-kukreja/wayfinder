export type SurfaceId = "allocation" | "drivers" | "inputs" | "parameters" | "history";

export const SURFACES: Array<{ id: SurfaceId; label: string }> = [
  { id: "allocation", label: "Allocation" },
  { id: "drivers", label: "Drivers" },
  { id: "inputs", label: "Inputs" },
  { id: "parameters", label: "Parameters" },
  { id: "history", label: "History & Review" },
];

export const PRIMARY_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/overview", label: "Overview" },
  { path: "/methodology", label: "Methodology" },
  { path: "/reviews", label: "Reviews" },
];

export const MODEL_ROUTES: Array<{ path: string; label: string }> = [
  { path: "/model/signals", label: "Signals" },
  { path: "/model/datapoints", label: "Data Points" },
  { path: "/model/parameters", label: "Parameters" },
];

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
