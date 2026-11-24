import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CoreApiError, searchApi, type SearchHit } from "../../lib/coreApi.js";

// ⌘K search over core-jobs-service (GET /v1/search): series and notes. A
// series opens Data Points filtered to it; a note opens the note.

const KIND_LABEL: Record<SearchHit["kind"], string> = { series: "Data point", node: "Node", parameter: "Parameter", note: "Note" };

function target(hit: SearchHit): string {
  switch (hit.kind) {
    case "note":
      return `/notes/${encodeURIComponent(hit.key)}`;
    case "series":
      return `/model/datapoints?q=${encodeURIComponent(hit.key)}`;
    default:
      return `/model/signals`;
  }
}

export function GlobalSearch() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "signed-out">("idle");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setStatus("idle");
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(() => {
      searchApi
        .search(term.slice(0, 100), ac.signal)
        .then((h) => {
          setHits(h);
          setActive(0);
          setStatus("idle");
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          setHits([]);
          setStatus(e instanceof CoreApiError && e.status === 401 ? "signed-out" : "error");
        });
    }, 180);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [q]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    navigate(target(hit));
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div className="relative min-w-0 flex-1 lg:max-w-2xl">
      <label className="relative flex items-center">
        <span className="sr-only">Search data points and notes</span>
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
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-activedescendant={showPanel && hits[active] ? `search-hit-${active}` : undefined}
          placeholder="Search data points and notes"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              e.preventDefault();
              go(hits[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="h-11 w-full rounded-sm border-0 bg-paper-2 pl-12 pr-16 text-[15px] [&::-webkit-search-cancel-button]:hidden text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
        />
        <kbd aria-hidden="true" className="pointer-events-none absolute right-4 font-sans text-[13px] font-normal text-muted">
          ⌘ + K
        </kbd>
      </label>

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-sm border border-line bg-paper py-1 shadow-xl"
        >
          {status === "loading" && hits.length === 0 && <p className="px-4 py-3 text-[13px] text-muted">Searching…</p>}
          {status === "error" && <p className="px-4 py-3 text-[13px] text-danger-500">Search is unavailable right now.</p>}
          {status === "signed-out" && (
            <p className="px-4 py-3 text-[13px] text-muted">Sign in to the data service to search (open Notes or Fund Rankings).</p>
          )}
          {status === "idle" && hits.length === 0 && <p className="px-4 py-3 text-[13px] text-muted">No matches.</p>}
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}:${hit.key}`}
              id={`search-hit-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className={`flex w-full items-start gap-3 px-4 py-2 text-left ${i === active ? "bg-paper-2" : ""}`}
            >
              <span className="mt-0.5 w-[88px] shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-eyebrow text-muted">{KIND_LABEL[hit.kind]}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-ink">{hit.title}</span>
                {hit.snippet && <span className="block truncate text-xs text-muted">{hit.snippet}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
