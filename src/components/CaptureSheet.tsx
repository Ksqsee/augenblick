// „Erfassen“: einmal sprechen (oder tippen), daraus werden Mängel, Aufgaben und Notizen.
// Ablauf: sprechen → Live-Vorschau → „Auswerten“ → Karten prüfen → „übernehmen“ → Bestätigung.
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, ListTodo, MapPin, PackagePlus, ScanLine, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { type CaptureItem, parseCapture } from '../../shared/smart';
import { api, ApiError, type Asset, useAssets, useProperties } from '../api';
import { useDictation } from '../dictate';
import { categoryLabel } from '../format';
import { BigMic } from './Dictate';
import { RadioChips } from './inspect/Choice';
import { Button, Input, Modal, Notice, SEVERITY_TONE, Textarea, toneDot, useToast } from './ui';

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

/** Art eines Eintrags: Mangel = Bernstein, Aufgabe = Blau, Notiz = neutral. */
const KIND_META = {
  defect: { label: 'Mangel', icon: AlertTriangle, box: 'bg-warn-soft text-warn' },
  task: { label: 'Aufgabe', icon: ListTodo, box: 'bg-info-soft text-info' },
  note: { label: 'Notiz', icon: StickyNote, box: 'bg-sunken text-ink-2' },
} as const;
const sevDot = (s: Severity) => (s === 'low' ? 'bg-ink-4' : toneDot[SEVERITY_TONE[s]]);

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
      <div className="flex min-h-12 items-center gap-3 rounded-lg border border-line bg-surface px-3 text-body">
        <MapPin className="size-4 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate">
          {where.kind === 'asset' ? (
            <>
              <span className="font-semibold">{where.asset.code}</span>
              <span className="text-ink-3">
                {' '}
                · {categoryLabel(where.asset.category)} · {where.asset.location || where.asset.buildingName}
              </span>
            </>
          ) : (
            <>
              <span className="text-ink-3">Objekt </span>
              <span className="font-semibold">{where.name}</span>
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
        <ul className="animate-menu absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl bg-surface py-1 shadow-pop">
          {hits.a.map((a) => (
            <li key={a.id}>
              <button type="button" className="flex w-full flex-col px-3 py-2 text-left hover:bg-hover" onClick={() => onChange({ kind: 'asset', asset: a })}>
                <span className="text-body font-medium">
                  {a.code} <span className="font-normal text-ink-3">· {categoryLabel(a.category)}</span>
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
                <span className="font-medium">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindIcon({ kind, className }: { kind: CaptureItem['kind']; className?: string }) {
  const K = KIND_META[kind];
  return (
    <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg', K.box, className)}>
      <K.icon className="size-4" />
    </span>
  );
}

/** Eine erkannte Zeile zum Prüfen: Art umschalten, Titel, bei Mängeln Schwere und Maßnahme. */
function ItemCard({ item, onChange, onRemove }: { item: CaptureItem; onChange: (i: CaptureItem) => void; onRemove: () => void }) {
  const M = KIND_META[item.kind];
  return (
    <div className="animate-pop flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <KindIcon kind={item.kind} />
        <div className="flex rounded-lg bg-sunken p-0.5" role="group" aria-label="Art">
          {(Object.keys(KIND_META) as CaptureItem['kind'][]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={item.kind === k}
              onClick={() => onChange({ ...item, kind: k })}
              className={clsx('h-9 rounded-md px-2.5 text-meta font-medium transition sm:h-8', item.kind === k ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRemove} className="ml-auto grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label="Eintrag entfernen">
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

/** Schon beim Sprechen/Tippen zeigen, was erkannt wird (Regeln laufen lokal). */
function LivePreview({ text }: { text: string }) {
  const items = useMemo(() => (text.trim().length > 6 ? parseCapture(text) : []), [text]);
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-ink-3">
        <Sparkles className="size-3.5" /> Wird erkannt
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line" aria-label="Erkannt">
        {items.slice(0, 6).map((i, n) => (
          <li key={n} className="animate-pop flex min-h-11 items-center gap-2.5 px-3 py-1.5 text-body">
            <KindIcon kind={i.kind} className="size-7" />
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            {i.kind === 'defect' && (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-meta text-ink-3">
                <span className={clsx('size-2 rounded-full', sevDot(i.severity))} />
                {SEVERITIES[i.severity]}
              </span>
            )}
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
  const [items, setItems] = useState<CaptureItem[] | null>(null);
  const [source, setSource] = useState<'ai' | 'rules'>('rules');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ defects: number; tasks: number; auto: number; dupes: { title: string; message: string; body: unknown }[] } | null>(null);
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
      const r = await api<{ items: CaptureItem[]; source: 'ai' | 'rules' }>('/ai/parse', { body: { text, checkpoints: [] } });
      setItems(r.items.length ? r.items : [{ kind: 'note', title: text.slice(0, 200), note: '', severity: 'medium', measure: '', assetCode: null, checkpointId: null, dueInDays: null }]);
      setSource(r.source);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Auswerten fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  }

  const byCode = (code: string | null) => (code ? assets.data?.find((a) => a.code.toLowerCase() === code.toLowerCase()) : undefined);
  const needsPlace = items?.some((i) => i.kind === 'defect' && !byCode(i.assetCode)) && !where;

  async function save() {
    if (!items) return;
    setBusy(true);
    let defects = 0;
    let tasks = 0;
    let auto = 0;
    const dupes: { title: string; message: string; body: unknown }[] = [];
    try {
      for (const i of items) {
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
      setDone({ defects, tasks, auto, dupes });
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
    const n = done.defects + done.tasks;
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
            <Button onClick={() => go(done.defects ? '/maengel' : '/aufgaben')}>Ansehen</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <CheckCircle2 className="size-10 text-ok" strokeWidth={1.75} />
            <p className="text-title font-semibold">
              {n === 0
                ? 'Nichts Neues angelegt'
                : `${[done.defects && `${done.defects} ${done.defects === 1 ? 'Mangel' : 'Mängel'}`, done.tasks && `${done.tasks} ${done.tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`].filter(Boolean).join(' und ')} angelegt`}
            </p>
            {done.auto > 0 && <p className="max-w-xs text-meta text-ink-3">Für {done.auto} schwere Mängel gibt es automatisch eine Aufgabe mit Frist.</p>}
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
            <button type="button" onClick={() => setItems(null)} className="-ml-1.5 grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Zurück">
              <ArrowLeft className="size-5" />
            </button>
            {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'} erkannt
          </span>
        }
        description={source === 'ai' ? 'Von der KI vorsortiert – Art, Schwere und Text bei Bedarf anpassen.' : 'Automatisch vorsortiert – Art, Schwere und Text bei Bedarf anpassen.'}
        onClose={onClose}
        footer={
          <Button size="lg" className="w-full" loading={busy} disabled={!items.length || needsPlace} onClick={save} icon={<Check />}>
            {needsPlace ? 'Erst Ort wählen' : items.length > 1 ? `Alle ${items.length} übernehmen` : 'Übernehmen'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <WherePicker where={where} onChange={setWhere} />
          {items.map((it, n) => (
            <ItemCard key={n} item={it} onChange={(v) => setItems(items.map((x, j) => (j === n ? v : x)))} onRemove={() => setItems(items.filter((_, j) => j !== n))} />
          ))}
          {!items.length && <p className="py-6 text-center text-body text-ink-3">Alle Einträge entfernt. Geh zurück, um neu zu sprechen.</p>}
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Erfassen"
      onClose={onClose}
      footer={
        <Button size="lg" className="w-full" loading={busy} disabled={!text.trim() || d.state !== 'idle'} onClick={analyse} icon={<Sparkles />}>
          Auswerten
        </Button>
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
        <div className="grid grid-cols-2 gap-2">
          {QUICK.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              onClick={onClose}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line text-meta font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <q.icon className="size-4" /> {q.label}
            </Link>
          ))}
        </div>
      </div>
    </Modal>
  );
}
