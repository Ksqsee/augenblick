// Datumsangaben aus Sprache und Werkzeugen (Plan v6 A6, C1, E1): streng geprüfte ISO-Daten und deutsche Kurzformen,
// relative Angaben („morgen“, „Freitag“, „in 3 Tagen“, „Ende des Monats“) und Zeiten ohne Zone – immer in der Zeitzone
// des Workspaces. Ungültige Kalenderdaten (30.02.) werden abgelehnt statt still in den Folgemonat zu rutschen.
// Geteilt von MCP-Werkzeugen (worker/mcp-tools.ts) und Regel-Parser (shared/smart.ts). Ohne Abhängigkeiten.

export const DAY_MS = 86_400_000;

/** Fehler mit lesbarem deutschem Text (für Werkzeug-Antworten). */
export class DateInputError extends Error {}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const ymdText = (x: Ymd) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isValidYmd = (y: number, m: number, d: number) => Number.isInteger(y) && y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

/** Tage addieren (Kalenderrechnung, ohne Zeitzone). */
export function addDays(x: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** Monate addieren; der Tag wird am Monatsende gekappt (31.01. + 1 Monat = 28./29.02.). */
export function addMonthsYmd(x: Ymd, n: number): Ymd {
  const idx = x.y * 12 + (x.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { y, m, d: Math.min(x.d, daysInMonth(y, m)) };
}
const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;
/** Wochentag 0 = Sonntag … 6 = Samstag */
const weekday = (x: Ymd) => new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay();
export const dayDiff = (from: Ymd, to: Ymd) => Math.round((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / DAY_MS);

/** Zeitzone gültig? (sonst wird die Systemzone genutzt) */
function zoneOrUndefined(timeZone?: string) {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return undefined;
  }
}

/** Ortszeit eines Zeitpunkts in der Zeitzone (ohne Angabe: Systemzone). */
export function zonedParts(t: number, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrUndefined(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(t);
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}

/** Heutiger Kalendertag in der Zeitzone. */
export const todayIn = (now: number, timeZone?: string): Ymd => {
  const p = zonedParts(now, timeZone);
  return { y: p.y, m: p.m, d: p.d };
};

/** Versatz Ortszeit − UTC (ms) zu einem Zeitpunkt. */
function offsetAt(t: number, timeZone?: string) {
  const p = zonedParts(t, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** Ortszeit (Wanduhr) in der Zeitzone → Zeitpunkt (UTC-ms); berücksichtigt Sommer-/Winterzeit. */
export function zonedTime(x: Ymd, h = 0, mi = 0, s = 0, timeZone?: string): number {
  const guess = Date.UTC(x.y, x.m - 1, x.d, h, mi, s);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return second;
}

// ---------- Zahlwörter (kleine Mengen) ----------
const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, zwölf: 12, zwoelf: 12, vierzehn: 14, fünfzehn: 15, zwanzig: 20, einundzwanzig: 21, dreißig: 30, dreissig: 30, sechzig: 60, neunzig: 90,
};
const NUM_RE = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')})`;
const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : (NUMBER_WORDS[w.toLowerCase()] ?? NaN));

// ---------- Relative Angaben ----------
/** Wortgrenzen auch für Umlaute (\b gilt nur für ASCII). */
const W = (body: string) => new RegExp(`(?<![\\p{L}\\d])(?:${body})(?![\\p{L}\\d])`, 'iu');

interface Rule {
  re: RegExp;
  at: (today: Ymd, m: RegExpMatchArray) => Ymd | null;
}
const endOfWeek = (t: Ymd) => {
  // Arbeitswoche: Freitag; am Wochenende ist das Ende heute
  const wd = weekday(t);
  return wd >= 1 && wd <= 5 ? addDays(t, 5 - wd) : t;
};
const monthEnd = (t: Ymd, plus = 0) => {
  const x = addMonthsYmd({ ...t, d: 1 }, plus);
  return { ...x, d: daysInMonth(x.y, x.m) };
};
const nextWeekday = (t: Ymd, target: number) => {
  const diff = (target - weekday(t) + 7) % 7;
  return addDays(t, diff === 0 ? 7 : diff);
};

/** Reihenfolge zählt: Längeres vor Kürzerem („übermorgen“ vor „morgen“, „übernächste Woche“ vor „nächste Woche“). */
const RULES: Rule[] = [
  { re: W('sofort|heute|umgehend'), at: (t) => t },
  { re: W('übermorgen|uebermorgen'), at: (t) => addDays(t, 2) },
  { re: W('vorgestern'), at: (t) => addDays(t, -2) },
  { re: W('morgen'), at: (t) => addDays(t, 1) },
  { re: W('gestern'), at: (t) => addDays(t, -1) },
  { re: W(`in ${NUM_RE} tag(?:en)?|binnen ${NUM_RE} tag(?:en)?|innerhalb von ${NUM_RE} tag(?:en)?`), at: (t, m) => count(m, (n) => addDays(t, n)) },
  { re: W(`in ${NUM_RE} wochen?|binnen ${NUM_RE} wochen?|innerhalb von ${NUM_RE} wochen?`), at: (t, m) => count(m, (n) => addDays(t, 7 * n)) },
  { re: W(`in ${NUM_RE} monat(?:en)?`), at: (t, m) => count(m, (n) => addMonthsYmd(t, n)) },
  { re: W('übernächste woche|uebernaechste woche'), at: (t) => addDays(t, 14) },
  { re: W('nächste woche|naechste woche|kommende woche|nächster woche|in einer woche'), at: (t) => addDays(t, 7) },
  { re: W('ende (?:der|dieser|diese) woche|diese woche|wochenende'), at: (t) => endOfWeek(t) },
  { re: W('ende (?:des )?nächsten monats|ende nächster monat|ende (?:des )?naechsten monats'), at: (t) => monthEnd(t, 1) },
  { re: W('ende (?:des |dieses |diesen )?monats|monatsende|ende monat'), at: (t) => monthEnd(t) },
  { re: W('anfang (?:des )?nächsten monats|nächsten monat|naechsten monat|nächster monat'), at: (t) => addMonthsYmd({ ...t, d: 1 }, 1) },
  { re: W('(?:nächsten |naechsten |kommenden )?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)'), at: (t, m) => nextWeekday(t, WEEKDAYS.indexOf(m[1].toLowerCase())) },
];
function count(m: RegExpMatchArray, f: (n: number) => Ymd): Ymd | null {
  const raw = m.slice(1).find((x) => x != null);
  const n = raw == null ? NaN : num(raw);
  return Number.isFinite(n) ? f(n) : null;
}

/**
 * Relative Angabe irgendwo im Text (für den Regel-Parser): Kalendertag und Abstand in Tagen ab heute, oder null.
 * „bis Freitag“ an einem Freitag meint den nächsten Freitag (wie im Gespräch üblich).
 */
export function findRelativeDate(text: string, now = Date.now(), timeZone?: string): { day: Ymd; days: number } | null {
  if (!text) return null;
  const today = todayIn(now, timeZone);
  for (const r of RULES) {
    const m = text.match(r.re);
    if (!m) continue;
    const day = r.at(today, m);
    if (day) return { day, days: dayDiff(today, day) };
  }
  return null;
}

/** Ganze Eingabe ist eine relative Angabe (mit optionalem „bis“, „am“, „zum“, „spätestens“)? */
function wholeRelative(text: string, today: Ymd): Ymd | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/^(?:bis (?:zum |zur |spätestens )?|am |zum |spätestens |ab )/, '')
    .replace(/[.!]+$/, '');
  for (const r of RULES) {
    const m = t.match(r.re);
    if (!m || m.index !== 0 || m[0].length !== t.length) continue;
    return r.at(today, m);
  }
  return null;
}

// ---------- Eingaben ----------
export interface DateInputOptions {
  /** Zeitzone des Workspaces (IANA); ohne Angabe: Systemzone */
  timeZone?: string;
  /** Bezugszeitpunkt für „heute“ (Tests) */
  now?: number;
  /** Feldname für Fehlermeldungen, z. B. „due“ */
  field?: string;
  /** Vergangenheit erlauben (Fristen: nein, Filter/Zeiträume: ja) */
  allowPast?: boolean;
  /** Uhrzeit bei reinen Tagesangaben: Mittag (Fristen, wie in der App), Tagesbeginn (von) oder Tagesende (bis) */
  time?: 'noon' | 'start' | 'end';
}

export interface ParsedDate {
  /** Zeitpunkt (UTC-ms) */
  at: number;
  /** Kalendertag in der Zeitzone */
  day: Ymd;
  /** nur ein Tag (ohne Uhrzeit) angegeben */
  dateOnly: boolean;
  /** relativ angegeben („morgen“) */
  relative: boolean;
}

const EXAMPLES = '„2026-11-30“, „30.11.2026“, „2026-11-30T14:00“, „heute“, „morgen“, „übermorgen“, „Freitag“, „nächste Woche“, „in 3 Tagen“ oder „Ende des Monats“';

function invalidDay(field: string, raw: string, y: number, m: number, d: number): never {
  if (m < 1 || m > 12) throw new DateInputError(`${field}: „${raw}“ ist kein gültiges Datum – Monat ${m} gibt es nicht.`);
  throw new DateInputError(
    d < 1
      ? `${field}: „${raw}“ ist kein gültiges Datum – Tag ${d} gibt es nicht.`
      : `${field}: „${raw}“ ist kein gültiges Datum – der ${MONTHS[m - 1]} ${y} hat nur ${daysInMonth(y, m)} Tage. Bitte das Datum prüfen.`,
  );
}

/**
 * Datum aus Werkzeug-Eingabe: ISO (streng), deutsche Kurzform oder relative Angabe – in der Zeitzone des Workspaces.
 * Wirft DateInputError mit Hinweis, was geht. Zahlen gelten als Zeitpunkt in ms.
 */
export function parseDateInput(v: unknown, o: DateInputOptions = {}): ParsedDate {
  const field = o.field ?? 'Datum';
  const now = o.now ?? Date.now();
  const tz = zoneOrUndefined(o.timeZone);
  const today = todayIn(now, tz);
  const atDay = (day: Ymd) =>
    o.time === 'start' ? zonedTime(day, 0, 0, 0, tz) : o.time === 'end' ? zonedTime(addDays(day, 1), 0, 0, 0, tz) - 1 : zonedTime(day, 12, 0, 0, tz);
  const finish = (p: ParsedDate): ParsedDate => {
    if (!o.allowPast && cmp(p.day, today) < 0)
      throw new DateInputError(
        `${field}: ${pad(p.day.d)}.${pad(p.day.m)}.${p.day.y} liegt in der Vergangenheit (heute ist der ${pad(today.d)}.${pad(today.m)}.${today.y}). Bitte ein heutiges oder späteres Datum nennen – oder ausdrücklich allowPast: true setzen.`,
      );
    return p;
  };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new DateInputError(`${field}: keine gültige Zahl.`);
    const p = zonedParts(v, tz);
    return finish({ at: v, day: { y: p.y, m: p.m, d: p.d }, dateOnly: false, relative: false });
  }
  const raw = String(v ?? '').trim();
  if (!raw) throw new DateInputError(`${field} fehlt. Möglich: ${EXAMPLES}.`);

  // ISO: 2026-11-30, 2026-11-30T14:00, 2026-11-30 14:00:00, optional Z oder ±hh:mm
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(raw);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isValidYmd(y, m, d)) invalidDay(field, raw, y, m, d);
    const day = { y, m, d };
    if (iso[4] == null) return finish({ at: atDay(day), day, dateOnly: true, relative: false });
    const [h, mi, s] = [Number(iso[4]), Number(iso[5]), Number(iso[6] ?? 0)];
    if (h > 23 || mi > 59 || s > 59) throw new DateInputError(`${field}: „${raw}“ – ungültige Uhrzeit.`);
    let at: number;
    if (iso[7]) {
      const z = iso[7].toUpperCase();
      const off = z === 'Z' ? 0 : (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(-2))) * 60_000;
      at = Date.UTC(y, m - 1, d, h, mi, s) - off;
    } else at = zonedTime(day, h, mi, s, tz); // ohne Zone: Ortszeit des Workspaces (E1)
    const p = zonedParts(at, tz);
    return finish({ at, day: { y: p.y, m: p.m, d: p.d }, dateOnly: false, relative: false });
  }
  // Deutsch: 30.11.2026, 30.11.26, 30.11. (dieses Jahr), optional „14:00“ bzw. „14 Uhr“
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?(?:,?\s+(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?)?$/i.exec(raw);
  if (de) {
    const y = de[3] == null ? today.y : de[3].length === 2 ? 2000 + Number(de[3]) : Number(de[3]);
    const [m, d] = [Number(de[2]), Number(de[1])];
    if (!isValidYmd(y, m, d)) invalidDay(field, raw, y, m, d);
    const day = { y, m, d };
    if (de[4] == null) return finish({ at: atDay(day), day, dateOnly: true, relative: false });
    const [h, mi] = [Number(de[4]), Number(de[5] ?? 0)];
    if (h > 23 || mi > 59) throw new DateInputError(`${field}: „${raw}“ – ungültige Uhrzeit.`);
    return finish({ at: zonedTime(day, h, mi, 0, tz), day, dateOnly: false, relative: false });
  }
  const rel = wholeRelative(raw, today);
  if (rel) return finish({ at: atDay(rel), day: rel, dateOnly: true, relative: true });
  throw new DateInputError(`${field}: „${raw}“ verstehe ich nicht als Datum. Möglich: ${EXAMPLES}.`);
}

/** Zeitpunkt als „JJJJ-MM-TT“ in der Zeitzone. */
export function dayIn(t: number, timeZone?: string) {
  const p = zonedParts(t, timeZone);
  return ymdText(p);
}
/** Zeitpunkt als „JJJJ-MM-TT HH:MM“ in der Zeitzone. */
export function dayTimeIn(t: number, timeZone?: string) {
  const p = zonedParts(t, timeZone);
  return `${ymdText(p)} ${pad(p.h)}:${pad(p.mi)}`;
}

/** Grenzen eines Kalendermonats „JJJJ-MM“ in der Zeitzone: [erster Tag 00:00, letzter Tag 23:59:59.999]. */
export function monthRange(period: string, timeZone?: string): { from: number; to: number; first: Ymd; last: Ymd } {
  const m = /^(\d{4})-(\d{1,2})$/.exec(period.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new DateInputError('month bitte als „JJJJ-MM“, z. B. „2026-10“.');
  const first = { y: Number(m[1]), m: Number(m[2]), d: 1 };
  const last = { ...first, d: daysInMonth(first.y, first.m) };
  return { from: zonedTime(first, 0, 0, 0, timeZone), to: zonedTime(addDays(last, 1), 0, 0, 0, timeZone) - 1, first, last };
}
