// „Erfassen“: einmal sprechen (oder tippen), daraus werden Mängel, Aufgaben und Notizen.
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Check, ListTodo, MapPin, PackagePlus, ScanLine, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { type CaptureItem, parseCapture } from '../../shared/smart';
import { api, type Asset, useAssets, useProperties } from '../api';
import { useDictation } from '../dictate';
import { categoryLabel } from '../format';
import { BigMic } from './Dictate';
import { Button, Input, Modal, Textarea, useToast } from './ui';

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

const KIND_META = {
  defect: { label: 'Mangel', icon: AlertTriangle, cls: 'text-bad' },
  task: { label: 'Aufgabe', icon: ListTodo, cls: 'text-info' },
  note: { label: 'Notiz', icon: StickyNote, cls: 'text-ink-3' },
} as const;
const SEV_CLS: Record<Severity, string> = { low: 'bg-ink-3', medium: 'bg-warn', high: 'bg-brand', critical: 'bg-bad' };

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
      <div className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2 text-sm">
        <MapPin className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">
          {where.kind === 'asset' ? (
            <>
              <b>{where.asset.code}</b> · {categoryLabel(where.asset.category)} · {where.asset.location || where.asset.buildingName}
            </>
          ) : (
            <>
              Objekt <b>{where.name}</b>
            </>
          )}
        </span>
        <button type="button" className="rounded p-1 text-ink-3 hover:text-ink" aria-label="Ort ändern" onClick={() => onChange(null)}>
          <X className="size-4" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <MapPin className="pointer-events-none absolute top-3.5 left-3 size-4 text-ink-3" />
      <Input
        className="pl-9"
        placeholder="Wo? Element-Code, Standort oder Objekt"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (hits.a.length > 0 || hits.p.length > 0) && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl bg-surface shadow-pop">
          {hits.a.map((a) => (
            <li key={a.id}>
              <button type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => onChange({ kind: 'asset', asset: a })}>
                <span className="font-medium">
                  {a.code} <span className="font-normal text-ink-3">· {categoryLabel(a.category)}</span>
                </span>
                <span className="truncate text-xs text-ink-3">
                  {a.propertyName} · {a.buildingName} · {[a.floor, a.location].filter(Boolean).join(', ')}
                </span>
              </button>
            </li>
          ))}
          {hits.p.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => onChange({ kind: 'property', id: p.id, name: p.name })}>
                Objekt <b>{p.name}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemCard({ item, onChange, onRemove }: { item: CaptureItem; onChange: (i: CaptureItem) => void; onRemove: () => void }) {
  const M = KIND_META[item.kind];
  return (
    <div className="animate-pop flex flex-col gap-3 rounded-2xl bg-sunken/60 p-3">
      <div className="flex items-center gap-1">
        {(Object.keys(KIND_META) as CaptureItem['kind'][]).map((k) => {
          const K = KIND_META[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange({ ...item, kind: k })}
              className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition', item.kind === k ? 'bg-surface shadow-card' : 'text-ink-3 hover:text-ink')}
            >
              <K.icon className={clsx('size-3.5', item.kind === k && K.cls)} />
              {K.label}
            </button>
          );
        })}
        <button type="button" onClick={onRemove} className="ml-auto rounded-full p-2 text-ink-3 hover:bg-surface hover:text-bad" aria-label="Eintrag entfernen">
          <Trash2 className="size-4" />
        </button>
      </div>
      <Input aria-label={`${M.label}: Titel`} value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} />
      {item.kind === 'defect' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SEVERITIES) as Severity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...item, severity: s })}
                className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium', item.severity === s ? 'bg-ink text-white' : 'bg-surface text-ink-2')}
              >
                <span className={clsx('size-2 rounded-full', SEV_CLS[s])} />
                {SEVERITIES[s]}
              </button>
            ))}
          </div>
          <Input aria-label="Maßnahme" placeholder="Maßnahme" value={item.measure} onChange={(e) => onChange({ ...item, measure: e.target.value })} />
        </>
      )}
      {item.assetCode && <p className="text-xs text-ink-3">Element {item.assetCode}</p>}
    </div>
  );
}

/** Schon beim Sprechen/Tippen zeigen, was erkannt wird (Regeln laufen lokal). */
function LivePreview({ text }: { text: string }) {
  const items = useMemo(() => (text.trim().length > 6 ? parseCapture(text) : []), [text]);
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Erkannt">
      {items.slice(0, 6).map((i, n) => {
        const K = KIND_META[i.kind];
        return (
          <li key={n} className="animate-pop flex items-center gap-2 rounded-xl bg-sunken/70 px-3 py-2 text-[13px]">
            <K.icon className={clsx('size-4 shrink-0', K.cls)} />
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            {i.kind === 'defect' && (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-3">
                <span className={clsx('size-2 rounded-full', SEV_CLS[i.severity])} />
                {SEVERITIES[i.severity]}
              </span>
            )}
            {i.dueInDays != null && <span className="shrink-0 text-xs text-ink-3">in {i.dueInDays} T.</span>}
          </li>
        );
      })}
    </ul>
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
  const [done, setDone] = useState<{ defects: number; tasks: number; auto: number } | null>(null);
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
    try {
      for (const i of items) {
        if (!i.title.trim()) continue;
        const a = byCode(i.assetCode) ?? (where?.kind === 'asset' ? where.asset : undefined);
        const propertyId = a?.propertyId ?? (where?.kind === 'property' ? where.id : null);
        if (i.kind === 'defect') {
          const r = await api<{ taskCreated: boolean }>('/defects', {
            body: { assetId: a?.id ?? null, propertyId, title: i.title, note: i.note, measure: i.measure, severity: i.severity },
          });
          defects++;
          if (r.taskCreated) auto++;
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
      setDone({ defects, tasks, auto });
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

  if (done)
    return (
      <Modal title="Gespeichert" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-ok/15 text-ok">
            <Check className="size-8" />
          </span>
          <p className="text-[15px]">
            {[done.defects && `${done.defects} ${done.defects === 1 ? 'Mangel' : 'Mängel'}`, done.tasks && `${done.tasks} ${done.tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`].filter(Boolean).join(' und ')}{' '}
            angelegt.
            {done.auto > 0 && <span className="mt-1 block text-sm text-ink-3">Für {done.auto} schwere Mängel wurde automatisch eine Aufgabe mit Frist erstellt.</span>}
          </p>
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setDone(null);
                setItems(null);
                setText('');
              }}
            >
              Weiter erfassen
            </Button>
            <Button className="flex-1" onClick={() => go(done.defects ? '/maengel' : '/aufgaben')}>
              Ansehen
            </Button>
          </div>
        </div>
      </Modal>
    );

  if (items)
    return (
      <Modal
        title={
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setItems(null)} className="-ml-1 rounded-full p-1 text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Zurück">
              <ArrowLeft className="size-5" />
            </button>
            {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'} erkannt
          </span>
        }
        onClose={onClose}
        footer={
          <Button size="lg" className="w-full" loading={busy} disabled={!items.length || needsPlace} onClick={save} icon={<Check className="size-5" />}>
            {needsPlace ? 'Erst Ort wählen' : items.length > 1 ? `Alle ${items.length} übernehmen` : 'Übernehmen'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <WherePicker where={where} onChange={setWhere} />
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <Sparkles className="size-3.5" />
            {source === 'ai' ? 'Von der KI vorsortiert' : 'Automatisch vorsortiert'} – Art, Schwere und Text bei Bedarf anpassen.
          </p>
          {items.map((it, n) => (
            <ItemCard key={n} item={it} onChange={(v) => setItems(items.map((x, j) => (j === n ? v : x)))} onRemove={() => setItems(items.filter((_, j) => j !== n))} />
          ))}
        </div>
      </Modal>
    );

  return (
    <Modal
      title="Erfassen"
      onClose={onClose}
      footer={
        <Button size="lg" className="w-full" loading={busy} disabled={!text.trim() || d.state !== 'idle'} onClick={analyse} icon={<Sparkles className="size-5" />}>
          Auswerten
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <BigMic dictation={d} label="Sag einfach, was dir auffällt" hint="Tipp: Element-Code, Schwere oder Frist („bis Freitag“) gleich mitsagen" />
        <Textarea
          dictate={false}
          aria-label="Erfasster Text"
          placeholder="z. B. „Tür im 2. OG schließt nicht, Dichtung fehlt. Hausmeister bis Freitag informieren.“"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-28"
        />
        <LivePreview text={text} />
        <WherePicker where={where} onChange={setWhere} />
        <div className="grid grid-cols-2 gap-2">
          {QUICK.map((q) => (
            <Link key={q.to} to={q.to} onClick={onClose} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-sunken text-sm font-medium text-ink-2 hover:text-ink">
              <q.icon className="size-4" /> {q.label}
            </Link>
          ))}
        </div>
      </div>
    </Modal>
  );
}
