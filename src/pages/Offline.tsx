import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertCircle, Check, CloudDownload, CloudOff, CloudUpload, Loader2, RefreshCw, Trash2, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { summarizeSchedules } from '../../shared/logic';
import { registerCategories } from '../categories';
import { api, type PropertyDetail, useMe, useProperties } from '../api';
import { DueBadge } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { InspectionForm, type InspectionDraft, PhotoCtx } from '../components/run';
import { Badge, Button, Card, Empty, ErrorBox, Field, IconButton, List, ListRow, Notice, PageHeader, SectionHeader, Select, SkeletonList, useConfirm, useToast } from '../components/ui';
import { RunSkeleton } from './InspectionRun';
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
  const [confirm, confirmEl] = useConfirm();

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

  const n = outbox.length;
  return (
    <>
      <PageHeader
        title="Offline-Modus"
        subtitle="Gebäude vorab laden und im Keller oder in der Tiefgarage ohne Netz prüfen"
        meta={
          <Badge tone={online ? 'ok' : 'warn'} dot>
            {online ? 'Verbunden' : 'Kein Netz'}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
        <div className="flex flex-col gap-8">
          {online ? (
            <PrepareCard />
          ) : (
            <Notice tone="warn" icon={<CloudOff />} title="Kein Netz">
              Du kannst alle Gebäude unten prüfen. Die Ergebnisse werden übertragen, sobald du wieder verbunden bist.
            </Notice>
          )}
          <section>
            <SectionHeader title="Auf diesem Gerät" count={bundles?.length || undefined} />
            {bundles === null ? (
              <SkeletonList rows={4} />
            ) : bundles.length === 0 ? (
              <Card>
                <Empty
                  compact
                  icon={<CloudDownload />}
                  title="Noch keine Gebäude geladen"
                  text="Lade die Gebäude, in denen du ohne Netz prüfen willst, vorher bei bestehender Verbindung herunter."
                />
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {bundles.map((b) => (
                  <List
                    key={b.building.id}
                    aria-label={b.building.name}
                    header={
                      <>
                        <span className="min-w-0">
                          <span className="block truncate text-body font-semibold text-ink">
                            {b.building.propertyName} · {b.building.name}
                          </span>
                          <span className="block text-caption text-ink-3">
                            {b.assets.length} Elemente · Stand {fmtDateTime(b.preparedAt)}
                          </span>
                        </span>
                        <span className="flex shrink-0 gap-0.5">
                          {online && (
                            <IconButton
                              label="Aktualisieren"
                              icon={busy === b.building.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                              size="sm"
                              onClick={() => refresh(b.building.id)}
                            />
                          )}
                          <IconButton label="Vom Gerät entfernen" icon={<Trash2 />} size="sm" onClick={() => removeBuilding(b.building.id)} />
                        </span>
                      </>
                    }
                  >
                    {b.assets.map((a) => {
                      const queued = outbox.some((o) => o.assetId === a.id);
                      return (
                        <ListRow
                          key={a.id}
                          to={`/offline/pruefen/${a.id}`}
                          leading={<CategoryIcon category={a.category} size="sm" />}
                          title={
                            <>
                              {a.code} <span className="font-normal text-ink-3">· {getCategory(a.category).label}</span>
                            </>
                          }
                          subtitle={[a.location, a.floor].filter(Boolean).join(' · ') || '–'}
                          trailing={
                            queued ? (
                              <Badge tone="info" icon={<CloudUpload />}>
                                Wartet
                              </Badge>
                            ) : (
                              <DueBadge asset={a} />
                            )
                          }
                          chevron
                        />
                      );
                    })}
                  </List>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <SectionHeader title="Warteschlange" count={n || undefined} />
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className={clsx('grid size-9 shrink-0 place-items-center rounded-lg', n ? 'bg-info-soft text-info' : 'bg-ok-soft text-ok')}>
                {n ? <CloudUpload className="size-[18px]" /> : <Check className="size-[18px]" />}
              </span>
              <p className="min-w-0 flex-1 text-body font-medium">{n ? `${n} ${n === 1 ? 'Prüfung' : 'Prüfungen'} noch nicht übertragen` : 'Alles übertragen'}</p>
              {n > 0 && online && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await syncOutbox();
                    toast(r.sent ? `${r.sent} Prüfungen übertragen` : r.failed ? 'Übertragung fehlgeschlagen' : 'Nichts zu übertragen', r.failed ? 'bad' : 'ok');
                  }}
                >
                  Senden
                </Button>
              )}
            </div>
            {n > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {outbox.map((o) => (
                  <li key={o.clientId} className="flex items-center gap-3 px-4 py-2.5">
                    {o.error ? <AlertCircle className="size-4 shrink-0 text-bad" /> : online ? <Wifi className="size-4 shrink-0 text-ink-3" /> : <CloudOff className="size-4 shrink-0 text-ink-3" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium">{o.code}</p>
                      <p className="text-caption text-ink-3">geprüft {fmtDateTime(o.inspectedAt)}</p>
                      {o.error && <p className="text-caption text-bad">{o.error}</p>}
                    </div>
                    {o.error && (
                      <IconButton
                        label="Verwerfen"
                        icon={<Trash2 />}
                        size="sm"
                        onClick={async () => {
                          if (await confirm({ title: 'Offline-Prüfung verwerfen?', text: 'Sie wurde nicht übertragen und geht verloren.', confirmLabel: 'Verwerfen', danger: true }))
                            removeFromOutbox(o.clientId);
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {confirmEl}
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
    <section>
      <SectionHeader title="Gebäude laden" />
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        {!!error && <ErrorBox error={error} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Objekt">
            {(id) => (
              <Select
                id={id}
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
            )}
          </Field>
          <Field label="Gebäude">
            {(id) => (
              <Select id={id} value={buildingId} disabled={!detail.data} onChange={(e) => setBuildingId(e.target.value)}>
                <option value="">Gebäude wählen …</option>
                {detail.data?.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            disabled={!buildingId}
            loading={busy}
            icon={<CloudDownload />}
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
        <p className="text-caption text-ink-3">Lädt Elemente und Prüfvorlagen des Gebäudes auf dieses Gerät.</p>
      </Card>
    </section>
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

  if (!state) return <RunSkeleton />;
  if (!state.found) return <NotOnDevice title="Nicht auf dem Gerät" text="Dieses Element wurde nicht für die Offline-Prüfung geladen." />;
  const { asset, bundle } = state.found;
  const cat = bundle.categories?.find((t) => t.key === asset.category);
  const sched = cat?.schedulesEffective.find((s) => s.key === state.schedule) ?? cat?.schedulesEffective[0];
  if (!cat || !sched) return <NotOnDevice title="Offline-Daten veraltet" text="Lade das Gebäude bei bestehender Verbindung neu." />;
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
          (state.draft && { ...state.draft, kinds: state.draft.kinds ?? [(state.draft as { kind?: string }).kind ?? 'periodic'] }) ?? {
            kinds: [asset.lastInspectedAt ? 'periodic' : 'initial'],
            notInspectable: false,
            answers: {},
            maintenance: [],
            defects: [],
            photos: [],
            notes: '',
            signature: null,
            signerName: '',
            resultOverride: null,
            resultReason: '',
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

function NotOnDevice({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas p-6">
      <Card className="w-full max-w-sm">
        <Empty
          icon={<CloudOff />}
          title={title}
          text={text}
          action={
            <Link to="/offline">
              <Button>Zum Offline-Modus</Button>
            </Link>
          }
        />
      </Card>
    </div>
  );
}
