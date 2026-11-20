// Objekt (Plan v8 Z): „Ich lege ein Objekt an und sehe Stammdaten, Dateien, alle Elemente, Grundrisse. Dann kann ich
// eine Begehung starten und am Ende sehe ich im Objekt alle bestandenen und durchgefallenen Elemente.“
// Vier Reiter in der URL (?tab=uebersicht|elemente|begehung|maengel, Standard uebersicht) – je Reiter eine Fläche:
// Übersicht (components/objects/Overview), Elemente (ElementsTab), Begehung (WalkTab), Mängel (PropertyWork).
// Beim Öffnen nur GET /properties/:id; jeder Reiter lädt, was er zusätzlich braucht, erst wenn er offen ist.
// Alte Reiter-Schlüssel (grundrisse, begehungen, angebot) leiten auf den passenden Reiter/Abschnitt.
import { Building2, CloudDownload, Mic, Pencil, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BUILDING_TYPES } from '../../shared/walkthrough';
import { api, useAction, useMe, useProperty } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { BuildingForm, PropertyForm } from '../components/forms';
import { ElementsTab } from '../components/objects/ElementsTab';
import { Overview } from '../components/objects/Overview';
import { PropertyWork } from '../components/objects/PropertyWork';
import { countDue } from '../components/objects/status';
import { WalkTab } from '../components/objects/WalkTab';
import { SharePropertyButton } from '../components/ShareProperty';
import { ButtonLink, ErrorBox, Menu, type MenuItem, PageHeader, PageSkeleton, StatusText, Tabs, useConfirm, useToast, useUrlTab } from '../components/ui';
import { defectsLabel } from '../format';
import { prepareBuilding } from '../offline';
import { FloorPlanUpload } from './FloorPlan';

export const PROPERTY_TABS = ['uebersicht', 'elemente', 'begehung', 'maengel'] as const;
export type PropertyTab = (typeof PROPERTY_TABS)[number];

/** Alte Reiter-Schlüssel → neuer Reiter (+ Abschnitt bzw. Ansicht). */
const LEGACY: Record<string, { tab: PropertyTab; hash?: string; set?: Record<string, string> }> = {
  grundrisse: { tab: 'uebersicht', hash: 'grundrisse' },
  begehungen: { tab: 'begehung', hash: 'brandschutzbegehungen' },
  angebot: { tab: 'maengel', set: { ansicht: 'angebot' } },
  offen: { tab: 'maengel' },
  pruefen: { tab: 'begehung' },
};

export function PropertyPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, error, refetch } = useProperty(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [params, setParams] = useSearchParams();
  const [tab] = useUrlTab<PropertyTab>('tab', 'uebersicht', PROPERTY_TABS);
  const [edit, setEdit] = useState(false);
  const [building, setBuilding] = useState(false);
  const [upload, setUpload] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const canInspect = !!me && me.user.role !== 'viewer';
  const canCreate = canInspect && me?.user.canCreate !== false;

  // alte Reiter-Schlüssel umleiten (Benachrichtigungen, PDFs, Connector und alte Lesezeichen verlinken sie)
  const raw = params.get('tab');
  useEffect(() => {
    const to = raw ? LEGACY[raw] : undefined;
    if (!to) return;
    setParams(
      (q) => {
        const n = new URLSearchParams(q);
        if (to.tab === 'uebersicht') n.delete('tab');
        else n.set('tab', to.tab);
        for (const [k, v] of Object.entries(to.set ?? {})) n.set(k, v);
        return n;
      },
      { replace: true },
    );
    if (to.hash) {
      const hash = to.hash;
      // nach dem Rendern des Reiters zum Abschnitt springen
      const t = setInterval(() => {
        const el = document.getElementById(hash);
        if (el) {
          el.scrollIntoView({ block: 'start' });
          clearInterval(t);
        }
      }, 50);
      setTimeout(() => clearInterval(t), 3000);
    }
  }, [raw, setParams]);

  const del = useAction(
    () => api(`/properties/${id}`, { method: 'DELETE' }),
    () => {
      toast('Objekt gelöscht');
      navigate('/objekte');
    },
  );

  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <ErrorBox error={error ?? new Error('Objekt nicht gefunden')} onRetry={() => refetch()} />;

  const single = p.buildings.length === 1 ? p.buildings[0]! : null;
  const offline = async (bid: string) => {
    setPreparing(true);
    try {
      const b = await prepareBuilding(bid);
      toast(`${b.assets.length} Elemente offline verfügbar`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'bad');
    } finally {
      setPreparing(false);
    }
  };
  const due = countDue(p.assets);
  const openDefects = p.assets.reduce((s, a) => s + a.openDefects, 0);

  const menu: MenuItem[] = [];
  if (canCreate) menu.push({ label: 'Elemente hinzufügen', icon: <Mic />, onClick: () => openCapture({ propertyId: p.id, mode: 'assets' }) });
  if (single) menu.push({ label: preparing ? 'Wird gespeichert …' : 'Für offline speichern', icon: <CloudDownload />, disabled: preparing, onClick: () => offline(single.id) });
  if (isAdmin) {
    if (menu.length) menu.push('separator');
    menu.push({ label: 'Objekt bearbeiten', icon: <Pencil />, onClick: () => setEdit(true) });
    menu.push({ label: 'Gebäude hinzufügen', icon: <Building2 />, onClick: () => setBuilding(true) });
    if (p.buildings.length) menu.push({ label: 'Grundriss hochladen', icon: <Upload />, onClick: () => setUpload(true) });
    menu.push('separator', {
      label: 'Objekt löschen',
      icon: <Trash2 />,
      danger: true,
      onClick: async () => {
        if (await confirm({ title: `„${p.name}“ löschen?`, text: 'Alle Gebäude, Elemente und Prüfungen dieses Objekts werden gelöscht.', confirmLabel: 'Löschen', danger: true }))
          del.mutate(undefined);
      },
    });
  }

  // Kopfzeile: ein Satz zur Lage – das Dringendste mit Punkt, der Rest als grauer Text
  const metaParts = [due.overdue > 0 && `${due.overdue} überfällig`, due.soon > 0 && `${due.soon} bald fällig`, openDefects > 0 && `${defectsLabel(openDefects)} offen`].filter(Boolean) as string[];
  const meta = p.assets.length ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      {metaParts.length ? (
        <>
          <StatusText tone={due.overdue ? 'bad' : due.soon ? 'warn' : 'brand'}>{metaParts[0]}</StatusText>
          {metaParts.slice(1).map((t) => (
            <span key={t}>· {t}</span>
          ))}
        </>
      ) : (
        <StatusText tone={due.never ? 'info' : 'ok'}>{due.never ? `${due.never} nie geprüft` : 'Alles aktuell'}</StatusText>
      )}
      <span>· {p.assets.length === 1 ? '1 Element' : `${p.assets.length} Elemente`}</span>
    </span>
  ) : undefined;

  return (
    <>
      {confirmEl}
      <PageHeader
        breadcrumbs={[{ label: 'Objekte', to: '/objekte' }, { label: p.name }]}
        title={p.name}
        subtitle={[p.address.split('\n').join(', '), BUILDING_TYPES[p.buildingType]].filter(Boolean).join(' · ')}
        meta={meta}
        actions={
          <>
            {isAdmin && <SharePropertyButton propertyId={p.id} propertyName={p.name} />}
            {menu.length > 0 && <Menu items={menu} label="Weitere Aktionen zum Objekt" />}
            {/* Hauptaktion: aus jedem Reiter direkt ins Ansagen; im Reiter Begehung steht der große Knopf selbst */}
            {canInspect && tab !== 'begehung' && p.buildings.length > 0 && (
              <ButtonLink to={`/objekte/${p.id}?tab=begehung&start=1`} icon={<Mic className="size-4" />}>
                Begehung starten
              </ButtonLink>
            )}
          </>
        }
      />
      {edit && <PropertyForm initial={p} onClose={() => setEdit(false)} />}
      {building && <BuildingForm propertyId={p.id} onClose={() => setBuilding(false)} />}
      {upload && <FloorPlanUpload buildings={p.buildings} onClose={() => setUpload(false)} />}

      <div className="flex min-w-0 flex-col gap-4">
        <Tabs
          value={tab}
          onChange={(v) => {
            // Reiterwechsel räumt die Angaben des alten Reiters aus der URL
            const n = new URLSearchParams();
            if (v !== 'uebersicht') n.set('tab', v);
            setParams(n, { replace: true });
          }}
          tabs={[
            { value: 'uebersicht', label: 'Übersicht' },
            { value: 'elemente', label: 'Elemente', count: p.assets.length },
            { value: 'begehung', label: 'Begehung' },
            { value: 'maengel', label: 'Mängel', count: openDefects || undefined, tone: p.assets.some((a) => a.openDefects > 0 && a.lastResult === 'critical') ? 'bad' : undefined },
          ]}
        />
        {tab === 'uebersicht' && <Overview p={p} isAdmin={isAdmin} canInspect={canInspect} onEdit={() => setEdit(true)} onUpload={() => setUpload(true)} />}
        {tab === 'elemente' && <ElementsTab p={p} isAdmin={isAdmin} canCreate={canCreate} />}
        {tab === 'begehung' && <WalkTab p={p} canInspect={canInspect} />}
        {tab === 'maengel' && <PropertyWork p={p} canEdit={canInspect} canOffer={canInspect} />}
      </div>
    </>
  );
}
