import type { ReactNode } from "react";
import type { Allocation } from "@wayfinder/engine";
import { segmentSwatchStyle } from "./AllocationBar.js";
import { TabRow } from "./ui/TabRow.js";
import { formatPct, formatSignedPct } from "../lib/format.js";

// The "Sleeve allocation" widget: filter tabs over one two-line row per
// sleeve, in the model's order — swatch, name and status on the first line;
// the class descriptor, the within-group share and the neutral comparison on
// the second. Overview uses it as is; the invest flow adds the fund and the
// amount under each row (renderDetail).

export type SleeveFilter = "all" | "equity" | "debt" | "metals";

export const SLEEVE_FILTERS: Array<{ id: SleeveFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "equity", label: "Equity" },
  { id: "debt", label: "Debt" },
  { id: "metals", label: "Metals" },
];

const ROLLUP_GROUP: Record<string, SleeveFilter> = {
  "equity.large": "equity",
  "equity.mid": "equity",
  "equity.small": "equity",
  "equity.intl": "equity",
  "debt.liquid": "debt",
  "debt.corporate": "debt",
  "debt.gilt": "debt",
  "metals.gold": "metals",
  "metals.silver": "metals",
};

export const GROUP_LABEL_BY_ROLLUP: Record<string, string> = {
  "equity.large": "Equity · Large cap",
  "equity.mid": "Equity · Mid cap",
  "equity.small": "Equity · Small cap",
  "equity.intl": "Equity · International",
  "debt.liquid": "Debt · Liquid",
  "debt.corporate": "Debt · Corporate",
  "debt.gilt": "Debt · Gilt",
  "metals.gold": "Precious metals · Gold",
  "metals.silver": "Precious metals · Silver",
};

export function rollupGroup(id: string): SleeveFilter {
  if (id.startsWith("sleeve.") || id.startsWith("sector.")) return "equity";
  return ROLLUP_GROUP[id] ?? "all";
}

export function sleeveFilterFromSearch(value: string | null): SleeveFilter {
  return value === "equity" || value === "debt" || value === "metals" ? value : "all";
}

export function SleeveAllocation({
  allocation,
  filter,
  onFilter,
  title = "Sleeve allocation",
  subtitle,
  action,
  onSelect,
  renderDetail,
  renderValue,
  className = "",
}: {
  allocation: Allocation;
  filter: SleeveFilter;
  onFilter: (f: SleeveFilter) => void;
  title?: string;
  /** Defaults to "N sleeves · X% of portfolio". */
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Clicking a row (Overview opens the calculation). */
  onSelect?: (id: string) => void;
  /** Extra content under a row (the invest flow's fund and amount). */
  renderDetail?: (id: string) => ReactNode;
  /** Replaces the weight on the right of a row (e.g. weight and amount). */
  renderValue?: (id: string, weight: number) => ReactNode;
  className?: string;
}) {
  const rows = filter === "all" ? allocation.rollup : allocation.rollup.filter((r) => rollupGroup(r.id) === filter);
  const visibleWeight = rows.reduce((s, r) => s + r.portfolioWeight, 0);

  return (
    <div className={`rounded-lg border border-line bg-paper p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {subtitle ?? (
              <>
                {rows.length} sleeve{rows.length === 1 ? "" : "s"} · {formatPct(visibleWeight, 1)} of portfolio
              </>
            )}
          </p>
        </div>
        {action}
      </div>

      <TabRow options={SLEEVE_FILTERS} value={filter} onChange={onFilter} className="mb-1" />

      <div>
        {rows.map((row) => {
          const node = allocation.groups.equity.nodes[row.id] ?? allocation.groups.debt.nodes[row.id] ?? allocation.groups.metals.nodes[row.id];
          const isVetoed = !!node?.vetoActive;
          const delta = node ? node.vsNeutralFinal : null;
          const capped = node ? Math.abs(node.rawTilt - node.tilt) > 0.0005 : false;
          const head = (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-3.5 w-3.5 shrink-0" style={segmentSwatchStyle(row.id, allocation)} />
                  <span className="truncate text-[15px] text-ink">{row.label}</span>
                  {row.id.startsWith("sleeve.") && <span className="shrink-0 rounded-sm bg-lilac px-2 py-0.5 text-[11px] font-bold text-ink">Sleeve</span>}
                  {isVetoed && <span className="shrink-0 rounded-sm bg-warn-50 px-2 py-0.5 text-[11px] font-bold text-warn-800">Veto</span>}
                  {capped && (
                    <span className="shrink-0 rounded-sm bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2" title="Tilt limited by the group cap">
                      Capped
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">
                  {renderValue ? renderValue(row.id, row.portfolioWeight) : formatPct(row.portfolioWeight, 1)}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-4 pl-6">
                <span className="truncate text-[13px] text-muted">
                  {GROUP_LABEL_BY_ROLLUP[row.id] ?? "Equity · Sector sleeve"} · {formatPct(row.withinGroup, 1)} of group
                </span>
                {delta !== null && (
                  <span className="shrink-0 text-[13px] tabular-nums text-muted">
                    Neutral: {formatPct(row.portfolioWeight - delta, 1)}{" "}
                    <span className={delta >= 0 ? "text-brand-800" : "text-danger-500"}>{formatSignedPct(delta, 2)}</span>
                  </span>
                )}
              </div>
            </>
          );
          return (
            <div key={row.id} className="border-b border-line py-3 last:border-0">
              {onSelect ? (
                <button type="button" onClick={() => onSelect(row.id)} className="w-full text-left hover:bg-paper-2">
                  {head}
                </button>
              ) : (
                head
              )}
              {renderDetail && <div className="mt-3 pl-6">{renderDetail(row.id)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
