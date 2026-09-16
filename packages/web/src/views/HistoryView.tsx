import { useEffect, useState } from "react";
import type { Snapshot } from "@wayfinder/engine";
import { computeAllocation } from "@wayfinder/engine";
import { DistributionStrip } from "../components/DistributionStrip.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { formatScore } from "../lib/format.js";
import {
  getDraftStatus,
  listReviews,
  publishReview,
  saveReview,
  getReview,
  deleteReview,
  type DraftStatus,
  type ReviewListItem,
} from "../lib/reviewsApi.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function HistoryView({ snapshot }: { snapshot: Snapshot }) {
  const series = Object.values(snapshot.series).sort((a, b) => a.id.localeCompare(b.id));

  const [reviews, setReviews] = useState<ReviewListItem[] | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [loadedReview, setLoadedReview] = useState<{ id: string; item: ReviewListItem; snapshot: Snapshot } | null>(null);
  const [loadingReviewId, setLoadingReviewId] = useState<string | null>(null);
  const [loadReviewError, setLoadReviewError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function refreshReviews() {
    listReviews()
      .then(setReviews)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    getDraftStatus()
      .then(setDraftStatus)
      .catch(() => setDraftStatus(null));
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

  async function handleLoadReview(item: ReviewListItem) {
    setLoadingReviewId(item.id);
    setLoadReviewError(null);
    try {
      const reviewSnapshot = await getReview(item.id);
      setLoadedReview({ id: item.id, item, snapshot: reviewSnapshot });
    } catch (err) {
      setLoadReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReviewId(null);
    }
  }

  async function handleDeleteReview(item: ReviewListItem) {
    const confirmed = window.confirm(
      `Delete ${item.published ? "published version" : "review"} "${item.label ?? "Unlabelled"}" from ${formatDate(item.createdAt)}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(item.id);
    setDeleteError(null);
    try {
      await deleteReview(item.id);
      if (loadedReview?.id === item.id) setLoadedReview(null);
      refreshReviews();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setSaveError(null);
    setPublishMessage(null);
    try {
      const result = await publishReview(label.trim() || null, reason.trim() || undefined);
      setLabel("");
      setReason("");
      setPublishMessage(`Published ${result.diff.totalChanges} changed input${result.diff.totalChanges === 1 ? "" : "s"}.`);
      refreshReviews();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-1 font-display text-xl font-extrabold tracking-tight text-neutral-900">Reviews & Audit</h1>
      <p className="mb-8 text-sm text-neutral-500">
        Published allocation versions, saved reviews, data distributions, and the audit trail. Refreshing data is not publishing a model version.
      </p>

      <section className="mb-10 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">Version actions</h2>
            <p className="mt-1 text-xs text-neutral-400">Save freezes a review. Publish creates a versioned baseline for audit.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label"
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700"
            />
            <button
              onClick={handleStartReview}
              disabled={saving || publishing}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-black transition duration-100 ease-in hover:brightness-105 hover:-translate-y-px disabled:opacity-50"
            >
              {saving ? "Saving…" : "Start a review"}
            </button>
            <button
              onClick={handlePublish}
              disabled={saving || publishing}
              className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-xs font-medium text-ink hover:bg-neutral-100 disabled:opacity-50"
            >
              {publishing ? "Publishing…" : "Publish version"}
            </button>
          </div>
        </div>

        {saveError && <p className="mb-2 text-xs text-danger-500">Failed to save: {saveError}</p>}
        {publishMessage && <p className="mb-2 text-xs text-brand-800">{publishMessage}</p>}
        {loadError && <p className="mb-2 text-xs text-danger-500">Failed to load reviews: {loadError}</p>}
        {loadReviewError && <p className="mb-2 text-xs text-danger-500">Failed to load review: {loadReviewError}</p>}
        {deleteError && <p className="mb-2 text-xs text-danger-500">Failed to delete: {deleteError}</p>}

        {reviews === null && !loadError && <p className="text-sm text-neutral-400">Loading…</p>}

        {reviews && reviews.length === 0 && (
          <p className="text-sm text-neutral-400">
            No reviews saved yet. Starting one freezes the current state as an immutable snapshot with notes — that becomes the baseline the Drivers surface compares against.
          </p>
        )}

        {reviews && reviews.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {reviews.map((r) => (
              <li key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-neutral-700">{r.label ?? <span className="italic text-neutral-400">Unlabelled</span>}</span>
                    {r.published ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800">Published</span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">Review</span>
                    )}
                    {loadedReview?.id === r.id && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">Viewing</span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-xs text-neutral-400">
                    {r.actor ? `Actor ${r.actor}` : "Actor unknown"}
                    {r.parentId ? ` · parent ${r.parentId.slice(0, 8)}` : ""}
                  </span>
                </span>
                <span className="whitespace-nowrap text-right text-xs text-neutral-400">{formatDate(r.createdAt)}</span>
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleLoadReview(r)}
                    disabled={loadingReviewId === r.id}
                    className="rounded-md border-[1.5px] border-ink px-2 py-1 text-xs font-medium text-ink hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {loadingReviewId === r.id ? "Loading…" : "Load"}
                  </button>
                  <button
                    onClick={() => handleDeleteReview(r)}
                    disabled={deletingId === r.id}
                    className="rounded-md border border-danger-500/40 px-2 py-1 text-xs font-medium text-danger-500 hover:bg-danger-50 disabled:opacity-50"
                  >
                    {deletingId === r.id ? "Deleting…" : "Delete"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loadedReview && (
        <section className="mb-10 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">
                Viewing: {loadedReview.item.label ?? <span className="italic text-neutral-400">Unlabelled</span>}
              </h2>
              <p className="mt-1 text-xs text-neutral-400">
                {loadedReview.item.published ? "Published version" : "Saved review"} · {formatDate(loadedReview.item.createdAt)} · read-only, frozen state
              </p>
            </div>
            <button
              onClick={() => setLoadedReview(null)}
              className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              Close
            </button>
          </div>
          <ReviewSnapshotPreview snapshot={loadedReview.snapshot} />
        </section>
      )}

      {draftStatus && (
        <section className="mb-10 rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">Unpublished draft impact</h2>
              <p className="mt-1 text-xs text-neutral-400">
                Compared with {draftStatus.hasPublishedVersion ? `published version ${draftStatus.latestPublishedId?.slice(0, 8)}` : "no published baseline yet"}.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${draftStatus.diff.totalChanges > 0 || !draftStatus.hasPublishedVersion ? "bg-amber-50 text-amber-800" : "bg-brand-50 text-brand-800"}`}>
              {draftStatus.diff.totalChanges} change{draftStatus.diff.totalChanges === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs text-neutral-400">Scores</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{draftStatus.diff.changedScores.length}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs text-neutral-400">Vetoes</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{draftStatus.diff.changedVetoes.length}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs text-neutral-400">Parameters</p>
              <p className="mt-1 text-xl font-semibold text-neutral-950">{draftStatus.diff.paramsChanged ? "Changed" : "No change"}</p>
            </div>
          </div>
          {draftStatus.diff.changedScores.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-neutral-500">Largest changed score rows</p>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {draftStatus.diff.changedScores.slice(0, 6).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                    <span className="truncate text-neutral-700">{row.id}</span>
                    <span className="shrink-0 font-mono tabular-nums text-neutral-500">
                      {row.before === null ? "-" : formatScore(row.before)} {"->"} {formatScore(row.after)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

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
                  s.status === "ok" ? "text-neutral-400" : s.status === "stale" ? "text-amber-600" : "text-danger-500"
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

// Read-only preview of a loaded review's frozen state — reuses the same
// AllocationBar the live pages render, with no onSelect handler so it's
// inert (clicking a segment does nothing, since there's no inspector
// wired to a historical snapshot's own scores). Reviews are immutable
// by design; "loading" one must never let the user edit or publish it.
function ReviewSnapshotPreview({ snapshot }: { snapshot: Snapshot }) {
  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const allocation = computeAllocation(scores, vetoes, snapshot.params);
  const activeVetoes = Object.entries(snapshot.vetoes).filter(([, veto]) => veto.active);

  return (
    <div>
      <AllocationBar allocation={allocation} depth="detail" compactLegend />
      {activeVetoes.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {activeVetoes.length} veto{activeVetoes.length === 1 ? "" : "es"} active in this snapshot.
        </p>
      )}
    </div>
  );
}
