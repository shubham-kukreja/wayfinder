export type SurfaceId = "allocation" | "drivers" | "inputs" | "parameters" | "history";

export const SURFACES: Array<{ id: SurfaceId; label: string }> = [
  { id: "allocation", label: "Allocation" },
  { id: "drivers", label: "Drivers" },
  { id: "inputs", label: "Inputs" },
  { id: "parameters", label: "Parameters" },
  { id: "history", label: "History & Review" },
];

// Dev-only fixture switcher. The live server only serves the healthy
// snapshot so far (GET /api/snapshot — see routes/snapshot.ts), so the
// mock fixtures remain how the other four required states (§12.4) are
// reached and demoed until the server can produce them itself.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export const FIXTURES: Array<{ id: string; label: string; url: string }> = [
  { id: "live", label: "Live server", url: `${API_BASE_URL}/api/snapshot` },
  { id: "healthy", label: "Healthy (mock)", url: "/snapshot.json" },
  { id: "degraded", label: "Degraded (mock)", url: "/snapshot-degraded.json" },
  { id: "cold-start", label: "Cold start (mock)", url: "/snapshot-cold-start.json" },
  { id: "extreme", label: "Extreme (mock)", url: "/snapshot-extreme.json" },
  { id: "empty-sleeve", label: "Empty sleeve (mock)", url: "/snapshot-empty-sleeve.json" },
];
