// Regelbasierte Auswertung von Diktaten und Vorschläge – läuft ohne KI im Browser und im Worker (/ai/parse);
// freie Sprache und Bilder versteht Claude über den MCP-Server.
//
// Absichtserkennung (Plan v5, Paket Q): ein Satz wird in Teile zerlegt und jeder Teil als
//   Elemente   „drei Feuerschutztüren im EG Flur“, „Tür Raum 306 von Westag“ (Anzahl + Art bzw. Art + Ort),
//   Mangel     „Tür schließt nicht“ (Mangelwörter),
//   Aufgabe    „Hausmeister informieren bis Freitag“ (Auftragswörter),
//   Notiz      „Notiz: …“
// erkannt. Arten kommen aus den Katalog-Definitionen (Bezeichnung, Mehrzahl, `synonyms`) und aus CATEGORY_SYNONYMS unten.
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
  /** Elemente anlegen (nur kind 'asset'): Anzahl, Art (Schlüssel), Etage, Standort, Hersteller, Stammdaten */
  count?: number;
  category?: string | null;
  floor?: string;
  location?: string;
  manufacturer?: string;
  /** Stammdaten, z. B. { rating: 'T30', smoke: true } */
  attributes?: Record<string, string | boolean>;
}

/** Elementart für die Erkennung (eingebaut oder eigene des Workspaces). */
export interface CaptureCategory {
  key: string;
  label: string;
  plural?: string;
  /** weitere Wörter für diese Art (z. B. aus dem Katalog) */
  synonyms?: string[];
}

export interface CaptureContext {
  checkpoints?: { id: string; label: string }[];
  /** Arten für „fünf Feuerlöscher im EG Flur“; Standard: eingebaute Arten */
  categories?: CaptureCategory[];
  /**
   * Vorgabe des Erfassen-Sheets: 'assets' (Modus „Elemente“) nimmt auch ein bloßes Artwort als Element,
   * 'findings' (Mängel/Aufgaben) nur Elemente mit Anzahl oder Hersteller/Feuerwiderstand. Ohne Angabe: Anzahl oder Ort genügt.
   */
  prefer?: 'assets' | 'findings';
  /** „bis Freitag“ zählt ab diesem Zeitpunkt (Standard: jetzt) */
  now?: number;
}

/** Höchstzahl je Sammelanlage (Diktat). */
export const MAX_BULK_ASSETS = 50;

/**
 * Weitere Wörter je Art (Werkstattsprache, Abkürzungen). Gilt nur für Arten, die im Workspace vorhanden sind.
 * Hier ergänzen – oder im Katalog als `synonyms` an der Art (wird zusätzlich gelesen).
 */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  fire_door: ['Tür', 'Türe', 'Brandschutztür', 'Rauchschutztür', 'Feuertür', 'Brandschutztor', 'Feuerschutzabschluss', 'FST'],
  damper: ['Klappe', 'Brandklappe', 'BSK'],
  extinguisher: ['Löscher', 'Handfeuerlöscher', 'Pulverlöscher', 'Schaumlöscher', 'CO2-Löscher', 'Wasserlöscher', 'FL'],
  smoke_alarm: ['Rauchmelder', 'Heimrauchmelder', 'Melder', 'RWM'],
  hold_open: ['Feststellanlage', 'Feststellanlagen', 'Feststelleinrichtung', 'Türfeststellanlage', 'FSA'],
};

const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, 'zwölf': 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20,
};
const NUMBER_ALT = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');

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
    [/\b(?:in der |auf der |im )?(tiefgarage|tg)\b/i, () => 'TG'],
  ];
  for (const [re, f] of rules) {
    const m = text.match(re);
    if (m) return { floor: f(m), rest: `${text.slice(0, m.index)} ${text.slice((m.index ?? 0) + m[0].length)}`.replace(/\s+/g, ' ').trim() };
  }
  return { floor: '', rest: text.trim() };
}

const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const LETTER = /[\p{L}\d]/u;

type Form = { key: string; form: string };
const formCache = new WeakMap<CaptureCategory[], Form[]>();

/** Alle Schreibweisen der Arten (Bezeichnung, Mehrzahl, Synonyme; mit und ohne Umlaut), längste zuerst. */
function categoryForms(categories: CaptureCategory[]): Form[] {
  const hit = formCache.get(categories);
  if (hit) return hit;
  const forms: Form[] = [];
  for (const c of categories) {
    const words = [c.label, c.plural ?? '', ...(c.synonyms ?? []), ...(CATEGORY_SYNONYMS[c.key] ?? [])].filter(Boolean);
    for (const w of words) {
      const low = w.toLowerCase();
      forms.push({ key: c.key, form: low });
      if (fold(w) !== low) forms.push({ key: c.key, form: fold(w) });
    }
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  formCache.set(categories, forms);
  return forms;
}

/** Art an Position `at` (Wortanfang) erkennen; übliche Endungen (-en, -n, -e, -s, -er, -ern) zählen mit. */
function categoryAt(lower: string, at: number, forms: Form[]): { key: string; length: number } | null {
  for (const { key, form } of forms) {
    if (!lower.startsWith(form, at)) continue;
    const tail = lower.slice(at + form.length).match(/^(en|n|e|s|er|ern)?(?![\p{L}\d])/u);
    if (tail) return { key, length: form.length + (tail[1]?.length ?? 0) };
  }
  return null;
}

/** Art am Anfang des Textes erkennen (Einzahl, Mehrzahl, übliche Endungen, Synonyme). Liefert Art und Länge des Treffers. */
export function matchCategory(text: string, categories: CaptureCategory[]): { key: string; length: number } | null {
  return categoryAt(text.toLowerCase(), 0, categoryForms(categories));
}

/** Erste Art irgendwo im Text (an einem Wortanfang). */
export function findCategory(text: string, categories: CaptureCategory[]): { key: string; start: number; end: number } | null {
  const lower = text.toLowerCase();
  const forms = categoryForms(categories);
  for (let i = 0; i < lower.length; i++) {
    if (i > 0 && LETTER.test(lower[i - 1]!)) continue;
    const m = categoryAt(lower, i, forms);
    if (m) return { key: m.key, start: i, end: i + m.length };
  }
  return null;
}

/** Feststellungen, die auf einen Mangel statt eine Anlage hinweisen */
const DEFECT_HINT =
  /(?<![\p{L}])(nicht|mangel|mängel|mangelhaft\w*|bemängelt|gefahr|fehlt|fehlen|fehlend\w*|kein(e|en|er)?|defekt\w*|kaputt|beschädigt|beschaedigt|abgelaufen|blockiert|verstellt|zugestellt|versperrt|undicht|verschmutzt|klemmt|klemmen|schleift|schleifen|lose|locker|gerissen|abgerissen|riss|risse|rissig|gebrochen|verbogen|verzogen|verkeilt|festgekeilt|unterkeilt|keil|übermalt|überstrichen|überklebt|piept|ausgelöst|verdeckt|aufgehalten|offen gehalten|steht offen|schadhaft|korrodiert|rostet|verrostet|tropft|quietscht|mangel|mängel|schaden|abgängig|überfällig|ohne plombe|plombe fehlt|zu alt)(?![\p{L}])/iu;
/** Aufträge an jemanden („Hausmeister informieren bis Freitag“) */
const TASK_HINT =
  /(?<![\p{L}])(aufgabe|erledigen|bestellen|nachbestellen|beauftragen|anrufen|termin|nachfassen|informieren|benachrichtigen|bescheid (geben|sagen)|mitteilen|klären|erinnern|besorgen|veranlassen|kümmern|angebot (einholen|anfordern)|rückruf)(?![\p{L}])/iu;
const NOTE_HINT = /^(notiz|hinweis|anmerkung|info)\b[:,]?\s*/i;
/** Hilfsverben: ein Satz mit Artwort ohne Anzahl ist dann eher eine Aussage als ein neues Element */
const STATEMENT = /(?<![\p{L}])(ist|sind|war|waren|hat|haben|wird|wurde|wurden|geht|lässt|muss|müssen|soll|sollte)(?![\p{L}])/iu;
const FILLER = /^(also|äh+m?|ähm|ok(ay)?|ja|so|und|dann|außerdem|ausserdem|weiterhin|sowie|nächster punkt|punkt \d+)[,:]?\s+/i;
/** Element-Code wie „FST-7K2M“ (auch gesprochen „FST 7K2M“); der zweite Teil braucht eine Ziffer, damit normale Wörter nicht greifen. */
const CODE = /(?<![\p{L}\d])(?!(?:raum|haus|nr|tor|bau|teil|flur|ebene|halle|block|trakt|whg|eg|og|ug|dg|kg|tg)[- ])([A-Za-z]{2,4})[- ](?=[A-Za-z]*\d)(?!(?:t|ei2?|k|f)\s?\d0(?![\p{L}\d]))([A-Za-z0-9]{3,6})(?![\p{L}\d])/iu;
const ASSET_VERB = /(?<![\p{L}])(?:neu anlegen|anlegen|erfassen|aufnehmen|hinzufügen|eintragen|verbaut|vorhanden)(?![\p{L}])/giu;
/** Anzahl unmittelbar vor dem Artwort: „drei“, „3x“, „3 Stück“, „zwei neue“ */
const COUNT_BEFORE = new RegExp(
  `(?:^|[\\s,(])(\\d{1,3}|${NUMBER_ALT})(?:\\s*[x×]|\\s+(?:stück|stk\\.?|mal))?\\s*(?:(?:neue[nrs]?|weitere[n]?|zusätzliche[n]?|einzelne[n]?|baugleiche[n]?)\\s+)*(?:(?:t|ei2?)\\s?(?:30|60|90)[-–\\s]*)?$`,
  'iu',
);
const PREPOSITION = /^(?:im|in der|in den|in dem|in|am|an der|an dem|auf der|auf dem|beim|bei|vor dem|vor der|neben dem|neben der|zum|zur|je|jeweils|und|sowie|mit|alle|davon)\s+/i;

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Hersteller, Feuerwiderstand, Rauchschutz und Etage aus einem Text lösen; der Rest ist der Standort. */
function extractDetails(text: string): { floor: string; manufacturer: string; attributes: Record<string, string | boolean>; rest: string } {
  let t = ` ${text} `;
  const attributes: Record<string, string | boolean> = {};
  const rating = t.match(/(?<![\p{L}\d])(?:(T)\s?(30|60|90)|(EI2?)\s?(30|60|90))(?![\d])[-–]?/iu);
  if (rating) {
    attributes.rating = rating[1] ? `T${rating[2]}` : `EI2 ${rating[4]}`;
    t = t.replace(rating[0], ' ');
  }
  if (/(?<![\p{L}])RS(?![\p{L}])/u.test(t) || /rauchschutz/i.test(t)) {
    attributes.smoke = true;
    t = t.replace(/(?<![\p{L}])(RS|mit Rauchschutz)(?![\p{L}])/u, ' ');
  }
  let manufacturer = '';
  const mm = t.match(/(?<![\p{L}])(?:von|vom hersteller|hersteller|fabrikat|marke|firma|fa\.)\s+(?!(?:der|die|das|dem|den)\s)([\p{L}][\p{L}\d&.+-]*)/iu);
  if (mm) {
    manufacturer = cap(mm[1]!.replace(/[.,]+$/, ''));
    t = t.replace(mm[0], ' ');
  }
  const { floor, rest } = extractFloor(squash(t));
  return { floor, manufacturer, attributes, rest };
}

/** Standort aus dem Rest: Präpositionen, Verben und Satzzeichen entfernen. */
function cleanLocation(rest: string): string {
  let s = squash(rest.replace(ASSET_VERB, ' ').replace(/[,;:–]+/g, ' ').replace(/(?<![\p{L}])(?:stück|stk\.?)(?![\p{L}])/giu, ' '));
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(PREPOSITION, '').replace(/\s+(?:im|in|am|an|auf|bei|und|von|mit)$/i, '').replace(/^[-–.]+\s*|[-–.]+$/g, '').trim();
  }
  return cap(s);
}

export interface AssetPhrase {
  count: number;
  category: string;
  floor: string;
  location: string;
  manufacturer: string;
  attributes: Record<string, string | boolean>;
  /** mit ausdrücklicher Anzahl („drei …“, „3x …“) */
  counted: boolean;
}

/** „drei Feuerschutztüren im EG Flur von Hörmann T30“ → Element-Angaben; ohne Artwort null. */
export function parseAssetPhrase(text: string, categories: CaptureCategory[]): AssetPhrase | null {
  const cat = findCategory(text, categories);
  if (!cat) return null;
  const before = text.slice(0, cat.start);
  const cm = before.match(COUNT_BEFORE);
  const count = cm ? parseCount(cm[1]!) : null;
  const prefix = cm && count != null ? before.slice(0, cm.index! + (/^[\s,(]/.test(cm[0]) ? 1 : 0)) : before;
  // „T30-Tür“: Bindestrich vor dem Artwort gehört zum Feuerwiderstand
  const d = extractDetails(`${prefix.replace(/[-–]\s*$/, '')} ${text.slice(cat.end)}`);
  // „zwei T30-Türen“: Feuerwiderstand zwischen Anzahl und Artwort
  const attributes = cm && count != null ? { ...extractDetails(cm[0]).attributes, ...d.attributes } : d.attributes;
  return {
    count: Math.min(Math.max(count ?? 1, 1), MAX_BULK_ASSETS),
    category: cat.key,
    floor: d.floor,
    location: cleanLocation(d.rest),
    manufacturer: d.manufacturer,
    attributes,
    counted: count != null,
  };
}

/** „fünf Feuerlöscher im Erdgeschoss Flur“ → Sammelanlage (nur mit Anzahl, ohne Mangelwörter); sonst null. */
export function parseAssetBatch(text: string, categories: CaptureCategory[]): Pick<CaptureItem, 'count' | 'category' | 'floor' | 'location' | 'manufacturer' | 'attributes'> | null {
  if (DEFECT_HINT.test(text) || CODE.test(text)) return null;
  const a = parseAssetPhrase(text, categories);
  if (!a?.counted) return null;
  return { count: a.count, category: a.category, floor: a.floor, location: a.location, manufacturer: a.manufacturer, attributes: a.attributes };
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

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];

function dueInDays(text: string, now = Date.now()): number | null {
  if (/\b(sofort|heute)\b/i.test(text)) return 0;
  if (/\bübermorgen\b/i.test(text)) return 2;
  if (/\bmorgen\b/i.test(text)) return 1;
  if (/\b(diese|nächste|naechste) woche\b/i.test(text)) return 7;
  const wd = text.toLowerCase().match(/\b(?:bis |am |zum |bis zum |spätestens )?(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b/);
  if (wd) {
    const diff = (WEEKDAYS.indexOf(wd[1]!) - new Date(now).getDay() + 7) % 7;
    return diff === 0 ? 7 : diff;
  }
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

/** Satzgrenzen (nicht nach „1.“ wie in „1. OG“) und Bindewörter. */
const SENTENCE = /(?<=[!?;]|(?<!\d)\.)\s+|\s+(?:und dann|außerdem|ausserdem|nächster punkt|weiterhin)\s+|\n+/i;
/** „… und drei Rauchwarnmelder …“, „… sowie 2x Löscher …“: neue Aufzählung im selben Satz */
const AND_COUNT = new RegExp(`\\s+(?:und|sowie|plus)\\s+(?=(?:\\d{1,3}\\s*[x×]?|${NUMBER_ALT})\\s)`, 'i');

type Strength = 'note' | 'task' | 'defect' | 'asset' | 'weak' | 'neutral';

interface Draft {
  kind: Strength;
  parts: string[];
  asset?: AssetPhrase;
}

/** Einen Satzteil einordnen. */
function classify(clause: string, cats: CaptureCategory[]): { kind: Strength; asset?: AssetPhrase } {
  if (NOTE_HINT.test(clause)) return { kind: 'note' };
  if (TASK_HINT.test(clause)) return { kind: 'task' };
  if (DEFECT_HINT.test(clause)) return { kind: 'defect' };
  if (CODE.test(clause)) return { kind: 'neutral' };
  const asset = parseAssetPhrase(clause, cats);
  if (asset?.counted) return { kind: 'asset', asset };
  if (asset && !STATEMENT.test(clause)) return { kind: 'weak', asset };
  return { kind: 'neutral' };
}

/** Darf ein Element ohne Anzahl angelegt werden? Hängt von der Vorgabe des Sheets ab. */
function weakIsAsset(a: AssetPhrase, prefer: CaptureContext['prefer']): boolean {
  if (prefer === 'assets') return true;
  const detail = !!a.manufacturer || Object.keys(a.attributes).length > 0;
  if (prefer === 'findings') return detail;
  return detail || !!a.floor || !!a.location;
}

/** Ein Satz → Einträge: Teile an Kommas trennen, wenn sich die Absicht ändert; neutrale Teile gehören zum vorigen. */
function parseSentence(sentence: string, ctx: CaptureContext, cats: CaptureCategory[]): Draft[] {
  const pieces = sentence.split(AND_COUNT);
  const drafts: Draft[] = [];
  for (const piece of pieces) {
    const clauses = piece
      .split(/\s*,\s*|\s+[–—]\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const classified = clauses.map((c) => ({ text: c, ...classify(c, cats) }));
    // Gibt es im Teil einen Mangel/Auftrag, ist ein Artwort ohne Anzahl nur dessen Ort („Tür im 2. OG, Dichtung fehlt“)
    const hasFinding = classified.some((c) => c.kind === 'defect' || c.kind === 'task');
    let cur: Draft | null = null;
    const startNew = (kind: Strength, text: string, asset?: AssetPhrase) => {
      cur = { kind, parts: [text], asset };
      drafts.push(cur);
    };
    for (const c of classified) {
      let kind = c.kind;
      if (kind === 'weak') kind = !hasFinding && c.asset && weakIsAsset(c.asset, ctx.prefer) ? 'asset' : 'neutral';
      const now = cur as Draft | null;
      if (!now) startNew(kind, c.text, kind === 'asset' ? c.asset : undefined);
      else if (kind === 'asset') startNew('asset', c.text, c.asset);
      else if (kind === 'neutral') {
        now.parts.push(c.text);
        // „…, alle T30“ / „…, von Hörmann“: Angaben ergänzen das Element
        if (now.kind === 'asset' && now.asset) {
          const d = extractDetails(c.text);
          now.asset = {
            ...now.asset,
            floor: now.asset.floor || d.floor,
            manufacturer: now.asset.manufacturer || d.manufacturer,
            attributes: { ...d.attributes, ...now.asset.attributes },
            location: now.asset.location || cleanLocation(d.rest),
          };
        }
      } else if (now.kind === 'neutral') {
        now.kind = kind;
        now.parts.push(c.text);
      } else if (now.kind === kind) now.parts.push(c.text);
      else startNew(kind, c.text);
    }
  }
  // Ort im selben Satz weitergeben: „Im EG Flur drei Türen und eine Feststellanlage“
  let lastAsset: AssetPhrase | undefined;
  for (const d of drafts) {
    if (d.kind !== 'asset' || !d.asset) continue;
    if (lastAsset && !d.asset.floor && !d.asset.location) d.asset = { ...d.asset, floor: lastAsset.floor, location: lastAsset.location };
    lastAsset = d.asset;
  }
  return drafts;
}

/** Diktat in einzelne Feststellungen, Aufgaben, Notizen und Elemente zerlegen. */
export function parseCapture(text: string, ctx: CaptureContext = {}): CaptureItem[] {
  // Im Prüfablauf (Prüfpunkte bekannt) geht es nur um Befunde – dort entsteht nie ein neues Element
  const cats = ctx.checkpoints?.length ? [] : (ctx.categories ?? Object.values(CATEGORIES));
  // Begriffe des Katalogs („OTS“ → „Obentürschließer“, „FSA“ → „Feststellanlage“), shared/vocab.ts
  const sentences = expandTerms(text, clientVocabulary().terms)
    .replace(/[ \t]+/g, ' ')
    .split(SENTENCE)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter((s) => s.replace(FILLER, '').length >= 3);
  const drafts = sentences.flatMap((raw) => {
    let s = raw;
    while (FILLER.test(s)) s = s.replace(FILLER, '');
    return parseSentence(s, ctx, cats);
  });
  return drafts
    .map((d): CaptureItem | null => {
      let s = d.parts.join(', ');
      while (FILLER.test(s)) s = s.replace(FILLER, '');
      if (s.length < 2) return null;
      if (d.kind === 'asset' && d.asset) {
        const a = d.asset;
        return {
          kind: 'asset',
          title: cap(s),
          note: '',
          severity: 'low',
          measure: '',
          assetCode: null,
          checkpointId: null,
          dueInDays: null,
          count: a.count,
          category: a.category,
          floor: a.floor,
          location: a.location,
          manufacturer: a.manufacturer,
          attributes: a.attributes,
        };
      }
      const isNote = d.kind === 'note' || NOTE_HINT.test(s);
      s = s.replace(NOTE_HINT, '');
      const code = s.match(CODE);
      const kind: CaptureKind = isNote ? 'note' : d.kind === 'task' ? 'task' : 'defect';
      const title = cap(s.length > 120 ? `${s.slice(0, 117).trimEnd()} …` : s);
      return {
        kind,
        title,
        note: s.length > 120 ? s : '',
        severity: kind === 'note' ? 'low' : suggestSeverity(s),
        measure: kind === 'defect' ? suggestMeasure(s) : '',
        assetCode: code ? `${code[1]}-${code[2]}`.toUpperCase() : null,
        checkpointId: kind === 'defect' ? matchCheckpoint(s, ctx.checkpoints) : null,
        dueInDays: kind === 'task' ? dueInDays(s, ctx.now) : null,
      };
    })
    .filter((i): i is CaptureItem => i != null);
}
