import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Snapshot } from "@wayfinder/engine";
import { NODE_LABELS, computeAllocation } from "@wayfinder/engine";
import { AllocationBar, segmentSwatchStyle } from "../components/AllocationBar.js";
import { InfoPopover } from "../components/ui/InfoPopover.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { formatPct, formatScore, formatSignedPct } from "../lib/format.js";
import {
  getDraftStatus,
  getSnapshotDiff,
  listReviews,
  publishReview,
  saveReview,
  getReview,
  deleteReview,
  revertToSnapshot,
  type DraftStatus,
  type ReviewListItem,
  type SnapshotDiff,
} from "../lib/reviewsApi.js";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Relative age carries the cadence question ("are we due?") better than an
// absolute date does, which is the whole point of §25's timeline.
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function relativeAge(iso: string): string {
  const days = daysSince(iso);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

// §25's review cadence. Each entry is a rhythm the model is supposed to keep,
// so the page can say what is due rather than only what happened.
const CADENCE = [
  { id: "monthly", label: "Data refresh / veto check", everyDays: 30 },
  { id: "quarterly", label: "Sector review", everyDays: 91 },
  { id: "semiannual", label: "Strategic allocation review", everyDays: 182 },
  { id: "annual", label: "Model sensitivity + policy review", everyDays: 365 },
] as const;

// Score ids are `${nodeId}::${signalId}`; the registry label is nicer than the
// raw id but the engine only names nodes, so this composes the two halves.
function scoreLabel(id: string): string {
  const [nodeId, signalId] = id.split("::");
  if (!signalId) return id;
  const node = (NODE_LABELS as Record<string, string>)[nodeId!] ?? nodeId!;
  const signal = signalId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${node} · ${signal}`;
}

function allocationOf(snapshot: Pick<Snapshot, "scores" | "vetoes" | "params">) {
  return computeAllocation(scoresFromSnapshot(snapshot.scores), vetoesFromSnapshot(snapshot.vetoes), snapshot.params);
}

// The three governance surfaces are routes, not tabs. Comparing-and-
// publishing is a decision made now; History reconstructs a past one; Cadence
// says what is due. Different readers on different days, so each gets a URL
// that can be linked, bookmarked and returned to.
export type GovernanceSection = "decide" | "history" | "cadence";

const SECTION_COPY: Record<GovernanceSection, { eyebrow: string; title: string; blurb: string }> = {
  decide: {
    eyebrow: "Governance",
    title: "Compare & Publish",
    blurb:
      "Everything that has changed since the last published version, and the two ways to act on it. Refreshing data is not publishing a model version.",
  },
  history: {
    eyebrow: "Governance",
    title: "History",
    blurb: "Every published version and saved review. Open one to reconstruct exactly what was held, and why.",
  },
  cadence: {
    eyebrow: "Governance",
    title: "Cadence",
    blurb: "The review rhythm the model expects, measured from the most recent entry, and what is due now.",
  },
};

export function HistoryView({ snapshot, section = "decide" }: { snapshot: Snapshot; section?: GovernanceSection }) {
  const navigate = useNavigate();
  const tab = section;

  const [reviews, setReviews] = useState<ReviewListItem[] | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [loadedReview, setLoadedReview] = useState<{ id: string; item: ReviewListItem; snapshot: Snapshot } | null>(null);
  const [loadingReviewId, setLoadingReviewId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);

  // Compare selection. `null` on the left means "nothing" (first publish);
  // "draft" on either side means current unsaved state.
  const [compareFrom, setCompareFrom] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SnapshotDiff | null>(null);
  const [comparing, setComparing] = useState(false);

  function refreshReviews() {
    listReviews()
      .then(setReviews)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    getDraftStatus()
      .then(setDraftStatus)
      .catch(() => setDraftStatus(null));
  }

  useEffect(refreshReviews, []);

  const published = useMemo(() => (reviews ?? []).filter((r) => r.published), [reviews]);
  const lastPublished = published[0] ?? null;
  const lastEntry = (reviews ?? [])[0] ?? null;

  // Default the comparison to the most useful pair on arrival: the draft
  // against the last published version, which is the question the page was
  // already answering in its old "unpublished draft impact" panel.
  //
  // The draft is always the `to` side, including before anything has ever
  // been published — gating this on a baseline existing left the one state
  // that most needs the publish action (no baseline yet) with no way to
  // reach it. With no published version, `from` simply stays null and the
  // diff runs against nothing.
  useEffect(() => {
    if (compareTo === null && reviews !== null) {
      setCompareFrom(lastPublished?.id ?? null);
      setCompareTo("draft");
    }
  }, [reviews, lastPublished, compareTo]);

  useEffect(() => {
    if (!compareTo) return;
    setComparing(true);
    getSnapshotDiff(compareTo, compareFrom)
      .then(setComparison)
      .catch((err) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => setComparing(false));
  }, [compareFrom, compareTo]);

  async function handleSaveReview() {
    setSaving(true);
    setActionError(null);
    try {
      await saveReview(label.trim() || null, reason.trim() || undefined);
      setLabel("");
      setReason("");
      setFlash("Review saved. The current state is frozen as an immutable entry.");
      refreshReviews();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setActionError(null);
    try {
      const result = await publishReview(label.trim() || null, reason.trim() || undefined);
      setLabel("");
      setReason("");
      setFlash(`Published ${result.diff.totalChanges} changed input${result.diff.totalChanges === 1 ? "" : "s"}. Overview now shows this allocation.`);
      refreshReviews();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  // Promote an already-saved review to published, freezing exactly the state
  // it captured rather than whatever the draft has become since.
  async function handlePromote(item: ReviewListItem) {
    const confirmed = window.confirm(
      `Publish "${item.label ?? "Unlabelled"}" from ${formatDateTime(item.createdAt)}?\n\nThis makes the state saved at that moment the allocation of record — not the current draft.`
    );
    if (!confirmed) return;

    setPublishing(true);
    setActionError(null);
    try {
      const result = await publishReview(null, undefined, item.id);
      setFlash(`Published "${result.label ?? "Unlabelled"}". Overview now shows that allocation.`);
      refreshReviews();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }

  // Restore the draft to an entry's authored inputs. Destructive to current
  // unsaved work, so it states plainly what survives and what does not.
  async function handleRevert(item: ReviewListItem) {
    const confirmed = window.confirm(
      `Revert the working draft to "${item.label ?? "Unlabelled"}" from ${formatDateTime(item.createdAt)}?\n\n` +
        "This restores that entry's parameters and manual overrides, discarding any you have made since. " +
        "Refreshed data is kept — auto-derived scores recompute from the observations you have now. " +
        "Nothing is published; Overview does not change."
    );
    if (!confirmed) return;

    setRevertingId(item.id);
    setActionError(null);
    try {
      const result = await revertToSnapshot(item.id);
      setFlash(
        `Draft reverted to "${item.label ?? "Unlabelled"}" — ${result.restoredManualScores} manual score${result.restoredManualScores === 1 ? "" : "s"} and ${result.restoredManualVetoes} veto${result.restoredManualVetoes === 1 ? "" : "es"} restored. Publish to make it the allocation of record.`
      );
      refreshReviews();
      // The comparison on screen was computed against the pre-revert draft.
      if (compareTo) {
        getSnapshotDiff(compareTo, compareFrom).then(setComparison).catch(() => undefined);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevertingId(null);
    }
  }

  async function handleLoadReview(item: ReviewListItem) {
    setLoadingReviewId(item.id);
    setActionError(null);
    try {
      setLoadedReview({ id: item.id, item, snapshot: await getReview(item.id) });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingReviewId(null);
    }
  }

  async function handleDeleteReview(item: ReviewListItem) {
    const confirmed = window.confirm(
      `Delete ${item.published ? "published version" : "review"} "${item.label ?? "Unlabelled"}" from ${formatDateTime(item.createdAt)}? This cannot be undone.`
    );
    if (!confirmed) return;
    setDeletingId(item.id);
    setActionError(null);
    try {
      await deleteReview(item.id);
      if (loadedReview?.id === item.id) setLoadedReview(null);
      refreshReviews();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  const draftChanges = draftStatus?.diff.totalChanges ?? 0;
  // Before anything is published there is no other side to diff against, so
  // every input reads as changed. Treated as real drift that number is
  // alarming and wrong; it is a bootstrap state, not a warning.
  const hasBaseline = draftStatus?.hasPublishedVersion ?? true;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
      {/* Masthead states the page's one distinction — looking is not
          deciding — and carries the two facts that drive every action on
          it: how stale the published baseline is, and how far the draft
          has drifted from it. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Governance</p>
            <InfoPopover label="How to use this page" title="What this page is for" align="left">
              <p>
                The model has two states. The <strong className="font-semibold text-ink">draft</strong> moves the moment you
                refresh data or change a parameter. The <strong className="font-semibold text-ink">published version</strong> is
                frozen, and it is the only thing Overview reads.
              </p>
              <p>
                Publishing moves one into the other. It exists so the allocation you act on never changes just because you were
                experimenting: looking is not deciding.
              </p>
              <div className="border-t border-line pt-2.5">
                <p>
                  <strong className="font-semibold text-ink">Compare &amp; Publish</strong> — everything changed since you last
                  published, and the two ways to act on it. This is the weekly page.{" "}
                  <strong className="font-semibold text-ink">Save review</strong> freezes a checkpoint and leaves Overview
                  alone; <strong className="font-semibold text-ink">Publish</strong> makes it the allocation of record.
                </p>
              </div>
              <p>
                <strong className="font-semibold text-ink">History</strong> — every past version and what it changed. Open one to
                reconstruct exactly what you held, and why, or publish a saved review as-is.
              </p>
              <p>
                <strong className="font-semibold text-ink">Cadence</strong> — the review rhythm the model expects, and what is
                due now.
              </p>
            </InfoPopover>
          </div>
          <h1 className="mt-1 font-display text-2xl text-ink">{SECTION_COPY[section].title}</h1>
          <p className="mt-2 max-w-3xl text-[13px] text-muted">{SECTION_COPY[section].blurb}</p>
        </div>

        {/* The draft-drift figures answer "should I publish?", which is only
            the question on the decide surface. History and Cadence are
            retrospective and would be crowded by them. */}
        {section === "decide" && (
        <div className="flex shrink-0 items-end gap-10">
          <div>
            <div className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Last published</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-ink">
                {lastPublished ? daysSince(lastPublished.createdAt) : "—"}
              </span>
              <span className="text-[13px] text-muted">{lastPublished ? "days ago" : "never published"}</span>
            </div>
          </div>

          <div className="self-stretch border-l border-line" aria-hidden="true" />

          <div>
            <div className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">Unpublished</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`font-display text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums ${
                  hasBaseline && draftChanges > 0 ? "text-warn-600" : "text-ink"
                }`}
              >
                {draftStatus === null ? "—" : draftChanges}
              </span>
              <span className="text-[13px] text-muted">
                {!hasBaseline ? "inputs, no baseline yet" : draftChanges === 1 ? "changed input" : "changed inputs"}
              </span>
            </div>
          </div>
        </div>
        )}
      </div>

      {flash && (
        <p className="mt-4 flex items-start gap-2 text-[13px] text-muted">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 bg-brand-500" />
          {flash}
        </p>
      )}
      {actionError && (
        <p className="mt-4 flex items-start gap-2 text-[13px] text-danger-500">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 bg-danger-500" />
          {actionError}
        </p>
      )}
      {loadError && <p className="mt-4 text-[13px] text-danger-500">Failed to load history: {loadError}</p>}

      {tab === "decide" && (
        <DecideTab
          reviews={reviews ?? []}
          snapshot={snapshot}
          draftStatus={draftStatus}
          comparison={comparison}
          comparing={comparing}
          from={compareFrom}
          to={compareTo}
          onFrom={setCompareFrom}
          onTo={setCompareTo}
          label={label}
          reason={reason}
          onLabel={setLabel}
          onReason={setReason}
          saving={saving}
          publishing={publishing}
          onSaveReview={handleSaveReview}
          onPublish={handlePublish}
        />
      )}

      {tab === "history" && (
        <TimelineTab
          reviews={reviews}
          loadedReview={loadedReview}
          loadingReviewId={loadingReviewId}
          deletingId={deletingId}
          onLoad={handleLoadReview}
          onDelete={handleDeleteReview}
          onClosePreview={() => setLoadedReview(null)}
          onPromote={handlePromote}
          publishing={publishing}
          onRevert={handleRevert}
          revertingId={revertingId}
          activeId={lastPublished?.id ?? null}
          onCompare={(item) => {
            setCompareFrom(item.parentId);
            setCompareTo(item.id);
            navigate("/reviews/decide");
          }}
        />
      )}

      {tab === "cadence" && <CadenceTab reviews={reviews ?? []} lastPublished={lastPublished} lastEntry={lastEntry} />}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

function TimelineTab({
  reviews,
  loadedReview,
  loadingReviewId,
  deletingId,
  onLoad,
  onDelete,
  onClosePreview,
  onPromote,
  publishing,
  onRevert,
  revertingId,
  activeId,
  onCompare,
}: {
  reviews: ReviewListItem[] | null;
  loadedReview: { id: string; item: ReviewListItem; snapshot: Snapshot } | null;
  loadingReviewId: string | null;
  deletingId: string | null;
  onLoad: (item: ReviewListItem) => void;
  onDelete: (item: ReviewListItem) => void;
  onClosePreview: () => void;
  onPromote: (item: ReviewListItem) => void;
  publishing: boolean;
  onRevert: (item: ReviewListItem) => void;
  revertingId: string | null;
  activeId: string | null;
  onCompare: (item: ReviewListItem) => void;
}) {
  if (reviews === null) return <p className="mt-6 text-[13px] text-muted">Loading history…</p>;

  if (reviews.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-line bg-paper p-8 text-center">
        <p className="text-[15px] text-ink">No versions yet</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">
          Saving a review freezes the current state as an immutable entry. Publishing creates the versioned baseline the
          Overview compares against.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="min-w-0 rounded-lg border border-line bg-paper p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Version history</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {reviews.length} entr{reviews.length === 1 ? "y" : "ies"} · newest first
          </p>
        </div>

        {/* A spine with one marker per entry: filled for published
            versions, hollow for saved reviews. Chronology is the real
            structure of an audit log, so the list is drawn as one. */}
        <ol className="relative">
          <span aria-hidden="true" className="absolute bottom-3 left-[5px] top-3 w-px bg-line" />
          {reviews.map((item) => {
            const isViewing = loadedReview?.id === item.id;
            // Only the newest published entry is the one Overview serves;
            // every earlier published version is superseded history.
            const isActive = item.id === activeId;
            return (
              <li key={item.id} className="relative border-b border-line py-3.5 pl-7 last:border-0">
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-[18px] h-[11px] w-[11px] border-2 ${
                    isActive
                      ? "border-brand-700 bg-brand-700 ring-2 ring-brand-200"
                      : item.published
                        ? "border-brand-700 bg-brand-700"
                        : "border-line bg-paper"
                  }`}
                />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] text-ink">
                        {item.label ?? <span className="italic text-muted">Unlabelled</span>}
                      </span>
                      {isActive ? (
                        <span
                          className="shrink-0 rounded-sm bg-brand-700 px-2 py-0.5 text-[11px] font-bold text-paper"
                          title="This is the version Overview is serving right now"
                        >
                          Active
                        </span>
                      ) : item.published ? (
                        <span className="shrink-0 rounded-sm bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                          Superseded
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-sm bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2">Review</span>
                      )}
                      {isViewing && (
                        <span className="shrink-0 rounded-sm bg-lilac px-2 py-0.5 text-[11px] font-bold text-indigo">Viewing</span>
                      )}
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      {formatDateTime(item.createdAt)} · {relativeAge(item.createdAt)} · {item.actor ?? "unknown actor"}
                    </p>
                    {/* The reason is the entry's whole justification, so it
                        reads as prose rather than hiding in a metadata line. */}
                    {item.reason && <p className="mt-1.5 text-[13px] leading-5 text-ink-2">{item.reason}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onCompare(item)}
                      className="h-7 rounded-sm border border-line px-2.5 text-[12px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
                    >
                      Compare
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoad(item)}
                      disabled={loadingReviewId === item.id}
                      className="h-7 rounded-sm border border-line px-2.5 text-[12px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2 disabled:opacity-40"
                    >
                      {loadingReviewId === item.id ? "Loading…" : "View"}
                    </button>
                    {/* A saved review can be promoted to published as-is —
                        the state that was actually reviewed, not whatever
                        the draft has drifted to since. Published entries
                        have nowhere to be promoted to. */}
                    {!item.published && (
                      <button
                        type="button"
                        onClick={() => onPromote(item)}
                        disabled={publishing}
                        className="h-7 rounded-sm bg-ink px-2.5 text-[12px] font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] disabled:pointer-events-none disabled:opacity-40"
                      >
                        Publish
                      </button>
                    )}
                    {/* Quiet like Delete: reverting discards current work, so
                        it should not sit among the safe actions. */}
                    <button
                      type="button"
                      onClick={() => onRevert(item)}
                      disabled={revertingId === item.id || publishing}
                      title="Restore the working draft to this entry's parameters and manual overrides"
                      className="h-7 rounded-sm px-2 text-[12px] font-semibold text-muted transition-colors duration-100 ease-in hover:bg-paper-2 hover:text-ink disabled:opacity-40"
                    >
                      {revertingId === item.id ? "Reverting…" : "Revert"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      disabled={deletingId === item.id}
                      aria-label={`Delete ${item.label ?? "unlabelled entry"}`}
                      className="h-7 rounded-sm px-2 text-[12px] font-semibold text-muted transition-colors duration-100 ease-in hover:bg-danger-50 hover:text-danger-500 disabled:opacity-40"
                    >
                      {deletingId === item.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>


      {loadedReview && (
        <ReviewSnapshotModal snapshot={loadedReview.snapshot} item={loadedReview.item} onClose={onClosePreview} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ decide

// The weekly surface: what has changed since the last publish, and the two
// ways to act on it, in one place. Comparing and deciding are a single
// thought — splitting them across a tab and a modal made the reader re-find
// what they were already looking at.
function DecideTab({
  reviews,
  snapshot,
  draftStatus,
  comparison,
  comparing,
  from,
  to,
  onFrom,
  onTo,
  label,
  reason,
  onLabel,
  onReason,
  saving,
  publishing,
  onSaveReview,
  onPublish,
}: {
  reviews: ReviewListItem[];
  snapshot: Snapshot;
  draftStatus: DraftStatus | null;
  comparison: SnapshotDiff | null;
  comparing: boolean;
  from: string | null;
  to: string | null;
  onFrom: (id: string | null) => void;
  onTo: (id: string | null) => void;
  label: string;
  reason: string;
  onLabel: (v: string) => void;
  onReason: (v: string) => void;
  saving: boolean;
  publishing: boolean;
  onSaveReview: () => void;
  onPublish: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  const afterAllocation = useMemo(() => (comparison ? allocationOf(comparison.after) : null), [comparison]);

  // Which sleeve moved, and by how much. The changed-input list says what the
  // model read; this says what it did to the portfolio, which is the question
  // a publish decision actually turns on.
  const allocationDelta = useMemo(() => {
    if (!comparison?.before || !afterAllocation) return null;
    const before = allocationOf(comparison.before);
    const beforeById = new Map(before.rollup.map((r) => [r.id, r.portfolioWeight]));
    return afterAllocation.rollup
      .map((r) => ({
        id: r.id,
        label: r.label,
        after: r.portfolioWeight,
        before: beforeById.get(r.id) ?? 0,
        delta: r.portfolioWeight - (beforeById.get(r.id) ?? 0),
      }))
      .filter((r) => Math.abs(r.delta) > 0.00005)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [comparison, afterAllocation]);

  const options = [
    { id: "draft", label: "Current draft (unsaved)" },
    ...reviews.map((r) => ({
      id: r.id,
      label: `${r.published ? "▪" : "▫"} ${r.label ?? "Unlabelled"} · ${formatDay(r.createdAt)}`,
    })),
  ];

  const isDefaultComparison = to === "draft";
  const changes = comparison?.diff.totalChanges ?? 0;
  const nothingToPublish = (draftStatus?.diff.totalChanges ?? 0) === 0;
  // With nothing published yet, every input counts as "changed" simply
  // because there is no other side to compare against. That is a very
  // different situation from real drift, and saying "87 changed inputs"
  // for it reads as alarming when the honest statement is "no baseline".
  const hasBaseline = draftStatus?.hasPublishedVersion ?? true;

  return (
    <div className="mt-6">
      {/* What is being compared. The default — last published against the
          current draft — is stated as a sentence, with the picker tucked
          behind a toggle so the rare retrospective comparison stays
          available without making the common case look like a form. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {comparing
            ? "Comparing…"
            : !hasBaseline
              ? "Nothing published yet — this is the state a first publish would establish"
              : isDefaultComparison
                ? "Current draft vs. the last published version"
                : "Comparing two saved versions"}
        </p>
        <button
          type="button"
          onClick={() => setShowPicker((prev) => !prev)}
          className="h-7 rounded-sm border border-line px-2.5 text-[12px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
        >
          {showPicker ? "Hide version picker" : "Compare other versions"}
        </button>
      </div>

      {showPicker && (
        <div className="mt-3 rounded-lg border border-line bg-paper p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <VersionSelect label="From" value={from} onChange={onFrom} options={options} allowNone />
            <span className="hidden pb-2 text-muted sm:block" aria-hidden="true">
              →
            </span>
            <VersionSelect label="To" value={to} onChange={onTo} options={options} />
          </div>
        </div>
      )}

      {!comparing && comparison && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
            <Stat
              label={hasBaseline ? "Total changes" : "Inputs in baseline"}
              value={changes}
              tone={hasBaseline && changes > 0 ? "warn" : "quiet"}
            />
            <Stat label="Scores" value={comparison.diff.changedScores.length} />
            <Stat label="Vetoes" value={comparison.diff.changedVetoes.length} />
            <Stat label="Parameters" value={comparison.diff.paramsChanged ? "Changed" : "Same"} />
          </div>

          {!comparison.before && (
            <p className="mt-6 text-[13px] text-muted">
              No baseline selected — showing this version's inputs as a first publish, with nothing to compare against.
            </p>
          )}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-line bg-paper p-5">
              <h2 className="text-lg font-semibold text-ink">Allocation moves</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {allocationDelta === null
                  ? "Needs a baseline to compare against"
                  : allocationDelta.length === 0
                    ? "No sleeve moved"
                    : `${allocationDelta.length} sleeve${allocationDelta.length === 1 ? "" : "s"} moved`}
              </p>
              {allocationDelta && allocationDelta.length > 0 && afterAllocation && (
                <div className="mt-4">
                  {allocationDelta.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="h-3.5 w-3.5 shrink-0" style={segmentSwatchStyle(row.id, afterAllocation)} />
                        <span className="truncate text-[15px] text-ink">{row.label}</span>
                      </span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <span className="text-[13px] tabular-nums text-muted">
                          {formatPct(row.before, 1)} → {formatPct(row.after, 1)}
                        </span>
                        <span
                          className={`w-16 text-right text-[15px] font-semibold tabular-nums ${
                            row.delta >= 0 ? "text-brand-800" : "text-danger-500"
                          }`}
                        >
                          {formatSignedPct(row.delta, 2)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-line bg-paper p-5">
              <h2 className="text-lg font-semibold text-ink">Changed inputs</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {comparison.diff.changedScores.length} score
                {comparison.diff.changedScores.length === 1 ? "" : "s"}, {comparison.diff.changedVetoes.length} veto
                {comparison.diff.changedVetoes.length === 1 ? "" : "es"}
              </p>

              {comparison.diff.changedVetoes.length > 0 && (
                <div className="mt-4">
                  {comparison.diff.changedVetoes.map((veto) => (
                    <div key={veto.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
                      <span className="truncate text-[15px] text-ink">{scoreLabel(veto.id)}</span>
                      <span
                        className={`shrink-0 rounded-sm px-2 py-0.5 text-[11px] font-bold ${
                          veto.after ? "bg-warn-50 text-warn-800" : "bg-brand-50 text-brand-800"
                        }`}
                      >
                        {veto.after ? "Veto on" : "Veto cleared"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {comparison.diff.changedScores.length > 0 && (
                <div className="mt-4 max-h-[420px] overflow-y-auto">
                  {comparison.diff.changedScores.map((row) => {
                    const delta = row.before === null ? null : row.after - row.before;
                    return (
                      <div key={row.id} className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] text-ink">{scoreLabel(row.id)}</span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted">{row.provenance}</span>
                        </span>
                        <span className="flex shrink-0 items-baseline gap-3">
                          <span className="text-[13px] tabular-nums text-muted">
                            {row.before === null ? "—" : formatScore(row.before)} → {formatScore(row.after)}
                          </span>
                          {delta !== null && (
                            <span
                              className={`w-12 text-right text-[15px] font-semibold tabular-nums ${
                                delta >= 0 ? "text-brand-800" : "text-danger-500"
                              }`}
                            >
                              {delta >= 0 ? "+" : ""}
                              {delta.toFixed(1)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {comparison.diff.changedScores.length === 0 && comparison.diff.changedVetoes.length === 0 && (
                <p className="mt-4 text-[13px] text-muted">No inputs changed between these two versions.</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* The decision itself, at the foot of the evidence rather than behind
          a dialog that would re-show it. Only offered against the live draft:
          publishing always freezes current state, so acting here while
          comparing two historical versions would publish something other
          than what is on screen. */}
      {isDefaultComparison ? (
        <div className="mt-6 rounded-lg border border-line bg-paper p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Commit this state</h2>
              <p className="mt-0.5 max-w-xl text-[13px] text-muted">
                Saving freezes a checkpoint and leaves Overview untouched. Publishing makes this the allocation of record.
              </p>
            </div>
            <InfoPopover label="About saving and publishing" title="Save or publish?">
              <p>
                <strong className="font-semibold text-ink">Save review</strong> freezes the current state as an immutable entry
                you can return to. Overview does not change. Use it to mark a checkpoint mid-review, or to record a look that
                did not result in a change.
              </p>
              <p>
                <strong className="font-semibold text-ink">Publish version</strong> freezes the same state and makes it the
                baseline Overview reads. Use it once the numbers above are what you intend to act on.
              </p>
              <p>
                Both capture the state at the moment you click, not the state you were looking at earlier — so refresh or
                re-tune first if the draft has moved on.
              </p>
            </InfoPopover>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Label</span>
              <input
                value={label}
                onChange={(e) => onLabel(e.target.value)}
                placeholder="e.g. Q3 2026 strategic review"
                className="mt-1 h-9 w-full rounded-sm border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Reason</span>
              <input
                value={reason}
                onChange={(e) => onReason(e.target.value)}
                placeholder="What changed, and what prompted it"
                className="mt-1 h-9 w-full rounded-sm border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-muted focus:border-ink focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className={`text-[13px] ${!hasBaseline || nothingToPublish ? "text-muted" : "text-warn-600"}`}>
              {draftStatus === null
                ? " "
                : !hasBaseline
                  ? "Nothing has been published yet. Publishing establishes the baseline Overview reads and every future comparison measures against."
                  : nothingToPublish
                    ? "The draft matches the published version — there is nothing new to publish."
                    : `Publishing freezes ${draftStatus.diff.totalChanges} changed input${draftStatus.diff.totalChanges === 1 ? "" : "s"} and updates Overview.`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onSaveReview}
                disabled={saving || publishing}
                className="inline-flex h-9 items-center rounded-sm border border-line px-3.5 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2 disabled:pointer-events-none disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save review"}
              </button>
              <button
                type="button"
                onClick={onPublish}
                disabled={saving || publishing}
                className="inline-flex h-9 items-center rounded-sm bg-ink px-4 text-[13px] font-semibold text-paper transition duration-100 ease-in hover:brightness-[1.15] disabled:pointer-events-none disabled:opacity-40"
              >
                {publishing ? "Publishing…" : "Publish version"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-[13px] text-muted">
          Viewing two saved versions. Switch the "To" side back to the current draft to save or publish.
        </p>
      )}
    </div>
  );
}

function VersionSelect({
  label,
  value,
  onChange,
  options,
  allowNone = false,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  options: Array<{ id: string; label: string }>;
  allowNone?: boolean;
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-bold uppercase leading-4 tracking-eyebrow text-muted">{label}</div>
      <div className="relative mt-1 h-9">
        <div className="pointer-events-none flex h-9 items-center justify-between gap-3 rounded-sm border border-line px-3">
          <span className="truncate text-[13px] font-semibold text-ink">
            {selected?.label ?? (allowNone ? "Nothing (first publish)" : "Select a version")}
          </span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={label}
          className="absolute inset-0 h-9 w-full cursor-pointer opacity-0"
        >
          {allowNone && <option value="">Nothing (first publish)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "quiet" }: { label: string; value: number | string; tone?: "quiet" | "warn" }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">{label}</p>
      <p
        className={`mt-1.5 font-display text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
          tone === "warn" && value !== 0 ? "text-warn-600" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ----------------------------------------------------------------- cadence

function CadenceTab({
  reviews,
  lastPublished,
  lastEntry,
}: {
  reviews: ReviewListItem[];
  lastPublished: ReviewListItem | null;
  lastEntry: ReviewListItem | null;
}) {
  // Cadence is measured from the last entry of any kind — a saved review
  // counts as having looked, even when nothing was published.
  const anchor = lastEntry ?? lastPublished;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="rounded-lg border border-line bg-paper p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Review cadence</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            The rhythm the model is meant to keep. Measured from the most recent entry, whatever its kind.
          </p>
        </div>

        {anchor === null ? (
          <p className="text-[13px] text-muted">Nothing saved yet, so no cadence can be measured.</p>
        ) : (
          <div>
            {CADENCE.map((c) => {
              const elapsed = daysSince(anchor.createdAt);
              const remaining = c.everyDays - elapsed;
              const overdue = remaining < 0;
              const due = remaining <= 0;
              const pct = Math.min(100, Math.round((elapsed / c.everyDays) * 100));
              return (
                <div key={c.id} className="border-b border-line py-3.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-[15px] text-ink">{c.label}</span>
                    <span
                      className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                        overdue ? "text-warn-600" : due ? "text-ink" : "text-muted"
                      }`}
                    >
                      {overdue ? `${Math.abs(remaining)}d overdue` : `${remaining}d remaining`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden bg-paper-2">
                      <div
                        className={`h-full ${overdue ? "bg-warn" : "bg-brand-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted">every {c.everyDays}d</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <aside className="rounded-lg border border-line bg-paper p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Standing rules</h2>
          <p className="mt-0.5 text-[13px] text-muted">Framework logic, not style preferences</p>
        </div>
        <ul className="space-y-3 text-[13px] leading-5 text-ink-2">
          <li>No tilt changes between reviews on news or price alone — wait for the review, or a veto trigger.</li>
          <li>Vetoes block overweights; they never force underweights.</li>
          <li>A sector exits after four consecutive quarters in the sleeve, whatever its score.</li>
          <li>Precious metals are a diversifier, not a bet — never above 2× neutral.</li>
        </ul>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[11px] font-bold uppercase tracking-eyebrow text-muted">Entries logged</p>
          <p className="mt-1.5 text-[13px] text-muted">
            {reviews.filter((r) => r.published).length} published ·{" "}
            {reviews.filter((r) => !r.published).length} saved review
            {reviews.filter((r) => !r.published).length === 1 ? "" : "s"}
          </p>
        </div>
      </aside>
    </div>
  );
}

// Expanded read-only view of a frozen entry. A 380px side panel could not
// hold the full allocation bar with its legend, so the entry that the audit
// trail exists to reconstruct was the one thing shown smallest. As a modal
// it gets the width the bar actually needs.
function ReviewSnapshotModal({
  snapshot,
  item,
  onClose,
}: {
  snapshot: Snapshot;
  item: ReviewListItem;
  onClose: () => void;
}) {
  const allocation = useMemo(() => allocationOf(snapshot), [snapshot]);
  const activeVetoes = Object.entries(snapshot.vetoes).filter(([, veto]) => veto.active);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/20 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Frozen state: ${item.label ?? "Unlabelled"}`}
        className="mt-[6vh] w-full max-w-5xl rounded-lg border border-line bg-paper p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl text-ink">{item.label ?? "Unlabelled"}</h2>
              {item.published ? (
                <span className="shrink-0 rounded-sm bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-800">Published</span>
              ) : (
                <span className="shrink-0 rounded-sm bg-paper-2 px-2 py-0.5 text-[11px] font-bold text-ink-2">Review</span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {formatDateTime(item.createdAt)} · {relativeAge(item.createdAt)} · {item.actor ?? "unknown actor"} · read-only
            </p>
            {item.reason && <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ink-2">{item.reason}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 shrink-0 rounded-sm border border-line px-3 text-[13px] font-semibold text-ink transition-colors duration-100 ease-in hover:bg-paper-2"
          >
            Close
          </button>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <AllocationBar allocation={allocation} depth="detail" />
        </div>

        {activeVetoes.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-warn" />
              <p className="text-[13px] font-semibold text-ink">
                {activeVetoes.length} veto{activeVetoes.length === 1 ? "" : "es"} active in this snapshot
              </p>
            </div>
            <ul className="mt-2 space-y-1">
              {activeVetoes.map(([nodeId, veto]) => (
                <li key={nodeId} className="pl-4 text-[13px] leading-5 text-muted">
                  <span className="font-semibold text-ink-2">{scoreLabel(nodeId)}</span>
                  {veto.detail ? ` — ${veto.detail}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
