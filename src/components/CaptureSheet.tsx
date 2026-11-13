// „Erfassen“: einmal sprechen (oder tippen), daraus werden Elemente, Mängel, Aufgaben und Notizen.
// Ablauf: sprechen → Live-Vorschau → „n Elemente anlegen“ (reine Elemente) bzw. „Auswerten“ → Karten prüfen → anlegen.
// Absichtserkennung: shared/smart.ts (Regeln, keine KI). Nie eine Sackgasse: fehlt der Ort, bietet das Sheet die Objekte
// an oder legt ein neues Objekt (mit Gebäude „Hauptgebäude“) an. Ohne Netz landet alles in der Warteschlange (src/offline.ts).
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CloudOff, MapPin, PackagePlus, Plus, ScanLine, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { type CaptureCategory, type CaptureItem, MAX_BULK_ASSETS, parseCapture } from '../../shared/smart';
import { allCategories, getCategory } from '../categories';
import { api, ApiError, type Asset, useAssets, useBuildings, useMe, useProperties } from '../api';
import { useDictation } from '../dictate';
import { type CaptureOp, enqueueCaptures, isNetworkError, useLocalAssets, useOnline } from '../offline';
import { categoryLabel } from '../format';
import { BigMic } from './Dictate';
import { BuildingPicker } from './forms';
import { RadioChips } from './inspect/Choice';
import { readLastPlace, rememberPlace } from './objects/memory';
import { Button, Field, Input, Modal, Notice, Segmented, Select, SEVERITY_TONE, StatusText, Textarea, useToast } from './ui';

const OPEN_EVENT = 'pk:capture';
/** Vorgabe des Sheets: Elemente anlegen oder Mängel/Aufgaben festhalten. */
export type CaptureMode = 'assets' | 'findings';
export interface CaptureContext {
  assetId?: string;
  propertyId?: string;
  /** ohne Angabe: „Elemente“, wenn der Ort noch keine Elemente hat */
  mode?: CaptureMode;
}
/** Erfassen von überall öffnen, optional mit vorgewähltem Element oder Objekt und Modus. */
export const openCapture = (ctx: CaptureContext = {}) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: ctx }));

export function useCaptureListener() {
  const [ctx, setCtx] = useState<CaptureContext | null>(null);
  useEffect(() => {
    const h = (e: Event) => setCtx((e as CustomEvent).detail ?? {});
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);
  return [ctx, () => setCtx(null)] as const;
}

/** Art eines Eintrags – v3: nur als graues Wort, keine farbige Kachel. */
const KIND_META = {
  defect: { label: 'Mangel', one: 'Mangel', many: 'Mängel' },
  task: { label: 'Aufgabe', one: 'Aufgabe', many: 'Aufgaben' },
  note: { label: 'Notiz', one: 'Notiz', many: 'Notizen' },
  asset: { label: 'Elemente', one: 'Element', many: 'Elemente' },
} as const;
/** Arten, zwischen denen ein Eintrag umgeschaltet werden kann (Elemente haben eine eigene Karte). */
const SWITCH_KINDS = ['defect', 'task', 'note'] as const;

/** Eintrag in der Prüfansicht; Elemente bekommen zusätzlich das Gebäude. */
type Item = CaptureItem & { buildingId?: string; propertyId?: string };

/** Arten des Workspaces für die Erkennung (Bezeichnung, Mehrzahl und – falls der Katalog sie hat – Synonyme). */
const captureCategories = (): CaptureCategory[] =>
  allCategories().map((c) => ({ key: c.key, label: c.label, plural: c.plural, synonyms: (c as { synonyms?: string[] }).synonyms }));
const assetCount = (i: CaptureItem) => Math.min(Math.max(Math.round(i.count ?? 1), 1), MAX_BULK_ASSETS);
const sevDot = (s: Severity) => (s === 'low' ? 'bg-ink-4' : s === 'medium' ? 'bg-warn' : 'bg-shu');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „3 Elemente und 1 Mangel“ – was der Knopf anlegt. */
function summary(items: CaptureItem[]): string {
  const n = { asset: 0, defect: 0, task: 0, note: 0 };
  for (const i of items) n[i.kind] += i.kind === 'asset' ? assetCount(i) : 1;
  const parts = (['asset', 'defect', 'task', 'note'] as const).filter((k) => n[k] > 0).map((k) => plural(n[k], KIND_META[k].one, KIND_META[k].many));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : (parts[0] ?? '');
}

/** Stammdaten aus dem Satz, soweit die Art sie kennt (Feuerwiderstand nur mit passender Auswahl). */
function assetAttributes(category: string, attrs: CaptureItem['attributes']): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const fields = getCategory(category).attributes ?? [];
  for (const [k, v] of Object.entries(attrs ?? {})) {
    const f = fields.find((x) => x.key === k);
    if (!f) continue;
    if (f.type === 'select' && !(f.options ?? []).includes(String(v))) continue;
    if (f.type === 'boolean' && typeof v !== 'boolean') continue;
    out[k] = v;
  }
  return out;
}

/** Elemente für Ortswahl und Code-Erkennung: vom Server, ohne Netz aus den geladenen Gebäuden. */
function useCaptureAssets(): Asset[] | undefined {
  const q = useAssets();
  const local = useLocalAssets(!q.data);
  return q.data ?? local;
}

/** Gebäude je Objekt: vom Server, ohne Netz aus den Elementen der offline geladenen Gebäude. */
function useBuildingsOf(assets: Asset[] | undefined) {
  const q = useBuildings();
  return (propertyId: string) => {
    if (q.data) return q.data.filter((b) => b.propertyId === propertyId).map((b) => b.id);
    return [...new Set((assets ?? []).filter((a) => a.propertyId === propertyId).map((a) => a.buildingId))];
  };
}

type Where = { kind: 'asset'; asset: Asset } | { kind: 'property'; id: string; name: string } | null;

/** Ort wählen: Element-Code, Standort oder Objekt suchen – ohne Treffer ein neues Objekt anlegen. Ohne Ort stehen die Objekte gleich da. */
function WherePicker({ where, onChange, emphasize }: { where: Where; onChange: (w: Where) => void; emphasize?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const online = useOnline();
  const assets = { data: useCaptureAssets() };
  const props = useProperties();
  const { data: me } = useMe();
  const canStructure = !!me && ['owner', 'admin'].includes(me.user.role);
  const s = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!s) return { a: [], p: [] };
    return {
      a: (assets.data ?? []).filter((x) => `${x.code} ${x.location} ${x.floor} ${x.buildingName}`.toLowerCase().includes(s)).slice(0, 5),
      p: (props.data ?? []).filter((x) => x.name.toLowerCase().includes(s)).slice(0, 3),
    };
  }, [s, assets.data, props.data]);
  const exact = (props.data ?? []).some((p) => p.name.trim().toLowerCase() === s);
  const offerNew = canStructure && !!s && !exact;

  async function createProperty() {
    const name = q.trim();
    if (!name) return;
    setCreating(true);
    try {
      const r = await api<{ id: string }>('/properties', { body: { name, withBuilding: true } });
      for (const k of ['properties', 'buildings', 'dashboard', 'property']) await qc.invalidateQueries({ queryKey: [k] });
      onChange({ kind: 'property', id: r.id, name });
      setQ('');
      toast(`Objekt „${name}“ angelegt`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen', 'bad');
    } finally {
      setCreating(false);
    }
  }

  if (where)
    return (
      <div className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 text-body" data-where>
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

  const noProps = props.data?.length === 0;
  // Fehlt der Ort (oder beim Antippen), stehen die Objekte gleich da (höchstens vier) – kein Tippen nötig
  const shown = s ? hits.p : (props.data ?? []).slice(0, 4);
  const listOpen = open || !!emphasize;
  return (
    <div className="flex flex-col gap-1.5" data-where-picker>
      {emphasize && <p className="text-meta font-medium text-ink">{noProps ? 'Wie heißt das Objekt?' : 'Wo? Objekt wählen'}</p>}
      <div className="relative">
        <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input
          className="pl-9"
          aria-label="Ort"
          placeholder={noProps ? (canStructure ? 'Name des Objekts, z. B. Seehafer Elemente' : 'Noch kein Objekt') : 'Wo? Element-Code, Standort oder Objekt'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && offerNew && !hits.p.length && !hits.a.length) {
              e.preventDefault();
              void createProperty();
            }
          }}
        />
      </div>
      {listOpen && (shown.length > 0 || hits.a.length > 0 || offerNew) && (
        <ul className="animate-menu overflow-hidden rounded-md border border-line bg-surface" aria-label="Ort wählen">
          {hits.a.map((a) => (
            <li key={a.id} className="border-b border-line last:border-b-0">
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
          {shown.map((p) => (
            <li key={p.id} className="border-b border-line last:border-b-0">
              <button type="button" className="flex min-h-11 w-full items-center px-3 py-2 text-left text-body hover:bg-hover" onClick={() => onChange({ kind: 'property', id: p.id, name: p.name })}>
                <span className="text-ink-3">Objekt&nbsp;</span>
                <span className="truncate text-ink">{p.name}</span>
              </button>
            </li>
          ))}
          {offerNew && (
            <li>
              <button
                type="button"
                disabled={creating || !online}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-body text-ink hover:bg-hover disabled:text-ink-3"
                onClick={createProperty}
              >
                <Plus className="size-4 shrink-0 text-ink-3" />
                <span className="min-w-0 truncate">{online ? `Neues Objekt „${q.trim()}“ anlegen` : 'Neue Objekte nur mit Netz'}</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {noProps && !canStructure && <p className="text-meta text-ink-3">Objekte legt eine Admin-Person an. Du kannst trotzdem Mängel und Aufgaben notieren.</p>}
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

/** Stammdaten als kurze Zeile: „T30 · Rauchschutz“. */
function attributeText(category: string | null | undefined, attrs: CaptureItem['attributes']): string {
  if (!category) return '';
  const a = assetAttributes(category, attrs);
  return Object.entries(a)
    .map(([k, v]) => (v === true ? (getCategory(category).attributes.find((f) => f.key === k)?.label.replace(/\s*\(.*\)$/, '') ?? k) : String(v)))
    .join(' · ');
}

/** Elemente prüfen: Anzahl, Art, Gebäude (nur bei mehreren), Etage, Standort, Hersteller. */
function AssetItemCard({ item, onChange, onRemove, canCreate }: { item: Item; onChange: (i: Item) => void; onRemove: () => void; canCreate: boolean }) {
  const cats = allCategories();
  const n = assetCount(item);
  const attrs = attributeText(item.category, item.attributes);
  return (
    <div className="animate-pop flex flex-col gap-3 py-4" data-asset-item>
      <div className="flex items-center gap-2">
        <PackagePlus className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <p className="min-w-0 flex-1 truncate text-body text-ink">
          {plural(n, 'Element', 'Elemente')} anlegen{attrs && <span className="text-ink-3"> · {attrs}</span>}
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
        <Field label="Hersteller" optional>
          {(id) => <Input id={id} value={item.manufacturer ?? ''} onChange={(e) => onChange({ ...item, manufacturer: e.target.value })} />}
        </Field>
      </div>
    </div>
  );
}

/** Schon beim Sprechen/Tippen zeigen, was erkannt wird (Regeln laufen lokal) – die Vorschau vor dem Anlegen. */
function LivePreview({ items }: { items: CaptureItem[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 text-meta font-medium text-ink-3">Wird erkannt</p>
      <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="Erkannt">
        {items.slice(0, 8).map((i, n) => (
          <li key={n} className="animate-pop flex min-h-11 items-center gap-3 py-1.5 text-body" data-kind={i.kind}>
            <span className="w-16 shrink-0 text-meta text-ink-3">{i.kind === 'asset' ? plural(assetCount(i), 'Element', 'Elemente').replace(/^\d+ /, '') : KIND_META[i.kind].label}</span>
            {i.kind === 'asset' ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ink">
                  <span className="tabular-nums">{assetCount(i)}</span> × {categoryLabel(i.category ?? '') || i.title}
                </span>
                {(i.floor || i.location || i.manufacturer || attributeText(i.category, i.attributes)) && (
                  <span className="block truncate text-meta text-ink-3">{[i.floor, i.location, i.manufacturer, attributeText(i.category, i.attributes)].filter(Boolean).join(' · ')}</span>
                )}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
            )}
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
  { to: '/elemente?neu=1', label: 'Einzeln mit Formular', icon: PackagePlus },
];

export function CaptureSheet({ initial, onClose }: { initial: CaptureContext; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const assets = { data: useCaptureAssets() };
  const props = useProperties();
  const buildingsOf = useBuildingsOf(assets.data);
  const [text, setText] = useState('');
  const [where, setWhere] = useState<Where>(null);
  const [touchedWhere, setTouchedWhere] = useState(false);
  const [modeChoice, setMode] = useState<CaptureMode | null>(initial.mode ?? null);
  const [items, setItems] = useState<Item[] | null>(null);
  const { data: me } = useMe();
  const canCreate = me?.user.role !== 'viewer' && me?.user.canCreate !== false;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ defects: number; tasks: number; assets: number; auto: number; dupes: { title: string; message: string; body: unknown }[]; queued: number; propertyId?: string } | null>(null);
  const online = useOnline();
  const d = useDictation((t, final) => setText((prev) => (final ? (prev.trim() && !t.startsWith(prev.trim()) ? `${prev.trim()} ${t}` : t) : t)));

  // Kontext aus der aktuellen Seite übernehmen; gibt es genau ein Objekt, ist es der Ort
  useEffect(() => {
    if (where || touchedWhere) return;
    if (initial.assetId) {
      const a = assets.data?.find((x) => x.id === initial.assetId);
      if (a) setWhere({ kind: 'asset', asset: a });
    } else if (initial.propertyId) {
      const p = props.data?.find((x) => x.id === initial.propertyId);
      if (p) setWhere({ kind: 'property', id: p.id, name: p.name });
    } else if (props.data?.length === 1) {
      const p = props.data[0]!;
      setWhere({ kind: 'property', id: p.id, name: p.name });
    }
  }, [initial, assets.data, props.data, where, touchedWhere]);
  const changeWhere = (w: Where) => {
    setTouchedWhere(true);
    setWhere(w);
  };

  // Ohne Elemente am gewählten Ort (bzw. im ganzen Konto) ist „Elemente“ die Vorgabe
  const assetsHere =
    where?.kind === 'asset' ? 1 : where?.kind === 'property' ? (assets.data ?? []).filter((a) => a.propertyId === where.id).length : (assets.data?.length ?? (props.data?.length === 0 ? 0 : 1));
  const mode: CaptureMode = modeChoice ?? (assetsHere === 0 && canCreate ? 'assets' : 'findings');
  const categories = useMemo(() => captureCategories(), []);
  const live = useMemo(() => (text.trim().length > 4 ? parseCapture(text, { categories, prefer: mode }) : []), [text, categories, mode]);

  /** Ort für neue Elemente: Gebäude des gewählten Elements, das einzige Gebäude des Objekts oder das zuletzt benutzte. */
  const place = (): { buildingId?: string; propertyId?: string } => {
    if (where?.kind === 'asset') return { buildingId: where.asset.buildingId, propertyId: where.asset.propertyId };
    if (where?.kind === 'property') {
      const bs = buildingsOf(where.id);
      const last = readLastPlace();
      return { propertyId: where.id, buildingId: bs.length === 1 ? bs[0] : bs.find((b) => b === last.buildingId) };
    }
    return {};
  };
  const withPlace = (list: CaptureItem[]): Item[] => {
    const p = place();
    return list.map((i) => (i.kind === 'asset' ? { ...i, ...p } : i));
  };

  // Reine Elemente mit bekannter Art und eindeutigem Gebäude: direkt anlegen, die Vorschau steht darüber
  const direct = canCreate && live.length > 0 && live.every((i) => i.kind === 'asset' && i.category) && !!place().buildingId;

  async function analyse() {
    setBusy(true);
    try {
      // ohne Netz (oder bei Netzfehler) dieselben Regeln auf dem Gerät
      let r: { items: CaptureItem[] };
      try {
        if (!navigator.onLine) throw new TypeError('offline');
        r = await api<{ items: CaptureItem[] }>('/ai/parse', { body: { text, checkpoints: [], categories, prefer: mode } });
      } catch (e) {
        if (e instanceof ApiError) throw e;
        r = { items: parseCapture(text, { categories, prefer: mode }) };
      }
      const list = withPlace(r.items);
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

  async function save(list: Item[]) {
    setBusy(true);
    let defects = 0;
    let tasks = 0;
    let assetsMade = 0;
    let auto = 0;
    let propertyId: string | undefined;
    const dupes: { title: string; message: string; body: unknown }[] = [];
    // Erst alle Aufrufe vorbereiten – ohne Netz landen sie (ab dem ersten Netzfehler) in der Warteschlange
    const ops: CaptureOp[] = [];
    const op = (kind: CaptureOp['kind'], title: string, path: CaptureOp['path'], body: Record<string, unknown>) =>
      ops.push({ clientId: crypto.randomUUID(), kind, title, path, body, createdAt: Date.now() });
    for (const i of list) {
      if (i.kind === 'asset') {
        // n Elemente nacheinander anlegen (Codes vergibt der Server)
        if (!canCreate || !i.buildingId || !i.category) continue;
        const attributes = assetAttributes(i.category, i.attributes);
        for (let n = 0; n < assetCount(i); n++)
          op('asset', `${categoryLabel(i.category)}${i.location ? ` · ${i.location}` : ''}`, '/assets', {
            buildingId: i.buildingId,
            category: i.category,
            floor: i.floor ?? '',
            location: i.location ?? '',
            manufacturer: i.manufacturer ?? '',
            attributes,
          });
        rememberPlace({ propertyId: i.propertyId, buildingId: i.buildingId, floor: i.floor ?? '' });
        propertyId ??= i.propertyId;
        continue;
      }
      if (!i.title.trim()) continue;
      const a = byCode(i.assetCode) ?? (where?.kind === 'asset' ? where.asset : undefined);
      const pid = a?.propertyId ?? (where?.kind === 'property' ? where.id : null);
      if (i.kind === 'defect') op('defect', i.title, '/defects', { assetId: a?.id ?? null, propertyId: pid, title: i.title, note: i.note, measure: i.measure, severity: i.severity });
      else
        op('task', i.kind === 'note' ? `Notiz: ${i.title}` : i.title, '/tasks', {
          title: i.kind === 'note' ? `Notiz: ${i.title}` : i.title,
          description: i.note,
          priority: i.kind === 'note' ? 'low' : 'medium',
          dueAt: i.dueInDays != null ? Math.round(Date.now() + i.dueInDays * 86_400_000) : undefined,
          assetId: a?.id ?? null,
          propertyId: pid,
        });
    }
    let queued = 0;
    try {
      for (let n = 0; n < ops.length; n++) {
        const o = ops[n]!;
        if (!navigator.onLine) {
          queued = ops.length - n;
          await enqueueCaptures(ops.slice(n));
          break;
        }
        try {
          const r = await api<{ taskCreated?: boolean }>(o.path, { body: o.body });
          if (o.kind === 'defect') {
            defects++;
            if (r.taskCreated) auto++;
          } else if (o.kind === 'task') tasks++;
          else assetsMade++;
        } catch (e) {
          if (isNetworkError(e)) {
            queued = ops.length - n;
            await enqueueCaptures(ops.slice(n));
            break;
          }
          if (!(e instanceof ApiError && e.status === 409 && o.kind === 'defect')) throw e;
          dupes.push({ title: o.title, message: e.message, body: o.body });
        }
      }
      for (const k of ['defects', 'tasks', 'dashboard', 'smart', 'asset', 'assets', 'property', 'properties', 'now']) qc.invalidateQueries({ queryKey: [k] });
      setDone({ defects, tasks, assets: assetsMade, auto, dupes, queued, propertyId: propertyId ?? (where?.kind === 'property' ? where.id : undefined) });
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
    const target =
      n === 0 && done.queued
        ? '/offline'
        : done.assets && done.propertyId
          ? `/objekte/${done.propertyId}`
          : done.defects
            ? '/offen?art=maengel'
            : done.tasks
              ? '/offen?art=aufgaben'
              : '/elemente';
    return (
      <Modal
        title={n === 0 && done.queued ? 'Auf dem Gerät gespeichert' : 'Gespeichert'}
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
            <Button onClick={() => go(target)}>Ansehen</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 py-2 max-sm:items-center max-sm:text-center">
            <p className="flex items-center gap-2 text-title text-ink">
              <Check className="size-4 shrink-0" strokeWidth={2.25} />
              {n === 0
                ? done.queued
                  ? `${done.queued} ${done.queued === 1 ? 'Eintrag' : 'Einträge'} in der Warteschlange`
                  : 'Nichts Neues angelegt'
                : `${[
                    done.assets && plural(done.assets, 'Element', 'Elemente'),
                    done.defects && plural(done.defects, 'Mangel', 'Mängel'),
                    done.tasks && plural(done.tasks, 'Aufgabe', 'Aufgaben'),
                  ]
                    .filter(Boolean)
                    .join(' und ')} angelegt`}
            </p>
            {done.auto > 0 && <p className="text-meta text-ink-3">Für {done.auto} schwere Mängel gibt es automatisch eine Aufgabe mit Frist.</p>}
          </div>
          {done.queued > 0 && (
            <Notice tone="info" icon={<CloudOff />} title="Offline gespeichert – wird übertragen, sobald Netz da ist">
              {done.queued} {done.queued === 1 ? 'Eintrag wartet' : 'Einträge warten'} auf diesem Gerät. Ähnliche, schon vorhandene Mängel erscheinen danach unter „Offline-Modus“ zur Entscheidung.
            </Notice>
          )}
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

  if (items) {
    // Ort nachträglich gewählt: Elemente ohne Gebäude übernehmen ihn
    const relocate = (w: Where) => {
      changeWhere(w);
      if (!w) return;
      const p = w.kind === 'asset' ? { buildingId: w.asset.buildingId, propertyId: w.asset.propertyId } : { propertyId: w.id, buildingId: buildingsOf(w.id).length === 1 ? buildingsOf(w.id)[0] : undefined };
      setItems(items.map((i) => (i.kind === 'asset' && !i.buildingId ? { ...i, ...p } : i)));
    };
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
          <Button size="lg" className="w-full" loading={busy} disabled={!items.length || needsPlace || needsBuilding} onClick={() => save(items)}>
            {needsPlace ? 'Erst Ort wählen' : needsBuilding ? 'Erst Art und Gebäude wählen' : !online ? 'Auf dem Gerät speichern' : `${summary(items.filter((i) => i.kind !== 'asset' || canCreate))} anlegen`}
          </Button>
        }
      >
        <div className="flex flex-col">
          <div className="pb-2">
            <WherePicker where={where} onChange={relocate} emphasize={needsPlace} />
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
  }

  const assetsMode = mode === 'assets';
  return (
    <Modal
      title={assetsMode ? 'Elemente erfassen' : 'Erfassen'}
      onClose={onClose}
      footer={
        // erst mit Text: reine Elemente gleich anlegen (Vorschau steht darüber), sonst auswerten und prüfen
        text.trim() ? (
          direct ? (
            <div className="flex w-full gap-2">
              <Button variant="secondary" size="lg" className="max-sm:flex-1" disabled={busy || d.state !== 'idle'} onClick={analyse}>
                Anpassen
              </Button>
              <Button size="lg" className="animate-pop flex-1" loading={busy} disabled={d.state !== 'idle'} onClick={() => save(withPlace(live))}>
                {!online ? 'Auf dem Gerät speichern' : `${summary(live)} anlegen`}
              </Button>
            </div>
          ) : (
            <Button size="lg" className="animate-pop w-full" loading={busy} disabled={d.state !== 'idle'} onClick={analyse}>
              Auswerten
            </Button>
          )
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {canCreate && (
          <Segmented
            className="self-center"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'assets', label: 'Elemente' },
              { value: 'findings', label: 'Mängel & Aufgaben' },
            ]}
          />
        )}
        {online ? (
          <BigMic
            dictation={d}
            label={assetsMode ? 'Sag, was hier verbaut ist' : 'Sag einfach, was dir auffällt'}
            hint={assetsMode ? 'Anzahl, Art und Ort – Hersteller und T30 gleich mitsagen.' : 'Element-Code, Schwere oder Frist („bis Freitag“) gleich mitsagen.'}
          />
        ) : (
          <Notice tone="info" icon={<CloudOff />} title="Kein Netz">
            Mikrofon der Tastatur nutzen. Ausgewertet wird auf dem Gerät, übertragen sobald Netz da ist.
          </Notice>
        )}
        <Textarea
          dictate={false}
          autoFocus={assetsMode}
          aria-label="Erfasster Text"
          placeholder={
            assetsMode
              ? 'Oder tippen, z. B. „Im EG Flur drei Feuerschutztüren T30 von Hörmann und zwei Feuerlöscher“'
              : 'Oder tippen, z. B. „Tür im 2. OG schließt nicht, Dichtung fehlt. Hausmeister bis Freitag informieren.“'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-24"
        />
        <LivePreview items={live} />
        <WherePicker where={where} onChange={changeWhere} emphasize={!where && live.length > 0} />
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
