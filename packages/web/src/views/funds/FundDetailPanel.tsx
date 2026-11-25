import { useEffect } from "react";
import type { FundScore, FundScoreRanking } from "../../lib/coreApi.js";
import { Pill } from "../../components/ui/Pill.js";
import { BookmarkIcon, CheckIcon, CloseIcon } from "./fundIcons.js";
import {
  FILTER_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  formatAum,
  formatDate,
  formatMetric,
  formatPct,
  metricLabel,
} from "./fundFormat.js";

// Everything behind one row: why it has its status, how each scored metric
// contributed, and the figures shown but not scored.
export function FundDetailPanel({
  fund,
  ranking,
  saved,
  onToggleSaved,
  onClose,
}: {
  fund: FundScore;
  ranking: FundScoreRanking;
  saved: boolean;
  onToggleSaved: (code: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const metrics = ranking.category.metrics;
  const scored = metrics.filter((m) => m.weight > 0);
  const total = scored.reduce((s, m) => s + m.weight, 0);
  const shown = metrics.filter((m) => m.weight === 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={fund.name}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-paper shadow-xl">
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-paper px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{fund.amc}</p>
            <h2 className="font-display text-lg font-semibold leading-tight text-ink">{fund.name}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {ranking.category.name} · scheme {fund.scheme_code}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onToggleSaved(fund.scheme_code)}
            aria-pressed={saved}
            aria-label={saved ? "Remove from saved" : "Save fund"}
            className={`rounded-sm p-1.5 hover:bg-paper-2 ${saved ? "text-ink" : "text-muted"}`}
          >
            <BookmarkIcon filled={saved} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-sm p-1.5 text-muted hover:bg-paper-2 hover:text-ink">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {/* Headline */}
          <div className="grid grid-cols-3 divide-x divide-line border border-line">
            <div className="px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Rank</p>
              <p className="mt-1 font-display text-2xl tabular-nums text-ink">{fund.rank ?? "–"}</p>
              <p className="text-[11px] text-muted">{fund.ranked_of ? `of ${fund.ranked_of} ranked` : "unranked"}</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Score</p>
              <p className="mt-1 font-display text-2xl tabular-nums text-ink">{fund.composite == null ? "–" : fund.composite.toFixed(1)}</p>
              <p className="text-[11px] text-muted">cutoff {ranking.category.cutoff}</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Status</p>
              <Pill tone={STATUS_TONE[fund.status]} className="mt-2 whitespace-nowrap">
                {STATUS_LABEL[fund.status]}
              </Pill>
            </div>
          </div>

          {fund.status === "incomplete" && (
            <p className="rounded-sm bg-paper-2 px-3 py-2 text-[13px] text-ink-2">
              Not scored: no {fund.missing.map(metricLabel).join(", ").toLowerCase()}.
              {fund.missing.some((m) => m.startsWith("rolling_return_10y")) && " The fund needs about 10 years of history."}
            </p>
          )}

          {/* Hard filters */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-muted">Hard filters</h3>
            <ul className="divide-y divide-line border border-line">
              {fund.filters.map((fl) => (
                <li key={fl.name} className="flex gap-2.5 px-3 py-2">
                  <span className={`mt-0.5 ${fl.ok ? "text-brand-700" : "text-danger-500"}`}>
                    <CheckIcon ok={fl.ok} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-ink">{FILTER_LABEL[fl.name] ?? fl.name}</span>
                    <span className="block text-xs text-ink-2">{fl.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Score breakdown */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-muted">Score breakdown</h3>
            <div className="space-y-3">
              {scored.map((m) => {
                const p = fund.percentiles[m.id];
                const fb = fund.fallbacks[m.id];
                return (
                  <div key={m.id}>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-ink">
                        {metricLabel(m.id)}
                        <span className="ml-1.5 text-xs text-muted">{Math.round((m.weight / total) * 100)}% weight</span>
                      </span>
                      <span className="tabular-nums text-ink-2">{formatMetric(m.id, fund.metrics[m.id])}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-paper-3">
                        <div className="h-full bg-brand-500" style={{ width: `${p ?? 0}%` }} />
                      </div>
                      <span className="w-14 text-right text-xs tabular-nums text-muted">{p == null ? "–" : `${Math.round(p)} pctl`}</span>
                    </div>
                    {fb != null && (
                      <p className="mt-1 text-xs text-ink-2">
                        The vendor has no {m.years}-year figure; the {fb}-year one is used.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Shown, not scored */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-muted">Other measures (not scored)</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {shown.map((m) => (
                <div key={m.id} className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
                  <dt className="text-ink-2">{metricLabel(m.id)}</dt>
                  <dd className="tabular-nums text-ink">{formatMetric(m.id, fund.metrics[m.id])}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Facts */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-eyebrow text-muted">Fund</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Fact label="AUM" value={formatAum(fund.facts.aum_cr)} />
              <Fact label="Expense ratio" value={fund.facts.ter_direct == null ? "–" : `${fund.facts.ter_direct.toFixed(2)}%`} />
              <Fact label="Launched" value={formatDate(fund.facts.launch_date)} />
              <Fact label="Returns as of" value={formatDate(fund.facts.returns_as_of)} />
              {(["1y", "3y", "5y", "10y"] as const).map((p) => (
                <Fact key={p} label={`Return ${p.toUpperCase()} (CAGR)`} value={formatPct(fund.facts.returns[p])} />
              ))}
            </dl>
          </section>

          <p className="text-[11px] leading-relaxed text-muted">
            Percentiles compare the fund with the other {ranking.category.name} funds that have the figure. Data: MF APIs, scored{" "}
            {formatDate(ranking.run.as_of)}.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}
