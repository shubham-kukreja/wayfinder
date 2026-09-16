import { useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSnapshot } from "./hooks/useSnapshot.js";
import { OverviewView } from "./views/OverviewView.js";
import { DriversView } from "./views/DriversView.js";
import { DataPointControlCenterView } from "./views/DataPointControlCenterView.js";
import { MethodologyView } from "./views/MethodologyView.js";
import { ParametersView } from "./views/ParametersView.js";
import { HistoryView } from "./views/HistoryView.js";
import { Sidebar } from "./components/shell/Sidebar.js";
import { TopBar } from "./components/shell/TopBar.js";
import { MobileNav } from "./components/shell/MobileNav.js";
import { DraftStatusBanner } from "./components/DraftStatusBanner.js";
import { CURRENT_SNAPSHOT_URL, FIXTURES, PUBLISHED_SNAPSHOT_URL } from "./lib/constants.js";

export default function App() {
  const location = useLocation();
  // The dev fixture switcher was removed from the top bar, so the app always
  // loads live data. The fixture plumbing below stays in place for the mock
  // states it can still serve if a switcher is reintroduced.
  const fixtureId: string = "live";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fixture = FIXTURES.find((f) => f.id === fixtureId) ?? FIXTURES[0]!;
  const usePublishedOverview = (fixtureId === "live" || fixtureId === "published") && location.pathname === "/overview";
  const snapshotUrl = usePublishedOverview ? PUBLISHED_SNAPSHOT_URL : fixture.url;
  const fallbackUrl = usePublishedOverview ? CURRENT_SNAPSHOT_URL : fixtureId === "published" ? CURRENT_SNAPSHOT_URL : undefined;
  const { snapshot, loading, error, fallbackUsed } = useSnapshot(snapshotUrl, fallbackUrl);

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((prev) => !prev)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileNav />
        {loading && <div className="px-6 py-10 text-sm text-muted">Loading…</div>}
        {error && (
          <div className="px-6 py-10">
            <p className="text-sm text-danger-500">Failed to load snapshot: {error}</p>
          </div>
        )}
        {fallbackUsed && (
          <div className="border-b border-warn-200 bg-warn-50 px-6 py-2 text-center text-xs text-warn-800">
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
            <Route path="/methodology" element={<MethodologyView snapshot={snapshot} />} />
            <Route path="/model/methodology" element={<Navigate to="/methodology" replace />} />
            <Route path="/model/parameters" element={<ParametersView snapshot={snapshot} />} />
            <Route path="/reviews" element={<HistoryView snapshot={snapshot} />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        )}
      </div>
    </div>
  );
}
