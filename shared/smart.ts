// Regelbasierte Auswertung von Diktaten und Vorschläge – läuft ohne KI im Browser und im Worker (/ai/parse);
// freie Sprache und Bilder versteht Claude über den MCP-Server.
import { CATEGORIES, type Severity } from './catalog';
import { type CatalogDefect, clientVocabulary, expandTerms, matchCatalogDefect } from './vocab';

export type CaptureKind = 'defect' | 'task' | 'note' | 'asset';

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
  /** Sammelanlage (nur kind 'asset'): Anzahl, Art (Schlüssel), Etage, Standort */
  count?: number;
  category?: string | null;
  floor?: string;
  location?: string;
}

/** Elementart für die Sammelanlage (eingebaut oder eigene des Workspaces). */
export interface CaptureCategory {
  key: string;
  label: string;
  plural?: string;
}

export interface CaptureContext {
  checkpoints?: { id: string; label: string }[];
  /** Arten für „fünf Feuerlöscher im EG Flur“; Standard: eingebaute Arten */
  categories?: CaptureCategory[];
}

/** Höchstzahl je Sammelanlage (Diktat). */
export const MAX_BULK_ASSETS = 50;

const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, 'zwölf': 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20,
};

/** Zahl am Anfang: Ziffern oder Zahlwort eins–zwanzig. */
export function parseCount(word: string): number | null {
  const w = word.toLowerCase();
  if (/^\d{1,3}$/.test(w)) return Number(w);
  return NUMBER_WORDS[w] ?? null;
}

const ORDINALS: Record<string, number> = { erste: 1, ersten: 1, zweite: 2, zweiten: 2, dritte: 3, dritten: 3, vierte: 4, vierten: 4, 'fünfte': 5, 'fünften': 5, sechste: 6, sechsten: 6 };

/** Etage aus dem Text lösen: „im Erdgeschoss“, „EG“, „2. OG“, „zweiten Obergeschoss“, „Keller“ … */
export function extractFloor(text: string): { floor: string; rest: string } {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/\b(?:im |in der |auf der |auf dem )?(erdgeschoss|eg)\b/i, () => 'EG'],
    [/\b(?:im |in der |auf der |auf dem )?(\d{1,2})\.? ?(?:og|obergeschoss|etage|stock)\b/i, (m) => `${m[1]}. OG`],
    [/\b(?:im |in der |auf der |auf dem )?(erste[n]?|zweite[n]?|dritte[n]?|vierte[n]?|fünfte[n]?|sechste[n]?) ?(?:og|obergeschoss|etage|stock)\b/i, (m) => `${ORDINALS[m[1]!.toLowerCase()]}. OG`],
    [/\b(?:im |in der |auf der |auf dem )?(obergeschoss|og)\b/i, () => 'OG'],
    [/\b(?:im |in der |auf dem )?(untergeschoss|ug|kellergeschoss|kg|keller)\b/i, () => 'UG'],
    [/\b(?:im |in der |auf dem )?(dachgeschoss|dg|dachboden)\b/i, () => 'DG'],
    [/\b(?:in der |auf der |im )?(tiefgarage)\b/i, () => 'TG'],
  ];
  for (const [re, f] of rules) {
    const m = text.match(re);
    if (m) return { floor: f(m), rest: `${text.slice(0, m.index)} ${text.slice((m.index ?? 0) + m[0].length)}`.replace(/\s+/g, ' ').trim() };
  }
  return { floor: '', rest: text.trim() };
}

const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Art am Anfang des Textes erkennen (Einzahl, Mehrzahl, übliche Endungen). Liefert Art und Länge des Treffers. */
export function matchCategory(text: string, categories: CaptureCategory[]): { key: string; length: number } | null {
  const t = fold(text);
  const forms = categories
    .flatMap((c) => [c.label, c.plural ?? ''].filter(Boolean).map((f) => ({ key: c.key, form: fold(f) })))
    .sort((a, b) => b.form.length - a.form.length);
  for (const { key, form } of forms) {
    if (!t.startsWith(form)) continue;
    const tail = t.slice(form.length).match(/^(en|n|e|s|er|ern)?(?![a-z0-9])/);
    if (tail) return { key, length: form.length + (tail[1]?.length ?? 0) };
  }
  return null;
}

const ASSET_FILLER = /^(?:neue[nrs]?|weitere[n]?|zusätzliche[n]?|noch)\s+/i;
const ASSET_VERB = /\s*\b(?:anlegen|erfassen|aufnehmen|hinzufügen|eintragen|neu anlegen)\b\s*/gi;
/** Feststellungen, die auf einen Mangel statt eine Anlage hinweisen */
const DEFECT_HINT = /\b(nicht|fehlt|fehlen|kein(e|en)?|defekt|kaputt|beschädigt|abgelaufen|blockiert|verstellt|zugestellt|undicht|verschmutzt)\b/i;

/** „fünf Feuerlöscher im Erdgeschoss Flur“ → Sammelanlage; sonst null. */
export function parseAssetBatch(text: string, categories: CaptureCategory[]): Pick<CaptureItem, 'count' | 'category' | 'floor' | 'location'> | null {
  if (DEFECT_HINT.test(text)) return null;
  const m = text.match(/^(\S+)\s+(.*)$/);
  if (!m) return null;
  const count = parseCount(m[1]!);
  if (count == null || count < 1) return null;
  const body = m[2]!.replace(ASSET_FILLER, '');
  const cat = matchCategory(body, categories);
  if (!cat) return null;
  const after = body.slice(cat.length).replace(ASSET_VERB, ' ');
  const { floor, rest } = extractFloor(after);
  const location = rest
    .replace(/^(?:[,–-]\s*)?(?:im|in der|in den|in|am|an der|auf der|auf dem|beim|bei|vor dem|vor der|neben dem|neben der)\s+/i, '')
    .replace(/^[,–-]\s*/, '')
    .replace(/[,.;]+$/, '')
    .trim();
  return { count: Math.min(count, MAX_BULK_ASSETS), category: cat.key, floor, location: location ? location[0]!.toUpperCase() + location.slice(1) : '' };
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

/** Schwere: ausdrückliche Wörter („sofort“, „gering“) zuerst, dann typischer Mangel aus dem Katalog (shared/vocab.ts). */
export function suggestSeverity(text: string, defects: CatalogDefect[] = clientVocabulary().defects): Severity {
  for (const [re, s] of SEVERITY_RULES) if (re.test(text)) return s;
  return matchCatalogDefect(text, defects)?.severity ?? 'medium';
}

/** Maßnahme: Katalog des Workspaces zuerst, sonst die eingebauten Regeln. */
export function suggestMeasure(text: string, defects: CatalogDefect[] = clientVocabulary().defects): string {
  const hit = matchCatalogDefect(text, defects);
  if (hit?.measure) return hit.measure;
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

/** Satzgrenzen (nicht nach „1.“ wie in „1. OG“), Bindewörter und „und“ vor einer Anzahl („… und drei Rauchwarnmelder …“). */
const SPLIT = new RegExp(
  `(?<=[!?;]|(?<!\\d)\\.)\\s+|\\s+(?:und dann|außerdem|ausserdem|nächster punkt|weiterhin)\\s+|\\s+und\\s+(?=(?:\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})\\s)|\\n+`,
  'i',
);

/** Diktat in einzelne Feststellungen, Aufgaben, Notizen und Sammelanlagen zerlegen. */
export function parseCapture(text: string, ctx: CaptureContext = {}): CaptureItem[] {
  // Begriffe des Katalogs („OTS“ → „Obentürschließer“, „FSA“ → „Feststellanlage“), shared/vocab.ts
  const segments = expandTerms(text, clientVocabulary().terms)
    .replace(/\s+/g, ' ')
    .split(SPLIT)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter((s) => s.replace(FILLER, '').length >= 3);
  return segments.map((raw) => {
    let s = raw;
    while (FILLER.test(s)) s = s.replace(FILLER, '');
    const batch = parseAssetBatch(s, ctx.categories ?? Object.values(CATEGORIES));
    if (batch) return { kind: 'asset' as const, title: cap(s), note: '', severity: 'low' as const, measure: '', assetCode: null, checkpointId: null, dueInDays: null, ...batch };
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
