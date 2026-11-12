// Regelbasierte Auswertung von Diktaten und Vorschläge – läuft ohne KI (Fallback und Offline),
// die KI-Variante im Worker liefert dasselbe Format.
import type { Severity } from './catalog';

export type CaptureKind = 'defect' | 'task' | 'note';

export interface CaptureItem {
  kind: CaptureKind;
  /** kurze Beschreibung (Titel) */
  title: string;
  /** ergänzende Details */
  note: string;
  severity: Severity;
  /** empfohlene Maßnahme */
  measure: string;
  /** erkannter Element-Code, z. B. FL-7K2M */
  assetCode: string | null;
  /** zugeordneter Prüfpunkt (nur mit Kontext) */
  checkpointId: string | null;
  /** Frist in Tagen ab heute (nur Aufgaben) */
  dueInDays: number | null;
}

export interface CaptureContext {
  checkpoints?: { id: string; label: string }[];
}

const SEVERITY_RULES: [RegExp, Severity][] = [
  [/\b(kritisch|lebensgefahr|gefährlich|gefahr im verzug|sofort|akut|brandgefahr|nicht funktionsfähig|funktioniert (gar )?nicht|ohne funktion)\b/i, 'critical'],
  [/\b(dringend|erheblich|schwer(wiegend)?|stark|hoch|fehlt komplett|vollständig defekt)\b/i, 'high'],
  [/\b(gering|leicht|klein(er|e|es)?|kosmetisch|optisch|geringfügig|niedrig)\b/i, 'low'],
];

/** Typische Feststellungen → übliche Maßnahme (eigene Formulierungen). */
const MEASURE_RULES: [RegExp, string][] = [
  [/dichtung/i, 'Dichtung ersetzen'],
  [/(schließ|schliess)t? nicht|fällt nicht ins schloss|schließer|türschließer|schliesser/i, 'Türschließer einstellen bzw. tauschen'],
  [/\bkeil|verkeilt|festgestellt|aufgehalten|offen gehalten/i, 'Unzulässige Feststellung entfernen und Nutzer unterweisen'],
  [/plombe|sicherung(sstift)?/i, 'Neu plombieren und Gerät prüfen lassen'],
  [/druck|manometer|nicht im grünen bereich/i, 'Löscher durch Sachkundigen instand setzen lassen'],
  [/batterie|akku/i, 'Batterie bzw. Gerät tauschen'],
  [/(zu|ver)gestellt|blockiert|versperrt|nicht zugänglich|zugang/i, 'Zugang freiräumen'],
  [/schild|kennzeichn|beschilderung|piktogramm/i, 'Kennzeichnung erneuern'],
  [/verschmutz|staub|dreck|verdeckt/i, 'Reinigen'],
  [/abgelaufen|austauschfrist|frist überschritten|zu alt/i, 'Austausch veranlassen'],
  [/übermalt|überstrichen|überklebt/i, 'Farbe bzw. Abdeckung entfernen, Funktion prüfen'],
  [/bohrung|loch|durchbruch|beschädig|defekt|kaputt|gebrochen|riss/i, 'Instandsetzung durch Fachfirma beauftragen'],
];

const TASK_HINT = /\b(aufgabe|erledigen|bestellen|beauftragen|anrufen|termin|nachfassen|informieren|klären|erinnern)\b/i;
const NOTE_HINT = /^(notiz|hinweis|anmerkung|info)\b[:,]?\s*/i;
const FILLER = /^(also|äh+m?|ähm|ok(ay)?|ja|so|und|dann|außerdem|ausserdem|weiterhin|nächster punkt|punkt \d+)[,:]?\s+/i;
/** Element-Code wie „FST-7K2M“ (auch gesprochen „FST 7K2M“); der zweite Teil braucht eine Ziffer, damit normale Wörter nicht greifen. */
const CODE = /(?<![\p{L}\d])([A-Za-z]{2,4})[- ](?=[A-Za-z]*\d)([A-Za-z0-9]{3,6})(?![\p{L}\d])/u;

export function suggestSeverity(text: string): Severity {
  for (const [re, s] of SEVERITY_RULES) if (re.test(text)) return s;
  return 'medium';
}

export function suggestMeasure(text: string): string {
  for (const [re, m] of MEASURE_RULES) if (re.test(text)) return m;
  return '';
}

function dueInDays(text: string): number | null {
  if (/\b(sofort|heute)\b/i.test(text)) return 0;
  if (/\bmorgen\b/i.test(text)) return 1;
  if (/\b(diese|nächste) woche\b/i.test(text)) return 7;
  const m = text.match(/\bin (\d{1,3}) tag(en)?\b/i) ?? text.match(/\bbinnen (\d{1,3}) tag(en)?\b/i);
  if (m) return Number(m[1]);
  const w = text.match(/\bin (\d{1,2}) wochen?\b/i);
  return w ? Number(w[1]) * 7 : null;
}

const stem = (w: string) => w.toLowerCase().replace(/[^a-zäöüß]/g, '').slice(0, 6);
const words = (s: string) => s.split(/\s+/).map(stem).filter((w) => w.length >= 4);

/** Prüfpunkt mit den meisten gemeinsamen Wortstämmen (mindestens einer). */
export function matchCheckpoint(text: string, checkpoints: { id: string; label: string }[] = []): string | null {
  const t = new Set(words(text));
  let best: { id: string; score: number } | null = null;
  for (const cp of checkpoints) {
    const score = words(cp.label).filter((w) => t.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: cp.id, score };
  }
  return best?.id ?? null;
}

/** Ähnlichkeit zweier Beschreibungen (0–1, Anteil gemeinsamer Wortstämme) – für die Duplikat-Warnung. */
export function similarity(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size);
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Diktat in einzelne Feststellungen, Aufgaben und Notizen zerlegen. */
export function parseCapture(text: string, ctx: CaptureContext = {}): CaptureItem[] {
  const segments = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|\s+(?:und dann|außerdem|ausserdem|nächster punkt|weiterhin)\s+|\n+/i)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter((s) => s.replace(FILLER, '').length >= 3);
  return segments.map((raw) => {
    let s = raw;
    while (FILLER.test(s)) s = s.replace(FILLER, '');
    const isNote = NOTE_HINT.test(s);
    s = s.replace(NOTE_HINT, '');
    const code = s.match(CODE);
    const kind: CaptureKind = isNote ? 'note' : TASK_HINT.test(s) ? 'task' : 'defect';
    const title = cap(s.length > 120 ? `${s.slice(0, 117).trimEnd()} …` : s);
    return {
      kind,
      title,
      note: s.length > 120 ? s : '',
      severity: kind === 'note' ? 'low' : suggestSeverity(s),
      measure: kind === 'defect' ? suggestMeasure(s) : '',
      assetCode: code ? `${code[1]}-${code[2]}`.toUpperCase() : null,
      checkpointId: kind === 'defect' ? matchCheckpoint(s, ctx.checkpoints) : null,
      dueInDays: kind === 'task' ? dueInDays(s) : null,
    };
  });
}
