// Objektliste mit Ampel (docs/plan/v8.md 1): am Desktop die linke Leiste, am Handy die Startseite (/objekte).
// Je Objekt eine Zeile: Name, Ort und höchstens drei kleine Angaben (Fälligkeit, Mängel, Unterschriften – nur ≠ 0),
// dringendstes zuerst. Filter Alle · Fällig · Mit Mängeln · Unterschrift offen gilt für Leiste und Seite gemeinsam.
// Logik (Rangfolge, Angaben, Filter) in shared/ampel.ts.
import clsx from 'clsx';
import { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { AMPEL_FILTERS, type AmpelFilter, ampelNotes, ampelTier, matchesAmpel, placeOf, sortByUrgency } from '../../shared/ampel';
import { type Me, type PropertyRow, useProperties } from '../api';

// ---------- Bildschirmbreite ----------
const DESKTOP = '(min-width: 1024px)';
const subscribeMedia = (cb: () => void) => {
  const m = window.matchMedia?.(DESKTOP);
  m?.addEventListener('change', cb);
  return () => m?.removeEventListener('change', cb);
};
/** Ab lg (1024 px) – dort ist die Objektliste die linke Leiste. */
export const useIsDesktop = () => useSyncExternalStore(subscribeMedia, () => !!window.matchMedia?.(DESKTOP).matches);

// ---------- gemeinsamer Filter (Leiste und Seite) ----------
const FILTER_KEY = 'pk:objekt-filter';
const FILTERS = AMPEL_FILTERS.map((f) => f.key);
const listeners = new Set<() => void>();
let filter: AmpelFilter = (() => {
  try {
    const v = sessionStorage.getItem(FILTER_KEY) as AmpelFilter | null;
    return v && FILTERS.includes(v) ? v : 'alle';
  } catch {
    return 'alle';
  }
})();
export function setPropertyFilter(f: AmpelFilter) {
  if (!FILTERS.includes(f) || f === filter) return;
  filter = f;
  try {
    sessionStorage.setItem(FILTER_KEY, f);
  } catch {
    /* privates Fenster */
  }
  for (const l of listeners) l();
}
export const isAmpelFilter = (v: string | null): v is AmpelFilter => !!v && FILTERS.includes(v as AmpelFilter);
const subscribeFilter = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
export const usePropertyFilter = (): [AmpelFilter, (f: AmpelFilter) => void] => [useSyncExternalStore(subscribeFilter, () => filter), setPropertyFilter];

// ---------- zuletzt geöffnetes Objekt (je Workspace, nur im Browser) ----------
const lastKey = (tenantId: string | undefined) => `pk:last-property:${tenantId ?? ''}`;
export function rememberProperty(tenantId: string, id: string) {
  try {
    localStorage.setItem(lastKey(tenantId), id);
  } catch {
    /* ohne Gedächtnis weiter */
  }
}
export function lastPropertyId(tenantId: string | undefined) {
  try {
    return (tenantId && localStorage.getItem(lastKey(tenantId))) || undefined;
  } catch {
    return undefined;
  }
}
/** Objekt ohne ausdrückliche Wahl: das zuletzt geöffnete (wenn noch sichtbar), sonst das dringendste. */
export function startProperty(tenantId: string | undefined, list: readonly PropertyRow[], now = Date.now()) {
  const last = lastPropertyId(tenantId);
  if (last && list.some((p) => p.id === last)) return last;
  return sortByUrgency(list, now)[0]?.id;
}

/** Objekte mit Suche und Filter, dringendstes zuerst; Zähler je Filter für die Chips. */
export function usePropertyList(q: string) {
  const query = useProperties();
  const [f, setF] = usePropertyFilter();
  const now = Date.now();
  const all = useMemo(() => sortByUrgency(query.data ?? [], now), [query.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const hit = (p: PropertyRow) => !needle || (p.name + ' ' + p.address + ' ' + p.contactName).toLowerCase().includes(needle);
  const rows = all.filter((p) => matchesAmpel(p, f, now) && hit(p));
  const counts = Object.fromEntries(AMPEL_FILTERS.map(({ key }) => [key, all.filter((p) => matchesAmpel(p, key, now)).length])) as Record<AmpelFilter, number>;
  return { query, all, rows, counts, filter: f, setFilter: setF, now };
}

export const canCreateProperty = (me: Me | undefined) => !!me && ['owner', 'admin'].includes(me.user.role);

const TONE: Record<'bad' | 'warn' | 'muted', string> = { bad: 'text-shu', warn: 'text-ink-2', muted: 'text-ink-3' };
const DOT: Record<'bad' | 'warn' | 'muted', string> = { bad: 'bg-shu', warn: 'bg-warn', muted: 'bg-ink-4' };

/** Die kleinen Angaben einer Zeile: Ort, dann Fälligkeit (mit Punkt) · Mängel · Unterschriften. */
export function AmpelLine({ p, now, className }: { p: PropertyRow; now: number; className?: string }) {
  const notes = ampelNotes(p, now);
  const place = placeOf(p.address);
  return (
    <span className={clsx('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5', className)}>
      {place && <span className="truncate text-ink-3">{place}</span>}
      {notes.map((n) => (
        <span key={n.kind} data-ampel={n.kind} className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums', TONE[n.tone])}>
          {n.kind === 'due' && <span aria-hidden className={clsx('size-1.5 rounded-full', DOT[n.tone])} />}
          {n.text}
        </span>
      ))}
      {!place && !notes.length && <span className="text-ink-4">{p.assets ? 'alles aktuell' : 'noch keine Elemente'}</span>}
    </span>
  );
}

/** Eine Objektzeile; `variant` sidebar (Leiste auf dem Grund) oder page (Zeile in der Fläche, Handy). */
export function PropertyLink({ p, now, active, variant }: { p: PropertyRow; now: number; active?: boolean; variant: 'sidebar' | 'page' }) {
  return (
    <Link
      to={`/objekte/${p.id}`}
      data-property={p.id}
      data-tier={ampelTier(p, now)}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex min-w-0 flex-col transition-colors',
        variant === 'sidebar'
          ? ['gap-0.5 rounded-md px-2 py-1.5', active ? 'bg-selected' : 'hover:bg-sunken/70']
          : 'min-h-14 justify-center gap-1 px-(--row-px) py-3 hover:bg-hover active:bg-hover',
      )}
    >
      <span className={clsx('truncate text-body', active || variant === 'page' ? 'text-ink' : 'text-ink-2')}>{p.name}</span>
      <AmpelLine p={p} now={now} className={variant === 'sidebar' ? 'text-caption' : 'text-meta'} />
    </Link>
  );
}

/** Filter als kleine Text-Reiter (Leiste) bzw. Chips (Seite); Zähler nur, wenn ≠ 0. */
export function AmpelFilters({ value, onChange, counts, compact }: { value: AmpelFilter; onChange: (f: AmpelFilter) => void; counts: Record<AmpelFilter, number>; compact?: boolean }) {
  return (
    <div role="group" aria-label="Ampel-Filter" className={clsx('flex', compact ? 'flex-wrap gap-1' : 'no-scrollbar -mx-4 gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0')}>
      {AMPEL_FILTERS.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active && key !== 'alle' ? 'alle' : key)}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
              compact ? 'h-7 px-2 text-caption' : 'h-9 border px-3 text-meta sm:h-8',
              active ? (compact ? 'bg-selected text-ink' : 'border-line-strong bg-selected text-ink') : compact ? 'text-ink-3 hover:bg-sunken/70 hover:text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {label}
            {key !== 'alle' && counts[key] > 0 && <span className="font-normal text-ink-3 tabular-nums">{counts[key]}</span>}
          </button>
        );
      })}
    </div>
  );
}
