import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { FundScore, FundScoreRanking } from "../../lib/coreApi.js";
import { BookmarkIcon, LaurelRank, SortIcon, StatusGlyph } from "./fundIcons.js";
import { STATUS_LABEL, STATUS_TILE, columnPercentiles, formatAum, formatPct, heatClass } from "./fundFormat.js";

type Dir = "asc" | "desc";

interface Column {
  key: string;
  group: string;
  label: string;
  title: string;
  value: (f: FundScore) => number | null | undefined;
  /** 0-100, 100 best; null leaves the tile grey. */
  heat?: (f: FundScore) => number | null | undefined;
  render: (f: FundScore) => ReactNode;
}

const RETURN_PERIODS = ["1y", "3y", "5y", "10y"] as const;

function pctTile(v: number | undefined) {
  return v == null ? "–" : Math.round(v).toString();
}

function buildColumns(funds: FundScore[]): Column[] {
  const rolling = RETURN_PERIODS.map((p) => {
    const id = `rolling_return_${p}`;
    const heat = columnPercentiles(funds, (f) => f.metrics[id]);
    return {
      key: `rr_${p}`,
      group: "Rolling Returns",
      label: p.toUpperCase(),
      title: `Average of the monthly trailing ${p.toUpperCase()} return (Direct) over the last 36 months`,
      value: (f: FundScore) => f.metrics[id],
      heat: (f: FundScore) => heat.get(f.scheme_code),
      render: (f: FundScore) => formatPct(f.metrics[id]),
    };
  });
  const trailing = RETURN_PERIODS.map((p) => {
    const heat = columnPercentiles(funds, (f) => f.facts.returns[p]);
    return {
      key: `tr_${p}`,
      group: "Trailing Returns",
      label: p.toUpperCase(),
      title: `Latest trailing ${p.toUpperCase()} return (CAGR, Direct)`,
      value: (f: FundScore) => f.facts.returns[p],
      heat: (f: FundScore) => heat.get(f.scheme_code),
      render: (f: FundScore) => formatPct(f.facts.returns[p]),
    };
  });
  const terHeat = columnPercentiles(funds, (f) => f.facts.ter_direct, false);
  const pctCol = (key: string, label: string, title: string, metric: string): Column => ({
    key,
    group: "Scores",
    label,
    title,
    value: (f) => f.percentiles[metric],
    heat: (f) => f.percentiles[metric],
    render: (f) => (
      <span className="relative">
        {pctTile(f.percentiles[metric])}
        {f.fallbacks[metric] != null && (
          <sup
            className="absolute -right-4 -top-1 font-sans text-[9px] font-semibold text-indigo"
            title={`No ${metric.replace(/.*_/, "")} value from the vendor; the ${f.fallbacks[metric]}-year figure is used`}
          >
            {f.fallbacks[metric]}Y
          </sup>
        )}
      </span>
    ),
  });
  return [
    {
      key: "overall",
      group: "Scores",
      label: "Overall",
      title: "Composite score, 0-100: weighted percentiles within the category",
      value: (f) => f.composite,
      heat: (f) => f.composite,
      render: (f) => (f.composite == null ? "–" : Math.round(f.composite).toString()),
    },
    pctCol("p_return", "Return", "Percentile of the 10-year rolling return in the category (100 = best)", "rolling_return_10y"),
    pctCol("p_sharpe", "Risk-adj.", "Percentile of the Sharpe ratio in the category (100 = best)", "sharpe_10y"),
    pctCol("p_cost", "Cost", "Percentile of the Direct expense ratio in the category (100 = cheapest)", "expense_ratio"),
    pctCol("p_consistency", "Consistency", "Percentile of the share of months the 10-year return beat the benchmark", "consistency_10y"),
    ...rolling,
    ...trailing,
    {
      key: "aum",
      group: "Fund",
      label: "AUM",
      title: "Assets under management, ₹ crore",
      value: (f) => f.facts.aum_cr,
      render: (f) => formatAum(f.facts.aum_cr).replace(" cr", ""),
    },
    {
      key: "ter",
      group: "Fund",
      label: "Expense",
      title: "Direct plan expense ratio (TER)",
      value: (f) => f.facts.ter_direct,
      heat: (f) => terHeat.get(f.scheme_code),
      render: (f) => (f.facts.ter_direct == null ? "–" : `${f.facts.ter_direct.toFixed(2)}%`),
    },
  ];
}

const GROUP_ORDER = ["Scores", "Rolling Returns", "Trailing Returns", "Fund"];

export function RankingTable({
  ranking,
  saved,
  onToggleSaved,
  shortlistOnly,
  onSelect,
  selectedCode,
}: {
  ranking: FundScoreRanking;
  saved: Set<string>;
  onToggleSaved: (code: string) => void;
  shortlistOnly: boolean;
  onSelect: (f: FundScore) => void;
  selectedCode: string | null;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Dir }>({ key: "rank", dir: "asc" });
  const columns = useMemo(() => buildColumns(ranking.funds), [ranking.funds]);

  const rows = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    const value = sort.key === "rank" ? (f: FundScore) => f.rank : (col?.value ?? (() => null));
    const list = ranking.funds.filter((f) => !shortlistOnly || f.status === "shortlist");
    const cmp = (a: FundScore, b: FundScore) => {
      const sa = saved.has(a.scheme_code);
      const sb = saved.has(b.scheme_code);
      if (sa !== sb) return sa ? -1 : 1; // saved funds stay on top, as "Your fund" does
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1; // missing values always last
      if (vb == null) return -1;
      if (va !== vb) return sort.dir === "asc" ? va - vb : vb - va;
      return a.name.localeCompare(b.name);
    };
    return [...list].sort(cmp);
  }, [columns, ranking.funds, saved, shortlistOnly, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "rank" ? "asc" : "desc" }));

  const groups = GROUP_ORDER.map((g) => ({ name: g, cols: columns.filter((c) => c.group === g) }));
  const th = "border-b border-line bg-paper px-1 text-center font-normal";

  return (
    <div className="max-h-[calc(100vh-260px)] min-h-[320px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th rowSpan={2} className={`${th} sticky left-0 z-30 w-[220px] min-w-[132px] border-r px-3 sm:min-w-[200px] sm:px-4 py-2 text-left align-top`}>
              <div className="font-semibold text-ink">{ranking.funds.length} funds</div>
              <div className="text-xs text-muted underline decoration-line underline-offset-2">{ranking.category.name}</div>
            </th>
            <th colSpan={2} className={`${th} border-r pt-3 text-[13px] font-semibold text-ink`}>
              Rank &amp; Status
            </th>
            {groups.map((g) => (
              <th key={g.name} colSpan={g.cols.length} className={`${th} border-r pt-3 text-[13px] font-semibold text-ink last:border-r-0`}>
                {g.name}
              </th>
            ))}
          </tr>
          <tr>
            <th colSpan={2} className={`${th} border-r pb-2 pt-1`}>
              <button
                type="button"
                onClick={() => toggle("rank")}
                className="text-[11px] font-semibold text-indigo hover:underline"
                title="Sort by rank in category"
              >
                {sort.key === "rank" && sort.dir === "desc" ? "Low to high" : "High to low"}
                <SortIcon dir={sort.key === "rank" ? sort.dir : null} />
              </button>
            </th>
            {groups.map((g) => (
              <Fragment key={g.name}>
                {g.cols.map((c, i) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} className={`${th} pb-2 pt-1 ${i === g.cols.length - 1 ? "border-r last:border-r-0" : ""}`}>
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        title={c.title}
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] transition-colors duration-100 ${
                          active ? "bg-paper-2 font-semibold text-ink ring-1 ring-line" : "text-muted hover:text-ink"
                        }`}
                      >
                        {c.label}
                        <SortIcon dir={active ? sort.dir : null} />
                      </button>
                    </th>
                  );
                })}
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const isSaved = saved.has(f.scheme_code);
            const isSelected = f.scheme_code === selectedCode;
            const tile = STATUS_TILE[f.status];
            return (
              <tr
                key={f.scheme_code}
                onClick={() => onSelect(f)}
                className={`group cursor-pointer ${isSelected ? "[&>td]:bg-lilac/40" : ""}`}
              >
                <td
                  className={`sticky left-0 z-10 border-b border-r border-line px-3 py-1.5 ${
                    isSaved ? "bg-[#F2F5FF]" : "bg-paper"
                  } group-hover:bg-paper-2`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSaved(f.scheme_code);
                      }}
                      aria-pressed={isSaved}
                      aria-label={isSaved ? `Remove ${f.name} from saved` : `Save ${f.name}`}
                      className={`mt-0.5 shrink-0 ${isSaved ? "text-indigo" : "text-muted hover:text-ink"}`}
                    >
                      <BookmarkIcon filled={isSaved} />
                    </button>
                    <div className="min-w-0">
                      {isSaved && <div className="text-[11px] font-semibold leading-tight text-indigo">Saved</div>}
                      <div className="line-clamp-2 text-[12px] leading-snug text-ink sm:text-[13px]" title={`${f.name} · ${f.amc}`}>
                        {f.name}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="border-b border-line p-[2px]">
                  <div className={`flex h-12 min-w-[64px] items-center justify-center rounded-sm ${tile}`}>
                    <LaurelRank rank={f.rank} />
                  </div>
                </td>
                <td className="border-b border-r border-line p-[2px]">
                  <div
                    className={`flex h-12 min-w-[118px] items-center justify-center gap-1.5 rounded-sm px-2 text-[12px] font-semibold ${tile}`}
                    title={statusTitle(f)}
                  >
                    <StatusGlyph status={f.status} />
                    {STATUS_LABEL[f.status]}
                  </div>
                </td>
                {groups.map((g) => (
                  <Fragment key={g.name}>
                    {g.cols.map((c, i) => (
                      <td key={c.key} className={`border-b border-line p-[2px] ${i === g.cols.length - 1 ? "border-r last:border-r-0" : ""}`}>
                        <div
                          className={`flex h-12 min-w-[58px] items-center justify-center rounded-sm px-1.5 font-mono text-[12.5px] tabular-nums ${
                            c.heat ? heatClass(c.heat(f)) : "bg-paper-2 text-ink-2"
                          }`}
                        >
                          {c.render(f)}
                        </div>
                      </td>
                    ))}
                  </Fragment>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={99} className="px-5 py-10 text-center text-sm text-muted">
                No funds to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function statusTitle(f: FundScore): string {
  switch (f.status) {
    case "shortlist":
      return "Passes every hard filter and scores at or above the cutoff";
    case "below_cutoff":
      return "Passes the hard filters but scores below the cutoff";
    case "filtered_out":
      return `Fails: ${f.filters
        .filter((x) => !x.ok)
        .map((x) => x.detail)
        .join("; ")}`;
    default:
      return `Not scored: no ${f.missing.join(", ")}`;
  }
}
