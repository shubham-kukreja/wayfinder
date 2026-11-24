import { useEffect, useRef, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "../ui/SearchableSelect.js";
import { searchSchemes, type SchemeSearchResult } from "../../lib/backtestApi.js";

// A typeahead over core's /v1/funds/search — the same fund list the tracked-
// schemes admin flow already hits — built on the shared SearchableSelect
// so a fund row reads like every other dropdown in the app (bordered
// pill/input, same chevron, same listbox styling) instead of its own
// one-off look.
export function FundPicker({
  value,
  onSelect,
}: {
  value: { schemeCode: string; schemeName: string } | null;
  onSelect: (scheme: { schemeCode: string; schemeName: string }) => void;
}) {
  const [results, setResults] = useState<SchemeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef("");

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleQueryChange(query: string) {
    lastQueryRef.current = query;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchSchemes(query.trim());
        if (lastQueryRef.current === query) setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  const options: SearchableSelectOption[] = results.map((r) => ({
    id: r.schemeCode,
    label: r.schemeName,
    sublabel: r.detail,
  }));

  return (
    <SearchableSelect
      placeholder="Search fund name (min 3 chars)…"
      value={value ? { id: value.schemeCode, label: value.schemeName } : null}
      options={options}
      loading={loading}
      minQueryLength={3}
      onQueryChange={handleQueryChange}
      onSelect={(option) => onSelect({ schemeCode: option.id, schemeName: option.label })}
    />
  );
}
