import { type ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useCategories, useMe } from './api';
import { registerCategories } from './categories';
import { setDisplayTimeZone } from './format';
import { LegalGate, LegalPage } from './components/Legal';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import { AssetPage, AssetByCode } from './pages/Asset';
import { AssetsPage } from './pages/Assets';
import { InviteAccept, Login, Register, ResetPassword } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { DefectsPage } from './pages/Defects';
import { FloorPlanPage } from './pages/FloorPlan';
import { HelpPage } from './pages/Help';
import { ImportPage } from './pages/Import';
import { OfflinePage, OfflineRun } from './pages/Offline';
import { ExternalTaskPage, SubcontractorsPage } from './pages/Subcontractors';
import { WalkthroughProtocol, WalkthroughRun, WalkthroughsPage } from './pages/Walkthroughs';
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
  const cats = useCategories();
  const loc = useLocation();
  const [, force] = useState(0);
  useEffect(() => {
    if (cats.data) {
      registerCategories(cats.data);
      force((n) => n + 1);
    }
  }, [cats.data]);
  if (me.isLoading || (cats.isLoading && navigator.onLine)) return <Spinner className="min-h-dvh items-center" />;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  // vor dem Rendern der Seiten, damit alle Datumsangaben die Workspace-Zeitzone nutzen
  setDisplayTimeZone(me.data?.tenant.timeZone);
  return (
    <>
      {children}
      {me.data && me.data.pendingLegal?.length > 0 && navigator.onLine && <LegalGate pending={me.data.pendingLegal} />}
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registrieren" element={<Register />} />
        <Route path="/einladung/:token" element={<InviteAccept />} />
        <Route path="/extern/:token" element={<ExternalTaskPage />} />
        <Route path="/passwort/:token" element={<ResetPassword />} />
        <Route path="/rechtliches" element={<LegalPage />} />
        <Route path="/rechtliches/:doc" element={<LegalPage />} />
        <Route
          path="/druck/begehung/:id"
          element={
            <RequireAuth>
              <WalkthroughProtocol />
            </RequireAuth>
          }
        />
        <Route
          path="/begehung/:id"
          element={
            <RequireAuth>
              <WalkthroughRun />
            </RequireAuth>
          }
        />
        <Route
          path="/offline/pruefen/:assetId"
          element={
            <RequireAuth>
              <OfflineRun />
            </RequireAuth>
          }
        />
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
          <Route path="begehungen" element={<WalkthroughsPage />} />
          <Route path="grundrisse/:id" element={<FloorPlanPage />} />
          <Route path="offline" element={<OfflinePage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="subunternehmer" element={<SubcontractorsPage />} />
          <Route path="aufgaben" element={<TasksPage />} />
          <Route path="berichte" element={<ReportsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="hilfe" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
