import { useMemo } from "react";
import { computeAllocation } from "@wayfinder/engine";
import { AllocationBar } from "../AllocationBar.js";
import { useSnapshot } from "../../hooks/useSnapshot.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../../hooks/useLocalAllocation.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../../lib/constants.js";
import type { NoteWidgetSize } from "../../lib/notesApi.js";

// Dropped into a note, this stays live the same way the Overview bar is
// live: it fetches the current snapshot and recomputes the allocation
// itself, so a note written today still shows this week's numbers when
// reopened rather than a value frozen at insert time.
//
// computeAllocation only ever runs once real params exist — not through
// useLocalAllocation, which would need to run before the snapshot has
// loaded and throw on an empty params stand-in.
export function AllocationWidget({ size }: { size: NoteWidgetSize }) {
  const { snapshot, loading } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);
  const allocation = useMemo(() => {
    if (!snapshot) return null;
    return computeAllocation(scoresFromSnapshot(snapshot.scores), vetoesFromSnapshot(snapshot.vetoes), snapshot.params);
  }, [snapshot]);

  if (loading || !snapshot || !allocation) {
    return <div className="h-7 w-full animate-pulse rounded-md bg-paper-2" />;
  }

  const depth = size === "small" ? "overview" : "detail";

  return (
    <div>
      <AllocationBar allocation={allocation} depth={depth} selectedId={null} onSelect={() => {}} compare="none" />
    </div>
  );
}
