// „Jetzt“: eine Warteschlange für alles, was eine Entscheidung oder Handlung der angemeldeten Person braucht.
// Reine Rangfolge (ohne Datenbank), geteilt von Worker (GET /now) und Tests. Quellen sammelt worker/now.ts.
import { DAY } from './logic';

export type NowKind =
  | 'sign'
  | 'never'
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

/**
 * Grundwert je Art und Ton (höher = dringlicher). Unterschriften stehen immer oben: ohne sie gibt es keinen Nachweis.
 * Direkt danach „noch nie geprüft“ (v5): ohne erste Prüfung gibt es weder Frist noch Nachweis – im neuen Konto ist das
 * der einzige sinnvolle nächste Schritt. Der Abstand zu den Unterschriften ist größer als jeder Altersaufschlag (30).
 */
const BASE: Record<NowKind, Partial<Record<NowItem['tone'], number>> & { default: number }> = {
  sign: { default: 200 },
  never: { default: 160 },
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

/** Zeitzonen-Versatz (Ortszeit − UTC, ms) zu einem Zeitpunkt. */
function tzOffset(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(t);
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}

/** Mitternacht am Ersten des Monats (1–12, darf überlaufen) in der Zeitzone, als UTC-Zeitpunkt. */
function monthStart(y: number, m: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, 1);
  return guess - tzOffset(guess - tzOffset(guess, timeZone), timeZone);
}

/** Grenzen eines Berichtsmonats „JJJJ-MM“ in der Zeitzone des Workspaces: [von, bis). */
export function monthBounds(period: string, timeZone: string): [number, number] {
  const [y, m] = period.split('-').map(Number);
  return [monthStart(y, m, timeZone), monthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, timeZone)];
}

/** Zeile „n Elemente noch nie geprüft“ je Gebäude (ersetzt dort die Rundgang-Zeile, damit nichts doppelt steht). */
export function neverItem(g: { buildingId: string; buildingName: string; propertyName: string; never: number; overdue: number; due: number; earliest: number | null }): NowItem {
  const more = [g.overdue && `${g.overdue} überfällig`, g.due && `${g.due} bald fällig`].filter(Boolean).join(', ');
  return {
    id: `never-${g.buildingId}`,
    kind: 'never',
    tone: g.overdue ? 'bad' : 'info',
    title: `${g.never === 1 ? 'Ein Element' : `${g.never} Elemente`} noch nie geprüft`,
    text: `${g.buildingName} · ${g.propertyName}${more ? ` – außerdem ${more}` : ''}`,
    action: { verb: 'start', label: 'Rundgang starten', link: `/rundgang/${g.buildingId}` },
    count: g.never + g.overdue + g.due,
    at: g.earliest,
  };
}
