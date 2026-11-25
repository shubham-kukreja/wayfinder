import { useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { OverviewView } from "./views/OverviewView.js";
import { NewBacktestView } from "./views/backtest/NewBacktestView.js";
import { BacktestRunsView } from "./views/backtest/BacktestRunsView.js";
import { BacktestReportView } from "./views/backtest/BacktestReportView.js";
import { DriversView } from "./views/DriversView.js";
import { DataPointControlCenterView } from "./views/DataPointControlCenterView.js";
import { MethodologyView } from "./views/MethodologyView.js";
import { OverridesView } from "./views/OverridesView.js";
import { HistoryView } from "./views/HistoryView.js";
import { NotesView } from "./views/NotesView.js";
import { NoteEditorView } from "./views/NoteEditorView.js";
import { FundRankingsView } from "./views/funds/FundRankingsView.js";
import { ClientsView } from "./views/clients/ClientsView.js";
import { ClientPlanView } from "./views/clients/ClientPlanView.js";
import { CoreSessionGate } from "./components/CoreSessionGate.js";
import { Sidebar } from "./components/shell/Sidebar.js";
import { TopBar } from "./components/shell/TopBar.js";
import { MobileNav } from "./components/shell/MobileNav.js";
import { DraftStatusBanner } from "./components/DraftStatusBanner.js";

// Every screen reads core-jobs-service (/v1); the legacy server is retired.
export default function App() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((prev) => !prev)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileNav />
        <CoreSessionGate>
          {location.pathname.startsWith("/model/") && <DraftStatusBanner />}
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewView />} />
            <Route path="/funds/*" element={<FundRankingsView />} />
            <Route path="/clients" element={<ClientsView />} />
            <Route path="/clients/:id" element={<ClientPlanView />} />
            <Route path="/model" element={<Navigate to="/model/signals" replace />} />
            <Route path="/model/signals" element={<DriversView />} />
            <Route path="/model/datapoints" element={<DataPointControlCenterView />} />
            <Route path="/model/overrides" element={<OverridesView />} />
            <Route path="/model/parameters" element={<Navigate to="/model/overrides" replace />} />
            <Route path="/model/inputs" element={<Navigate to="/model/overrides" replace />} />
            <Route path="/model/methodology" element={<Navigate to="/methodology" replace />} />
            <Route path="/methodology" element={<MethodologyView />} />
            <Route path="/reviews" element={<Navigate to="/reviews/decide" replace />} />
            <Route path="/reviews/decide" element={<HistoryView section="decide" />} />
            <Route path="/reviews/history" element={<HistoryView section="history" />} />
            <Route path="/reviews/cadence" element={<HistoryView section="cadence" />} />
            <Route path="/notes" element={<NotesView />} />
            <Route path="/notes/:id" element={<NoteEditorView />} />
            <Route path="/backtest" element={<Navigate to="/backtest/runs" replace />} />
            <Route path="/backtest/new" element={<NewBacktestView />} />
            <Route path="/backtest/runs" element={<BacktestRunsView />} />
            <Route path="/backtest/runs/:id" element={<BacktestReportView />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </CoreSessionGate>
      </div>
    </div>
  );
}
