// Selbstanpassende Prüfintervalle (Regel `adapt_intervals`): reine Logik ohne Datenbank.
//
// - Zwei Prüfungen in Folge mit Mängeln an derselben Prüfart eines Elements → Intervall halbieren
//   (abgerundet, nie unter 1 Monat).
// - Vier mängelfreie Prüfungen in Folge mit verkürztem Intervall → zurück zum Standard.
// - Nie länger als der Standard der Prüfart.
// Gezählt werden nur Prüfungen nach der letzten Intervall-Entscheidung (Anpassung oder Zurücksetzen),
// damit dieselben Prüfungen nicht zweimal wirken. „Nicht prüfbar“ zählt weder als Mangel noch als i. O.
import { addMonths, type Result, type ScheduleState } from './logic';

export type AdaptMode = 'off' | 'suggest' | 'auto';
export const ADAPT_MODES: Record<AdaptMode, string> = { off: 'Aus', suggest: 'Vorschlagen', auto: 'Automatisch' };

/** Prüfungen mit Mängeln in Folge, ab denen verkürzt wird. */
export const SHORTEN_AFTER = 2;
/** Mängelfreie Prüfungen in Folge, ab denen zum Standard zurückgekehrt wird. */
export const RESTORE_AFTER = 4;
export const MIN_INTERVAL_MONTHS = 1;

export interface HistoryEntry {
  at: number;
  result: Result;
}

export interface IntervalProposal {
  kind: 'shorten' | 'restore';
  /** aktuell wirksames Intervall */
  from: number;
  /** vorgeschlagenes Intervall */
  to: number;
  standard: number;
}

type IntervalState = Pick<ScheduleState, 'intervalMonths' | 'intervalAt'> | null | undefined;

/** Wirksames Intervall: angepasster Wert, höchstens der Standard, mindestens 1 Monat. */
export function effectiveInterval(standard: number, state: IntervalState): number {
  const v = state?.intervalMonths;
  if (v == null || !Number.isFinite(v)) return standard;
  return Math.max(MIN_INTERVAL_MONTHS, Math.min(standard, Math.floor(v)));
}

const defective = (r: Result) => r === 'defects' || r === 'critical';

/**
 * Vorschlag für eine Prüfart eines Elements. `history` sind die gültigen, abgeschlossenen
 * regulären Prüfungen dieser Prüfart (Reihenfolge egal).
 */
export function proposeInterval(standard: number, state: IntervalState, history: HistoryEntry[]): IntervalProposal | null {
  if (!(standard >= 1)) return null;
  const from = effectiveInterval(standard, state);
  const since = state?.intervalAt ?? null;
  const relevant = history.filter((h) => h.result !== 'not_inspectable' && (since == null || h.at > since)).sort((a, b) => a.at - b.at);
  const tail = (n: number) => (relevant.length >= n ? relevant.slice(-n) : null);
  const bad = tail(SHORTEN_AFTER);
  if (bad?.every((h) => defective(h.result))) {
    const to = Math.max(MIN_INTERVAL_MONTHS, Math.floor(from / 2));
    return to < from ? { kind: 'shorten', from, to, standard } : null;
  }
  if (from < standard) {
    const good = tail(RESTORE_AFTER);
    if (good?.every((h) => h.result === 'ok')) return { kind: 'restore', from, to: standard, standard };
  }
  return null;
}

/**
 * Neues Intervall auf eine Prüfart anwenden. Der nächste Termin wird ab der letzten Prüfung neu
 * berechnet (bei „nicht prüfbar“ bleibt er). `months` = Standard entfernt die Anpassung.
 */
export function applyInterval(state: ScheduleState, standard: number, months: number, at: number): ScheduleState {
  const m = Math.max(MIN_INTERVAL_MONTHS, Math.min(standard, Math.floor(months)));
  const next: ScheduleState = { ...state, intervalMonths: m === standard ? null : m, intervalAt: at };
  if (state.lastAt != null && state.lastResult && state.lastResult !== 'not_inspectable') next.nextDueAt = addMonths(state.lastAt, m);
  return next;
}

const months = (n: number) => `${n} ${n === 1 ? 'Monat' : 'Monate'}`;

/** Kurzer Satz für Vorschlag und Protokoll. */
export function describeProposal(p: IntervalProposal): string {
  return p.kind === 'shorten' ? `Intervall von ${p.from} auf ${months(p.to)} verkürzen` : `Intervall zurück auf ${months(p.to)} (Standard)`;
}
