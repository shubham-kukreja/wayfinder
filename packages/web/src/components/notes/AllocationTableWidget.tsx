import { AllocationTable } from "../AllocationTable.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";

// A plain sleeve/weight table — the scannable alternative to the allocation
// bar for a note meant to be read as a report rather than skimmed visually.
// Live the same way every other note widget is: recomputed on each view,
// never frozen at insert time.
export function AllocationTableWidget() {
  // Core's allocation (published, else the draft), live on every view.
  const { allocation, loading, error } = useCoreAllocation();

  if (error) return <p className="rounded-sm bg-paper-2 px-3 py-2 text-xs text-muted">Allocation unavailable: {error}</p>;
  if (loading || !allocation) {
    return <div className="h-40 w-full animate-pulse bg-paper-2" />;
  }

  return <AllocationTable allocation={allocation} />;
}
