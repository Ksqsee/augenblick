// Synchroner Zugriff auf Kategorien (eingebaut + eigene Typen) für Labels, Icons usw.
import { CATEGORIES, type CategoryDef, isBuiltin, schedulesOf } from '../shared/catalog';
import type { CategoryInfo } from './api';

let registry = new Map<string, CategoryInfo | CategoryDef>(Object.entries(CATEGORIES));

export function registerCategories(list: CategoryInfo[]) {
  registry = new Map(list.map((c) => [c.key, c]));
}

export function getCategory(key: string): CategoryDef {
  return (
    registry.get(key) ??
    (isBuiltin(key)
      ? CATEGORIES[key]
      : { key, label: 'Unbekannte Art', plural: 'Unbekannt', prefix: '?', norm: '', intervalMonths: 12, checkpoints: [], attributes: [], maintenance: [], schedules: [] })
  );
}

export const allCategories = () => [...registry.values()];

export interface ScheduleInfo {
  key: string;
  label: string;
  intervalMonths: number;
  optional: boolean;
  checkpoints: { id: string; label: string; hint?: string }[];
}

/** Prüfarten einer Kategorie inkl. Vorlagen-Anpassungen (falls geladen). */
export function schedulesFor(key: string): ScheduleInfo[] {
  const c = getCategory(key) as CategoryDef & { schedulesEffective?: ScheduleInfo[] };
  if (c.schedulesEffective) return c.schedulesEffective;
  return schedulesOf(c).map((s) => ({ ...s, checkpoints: s.checkpoints ?? [] }));
}

export const scheduleLabel = (category: string, key: string) => schedulesFor(category).find((s) => s.key === key)?.label ?? 'Prüfung';
