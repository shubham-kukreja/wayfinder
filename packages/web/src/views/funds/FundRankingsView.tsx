import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CoreApiError, fundScoresApi, type FundScore, type FundScoreOverview, type FundScoreRanking } from "../../lib/coreApi.js";
import { resetCoreSession } from "../../components/CoreSessionGate.js";
import { FundDetailPanel } from "./FundDetailPanel.js";
import { RankingTable } from "./RankingTable.js";
import { formatDate } from "./fundFormat.js";

// Fund Rankings: every Direct Growth plan ranked within its category by the
// fund-scoring model (core-jobs-service docs/fund-scoring.md): category tabs,
// then one row per fund with rank and status, percentile scores, and rolling
// and trailing returns. Styled like the rest of the app: underlined tabs,
// square bordered sections, the Model drivers heat bands and status pills.

const SAVED_KEY = "core.funds.saved";

function loadSaved(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function storeSaved(s: Set<string>) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...s]));
  } catch {
    // Private mode or blocked storage: bookmarks last for this visit only.
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FundRankingsView() {
  const [overview, setOverview] = useState<FundScoreOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<FundScoreRanking | null>(null);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useState<Set<string>>(loadSaved);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [selected, setSelected] = useState<FundScore | null>(null);

  // Rendered inside CoreSessionGate; a 401 here means the session expired.
  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof CoreApiError && e.status === 401) {
      resetCoreSession();
      window.location.reload();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setOverviewError(null);
    fundScoresApi
      .overview(ac.signal)
      .then(setOverview)
      .catch((e: unknown) => {
        if (ac.signal.aborted || onAuthError(e)) return;
        setOverviewError(
          e instanceof CoreApiError && e.status === 404 ? "No fund scoring run yet. Run fundscore.refresh in core." : errorText(e),
        );
      });
    return () => ac.abort();
  }, [onAuthError]);

  const categoryKey = params.get("c") ?? overview?.categories[0]?.key ?? null;

  useEffect(() => {
    if (!categoryKey) return;
    const ac = new AbortController();
    setLoadingRanking(true);
    setRankingError(null);
    fundScoresApi
      .category(categoryKey, ac.signal)
      .then((r) => {
        setRanking(r);
        setLoadingRanking(false);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || onAuthError(e)) return;
        setRankingError(errorText(e));
        setLoadingRanking(false);
      });
    return () => ac.abort();
  }, [categoryKey, onAuthError]);

  const toggleSaved = useCallback((code: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      storeSaved(next);
      return next;
    });
  }, []);

  const selectCategory = (key: string) => {
    setSelected(null);
    setParams({ c: key }, { replace: true });
  };

  const weights = useMemo(() => {
    const scored = ranking?.category.metrics.filter((m) => m.weight > 0) ?? [];
    const total = scored.reduce((s, m) => s + m.weight, 0);
    return scored.map((m) => ({ ...m, share: total > 0 ? m.weight / total : 0 }));
  }, [ranking]);

  const run = ranking?.run ?? overview?.run;
  const funds = ranking?.funds ?? [];
  const counts = overview?.categories.find((c) => c.key === categoryKey);
  const shortlisted = funds.filter((f) => f.status === "shortlist").length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Funds</p>
          <h1 className="mt-1 font-display text-2xl text-ink">Fund Rankings</h1>
          <p className="mt-2 max-w-3xl text-[13px] text-muted">
            Direct Growth plans ranked within their category.
            {run && <> Scored {formatDate(run.as_of)}.</>}
          </p>
        </div>
        {ranking && shortlisted > 0 && (
          <button
            type="button"
            onClick={() => setShortlistOnly((v) => !v)}
            aria-pressed={shortlistOnly}
            className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-line px-3 py-2 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
          >
            {shortlistOnly ? `Show all ${funds.length}` : `View shortlist (${shortlisted})`}
          </button>
        )}
      </header>

      {weights.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span className="text-muted">Score</span>
          {weights.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-2 bg-paper-2 px-2.5 py-1.5 text-[13px] font-semibold text-ink">
              {m.id.startsWith("rolling") ? "Rolling return 10Y" : m.id.startsWith("sharpe") ? "Sharpe" : "Expense"}
              <span className="font-normal tabular-nums text-muted">{Math.round(m.share * 100)}%</span>
            </span>
          ))}
          <span className="text-muted">· shortlist at {ranking?.category.cutoff ?? 75}+</span>
        </div>
      )}

      <section className="border border-line bg-paper">
        {/* Category tabs, the app's underlined tab row (components/ui/TabRow) */}
        <nav className="flex gap-[22px] overflow-x-auto border-b border-line px-5 pt-4 text-[13px] font-semibold" aria-label="Fund categories">
          {overview?.categories.map((c) => {
            const active = c.key === categoryKey;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => selectCategory(c.key)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2.5 transition-colors duration-100 ease-in ${
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {c.name}
              </button>
            );
          })}
          {!overview && !overviewError && <div className="pb-2.5 text-xs font-normal text-muted">Loading categories…</div>}
        </nav>

        {overviewError && <p className="px-5 py-6 text-sm text-danger-500">{overviewError}</p>}
        {rankingError && <p className="px-5 py-6 text-sm text-danger-500">Failed to load ranking: {rankingError}</p>}

        {ranking && (
          <div className={loadingRanking ? "opacity-60 transition-opacity" : ""}>
            <RankingTable
              ranking={ranking}
              saved={saved}
              onToggleSaved={toggleSaved}
              shortlistOnly={shortlistOnly}
              onSelect={setSelected}
              selectedCode={selected?.scheme_code ?? null}
            />
          </div>
        )}
        {!ranking && loadingRanking && <div className="px-5 py-10 text-sm text-muted">Loading ranking…</div>}

        {counts && (
          <footer className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-xs text-muted">
            <span>
              <span className="font-semibold text-ink">{counts.by_status.shortlist ?? 0}</span> shortlisted
            </span>
            <span>{counts.by_status.below_cutoff ?? 0} below cutoff</span>
            <span>{counts.by_status.filtered_out ?? 0} filtered out</span>
            <span>{counts.by_status.incomplete ?? 0} not scored (under 10 years of history, or data missing)</span>
          </footer>
        )}
      </section>

      {selected && ranking && (
        <FundDetailPanel fund={selected} ranking={ranking} saved={saved.has(selected.scheme_code)} onToggleSaved={toggleSaved} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
