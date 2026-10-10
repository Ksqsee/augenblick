import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useMe } from './api';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { AssetPage, AssetByCode } from './pages/Asset';
import { AssetsPage } from './pages/Assets';
import { InviteAccept, Login, Register } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { DefectsPage } from './pages/Defects';
import { InspectionRun } from './pages/InspectionRun';
import { InspectionsPage } from './pages/Inspections';
import { Protocol } from './pages/Protocol';
import { PropertiesPage } from './pages/Properties';
import { PropertyPage } from './pages/Property';
import { ComplianceReport, DefectReport, LabelSheet, ReportsPage } from './pages/Reports';
import { ScanPage } from './pages/Scan';
import { SettingsPage } from './pages/Settings';
import { TasksPage } from './pages/Tasks';
import { TeamPage } from './pages/Team';

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const loc = useLocation();
  if (me.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registrieren" element={<Register />} />
        <Route path="/einladung/:token" element={<InviteAccept />} />
        <Route
          path="/druck/protokoll/:id"
          element={
            <RequireAuth>
              <Protocol />
            </RequireAuth>
          }
        />
        <Route
          path="/druck/compliance"
          element={
            <RequireAuth>
              <ComplianceReport />
            </RequireAuth>
          }
        />
        <Route
          path="/druck/maengel"
          element={
            <RequireAuth>
              <DefectReport />
            </RequireAuth>
          }
        />
        <Route
          path="/druck/etiketten"
          element={
            <RequireAuth>
              <LabelSheet />
            </RequireAuth>
          }
        />
        <Route
          path="/pruefung/:id"
          element={
            <RequireAuth>
              <InspectionRun />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="objekte" element={<PropertiesPage />} />
          <Route path="objekte/:id" element={<PropertyPage />} />
          <Route path="elemente" element={<AssetsPage />} />
          <Route path="elemente/:id" element={<AssetPage />} />
          <Route path="e/:code" element={<AssetByCode />} />
          <Route path="pruefungen" element={<InspectionsPage />} />
          <Route path="maengel" element={<DefectsPage />} />
          <Route path="aufgaben" element={<TasksPage />} />
          <Route path="berichte" element={<ReportsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
