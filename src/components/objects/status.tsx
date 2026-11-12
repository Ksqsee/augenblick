// Bausteine für Objekte & Elemente: Status-Erklärung, Elementzeile, Verteilungsbalken.
// Regeln: docs/design.md (Farbe = Status), Mobbin-Belege: docs/design/objekte-elemente.md
import clsx from 'clsx';
import type { Asset } from '../../api';
import { summarizeSchedules } from '../../../shared/logic';
import { scheduleLabel } from '../../categories';
import { assetDue, categoryLabel, DUE_META, fmtDate, type Tone } from '../../format';
import { CategoryIcon } from '../CategoryIcon';
import { Badge, ListRow, toneDot } from '../ui';

const DAY = 86_400_000;

/** „3 Tagen“, „1 Monat“, „2 Jahren“ – Dativ für „seit …“ / „in …“. */
export function spanText(ms: number) {
  const days = Math.max(1, Math.round(Math.abs(ms) / DAY));
  if (days < 45) return days === 1 ? '1 Tag' : `${days} Tagen`;
  const months = Math.round(days / 30.4);
  if (months < 18) return months === 1 ? '1 Monat' : `${months} Monaten`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 Jahr' : `${years} Jahren`;
}

export interface DueInfo {
  tone: Tone;
  label: string;
  /** Erklärung in einem Satzteil: „Überfällig seit 3 Monaten“, „Fällig in 12 Tagen“ */
  detail: string;
  /** Ergänzung neben dem Badge: „seit 3 Monaten“, „in 12 Tagen“, „am 12.03.2027“ ('' = nichts) */
  short: string;
}

/** Prüfstatus eines Elements in Worten (für Kopf, Zeilen, Drawer). */
export function dueInfo(a: Pick<Asset, 'nextDueAt' | 'lastResult'>, now = Date.now()): DueInfo {
  if (a.lastResult === 'not_inspectable') return { tone: 'muted', label: 'Nicht prüfbar', detail: 'Zuletzt nicht prüfbar', short: '' };
  const state = assetDue(a.nextDueAt);
  const m = DUE_META[state];
  const r = (detail: string, short: string): DueInfo => ({ tone: m.tone, label: m.label, detail, short });
  if (state === 'never' || a.nextDueAt == null) return r('Noch nie geprüft', '');
  const diff = a.nextDueAt - now;
  if (state === 'overdue') return r(`Überfällig seit ${spanText(diff)}`, `seit ${spanText(diff)}`);
  const days = Math.round(diff / DAY);
  if (days <= 0) return r('Heute fällig', 'heute');
  if (days === 1) return r('Morgen fällig', 'morgen');
  if (state === 'soon') return r(`Fällig in ${spanText(diff)}`, `in ${spanText(diff)}`);
  return r(`Fällig am ${fmtDate(a.nextDueAt)}`, `bis ${fmtDate(a.nextDueAt)}`);
}

/** Statusbadge eines Elements (inkl. „Nicht prüfbar“). */
export function AssetStatusBadge({ asset, className }: { asset: Pick<Asset, 'nextDueAt' | 'lastResult'>; className?: string }) {
  const d = dueInfo(asset);
  return (
    <Badge tone={d.tone} dot className={className}>
      {d.label}
    </Badge>
  );
}

/** Name der nächsten Prüfart, falls nicht die Hauptprüfung. */
export function nextScheduleName(a: Pick<Asset, 'schedules' | 'category'>) {
  const k = a.schedules ? summarizeSchedules(a.schedules).nextKey : null;
  return k && k !== 'main' ? scheduleLabel(a.category, k) : null;
}

export const placeText = (a: Pick<Asset, 'location' | 'floor' | 'buildingName' | 'propertyName'>, showPlace = true) =>
  [a.location, a.floor, showPlace ? a.buildingName : null, showPlace ? a.propertyName : null].filter(Boolean).join(' · ') || 'Ohne Standort';

/** Standardzeile für ein Element: Art-Symbol · Code + Art · Ort · Fälligkeit · Status. */
export function AssetRow({ asset: a, onClick, to, showPlace = true }: { asset: Asset; onClick?: () => void; to?: string; showPlace?: boolean }) {
  const d = dueInfo(a);
  const sched = nextScheduleName(a);
  return (
    <ListRow
      onClick={onClick}
      to={to}
      leading={<CategoryIcon category={a.category} size="sm" />}
      title={
        <>
          {a.code}
          <span className="ml-2 font-normal text-ink-3 max-sm:hidden">{categoryLabel(a.category)}</span>
        </>
      }
      subtitle={placeText(a, showPlace)}
      meta={
        d.short || sched ? (
          <span className="block w-36 text-right">
            {d.short && <span className="block">{d.short}</span>}
            {sched && <span className="block truncate text-caption text-ink-4">{sched}</span>}
          </span>
        ) : undefined
      }
      trailing={
        <>
          {a.openDefects > 0 && (
            <Badge tone="brand" size="sm" className="max-sm:hidden">
              {a.openDefects} {a.openDefects === 1 ? 'Mangel' : 'Mängel'}
            </Badge>
          )}
          <AssetStatusBadge asset={a} />
        </>
      }
      chevron
    />
  );
}

export interface DueCounts {
  overdue: number;
  soon: number;
  never: number;
  ok: number;
  muted?: number;
}

export function countDue(assets: Pick<Asset, 'nextDueAt' | 'lastResult'>[]): DueCounts {
  const c: Required<DueCounts> = { overdue: 0, soon: 0, never: 0, ok: 0, muted: 0 };
  for (const a of assets) {
    if (a.lastResult === 'not_inspectable') c.muted++;
    else c[assetDue(a.nextDueAt)]++;
  }
  return c;
}

const ORDER: { key: keyof DueCounts; tone: Tone; label: string }[] = [
  { key: 'overdue', tone: 'bad', label: 'Überfällig' },
  { key: 'soon', tone: 'warn', label: 'Bald fällig' },
  { key: 'never', tone: 'info', label: 'Nie geprüft' },
  { key: 'ok', tone: 'ok', label: 'Aktuell' },
  { key: 'muted', tone: 'muted', label: 'Nicht prüfbar' },
];

/** Verteilungsbalken des Prüfstatus (dünn, Segmente in Statusfarben), optional mit Legende. */
export function StatusBar({ counts, legend, className }: { counts: DueCounts; legend?: boolean; className?: string }) {
  const parts = ORDER.map((o) => ({ ...o, n: counts[o.key] ?? 0 })).filter((p) => p.n > 0);
  const total = parts.reduce((s, p) => s + p.n, 0);
  const summary = parts.map((p) => `${p.n} ${p.label}`).join(', ');
  return (
    <div className={className}>
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={total ? `Prüfstatus: ${summary}` : 'Keine Elemente'}>
        {parts.map((p) => (
          <span key={p.key} className={clsx('h-full first:rounded-l-full last:rounded-r-full', toneDot[p.tone])} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      {legend && total > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-meta">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-ink-2">
              <span className={clsx('size-2 rounded-full', toneDot[p.tone])} />
              <span className="flex-1">{p.label}</span>
              <span className="font-medium text-ink tabular-nums">{p.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
