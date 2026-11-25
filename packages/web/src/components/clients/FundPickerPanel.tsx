import { useEffect, useState } from "react";
import type { FundChoice } from "../../lib/clients.js";
import type { FundScore, FundScoreRanking } from "../../lib/coreApi.js";
import { formatRupees } from "../../lib/backtestFormat.js";
import { formatPct } from "../../lib/format.js";
import { RankingTable } from "../../views/funds/RankingTable.js";
import { FundSwitcher } from "./FundSwitcher.js";

// Choosing a sleeve's fund with Fund Rankings in view: the category's table
// (overall score, percentile scores, rolling and trailing returns, AUM and
// expense), the current pick marked; a click picks a fund. Sleeves with no
// ranking (debt) get search over every fund.

export function FundPickerPanel({
  sleeveLabel,
  weight,
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
  const [shortlistOnly, setShortlistOnly] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickRanked = (f: FundScore) => {
    onPick({
      schemeCode: f.scheme_code,
      schemeName: f.name,
      amc: f.amc,
      status: f.status,
      rank: f.rank,
      rankedOf: f.ranked_of,
      composite: f.composite,
      source: "ranking",
    });
    onClose();
  };
  const shortlisted = ranking?.funds.filter((f) => f.status === "shortlist").length ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Choose a fund for ${sleeveLabel}`}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[1180px] flex-col bg-paper shadow-xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Choose a fund</p>
            <h2 className="mt-1 font-display text-xl text-ink">
              {sleeveLabel} · {formatRupees(amount)}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {formatPct(weight, 1)} of the plan.{" "}
              {current ? (
                <>
                  Now: <span className="font-semibold text-ink">{current.schemeName}</span>
                  {overridden ? " (your pick)" : " (top ranked)"}
                </>
              ) : (
                "No fund picked yet."
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {overridden && (
              <button
                type="button"
                onClick={() => {
                  onReset();
                  onClose();
                }}
                className="rounded-sm border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-paper-2"
              >
                Use top ranked
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-sm border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-paper-2">
              Close
            </button>
          </div>
        </header>

        {ranking && ranking.funds.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-[13px] text-muted">
              <span>
                {ranking.category.name}: {ranking.funds.length} funds, {shortlisted} shortlisted (score {ranking.category.cutoff}+ and every hard filter
                passed). Click a fund to use it.
              </span>
              {shortlisted > 0 && (
                <button
                  type="button"
                  onClick={() => setShortlistOnly((v) => !v)}
                  aria-pressed={shortlistOnly}
                  className="rounded-sm border border-line px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-paper-2"
                >
                  {shortlistOnly ? `Show all ${ranking.funds.length}` : `Shortlist only (${shortlisted})`}
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 border-t border-line">
              <RankingTable
                ranking={ranking}
                saved={new Set()}
                onToggleSaved={() => undefined}
                shortlistOnly={shortlistOnly}
                onSelect={pickRanked}
                selectedCode={current?.schemeCode ?? null}
                showSave={false}
                maxHeight="max-h-[calc(100vh-190px)]"
              />
            </div>
          </>
        ) : (
          <div className="px-6 py-6">
            <p className="text-[13px] text-muted">
              {sleeveLabel} has no Fund Rankings category yet{fallback ? `; the default is ${fallback.schemeName}` : ""}. Search any fund:
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
