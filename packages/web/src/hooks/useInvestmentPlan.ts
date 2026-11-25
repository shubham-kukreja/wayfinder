import { useEffect, useMemo, useState } from "react";
import type { Allocation } from "@wayfinder/engine";
import { segmentColor } from "../components/AllocationBar.js";
import { listDefaultFunds } from "../lib/backtestApi.js";
import { candidatesFor, planLines, sleeveCategory, type FundChoice, type PlanLine } from "../lib/clients.js";
import { fundScoresApi, type FundScore } from "../lib/coreApi.js";
import { useCoreAllocation } from "./useCoreAllocation.js";

export interface PlannedLine extends PlanLine {
  fund: FundChoice | null;
  /** Ranked alternatives for the sleeve, best first. */
  options: FundChoice[];
  /** The sleeve's default fund, for sleeves with no ranking. */
  fallback: FundChoice | null;
  overridden: boolean;
}

/**
 * An amount split over the model allocation (published, else the draft), one
 * fund per sleeve: the top of the sleeve's Fund Rankings shortlist unless
 * the user picked another. Lines come largest amount first.
 */
export function useInvestmentPlan(amount: number) {
  const { data, allocation, loading, error } = useCoreAllocation();
  const [rankings, setRankings] = useState<Record<string, FundScore[]>>({});
  const [defaults, setDefaults] = useState<Record<string, FundChoice>>({});
  const [fundsLoading, setFundsLoading] = useState(true);
  const [picks, setPicks] = useState<Record<string, FundChoice>>({});

  // Sleeves do not depend on the amount, so categories load once.
  const categoryKeys = useMemo(() => categoriesFor(allocation), [allocation]);
  useEffect(() => {
    if (!allocation) return;
    const ac = new AbortController();
    setFundsLoading(true);
    Promise.all([
      Promise.all(
        categoryKeys.map((k) =>
          fundScoresApi
            .category(k, ac.signal)
            .then((r) => [k, r.funds] as const)
            .catch(() => [k, [] as FundScore[]] as const),
        ),
      ),
      listDefaultFunds().catch(() => []),
    ]).then(([pairs, ds]) => {
      if (ac.signal.aborted) return;
      setRankings(Object.fromEntries(pairs));
      setDefaults(Object.fromEntries(ds.map((d) => [d.sleeveId, { schemeCode: d.schemeCode, schemeName: d.schemeName, source: "default" as const }])));
      setFundsLoading(false);
    });
    return () => ac.abort();
  }, [allocation, categoryKeys]);

  const lines: PlannedLine[] = useMemo(() => {
    if (!allocation) return [];
    return planLines(allocation, amount, (id) => segmentColor(id, allocation)).map((l) => {
      const cat = sleeveCategory(l.sleeve);
      const options = cat ? candidatesFor(l.sleeve, rankings[cat.category] ?? []) : [];
      const fallback = defaults[l.sleeve] ?? null;
      const pick = picks[l.sleeve];
      return { ...l, options, fallback, fund: pick ?? options[0] ?? fallback, overridden: !!pick };
    });
  }, [allocation, amount, rankings, defaults, picks]);

  return {
    allocation,
    version: data?.version ?? null,
    lines,
    loading: loading || (!!allocation && fundsLoading),
    error,
    pick: (sleeve: string, f: FundChoice) => setPicks((p) => ({ ...p, [sleeve]: f })),
    reset: (sleeve: string) =>
      setPicks((p) => {
        const next = { ...p };
        delete next[sleeve];
        return next;
      }),
  };
}

function categoriesFor(allocation: Allocation | null): string[] {
  if (!allocation) return [];
  const keys = new Set<string>();
  for (const r of allocation.rollup) {
    const c = sleeveCategory(r.id);
    if (c) keys.add(c.category);
  }
  return [...keys].sort();
}
