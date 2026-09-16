import { useEffect, useRef } from "react";

// Global utility bar: a single search field, sticky so it stays reachable
// while a long view scrolls.
export function TopBar() {
  const searchRef = useRef<HTMLInputElement>(null);

  // The field advertises ⌘K, so the shortcut has to actually focus it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line bg-paper/95 px-8 py-4 backdrop-blur">
      {/* Filled grey field, no border, with the keyboard shortcut parked on
          the right rail. */}
      <label className="relative flex min-w-0 flex-1 items-center lg:max-w-2xl">
        <span className="sr-only">Search signals, data points, or parameters</span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-ink"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M12.8 12.8L17 17" />
        </svg>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search signals, data points, or parameters"
          className="h-11 w-full rounded-sm border-0 bg-paper-2 pl-12 pr-16 text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
        />
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-4 font-sans text-[13px] font-normal text-muted"
        >
          ⌘ + K
        </kbd>
      </label>

    </header>
  );
}
