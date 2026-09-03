// §11.1 — uniform adapter interface so a broken source is a one-file fix.

export interface Observation {
  seriesId: string;
  date: string; // ISO; normalised per that series' convention (month-end vs monthly-average)
  value: number;
  basis?: string; // "standalone" | "consolidated" | "pre2019_income"
  raw?: unknown; // keep the source payload for debugging
}

export interface HealthStatus {
  source: string;
  ok: boolean;
  lastChecked: string;
  detail: string | null;
}

export interface SourceAdapter {
  id: string;
  series: string[];
  fetchLatest(): Promise<Observation[]>;
  fetchHistory(from: Date, to: Date): Promise<Observation[]>;
  health(): Promise<HealthStatus>;
}
