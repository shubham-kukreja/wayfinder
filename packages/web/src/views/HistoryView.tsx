import { useEffect, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { DistributionStrip } from "../components/DistributionStrip.js";
import { formatScore } from "../lib/format.js";
import { listReviews, saveReview, type ReviewListItem } from "../lib/reviewsApi.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function HistoryView({ snapshot }: { snapshot: Snapshot }) {
  const series = Object.values(snapshot.series).sort((a, b) => a.id.localeCompare(b.id));

  const [reviews, setReviews] = useState<ReviewListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  function refreshReviews() {
    listReviews()
      .then(setReviews)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    refreshReviews();
  }, []);

  async function handleStartReview() {
    setSaving(true);
    setSaveError(null);
    try {
      await saveReview(label.trim() || null);
      setLabel("");
      refreshReviews();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold text-neutral-900">History & Review</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Series distributions, saved reviews, and the audit trail. Refreshing data is not saving a review — only saved reviews become the baseline for future comparison.
      </p>

      <section className="mb-10 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-800">Saved reviews</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label"
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700"
            />
            <button
              onClick={handleStartReview}
              disabled={saving}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Start a review"}
            </button>
          </div>
        </div>

        {saveError && <p className="mb-2 text-xs text-rose-600">Failed to save: {saveError}</p>}
        {loadError && <p className="mb-2 text-xs text-rose-600">Failed to load reviews: {loadError}</p>}

        {reviews === null && !loadError && <p className="text-sm text-neutral-400">Loading…</p>}

        {reviews && reviews.length === 0 && (
          <p className="text-sm text-neutral-400">
            No reviews saved yet. Starting one freezes the current state as an immutable snapshot with notes — that becomes the baseline the Drivers surface compares against.
          </p>
        )}

        {reviews && reviews.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {reviews.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-neutral-700">{r.label ?? <span className="italic text-neutral-400">Unlabelled</span>}</span>
                <span className="text-xs text-neutral-400">{formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
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
