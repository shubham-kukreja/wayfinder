import { useEffect, useState } from "react";
import { coreFetch, pathKey } from "../lib/coreApi.js";

// How a series' value was formed, from core (GET /v1/series/{key}/explain):
// the formula, its inputs' latest readings, each part worked through, and
// the final arithmetic. Generated from each primitive, never hand-written.

export interface Explanation {
  key: string;
  score: number | null;
  sources: string[];
  observed: string | null;
  freshness: "fresh" | "stale" | "missing";
  formula: string;
  inputs: Array<{ key: string; label: string; value: number | string | boolean | null; unit?: string; source?: string; observed?: string }>;
  parts: Array<{ id: string; title: string; result: number | null; direction?: string; steps: string[] }>;
  final: string;
  notes: string[];
}

export function useExplanation(key: string | null): { data: Explanation | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: Explanation | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (!key) return;
    const ac = new AbortController();
    setState({ data: null, error: null, loading: true });
    coreFetch<Explanation>(`/v1/series/${pathKey(key)}/explain`, {}, ac.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (!ac.signal.aborted) setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false });
      });
    return () => ac.abort();
  }, [key]);
  return state;
}

function fmt(v: number | string | boolean | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit && unit !== "score" ? ` ${unit}` : ""}`;
  return String(v);
}

export function ExplainBreakdown({ explanation }: { explanation: Explanation }) {
  const e = explanation;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Formula</p>
        <p className="mt-1 break-words font-mono text-[13px] text-ink">{e.formula}</p>
      </div>

      {e.inputs.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Inputs</p>
          <ul className="mt-1.5 divide-y divide-line rounded-sm border border-line">
            {e.inputs.map((i) => (
              <li key={i.key} className="flex items-baseline justify-between gap-4 px-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block text-ink">{i.label}</span>
                  <span className="block font-mono text-[11px] text-muted">{i.key}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono tabular-nums text-ink">{fmt(i.value, i.unit)}</span>
                  <span className="block text-[11px] text-muted">
                    {[i.source, i.observed].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {e.parts.map((p) => (
        <div key={p.id}>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[13px] font-semibold text-ink">{p.title}</p>
            <p className="font-mono text-[13px] tabular-nums text-ink">{fmt(p.result)}</p>
          </div>
          <ol className="mt-1.5 space-y-1 border-l-2 border-line pl-3">
            {p.steps.map((s, i) => (
              <li key={i} className="font-mono text-[12px] leading-5 text-ink-2">
                {s}
              </li>
            ))}
          </ol>
        </div>
      ))}

      <div className="rounded-sm bg-paper-2 px-3 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Result</p>
        <p className="mt-1 font-mono text-[14px] font-semibold text-ink">{e.final}</p>
      </div>

      {e.notes.length > 0 && (
        <ul className="space-y-1">
          {e.notes.map((n, i) => (
            <li key={i} className="text-[12px] text-warn-600">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
