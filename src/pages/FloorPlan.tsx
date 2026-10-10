import clsx from 'clsx';
import { ArrowLeft, Crosshair, Map, Minus, MoveDiagonal, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Asset, downscale, fileUrl, uploadBlob, useAction, useFloorPlan, useMe } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { Button, Card, ErrorBox, Field, Input, Modal, Spinner, toneDot, useToast } from '../components/ui';
import { assetDue, DUE_META, type Tone } from '../format';

/** PDF (erste Seite) oder Bild in ein PNG/JPEG für den Grundriss umwandeln. */
async function toPlanImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
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
      if (!file) throw new Error('Bitte Datei wählen');
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
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
        <Field label="Gebäude">
          {(id) => (
            <select id={id} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Bezeichnung">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Erdgeschoss" />}</Field>
          <Field label="Ebene">{(id) => <Input id={id} type="number" value={level} onChange={(e) => setLevel(Number(e.target.value))} />}</Field>
        </div>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center hover:bg-sunken">
          <Upload className="size-6 text-ink-3" />
          <span className="text-sm font-medium">{file ? file.name : 'Bild oder PDF auswählen'}</span>
          <span className="text-xs text-ink-3">PNG, JPG, WebP oder PDF (erste Seite)</span>
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
      </form>
    </Modal>
  );
}

const markerTone = (a: Asset): Tone => (a.openDefects > 0 ? 'brand' : a.lastResult === 'not_inspectable' ? 'muted' : DUE_META[assetDue(a.nextDueAt)].tone);

export function FloorPlanPage() {
  const { id = '' } = useParams();
  const { data: plan, isLoading, error } = useFloorPlan(id);
  const { data: me } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [zoom, setZoom] = useState(1);
  const [placing, setPlacing] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Asset | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canEdit = me?.user.role !== 'viewer';
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);

  const place = useAction(
    (v: { assetId: string; x: number | null; y: number | null }) =>
      api(`/assets/${v.assetId}/marker`, { method: 'PUT', body: { floorPlanId: v.x == null ? null : id, x: v.x, y: v.y } }),
    (_, v) => toast(v.x == null ? 'Vom Plan entfernt' : 'Position gespeichert'),
  );
  const del = useAction(
    () => api(`/floor-plans/${id}`, { method: 'DELETE' }),
    () => {
      toast('Grundriss gelöscht');
      navigate(`/objekte/${plan?.propertyId}`);
    },
  );

  if (isLoading) return <Spinner />;
  if (error || !plan) return <ErrorBox error={error} />;
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link to={`/objekte/${plan.propertyId}`} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> {plan.propertyName} · {plan.buildingName}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Map className="size-6 text-ink-3" /> {plan.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.siblings.length > 1 &&
            plan.siblings.map((s) => (
              <Link
                key={s.id}
                to={`/grundrisse/${s.id}`}
                className={clsx('rounded-full border px-3 py-1.5 text-[13px] font-medium', s.id === plan.id ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2')}
              >
                {s.name}
              </Link>
            ))}
          {isAdmin && (
            <Button variant="secondary" aria-label="Grundriss löschen" onClick={() => confirm(`Grundriss „${plan.name}“ löschen? Marker werden entfernt.`) && del.mutate(undefined)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {selected && (
        <AssetDrawer asset={selected} onClose={() => setSelected(null)}>
          {canEdit && (
            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<MoveDiagonal className="size-3.5" />}
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
                icon={<X className="size-3.5" />}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
        <Card className="relative overflow-hidden">
          {placing && (
            <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm text-white shadow-pop">
              <Crosshair className="size-4 text-brand" />
              <span className="flex-1">
                Tippe auf die Position von <b>{placing.code}</b>
              </span>
              <button onClick={() => setPlacing(null)} className="rounded p-1 hover:bg-white/10" aria-label="Abbrechen">
                <X className="size-4" />
              </button>
            </div>
          )}
          <div className="absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <button className="p-2 hover:bg-sunken" aria-label="Vergrößern" onClick={() => setZoom((z) => Math.min(4, z * 1.4))}>
              <Plus className="size-4" />
            </button>
            <button className="border-t border-line p-2 hover:bg-sunken" aria-label="Verkleinern" onClick={() => setZoom((z) => Math.max(1, z / 1.4))}>
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
                    title={`${a.code} · ${a.location}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!placing) setSelected(a);
                    }}
                    className={clsx('group absolute -translate-x-1/2 -translate-y-1/2', placing && 'pointer-events-none opacity-60')}
                    style={{ left: `${a.markerX! * 100}%`, top: `${a.markerY! * 100}%` }}
                  >
                    <span className={clsx('grid size-7 place-items-center rounded-full border-2 border-white shadow-pop ring-1 ring-ink/10', toneDot[tone])}>
                      <span className="size-2 rounded-full bg-white" />
                    </span>
                    <span className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white opacity-0 transition group-hover:opacity-100 sm:opacity-80">
                      {a.code}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-2 text-[13px] font-semibold text-ink-2">Legende</p>
            <ul className="space-y-1.5 text-xs text-ink-2">
              {(
                [
                  ['bad', 'Überfällig'],
                  ['warn', 'Bald fällig'],
                  ['brand', 'Offene Mängel'],
                  ['info', 'Nie geprüft'],
                  ['ok', 'Aktuell'],
                ] as [Tone, string][]
              ).map(([t, l]) => (
                <li key={t} className="flex items-center gap-2">
                  <span className={clsx('size-3 rounded-full', toneDot[t])} /> {l}
                </li>
              ))}
            </ul>
          </Card>
          {canEdit && (
            <Card>
              <p className="border-b border-line px-4 py-3 text-[13px] font-semibold text-ink-2">Nicht platziert ({unplaced.length})</p>
              {unplaced.length === 0 ? (
                <p className="px-4 py-3 text-xs text-ink-3">Alle Elemente dieses Gebäudes sind auf einem Plan.</p>
              ) : (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                  {unplaced.map((a) => (
                    <li key={a.id}>
                      <button
                        onClick={() => setPlacing(a)}
                        className={clsx('flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-sunken', placing?.id === a.id && 'bg-brand-soft')}
                      >
                        <CategoryIcon category={a.category} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{a.code}</span>
                          <span className="block truncate text-xs text-ink-3">{a.location || '–'}</span>
                        </span>
                        <Crosshair className="size-4 text-ink-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

/** Kleine Planansicht mit einem hervorgehobenen Element (Elementseite). */
export function MiniPlan({ plan, x, y }: { plan: { id: string; name: string; width: number; height: number; fileKey: string }; x: number; y: number }) {
  return (
    <Link to={`/grundrisse/${plan.id}`} className="block overflow-hidden rounded-lg border border-line">
      <div className="relative" style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
        <img src={fileUrl(plan.fileKey)} alt={plan.name} className="absolute inset-0 size-full" />
        <span
          className="absolute size-4 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-brand shadow-pop"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      </div>
      <p className="bg-sunken px-3 py-1.5 text-xs text-ink-2">{plan.name}</p>
    </Link>
  );
}
