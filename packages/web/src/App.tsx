import { useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSnapshot } from "./hooks/useSnapshot.js";
import { OverviewView } from "./views/OverviewView.js";
import { DriversView } from "./views/DriversView.js";
import { DataPointControlCenterView } from "./views/DataPointControlCenterView.js";
import { MethodologyView } from "./views/MethodologyView.js";
import { ParametersView } from "./views/ParametersView.js";
import { HistoryView } from "./views/HistoryView.js";
import { Nav } from "./components/Nav.js";
import { DraftStatusBanner } from "./components/DraftStatusBanner.js";
import { CURRENT_SNAPSHOT_URL, FIXTURES, PUBLISHED_SNAPSHOT_URL } from "./lib/constants.js";

export default function App() {
  const location = useLocation();
  const [fixtureId, setFixtureId] = useState("live");
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0]!;
  const usePublishedOverview = (fixtureId === "live" || fixtureId === "published") && location.pathname === "/overview";
  const snapshotUrl = usePublishedOverview ? PUBLISHED_SNAPSHOT_URL : fixture.url;
  const fallbackUrl = usePublishedOverview ? CURRENT_SNAPSHOT_URL : fixtureId === "published" ? CURRENT_SNAPSHOT_URL : undefined;
  const { snapshot, loading, error, fallbackUsed } = useSnapshot(snapshotUrl, fallbackUrl);

  return (
    <div className="min-h-screen bg-neutral-50">
      <Nav fixtureId={fixtureId} onFixtureChange={setFixtureId} />
      {loading && <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-neutral-500">Loading…</div>}
      {error && (
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="text-sm text-red-600">Failed to load snapshot: {error}</p>
        </div>
      )}
      {fallbackUsed && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-800">
          No published model version exists yet; showing current draft state on Overview.
        </div>
      )}
      {location.pathname.startsWith("/model/") && <DraftStatusBanner />}
      {snapshot && (
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewView snapshot={snapshot} />} />
          <Route path="/model" element={<Navigate to="/model/signals" replace />} />
          <Route path="/model/signals" element={<DriversView snapshot={snapshot} />} />
          <Route path="/model/datapoints" element={<DataPointControlCenterView snapshot={snapshot} />} />
          <Route path="/model/methodology" element={<MethodologyView snapshot={snapshot} />} />
          <Route path="/model/parameters" element={<ParametersView snapshot={snapshot} />} />
          <Route path="/reviews" element={<HistoryView snapshot={snapshot} />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      )}
    </div>
  );
}
