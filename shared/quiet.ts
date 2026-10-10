/** „Nicht stören“: Zeitraum ohne Push (In-App-Benachrichtigungen kommen weiterhin an). */
export interface QuietHours {
  enabled: boolean;
  /** Beginn „HH:MM“ (lokale Zeit) */
  from: string;
  /** Ende „HH:MM“; kleiner als Beginn = über Mitternacht */
  to: string;
  /** Samstag und Sonntag ganztägig ruhig */
  weekends: boolean;
  timeZone: string;
}

export const DEFAULT_QUIET: QuietHours = { enabled: false, from: '22:00', to: '07:00', weekends: false, timeZone: 'Europe/Berlin' };

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2])) : 0;
};

/** Ortszeit (Wochentag 0=So, Minuten seit Mitternacht) in der Zeitzone. */
function localTime(t: number, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  }
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

export function inQuietHours(q: Partial<QuietHours> | null | undefined, t: number): boolean {
  if (!q?.enabled) return false;
  const { day, min } = localTime(t, q.timeZone || DEFAULT_QUIET.timeZone);
  if (q.weekends && (day === 0 || day === 6)) return true;
  const from = minutes(q.from ?? DEFAULT_QUIET.from);
  const to = minutes(q.to ?? DEFAULT_QUIET.to);
  if (from === to) return false;
  return from < to ? min >= from && min < to : min >= from || min < to;
}
