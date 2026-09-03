export type SurfaceId = "allocation" | "drivers" | "inputs" | "parameters" | "history";

export const SURFACES: Array<{ id: SurfaceId; label: string }> = [
  { id: "allocation", label: "Allocation" },
  { id: "drivers", label: "Drivers" },
  { id: "inputs", label: "Inputs" },
  { id: "parameters", label: "Parameters" },
  { id: "history", label: "History & Review" },
];

// Dev-only fixture switcher — until the server exists, this is how every
// one of the five required states (§12.4) is reached and demoed.
export const FIXTURES: Array<{ id: string; label: string; url: string }> = [
  { id: "healthy", label: "Healthy", url: "/snapshot.json" },
  { id: "degraded", label: "Degraded", url: "/snapshot-degraded.json" },
  { id: "cold-start", label: "Cold start", url: "/snapshot-cold-start.json" },
  { id: "extreme", label: "Extreme", url: "/snapshot-extreme.json" },
  { id: "empty-sleeve", label: "Empty sleeve", url: "/snapshot-empty-sleeve.json" },
];
