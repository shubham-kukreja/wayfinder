import { useEffect, useRef, useState } from "react";

// A searchable dropdown that reads like the app's own pill+select controls
// (Overview's "Compare", Data Points' "Source"/"Group by" — bordered pill,
// bold label, trailing chevron) but with a real custom-rendered options
// panel and in-app search, since neither existing pattern in the app
// covers "search over thousands of options": the pill+native-<select>
// pattern has no search at all (it's just a real <select>, browser-native
// popup, unstylable), and the only actual search component (FundPicker)
// has no keyboard nav and a different, plainer visual language. This
// merges the two: pill trigger + input-driven search + a real listbox
// with roving keyboard focus, click-outside and Escape handling.
export interface SearchableSelectOption {
  id: string;
  label: string;
  sublabel?: string;
}

export function SearchableSelect({
  label,
  placeholder = "Search…",
  value,
  options,
  loading = false,
  onQueryChange,
  onSelect,
  minQueryLength = 0,
  className = "",
}: {
  label?: string;
  placeholder?: string;
  value: SearchableSelectOption | null;
  options: SearchableSelectOption[];
  loading?: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (option: SearchableSelectOption) => void;
  minQueryLength?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value?.label ?? "");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value?.id]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value?.label ?? "");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [value?.label]);

  useEffect(() => {
    setActiveIndex(options.length > 0 ? 0 : -1);
  }, [options]);

  function commit(option: SearchableSelectOption) {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && activeIndex >= 0 && options[activeIndex]) commit(options[activeIndex]!);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(value?.label ?? "");
      inputRef.current?.blur();
    }
  }

  const showPanel = open && (loading || options.length > 0 || query.trim().length >= minQueryLength);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {label && <span className="mb-1 block text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">{label}</span>}
      <div className="relative h-9">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            onQueryChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full rounded-sm border border-line bg-paper px-3 pr-8 text-[13px] font-semibold text-ink placeholder:font-normal placeholder:text-muted focus:border-ink focus:outline-none"
        />
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </div>

      {showPanel && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-sm border border-line bg-paper shadow-xl">
          {loading && <li className="px-3 py-2.5 text-[13px] text-muted">Searching…</li>}
          {!loading && options.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">No matches.</li>}
          {!loading &&
            options.map((option, i) => (
              <li key={option.id} role="option" aria-selected={value?.id === option.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(option);
                  }}
                  className={`block w-full px-3 py-2 text-left text-[13px] transition-colors duration-100 ease-in ${
                    i === activeIndex ? "bg-paper-2" : ""
                  } ${value?.id === option.id ? "font-semibold text-ink" : "text-ink"}`}
                >
                  <div>{option.label}</div>
                  {option.sublabel && <div className="text-xs text-muted">{option.sublabel}</div>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
