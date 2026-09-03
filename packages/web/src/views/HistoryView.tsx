import type { Snapshot } from "@wayfinder/engine";
import { DistributionStrip } from "../components/DistributionStrip.js";
import { formatScore } from "../lib/format.js";

export function HistoryView({ snapshot }: { snapshot: Snapshot }) {
  const series = Object.values(snapshot.series).sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">History & Review</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Series distributions, saved reviews, and the audit trail. Refreshing data is not saving a review — only saved reviews become the baseline for future comparison.
      </p>

      <section className="mb-10 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-800">Saved reviews</h2>
          <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800">
            Start a review
          </button>
        </div>
        <p className="text-sm text-neutral-400">
          No reviews saved yet. Starting one freezes the current state as an immutable snapshot with notes — that becomes the baseline the Drivers surface compares against.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">Series, each within its own distribution</h2>
        <div className="space-y-3">
          {series.map((s) => (
            <div key={s.id} className="grid grid-cols-[160px_1fr_90px_60px] items-center gap-4 text-sm">
              <span className="truncate text-neutral-700">{s.id}</span>
              <DistributionStrip percentile={s.percentile} />
              <span className="text-right tabular-nums text-neutral-500">
                {s.latest !== null ? formatScore(s.latest) : "—"}
              </span>
              <span
                className={`text-right text-xs ${
                  s.status === "ok" ? "text-neutral-400" : s.status === "stale" ? "text-amber-600" : "text-rose-600"
                }`}
              >
                {s.status}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
