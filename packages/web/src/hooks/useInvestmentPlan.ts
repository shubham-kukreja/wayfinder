import { useEffect, useMemo, useState } from "react";
import type { Allocation } from "@wayfinder/engine";
import { segmentColor } from "../components/AllocationBar.js";
import { listDefaultFunds } from "../lib/backtestApi.js";
import { candidatesFor, planLines, sleeveCategory, type FundChoice, type PlanLine } from "../lib/clients.js";
import { fundScoresApi, type FundScoreRanking } from "../lib/coreApi.js";
import { useCoreAllocation } from "./useCoreAllocation.js";

/** One fund buy within a sleeve. */
export interface FundSlot {
  slot: number;
  fund: FundChoice | null;
  amount: number;
  overridden: boolean;
}

export interface PlannedLine extends PlanLine {
  funds: FundSlot[];
  /** Ranked alternatives for the sleeve, best first. */
  options: FundChoice[];
  /** The sleeve's default fund, for sleeves with no ranking. */
  fallback: FundChoice | null;
}

// A sleeve gets two funds when it is big enough to split: at least 8% of the
// plan and ₹50,000. The first fund takes 60%, the second 40%. Smaller sleeves,
// and sleeves with no ranking to pick a second from, get one fund.
const SPLIT_MIN_WEIGHT = 0.08;
const SPLIT_MIN_AMOUNT = 50_000;
const FIRST_SHARE = 0.6;

function slotAmounts(l: PlanLine, ranked: number): number[] {
  if (ranked >= 2 && l.weight >= SPLIT_MIN_WEIGHT && l.amount >= SPLIT_MIN_AMOUNT) {
    const first = Math.round((l.amount * FIRST_SHARE) / 100) * 100;
    return [first, l.amount - first];
  }
  return [l.amount];
}

/**
 * An amount split over the model allocation (published, else the draft), in
 * the model's sleeve order, with one or two funds per sleeve: the top of the
 * sleeve's Fund Rankings shortlist unless the user picked another.
 */
export function useInvestmentPlan(amount: number) {
  const { data, allocation, loading, error } = useCoreAllocation();
  const [rankings, setRankings] = useState<Record<string, FundScoreRanking | null>>({});
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
            .then((r) => [k, r] as const)
            .catch(() => [k, null] as const),
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
      const options = cat ? candidatesFor(l.sleeve, rankings[cat.category]?.funds ?? []) : [];
      const fallback = defaults[l.sleeve] ?? null;
      // Automatic picks only use funds that pass every hard filter; a fund
      // that fails one can still be chosen by hand from the rankings.
      const eligible = options.filter((o) => o.status === "shortlist" || o.status === "below_cutoff");
      const used = new Set<string>();
      const funds = slotAmounts(l, eligible.length).map((amt, slot) => {
        const pick = picks[`${l.sleeve}:${slot}`];
        const fund = pick ?? eligible.find((o) => !used.has(o.schemeCode)) ?? (slot === 0 ? (options[0] ?? fallback) : null);
        if (fund) used.add(fund.schemeCode);
        return { slot, fund, amount: amt, overridden: !!pick };
      });
      return { ...l, options, fallback, funds };
    });
  }, [allocation, amount, rankings, defaults, picks]);

  return {
    allocation,
    version: data?.version ?? null,
    lines,
    loading: loading || (!!allocation && fundsLoading),
    error,
    /** The sleeve's category ranking, narrowed to the sleeve (e.g. gold only). */
    rankingFor: (sleeve: string): FundScoreRanking | null => {
      const cat = sleeveCategory(sleeve);
      const r = cat ? rankings[cat.category] : null;
      if (!r || !cat) return null;
      return cat.match ? { ...r, funds: r.funds.filter((f) => cat.match!.test(f.name)) } : r;
    },
    pick: (sleeve: string, slot: number, f: FundChoice) => setPicks((p) => ({ ...p, [`${sleeve}:${slot}`]: f })),
    reset: (sleeve: string, slot: number) =>
      setPicks((p) => {
        const next = { ...p };
        delete next[`${sleeve}:${slot}`];
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
