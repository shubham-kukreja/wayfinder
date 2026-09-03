import type { Snapshot } from "@wayfinder/engine";
import { useLocalAllocation, scoresFromSnapshot, vetoesFromSnapshot } from "../hooks/useLocalAllocation.js";
import { StateSummary } from "../components/StateSummary.js";
import { AllocationBar } from "../components/AllocationBar.js";
import { AllocationTable } from "../components/AllocationTable.js";

export function AllocationView({ snapshot }: { snapshot: Snapshot }) {
  // Recomputed locally from the snapshot's scores/vetoes/params through the
  // real pure engine (§12.5 principle 2) rather than trusting the
  // server-computed allocation blindly — this is the client's own proof
  // that it can reproduce the number, not just display one it was handed.
  const scores = scoresFromSnapshot(snapshot.scores);
  const vetoes = vetoesFromSnapshot(snapshot.vetoes);
  const allocation = useLocalAllocation(scores, vetoes, snapshot.params);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-neutral-900">Allocation</h1>
        <div className="mt-1">
          <StateSummary snapshot={snapshot} />
        </div>
      </header>

      <section className="mb-8">
        <AllocationBar allocation={allocation} />
      </section>

      <section>
        <AllocationTable allocation={allocation} />
      </section>
    </div>
  );
}
