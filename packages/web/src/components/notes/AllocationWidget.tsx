import { AllocationBar } from "../AllocationBar.js";
import { useCoreAllocation } from "../../hooks/useCoreAllocation.js";
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
  // Core's allocation (published, else the draft), live on every view.
  const { allocation, loading, error } = useCoreAllocation();

  if (error) return <p className="rounded-sm bg-paper-2 px-3 py-2 text-xs text-muted">Allocation unavailable: {error}</p>;
  if (loading || !allocation) {
    return <div className="h-7 w-full animate-pulse bg-paper-2" />;
  }

  const depth = size === "small" ? "overview" : "detail";

  return (
    <div>
      <AllocationBar allocation={allocation} depth={depth} selectedId={null} onSelect={() => {}} compare="none" />
    </div>
  );
}
