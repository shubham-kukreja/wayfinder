import type { ReactNode } from "react";

// Small, low-saturation status pills. Green carries success/positive state,
// dark is a solid brand/product tag, neutral covers draft and pending.
export type PillTone = "green" | "dark" | "neutral" | "danger";

const TONES: Record<PillTone, string> = {
  green: "bg-brand-50 text-brand-800",
  dark: "bg-ink text-paper",
  neutral: "bg-paper-2 text-ink-2",
  danger: "bg-danger-50 text-danger-500",
};

export function Pill({
  tone = "neutral",
  dot = false,
  className = "",
  children,
}: {
  tone?: PillTone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONES[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
