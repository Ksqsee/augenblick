import { ClipboardCheck, ListTodo, Wrench } from 'lucide-react';
// Gemeinsame Fachhelfer für Aufgaben und Mängel (Oberfläche). Spezifikation: docs/design/aufgaben-maengel.md
import type { Defect, Task } from '../../api';
import { api } from '../../api';
import { DAY } from '../../../shared/logic';
import type { Tone } from '../../format';
import type { TaskKind } from '../../../shared/tasks';

export const KIND_ICON: Record<TaskKind, typeof Wrench> = { inspection: ClipboardCheck, defect: Wrench, other: ListTodo };

export const TASK_STATUS: Record<Task['status'], string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };
export const TASK_PRIO: Record<Task['priority'], { label: string; tone: Tone; level: number }> = {
  high: { label: 'Hoch', tone: 'bad', level: 3 },
  medium: { label: 'Mittel', tone: 'warn', level: 2 },
  low: { label: 'Niedrig', tone: 'muted', level: 1 },
};

export const isOpenTask = (t: Pick<Task, 'status'>) => t.status === 'open' || t.status === 'in_progress';

/** Aufgabe so speichern, wie sie ist – nur mit den angegebenen Änderungen. */
export function patchTask(t: Task, changes: Partial<Task> & { resolveDefect?: boolean }) {
  const { resolveDefect = true, ...rest } = changes;
  return api(`/tasks/${t.id}`, { method: 'PATCH', body: { ...t, ...rest, resolveDefect } });
}

/** Erledigen einer Mängelbehebung mit offenem Mangel: Rückfrage, ob der Mangel behoben ist. */
export const needsDefectQuestion = (t: Pick<Task, 'kind' | 'defectId' | 'defectStatus'>) => t.kind === 'defect' && !!t.defectId && t.defectStatus !== 'resolved';

export const toDateInput = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
export const fromDateInput = (s: string) => (s ? new Date(`${s}T12:00:00`).getTime() : null);

const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
const shortFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

/** Fälligkeit kurz und menschlich: „Heute“, „Morgen“, „Freitag“, „12. Dez.“, „seit 3 Tagen“. */
export function dueText(dueAt: number | null, now = Date.now()): { text: string; tone?: Tone } {
  if (!dueAt) return { text: '' };
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / DAY);
  if (days < 0) return { text: days === -1 ? 'seit gestern' : `seit ${-days} Tagen`, tone: 'bad' };
  if (days === 0) return { text: 'Heute', tone: 'warn' };
  if (days === 1) return { text: 'Morgen' };
  if (days < 7) return { text: weekdayFmt.format(dueAt) };
  return { text: shortFmt.format(dueAt) };
}

/** Vorlage für eine Mängelbehebung aus einem Mangel. */
export const taskFromDefect = (d: Defect) => ({
  title: `Mangel beheben: ${d.title}`,
  description: [d.code && `${d.code} · ${d.location ?? ''}`, d.legalBasis && `Grundlage: ${d.legalBasis}`, d.note, d.measure && `Maßnahme: ${d.measure}`].filter(Boolean).join('\n'),
  kind: 'defect' as const,
  assetId: d.assetId ?? null,
  assetCode: d.code ?? null,
  defectId: d.id,
  defectTitle: d.title,
  propertyId: d.propertyId ?? null,
  priority: d.severity === 'critical' || d.severity === 'high' ? ('high' as const) : ('medium' as const),
});

/** Ein Eingabefeld hat den Fokus – dann keine Tastenkürzel. */
export const typing = (e: KeyboardEvent | React.KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};
