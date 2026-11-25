// Line icons for the client pages, drawn like the app's other icons:
// 16px box, 1.6 stroke, round caps, colour from the text.

const svg = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PlusIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...svg} className={className} aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

/** Two opposing arrows: money moving between sleeves. */
export function RebalanceIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...svg} className={className} aria-hidden="true">
      <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8" />
      <path d="M13 10.5H3.5M6 8l-2.5 2.5L6 13" />
    </svg>
  );
}

/** An arrow leaving a box: the order goes to the exchange platform. */
export function HandoffIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...svg} className={className} aria-hidden="true">
      <path d="M9.5 3H13v3.5M13 3L7.5 8.5" />
      <path d="M11.5 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" />
    </svg>
  );
}

export function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg {...svg} className={className} aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}
