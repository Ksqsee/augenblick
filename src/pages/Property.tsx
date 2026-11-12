// Objekt: Gebäude mit Elementen, Grundrisse, Begehungen; rechts Prüfstatus und Stammdaten.
// Vorlage „Detail“ (docs/design.md 5.2), Belege: docs/design/objekte-elemente.md
import { Building2, ChevronRight, CloudDownload, Footprints, Mail, Map, Package, Pencil, Phone, Plus, ShieldCheck, Trash2, Upload, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BUILDING_TYPES } from '../../shared/walkthrough';
import { api, type Asset, type FireOfficer, fileUrl, type PropertyDetail, useAction, useMe, useProperty } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm, BuildingForm, PropertyForm } from '../components/forms';
import { countDue, dueInfo, StatusBar } from '../components/objects/status';
import { PropertyReportButton } from '../components/PropertyReportButton';
import { SharePropertyButton } from '../components/ShareProperty';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Input,
  List,
  ListRow,
  Menu,
  type MenuItem,
  Modal,
  PageHeader,
  PageSkeleton,
  PropertyList,
  ResultBadge,
  RowIcon,
  SearchField,
  SectionHeader,
  SectionLink,
  Tabs,
  Textarea,
  toneText,
  useConfirm,
  useToast,
  useUrlTab,
} from '../components/ui';
import { categoryLabel, defectsLabel, fmtDate, fmtDateTime } from '../format';
import { prepareBuilding } from '../offline';
import { FloorPlanUpload } from './FloorPlan';
import { StartWalkthrough } from './Walkthroughs';

const TABS = ['elemente', 'grundrisse', 'begehungen'] as const;
type Tab = (typeof TABS)[number];

/** Karte im Seitenpanel: kleiner Titel, optional Aktion. */
function SideCard({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-4 sm:p-5 ${className ?? ''}`}>
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-meta font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function PropertyPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, error, refetch } = useProperty(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [tab, setTab] = useUrlTab<Tab>('tab', 'elemente', TABS);
  const [edit, setEdit] = useState(false);
  const [building, setBuilding] = useState<null | 'new' | { id: string; name: string; address: string }>(null);
  const [assetFor, setAssetFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [upload, setUpload] = useState(false);
  const [walk, setWalk] = useState(false);
  const [q, setQ] = useState('');
  const [preparing, setPreparing] = useState<string | null>(null);
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const canInspect = !!me && me.user.role !== 'viewer';
  const canCreate = canInspect && me?.user.canCreate !== false;

  const del = useAction(
    () => api(`/properties/${id}`, { method: 'DELETE' }),
    () => {
      toast('Objekt gelöscht');
      navigate('/objekte');
    },
  );
  const delBuilding = useAction((bid: string) => api(`/buildings/${bid}`, { method: 'DELETE' }), () => toast('Gebäude gelöscht'));

  if (isLoading) return <PageSkeleton />;
  if (error || !p) return <ErrorBox error={error ?? new Error('Objekt nicht gefunden')} onRetry={() => refetch()} />;

  const offline = async (bid: string) => {
    setPreparing(bid);
    try {
      const b = await prepareBuilding(bid);
      toast(`${b.assets.length} Elemente offline verfügbar`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'bad');
    } finally {
      setPreparing(null);
    }
  };

  const due = countDue(p.assets);
  const openDefects = p.assets.reduce((s, a) => s + a.openDefects, 0);
  const menu: MenuItem[] = [];
  if (isAdmin) {
    menu.push({ label: 'Objekt bearbeiten', icon: <Pencil />, onClick: () => setEdit(true) });
    menu.push({ label: 'Gebäude hinzufügen', icon: <Building2 />, onClick: () => setBuilding('new') });
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

  const status = (
    <SideCard title="Prüfstatus" action={p.assets.length > 0 && <SectionLink to={`/elemente?objekt=${p.id}`}>Alle Elemente</SectionLink>}>
      {p.assets.length ? (
        <>
          <p className="mb-3 text-body text-ink-2">
            <span className="font-semibold text-ink tabular-nums">{p.assets.length}</span> Elemente
            {openDefects > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-warn tabular-nums">{openDefects}</span> {openDefects === 1 ? 'offener Mangel' : 'offene Mängel'}
              </>
            )}
          </p>
          <StatusBar counts={due} legend />
          {nextDue(p)}
        </>
      ) : (
        <p className="text-body text-ink-3">Noch keine Elemente erfasst.</p>
      )}
    </SideCard>
  );

  return (
    <>
      {confirmEl}
      <PageHeader
        breadcrumbs={[{ label: 'Objekte', to: '/objekte' }, { label: p.name }]}
        title={p.name}
        subtitle={[p.address.split('\n').join(', '), BUILDING_TYPES[p.buildingType]].filter(Boolean).join(' · ')}
        meta={
          (due.overdue > 0 || due.soon > 0 || openDefects > 0) && (
            <>
              {due.overdue > 0 && (
                <Badge tone="bad" dot>
                  {due.overdue} überfällig
                </Badge>
              )}
              {due.soon > 0 && (
                <Badge tone="warn" dot>
                  {due.soon} bald fällig
                </Badge>
              )}
              {openDefects > 0 && <Badge tone="brand">{defectsLabel(openDefects)} offen</Badge>}
            </>
          )
        }
        actions={
          <>
            {/* Handy: nur Symbol (Name bleibt für Screenreader), damit die Hauptaktion in die Zeile passt */}
            <span className="contents max-sm:[&_button]:gap-0 max-sm:[&_button]:px-3 max-sm:[&_button]:text-[0px]">
              <PropertyReportButton propertyId={p.id} />
            </span>
            {isAdmin && <SharePropertyButton propertyId={p.id} propertyName={p.name} />}
            {menu.length > 0 && <Menu items={menu} label="Weitere Aktionen zum Objekt" />}
            {canInspect && (
              <Button icon={<Footprints className="size-4" />} onClick={() => setWalk(true)}>
                Begehung starten
              </Button>
            )}
          </>
        }
      />
      {edit && <PropertyForm initial={p} onClose={() => setEdit(false)} />}
      {building && <BuildingForm propertyId={p.id} initial={building === 'new' ? undefined : building} onClose={() => setBuilding(null)} />}
      {assetFor && <AssetForm buildings={p.buildings} propertyId={p.id} defaultBuildingId={assetFor} onClose={() => setAssetFor(null)} />}
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
      {upload && <FloorPlanUpload buildings={p.buildings} onClose={() => setUpload(false)} />}
      {walk && <StartWalkthrough propertyId={p.id} onClose={() => setWalk(false)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        {/* Handy: Prüfstatus direkt unter dem Titel, der Rest des Panels nach dem Inhalt */}
        <div className="lg:col-start-2 lg:row-start-1">{status}</div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'elemente', label: 'Elemente', count: p.assets.length },
              { value: 'grundrisse', label: 'Grundrisse', count: p.floorPlans.length },
              { value: 'begehungen', label: 'Begehungen', count: p.walkthroughs.length },
            ]}
          />

          {tab === 'elemente' &&
            (p.buildings.length === 0 ? (
              <Card>
                <Empty
                  icon={<Building2 />}
                  title="Noch kein Gebäude"
                  text="Lege mindestens ein Gebäude an. Darin erfasst du Türen, Klappen, Löscher und Melder."
                  action={
                    isAdmin && (
                      <Button icon={<Plus className="size-4" />} onClick={() => setBuilding('new')}>
                        Gebäude anlegen
                      </Button>
                    )
                  }
                />
              </Card>
            ) : (
              <>
                {p.assets.length > 10 && <SearchField value={q} onChange={setQ} placeholder="Code, Standort, Art …" label="In diesem Objekt suchen" />}
                {p.buildings.map((b) => {
                  const inBuilding = p.assets.filter((a) => a.buildingId === b.id);
                  const needle = q.trim().toLowerCase();
                  const assets = needle
                    ? inBuilding.filter((a) => [a.code, a.location, a.floor, categoryLabel(a.category), a.manufacturer].join(' ').toLowerCase().includes(needle))
                    : inBuilding;
                  if (needle && !assets.length) return null;
                  const bMenu: MenuItem[] = [{ label: preparing === b.id ? 'Wird gespeichert …' : 'Für offline speichern', icon: <CloudDownload />, disabled: preparing === b.id, onClick: () => offline(b.id) }];
                  if (isAdmin)
                    bMenu.push({ label: 'Gebäude bearbeiten', icon: <Pencil />, onClick: () => setBuilding(b) }, 'separator', {
                      label: 'Gebäude löschen',
                      icon: <Trash2 />,
                      danger: true,
                      onClick: async () => {
                        if (await confirm({ title: `Gebäude „${b.name}“ löschen?`, text: `Die ${inBuilding.length} Elemente darin werden mit gelöscht.`, confirmLabel: 'Löschen', danger: true }))
                          delBuilding.mutate(b.id);
                      },
                    });
                  return (
                    <section key={b.id} aria-label={b.name}>
                      <SectionHeader
                        title={
                          <span className="flex min-w-0 items-center gap-2">
                            <Building2 className="size-4 shrink-0 text-ink-3" />
                            <span className="truncate">{b.name}</span>
                          </span>
                        }
                        count={inBuilding.length}
                        action={
                          <div className="flex shrink-0 items-center gap-1">
                            <Menu items={bMenu} label={`Weitere Aktionen zu ${b.name}`} />
                            {canCreate && (
                              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setAssetFor(b.id)}>
                                Element
                              </Button>
                            )}
                          </div>
                        }
                      />
                      {b.address && <p className="-mt-1.5 mb-2.5 text-meta text-ink-3">{b.address.split('\n').join(', ')}</p>}
                      <Card className="overflow-hidden">
                        {assets.length === 0 ? (
                          <Empty compact icon={<Package />} title="Keine Elemente in diesem Gebäude" text="Lege Türen, Klappen, Löscher oder Melder an." />
                        ) : (
                          <AssetList assets={assets} onSelect={setSelected} showPlace={false} />
                        )}
                      </Card>
                    </section>
                  );
                })}
                {q.trim() && !p.assets.some((a) => [a.code, a.location, a.floor, categoryLabel(a.category), a.manufacturer].join(' ').toLowerCase().includes(q.trim().toLowerCase())) && (
                  <Card>
                    <Empty compact title="Keine Treffer" text={`Kein Element passt zu „${q.trim()}“.`} action={<Button variant="secondary" onClick={() => setQ('')}>Suche leeren</Button>} />
                  </Card>
                )}
                {isAdmin && !q.trim() && (
                  <Button variant="ghost" className="self-start" icon={<Plus className="size-4" />} onClick={() => setBuilding('new')}>
                    Gebäude hinzufügen
                  </Button>
                )}
              </>
            ))}

          {tab === 'grundrisse' && <PlansTab p={p} canUpload={isAdmin} onUpload={() => setUpload(true)} />}

          {tab === 'begehungen' &&
            (p.walkthroughs.length === 0 ? (
              <Card>
                <Empty
                  icon={<Footprints />}
                  title="Noch keine Begehung"
                  text="Eine Begehung prüft das ganze Objekt: Fluchtwege, Beschilderung, Brandlasten."
                  action={
                    canInspect && (
                      <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setWalk(true)}>
                        Erste Begehung
                      </Button>
                    )
                  }
                />
              </Card>
            ) : (
              <List aria-label="Begehungen">
                {p.walkthroughs.map((w) => (
                  <ListRow
                    key={w.id}
                    to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`}
                    leading={
                      <RowIcon>
                        <Footprints />
                      </RowIcon>
                    }
                    title={fmtDateTime(w.inspectedAt ?? w.createdAt)}
                    subtitle={[w.inspector, w.buildingName].filter(Boolean).join(' · ')}
                    trailing={
                      <>
                        {w.openDefects > 0 && (
                          <Badge tone="brand" className="max-sm:hidden">
                            {defectsLabel(w.openDefects)}
                          </Badge>
                        )}
                        {w.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : w.result && <ResultBadge result={w.result} />}
                      </>
                    }
                    chevron
                  />
                ))}
              </List>
            ))}
        </div>

        <aside className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2">
          <WalkCard p={p} />
          <FireOfficersCard propertyId={p.id} officers={p.fireOfficers ?? []} canEdit={isAdmin} />
          <SideCard
            title="Vor Ort"
            action={
              isAdmin && (
                <Button size="xs" variant="ghost" icon={<Pencil />} onClick={() => setEdit(true)}>
                  Bearbeiten
                </Button>
              )
            }
          >
            {p.contactName || p.contactPhone || p.contactEmail ? (
              <ul className="flex flex-col gap-2.5 text-body">
                {p.contactName && (
                  <li className="flex items-center gap-2.5" title="Ansprechperson">
                    <User className="size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0">{p.contactName}</span>
                  </li>
                )}
                {p.contactPhone && (
                  <li>
                    <a href={`tel:${p.contactPhone}`} className="flex items-center gap-2.5 hover:underline">
                      <Phone className="size-4 shrink-0 text-ink-3" /> {p.contactPhone}
                    </a>
                  </li>
                )}
                {p.contactEmail && (
                  <li>
                    <a href={`mailto:${p.contactEmail}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                      <Mail className="size-4 shrink-0 text-ink-3" /> <span className="truncate">{p.contactEmail}</span>
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-body text-ink-3">Keine Ansprechperson hinterlegt.</p>
            )}
            {p.description && <p className="mt-4 border-t border-line pt-4 text-body whitespace-pre-line text-ink-2">{p.description}</p>}
          </SideCard>
        </aside>
      </div>
    </>
  );
}

/** Das dringendste Element (frühester Termin) als Sprungziel. */
function nextDue(p: PropertyDetail) {
  const next = p.assets.reduce<Asset | null>((m, a) => (a.nextDueAt != null && a.lastResult !== 'not_inspectable' && (!m || a.nextDueAt < (m.nextDueAt ?? Infinity)) ? a : m), null);
  if (!next) return null;
  const d = dueInfo(next);
  return (
    <Link to={`/elemente/${next.id}`} className="group mt-4 flex items-center gap-3 border-t border-line pt-4">
      <span className="min-w-0 flex-1">
        <span className="block text-caption text-ink-3">Am dringendsten</span>
        <span className="block truncate text-body font-medium group-hover:underline">
          {next.code} <span className="font-normal text-ink-3">{next.location}</span>
        </span>
        <span className={`block text-meta ${d.tone === 'bad' || d.tone === 'warn' ? toneText[d.tone] : 'text-ink-3'}`}>{d.detail}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function WalkCard({ p }: { p: PropertyDetail }) {
  const last = p.walkthroughs.find((w) => w.status === 'submitted');
  const d = last?.nextDueAt ? dueInfo({ nextDueAt: last.nextDueAt, lastResult: null }) : null;
  return (
    <SideCard title="Brandschutzbegehung">
      {last ? (
        <PropertyList
          items={[
            { label: 'Zuletzt', value: fmtDate(last.inspectedAt) },
            {
              label: 'Nächste',
              value: last.nextDueAt && (
                <>
                  {fmtDate(last.nextDueAt)}
                  {d && (d.tone === 'bad' || d.tone === 'warn') && <span className={`block text-meta font-normal ${toneText[d.tone]}`}>{d.detail}</span>}
                </>
              ),
            },
          ]}
        />
      ) : (
        <p className="text-body text-ink-3">Noch nicht durchgeführt.</p>
      )}
    </SideCard>
  );
}

function PlansTab({ p, canUpload, onUpload }: { p: PropertyDetail; canUpload: boolean; onUpload: () => void }) {
  if (!p.floorPlans.length)
    return (
      <Card>
        <Empty
          icon={<Map />}
          title="Noch keine Grundrisse"
          text={p.buildings.length ? 'Lade Pläne als Bild oder PDF hoch und markiere darauf, wo die Elemente sind.' : 'Lege zuerst ein Gebäude an.'}
          action={
            canUpload &&
            p.buildings.length > 0 && (
              <Button icon={<Upload className="size-4" />} onClick={onUpload}>
                Grundriss hochladen
              </Button>
            )
          }
        />
      </Card>
    );
  const placed = (bid: string) => p.assets.filter((a) => a.buildingId === bid && a.floorPlanId).length;
  return (
    <section>
      <SectionHeader
        title="Grundrisse"
        count={p.floorPlans.length}
        action={
          canUpload && (
            <Button size="sm" variant="secondary" icon={<Upload />} onClick={onUpload}>
              Grundriss hochladen
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {p.floorPlans.map((f) => {
          const b = p.buildings.find((x) => x.id === f.buildingId);
          const total = p.assets.filter((a) => a.buildingId === f.buildingId).length;
          return (
            <Link key={f.id} to={`/grundrisse/${f.id}`} className="group overflow-hidden rounded-xl bg-surface shadow-card transition-shadow hover:shadow-lift">
              <div className="relative bg-sunken" style={{ aspectRatio: '4 / 3' }}>
                <img src={fileUrl(f.fileKey)} alt={f.name} className="absolute inset-0 size-full object-contain p-3" loading="lazy" />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium">{f.name}</span>
                  <span className="block truncate text-meta text-ink-3">{b?.name}</span>
                </span>
                <span className="shrink-0 text-meta text-ink-3 tabular-nums" title={`${placed(f.buildingId)} von ${total} Elementen des Gebäudes auf einem Plan`}>
                  {f.markers} {f.markers === 1 ? 'Marker' : 'Marker'}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function FireOfficersCard({ propertyId, officers, canEdit }: { propertyId: string; officers: FireOfficer[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<Partial<FireOfficer> | null>(null);
  const now = Date.now();
  const current = officers.find((o) => o.appointedFrom <= now && (!o.appointedTo || o.appointedTo > now));
  const history = officers.filter((o) => o !== current);
  return (
    <SideCard
      title="Brandschutzbeauftragte/r"
      action={
        canEdit && (
          <Button size="xs" variant="ghost" icon={<Plus />} onClick={() => setEdit({})}>
            Bestellen
          </Button>
        )
      }
    >
      {edit && <FireOfficerForm propertyId={propertyId} initial={edit} onClose={() => setEdit(null)} />}
      {current ? (
        <button type="button" className="flex w-full items-start gap-3 rounded-lg text-left disabled:cursor-default" disabled={!canEdit} onClick={() => setEdit(current)}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
            <ShieldCheck className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium">{current.name}</span>
            <span className="block text-meta text-ink-3">{[current.company, current.qualification].filter(Boolean).join(' · ')}</span>
            <span className="block text-meta text-ink-3">
              seit {fmtDate(current.appointedFrom)}
              {current.appointedTo && ` · bis ${fmtDate(current.appointedTo)}`}
            </span>
            {current.phone && <span className="mt-1 block text-meta text-ink-2">{current.phone}</span>}
            {current.email && <span className="block truncate text-meta text-ink-2">{current.email}</span>}
          </span>
        </button>
      ) : (
        <p className="text-body text-ink-3">Niemand bestellt.</p>
      )}
      {history.length > 0 && (
        <details className="mt-3 border-t border-line pt-3 text-meta">
          <summary className="cursor-pointer text-ink-2">Frühere ({history.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((o) => (
              <li key={o.id}>
                <button type="button" className="text-left text-ink-2 hover:underline disabled:no-underline" disabled={!canEdit} onClick={() => setEdit(o)}>
                  {o.name}
                  {o.company && ` (${o.company})`} · {fmtDate(o.appointedFrom)} – {o.appointedTo ? fmtDate(o.appointedTo) : 'offen'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SideCard>
  );
}

const dateIn = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const dateOut = (s: string) => (s ? new Date(`${s}T12:00:00`).getTime() : null);

function FireOfficerForm({ propertyId, initial, onClose }: { propertyId: string; initial: Partial<FireOfficer>; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [f, setF] = useState({
    name: initial.name ?? '',
    company: initial.company ?? '',
    phone: initial.phone ?? '',
    email: initial.email ?? '',
    qualification: initial.qualification ?? '',
    from: dateIn(initial.appointedFrom ?? Date.now()),
    to: dateIn(initial.appointedTo),
    notes: initial.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ name: f.name, company: f.company, phone: f.phone, email: f.email, qualification: f.qualification, appointedFrom: dateOut(f.from), appointedTo: dateOut(f.to), notes: f.notes });
  const save = useAction(
    () => (initial.id ? api(`/fire-officers/${initial.id}`, { method: 'PATCH', body: body() }) : api(`/properties/${propertyId}/fire-officers`, { body: body() })),
    () => {
      toast('Gespeichert');
      onClose();
    },
  );
  const del = useAction(() => api(`/fire-officers/${initial.id}`, { method: 'DELETE' }), () => onClose());
  return (
    <Modal
      title={initial.id ? 'Brandschutzbeauftragte/n bearbeiten' : 'Brandschutzbeauftragte/n bestellen'}
      description={initial.id ? undefined : 'Eine laufende Bestellung endet automatisch zum Startdatum.'}
      onClose={onClose}
      footer={
        <>
          {initial.id && (
            <Button
              variant="ghost"
              className="text-bad sm:mr-auto"
              onClick={async () => (await confirm({ title: 'Eintrag löschen?', confirmLabel: 'Löschen', danger: true })) && del.mutate(undefined)}
            >
              Löschen
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="officer-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      {confirmEl}
      <form
        id="officer-form"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.error && (
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        )}
        <Field label="Name">{(id) => <Input id={id} required value={f.name} onChange={set('name')} />}</Field>
        <Field label="Firma / Stelle" optional>
          {(id) => <Input id={id} value={f.company} onChange={set('company')} />}
        </Field>
        <Field label="Telefon" optional>
          {(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}
        </Field>
        <Field label="E-Mail" optional>
          {(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label="Qualifikation" optional className="sm:col-span-2">
          {(id) => <Input id={id} value={f.qualification} onChange={set('qualification')} placeholder="z. B. Brandschutzbeauftragte/r nach DGUV 205-003" />}
        </Field>
        <Field label="Bestellt ab">{(id) => <Input id={id} type="date" required value={f.from} onChange={set('from')} />}</Field>
        <Field label="Bestellt bis" optional hint="Leer = unbefristet">
          {(id) => <Input id={id} type="date" value={f.to} onChange={set('to')} />}
        </Field>
        <Field label="Notizen" optional className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={set('notes')} />}
        </Field>
      </form>
    </Modal>
  );
}
