// Fachlogik für Aufgaben und den „Handlungsbedarf“: Gruppierung nach Fälligkeit und Dringlichkeit.
import { DAY } from './logic';

export const TASK_KINDS = { inspection: 'Prüfauftrag', defect: 'Mängelbehebung', other: 'Sonstiges' } as const;
export type TaskKind = keyof typeof TASK_KINDS;

/** Typ einer Aufgabe, wenn nichts angegeben ist: mit Mangel → Mängelbehebung, sonst Sonstiges. */
export function defaultTaskKind(t: { defectId?: string | null }): TaskKind {
  return t.defectId ? 'defect' : 'other';
}

/** Passt der Typ zu den Verknüpfungen? Liefert eine Fehlermeldung oder null. */
export function taskKindError(kind: TaskKind, t: { assetId?: string | null; defectId?: string | null; buildingId?: string | null }): string | null {
  // Prüfauftrag: ein Element oder ein ganzes Gebäude (Rundgang)
  if (kind === 'inspection' && !t.assetId && !t.buildingId) return 'Ein Prüfauftrag braucht ein Element';
  if (kind === 'defect' && !t.defectId) return 'Eine Mängelbehebung braucht einen verknüpften Mangel';
  return null;
}

export const DUE_GROUPS = { overdue: 'Überfällig', today: 'Fällig heute', week: 'Diese Woche', later: 'Später', none: 'Ohne Datum' } as const;
export type DueGroup = keyof typeof DUE_GROUPS;

/** Tagesbeginn (lokale Zeit) */
function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Fälligkeitsgruppe für eine offene Aufgabe (lokale Zeit): vor heute = überfällig, heute, bis Sonntag dieser Woche,
 * später oder ohne Datum. Fällt „heute“ auf einen Sonntag, ist „Diese Woche“ leer.
 */
export function dueGroup(dueAt: number | null | undefined, now: number): DueGroup {
  if (dueAt == null) return 'none';
  const today = startOfDay(now);
  if (dueAt < today) return 'overdue';
  if (dueAt < today + DAY) return 'today';
  const weekday = new Date(now).getDay(); // 0 = Sonntag
  const daysToSunday = (7 - weekday) % 7;
  if (dueAt < today + (daysToSunday + 1) * DAY) return 'week';
  return 'later';
}

/** Aufgaben in Gruppen in fester Reihenfolge (leere Gruppen entfallen). */
export function groupByDue<T extends { dueAt: number | null }>(rows: T[], now: number): { key: DueGroup; label: string; items: T[] }[] {
  const out = new Map<DueGroup, T[]>();
  for (const k of Object.keys(DUE_GROUPS) as DueGroup[]) out.set(k, []);
  for (const r of rows) out.get(dueGroup(r.dueAt, now))!.push(r);
  return [...out.entries()].filter(([, items]) => items.length).map(([key, items]) => ({ key, label: DUE_GROUPS[key], items }));
}

/** Eintrag im „Handlungsbedarf“. */
export type ActionKind = 'defect' | 'task' | 'asset';
export interface ActionInput {
  kind: ActionKind;
  /** Mangel: Schwere; Aufgabe: Priorität */
  level?: string | null;
  /** Mangel: erfasst am; Aufgabe/Element: fällig am */
  at: number;
}

/**
 * Dringlichkeit (höher = zuerst): kritische Mängel ohne Aufgabe vor überfälligen Aufgaben hoher Priorität,
 * dann hohe Mängel, übrige überfällige Aufgaben und überfällige Elemente. Innerhalb wächst der Wert mit dem Alter
 * (gedeckelt, damit lange Liegengebliebenes nicht alles Neue verdrängt).
 */
export function urgency(item: ActionInput, now: number): number {
  const days = Math.max(0, Math.floor((now - item.at) / DAY));
  const age = Math.min(days, 60) / 2; // 0 … 30
  if (item.kind === 'defect') return (item.level === 'critical' ? 100 : 60) + age;
  if (item.kind === 'task') return (item.level === 'high' ? 80 : item.level === 'medium' ? 45 : 35) + age;
  return 30 + age;
}

export function sortByUrgency<T extends ActionInput>(items: T[], now: number): (T & { urgency: number })[] {
  return items.map((i) => ({ ...i, urgency: urgency(i, now) })).sort((a, b) => b.urgency - a.urgency || a.at - b.at);
}
