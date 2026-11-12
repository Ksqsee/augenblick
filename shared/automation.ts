// Autopilot: ein Kreislauf aus sechs Schritten (Stufe je Schritt, Hauptschalter) und reine Fachlogik (ohne Datenbank),
// geteilt von Worker und Oberfläche. Wiederholung ist eine Eigenschaft der Aufgabe, kein Schritt.
import { addMonths, DAY } from './logic';

export const AUTOMATION_MODES = { off: 'Aus', suggest: 'Vorschlagen', auto: 'Automatisch' } as const;
export type AutomationMode = keyof typeof AUTOMATION_MODES;

/** Die sechs Schritte des Kreislaufs (gespeicherte Schlüssel bleiben die der früheren Regeln). */
export type AutomationKey = 'plan_week' | 'assign_defect_tasks' | 'escalate_sla' | 'verify_repairs' | 'adapt_intervals' | 'monthly_report';
/** Frühere Regeln, die in einem Schritt aufgegangen sind: nur noch als Schlüssel im Protokoll. */
export type LegacyKey = 'close_stale' | 'recurring_tasks';
export type LogKey = AutomationKey | LegacyKey;

export interface AutomationDef {
  key: AutomationKey;
  /** Nummer im Kreislauf (1–6) */
  step: number;
  /** kurzer Name des Schritts: Planen, Zuweisen … */
  title: string;
  /** ein Satz */
  description: string;
  defaultMode: AutomationMode;
  /** Nur Inhaber/Admins sehen Vorschläge und dürfen sie ausführen */
  adminOnly?: boolean;
}

/** Der Kreislauf in Reihenfolge. */
export const AUTOMATIONS: readonly AutomationDef[] = [
  {
    key: 'plan_week',
    step: 1,
    title: 'Planen',
    description: 'Montags bekommt jedes Gebäude mit Fälligkeiten in den nächsten 14 Tagen einen Rundgang-Auftrag – an die Person, die dort zuletzt geprüft hat.',
    defaultMode: 'auto',
  },
  {
    key: 'assign_defect_tasks',
    step: 2,
    title: 'Zuweisen',
    description: 'Ein schwerer Mangel aus Prüfung, Begehung oder Erfassen wird sofort zur Aufgabe – nach den Zuweisungsregeln an eine Person oder einen Partner, mit Link.',
    defaultMode: 'auto',
  },
  {
    key: 'escalate_sla',
    step: 3,
    title: 'Nachhalten',
    description: 'Ist eine Frist überschritten, steigt die Priorität auf „Hoch“ und die Admins erfahren es; bleibt ein Mangel nach der Behebung liegen, folgt eine Erinnerung.',
    defaultMode: 'auto',
  },
  {
    key: 'verify_repairs',
    step: 4,
    title: 'Nachprüfen',
    description: 'Ist eine Mängelbehebung erledigt, bekommt die Person, die den Mangel festgestellt hat, einen Nachprüf-Auftrag. Ist der Punkt in Ordnung, gilt der Mangel als behoben.',
    defaultMode: 'auto',
  },
  {
    key: 'adapt_intervals',
    step: 5,
    title: 'Lernen',
    description: 'Nach zwei Prüfungen in Folge mit Mängeln wird das Intervall kürzer, nach vier mängelfreien gilt wieder der Standard – nie länger als der Standard.',
    defaultMode: 'suggest',
    adminOnly: true,
  },
  {
    key: 'monthly_report',
    step: 6,
    title: 'Nachweisen',
    description: 'Zum Monatsanfang entsteht je Objekt der Objektbericht im Archiv; der Kunden-Link zeigt den Stand. Die PDFs erzeugt der Browser einer Admin-Person.',
    defaultMode: 'suggest',
    adminOnly: true,
  },
];

export const AUTOMATION_KEYS = AUTOMATIONS.map((a) => a.key) as [AutomationKey, ...AutomationKey[]];
export const automationDef = (key: string): AutomationDef | undefined => AUTOMATIONS.find((a) => a.key === key);

/** Frühere Schlüssel → Schritt, in dem sie aufgegangen sind (null = kein Schritt mehr, z. B. Wiederholung). */
export const LEGACY_KEYS: Record<LegacyKey, AutomationKey | null> = { close_stale: 'escalate_sla', recurring_tasks: null };

/** Schritt eines Protokolleintrags (auch für frühere Schlüssel). */
export function stepOf(key: string): AutomationDef | undefined {
  if (key in LEGACY_KEYS) {
    const k = LEGACY_KEYS[key as LegacyKey];
    return k ? automationDef(k) : undefined;
  }
  return automationDef(key);
}

/** Bezeichnung eines Protokolleintrags: Name des Schritts, Wiederholungen als „Wiederholung“. */
export const logTitle = (key: string) => stepOf(key)?.title ?? (key === 'recurring_tasks' ? 'Wiederholung' : key);

/** Gültige Schlüssel im Protokoll-Filter. */
export const isLogKey = (key: string): key is LogKey => !!automationDef(key) || key in LEGACY_KEYS;

/** Zähler je Schritt für die Wochenzusammenfassung. */
export type WeekCounts = Partial<Record<AutomationKey, number>>;

/**
 * Text der Montagsmeldung „Autopilot: letzte Woche“: Anzahl der Protokolleinträge je Schritt in Kreislauf-Reihenfolge,
 * z. B. „Planen 3 · Zuweisen 5 · Nachprüfen 2“. null, wenn nichts geschah.
 */
export function weekSummary(c: WeekCounts): string | null {
  const parts = AUTOMATIONS.filter((d) => (c[d.key] ?? 0) > 0).map((d) => `${d.title} ${c[d.key]}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Rückgängig nur innerhalb dieser Frist. */
export const UNDO_DAYS = 7;
/** plan_week: Vorschau in Tagen */
export const PLAN_HORIZON_DAYS = 14;
/** Nachhalten: Erinnerung, wenn ein Mangel so viele Tage nach erledigter Behebung noch offen ist */
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
