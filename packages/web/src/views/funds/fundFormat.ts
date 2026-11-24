import type { FundScore, FundScoreStatus } from "../../lib/coreApi.js";

// Labels for the scoring model's metric ids (core-jobs-service
// configs/seed/fund_scoring.yaml).
export const METRIC_LABELS: Record<string, string> = {
  rolling_return_10y: "Rolling return, 10Y",
  rolling_return_5y: "Rolling return, 5Y",
  rolling_return_3y: "Rolling return, 3Y",
  rolling_return_1y: "Rolling return, 1Y",
  consistency_10y: "Months beating benchmark (10Y)",
  sharpe_10y: "Sharpe ratio",
  downside_capture_10y: "Downside capture (10Y)",
  max_drawdown_10y: "Max drawdown (10Y)",
  expense_ratio: "Expense ratio (Direct)",
  exit_load: "Exit load",
  alpha_10y: "Alpha (10Y)",
};

export function metricLabel(id: string): string {
  return METRIC_LABELS[id] ?? id;
}

export function formatMetric(id: string, v: number | undefined | null): string {
  if (v == null || Number.isNaN(v)) return "–";
  if (id.startsWith("sharpe") || id.startsWith("alpha")) return v.toFixed(2);
  if (id === "expense_ratio" || id === "exit_load") return `${v.toFixed(2)}%`;
  if (id.startsWith("downside_capture")) return v.toFixed(0);
  if (id.startsWith("consistency")) return `${v.toFixed(0)}%`;
  return `${v.toFixed(1)}%`;
}

export function formatPct(v: number | undefined | null): string {
  return v == null ? "–" : `${v.toFixed(1)}%`;
}

export function formatAum(cr: number | null): string {
  if (cr == null) return "–";
  return `₹${Math.round(cr).toLocaleString("en-IN")} cr`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const STATUS_LABEL: Record<FundScoreStatus, string> = {
  shortlist: "Shortlist",
  below_cutoff: "Below cutoff",
  filtered_out: "Filtered out",
  incomplete: "Not scored",
};

export const FILTER_LABEL: Record<string, string> = {
  track_record: "Track record",
  aum: "Fund size (AUM)",
  manager_change: "Manager continuity",
};

// Heat scale, 0-100 with 100 best, in the reference's tiles: deep green at
// the top, through pale green, to peach and then pink at the bottom.
export function heatClass(p: number | null | undefined): string {
  if (p == null) return "bg-paper-2 text-muted";
  if (p >= 80) return "bg-[#CDEFD6] text-[#14532D]";
  if (p >= 60) return "bg-[#DFF5E5] text-[#166534]";
  if (p >= 40) return "bg-[#EEF9F1] text-ink-2";
  if (p >= 20) return "bg-[#FFEEDF] text-[#9A3412]";
  return "bg-[#FDE1DD] text-[#B42318]";
}

// Row tint for the rank and status tiles, by status.
export const STATUS_TILE: Record<FundScoreStatus, string> = {
  shortlist: "bg-[#DFF5E5] text-[#166534]",
  below_cutoff: "bg-[#EEF9F1] text-ink-2",
  filtered_out: "bg-[#FFEEDF] text-[#9A3412]",
  incomplete: "bg-paper-2 text-muted",
};

/** Percentile (0-100, 100 best) of each fund's value among those with one. */
export function columnPercentiles(
  funds: FundScore[],
  get: (f: FundScore) => number | null | undefined,
  higherIsBetter = true,
): Map<string, number> {
  const vals = funds
    .map((f) => ({ code: f.scheme_code, v: get(f) }))
    .filter((x): x is { code: string; v: number } => x.v != null && !Number.isNaN(x.v));
  const out = new Map<string, number>();
  const n = vals.length;
  for (const a of vals) {
    if (n === 1) {
      out.set(a.code, 50);
      continue;
    }
    let worse = 0;
    let ties = 0;
    for (const b of vals) {
      if (b === a) continue;
      if (b.v === a.v) ties++;
      else if (higherIsBetter ? b.v < a.v : b.v > a.v) worse++;
    }
    out.set(a.code, ((worse + ties / 2) / (n - 1)) * 100);
  }
  return out;
}
