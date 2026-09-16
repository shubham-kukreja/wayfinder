import type { HealthStatus, Observation, SourceAdapter } from "./types.js";

// debt.corporate::carry needs a 3Y AAA Corporate Bond yield series (aaa_3y).
// Both candidate free sources are confirmed dead ends as of 2026-09-15
// (docs/DATA_SOURCES.md): FIMMDA redirects to fbil.org.in, a JS-only Angular
// SPA with no discovered API; FIMMDA's direct download links are stale
// 2017/2020 samples. This adapter is registered so aaa_3y surfaces honestly
// as failed/missing in the Data Points Control Center (never silently
// absent, never a fake number) — every method fails by design.
export const AAA_3Y_SERIES_ID = "aaa_3y";

export class Aaa3yUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Aaa3yUnavailableError";
  }
}

const NO_SOURCE_MESSAGE =
  "No live source for aaa_3y: FIMMDA redirects to fbil.org.in (JS-only Angular SPA, " +
  "no discovered API); FIMMDA's own download links are stale 2017/2020 samples. " +
  "See docs/DATA_SOURCES.md.";

export function createAaa3yAdapter(): SourceAdapter {
  return {
    id: "AAA3Y_MOCK",
    series: [AAA_3Y_SERIES_ID],

    async fetchLatest(): Promise<Observation[]> {
      throw new Aaa3yUnavailableError(NO_SOURCE_MESSAGE);
    },

    async fetchHistory(): Promise<Observation[]> {
      throw new Aaa3yUnavailableError(NO_SOURCE_MESSAGE);
    },

    async health(): Promise<HealthStatus> {
      return {
        source: "AAA3Y_MOCK",
        ok: false,
        lastChecked: new Date().toISOString(),
        detail: NO_SOURCE_MESSAGE,
      };
    },
  };
}
