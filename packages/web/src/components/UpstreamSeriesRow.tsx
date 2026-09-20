// One upstream series, rendered as whichever of TWO widgets matches how
// that series actually enters the score's arithmetic:
//
//   percentile - its OWN percentile is an input. Show the distribution
//                strip AND the number.
//   raw        - only its latest VALUE is used (an operand of a
//                derivation, or a rubric input). Show the number alone.
//
// Why this exists: the decision used to be made per-CELL, from
// scoreState.transform, and applied to every leg. That is wrong whenever
// a "percentile" cell ranks a DERIVED quantity rather than a leg — which
// is the common case here, not the exception. l1.debt::valuation ranks
// (gsec_10y - cpi_yoy), so neither leg's own percentile is an input, yet
// the panel drew a strip for each: gsec_10y showed the 29th percentile
// next to a score of 70, and cpi_yoy — which has too few stored rows to
// percentile — rendered an empty strip that read as "no data" for a cell
// that is perfectly healthy. Both confirmed live 2026-09-19.
//
// The per-series truth lives in scoreMap.ts (seriesRole), so the UI reads
// it rather than re-deriving it from a cell-level flag.
import type { SeriesState } from "@wayfinder/engine";
import { DistributionStrip } from "./DistributionStrip.js";

function formatSeriesValue(series: SeriesState | undefined): string {
  if (!series || series.latest === null) return "-";
  return series.latest.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function UpstreamSeriesRow({
  id,
  series,
  role,
  detail,
}: {
  id: string;
  series: SeriesState | undefined;
  role: "percentile" | "raw";
  // When true, renders the taller variant used in the calculation
  // inspector (source line + observation count) rather than the compact
  // sidebar variant.
  detail?: React.ReactNode;
}) {
  const showStrip = role === "percentile";
  const pct = series?.percentile;
  const hasPct = pct !== null && pct !== undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] text-ink-2">{id}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted">
          {showStrip ? (hasPct ? `${pct.toFixed(0)}th pct` : "—") : formatSeriesValue(series)}
        </span>
      </div>
      {detail}
      {showStrip && (
        <div className="mt-1">
          <DistributionStrip percentile={pct ?? null} />
        </div>
      )}
    </div>
  );
}
