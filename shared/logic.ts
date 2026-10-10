import type { Severity } from './catalog';

export type Answer = 'ok' | 'defect' | 'na';
export type Result = 'ok' | 'defects' | 'critical' | 'not_inspectable';
export type DueState = 'never' | 'overdue' | 'soon' | 'ok';

export const DAY = 86_400_000;
export const SOON_WINDOW_DAYS = 30;

export interface DefectInput {
  checkpointId?: string;
  title: string;
  severity: Severity;
}

/** Gesamtergebnis einer Prüfung aus Antworten und erfassten Mängeln. */
export function computeResult(opts: {
  notInspectable?: boolean;
  answers: Record<string, Answer>;
  defects: DefectInput[];
}): Result {
  if (opts.notInspectable) return 'not_inspectable';
  if (opts.defects.some((d) => d.severity === 'critical')) return 'critical';
  const anyDefect = opts.defects.length > 0 || Object.values(opts.answers).includes('defect');
  return anyDefect ? 'defects' : 'ok';
}

/** Nächster Prüftermin: gleicher Tag n Monate später (Monatsende wird gekappt). */
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

export function dueState(nextDueAt: number | null | undefined, now = Date.now()): DueState {
  if (nextDueAt == null) return 'never';
  if (nextDueAt < now) return 'overdue';
  if (nextDueAt - now <= SOON_WINDOW_DAYS * DAY) return 'soon';
  return 'ok';
}

/** Alle Prüfpunkte beantwortet? (Bei "nicht prüfbar" nicht nötig.) */
export function isComplete(checkpointIds: string[], answers: Record<string, Answer>, notInspectable = false): boolean {
  return notInspectable || checkpointIds.every((id) => answers[id] != null);
}
