import { ArrowLeft, Building2, CloudDownload, Footprints, Mail, Map, MoreHorizontal, Package, Pencil, Phone, Plus, Trash2, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BUILDING_TYPES } from '../../shared/walkthrough';
import { api, type Asset, fileUrl, useAction, useMe, useProperty } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm, BuildingForm, PropertyForm } from '../components/forms';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { defectsLabel, fmtDate, fmtDateTime, RESULT_META } from '../format';
import { prepareBuilding } from '../offline';
import { FloorPlanUpload } from './FloorPlan';
import { StartWalkthrough } from './Walkthroughs';

type Tab = 'elemente' | 'grundrisse' | 'begehungen';

export function PropertyPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, error } = useProperty(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'elemente';
  const [edit, setEdit] = useState(false);
  const [building, setBuilding] = useState<null | 'new' | { id: string; name: string; address: string }>(null);
  const [assetFor, setAssetFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [menu, setMenu] = useState(false);
  const [upload, setUpload] = useState(false);
  const [walk, setWalk] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const canInspect = me && me.user.role !== 'viewer';

  const del = useAction(
    () => api(`/properties/${id}`, { method: 'DELETE' }),
    () => {
      toast('Objekt gelöscht');
      navigate('/objekte');
    },
  );
  const delBuilding = useAction((bid: string) => api(`/buildings/${bid}`, { method: 'DELETE' }), () => toast('Gebäude gelöscht'));

  if (isLoading) return <Spinner />;
  if (error || !p) return <ErrorBox error={error} />;
  const lastWalk = p.walkthroughs.find((w) => w.status === 'submitted');

  const offline = async (bid: string) => {
    setPreparing(bid);
    try {
      const b = await prepareBuilding(bid);
      toast(`${b.assets.length} Elemente für offline gespeichert`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'bad');
    } finally {
      setPreparing(null);
    }
  };

  return (
    <>
      <PageHeader
        back={
          <Link to="/objekte" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Objekte
          </Link>
        }
        title={p.name}
        subtitle={[p.address.split('\n').join(', '), BUILDING_TYPES[p.buildingType]].filter(Boolean).join(' · ')}
        actions={
          <div className="relative flex flex-wrap gap-2">
            {canInspect && (
              <Button variant="secondary" icon={<Footprints className="size-4" />} onClick={() => setWalk(true)}>
                Begehung
              </Button>
            )}
            {isAdmin && (
              <>
                <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                  Bearbeiten
                </Button>
                <Button variant="secondary" aria-label="Mehr" onClick={() => setMenu((m) => !m)}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </>
            )}
            {menu && (
              <div className="animate-in absolute top-full right-0 z-20 mt-1 w-52 rounded-xl border border-line bg-surface p-1 shadow-pop">
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-bad hover:bg-bad-soft"
                  onClick={() => {
                    setMenu(false);
                    if (confirm(`„${p.name}“ mit allen Gebäuden und Elementen löschen?`)) del.mutate(undefined);
                  }}
                >
                  <Trash2 className="size-4" /> Objekt löschen
                </button>
              </div>
            )}
          </div>
        }
      />
      {edit && <PropertyForm initial={p} onClose={() => setEdit(false)} />}
      {building && <BuildingForm propertyId={p.id} initial={building === 'new' ? undefined : building} onClose={() => setBuilding(null)} />}
      {assetFor && <AssetForm buildings={p.buildings} defaultBuildingId={assetFor} onClose={() => setAssetFor(null)} />}
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
      {upload && <FloorPlanUpload buildings={p.buildings} onClose={() => setUpload(false)} />}
      {walk && <StartWalkthrough propertyId={p.id} onClose={() => setWalk(false)} />}

      <Segmented
        className="mb-5"
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: 'elemente', label: 'Elemente', count: p.assets.length },
          { value: 'grundrisse', label: 'Grundrisse', count: p.floorPlans.length },
          { value: 'begehungen', label: 'Begehungen', count: p.walkthroughs.length },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          {tab === 'elemente' &&
            (p.buildings.length === 0 ? (
              <Card>
                <Empty
                  icon={<Building2 className="size-5" />}
                  title="Noch kein Gebäude"
                  text="Lege mindestens ein Gebäude an. Darin erfasst du dann Türen, Klappen, Löscher und Melder."
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
                {p.buildings.map((b) => {
                  const assets = p.assets.filter((a) => a.buildingId === b.id);
                  return (
                    <Card key={b.id}>
                      <CardHeader
                        title={
                          <span className="flex items-center gap-2">
                            <Building2 className="size-4 text-ink-3" />
                            {b.name}
                            <span className="text-[13px] font-normal text-ink-3">· {assets.length} Elemente</span>
                          </span>
                        }
                        subtitle={b.address ? b.address.split('\n').join(', ') : undefined}
                        action={
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" aria-label="Für offline speichern" title="Für offline speichern" loading={preparing === b.id} onClick={() => offline(b.id)}>
                              {preparing !== b.id && <CloudDownload className="size-3.5" />}
                            </Button>
                            {isAdmin && (
                              <>
                                <Button size="sm" variant="ghost" aria-label="Gebäude bearbeiten" onClick={() => setBuilding(b)}>
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label="Gebäude löschen"
                                  onClick={() => confirm(`Gebäude „${b.name}“ samt Elementen löschen?`) && delBuilding.mutate(b.id)}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </>
                            )}
                            {canInspect && (
                              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setAssetFor(b.id)}>
                                Element
                              </Button>
                            )}
                          </div>
                        }
                      />
                      {assets.length === 0 ? (
                        <Empty icon={<Package className="size-5" />} title="Keine Elemente in diesem Gebäude" />
                      ) : (
                        <AssetList assets={assets} onSelect={setSelected} showPlace={false} />
                      )}
                    </Card>
                  );
                })}
                {isAdmin && (
                  <button
                    onClick={() => setBuilding('new')}
                    className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm font-medium text-ink-2 hover:bg-sunken"
                  >
                    <Plus className="size-4" /> Weiteres Gebäude
                  </button>
                )}
              </>
            ))}

          {tab === 'grundrisse' && (
            <>
              {p.floorPlans.length === 0 ? (
                <Card>
                  <Empty
                    icon={<Map className="size-5" />}
                    title="Noch keine Grundrisse"
                    text="Lade Pläne als Bild oder PDF hoch und markiere darauf, wo sich die Elemente befinden."
                    action={
                      isAdmin &&
                      p.buildings.length > 0 && (
                        <Button icon={<Plus className="size-4" />} onClick={() => setUpload(true)}>
                          Grundriss hochladen
                        </Button>
                      )
                    }
                  />
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {p.floorPlans.map((f) => (
                    <Link key={f.id} to={`/grundrisse/${f.id}`} className="group overflow-hidden rounded-xl border border-line bg-surface shadow-card hover:border-line-strong">
                      <div className="relative bg-sunken" style={{ aspectRatio: '4 / 3' }}>
                        <img src={fileUrl(f.fileKey)} alt={f.name} className="absolute inset-0 size-full object-contain p-2" loading="lazy" />
                      </div>
                      <div className="flex items-center justify-between px-4 py-3">
                        <span>
                          <span className="block text-sm font-semibold">{f.name}</span>
                          <span className="block text-xs text-ink-3">{p.buildings.find((b) => b.id === f.buildingId)?.name}</span>
                        </span>
                        <Badge>{f.markers} Marker</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {isAdmin && p.floorPlans.length > 0 && (
                <button
                  onClick={() => setUpload(true)}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm font-medium text-ink-2 hover:bg-sunken"
                >
                  <Plus className="size-4" /> Weiteren Grundriss hochladen
                </button>
              )}
            </>
          )}

          {tab === 'begehungen' && (
            <Card>
              {p.walkthroughs.length === 0 ? (
                <Empty
                  icon={<Footprints className="size-5" />}
                  title="Noch keine Begehung"
                  action={
                    canInspect && (
                      <Button icon={<Plus className="size-4" />} onClick={() => setWalk(true)}>
                        Begehung starten
                      </Button>
                    )
                  }
                />
              ) : (
                <ul className="divide-y divide-line">
                  {p.walkthroughs.map((w) => (
                    <li key={w.id}>
                      <Link to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                        <Footprints className="size-4 text-ink-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{fmtDateTime(w.inspectedAt ?? w.createdAt)}</span>
                          <span className="block text-xs text-ink-3">{w.inspector}</span>
                        </span>
                        {w.openDefects > 0 && <Badge tone="warn">{defectsLabel(w.openDefects)}</Badge>}
                        {w.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : w.result && <Badge tone={RESULT_META[w.result].tone}>{RESULT_META[w.result].label}</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="p-5">
            <p className="mb-3 text-[13px] font-semibold text-ink-2">Brandschutzbegehung</p>
            {lastWalk ? (
              <div className="space-y-1 text-sm">
                <p>
                  Zuletzt: <span className="font-medium">{fmtDate(lastWalk.inspectedAt)}</span>
                </p>
                <p className={lastWalk.nextDueAt && lastWalk.nextDueAt < Date.now() ? 'font-medium text-bad' : ''}>
                  Nächste: <span className="font-medium">{fmtDate(lastWalk.nextDueAt)}</span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-3">Noch nicht durchgeführt</p>
            )}
          </Card>
          <Card className="p-5">
            <p className="mb-3 text-[13px] font-semibold text-ink-2">Ansprechperson</p>
            {p.contactName || p.contactPhone || p.contactEmail ? (
              <ul className="space-y-2.5 text-sm">
                {p.contactName && (
                  <li className="flex items-center gap-2.5">
                    <User className="size-4 text-ink-3" /> {p.contactName}
                  </li>
                )}
                {p.contactPhone && (
                  <li>
                    <a href={`tel:${p.contactPhone}`} className="flex items-center gap-2.5 hover:underline">
                      <Phone className="size-4 text-ink-3" /> {p.contactPhone}
                    </a>
                  </li>
                )}
                {p.contactEmail && (
                  <li>
                    <a href={`mailto:${p.contactEmail}`} className="flex items-center gap-2.5 break-all hover:underline">
                      <Mail className="size-4 text-ink-3" /> {p.contactEmail}
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Nicht hinterlegt</p>
            )}
          </Card>
          {p.description && (
            <Card className="p-5">
              <p className="mb-2 text-[13px] font-semibold text-ink-2">Notizen</p>
              <p className="text-sm whitespace-pre-line text-ink-2">{p.description}</p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
