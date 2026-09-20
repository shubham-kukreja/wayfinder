import { useMemo } from "react";
import { computeAllocation } from "@wayfinder/engine";
import { AllocationTable } from "../AllocationTable.js";
import { useSnapshot } from "../../hooks/useSnapshot.js";
import { scoresFromSnapshot, vetoesFromSnapshot } from "../../hooks/useLocalAllocation.js";
import { PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL } from "../../lib/constants.js";

// A plain sleeve/weight table — the scannable alternative to the allocation
// bar for a note meant to be read as a report rather than skimmed visually.
// Live the same way every other note widget is: recomputed on each view,
// never frozen at insert time.
export function AllocationTableWidget() {
  const { snapshot, loading } = useSnapshot(PUBLISHED_SNAPSHOT_URL, CURRENT_SNAPSHOT_URL);
  const allocation = useMemo(() => {
    if (!snapshot) return null;
    return computeAllocation(scoresFromSnapshot(snapshot.scores), vetoesFromSnapshot(snapshot.vetoes), snapshot.params);
  }, [snapshot]);

  if (loading || !snapshot || !allocation) {
    return <div className="h-40 w-full animate-pulse bg-paper-2" />;
  }

  return <AllocationTable allocation={allocation} />;
}
