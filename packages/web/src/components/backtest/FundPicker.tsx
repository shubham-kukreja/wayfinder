import { useEffect, useRef, useState } from "react";
import { searchSchemes, type SchemeSearchResult } from "../../lib/backtestApi.js";

// A typeahead over /api/schemes/search — the same endpoint the tracked-
// schemes admin flow already hits, reused here for picking a fund per
// backtest leg rather than for adding it to the recurring NAV refresh.
export function FundPicker({
  value,
  onSelect,
}: {
  value: { schemeCode: string; schemeName: string } | null;
  onSelect: (scheme: { schemeCode: string; schemeName: string }) => void;
}) {
  const [query, setQuery] = useState(value?.schemeName ?? "");
  const [results, setResults] = useState<SchemeSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setQuery(value?.schemeName ?? "");
  }, [value?.schemeCode]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3 || query === value?.schemeName) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchSchemes(query.trim());
        setResults(res);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search fund name (min 3 chars)…"
        className="h-9 w-full border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-ink"
      />
      {loading && <div className="absolute right-2 top-2.5 text-xs text-muted">…</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto border border-line bg-paper shadow-sm">
          {results.map((r) => (
            <li key={r.schemeCode}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-paper-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect({ schemeCode: r.schemeCode, schemeName: r.schemeName });
                  setQuery(r.schemeName);
                  setOpen(false);
                }}
              >
                <div className="font-medium">{r.schemeName}</div>
                <div className="text-xs text-muted">
                  NAV ₹{r.nav.toFixed(4)} as of {r.date}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
