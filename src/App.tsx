import { type ReactNode, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { useCategories, useMe } from "./api";
import { autoMonthlyReports } from "./automation";
import { registerCategories } from "./categories";
import { setDisplayTimeZone } from "./format";
import { LegalGate, LegalPage } from "./components/Legal";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import { AssetPage, AssetByCode } from "./pages/Asset";
import { AssetsPage } from "./pages/Assets";
import { InviteAccept, Login, Register, ResetPassword } from "./pages/Auth";
import { Dashboard } from "./pages/Dashboard";
import { FloorPlanPage } from "./pages/FloorPlan";
import { HelpPage } from "./pages/Help";
import { ImportPage } from "./pages/Import";
import { OfflinePage, OfflineRun } from "./pages/Offline";
import {
  ExternalTaskPage,
  PartnerPage,
  SubcontractorsPage,
} from "./pages/Subcontractors";
import {
  WalkthroughProtocol,
  WalkthroughRun,
  WalkthroughsPage,
} from "./pages/Walkthroughs";
import { InspectionRun } from "./pages/InspectionRun";
import { Moved, MOVED } from "./moved";
import { OffenPage } from "./pages/Offen";
import { PruefenPage } from "./pages/Pruefen";
import { Protocol } from "./pages/Protocol";
import { PropertiesPage } from "./pages/Properties";
import { PropertyPage } from "./pages/Property";
import {
  ComplianceReport,
  DefectReport,
  LabelSheet,
  ReportsPage,
} from "./pages/Reports";
import { OAuthAuthorize } from "./pages/OAuthAuthorize";
import { CustomerView } from "./pages/CustomerView";
import { RoundPage } from "./pages/Round";
import { ScanPage } from "./pages/Scan";
import { SettingsFrame, SettingsPage } from "./pages/Settings";
import { SignPage } from "./pages/Sign";
import { TeamPage } from "./pages/Team";

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
  // Autopilot „Monatsberichte“ (Stufe Automatisch): einmal je Sitzung prüfen, PDFs entstehen im Hintergrund
  useEffect(() => {
    if (me.data) void autoMonthlyReports(me.data);
  }, [me.data]);
  if (me.isLoading || (cats.isLoading && navigator.onLine))
    return <Spinner className="min-h-dvh items-center" />;
  if (me.isError)
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`}
        replace
      />
    );
  // vor dem Rendern der Seiten, damit alle Datumsangaben die Workspace-Zeitzone nutzen
  setDisplayTimeZone(me.data?.tenant.timeZone);
  return (
    <>
      {children}
      {me.data && me.data.pendingLegal?.length > 0 && navigator.onLine && (
        <LegalGate pending={me.data.pendingLegal} />
      )}
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
        <Route path="/partner/:code" element={<PartnerPage />} />
        <Route path="/passwort/:token" element={<ResetPassword />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        <Route path="/kunde/:token" element={<CustomerView />} />
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
          {/* Fünf Orte (docs/plan/v4.md 5): Heute, Objekte, Prüfen, Offen, Berichte – alles andere unter Einstellungen */}
          <Route path="pruefen" element={<PruefenPage />} />
          <Route path="pruefen/begehungen" element={<WalkthroughsPage />} />
          <Route path="offen" element={<OffenPage />} />
          <Route path="unterschreiben" element={<SignPage />} />
          <Route path="grundrisse/:id" element={<FloorPlanPage />} />
          <Route path="offline" element={<OfflinePage />} />
          <Route path="berichte" element={<ReportsPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route
            path="einstellungen/team"
            element={
              <SettingsFrame current="team">
                <TeamPage />
              </SettingsFrame>
            }
          />
          <Route
            path="einstellungen/subunternehmer"
            element={
              <SettingsFrame current="subunternehmer">
                <SubcontractorsPage />
              </SettingsFrame>
            }
          />
          <Route
            path="einstellungen/import"
            element={
              <SettingsFrame current="import">
                <ImportPage />
              </SettingsFrame>
            }
          />
          <Route
            path="einstellungen/hilfe"
            element={
              <SettingsFrame current="hilfe">
                <HelpPage />
              </SettingsFrame>
            }
          />
          <Route path="scan" element={<ScanPage />} />
          <Route path="rundgang/:id" element={<RoundPage />} />
          {/* alte Adressen (Lesezeichen, Benachrichtigungen, Mails) – Query-Parameter bleiben erhalten */}
          {MOVED.map((m) => (
            <Route key={m.from} path={m.from} element={<Moved to={m.to} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
