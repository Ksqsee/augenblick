// Ampel je Objekt (Plan v8 1): höchstens drei kleine Angaben – nächste Fälligkeit bzw. „überfällig seit“, offene Mängel
// (kritische hervorgehoben), wartende Unterschriften – und die Rangfolge „dringendstes zuerst“ für die Objektliste.
// Geteilt von Objektliste (Desktop-Leiste, Handy-Startseite) und Tests. Ohne Abhängigkeiten außer shared/logic.
import { DAY, SOON_WINDOW_DAYS } from './logic';

/** Ampel-Zahlen, wie GET /properties sie je Objekt liefert. */
export interface AmpelCounts {
  name: string;
  /** früheste nächste Fälligkeit (ms) eines Elements im Objekt – liegt sie in der Vergangenheit, ist das „überfällig seit“ */
  nextDue: number | null;
  /** Anzahl überfälliger Elemente */
  overdue: number | null;
  openDefects: number;
  criticalDefects: number;
  /** eigene Prüfungen, die zur Unterschrift bereitliegen */
  pendingSignatures: number;
}

export type AmpelFilter = 'alle' | 'faellig' | 'maengel' | 'unterschrift';
export const AMPEL_FILTERS: { key: AmpelFilter; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'faellig', label: 'Fällig' },
  { key: 'maengel', label: 'Mit Mängeln' },
  { key: 'unterschrift', label: 'Unterschrift offen' },
];

/** Fällig = überfällig oder innerhalb des „bald fällig“-Fensters (30 Tage). */
export const isDue = (p: AmpelCounts, now: number) => (p.overdue ?? 0) > 0 || (p.nextDue != null && p.nextDue <= now + SOON_WINDOW_DAYS * DAY);

export function matchesAmpel(p: AmpelCounts, f: AmpelFilter, now: number) {
  if (f === 'faellig') return isDue(p, now);
  if (f === 'maengel') return p.openDefects > 0;
  if (f === 'unterschrift') return p.pendingSignatures > 0;
  return true;
}

/**
 * Stufe der Dringlichkeit (kleiner = dringender):
 * 0 überfällig · 1 kritischer Mangel · 2 bald fällig · 3 Unterschrift offen · 4 offene Mängel · 5 später fällig · 6 nichts.
 */
export function ampelTier(p: AmpelCounts, now: number) {
  if ((p.overdue ?? 0) > 0) return 0;
  if (p.criticalDefects > 0) return 1;
  if (p.nextDue != null && p.nextDue <= now + SOON_WINDOW_DAYS * DAY) return 2;
  if (p.pendingSignatures > 0) return 3;
  if (p.openDefects > 0) return 4;
  if (p.nextDue != null) return 5;
  return 6;
}

/** Vergleich „dringendstes zuerst“: Stufe, dann früheste Fälligkeit, dann mehr kritische/offene Mängel, dann Name. */
export function compareAmpel(a: AmpelCounts, b: AmpelCounts, now: number) {
  const t = ampelTier(a, now) - ampelTier(b, now);
  if (t) return t;
  const da = a.nextDue ?? Number.MAX_SAFE_INTEGER;
  const db = b.nextDue ?? Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  if (a.criticalDefects !== b.criticalDefects) return b.criticalDefects - a.criticalDefects;
  if (a.openDefects !== b.openDefects) return b.openDefects - a.openDefects;
  if (a.pendingSignatures !== b.pendingSignatures) return b.pendingSignatures - a.pendingSignatures;
  return a.name.localeCompare(b.name, 'de');
}

export const sortByUrgency = <T extends AmpelCounts>(list: readonly T[], now: number) => [...list].sort((a, b) => compareAmpel(a, b, now));

export type AmpelTone = 'bad' | 'warn' | 'muted';
export interface AmpelNote {
  kind: 'due' | 'defects' | 'signatures';
  tone: AmpelTone;
  text: string;
}

const fmtDay = (ts: number, withYear: boolean, timeZone?: string) =>
  new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', ...(withYear ? { year: '2-digit' } : {}), ...(timeZone ? { timeZone } : {}) }).format(ts);

/** „seit 3 Tagen“, „seit 2 Wochen“, „seit 4 Monaten“ – kurz, für die Zeile. */
export function sinceText(from: number, now: number) {
  const days = Math.max(1, Math.floor((now - from) / DAY));
  if (days < 14) return `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
  if (days < 60) return `seit ${Math.floor(days / 7)} Wochen`;
  const months = Math.floor(days / 30);
  if (months < 24) return `seit ${months} Monaten`;
  return `seit ${Math.floor(days / 365)} Jahren`;
}

/**
 * Die Angaben einer Zeile (nur, was ungleich null ist), in fester Reihenfolge Fälligkeit · Mängel · Unterschriften.
 * Zinnober („bad“) nur für Überfälliges und kritische Mängel; Fälligkeit im 30-Tage-Fenster „warn“, sonst grau.
 */
export function ampelNotes(p: AmpelCounts, now: number, timeZone?: string): AmpelNote[] {
  const out: AmpelNote[] = [];
  const overdue = p.overdue ?? 0;
  if (overdue > 0 && p.nextDue != null) out.push({ kind: 'due', tone: 'bad', text: `überfällig ${sinceText(p.nextDue, now)}` });
  else if (p.nextDue != null) {
    const soon = p.nextDue <= now + SOON_WINDOW_DAYS * DAY;
    out.push({ kind: 'due', tone: soon ? 'warn' : 'muted', text: `fällig ${fmtDay(p.nextDue, p.nextDue - now > 300 * DAY, timeZone)}` });
  }
  if (p.openDefects > 0) {
    const text = `${p.openDefects} ${p.openDefects === 1 ? 'Mangel' : 'Mängel'}`;
    out.push({ kind: 'defects', tone: p.criticalDefects > 0 ? 'bad' : 'muted', text: p.criticalDefects > 0 ? `${text}, ${p.criticalDefects} kritisch` : text });
  }
  if (p.pendingSignatures > 0) out.push({ kind: 'signatures', tone: 'muted', text: `${p.pendingSignatures} zu unterschreiben` });
  return out;
}

/** Ort aus der Adresse: letzte Zeile bzw. letzter Teil nach dem Komma, Postleitzahl weg („10115 Berlin“ → „Berlin“). */
export function placeOf(address: string) {
  const parts = address
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = parts.at(-1) ?? '';
  return last.replace(/^(D-)?\d{4,5}\s+/, '');
}
