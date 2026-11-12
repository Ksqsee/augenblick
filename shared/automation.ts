// Autopilot: Regeln, Stufen und reine Fachlogik (ohne Datenbank), geteilt von Worker und Oberfläche.
import { addMonths, DAY } from './logic';

export const AUTOMATION_MODES = { off: 'Aus', suggest: 'Vorschlagen', auto: 'Automatisch' } as const;
export type AutomationMode = keyof typeof AUTOMATION_MODES;

export type AutomationKey = 'plan_week' | 'assign_defect_tasks' | 'escalate_sla' | 'recurring_tasks' | 'close_stale' | 'monthly_report';

export interface AutomationDef {
  key: AutomationKey;
  title: string;
  description: string;
  defaultMode: AutomationMode;
  /** Nur Inhaber/Admins sehen Vorschläge und dürfen sie ausführen */
  adminOnly?: boolean;
}

/** Alle Regeln in Anzeigereihenfolge. */
export const AUTOMATIONS: readonly AutomationDef[] = [
  {
    key: 'plan_week',
    title: 'Woche planen',
    description: 'Montags je Gebäude mit Fälligkeiten in den nächsten 14 Tagen einen Prüfauftrag „Rundgang“ anlegen. Zuständig ist, wer dort zuletzt geprüft hat und Zugriff hat.',
    defaultMode: 'suggest',
  },
  {
    key: 'assign_defect_tasks',
    title: 'Mängel zuweisen',
    description: 'Für schwere Mängel sofort eine Aufgabe anlegen und sie nach den Zuweisungsregeln an eine Person oder einen Subunternehmer geben.',
    defaultMode: 'auto',
  },
  {
    key: 'escalate_sla',
    title: 'Fristen eskalieren',
    description: 'Ist eine offene Aufgabe über ihrer Frist, steigt die Priorität auf „Hoch“ und die Admins werden benachrichtigt.',
    defaultMode: 'suggest',
  },
  {
    key: 'recurring_tasks',
    title: 'Wiederkehrende Aufgaben',
    description: 'Wird eine Aufgabe mit Wiederholung erledigt, entsteht die nächste mit neuem Termin.',
    defaultMode: 'auto',
  },
  {
    key: 'close_stale',
    title: 'Offene Mängel nachhalten',
    description: 'Ist eine Mängelbehebung seit 14 Tagen erledigt, der Mangel aber noch offen, wird die zuständige Person erinnert.',
    defaultMode: 'suggest',
  },
  {
    key: 'monthly_report',
    title: 'Monatsberichte',
    description: 'Zum Monatsanfang je Objekt den Objektbericht erzeugen und im Berichtsarchiv ablegen. Die PDFs entstehen im Browser einer Admin-Person.',
    defaultMode: 'suggest',
    adminOnly: true,
  },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key) as [AutomationKey, ...AutomationKey[]];
export const automationDef = (key: string): AutomationDef | undefined => AUTOMATIONS.find((a) => a.key === key);

/** Rückgängig nur innerhalb dieser Frist. */
export const UNDO_DAYS = 7;
/** plan_week: Vorschau in Tagen */
export const PLAN_HORIZON_DAYS = 14;
/** close_stale: Tage nach Erledigung */
export const STALE_DAYS = 14;

export const SEVERITY_KEYS = ['low', 'medium', 'high', 'critical'] as const;
export type SeverityKey = (typeof SEVERITY_KEYS)[number];

/** Zuweisungsregel für assign_defect_tasks: Elementart + Schwere → Person oder Subunternehmer, Frist in Tagen. */
export interface AssignRule {
  id: string;
  /** Elementart-Schlüssel; null = alle (auch Mängel ohne Element) */
  category: string | null;
  severities: SeverityKey[];
  assigneeId: string | null;
  subcontractorId: string | null;
  /** Frist in Tagen; null = Lösungsfrist laut SLA */
  days: number | null;
}

/** Erste passende Regel (Reihenfolge = Vorrang). */
export function matchRule(rules: AssignRule[], d: { category: string | null; severity: string }): AssignRule | null {
  return rules.find((r) => (r.category == null || r.category === d.category) && (r.severities as string[]).includes(d.severity)) ?? null;
}

/** Schweregrade, für die automatisch Aufgaben entstehen: immer hoch/kritisch, dazu die aus den Regeln. */
export function autoSeverities(rules: AssignRule[]): SeverityKey[] {
  const s = new Set<SeverityKey>(['high', 'critical']);
  for (const r of rules) for (const x of r.severities) s.add(x);
  return SEVERITY_KEYS.filter((k) => s.has(k));
}

export const RECURRENCES = { monthly: 'Monatlich', quarterly: 'Vierteljährlich', yearly: 'Jährlich' } as const;
export type Recurrence = keyof typeof RECURRENCES;
const RECURRENCE_MONTHS: Record<Recurrence, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/**
 * Termin der Folgeaufgabe: vom bisherigen Termin aus (sonst vom Erledigungsdatum) um den Rhythmus weiter,
 * bis er in der Zukunft liegt – höchstens 24 Schritte, damit sehr alte Aufgaben nicht endlos rechnen.
 */
export function nextRecurrence(r: Recurrence, prevDue: number | null, closedAt: number, now: number): number {
  let t = addMonths(prevDue ?? closedAt, RECURRENCE_MONTHS[r]);
  for (let i = 0; i < 24 && t < now; i++) t = addMonths(t, RECURRENCE_MONTHS[r]);
  return t;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** „2026-10“ → „Oktober 2026“ */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${y}`;
}

/** Berichtsmonat zum Tag `ymd` (YYYY-MM-DD, Zeitzone des Workspaces): immer der Vormonat. */
export function reportPeriod(ymd: string): { period: string; label: string } {
  const [y, m] = ymd.split('-').map(Number);
  const period = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  return { period, label: periodLabel(period) };
}

/** Darf ein Protokolleintrag (zeitlich) noch rückgängig gemacht werden? */
export function canUndo(e: { at: number; undo: unknown; undoneAt: number | null }, now: number): boolean {
  return e.undo != null && e.undoneAt == null && e.at > now - UNDO_DAYS * DAY;
}
