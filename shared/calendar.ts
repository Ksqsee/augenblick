// Kalender in der App (Plan v8 1, GET /calendar/events): Einträge aus fälligen Prüfungen (je Objekt und Tag gebündelt),
// Rundgängen/Begehungen, Fristen von Aufgaben und Mängeln, ablaufenden Zulassungen und Befähigungsnachweisen.
// Die Bündelung und die Tages-Schlüssel (Zeitzone des Workspaces) liegen hier, damit Worker und Tests dieselbe Regel nutzen.

export type CalendarKind = 'due' | 'round' | 'task' | 'defect' | 'approval' | 'credential';

export interface CalendarEvent {
  /** Tag in der Zeitzone des Workspaces, JJJJ-MM-TT */
  date: string;
  kind: CalendarKind;
  title: string;
  /** gebündelte Anzahl (fällige Prüfungen) */
  count?: number;
  propertyId?: string;
  propertyName?: string;
  /** App-Adresse, die der Eintrag öffnet (Objekt im passenden Reiter) */
  link: string;
  /** vor heute fällig und noch offen – steht im Block „Überfällig“ */
  overdue?: boolean;
}

export const CALENDAR_KINDS: Record<CalendarKind, string> = {
  due: 'Fällige Prüfungen',
  round: 'Rundgänge und Begehungen',
  task: 'Aufgaben',
  defect: 'Mängel',
  approval: 'Zulassungen',
  credential: 'Nachweise',
};

const KIND_ORDER: CalendarKind[] = ['due', 'round', 'defect', 'task', 'approval', 'credential'];

/** JJJJ-MM-TT eines Zeitpunkts in der Zeitzone. */
export function dayKey(ts: number, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}

export const isDayKey = (s: string | undefined | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Tage zwischen zwei Schlüsseln (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Schlüssel + n Tage. */
export function addDays(key: string, n: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Fällige Elemente, wie die Datenbank sie liefert (gleiche Fälligkeit im Objekt schon zusammengefasst). */
export interface DueRow {
  propertyId: string;
  propertyName: string;
  due: number;
  n: number;
  /** davon Türen (Elementart fire_door) – für „72 Türen fällig“ */
  doors: number;
}

const what = (n: number, doors: number) => (doors === n ? `${n} ${n === 1 ? 'Tür' : 'Türen'}` : `${n} ${n === 1 ? 'Prüfung' : 'Prüfungen'}`);

/**
 * Fällige Prüfungen je Objekt und Tag bündeln („Hotel X: 72 Türen fällig“). Überfälliges (vor heute) wird je Objekt zu
 * einem Eintrag am frühesten Fälligkeitstag zusammengefasst – es steht ohnehin oben im Block „Überfällig“.
 */
export function bundleDue(rows: readonly DueRow[], timeZone: string, now: number): CalendarEvent[] {
  const today = dayKey(now, timeZone);
  const groups = new Map<string, { date: string; propertyId: string; propertyName: string; n: number; doors: number; overdue: boolean }>();
  for (const r of rows) {
    const day = dayKey(r.due, timeZone);
    const overdue = day < today;
    const k = overdue ? `${r.propertyId}|überfällig` : `${r.propertyId}|${day}`;
    const g = groups.get(k) ?? { date: day, propertyId: r.propertyId, propertyName: r.propertyName, n: 0, doors: 0, overdue };
    if (day < g.date) g.date = day;
    g.n += r.n;
    g.doors += r.doors;
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    date: g.date,
    kind: 'due' as const,
    title: `${g.propertyName}: ${what(g.n, g.doors)} ${g.overdue ? 'überfällig' : 'fällig'}`,
    count: g.n,
    propertyId: g.propertyId,
    propertyName: g.propertyName,
    link: `/objekte/${g.propertyId}?tab=begehung`,
    ...(g.overdue ? { overdue: true } : {}),
  }));
}

/** Reihenfolge: Tag, dann Art (Prüfungen vor Rundgängen, Mängeln, Aufgaben …), dann Objekt, dann Titel. */
export function sortEvents<T extends CalendarEvent>(list: readonly T[]) {
  return [...list].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.propertyName ?? '').localeCompare(b.propertyName ?? '', 'de') ||
      a.title.localeCompare(b.title, 'de'),
  );
}

/** Einträge je Tag (für Monat und Liste). */
export function byDay<T extends CalendarEvent>(list: readonly T[]) {
  const m = new Map<string, T[]>();
  for (const e of sortEvents(list)) m.set(e.date, [...(m.get(e.date) ?? []), e]);
  return m;
}

/** Wochen eines Monats (Montag zuerst) als Tages-Schlüssel, inkl. der angrenzenden Tage – 4 bis 6 Zeilen. */
export function monthGrid(month: string) {
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Mo = 0
  const start = addDays(first, -dow);
  const next = addDays(`${month}-28`, 4).slice(0, 7);
  const weeks: string[][] = [];
  for (let d = start; weeks.length < 6; ) {
    const w = Array.from({ length: 7 }, (_, i) => addDays(d, i));
    weeks.push(w);
    d = addDays(d, 7);
    if (d.slice(0, 7) >= next) break;
  }
  return weeks;
}

/** Monat ± n als JJJJ-MM. */
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
