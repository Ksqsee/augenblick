import { ArrowLeft, Building2, Mail, MoreHorizontal, Package, Pencil, Phone, Plus, Trash2, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Asset, useAction, useMe, useProperty } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm, BuildingForm, PropertyForm } from '../components/forms';
import { Button, Card, CardHeader, Empty, ErrorBox, PageHeader, Spinner, useToast } from '../components/ui';

export function PropertyPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, error } = useProperty(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [building, setBuilding] = useState<null | 'new' | { id: string; name: string; address: string }>(null);
  const [assetFor, setAssetFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [menu, setMenu] = useState(false);
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

  return (
    <>
      <PageHeader
        back={
          <Link to="/objekte" className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> Objekte
          </Link>
        }
        title={p.name}
        subtitle={p.address.split('\n').join(', ')}
        actions={
          isAdmin && (
            <div className="relative flex gap-2">
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
                Bearbeiten
              </Button>
              <Button variant="secondary" aria-label="Mehr" onClick={() => setMenu((m) => !m)}>
                <MoreHorizontal className="size-4" />
              </Button>
              {menu && (
                <div className="animate-in absolute top-full right-0 z-20 mt-1 w-48 rounded-xl border border-line bg-surface p-1 shadow-pop">
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
          )
        }
      />
      {edit && <PropertyForm initial={p} onClose={() => setEdit(false)} />}
      {building && <BuildingForm propertyId={p.id} initial={building === 'new' ? undefined : building} onClose={() => setBuilding(null)} />}
      {assetFor && <AssetForm buildings={p.buildings} defaultBuildingId={assetFor} onClose={() => setAssetFor(null)} />}
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-6">
          {p.buildings.length === 0 ? (
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
            p.buildings.map((b) => {
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
            })
          )}
          {isAdmin && p.buildings.length > 0 && (
            <button
              onClick={() => setBuilding('new')}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-sm font-medium text-ink-2 hover:bg-sunken"
            >
              <Plus className="size-4" /> Weiteres Gebäude
            </button>
          )}
        </div>

        <aside className="flex flex-col gap-4">
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
