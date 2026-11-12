// Bausteine für Objekte & Elemente (Design v3): Status in Worten, Elementzeile, Zählung.
// Regeln: docs/design.md (Status = Punkt + Wort, eine Aussage pro Zeile), Belege: docs/design/objekte-elemente.md
import type { Asset } from '../../api';
import { summarizeSchedules } from '../../../shared/logic';
import { scheduleLabel } from '../../categories';
import { assetDue, categoryLabel, DUE_META, defectsLabel, fmtDate, type Tone } from '../../format';
import { CategoryIcon } from '../CategoryIcon';
import { Badge, ListRow, StatusText } from '../ui';

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
  /** Ergänzung neben dem Wort: „seit 3 Monaten“, „in 12 Tagen“, „bis 12.03.2027“ ('' = nichts) */
  short: string;
  /** Das eine Statuswort einer Listenzeile: „seit 3 Monaten überfällig“, „in 12 Tagen fällig“, „nie geprüft“ */
  phrase: string;
}

/** Prüfstatus eines Elements in Worten (für Kopf, Zeilen, Drawer). */
export function dueInfo(a: Pick<Asset, 'nextDueAt' | 'lastResult'>, now = Date.now()): DueInfo {
  if (a.lastResult === 'not_inspectable') return { tone: 'muted', label: 'Nicht prüfbar', detail: 'Zuletzt nicht prüfbar', short: '', phrase: 'nicht prüfbar' };
  const state = assetDue(a.nextDueAt);
  const m = DUE_META[state];
  const r = (detail: string, short: string, phrase: string): DueInfo => ({ tone: m.tone, label: m.label, detail, short, phrase });
  if (state === 'never' || a.nextDueAt == null) return r('Noch nie geprüft', '', 'nie geprüft');
  const diff = a.nextDueAt - now;
  if (state === 'overdue') return r(`Überfällig seit ${spanText(diff)}`, `seit ${spanText(diff)}`, `seit ${spanText(diff)} überfällig`);
  const days = Math.round(diff / DAY);
  if (days <= 0) return r('Heute fällig', 'heute', 'heute fällig');
  if (days === 1) return r('Morgen fällig', 'morgen', 'morgen fällig');
  if (state === 'soon') return r(`Fällig in ${spanText(diff)}`, `in ${spanText(diff)}`, `in ${spanText(diff)} fällig`);
  return r(`Fällig am ${fmtDate(a.nextDueAt)}`, `bis ${fmtDate(a.nextDueAt)}`, `bis ${fmtDate(a.nextDueAt)}`);
}

/**
 * Prüfstatus eines Elements (inkl. „Nicht prüfbar“). Standard: Punkt + Wort (Listen, Fließtext).
 * variant="pill" nur im Seitenkopf oder in einer Tabellenspalte „Status“.
 */
export function AssetStatusBadge({ asset, className, variant = 'text' }: { asset: Pick<Asset, 'nextDueAt' | 'lastResult'>; className?: string; variant?: 'text' | 'pill' }) {
  const d = dueInfo(asset);
  if (variant === 'pill')
    return (
      <Badge tone={d.tone} dot className={className}>
        {d.label}
      </Badge>
    );
  return (
    <StatusText tone={d.tone} className={className}>
      {d.label}
    </StatusText>
  );
}

/** Das eine Statuswort einer Zeile: „● seit 3 Monaten überfällig“ (nur überfällig in Zinnober). */
export function DuePhrase({ asset, className }: { asset: Pick<Asset, 'nextDueAt' | 'lastResult'>; className?: string }) {
  const d = dueInfo(asset);
  return (
    <StatusText tone={d.tone} className={className}>
      {d.phrase}
    </StatusText>
  );
}

/** Name der nächsten Prüfart, falls nicht die Hauptprüfung. */
export function nextScheduleName(a: Pick<Asset, 'schedules' | 'category'>) {
  const k = a.schedules ? summarizeSchedules(a.schedules).nextKey : null;
  return k && k !== 'main' ? scheduleLabel(a.category, k) : null;
}

export const placeText = (a: Pick<Asset, 'location' | 'floor' | 'buildingName' | 'propertyName'>, showPlace = true) =>
  [a.location, a.floor, showPlace ? a.buildingName : null, showPlace ? a.propertyName : null].filter(Boolean).join(' · ') || 'Ohne Standort';

/**
 * Standardzeile für ein Element (v3): 16-px-Symbol der Art · Code + Art · graue Meta-Zeile (Ort, Prüfart, „1 Mangel“)
 * · rechts das eine Statuswort · Chevron. Auf dem Handy steht das Statuswort vorn in der Meta-Zeile.
 */
export function AssetRow({ asset: a, onClick, to, showPlace = true }: { asset: Asset; onClick?: () => void; to?: string; showPlace?: boolean }) {
  const sched = nextScheduleName(a);
  const meta = [placeText(a, showPlace), sched, a.openDefects > 0 ? defectsLabel(a.openDefects) : null].filter(Boolean).join(' · ');
  return (
    <ListRow
      onClick={onClick}
      to={to}
      leading={<CategoryIcon category={a.category} size="sm" />}
      title={
        <>
          <span className="font-medium">{a.code}</span>
          <span className="text-ink-3"> · {categoryLabel(a.category)}</span>
        </>
      }
      subtitle={
        <span className="flex min-w-0 items-center gap-1.5">
          <DuePhrase asset={a} className="shrink-0 sm:hidden" />
          <span aria-hidden className="sm:hidden">
            ·
          </span>
          <span className="truncate">{meta}</span>
        </span>
      }
      trailing={<DuePhrase asset={a} className="max-sm:hidden" />}
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

/** Reihenfolge und Wörter der Statusgruppen (dringendes zuerst). */
export const DUE_ORDER: { key: keyof DueCounts; tone: Tone; label: string }[] = [
  { key: 'overdue', tone: 'bad', label: 'Überfällig' },
  { key: 'soon', tone: 'warn', label: 'Bald fällig' },
  { key: 'never', tone: 'info', label: 'Nie geprüft' },
  { key: 'ok', tone: 'ok', label: 'Aktuell' },
  { key: 'muted', tone: 'muted', label: 'Nicht prüfbar' },
];

/** Dringendster Zustand mehrerer Elemente als ein Wort: „7 überfällig“, „3 bald fällig“, „aktuell“. */
export function summaryWord(c: DueCounts, total: number): { tone: Tone; label: string } {
  if (!total) return { tone: 'muted', label: 'leer' };
  if (c.overdue) return { tone: 'bad', label: `${c.overdue} überfällig` };
  if (c.soon) return { tone: 'warn', label: `${c.soon} bald fällig` };
  if (c.never) return { tone: 'info', label: `${c.never} ungeprüft` };
  return { tone: 'ok', label: 'aktuell' };
}
