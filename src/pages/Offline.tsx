import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CloudDownload, CloudOff, CloudUpload, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { summarizeSchedules } from '../../shared/logic';
import { registerCategories } from '../categories';
import { api, type PropertyDetail, useMe, useProperties } from '../api';
import { DueBadge } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { InspectionForm, type InspectionDraft, PhotoCtx } from '../components/run';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, PageHeader, Select, Spinner, useToast } from '../components/ui';
import { fmtDateTime } from '../format';
import {
  type Bundle,
  enqueue,
  findAsset,
  getDraft,
  listBundles,
  localPhotoSrc,
  prepareBuilding,
  removeBuilding,
  removeFromOutbox,
  saveDraft,
  dropDraft,
  storePhoto,
  syncOutbox,
  useOfflineVersion,
  useOnline,
  useOutbox,
} from '../offline';

function useBundles() {
  const v = useOfflineVersion();
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  useEffect(() => {
    listBundles().then(setBundles);
  }, [v]);
  return bundles;
}

export function OfflinePage() {
  const online = useOnline();
  const bundles = useBundles();
  const outbox = useOutbox();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async (id: string) => {
    setBusy(id);
    try {
      await prepareBuilding(id);
      toast('Gebäude aktualisiert');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Offline-Modus"
        subtitle="Gebäude vorab auf dieses Gerät laden und ohne Netz prüfen"
        actions={
          <Badge tone={online ? 'ok' : 'warn'} dot>
            {online ? 'Online' : 'Offline'}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          {online && <PrepareCard />}
          {bundles === null ? (
            <Spinner />
          ) : bundles.length === 0 ? (
            <Card>
              <Empty
                icon={<CloudDownload className="size-5" />}
                title="Noch keine Gebäude auf dem Gerät"
                text="Lade die Gebäude, in denen du ohne Netz (Keller, Tiefgarage) prüfen willst, vorher bei bestehender Verbindung herunter."
              />
            </Card>
          ) : (
            bundles.map((b) => (
              <Card key={b.building.id}>
                <CardHeader
                  title={`${b.building.propertyName} · ${b.building.name}`}
                  subtitle={`${b.assets.length} Elemente · Stand ${fmtDateTime(b.preparedAt)}`}
                  action={
                    <div className="flex gap-1">
                      {online && (
                        <Button size="sm" variant="ghost" aria-label="Aktualisieren" loading={busy === b.building.id} onClick={() => refresh(b.building.id)}>
                          <RefreshCw className="size-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" aria-label="Vom Gerät entfernen" onClick={() => removeBuilding(b.building.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  }
                />
                <ul className="divide-y divide-line">
                  {b.assets.map((a) => {
                    const queued = outbox.some((o) => o.assetId === a.id);
                    return (
                      <li key={a.id}>
                        <Link to={`/offline/pruefen/${a.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                          <CategoryIcon category={a.category} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">
                              {a.code} <span className="font-normal text-ink-3">· {getCategory(a.category).label}</span>
                            </span>
                            <span className="block truncate text-xs text-ink-3">{[a.location, a.floor].filter(Boolean).join(' · ') || '–'}</span>
                          </span>
                          {queued ? <Badge tone="info">Wartet auf Sync</Badge> : <DueBadge asset={a} />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
        </div>

        <aside>
          <Card>
            <CardHeader
              title="Warteschlange"
              subtitle={outbox.length ? `${outbox.length} Prüfungen noch nicht übertragen` : 'Alles übertragen'}
              action={
                outbox.length > 0 &&
                online && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<CloudUpload className="size-3.5" />}
                    onClick={async () => {
                      const r = await syncOutbox();
                      toast(r.sent ? `${r.sent} Prüfungen übertragen` : r.failed ? 'Übertragung fehlgeschlagen' : 'Nichts zu übertragen', r.failed ? 'bad' : 'ok');
                    }}
                  >
                    Senden
                  </Button>
                )
              }
            />
            {outbox.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">Keine offenen Offline-Prüfungen.</p>
            ) : (
              <ul className="divide-y divide-line">
                {outbox.map((o) => (
                  <li key={o.clientId} className="flex items-start gap-3 px-5 py-3">
                    {o.error ? <AlertCircle className="mt-0.5 size-4 text-bad" /> : online ? <Wifi className="mt-0.5 size-4 text-ink-3" /> : <CloudOff className="mt-0.5 size-4 text-ink-3" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{o.code}</p>
                      <p className="text-xs text-ink-3">geprüft {fmtDateTime(o.inspectedAt)}</p>
                      {o.error && <p className="text-xs text-bad">{o.error}</p>}
                    </div>
                    {o.error && (
                      <Button size="sm" variant="ghost" aria-label="Verwerfen" onClick={() => confirm('Diese Offline-Prüfung verwerfen?') && removeFromOutbox(o.clientId)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function PrepareCard() {
  const props = useProperties();
  const [propertyId, setPropertyId] = useState('');
  const detail = useQuery({ queryKey: ['property', propertyId], queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`), enabled: !!propertyId });
  const [buildingId, setBuildingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  return (
    <Card className="p-5">
      <p className="mb-3 text-sm font-semibold">Gebäude vorbereiten</p>
      {!!error && <ErrorBox error={error} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setBuildingId('');
          }}
        >
          <option value="">Objekt wählen …</option>
          {props.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={buildingId} disabled={!detail.data} onChange={(e) => setBuildingId(e.target.value)}>
          <option value="">Gebäude wählen …</option>
          {detail.data?.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Button
          disabled={!buildingId}
          loading={busy}
          icon={<CloudDownload className="size-4" />}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const b = await prepareBuilding(buildingId);
              toast(`${b.assets.length} Elemente gespeichert`);
              setBuildingId('');
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Laden
        </Button>
      </div>
    </Card>
  );
}

export function OfflineRun() {
  const { assetId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useMe();
  useOfflineVersion(); // für lokale Fotos neu rendern
  const [params] = useSearchParams();
  const [state, setState] = useState<{ found: Awaited<ReturnType<typeof findAsset>>; draft: InspectionDraft | undefined; schedule: string } | null>(null);
  useEffect(() => {
    (async () => {
      const found = await findAsset(assetId);
      if (found?.bundle.categories) registerCategories(found.bundle.categories);
      const schedule = params.get('pruefart') ?? (found ? (summarizeSchedules(found.asset.schedules ?? {}).nextKey ?? 'main') : 'main');
      setState({ found, draft: await getDraft(assetId, schedule), schedule });
    })();
  }, [assetId, params]);

  if (!state) return <Spinner className="min-h-dvh items-center" />;
  if (!state.found)
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4 text-sm text-ink-3">Dieses Element ist nicht auf dem Gerät gespeichert.</p>
        <Link to="/offline">
          <Button>Zum Offline-Modus</Button>
        </Link>
      </div>
    );
  const { asset, bundle } = state.found;
  const cat = bundle.categories?.find((t) => t.key === asset.category);
  const sched = cat?.schedulesEffective.find((s) => s.key === state.schedule) ?? cat?.schedulesEffective[0];
  if (!cat || !sched)
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4 text-sm text-ink-3">Die Offline-Daten dieses Gebäudes sind veraltet. Bitte bei Verbindung neu laden.</p>
        <Link to="/offline">
          <Button>Zum Offline-Modus</Button>
        </Link>
      </div>
    );
  return (
    <PhotoCtx.Provider value={{ upload: storePhoto, src: (k) => (k.startsWith('local:') ? localPhotoSrc(k) : `/api/files/${k}`) }}>
      <InspectionForm
        offline
        subject={{ ...asset, buildingName: bundle.building.name, propertyName: bundle.building.propertyName }}
        scheduleLabel={sched.label}
        checkpoints={sched.checkpoints}
        inspectorName={me?.user.name ?? ''}
        back="/offline"
        initial={
          state.draft ?? {
            kind: asset.lastInspectedAt ? 'periodic' : 'initial',
            notInspectable: false,
            answers: {},
            maintenance: [],
            defects: [],
            photos: [],
            notes: '',
            signature: null,
            signerName: '',
          }
        }
        persist={(d) => saveDraft(asset.id, sched.key, d)}
        submit={async (d) => {
          await enqueue({
            clientId: crypto.randomUUID(),
            assetId: asset.id,
            code: asset.code,
            buildingId: bundle.building.id,
            schedule: sched.key,
            checkpoints: sched.checkpoints,
            draft: d,
            inspectedAt: Date.now(),
          });
          toast(navigator.onLine ? 'Gespeichert – wird übertragen' : 'Offline gespeichert');
          if (navigator.onLine) void syncOutbox();
          navigate('/offline', { replace: true });
        }}
        discard={async () => {
          await dropDraft(asset.id, sched.key);
          navigate('/offline', { replace: true });
        }}
      />
    </PhotoCtx.Provider>
  );
}
