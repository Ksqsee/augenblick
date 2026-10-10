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

/** Vom Prüfer festgelegte Gesamtbewertung (überschreibt die berechnete). */
export type ResultOverride = 'ok' | 'defects' | 'critical';

/**
 * Endgültiges Ergebnis: Nicht prüfbar bleibt immer, „ohne Mängel“ ist nur ohne erfasste Mängel
 * möglich. Sonst gilt die Festlegung des Prüfers.
 */
export function finalResult(computed: Result, override: ResultOverride | null | undefined, defectCount: number): Result {
  if (computed === 'not_inspectable' || !override) return computed;
  if (override === 'ok' && defectCount > 0) return computed;
  return override;
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

// ---------- Prüfarten je Element ----------
export interface ScheduleState {
  enabled: boolean;
  lastAt?: number | null;
  lastResult?: Result | null;
  nextDueAt?: number | null;
  /** aus Import übernommener Stand ohne Prüfprotokoll */
  baseline?: { lastAt: number; nextDueAt: number | null };
}
export type Schedules = Record<string, ScheduleState>;

/**
 * Zusammenfassung über alle aktiven Prüfarten:
 * - Hauptprüfung nie durchgeführt → nextDueAt = null („nie geprüft“)
 * - sonst frühester Termin aller aktiven Prüfarten
 */
export function summarizeSchedules(s: Schedules): {
  nextDueAt: number | null;
  nextKey: string | null;
  lastAt: number | null;
  lastResult: Result | null;
} {
  const entries = Object.entries(s).filter(([k, v]) => v.enabled || k === 'main');
  let lastAt: number | null = null;
  let lastResult: Result | null = null;
  for (const [, v] of entries) {
    if (v.lastAt != null && (lastAt == null || v.lastAt > lastAt)) {
      lastAt = v.lastAt;
      lastResult = v.lastResult ?? null;
    }
  }
  const main = s.main;
  if (!main || (main.lastAt == null && main.nextDueAt == null)) return { nextDueAt: null, nextKey: 'main', lastAt, lastResult };
  let nextDueAt: number | null = null;
  let nextKey: string | null = null;
  for (const [k, v] of entries) {
    if (v.nextDueAt != null && (nextDueAt == null || v.nextDueAt < nextDueAt)) {
      nextDueAt = v.nextDueAt;
      nextKey = k;
    }
  }
  return { nextDueAt, nextKey, lastAt, lastResult };
}

/** Prüfart nach Abschluss einer Prüfung fortschreiben. */
export function applyInspection(s: Schedules, key: string, at: number, result: Result, nextDueAt: number | null): Schedules {
  const prev = s[key] ?? { enabled: true };
  if (prev.lastAt != null && prev.lastAt > at) return s; // ältere (offline nachgereichte) Prüfung ändert nichts
  return { ...s, [key]: { ...prev, enabled: true, lastAt: at, lastResult: result, nextDueAt: nextDueAt ?? prev.nextDueAt ?? null } };
}
