import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A quiet "i" that opens an explainer panel. Used where a surface needs to
// teach what it is for without spending permanent page space on prose — the
// explanation is there for the first read and out of the way after it.
export function InfoPopover({
  label,
  title,
  children,
  align = "right",
}: {
  label: string;
  title: string;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Dismiss on outside click and on Escape: a popover that can only be
  // closed by hitting the same small target again is a trap.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors duration-100 ease-in ${
          open ? "border-ink bg-ink text-paper" : "border-line text-muted hover:border-ink hover:text-ink"
        }`}
      >
        i
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={title}
          className={`absolute top-7 z-40 w-[min(26rem,calc(100vw-3rem))] rounded-lg border border-line bg-paper p-4 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <h3 className="text-[13px] font-bold uppercase tracking-eyebrow text-muted">{title}</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 rounded-sm px-1.5 text-[13px] text-muted transition-colors duration-100 ease-in hover:text-ink"
            >
              ×
            </button>
          </div>
          <div className="mt-2.5 space-y-2.5 text-[13px] leading-5 text-ink-2">{children}</div>
        </div>
      )}
    </div>
  );
}
