// „Jetzt“: eine Warteschlange für alles, was eine Entscheidung oder Handlung der angemeldeten Person braucht.
// Reine Rangfolge (ohne Datenbank), geteilt von Worker (GET /now) und Tests. Quellen sammelt worker/now.ts.
import { DAY } from './logic';

export type NowKind =
  | 'sign'
  | 'offline_failures'
  | 'defects_without_task'
  | 'overdue_tasks'
  | 'round'
  | 'walkthrough_due'
  | 'automation'
  | 'stale_drafts'
  | 'interval';

/** Genau eine Aktion je Zeile: Unterschreiben · Starten · Ausführen · Anlegen · Öffnen · Fortsetzen · Übernehmen */
export type NowVerb = 'sign' | 'start' | 'run' | 'create' | 'open' | 'continue' | 'apply';
export const NOW_VERBS: Record<NowVerb, string> = {
  sign: 'Unterschreiben',
  start: 'Starten',
  run: 'Ausführen',
  create: 'Anlegen',
  open: 'Öffnen',
  continue: 'Fortsetzen',
  apply: 'Übernehmen',
};

export interface NowAction {
  verb: NowVerb;
  /** Beschriftung des Knopfs (1–3 Wörter) */
  label: string;
  /** Ziel in der App – oder … */
  link?: string;
  /** … ein Endpunkt, den die App mit POST aufruft (nie beides) */
  endpoint?: string;
  body?: unknown;
}

export interface NowItem {
  id: string;
  kind: NowKind;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  action: NowAction;
  /** Anzahl der Dinge hinter der Zeile */
  count: number;
  /** maßgebliches Datum (Fälligkeit/Erfassung); liegt es zurück, steigt die Dringlichkeit mit dem Alter */
  at?: number | null;
  /** bei kind 'automation': Schritt des Autopiloten */
  automation?: string;
}

export const NOW_LIMIT = 12;

/** Grundwert je Art und Ton (höher = dringlicher). Unterschriften stehen immer oben: ohne sie gibt es keinen Nachweis. */
const BASE: Record<NowKind, Partial<Record<NowItem['tone'], number>> & { default: number }> = {
  sign: { default: 200 },
  offline_failures: { default: 120 },
  defects_without_task: { bad: 110, default: 70 },
  overdue_tasks: { bad: 90, default: 60 },
  round: { bad: 80, default: 45 },
  walkthrough_due: { bad: 55, default: 35 },
  automation: { warn: 50, default: 40 },
  stale_drafts: { default: 38 },
  interval: { warn: 32, default: 25 },
};

/** Dringlichkeit einer Zeile: Grundwert + Alter in Tagen (halbiert, höchstens 30), nur wenn `at` zurückliegt. */
export function nowUrgency(item: Pick<NowItem, 'kind' | 'tone' | 'at'>, now: number): number {
  const b = BASE[item.kind];
  const base = b[item.tone] ?? b.default;
  const late = item.at != null && item.at < now ? Math.min(Math.floor((now - item.at) / DAY), 60) / 2 : 0;
  return base + late;
}

/** Hat die Zeile genau eine ausführbare Aktion (Link oder Endpunkt, nicht beides)? */
export const hasOneAction = (a: NowAction | undefined) => !!a && !!a.label && (a.link ? !a.endpoint : !!a.endpoint);

/** Sortiert nach Dringlichkeit (bei Gleichstand mehr Dinge zuerst, dann stabil nach ID) und schneidet nach `limit` ab. */
export function rankNow<T extends NowItem>(items: T[], now: number, limit = NOW_LIMIT): { items: (T & { urgency: number })[]; more: number } {
  const ranked = items
    .filter((i) => hasOneAction(i.action))
    .map((i) => ({ ...i, urgency: nowUrgency(i, now) }))
    .sort((a, b) => b.urgency - a.urgency || b.count - a.count || a.id.localeCompare(b.id));
  return { items: ranked.slice(0, limit), more: Math.max(0, ranked.length - limit) };
}
