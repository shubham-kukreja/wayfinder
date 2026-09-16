import type { ReactNode } from "react";

// Static cards use a 1px hairline border and never a shadow; shadows are
// reserved for floating and overlay elements. 12px radius, because a card is
// something you read inside of rather than click.
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-lg border border-line bg-paper p-5 ${className}`}>{children}</div>;
}

// Uppercase section label: 11-13px, 700, +8% tracking, muted.
export function Kicker({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`text-xs font-bold uppercase tracking-eyebrow text-muted ${className}`}>{children}</div>
  );
}
