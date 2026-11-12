// Objekt (Design v3, Vorlage „Detail“ docs/design.md 5.3): Kopf mit einer Hauptaktion, Reiter auf dem Grund,
// eine Surface mit Sections (je Gebäude, Grundrisse, Begehungen); rechts Prüfstatus, Begehung,
// Brandschutzbeauftragte/r und „Vor Ort“ als Text auf dem Grund. Belege: docs/design/objekte-elemente.md
import { Building2, CloudDownload, Footprints, Mail, Pencil, Phone, Plus, Trash2, Upload, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BUILDING_TYPES } from '../../shared/walkthrough';
import { api, type Asset, type FireOfficer, fileUrl, type PropertyDetail, useAction, useMe, useProperty } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm, BuildingForm, PropertyForm } from '../components/forms';
import { AsideAction, AsideList, AsideRow, AsideSection } from '../components/objects/Aside';
import { countDue, DUE_ORDER, DuePhrase } from '../components/objects/status';
import { PropertyReportButton } from '../components/PropertyReportButton';
import { SharePropertyButton } from '../components/ShareProperty';
import {
  Button,
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
  ResultBadge,
  SearchField,
  Section,
  SectionLink,
  StatusDot,
  StatusText,
  Surface,
  Tabs,
  Textarea,
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

const matches = (a: Asset, needle: string) => [a.code, a.location, a.floor, categoryLabel(a.category), a.manufacturer].join(' ').toLowerCase().includes(needle);

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
  const needle = q.trim().toLowerCase();
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

  // Kopfzeile: ein Satz zur Lage – das Dringendste mit Punkt, der Rest als grauer Text
  const metaParts = [due.overdue > 0 && `${due.overdue} überfällig`, due.soon > 0 && `${due.soon} bald fällig`, openDefects > 0 && `${defectsLabel(openDefects)} offen`].filter(
    Boolean,
  ) as string[];
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
            {/* Handy: Bericht nur als Symbol (Name bleibt für Screenreader), damit die Hauptaktion in die Zeile passt */}
            <span className="contents max-sm:[&_button]:gap-0 max-sm:[&_button]:px-3 max-sm:[&_button]:text-[0px]">
              <PropertyReportButton propertyId={p.id} variant="ghost" />
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-8">
        {/* Handy: Prüfstatus direkt unter dem Kopf, der Rest der Seitenspalte nach dem Inhalt */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <StatusAside p={p} />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'elemente', label: 'Elemente', count: p.assets.length },
              { value: 'grundrisse', label: 'Grundrisse', count: p.floorPlans.length },
              { value: 'begehungen', label: 'Begehungen', count: p.walkthroughs.length },
            ]}
          />

          <Surface>
            {tab === 'elemente' &&
              (p.buildings.length === 0 ? (
                <Section>
                  <Empty
                    title="Noch kein Gebäude"
                    text="Lege mindestens ein Gebäude an. Darin erfasst du Türen, Klappen, Löscher und Melder."
                    action={
                      isAdmin && (
                        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setBuilding('new')}>
                          Gebäude anlegen
                        </Button>
                      )
                    }
                  />
                </Section>
              ) : (
                <>
                  {p.assets.length > 10 && (
                    <Section className="py-4 sm:py-4">
                      <SearchField value={q} onChange={setQ} placeholder="Code, Standort, Art …" label="In diesem Objekt suchen" className="sm:max-w-none" />
                    </Section>
                  )}
                  {p.buildings.map((b) => {
                    const inBuilding = p.assets.filter((a) => a.buildingId === b.id);
                    const assets = needle ? inBuilding.filter((a) => matches(a, needle)) : inBuilding;
                    if (needle && !assets.length) return null;
                    const bMenu: MenuItem[] = [
                      { label: preparing === b.id ? 'Wird gespeichert …' : 'Für offline speichern', icon: <CloudDownload />, disabled: preparing === b.id, onClick: () => offline(b.id) },
                    ];
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
                      <Section
                        key={b.id}
                        aria-label={b.name}
                        flush
                        title={<span className="truncate">{b.name}</span>}
                        count={inBuilding.length}
                        action={
                          <>
                            <Menu items={bMenu} label={`Weitere Aktionen zu ${b.name}`} />
                            {canCreate && (
                              <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAssetFor(b.id)}>
                                Element
                              </Button>
                            )}
                          </>
                        }
                      >
                        {b.address && <p className="-mt-1 mb-2 px-(--row-px) text-meta text-ink-3">{b.address.split('\n').join(', ')}</p>}
                        {assets.length === 0 ? (
                          <p className="px-(--row-px) pb-3 text-body text-ink-2">Keine Elemente in diesem Gebäude. Lege Türen, Klappen, Löscher oder Melder an.</p>
                        ) : (
                          <AssetList assets={assets} onSelect={setSelected} showPlace={false} aria-label={`Elemente in ${b.name}`} />
                        )}
                      </Section>
                    );
                  })}
                  {needle && !p.assets.some((a) => matches(a, needle)) && (
                    <Section>
                      <Empty
                        compact
                        title="Keine Treffer"
                        text={`Kein Element passt zu „${q.trim()}“.`}
                        action={
                          <Button variant="ghost" onClick={() => setQ('')}>
                            Suche leeren
                          </Button>
                        }
                      />
                    </Section>
                  )}
                  {isAdmin && !needle && (
                    <Section className="py-3 sm:py-3">
                      <Button variant="ghost" size="sm" className="-ml-3" icon={<Plus />} onClick={() => setBuilding('new')}>
                        Gebäude hinzufügen
                      </Button>
                    </Section>
                  )}
                </>
              ))}

            {tab === 'grundrisse' && <PlansSection p={p} canUpload={isAdmin} onUpload={() => setUpload(true)} />}

            {tab === 'begehungen' &&
              (p.walkthroughs.length === 0 ? (
                <Section>
                  <Empty
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
                </Section>
              ) : (
                <Section title="Begehungen" count={p.walkthroughs.length} flush>
                  <List plain aria-label="Begehungen">
                    {p.walkthroughs.map((w) => (
                      <ListRow
                        key={w.id}
                        to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`}
                        title={fmtDateTime(w.inspectedAt ?? w.createdAt)}
                        subtitle={[w.inspector, w.buildingName, w.openDefects > 0 ? `${defectsLabel(w.openDefects)} offen` : null].filter(Boolean).join(' · ')}
                        trailing={w.status === 'draft' ? <StatusText tone="info">Entwurf</StatusText> : w.result && <ResultBadge result={w.result} />}
                        chevron
                      />
                    ))}
                  </List>
                </Section>
              ))}
          </Surface>
        </div>

        <aside className="flex min-w-0 flex-col gap-8 lg:col-start-2 lg:row-start-2" aria-label="Zum Objekt">
          <WalkAside p={p} />
          <FireOfficersAside propertyId={p.id} officers={p.fireOfficers ?? []} canEdit={isAdmin} />
          <AsideSection title="Vor Ort" action={isAdmin && <AsideAction onClick={() => setEdit(true)}>Bearbeiten</AsideAction>}>
            {p.contactName || p.contactPhone || p.contactEmail ? (
              <ul className="border-t border-line text-body">
                {p.contactName && (
                  <ContactRow icon={<User />} title="Ansprechperson">
                    {p.contactName}
                  </ContactRow>
                )}
                {p.contactPhone && (
                  <ContactRow icon={<Phone />} href={`tel:${p.contactPhone}`}>
                    {p.contactPhone}
                  </ContactRow>
                )}
                {p.contactEmail && (
                  <ContactRow icon={<Mail />} href={`mailto:${p.contactEmail}`}>
                    {p.contactEmail}
                  </ContactRow>
                )}
              </ul>
            ) : (
              <p className="border-t border-line py-3 text-body text-ink-2">Keine Ansprechperson hinterlegt.</p>
            )}
            {p.description && <p className="pt-3 text-body whitespace-pre-line text-ink-2">{p.description}</p>}
          </AsideSection>
        </aside>
      </div>
    </>
  );
}

function ContactRow({ icon, href, title, children }: { icon: ReactNode; href?: string; title?: string; children: ReactNode }) {
  const inner = (
    <>
      <span className="shrink-0 text-ink-3 [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
  return (
    <li className="border-b border-line" title={title}>
      {href ? (
        <a href={href} className="flex min-h-11 items-center gap-2.5 py-2 text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4">
          {inner}
        </a>
      ) : (
        <span className="flex min-h-11 items-center gap-2.5 py-2 text-ink">{inner}</span>
      )}
    </li>
  );
}

/** Prüfstatus des Objekts als Zahlenliste auf dem Grund (wie „Heute“) und das dringendste Element. */
function StatusAside({ p }: { p: PropertyDetail }) {
  const due = countDue(p.assets);
  const openDefects = p.assets.reduce((s, a) => s + a.openDefects, 0);
  const parts = DUE_ORDER.map((o) => ({ ...o, n: due[o.key] ?? 0 })).filter((x) => x.n > 0);
  const filter: Partial<Record<string, string>> = { overdue: 'overdue', soon: 'soon', never: 'never' };
  const next = p.assets.reduce<Asset | null>((m, a) => (a.nextDueAt != null && a.lastResult !== 'not_inspectable' && (!m || a.nextDueAt < (m.nextDueAt ?? Infinity)) ? a : m), null);
  return (
    <AsideSection title="Prüfstatus" action={p.assets.length > 0 && <SectionLink to={`/elemente?objekt=${p.id}`}>Alle Elemente</SectionLink>}>
      {p.assets.length === 0 ? (
        <p className="border-t border-line py-3 text-body text-ink-2">Noch keine Elemente erfasst.</p>
      ) : (
        <>
          <AsideList aria-label={`Prüfstatus: ${parts.map((x) => `${x.n} ${x.label}`).join(', ')}`}>
            {parts.map((x) => (
              <AsideRow
                key={x.key}
                to={`/elemente?objekt=${p.id}${filter[x.key] ? `&status=${filter[x.key]}` : ''}`}
                value={<span className="text-body text-ink">{x.n}</span>}
              >
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone={x.tone} />
                  {x.label}
                </span>
              </AsideRow>
            ))}
            {openDefects > 0 && (
              <AsideRow to="/maengel" value={<span className="text-body text-ink">{openDefects}</span>}>
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone="brand" />
                  {openDefects === 1 ? 'Offener Mangel' : 'Offene Mängel'}
                </span>
              </AsideRow>
            )}
          </AsideList>
          {next && (
            <Link to={`/elemente/${next.id}`} className="group mt-4 block">
              <span className="block text-meta text-ink-3">Am dringendsten</span>
              <span className="mt-0.5 block truncate text-body text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
                <span className="font-medium">{next.code}</span>
                {next.location && <span className="text-ink-3"> · {next.location}</span>}
              </span>
              <DuePhrase asset={next} />
            </Link>
          )}
        </>
      )}
    </AsideSection>
  );
}

function WalkAside({ p }: { p: PropertyDetail }) {
  const last = p.walkthroughs.find((w) => w.status === 'submitted');
  return (
    <AsideSection title="Brandschutzbegehung">
      {last ? (
        <AsideList>
          <AsideRow value={fmtDate(last.inspectedAt)}>Zuletzt</AsideRow>
          <AsideRow value={last.nextDueAt ? <DueDate at={last.nextDueAt} /> : '–'}>Nächste</AsideRow>
        </AsideList>
      ) : (
        <p className="border-t border-line py-3 text-body text-ink-2">Noch nicht durchgeführt.</p>
      )}
    </AsideSection>
  );
}

/** Datum, Zinnober nur wenn überschritten. */
function DueDate({ at }: { at: number }) {
  return <span className={at < Date.now() ? 'text-shu' : undefined}>{fmtDate(at)}</span>;
}

function PlansSection({ p, canUpload, onUpload }: { p: PropertyDetail; canUpload: boolean; onUpload: () => void }) {
  if (!p.floorPlans.length)
    return (
      <Section>
        <Empty
          title="Noch keine Grundrisse"
          text={p.buildings.length ? 'Lade Pläne als Bild oder PDF hoch und markiere darauf, wo die Elemente sind.' : 'Lege zuerst ein Gebäude an.'}
          action={
            canUpload &&
            p.buildings.length > 0 && (
              <Button variant="secondary" icon={<Upload className="size-4" />} onClick={onUpload}>
                Grundriss hochladen
              </Button>
            )
          }
        />
      </Section>
    );
  const placed = (bid: string) => p.assets.filter((a) => a.buildingId === bid && a.floorPlanId).length;
  return (
    <Section
      title="Grundrisse"
      count={p.floorPlans.length}
      action={
        canUpload && (
          <Button size="sm" variant="ghost" icon={<Upload />} onClick={onUpload}>
            Grundriss hochladen
          </Button>
        )
      }
    >
      <ul className="grid grid-cols-1 gap-x-6 gap-y-6 pt-2 sm:grid-cols-2">
        {p.floorPlans.map((f) => {
          const b = p.buildings.find((x) => x.id === f.buildingId);
          const total = p.assets.filter((a) => a.buildingId === f.buildingId).length;
          return (
            <li key={f.id}>
              <Link to={`/grundrisse/${f.id}`} className="group block">
                <div className="relative overflow-hidden rounded-md bg-sunken" style={{ aspectRatio: '4 / 3' }}>
                  <img src={fileUrl(f.fileKey)} alt={f.name} className="absolute inset-0 size-full object-contain p-3 mix-blend-multiply" loading="lazy" />
                </div>
                <div className="mt-2.5 flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-body text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{f.name}</span>
                    <span className="block truncate text-meta text-ink-3">{b?.name}</span>
                  </span>
                  <span className="shrink-0 text-meta text-ink-3 tabular-nums" title={`${placed(f.buildingId)} von ${total} Elementen des Gebäudes auf einem Plan`}>
                    {f.markers} Marker
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function FireOfficersAside({ propertyId, officers, canEdit }: { propertyId: string; officers: FireOfficer[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<Partial<FireOfficer> | null>(null);
  const now = Date.now();
  const current = officers.find((o) => o.appointedFrom <= now && (!o.appointedTo || o.appointedTo > now));
  const history = officers.filter((o) => o !== current);
  return (
    <AsideSection title="Brandschutzbeauftragte/r" action={canEdit && <AsideAction onClick={() => setEdit({})}>Bestellen</AsideAction>}>
      {edit && <FireOfficerForm propertyId={propertyId} initial={edit} onClose={() => setEdit(null)} />}
      {current ? (
        <button
          type="button"
          className="group block w-full border-y border-line py-3 text-left disabled:cursor-default"
          disabled={!canEdit}
          onClick={() => setEdit(current)}
        >
          <span className="block text-body text-ink group-enabled:group-hover:underline group-enabled:group-hover:decoration-line-strong group-enabled:group-hover:underline-offset-4">
            {current.name}
          </span>
          {(current.company || current.qualification) && <span className="mt-0.5 block text-meta text-ink-3">{[current.company, current.qualification].filter(Boolean).join(' · ')}</span>}
          <span className="block text-meta text-ink-3">
            seit {fmtDate(current.appointedFrom)}
            {current.appointedTo && ` · bis ${fmtDate(current.appointedTo)}`}
          </span>
          {current.phone && <span className="mt-1 block text-meta text-ink-2">{current.phone}</span>}
          {current.email && <span className="block truncate text-meta text-ink-2">{current.email}</span>}
        </button>
      ) : (
        <p className="border-t border-line py-3 text-body text-ink-2">Niemand bestellt.</p>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-meta">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Frühere {history.length}</summary>
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
    </AsideSection>
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
              className="sm:mr-auto"
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
