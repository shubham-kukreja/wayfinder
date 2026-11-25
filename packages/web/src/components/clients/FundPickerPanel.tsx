import { useEffect, useMemo, useState } from "react";
import type { FundChoice } from "../../lib/clients.js";
import type { FundScore, FundScoreRanking } from "../../lib/coreApi.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { FILTER_LABEL, STATUS_LABEL, formatAum } from "../../views/funds/fundFormat.js";
import { FundSwitcher } from "./FundSwitcher.js";
import { Segmented, SecondaryButton } from "./ui.js";

// Choosing a sleeve's fund: the category's ranked funds as a plain table —
// score, rolling and trailing returns, risk, cost and size — filtered to
// those passing the hard filters by default, sortable, with the current pick
// marked. Sleeves with no ranking (debt) get search over every fund.

const VIEWS = ["Passes filters", "Shortlist", "All"] as const;
type View = (typeof VIEWS)[number];
type SortKey = "rank" | "score" | "r10" | "t3" | "t5" | "risk" | "ter" | "aum";

const pct = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}%`);
const STATUS_DOT: Record<FundScore["status"], string> = {
  shortlist: "bg-brand-500",
  below_cutoff: "bg-ink-2/40",
  filtered_out: "bg-danger-500",
  incomplete: "bg-line",
};

function value(f: FundScore, k: SortKey): number | null {
  switch (k) {
    case "rank":
      return f.rank;
    case "score":
      return f.composite;
    case "r10":
      return f.metrics["rolling_return_10y"] ?? null;
    case "t3":
      return f.facts.returns["3y"] ?? null;
    case "t5":
      return f.facts.returns["5y"] ?? null;
    case "risk":
      return f.percentiles["sharpe_10y"] ?? null;
    case "ter":
      return f.facts.ter_direct;
    case "aum":
      return f.facts.aum_cr;
  }
}

export function FundPickerPanel({
  sleeveLabel,
  weight: _weight,
  amount,
  ranking,
  current,
  fallback,
  overridden,
  onPick,
  onReset,
  onClose,
}: {
  sleeveLabel: string;
  weight: number;
  amount: number;
  ranking: FundScoreRanking | null;
  current: FundChoice | null;
  fallback: FundChoice | null;
  overridden: boolean;
  onPick: (f: FundChoice) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("Passes filters");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "rank", desc: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    if (!ranking) return [];
    const list = ranking.funds.filter((f) =>
      view === "All" ? true : view === "Shortlist" ? f.status === "shortlist" : f.status === "shortlist" || f.status === "below_cutoff",
    );
    return list.sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [ranking, view, sort]);

  const counts = ranking
    ? {
        "Passes filters": ranking.funds.filter((f) => f.status === "shortlist" || f.status === "below_cutoff").length,
        Shortlist: ranking.funds.filter((f) => f.status === "shortlist").length,
        All: ranking.funds.length,
      }
    : null;

  const pick = (f: FundScore) => {
    onPick({ schemeCode: f.scheme_code, schemeName: f.name, amc: f.amc, status: f.status, rank: f.rank, rankedOf: f.ranked_of, composite: f.composite, source: "ranking" });
    onClose();
  };

  const Th = ({ k, label, right = true, defaultDesc = true }: { k: SortKey; label: string; right?: boolean; defaultDesc?: boolean }) => {
    const active = sort.key === k;
    return (
      <th className={`px-3 py-2.5 font-normal ${right ? "text-right" : "text-left"}`}>
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: defaultDesc }))}
          className={`inline-flex items-center gap-1 transition-colors duration-150 ease-out ${active ? "text-ink" : "hover:text-ink"}`}
        >
          {label}
          {active && <span aria-hidden="true">{sort.desc ? "↓" : "↑"}</span>}
        </button>
      </th>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Choose a fund for ${sleeveLabel}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[1100px] flex-col bg-paper shadow-xl">
        <header className="flex flex-wrap items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-ink">Choose a fund for {sleeveLabel}</h2>
            <p className="mt-1 text-[13px] tabular-nums text-muted">
              {formatRupees(amount)} · now {current ? <span className="text-ink">{current.schemeName}</span> : "nothing picked"}
              {current && (overridden ? ", chosen by you" : ", top ranked")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {overridden && (
              <SecondaryButton
                onClick={() => {
                  onReset();
                  onClose();
                }}
              >
                Use top ranked
              </SecondaryButton>
            )}
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </header>

        {ranking && ranking.funds.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-y border-line px-6 py-3">
              <Segmented options={VIEWS} value={view} onChange={setView} label="Show" />
              <span className="text-[12px] tabular-nums text-muted">
                {counts?.[view]} of {ranking.funds.length} {ranking.category.name} funds · shortlist is score {ranking.category.cutoff}+ and every hard
                filter passed
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead className="sticky top-0 z-10 bg-paper">
                  <tr className="border-b border-line text-[12px] text-muted">
                    <Th k="rank" label="#" right={false} defaultDesc={false} />
                    <th className="px-3 py-2.5 text-left font-normal">Fund</th>
                    <Th k="score" label="Score" right={false} />
                    <Th k="r10" label="10Y rolling" />
                    <Th k="t3" label="3Y return" />
                    <Th k="t5" label="5Y return" />
                    <Th k="risk" label="Risk-adj." />
                    <Th k="ter" label="Expense" defaultDesc={false} />
                    <Th k="aum" label="AUM" />
                    <th className="w-24 px-6 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => {
                    const isCurrent = f.scheme_code === current?.schemeCode;
                    const fails = f.filters.filter((x) => !x.ok);
                    return (
                      <tr key={f.scheme_code} className={`border-b border-line transition-colors duration-150 ease-out ${isCurrent ? "bg-paper-2" : "hover:bg-paper-2/60"}`}>
                        <td className="px-3 py-3 pl-6 tabular-nums text-muted">{f.rank ?? "–"}</td>
                        <td className="max-w-[320px] px-3 py-3">
                          <span className="block truncate text-ink" title={f.name}>
                            {f.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[f.status]}`} aria-hidden="true" />
                            <span className="truncate">
                              {STATUS_LABEL[f.status]}
                              {fails.length > 0 && ` · ${fails.map((x) => FILTER_LABEL[x.name] ?? x.name).join(", ")}`}
                              {fails.length === 0 && ` · ${f.amc}`}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-2 tabular-nums text-ink">
                            <span className="w-6 text-right font-semibold">{f.composite == null ? "–" : Math.round(f.composite)}</span>
                            <span className="h-1 w-14 overflow-hidden rounded-full bg-paper-2" aria-hidden="true">
                              <span className="block h-full rounded-full bg-[#2BAB48]" style={{ width: `${f.composite ?? 0}%` }} />
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink">{pct(f.metrics["rolling_return_10y"])}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-2">{pct(f.facts.returns["3y"])}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-2">{pct(f.facts.returns["5y"])}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-2">
                          {f.percentiles["sharpe_10y"] == null ? "–" : `${Math.round(f.percentiles["sharpe_10y"]!)} pctl`}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-2">{f.facts.ter_direct == null ? "–" : `${f.facts.ter_direct.toFixed(2)}%`}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-2">{formatAum(f.facts.aum_cr).replace(" cr", " Cr")}</td>
                        <td className="px-6 py-3 text-right">
                          {isCurrent ? (
                            <span className="text-[12px] font-semibold text-ink">Current</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => pick(f)}
                              className="h-8 rounded-md border border-line px-3 text-[12px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-ink hover:text-paper"
                            >
                              Use
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-8 text-center text-muted">
                        No funds in this view
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="border-t border-line px-6 py-6">
            <p className="text-[13px] text-muted">
              {sleeveLabel} has no Fund Rankings category yet{fallback ? `; the default is ${fallback.schemeName}` : ""}. Search any fund
            </p>
            <div className="mt-3 max-w-xl">
              <FundSwitcher
                options={[]}
                fallback={fallback}
                overridden={overridden}
                startOpen
                onPick={(f) => {
                  onPick(f);
                  onClose();
                }}
                onReset={onReset}
              />
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
