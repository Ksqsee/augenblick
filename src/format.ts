import { CATEGORIES, type Category } from '../shared/catalog';
import { dueState, type DueState, type Result } from '../shared/logic';

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const longFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const rel = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

export const fmtDate = (ts: number | null | undefined) => (ts ? dateFmt.format(ts) : '–');
export const fmtDateTime = (ts: number | null | undefined) => (ts ? dateTimeFmt.format(ts) : '–');
export const fmtLong = (ts: number) => longFmt.format(ts);

export function fmtRelative(ts: number | null | undefined, now = Date.now()) {
  if (!ts) return '–';
  const days = Math.round((ts - now) / 86_400_000);
  if (Math.abs(days) < 1) return 'heute';
  if (Math.abs(days) < 45) return rel.format(days, 'day');
  const months = Math.round(days / 30.4);
  if (Math.abs(months) < 18) return rel.format(months, 'month');
  return rel.format(Math.round(days / 365), 'year');
}

export const categoryLabel = (c: Category) => CATEGORIES[c]?.label ?? c;

export const RESULT_META: Record<Result, { label: string; tone: Tone }> = {
  ok: { label: 'Ohne Mängel', tone: 'ok' },
  defects: { label: 'Mit Mängeln', tone: 'warn' },
  critical: { label: 'Kritisch', tone: 'bad' },
  not_inspectable: { label: 'Nicht prüfbar', tone: 'muted' },
};

export const DUE_META: Record<DueState, { label: string; tone: Tone }> = {
  never: { label: 'Nie geprüft', tone: 'info' },
  overdue: { label: 'Überfällig', tone: 'bad' },
  soon: { label: 'Bald fällig', tone: 'warn' },
  ok: { label: 'Aktuell', tone: 'ok' },
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand';

export const assetDue = (nextDueAt: number | null) => dueState(nextDueAt);

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export const defectsLabel = (n: number) => `${n} ${n === 1 ? 'Mangel' : 'Mängel'}`;
