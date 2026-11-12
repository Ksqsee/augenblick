// Grundriss: Plan mit Markern je Element, Platzieren per Tippen, Liste der noch nicht platzierten Elemente.
// Design v3: eine Surface mit dem Plan und der Legende, „Nicht platziert“ als Liste auf dem Grund.
// Belege: docs/design/objekte-elemente.md
import clsx from 'clsx';
import { Crosshair, Minus, MoveDiagonal, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Asset, downscale, fileUrl, uploadBlob, useAction, useFloorPlan, useMe } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { AsideSection } from '../components/objects/Aside';
import { Button, ErrorBox, Field, Input, ListRow, Menu, Modal, PageHeader, PageSkeleton, Select, StatusDot, Surface, toneDot, useConfirm, useToast } from '../components/ui';
import { assetDue, DUE_META, type Tone } from '../format';

/** PDF (erste Seite) oder Bild in ein PNG/JPEG für den Grundriss umwandeln. */
async function toPlanImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 2400 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Umwandlung fehlgeschlagen'))), 'image/png'));
    return { blob, width: canvas.width, height: canvas.height };
  }
  const blob = await downscale(file, 3000);
  const bmp = await createImageBitmap(blob);
  return { blob, width: bmp.width, height: bmp.height };
}

export function FloorPlanUpload({ buildings, onClose }: { buildings: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '');
  const [name, setName] = useState('');
  const [level, setLevel] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const save = useAction(
    async () => {
      if (!file) throw new Error('Bitte eine Datei wählen');
      const img = await toPlanImage(file);
      if (img.blob.size > 10 * 1024 * 1024) throw new Error('Datei ist nach der Umwandlung größer als 10 MB');
      const fileKey = await uploadBlob(img.blob);
      return api<{ id: string }>(`/buildings/${buildingId}/floor-plans`, { body: { name, level, fileKey, width: img.width, height: img.height } });
    },
    (r) => {
      toast('Grundriss hochgeladen');
      navigate(`/grundrisse/${r.id}`);
    },
  );
  return (
    <Modal
      title="Grundriss hochladen"
      description="Danach markierst du auf dem Plan, wo die Elemente sind."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="plan-form" loading={save.isPending}>
            Hochladen
          </Button>
        </>
      }
    >
      <form
        id="plan-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.error && <ErrorBox error={save.error} />}
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:bg-hover">
          <Upload className="size-6 text-ink-3" />
          <span className="text-body font-medium">{file ? file.name : 'Bild oder PDF auswählen'}</span>
          <span className="text-caption text-ink-3">PNG, JPG, WebP oder PDF (erste Seite)</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </label>
        {buildings.length > 1 && (
          <Field label="Gebäude">
            {(id) => (
              <Select id={id} value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
          <Field label="Bezeichnung">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Erdgeschoss" />}</Field>
          <Field label="Ebene" hint="0 = EG">
            {(id) => <Input id={id} type="number" inputMode="numeric" value={level} onChange={(e) => setLevel(Number(e.target.value))} />}
          </Field>
        </div>
      </form>
    </Modal>
  );
}

const markerTone = (a: Asset): Tone => (a.openDefects > 0 ? 'brand' : a.lastResult === 'not_inspectable' ? 'muted' : DUE_META[assetDue(a.nextDueAt)].tone);

const LEGEND: [Tone, string][] = [
  ['bad', 'Überfällig'],
  ['warn', 'Bald fällig'],
  ['brand', 'Offene Mängel'],
  ['info', 'Nie geprüft'],
  ['ok', 'Aktuell'],
];

export function FloorPlanPage() {
  const { id = '' } = useParams();
  const { data: plan, isLoading, error, refetch } = useFloorPlan(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [zoom, setZoom] = useState(1);
  const [placing, setPlacing] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canEdit = me?.user.role !== 'viewer';
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);

  const place = useAction(
    (v: { assetId: string; x: number | null; y: number | null }) =>
      api(`/assets/${v.assetId}/marker`, { method: 'PUT', body: { floorPlanId: v.x == null ? null : id, x: v.x, y: v.y } }),
    (_, v) => toast(v.x == null ? 'Vom Plan entfernt' : 'Position gespeichert'),
  );
  const del = useAction(
    () => api(`/floor-plans/${id}`, { method: 'DELETE' }),
    () => {
      toast('Grundriss gelöscht');
      navigate(`/objekte/${plan?.propertyId}?tab=grundrisse`);
    },
  );

  if (isLoading) return <PageSkeleton />;
  if (error || !plan) return <ErrorBox error={error ?? new Error('Grundriss nicht gefunden')} onRetry={() => refetch()} />;
  const onPlan = plan.assets.filter((a) => a.floorPlanId === plan.id && a.markerX != null);
  const unplaced = plan.assets.filter((a) => !a.floorPlanId);

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!placing || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    place.mutate({ assetId: placing.id, x, y });
    setPlacing(null);
  };

  return (
    <>
      {confirmEl}
      <PageHeader
        breadcrumbs={[
          { label: plan.propertyName, to: `/objekte/${plan.propertyId}` },
          { label: 'Grundrisse', to: `/objekte/${plan.propertyId}?tab=grundrisse` },
        ]}
        title={plan.name}
        subtitle={`${plan.buildingName} · ${onPlan.length} ${onPlan.length === 1 ? 'Element' : 'Elemente'} platziert${unplaced.length ? ` · ${unplaced.length} offen` : ''}`}
        actions={
          isAdmin && (
            <Menu
              label="Weitere Aktionen zum Grundriss"
              items={[
                {
                  label: 'Grundriss löschen',
                  icon: <Trash2 />,
                  danger: true,
                  onClick: async () => {
                    if (await confirm({ title: `Grundriss „${plan.name}“ löschen?`, text: 'Die Marker darauf werden entfernt, die Elemente bleiben.', confirmLabel: 'Löschen', danger: true }))
                      del.mutate(undefined);
                  },
                },
              ]}
            />
          )
        }
      />
      {plan.siblings.length > 1 && (
        <nav aria-label="Ebenen" className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {plan.siblings.map((s) => (
            <Link
              key={s.id}
              to={`/grundrisse/${s.id}`}
              aria-current={s.id === plan.id ? 'page' : undefined}
              className={clsx(
                'inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-meta font-medium whitespace-nowrap transition-colors sm:h-8',
                s.id === plan.id ? 'border-line-strong bg-selected text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
              )}
            >
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      {selected && (
        <AssetDrawer asset={selected} onClose={() => setSelected(null)}>
          {canEdit && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<MoveDiagonal />}
                onClick={() => {
                  setPlacing(selected);
                  setSelected(null);
                }}
              >
                Verschieben
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<X />}
                onClick={() => {
                  place.mutate({ assetId: selected.id, x: null, y: null });
                  setSelected(null);
                }}
              >
                Vom Plan entfernen
              </Button>
            </div>
          )}
        </AssetDrawer>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10">
        <Surface className="min-w-0 overflow-hidden">
          <div className="relative">
            {placing && (
              <div className="animate-in absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-lg bg-ink py-1.5 pr-1.5 pl-3 text-body text-white shadow-pop sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
                <Crosshair className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  Tippe auf die Position von <b>{placing.code}</b>
                </span>
                <button type="button" onClick={() => setPlacing(null)} className="grid size-8 place-items-center rounded-md hover:bg-white/10" aria-label="Platzieren abbrechen">
                  <X className="size-4" />
                </button>
              </div>
            )}
            <div className="absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-lg bg-surface shadow-pop">
              <button type="button" className="grid size-10 place-items-center hover:bg-hover sm:size-9" aria-label="Vergrößern" onClick={() => setZoom((z) => Math.min(4, z * 1.4))}>
                <Plus className="size-4" />
              </button>
              <button
                type="button"
                className="grid size-10 place-items-center border-t border-line hover:bg-hover disabled:text-ink-4 sm:size-9"
                aria-label="Verkleinern"
                disabled={zoom <= 1}
                onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
              >
                <Minus className="size-4" />
              </button>
            </div>
            <div className="max-h-[75dvh] overflow-auto bg-sunken">
              <div
                ref={wrapRef}
                onClick={onCanvasClick}
                className={clsx('relative', placing && 'cursor-crosshair')}
                style={{ width: `${zoom * 100}%`, aspectRatio: `${plan.width} / ${plan.height}` }}
              >
                <img src={fileUrl(plan.fileKey)} alt={plan.name} className="absolute inset-0 size-full select-none" draggable={false} />
                {onPlan.map((a) => {
                  const tone = markerTone(a);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      title={`${a.code} · ${a.location}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!placing) setSelected(a);
                      }}
                      className={clsx('group absolute -translate-x-1/2 -translate-y-1/2 p-1.5', placing && 'pointer-events-none opacity-50')}
                      style={{ left: `${a.markerX! * 100}%`, top: `${a.markerY! * 100}%` }}
                    >
                      <span className={clsx('grid size-6 place-items-center rounded-full border-2 border-white shadow-pop', toneDot[tone])}>
                        <span className="size-1.5 rounded-full bg-white" />
                      </span>
                      <span className="pointer-events-none absolute top-full left-1/2 -mt-0.5 -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-80">
                        {a.code}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line px-(--row-px) py-3 text-meta text-ink-2" aria-label="Legende">
            {LEGEND.map(([t, l]) => (
              <li key={t} className="flex items-center gap-1.5">
                <StatusDot tone={t} /> {l}
              </li>
            ))}
          </ul>
        </Surface>

        {canEdit && (
          <aside className="min-w-0" aria-label="Nicht platziert">
            <AsideSection title={`Nicht platziert${unplaced.length ? ` ${unplaced.length}` : ''}`}>
              {unplaced.length === 0 ? (
                <p className="border-t border-line py-3 text-body text-ink-2">Alles platziert. Alle Elemente dieses Gebäudes sind auf einem Plan.</p>
              ) : (
                <>
                  <p className="mb-2 text-meta text-ink-3">Element wählen, dann auf den Plan tippen.</p>
                  <ul className="pk-list scroll-thin max-h-[60dvh] overflow-y-auto border-y border-line [--row-px:0px]">
                    {unplaced.map((a) => (
                      <ListRow
                        key={a.id}
                        onClick={() => setPlacing(placing?.id === a.id ? null : a)}
                        selected={placing?.id === a.id}
                        leading={<CategoryIcon category={a.category} size="sm" />}
                        title={<span className="font-medium">{a.code}</span>}
                        subtitle={[a.location, a.floor].filter(Boolean).join(' · ') || 'Ohne Standort'}
                        trailing={<Crosshair className={clsx('size-4', placing?.id === a.id ? 'text-ink' : 'text-ink-4')} />}
                      />
                    ))}
                  </ul>
                </>
              )}
            </AsideSection>
          </aside>
        )}
      </div>
    </>
  );
}

/** Kleine Planansicht mit einem hervorgehobenen Element (Elementseite). */
export function MiniPlan({ plan, x, y }: { plan: { id: string; name: string; width: number; height: number; fileKey: string }; x: number; y: number }) {
  return (
    <Link to={`/grundrisse/${plan.id}`} className="group block">
      <div className="relative overflow-hidden rounded-md bg-sunken" style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
        <img src={fileUrl(plan.fileKey)} alt={plan.name} className="absolute inset-0 size-full mix-blend-multiply" />
        <span className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-ink shadow-pop" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
      </div>
      <p className="mt-1.5 text-meta text-ink-2 group-hover:text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{plan.name}</p>
    </Link>
  );
}
