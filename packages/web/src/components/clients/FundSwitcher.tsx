import { useEffect, useMemo, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "../ui/SearchableSelect.js";
import { searchSchemes } from "../../lib/backtestApi.js";
import type { FundChoice } from "../../lib/clients.js";
import { STATUS_LABEL } from "../../views/funds/fundFormat.js";

/** Rank and score for a ranked fund; where an unranked one came from. */
export function rankText(f: FundChoice): string {
  if (f.source === "ranking") {
    if (f.status === "incomplete") return "Under 10 years of history, not scored";
    const rank = f.rank ? `#${f.rank} of ${f.rankedOf ?? "?"} in category` : "unranked";
    return `${rank}${f.composite != null ? ` · score ${Math.round(f.composite)}` : ""}`;
  }
  return f.source === "default" ? "Default fund for this sleeve" : "Picked by search";
}

function detail(f: FundChoice): string {
  return f.source === "ranking" && f.status ? `${STATUS_LABEL[f.status]} · ${rankText(f)}` : rankText(f);
}

/**
 * "Switch" for one plan line: the sleeve's ranked alternatives (best first)
 * and, from three letters, any fund by name.
 */
export function FundSwitcher({
  options,
  fallback,
  overridden,
  onPick,
  onReset,
}: {
  options: FundChoice[];
  fallback: FundChoice | null;
  overridden: boolean;
  onPick: (f: FundChoice) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<FundChoice[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setRemote([]);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchSchemes(q)
        .then((rs) => live && setRemote(rs.map((r) => ({ schemeCode: r.schemeCode, schemeName: r.schemeName, amc: r.detail, source: "search" as const }))))
        .catch(() => live && setRemote([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const pool = useMemo(() => {
    const q = query.trim().toLowerCase();
    const local = [...options, ...(fallback && !options.some((o) => o.schemeCode === fallback.schemeCode) ? [fallback] : [])].filter(
      (o) => !q || o.schemeName.toLowerCase().includes(q),
    );
    const seen = new Set(local.map((o) => o.schemeCode));
    return [...local, ...remote.filter((r) => !seen.has(r.schemeCode))];
  }, [options, fallback, remote, query]);
  const byCode = useMemo(() => new Map(pool.map((p) => [p.schemeCode, p])), [pool]);
  const selectOptions: SearchableSelectOption[] = pool.slice(0, 40).map((p) => ({ id: p.schemeCode, label: p.schemeName, sublabel: detail(p) }));

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  if (open) {
    return (
      <div className="flex w-full items-center gap-2">
        <SearchableSelect
          autoFocus
          className="min-w-0 flex-1"
          placeholder="Search alternatives…"
          value={null}
          options={selectOptions}
          loading={searching}
          onQueryChange={setQuery}
          onSelect={(o) => {
            const f = byCode.get(o.id);
            if (f) onPick(f);
            close();
          }}
        />
        <button type="button" onClick={close} className="px-1 text-[12px] font-semibold text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-2 transition-colors duration-100 ease-in hover:bg-paper-2 hover:text-ink"
      >
        Switch
      </button>
      {overridden && (
        <button type="button" onClick={onReset} className="px-1 text-[12px] font-semibold text-muted hover:text-ink">
          Reset
        </button>
      )}
    </div>
  );
}
