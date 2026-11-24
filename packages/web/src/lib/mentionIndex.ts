import type { NoteEntityType } from "./notesApi.js";
import { segmentColor } from "../components/AllocationBar.js";
import { scoresFrom, toAllocation, type PortfolioAllocation } from "./portfolioApi.js";
import { listReviews } from "./reviewsApi.js";

export interface MentionCandidate {
  entityType: NoteEntityType;
  entityId: string;
  label: string;
  meta: string;
  value: string | null;
  color: string;
}

const GROUP_LABEL: Record<string, string> = {
  "l1.equity": "Equity",
  "l1.debt": "Debt",
  "l1.metals": "Precious Metals",
};

// One flat, fuzzy-searchable list of "things in this model" for the note
// editor's "/" palette — data points and sleeves come straight off the
// snapshot already in memory (no extra fetch), signals/rubrics are the
// fixed model vocabulary, and past versions are fetched lazily since they
// change far less often than everything else here.
// Recomputes allocation locally rather than trusting snapshot.allocation —
// that field is a value the server precomputed at fetch time, which can be
// stale relative to the scores/params in the same payload (the same reason
// OverviewView and the note widgets both call computeAllocation themselves
// instead of reading it off the snapshot).
/** The "/" palette's data points, sleeves and asset classes, from core's allocation. */
export function buildCoreCandidates(portfolio: PortfolioAllocation): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  const allocation = toAllocation(portfolio);

  for (const [id, value] of Object.entries(scoresFrom(portfolio))) {
    out.push({
      entityType: "datapoint",
      entityId: id,
      label: id,
      meta: `Data point · score ${value.toFixed(1)}`,
      value: value.toFixed(1),
      color: "#7B86F4",
    });
  }

  for (const r of allocation.rollup) {
    // portfolioWeight is a 0-1 fraction (same as every weight computeAllocation
    // returns), so it needs the same *100 the rest of the app applies via
    // formatPct before it's shown as a percentage.
    const pct = (r.portfolioWeight * 100).toFixed(1);
    out.push({
      entityType: "sleeve",
      entityId: r.id,
      label: r.label,
      meta: `Sleeve · ${pct}% of portfolio`,
      value: `${pct}%`,
      color: segmentColor(r.id, allocation),
    });
  }

  for (const [id, label] of Object.entries(GROUP_LABEL)) {
    const node = allocation.groups.l1.nodes[id as keyof typeof allocation.groups.l1.nodes];
    const pct = node ? (node.final * 100).toFixed(1) : null;
    out.push({
      entityType: "signal",
      entityId: id,
      label,
      meta: `Asset class · ${pct ? pct + "%" : ""}`,
      value: pct ? `${pct}%` : null,
      color: segmentColor(id, allocation),
    });
  }

  return out;
}

export async function fetchSnapshotVersionCandidates(): Promise<MentionCandidate[]> {
  const reviews = await listReviews();
  return reviews.map((r) => ({
    entityType: "snapshot",
    entityId: r.id,
    label: r.label || "Untitled version",
    meta: r.published ? "Published version" : "Saved review",
    value: null,
    color: "#8A8A90",
  }));
}

export function filterCandidates(candidates: MentionCandidate[], query: string, limit = 30): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.slice(0, limit);
  return candidates.filter((c) => c.label.toLowerCase().includes(q) || c.entityId.toLowerCase().includes(q)).slice(0, limit);
}
