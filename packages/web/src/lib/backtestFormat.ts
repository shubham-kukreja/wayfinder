export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function defaultPurchaseDateIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

export function formatXirr(x: number | null): string {
  if (x === null) return "—";
  const pct = x * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatPctValue(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Indian numbering (K/L/Cr), not the western K/M/B a plain Intl.NumberFormat
// compact notation would produce — 100000 reads as "1L" here, matching how
// every rupee figure elsewhere in this flow (and in India generally) is
// actually spoken, not as "100K".
export function formatRupeesCompact(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(abs >= 10_00_00_000 ? 1 : 2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(abs >= 10_00_000 ? 1 : 2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// "~4m 30s" / "~45s" — for a job's ETA or elapsed time. Deliberately not
// exact-to-the-second (an ETA is already an estimate) — rounds to the
// nearest 5s under a minute, nearest 10s above, so the number doesn't
// visibly tick in a way that implies false precision.
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds / 5) * 5 || 1}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round((seconds % 60) / 10) * 10;
  return remSeconds > 0 ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
}
