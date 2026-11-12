// „Erfassen“: einmal sprechen (oder tippen), daraus werden Mängel, Aufgaben und Notizen.
// Ablauf: sprechen → Live-Vorschau → „Auswerten“ → Karten prüfen → „übernehmen“ → Bestätigung.
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Check, MapPin, PackagePlus, ScanLine, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { type CaptureCategory, type CaptureItem, MAX_BULK_ASSETS, parseCapture } from '../../shared/smart';
import { allCategories } from '../categories';
import { api, ApiError, type Asset, useAssets, useMe, useProperties } from '../api';
import { useDictation } from '../dictate';
import { categoryLabel } from '../format';
import { BigMic } from './Dictate';
import { BuildingPicker } from './forms';
import { RadioChips } from './inspect/Choice';
import { readLastPlace, rememberPlace } from './objects/memory';
import { Button, Field, Input, Modal, Notice, Select, SEVERITY_TONE, StatusText, Textarea, useToast } from './ui';

const OPEN_EVENT = 'pk:capture';
/** Erfassen von überall öffnen, optional mit vorgewähltem Element oder Objekt. */
export const openCapture = (ctx: { assetId?: string; propertyId?: string } = {}) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: ctx }));

export function useCaptureListener() {
  const [ctx, setCtx] = useState<{ assetId?: string; propertyId?: string } | null>(null);
  useEffect(() => {
    const h = (e: Event) => setCtx((e as CustomEvent).detail ?? {});
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);
  return [ctx, () => setCtx(null)] as const;
}

/** Art eines Eintrags – v3: nur als graues Wort, keine farbige Kachel. */
const KIND_META = {
  defect: { label: 'Mangel' },
  task: { label: 'Aufgabe' },
  note: { label: 'Notiz' },
  asset: { label: 'Elemente' },
} as const;
/** Arten, zwischen denen ein Eintrag umgeschaltet werden kann (Sammelanlagen haben eine eigene Karte). */
const SWITCH_KINDS = ['defect', 'task', 'note'] as const;

/** Eintrag in der Prüfansicht; Sammelanlagen bekommen zusätzlich das Gebäude. */
type Item = CaptureItem & { buildingId?: string; propertyId?: string };

/** Arten des Workspaces für die Erkennung „fünf Feuerlöscher …“. */
const captureCategories = (): CaptureCategory[] => allCategories().map((c) => ({ key: c.key, label: c.label, plural: c.plural }));
const assetCount = (i: CaptureItem) => Math.min(Math.max(Math.round(i.count ?? 1), 1), MAX_BULK_ASSETS);
const sevDot = (s: Severity) => (s === 'low' ? 'bg-ink-4' : s === 'medium' ? 'bg-warn' : 'bg-shu');

type Where = { kind: 'asset'; asset: Asset } | { kind: 'property'; id: string; name: string } | null;

function WherePicker({ where, onChange }: { where: Where; onChange: (w: Where) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const assets = useAssets();
  const props = useProperties();
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return { a: [], p: [] };
    return {
      a: (assets.data ?? []).filter((x) => `${x.code} ${x.location} ${x.floor} ${x.buildingName}`.toLowerCase().includes(s)).slice(0, 5),
      p: (props.data ?? []).filter((x) => x.name.toLowerCase().includes(s)).slice(0, 3),
    };
  }, [q, assets.data, props.data]);
  if (where)
    return (
      <div className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 text-body">
        <MapPin className="size-4 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">
          {where.kind === 'asset' ? (
            <>
              <span className="text-ink">{where.asset.code}</span>
              <span className="text-ink-3">
                {' '}
                · {categoryLabel(where.asset.category)} · {where.asset.location || where.asset.buildingName}
              </span>
            </>
          ) : (
            <>
              <span className="text-ink-3">Objekt </span>
              <span className="text-ink">{where.name}</span>
            </>
          )}
        </span>
        <button type="button" className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Ort ändern" onClick={() => onChange(null)}>
          <X className="size-4" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <Input
        className="pl-9"
        aria-label="Ort"
        placeholder="Wo? Element-Code, Standort oder Objekt"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (hits.a.length > 0 || hits.p.length > 0) && (
        <ul className="animate-menu absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg bg-surface py-1 shadow-pop">
          {hits.a.map((a) => (
            <li key={a.id}>
              <button type="button" className="flex w-full flex-col px-3 py-2 text-left hover:bg-hover" onClick={() => onChange({ kind: 'asset', asset: a })}>
                <span className="text-body text-ink">
                  {a.code} <span className="text-ink-3">· {categoryLabel(a.category)}</span>
                </span>
                <span className="truncate text-meta text-ink-3">
                  {a.propertyName} · {a.buildingName} · {[a.floor, a.location].filter(Boolean).join(', ')}
                </span>
              </button>
            </li>
          ))}
          {hits.p.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2.5 text-left text-body hover:bg-hover" onClick={() => onChange({ kind: 'property', id: p.id, name: p.name })}>
                <span className="text-ink-3">Objekt </span>
                <span className="text-ink">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Eine erkannte Zeile zum Prüfen: Art umschalten, Titel, bei Mängeln Schwere und Maßnahme. Ohne Karte – Haarlinie dazwischen. */
function ItemCard({ item, onChange, onRemove }: { item: CaptureItem; onChange: (i: CaptureItem) => void; onRemove: () => void }) {
  const M = KIND_META[item.kind];
  return (
    <div className="animate-pop flex flex-col gap-3 py-4">
      <div className="flex items-center gap-2">
        <div className="flex rounded-md bg-sunken p-0.5" role="group" aria-label="Art">
          {SWITCH_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={item.kind === k}
              onClick={() => onChange({ ...item, kind: k })}
              className={clsx('h-9 rounded-[5px] px-3 text-meta font-medium transition-colors sm:h-8', item.kind === k ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRemove} className="-mr-2 ml-auto grid size-10 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink" aria-label="Eintrag entfernen">
          <Trash2 className="size-4" />
        </button>
      </div>
      <Input aria-label={`${M.label}: Titel`} value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} />
      {item.kind === 'defect' && (
        <>
          <RadioChips
            label="Schweregrad"
            value={item.severity}
            onChange={(severity) => onChange({ ...item, severity })}
            fill
            options={(Object.keys(SEVERITIES) as Severity[]).map((s) => ({ value: s, label: SEVERITIES[s], leading: <span className={clsx('size-2 rounded-full', sevDot(s))} /> }))}
          />
          <Input aria-label="Maßnahme" placeholder="Maßnahme (optional)" value={item.measure} onChange={(e) => onChange({ ...item, measure: e.target.value })} />
        </>
      )}
      {(item.assetCode || item.dueInDays != null) && (
        <p className="flex flex-wrap gap-x-3 text-meta text-ink-3">
          {item.assetCode && <span>Element {item.assetCode}</span>}
          {item.dueInDays != null && <span>Frist in {item.dueInDays} Tagen</span>}
        </p>
      )}
    </div>
  );
}

/** Sammelanlage prüfen: Anzahl, Art, Gebäude, Etage und Standort. */
function AssetItemCard({ item, onChange, onRemove, canCreate }: { item: Item; onChange: (i: Item) => void; onRemove: () => void; canCreate: boolean }) {
  const cats = allCategories();
  const n = assetCount(item);
  return (
    <div className="animate-pop flex flex-col gap-3 py-4" data-asset-item>
      <div className="flex items-center gap-2">
        <PackagePlus className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <p className="min-w-0 flex-1 truncate text-body text-ink">
          {n} {n === 1 ? 'Element' : 'Elemente'} anlegen
        </p>
        <button type="button" onClick={onRemove} className="-mr-2 grid size-10 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink" aria-label="Eintrag entfernen">
          <Trash2 className="size-4" />
        </button>
      </div>
      {!canCreate && <Notice tone="warn">Du darfst keine neuen Elemente anlegen – dieser Eintrag wird übersprungen.</Notice>}
      <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
        <Field label="Anzahl">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_BULK_ASSETS}
              value={item.count ?? 1}
              onChange={(e) => onChange({ ...item, count: e.target.value === '' ? 1 : Math.min(Math.max(Math.round(Number(e.target.value)), 1), MAX_BULK_ASSETS) })}
            />
          )}
        </Field>
        <Field label="Art">
          {(id) => (
            <Select id={id} value={item.category ?? ''} onChange={(e) => onChange({ ...item, category: e.target.value || null })}>
              <option value="">Bitte wählen …</option>
              {cats.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BuildingPicker value={item.buildingId ?? ''} initialPropertyId={item.propertyId} onChange={(buildingId) => onChange({ ...item, buildingId })} />
        <Field label="Etage" optional>
          {(id) => <Input id={id} value={item.floor ?? ''} onChange={(e) => onChange({ ...item, floor: e.target.value })} placeholder="EG, 1. OG …" />}
        </Field>
        <Field label="Standort" optional>
          {(id) => <Input id={id} value={item.location ?? ''} onChange={(e) => onChange({ ...item, location: e.target.value })} placeholder="z. B. Flur" />}
        </Field>
      </div>
    </div>
  );
}

/** Schon beim Sprechen/Tippen zeigen, was erkannt wird (Regeln laufen lokal). */
function LivePreview({ text }: { text: string }) {
  const items = useMemo(() => (text.trim().length > 6 ? parseCapture(text, { categories: captureCategories() }) : []), [text]);
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-meta font-medium text-ink-3">Wird erkannt</p>
      <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="Erkannt">
        {items.slice(0, 6).map((i, n) => (
          <li key={n} className="animate-pop flex min-h-11 items-center gap-3 py-1.5 text-body">
            <span className="w-16 shrink-0 text-meta text-ink-3">{KIND_META[i.kind].label}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{i.kind === 'asset' ? `${assetCount(i)} × ${categoryLabel(i.category ?? '') || i.title}` : i.title}</span>
            {i.kind === 'defect' && <StatusText tone={i.severity === 'low' ? 'muted' : SEVERITY_TONE[i.severity]}>{SEVERITIES[i.severity]}</StatusText>}
            {i.dueInDays != null && <span className="shrink-0 text-meta text-ink-3 tabular-nums">in {i.dueInDays} T.</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const QUICK = [
  { to: '/scan', label: 'Code scannen', icon: ScanLine },
  { to: '/elemente?neu=1', label: 'Neues Element', icon: PackagePlus },
];

export function CaptureSheet({ initial, onClose }: { initial: { assetId?: string; propertyId?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const assets = useAssets();
  const props = useProperties();
  const [text, setText] = useState('');
  const [where, setWhere] = useState<Where>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const { data: me } = useMe();
  const canCreate = me?.user.role !== 'viewer' && me?.user.canCreate !== false;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ defects: number; tasks: number; assets: number; auto: number; dupes: { title: string; message: string; body: unknown }[] } | null>(null);
  const d = useDictation((t, final) => setText((prev) => (final ? (prev.trim() && !t.startsWith(prev.trim()) ? `${prev.trim()} ${t}` : t) : t)));

  // Kontext aus der aktuellen Seite übernehmen
  useEffect(() => {
    if (where) return;
    if (initial.assetId) {
      const a = assets.data?.find((x) => x.id === initial.assetId);
      if (a) setWhere({ kind: 'asset', asset: a });
    } else if (initial.propertyId) {
      const p = props.data?.find((x) => x.id === initial.propertyId);
      if (p) setWhere({ kind: 'property', id: p.id, name: p.name });
    }
  }, [initial, assets.data, props.data, where]);

  async function analyse() {
    setBusy(true);
    try {
      const r = await api<{ items: CaptureItem[] }>('/ai/parse', { body: { text, checkpoints: [], categories: captureCategories() } });
      // Sammelanlagen starten im Gebäude des gewählten Elements bzw. im zuletzt benutzten
      const last = readLastPlace();
      const place = where?.kind === 'asset' ? { buildingId: where.asset.buildingId, propertyId: where.asset.propertyId } : where?.kind === 'property' ? { propertyId: where.id } : { buildingId: last.buildingId, propertyId: last.propertyId };
      const list: Item[] = r.items.map((i) => (i.kind === 'asset' ? { ...i, ...place } : i));
      setItems(list.length ? list : [{ kind: 'note', title: text.slice(0, 200), note: '', severity: 'medium', measure: '', assetCode: null, checkpointId: null, dueInDays: null }]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Auswerten fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  }

  const byCode = (code: string | null) => (code ? assets.data?.find((a) => a.code.toLowerCase() === code.toLowerCase()) : undefined);
  const needsPlace = items?.some((i) => i.kind === 'defect' && !byCode(i.assetCode)) && !where;
  const assetItems = (items ?? []).filter((i) => i.kind === 'asset' && canCreate);
  const needsBuilding = assetItems.some((i) => !i.buildingId || !i.category);

  async function save() {
    if (!items) return;
    setBusy(true);
    let defects = 0;
    let tasks = 0;
    let assetsMade = 0;
    let auto = 0;
    const dupes: { title: string; message: string; body: unknown }[] = [];
    try {
      for (const i of items) {
        if (i.kind === 'asset') {
          // Sammelanlage: n Elemente nacheinander anlegen (Codes vergibt der Server)
          if (!canCreate || !i.buildingId || !i.category) continue;
          for (let n = 0; n < assetCount(i); n++) {
            await api('/assets', { body: { buildingId: i.buildingId, category: i.category, floor: i.floor ?? '', location: i.location ?? '' } });
            assetsMade++;
          }
          rememberPlace({ propertyId: i.propertyId, buildingId: i.buildingId, floor: i.floor ?? '' });
          continue;
        }
        if (!i.title.trim()) continue;
        const a = byCode(i.assetCode) ?? (where?.kind === 'asset' ? where.asset : undefined);
        const propertyId = a?.propertyId ?? (where?.kind === 'property' ? where.id : null);
        if (i.kind === 'defect') {
          const body = { assetId: a?.id ?? null, propertyId, title: i.title, note: i.note, measure: i.measure, severity: i.severity };
          try {
            const r = await api<{ taskCreated: boolean }>('/defects', { body });
            defects++;
            if (r.taskCreated) auto++;
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 409)) throw e;
            dupes.push({ title: i.title, message: e.message, body });
          }
        } else {
          await api('/tasks', {
            body: {
              title: i.kind === 'note' ? `Notiz: ${i.title}` : i.title,
              description: i.note,
              priority: i.kind === 'note' ? 'low' : 'medium',
              dueAt: i.dueInDays != null ? Math.round(Date.now() + i.dueInDays * 86_400_000) : undefined,
              assetId: a?.id ?? null,
              propertyId,
            },
          });
          tasks++;
        }
      }
      for (const k of ['defects', 'tasks', 'dashboard', 'smart', 'asset', 'assets']) qc.invalidateQueries({ queryKey: [k] });
      setDone({ defects, tasks, assets: assetsMade, auto, dupes });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Speichern fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  }

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  if (done) {
    const n = done.defects + done.tasks + done.assets;
    return (
      <Modal
        title="Gespeichert"
        onClose={onClose}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setItems(null);
                setText('');
              }}
            >
              Weiter erfassen
            </Button>
            <Button onClick={() => go(done.defects ? '/maengel' : done.tasks ? '/aufgaben' : '/elemente')}>Ansehen</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 py-2 max-sm:items-center max-sm:text-center">
            <p className="flex items-center gap-2 text-title text-ink">
              <Check className="size-4 shrink-0" strokeWidth={2.25} />
              {n === 0
                ? 'Nichts Neues angelegt'
                : `${[
                    done.defects && `${done.defects} ${done.defects === 1 ? 'Mangel' : 'Mängel'}`,
                    done.tasks && `${done.tasks} ${done.tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`,
                    done.assets && `${done.assets} ${done.assets === 1 ? 'Element' : 'Elemente'}`,
                  ]
                    .filter(Boolean)
                    .join(' und ')} angelegt`}
            </p>
            {done.auto > 0 && <p className="text-meta text-ink-3">Für {done.auto} schwere Mängel gibt es automatisch eine Aufgabe mit Frist.</p>}
          </div>
          {done.dupes.length > 0 && (
            <Notice
              tone="warn"
              icon={<AlertTriangle />}
              title={done.dupes.length === 1 ? 'Gibt es schon' : `${done.dupes.length} gibt es schon`}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    for (const x of done.dupes) await api('/defects', { body: { ...(x.body as object), force: true } });
                    qc.invalidateQueries({ queryKey: ['defects'] });
                    setDone({ ...done, defects: done.defects + done.dupes.length, dupes: [] });
                  }}
                >
                  Trotzdem anlegen
                </Button>
              }
            >
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {done.dupes.map((x) => (
                  <li key={x.title}>{x.message}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      </Modal>
    );
  }

  if (items)
    return (
      <Modal
        title={
          <span className="flex items-center gap-1.5">
            <button type="button" onClick={() => setItems(null)} className="-ml-1.5 grid size-8 place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink" aria-label="Zurück">
              <ArrowLeft className="size-5" />
            </button>
            {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'} erkannt
          </span>
        }
        description="Automatisch vorsortiert – Art, Schwere und Text bei Bedarf anpassen."
        onClose={onClose}
        footer={
          <Button size="lg" className="w-full" loading={busy} disabled={!items.length || needsPlace || needsBuilding} onClick={save}>
            {needsPlace ? 'Erst Ort wählen' : needsBuilding ? 'Erst Art und Gebäude wählen' : items.length > 1 ? `Alle ${items.length} übernehmen` : 'Übernehmen'}
          </Button>
        }
      >
        <div className="flex flex-col">
          <div className="pb-2">
            <WherePicker where={where} onChange={setWhere} />
          </div>
          <div className="flex flex-col divide-y divide-line border-b border-line">
          {items.map((it, n) =>
            it.kind === 'asset' ? (
              <AssetItemCard
                key={n}
                item={it}
                canCreate={canCreate}
                onChange={(v) => setItems(items.map((x, j) => (j === n ? v : x)))}
                onRemove={() => setItems(items.filter((_, j) => j !== n))}
              />
            ) : (
              <ItemCard key={n} item={it} onChange={(v) => setItems(items.map((x, j) => (j === n ? v : x)))} onRemove={() => setItems(items.filter((_, j) => j !== n))} />
            ),
          )}
          </div>
          {!items.length && <p className="py-6 text-center text-body text-ink-3">Alle Einträge entfernt. Geh zurück, um neu zu sprechen.</p>}
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Erfassen"
      onClose={onClose}
      footer={
        // „Auswerten“ erscheint erst, wenn Text da ist
        text.trim() ? (
          <Button size="lg" className="animate-pop w-full" loading={busy} disabled={d.state !== 'idle'} onClick={analyse}>
            Auswerten
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <BigMic dictation={d} label="Sag einfach, was dir auffällt" hint="Element-Code, Schwere oder Frist („bis Freitag“) gleich mitsagen." />
        <Textarea
          dictate={false}
          aria-label="Erfasster Text"
          placeholder="Oder tippen, z. B. „Tür im 2. OG schließt nicht, Dichtung fehlt. Hausmeister bis Freitag informieren.“"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-24"
        />
        <LivePreview text={text} />
        <WherePicker where={where} onChange={setWhere} />
        <div className="-mx-2 flex flex-wrap gap-x-1">
          {QUICK.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              onClick={onClose}
              className="flex h-10 items-center gap-2 rounded-md px-2 text-meta text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <q.icon className="size-4 text-ink-3" /> {q.label}
            </Link>
          ))}
        </div>
      </div>
    </Modal>
  );
}
