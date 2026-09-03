import type { Snapshot } from "@wayfinder/engine";
import { useLocalAllocation, scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { StateSummary } from "../components/StateSummary.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { AllocationTable } from "../components/AllocationTable.js";
import { ColdStartBanner } from "../components/ColdStartBanner.js";

// §12.4: a snapshot counts as "cold start" when most of its series have
// too little history to be a real signal — not a single missing series
// (that's the ordinary "degraded" case), but the system as a whole not
// yet being informative.
function coldStartInfo(snapshot: Snapshot): { isColdStart: boolean; insufficientCount: number; totalCount: number } {
  const seriesList = Object.values(snapshot.series);
  const insufficientCount = seriesList.filter((s) => s.status === "insufficient_history").length;
  const totalCount = seriesList.length;
  return { isColdStart: totalCount > 0 && insufficientCount / totalCount > 0.5, insufficientCount, totalCount };
}

export function AllocationView({ snapshot }: { snapshot: Snapshot }) {
  // Recomputed locally from the snapshot's scores/vetoes/params through the
  // real pure engine (§12.5 principle 2) rather than trusting the
  // server-computed allocation blindly — this is the client's own proof
  // that it can reproduce the number, not just display one it was handed.
  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const allocation = useLocalAllocation(scores, vetoes, snapshot.params);
  const { isColdStart, insufficientCount, totalCount } = coldStartInfo(snapshot);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">Allocation</h1>
        <div className="mt-1">
          <StateSummary snapshot={snapshot} />
        </div>
      </header>

      {isColdStart && <ColdStartBanner insufficientCount={insufficientCount} totalCount={totalCount} />}

      <section className="mb-8">
        <AllocationBar allocation={allocation} />
      </section>

      <section>
        <AllocationTable allocation={allocation} />
      </section>
    </div>
  );
}
