import { useState } from "react";
import { useSnapshot } from "./hooks/useSnapshot.js";
import { AllocationView } from "./views/AllocationView.js";
import { DriversView } from "./views/DriversView.js";
import { InputsView } from "./views/InputsView.js";
import { ParametersView } from "./views/ParametersView.js";
import { HistoryView } from "./views/HistoryView.js";
import { Nav } from "./components/Nav.js";
import { FIXTURES, type SurfaceId } from "./lib/constants.js";

export default function App() {
  const [active, setActive] = useState<SurfaceId>("allocation");
  const [fixtureId, setFixtureId] = useState("live");
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0]!;
  const { snapshot, loading, error } = useSnapshot(fixture.url);

  return (
    <div className="min-h-screen bg-neutral-50">
      <Nav active={active} onNavigate={setActive} fixtureId={fixtureId} onFixtureChange={setFixtureId} />
      {loading && <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-neutral-500">Loading…</div>}
      {error && (
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-sm text-red-600">Failed to load snapshot: {error}</p>
        </div>
      )}
      {snapshot && (
        <>
          {active === "allocation" && <AllocationView snapshot={snapshot} />}
          {active === "drivers" && <DriversView snapshot={snapshot} />}
          {active === "inputs" && <InputsView snapshot={snapshot} />}
          {active === "parameters" && <ParametersView snapshot={snapshot} />}
          {active === "history" && <HistoryView snapshot={snapshot} />}
        </>
      )}
    </div>
  );
}
