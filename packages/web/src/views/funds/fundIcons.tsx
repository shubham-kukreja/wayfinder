// Line icons for the fund rankings screen, drawn to sit beside 12-13px text.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg {...base} className="h-4 w-4" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path d="M6 3h12v18l-6-4.5L6 21V3z" />
    </svg>
  );
}

export function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg viewBox="0 0 10 12" className="ml-0.5 inline h-2.5 w-2" aria-hidden="true">
      <path d="M5 1L8 4.5H2z" fill="currentColor" opacity={dir === "asc" ? 1 : 0.35} />
      <path d="M5 11L2 7.5h6z" fill="currentColor" opacity={dir === "desc" ? 1 : 0.35} />
    </svg>
  );
}

export function CloseIcon() {
  return <Glyph d="M6 6l12 12M18 6L6 18" className="h-4 w-4" />;
}

export function CheckIcon({ ok }: { ok: boolean }) {
  return <Glyph d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} className="h-3.5 w-3.5 shrink-0" />;
}
