import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CoreApiError,
  coreAuth,
  fundScoresApi,
  type CoreUser,
  type FundScore,
  type FundScoreOverview,
  type FundScoreRanking,
} from "../../lib/coreApi.js";
import { CoreSignIn } from "./CoreSignIn.js";
import { FundDetailPanel } from "./FundDetailPanel.js";
import { RankingTable } from "./RankingTable.js";
import { CategoryIcon } from "./fundIcons.js";
import { formatDate } from "./fundFormat.js";

// Fund Rankings: every Direct Growth plan ranked within its category by the
// fund-scoring model (core-jobs-service docs/fund-scoring.md). Laid out after
// Powerup's "Power Select" table: category tabs, then one row per fund with
// rank and status, percentile scores, and rolling and trailing returns.

type AuthState = { kind: "checking" } | { kind: "signed-out" } | { kind: "signed-in"; user: CoreUser };

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
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });
  const [overview, setOverview] = useState<FundScoreOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [ranking, setRanking] = useState<FundScoreRanking | null>(null);
  const [rankingError, setRankingError] = useState<string | null>(null);
  const [loadingRanking, setLoadingRanking] = useState(false);
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useState<Set<string>>(loadSaved);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const [selected, setSelected] = useState<FundScore | null>(null);

  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof CoreApiError && e.status === 401) {
      setAuth({ kind: "signed-out" });
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    coreAuth
      .me(ac.signal)
      .then((user) => setAuth({ kind: "signed-in", user }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        if (!onAuthError(e)) {
          setAuth({ kind: "signed-out" });
          setOverviewError(`Could not reach the data service: ${errorText(e)}`);
        }
      });
    return () => ac.abort();
  }, [onAuthError]);

  useEffect(() => {
    if (auth.kind !== "signed-in") return;
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
  }, [auth.kind, onAuthError]);

  const categoryKey = params.get("c") ?? overview?.categories[0]?.key ?? null;

  useEffect(() => {
    if (auth.kind !== "signed-in" || !categoryKey) return;
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
  }, [auth.kind, categoryKey, onAuthError]);

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

  if (auth.kind === "checking") {
    return <div className="px-6 py-10 text-sm text-muted">Loading…</div>;
  }
  if (auth.kind === "signed-out") {
    return <CoreSignIn error={overviewError} onSignedIn={(user) => setAuth({ kind: "signed-in", user })} />;
  }

  const run = ranking?.run ?? overview?.run;
  const funds = ranking?.funds ?? [];
  const counts = overview?.categories.find((c) => c.key === categoryKey);
  const shortlisted = funds.filter((f) => f.status === "shortlist").length;

  return (
    <div className="min-w-0 flex-1 bg-[#EEF4FB] px-4 pb-24 pt-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-eyebrow text-muted">Funds</p>
          <h1 className="font-display text-[28px] font-semibold tracking-display text-ink">Fund Rankings</h1>
          <p className="mt-1 max-w-measure text-[13px] text-ink-2">
            Direct Growth plans ranked within their category.
            {run && <> Scored {formatDate(run.as_of)}.</>}
          </p>
        </div>
        {weights.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
            <span className="text-muted">Score =</span>
            {weights.map((m, i) => (
              <span key={m.id} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted">+</span>}
                <span className="rounded-full border border-line bg-paper px-2 py-0.5">
                  {m.id.startsWith("rolling") ? "Rolling return 10Y" : m.id.startsWith("sharpe") ? "Sharpe" : "Expense"}{" "}
                  <span className="font-mono font-semibold">{Math.round(m.share * 100)}%</span>
                </span>
              </span>
            ))}
            <span className="text-muted">· shortlist at {ranking?.category.cutoff ?? 75}+</span>
          </div>
        )}
      </header>

      <div className="overflow-hidden rounded-lg border border-line bg-paper shadow-md">
        {/* Category tabs */}
        <nav className="flex overflow-x-auto border-b border-line" aria-label="Fund categories">
          {overview?.categories.map((c) => {
            const active = c.key === categoryKey;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => selectCategory(c.key)}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-[88px] shrink-0 flex-col items-center gap-1 border-b-2 px-3 pb-2.5 pt-3 text-xs transition-colors duration-100 ease-in ${
                  active ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                <CategoryIcon categoryKey={c.key} />
                <span className="max-w-[110px] truncate" title={c.name}>
                  {c.name}
                </span>
              </button>
            );
          })}
          {!overview && !overviewError && <div className="px-4 py-4 text-xs text-muted">Loading categories…</div>}
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
      </div>

      {ranking && shortlisted > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center lg:pl-60">
          <button
            type="button"
            onClick={() => setShortlistOnly((v) => !v)}
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper shadow-xl transition-transform duration-100 ease-cta hover:scale-[1.02]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d={shortlistOnly ? "M5 12h14" : "M7 13l5-5 5 5M7 18l5-5 5 5"} />
            </svg>
            {shortlistOnly ? `Show all ${funds.length}` : `View shortlist (${shortlisted})`}
          </button>
        </div>
      )}

      {selected && ranking && (
        <FundDetailPanel fund={selected} ranking={ranking} saved={saved.has(selected.scheme_code)} onToggleSaved={toggleSaved} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
