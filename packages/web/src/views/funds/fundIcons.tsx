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

// One glyph per kind of category, as in the reference's tab strip.
const CATEGORY_PATHS: Array<[RegExp, string]> = [
  [/^large_cap$/, "M7 21V4h7v17M14 9h4v12M5 21h15M9.5 7.5h2M9.5 11h2M9.5 14.5h2"],
  [/^large_mid_cap$/, "M4 21V6h6v15M10 11h5v10M15 14h5v7M3 21h18M6.5 9h1M6.5 12.5h1"],
  [/^mid_cap$/, "M6 21V9h8v12M14 13h4v8M4 21h16M9 12h2M9 15.5h2"],
  [/^small_cap$/, "M7 21v-7h7v7M14 16h3v5M5 21h14M9.5 17h2"],
  [/^(flexi_cap|multi_cap)$/, "M12 21v-8M12 13L6 6M12 13l6-7M4 6h4M16 6h4"],
  [/^(value|contra)$/, "M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3"],
  [/^elss$/, "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3"],
  [/^focused$/, "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01"],
  [/^dividend_yield$/, "M12 21a9 9 0 100-18 9 9 0 000 18zM9 9.5h6M9 12h6M11 9.5c2 0 2 5 0 5l3.5 3"],
  [/^thematic_/, "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
  [/^(balanced_advantage|equity_savings)$/, "M12 4v16M5 20h14M5 8h14M5 8l-2.5 6h5L5 8zM19 8l-2.5 6h5L19 8z"],
  [/^index_equity$/, "M3 20h18M4 16l5-5 4 3 7-8"],
  [/^precious_metals$/, "M3 19l2.5-5h6L14 19H3zM10 19l2.5-5h6L21 19H10zM6.5 14L9 9h6l2.5 5"],
  [/fof/, "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"],
];

export function CategoryIcon({ categoryKey }: { categoryKey: string }) {
  const d = CATEGORY_PATHS.find(([re]) => re.test(categoryKey))?.[1] ?? CATEGORY_PATHS[0]![1];
  return <Glyph d={d} />;
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

/** One laurel branch: a curved stem with leaves along its outer side. */
function Branch({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 12 26" className={`h-[26px] w-3 ${flip ? "-scale-x-100" : ""}`} fill="currentColor" aria-hidden="true">
      <path d="M10 25C5 22 2.5 17 2.8 12S5.5 3.5 9 1.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M8.6 2.2c-2.4.2-3.8 1.6-4 3.6 2.2-.2 3.6-1.6 4-3.6z" />
      <path d="M5.6 6.4C3.5 5.9 1.8 6.8 1 8.6c2 .6 3.7-.3 4.6-2.2z" />
      <path d="M3.9 10.8C1.9 10 .3 10.6-.3 12.4c2 .8 3.6.2 4.2-1.6z" opacity=".9" />
      <path d="M3.5 15.4c-2-.5-3.6.4-4.1 2.2 2 .5 3.6-.4 4.1-2.2z" opacity=".85" />
      <path d="M4.9 19.8c-1.9-.1-3.3 1.1-3.5 2.9 1.9.1 3.3-1.1 3.5-2.9z" opacity=".8" />
    </svg>
  );
}

/** Rank number framed by a laurel wreath, as in the reference; a plain dash when unranked. */
export function LaurelRank({ rank }: { rank: number | null }) {
  if (rank == null) return <span className="font-mono text-[13px] text-muted">–</span>;
  return (
    <span className="inline-flex items-center">
      <Branch />
      <span className="min-w-[1.4rem] text-center font-mono text-[13px] font-semibold tabular-nums">{rank}</span>
      <Branch flip />
    </span>
  );
}

/** Status glyph: a double chevron for the shortlist, as the reference's "In-form". */
export function StatusGlyph({ status }: { status: string }) {
  const d =
    status === "shortlist"
      ? "M7 13l5-5 5 5M7 18l5-5 5 5"
      : status === "below_cutoff"
        ? "M6 12h12"
        : status === "filtered_out"
          ? "M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 18.4L18.4 5.6"
          : "M8 12h.01M12 12h.01M16 12h.01";
  return <Glyph d={d} className="h-3.5 w-3.5 shrink-0" />;
}

export function CloseIcon() {
  return <Glyph d="M6 6l12 12M18 6L6 18" className="h-4 w-4" />;
}

export function CheckIcon({ ok }: { ok: boolean }) {
  return <Glyph d={ok ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} className="h-3.5 w-3.5 shrink-0" />;
}
