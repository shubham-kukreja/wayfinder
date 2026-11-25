import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Shared pieces for the client pages, so every button, breadcrumb and
// toggle matches: 8px control radius, steps on the 4px grid, colour-only
// hover.

const base = "inline-flex items-center justify-center rounded-md text-[14px] font-semibold transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40";

export const primaryClass = `${base} h-10 bg-ink px-5 text-paper hover:bg-ink/85`;
export const secondaryClass = `${base} h-10 border border-line bg-paper px-5 text-ink hover:bg-paper-2`;

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={primaryClass}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={secondaryClass}>
      {children}
    </button>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav className="text-[13px] text-muted" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 && <span className="px-2">/</span>}
          {it.to ? (
            <Link to={it.to} className="transition-colors duration-150 ease-out hover:text-ink">
              {it.label}
            </Link>
          ) : (
            <span className="text-ink">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** A row of small text buttons, the active one on a surface step. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={o === value}
          className={`h-8 min-w-10 rounded-md px-2 text-[12px] font-semibold tabular-nums transition-colors duration-150 ease-out ${
            o === value ? "bg-[#F0F0F0] text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
