import type { ReactNode } from "react";

// Dashboard KPI card: muted 12px label, display-weight tabular value, and an
// optional delta that is green when positive and danger red when negative.
export function StatTile({
  label,
  value,
  delta,
  direction,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  direction?: "up" | "down";
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-paper px-[18px] py-4 ${className}`}>
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className="font-display text-[22px] font-bold tabular-nums text-ink">{value}</div>
      {delta !== undefined && (
        <div
          className={`mt-1 text-xs font-semibold ${direction === "down" ? "text-danger-500" : "text-brand-800"}`}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
