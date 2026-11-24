import { useEffect, useState } from "react";
import type { Allocation } from "@wayfinder/engine";
import { loadPortfolioAllocation, toAllocation, type PortfolioAllocation } from "../lib/portfolioApi.js";

// Core's allocation as Overview shows it (published, else the draft), shared
// by the note editor and its widgets: one request per page load, not one
// per widget.
let cached: Promise<PortfolioAllocation> | null = null;

function load(): Promise<PortfolioAllocation> {
  if (!cached) {
    cached = loadPortfolioAllocation()
      .then((r) => r.data)
      .catch((err: unknown) => {
        cached = null; // let a later mount retry
        throw err;
      });
  }
  return cached;
}

export function useCoreAllocation(): { data: PortfolioAllocation | null; allocation: Allocation | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ data: PortfolioAllocation | null; allocation: Allocation | null; loading: boolean; error: string | null }>({
    data: null,
    allocation: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setState({ data, allocation: toAllocation(data), loading: false, error: null }))
      .catch((err: unknown) => live && setState({ data: null, allocation: null, loading: false, error: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
