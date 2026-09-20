import type { Snapshot } from "@wayfinder/engine";
import type { NoteEntityType } from "./notesApi.js";
import { segmentColor } from "../components/AllocationBar.js";
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
export function buildSnapshotCandidates(snapshot: Snapshot): MentionCandidate[] {
  const out: MentionCandidate[] = [];

  for (const [id, state] of Object.entries(snapshot.scores)) {
    out.push({
      entityType: "datapoint",
      entityId: id,
      label: id,
      meta: `Data point · score ${state.value.toFixed(1)}`,
      value: state.value.toFixed(1),
      color: "#7B86F4",
    });
  }

  for (const r of snapshot.allocation.rollup) {
    out.push({
      entityType: "sleeve",
      entityId: r.id,
      label: r.label,
      meta: `Sleeve · ${r.portfolioWeight.toFixed(1)}% of portfolio`,
      value: `${r.portfolioWeight.toFixed(1)}%`,
      color: segmentColor(r.id, snapshot.allocation),
    });
  }

  for (const [id, label] of Object.entries(GROUP_LABEL)) {
    const node = snapshot.allocation.groups.l1.nodes[id as keyof typeof snapshot.allocation.groups.l1.nodes];
    out.push({
      entityType: "signal",
      entityId: id,
      label,
      meta: `Asset class · ${node ? node.final.toFixed(1) + "%" : ""}`,
      value: node ? `${node.final.toFixed(1)}%` : null,
      color: segmentColor(id, snapshot.allocation),
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
