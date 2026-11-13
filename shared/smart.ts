// Regelbasierte Auswertung von Diktaten und Vorschläge – läuft ohne KI im Browser und im Worker (/ai/parse);
// freie Sprache und Bilder versteht Claude über den MCP-Server.
//
// Absichtserkennung (Plan v5): ein Satz wird in Teile zerlegt und jeder Teil als
//   Elemente   „drei Feuerschutztüren im EG Flur“, „Tür Raum 306 von Westag“, „Türen 12 bis 15“ (Anzahl/Nummer + Art bzw. Art + Ort),
//   Mangel     „Tür 36 schließt nicht“ (Mangelwörter; „Tür 36“ = Element Nr. 36 des Objekts),
//   Aufgabe    „Hausmeister informieren bis Freitag“ (Auftragswörter),
//   Notiz      „Notiz: …“
// erkannt. Arten kommen aus den Katalog-Definitionen (Bezeichnung, Mehrzahl, `synonyms`), aus CATEGORY_SYNONYMS und
// TYPE_WORDS unten („Rauchschutztür“ = Feuerschutztür mit Rauchschutz).
//
// Zerlegung von Elementen (Härtung nach dem Durchgang der Designleitung, Korpus in shared/corpus.test.ts):
//   - Jedes Artwort ist ein Anker; davor stehen Ort und Anzahl („im ersten OG Treppenhaus eine …“), dahinter Nummer,
//     Hersteller, Stammdaten und Ort („… von Westag im Flur“). Zwischen zwei Ankern trennt das letzte „und/sowie/dann“.
//   - Artwörter nach „mit/ohne/an der/für …“ sind Eigenschaften bzw. Ort („Tür mit Feststellanlage“, „FSA an der Tür“).
//   - Ein genannter Ort gilt für alle folgenden Elemente bis zum nächsten Ort; Elemente am Satzanfang ohne Ort
//     übernehmen den ersten Ort danach („zwei Türen und eine FSA im Flur“).
//   - Was keinem Feld zugeordnet werden kann, landet in `unsure` (Vorschau: „bitte prüfen“), nie im Standort.
import { CATEGORIES, type Severity } from './catalog';
import { type CatalogDefect, clientVocabulary, expandTerms, findElementRef, matchCatalogDefect } from './vocab';

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
  /** Typ/Modell („Typ H3“) */
  model?: string;
  /** Stammdaten, z. B. { rating: 'T30', smoke: true } – nur Felder und Werte, die die Art kennt */
  attributes?: Record<string, string | boolean>;
  /** feste Nummer im Objekt („Tür 36“); bei mehreren die erste, die weiteren fortlaufend („Türen 12 bis 15“) */
  number?: number | null;
  /** Mangel/Aufgabe an einem Element per Nummer („Tür 36 schließt nicht“) – aufgelöst im gewählten Objekt */
  elementRef?: { number: number; category: string | null } | null;
  /** Nicht verstandener Rest – die Vorschau zeigt die Zeile als „bitte prüfen“ */
  unsure?: string;
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

type Attrs = Record<string, string | boolean>;

/**
 * Weitere Wörter je Art (Werkstattsprache, Abkürzungen). Gilt nur für Arten, die im Workspace vorhanden sind.
 * Hier ergänzen – oder im Katalog als `synonyms` an der Art (wird zusätzlich gelesen). Wörter mit eigener Bedeutung
 * (Rauchschutz, Bauart) stehen in TYPE_WORDS.
 */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  fire_door: ['Tür', 'Türe', 'Brandschutztür', 'Feuertür', 'Feuerschutztor', 'Brandschutztor', 'Tor', 'Brandschutzabschluss', 'FST'],
  damper: ['Klappe', 'Brandklappe', 'BSK'],
  extinguisher: ['Löscher', 'Handfeuerlöscher', 'FL'],
  smoke_alarm: ['Rauchmelder', 'Heimrauchmelder', 'Melder', 'RWM'],
  hold_open: ['Feststellanlage', 'Feststellanlagen', 'Feststelleinrichtung', 'Feststellvorrichtung', 'Türfeststellanlage', 'FSA'],
};

/** Artwörter, die zugleich Stammdaten nennen (nur gültige Felder/Werte aus shared/catalog.ts). */
const TYPE_WORDS: { key: string; forms: string[]; attrs: Attrs }[] = [
  { key: 'fire_door', forms: ['Rauchschutztür', 'Rauchschutz-Tür', 'RS-Tür', 'Rauchschutztor', 'Rauchschutzabschluss', 'Rauchschutzabschlüsse'], attrs: { smoke: true } },
  { key: 'fire_door', forms: ['Feuerschutzabschluss', 'Feuerschutzabschlüsse', 'Brandschutzabschlüsse'], attrs: {} },
  { key: 'fire_door', forms: ['Stahltür', 'Stahl-Tür'], attrs: { doorType: 'Stahltür' } },
  { key: 'fire_door', forms: ['Alu-Rohrrahmentür', 'Aluminium-Rohrrahmentür', 'Alurohrrahmentür', 'Alu-Tür'], attrs: { doorType: 'Alu-Rohrrahmentür' } },
  { key: 'fire_door', forms: ['Rohrrahmentür'], attrs: { doorType: 'Rohrrahmentür' } },
  { key: 'fire_door', forms: ['Drehflügeltür'], attrs: { doorType: 'Drehflügeltür' } },
  { key: 'fire_door', forms: ['Schiebetür'], attrs: { doorType: 'Schiebetür' } },
  { key: 'fire_door', forms: ['Schiebetor'], attrs: { doorType: 'Schiebetor' } },
  { key: 'fire_door', forms: ['Holztür'], attrs: { doorType: 'Holztür' } },
  { key: 'fire_door', forms: ['Glastür', 'Ganzglastür'], attrs: { doorType: 'Glastür' } },
  { key: 'fire_door', forms: ['Pendeltür'], attrs: { doorType: 'Pendeltür' } },
  { key: 'fire_door', forms: ['Wohnungseingangstür', 'WE-Tür'], attrs: { doorType: 'Wohnungseingangstür' } },
  { key: 'fire_door', forms: ['Doppeltür', 'Doppelflügeltür'], attrs: { leaves: '2-flügelig' } },
  { key: 'hold_open', forms: ['Haftmagnetanlage', 'Haftmagnet-Anlage'], attrs: { holdDevice: 'Haftmagnet' } },
  { key: 'extinguisher', forms: ['CO2-Löscher', 'CO₂-Löscher', 'CO2-Feuerlöscher', 'Kohlendioxidlöscher'], attrs: { agent: 'CO₂' } },
  { key: 'extinguisher', forms: ['Pulverlöscher', 'ABC-Löscher', 'Pulverfeuerlöscher'], attrs: { agent: 'ABC-Pulver' } },
  { key: 'extinguisher', forms: ['Schaumlöscher', 'Schaumfeuerlöscher'], attrs: { agent: 'Schaum' } },
  { key: 'extinguisher', forms: ['Wasserlöscher'], attrs: { agent: 'Wasser' } },
  { key: 'extinguisher', forms: ['Fettbrandlöscher'], attrs: { agent: 'Fettbrand' } },
];

// ---------- Zahlen ----------
const NUMBER_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, einer: 1, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, 'zwölf': 12, zwoelf: 12, dreizehn: 13, vierzehn: 14, 'fünfzehn': 15, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20,
};
const UNITS: Record<string, number> = { ein: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TENS: Record<string, number> = { zwanzig: 20, 'dreißig': 30, dreissig: 30, vierzig: 40, 'fünfzig': 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const TENS_ALT = Object.keys(TENS).join('|');
const NUMBER_ALT = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
/** Zahl als Ziffern oder Wort bis hundert („einundzwanzig“, „dreißig“) */
const NUM = `(?:(?:${Object.keys(UNITS).join('|')})und(?:${TENS_ALT})|(?:ein)?hundert|${TENS_ALT}|${NUMBER_ALT}|\\d{1,3})`;

/** Zahl am Anfang: Ziffern oder Zahlwort bis hundert. */
export function parseCount(word: string): number | null {
  const w = word.toLowerCase();
  if (/^\d{1,3}$/.test(w)) return Number(w);
  if (w in NUMBER_WORDS) return NUMBER_WORDS[w]!;
  if (w in TENS) return TENS[w]!;
  if (w === 'hundert' || w === 'einhundert') return 100;
  const m = w.match(new RegExp(`^(${Object.keys(UNITS).join('|')})und(${TENS_ALT})$`));
  return m ? UNITS[m[1]!]! + TENS[m[2]!]! : null;
}

// ---------- Sprache glätten ----------
/** Typische Fehler der Spracherkennung und getrennt gesprochene Wörter zusammenführen („T 30“, „O G“, „Erd Geschoss“). */
export function normalizeSpeech(text: string): string {
  const tensWord: Record<string, string> = { 'dreißig': '30', dreissig: '30', sechzig: '60', neunzig: '90' };
  return (
    text
      // Füllwörter mitten im Satz
      .replace(/(?<![\p{L}])(?:äh+m?|ähm|öh+m?|hm+)(?![\p{L}])[,.]?\s*/giu, '')
      // Feuerwiderstand: „T 30“, „t-30“, „T dreißig“, „K 90“
      .replace(/(?<![\p{L}\d])([TtKk])[\s-]*(30|60|90)(?!\d)/gu, (_, l: string, n: string) => `${l.toUpperCase()}${n}`)
      .replace(/(?<![\p{L}\d])([TtKk])[\s-]*(dreißig|dreissig|sechzig|neunzig)(?![\p{L}])/giu, (_, l: string, n: string) => `${l.toUpperCase()}${tensWord[n.toLowerCase()]}`)
      // Etagen-Abkürzungen buchstabiert: „O G“, „E G“
      .replace(/(?<![\p{L}])([OEUDKT]) G(?![\p{L}])/gu, '$1G')
      .replace(/(?<![\p{L}])(Erd|Ober|Unter|Keller|Dach|Zwischen)[\s-]+geschoss/giu, (_, a: string) => `${a}geschoss`)
      .replace(/(?<![\p{L}])(Tief)[\s-]+garage/giu, '$1garage')
      .replace(/(?<![\p{L}])(Treppen)[\s-]+haus/giu, '$1haus')
      .replace(/(?<![\p{L}])(Feuer|Brand|Rauch)[\s-]+schutz/giu, (_, a: string) => `${a}schutz`)
      .replace(/(?<![\p{L}])(zwei|ein|doppel)\s+(flügel)/giu, '$1$2')
      // „Feuerschutz Tür“, „Rauchschutz-Tür“, „Stahl Tür“
      .replace(
        /(?<![\p{L}])(Feuerschutz|Brandschutz|Rauchschutz|Stahl|Holz|Glas|Schiebe|Drehflügel|Rohrrahmen|Wohnungseingangs|Doppel)[\s-]+T(ür|üre|üren|or|ore)(?![\p{L}])/giu,
        (_, a: string, b: string) => `${a}t${b}`,
      )
      .replace(/(?<![\p{L}])(Feststell|Rauchwarn|Rauch|Feuer|Haftmagnet)[\s-]+(anlage|melder|löscher|einrichtung)/giu, (_, a: string, b: string) => `${a}${b.toLowerCase()}`)
      .replace(/(?<![\p{L}])(Brandschutz)[\s-]+(klappe)/giu, (_, a: string, b: string) => `${a}${b.toLowerCase()}`)
      // „Nummer sechsunddreißig“ → „Nummer 36“, „36 bis vierzig“ → „36 bis 40“
      .replace(new RegExp(`(?<![\\p{L}])(nummer|nr\\.?)\\s+(${NUM})(?![\\p{L}\\d])`, 'giu'), (m, w: string, n: string) => {
        const v = parseCount(n);
        return v == null ? m : `${w} ${v}`;
      })
      .replace(new RegExp(`(\\d)\\s+bis\\s+(${NUM})(?![\\p{L}\\d])`, 'giu'), (m, d: string, n: string) => {
        const v = parseCount(n);
        return v == null ? m : `${d} bis ${v}`;
      })
      .replace(/[ \t]+/g, ' ')
  );
}

// ---------- Etagen ----------
const ORD_NUM: Record<string, number> = { erst: 1, zweit: 2, dritt: 3, viert: 4, 'fünft': 5, fuenft: 5, sechst: 6, siebent: 7, siebt: 7, acht: 8, neunt: 9, zehnt: 10 };
const ORD = `(${Object.keys(ORD_NUM).join('|')})e[nrsm]?`;
const ordinal = (s: string) => ORD_NUM[s.toLowerCase()] ?? 1;
/** nicht nach „zum/zur/vom …“: „Tür zum Keller“ ist ein Ort, keine Etage */
const NOT_DIR = '(?<!(?:zum|zur|vom|ins|nach|richtung|zu)\\s+)';
const PRE = '(?:(?:im|in der|in dem|auf der|auf dem|auf|in)\\s+)?';
const floorRe = (body: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\d.])${NOT_DIR}${PRE}${body}(?![\\p{L}\\d])`, flags);
const FLOOR_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [floorRe('(\\d{1,2})\\.?\\s?(?:og|obergeschoss|etage|stock|stockwerk)'), (m) => `${Number(m[1])}. OG`],
  [floorRe(`${ORD}\\s?(?:og|obergeschoss|etage|stock|stockwerk|geschoss)`), (m) => `${ordinal(m[1]!)}. OG`],
  [floorRe('(?:og|obergeschoss|etage)\\s?(\\d{1,2})(?![.\\d])'), (m) => `${Number(m[1])}. OG`],
  [floorRe('(\\d)\\.?\\s?(?:ug|untergeschoss|kellergeschoss)'), (m) => `${m[1]}. UG`],
  [floorRe(`${ORD}\\s?(?:ug|untergeschoss|kellergeschoss)`), (m) => `${ordinal(m[1]!)}. UG`],
  [floorRe('(?:erdgeschoss|eg|hochparterre|parterre)'), () => 'EG'],
  [floorRe('(?:zwischengeschoss|zg|mezzanin)'), () => 'ZG'],
  [floorRe('(?:untergeschoss|ug|kellergeschoss|keller|souterrain)'), () => 'UG'],
  [floorRe('(?<!\\d\\s?)kg'), () => 'UG'],
  [floorRe('(?:dachgeschoss|dg|dachboden|spitzboden)'), () => 'DG'],
  [floorRe('(?:tiefgarage|tg)'), () => 'TG'],
  [floorRe('(?:obergeschoss|og)'), () => 'OG'],
  // „im Dritten“ (ohne Stockwerkwort)
  [new RegExp(`(?<![\\p{L}])${NOT_DIR}(?:im|in der|auf der|auf dem)\\s+${ORD}(?![\\p{L}\\d])`, 'iu'), (m) => `${ordinal(m[1]!)}. OG`],
];

/** Etage aus dem Text lösen: „im Erdgeschoss“, „EG“, „2. OG“, „im dritten Stock“, „Keller“, „Tiefgarage“ … */
export function extractFloor(text: string): { floor: string; rest: string } {
  for (const [re, f] of FLOOR_RULES) {
    const m = text.match(re);
    if (m) return { floor: f(m), rest: squash(`${text.slice(0, m.index)} ${text.slice((m.index ?? 0) + m[0].length)}`) };
  }
  return { floor: '', rest: text.trim() };
}

// ---------- Arten ----------
const fold = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const LETTER = /[\p{L}\d]/u;

type Form = { key: string; form: string; attrs?: Attrs };
const formCache = new WeakMap<CaptureCategory[], Form[]>();

/** Alle Schreibweisen der Arten (Bezeichnung, Mehrzahl, Synonyme, TYPE_WORDS; mit und ohne Umlaut), längste zuerst. */
function categoryForms(categories: CaptureCategory[]): Form[] {
  const hit = formCache.get(categories);
  if (hit) return hit;
  const forms: Form[] = [];
  const add = (key: string, w: string, attrs?: Attrs) => {
    const low = w.toLowerCase();
    forms.push({ key, form: low, attrs });
    if (fold(w) !== low) forms.push({ key, form: fold(w), attrs });
  };
  const keys = new Set(categories.map((c) => c.key));
  for (const t of TYPE_WORDS) if (keys.has(t.key)) for (const w of t.forms) add(t.key, w, t.attrs);
  for (const c of categories) {
    const words = [c.label, c.plural ?? '', ...(c.synonyms ?? []), ...(CATEGORY_SYNONYMS[c.key] ?? [])].filter(Boolean);
    for (const w of words) add(c.key, w);
  }
  // gleich lang: die Form mit Stammdaten zuerst
  forms.sort((a, b) => b.form.length - a.form.length || Number(!!b.attrs) - Number(!!a.attrs));
  formCache.set(categories, forms);
  return forms;
}

/** Art an Position `at` (Wortanfang) erkennen; übliche Endungen (-en, -n, -e, -s, -er, -ern) zählen mit. */
function categoryAt(lower: string, at: number, forms: Form[]): { key: string; length: number; attrs?: Attrs } | null {
  for (const { key, form, attrs } of forms) {
    if (!lower.startsWith(form, at)) continue;
    const tail = lower.slice(at + form.length).match(/^(en|n|e|s|er|ern)?(?![\p{L}\d])/u);
    if (tail) return { key, length: form.length + (tail[1]?.length ?? 0), attrs };
  }
  return null;
}

/** Art am Anfang des Textes erkennen (Einzahl, Mehrzahl, übliche Endungen, Synonyme). Liefert Art und Länge des Treffers. */
export function matchCategory(text: string, categories: CaptureCategory[]): { key: string; length: number } | null {
  const m = categoryAt(text.toLowerCase(), 0, categoryForms(categories));
  return m ? { key: m.key, length: m.length } : null;
}

/** Erste Art irgendwo im Text (an einem Wortanfang). */
export function findCategory(text: string, categories: CaptureCategory[]): { key: string; start: number; end: number } | null {
  const a = findAnchors(text, categories)[0];
  return a ? { key: a.key, start: a.start, end: a.end } : null;
}

interface Anchor {
  key: string;
  start: number;
  end: number;
  attrs: Attrs;
}

/** Artwort nach „mit/ohne/an der/für/bis …“ ist eine Eigenschaft oder ein Ort, kein neues Element. */
const ANCHOR_BLOCK = new RegExp(
  `(?:^|[\\s,(])(?:mit|ohne|samt|inkl\\.?|inklusive|an|am|zur|zum|vom|von der|von dem|für|über|unter|neben|vor|hinter|bei|beim|gegenüber|bis)(?:\\s+(?:der|die|das|dem|den|einer|einem|einen|eine|ein))?(?:\\s+${NUM})?\\s*$`,
  'iu',
);
/** zusammengesetzte Türwörter („Kellertür“), die keine eigene Form haben */
const COMPOUND_DOOR = /^[\p{L}-]{2,}?(?:tür|türe|türen|tuer|tueren)(?![\p{L}\d])/u;
/** „… von Hörmann und zwei von Schüco“: Anzahl ohne Artwort meint die Art davor */
const ELLIPSIS = new RegExp(`(?<![\\p{L}])(?:und|sowie)\\s+${NUM}\\s+(?:weitere[n]?\\s+)?(?=(?:von|vom|mit|ohne)\\s)`, 'giu');

/** Alle Artwörter im Text, in Reihenfolge. */
function findAnchors(text: string, categories: CaptureCategory[]): Anchor[] {
  if (!categories.length) return [];
  const lower = text.toLowerCase();
  const forms = categoryForms(categories);
  const doors = categories.some((c) => c.key === 'fire_door');
  const out: Anchor[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (i > 0 && LETTER.test(lower[i - 1]!)) continue;
    let m: { key: string; length: number; attrs?: Attrs } | null = categoryAt(lower, i, forms);
    if (!m && doors) {
      const c = lower.slice(i).match(COMPOUND_DOOR);
      if (c) m = { key: 'fire_door', length: c[0].length };
    }
    if (!m) continue;
    const end = i + m.length;
    if (!ANCHOR_BLOCK.test(text.slice(0, i))) out.push({ key: m.key, start: i, end, attrs: m.attrs ?? {} });
    i = end - 1;
  }
  for (const e of text.matchAll(ELLIPSIS)) {
    const pos = (e.index ?? 0) + e[0].length;
    const prev = [...out].reverse().find((a) => a.end <= (e.index ?? 0));
    if (prev && !out.some((a) => a.start > prev.start && a.start < pos)) out.push({ key: prev.key, start: pos, end: pos, attrs: {} });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- Erkennungswörter ----------
/** Feststellungen, die auf einen Mangel statt eine Anlage hinweisen */
const DEFECT_HINT =
  /(?<![\p{L}])(nicht|mangel|mängel|mangelhaft\w*|bemängelt|gefahr|fehlt|fehlen|fehlend\w*|kein(e|en|er)?|defekt\w*|kaputt|beschädigt|beschaedigt|abgelaufen|blockiert|verstellt|zugestellt|versperrt|undicht|verschmutzt|klemmt|klemmen|schleift|schleifen|lose|locker|gerissen|abgerissen|eingerissen|ausgerissen|angerissen|riss|risse|rissig|sprung|gesprungen|gebrochen|verbogen|verzogen|verkeilt|festgekeilt|unterkeilt|keil|keile|holzkeil|festgehalten|übermalt|überstrichen|überklebt|piept|ausgelöst|verdeckt|aufgehalten|offen gehalten|steht offen|schadhaft|korrodiert|rost|rostet|verrostet|tropft|quietscht|ölt|verliert öl|ausgeschlagen|schwergängig|geht schwer|zu (?:groß|gross|klein|weit|eng|schwach|stark|schnell|langsam|hoch|niedrig)|schaden|abgängig|überfällig|ohne plombe|plombe fehlt|zu alt)(?![\p{L}])/iu;
/** Aufträge an jemanden („Hausmeister informieren bis Freitag“) */
const TASK_HINT =
  /(?<![\p{L}])(aufgabe|erledigen|bestellen|nachbestellen|beauftragen|anrufen|termin|nachfassen|informieren|benachrichtigen|bescheid (geben|sagen)|mitteilen|klären|abklären|erinnern|erinnerung|besorgen|veranlassen|kümmern|vereinbaren|angebot (einholen|anfordern)|rückruf|nachprüfung|nachkontrolle|wiedervorlage|nachreichen|nachliefern|zusenden|zuschicken|vorlegen|(?:hausmeister|kunde|kunden|betreiber|fachfirma|elektriker|schlosser|verwaltung|hausverwaltung|nutzer|mieter)\s+(?:soll|sollte|muss|möge))(?![\p{L}])/iu;
const NOTE_HINT = /^(notiz|hinweis|anmerkung|info)\b[:,]?\s*/i;
/** Hilfsverben: ein Satz mit Artwort ohne Anzahl ist dann eher eine Aussage als ein neues Element */
const STATEMENT = /(?<![\p{L}])(ist|sind|war|waren|hat|haben|wird|wurde|wurden|geht|lässt|muss|müssen|soll|sollte)(?![\p{L}])/iu;
const FILLER = /^(also|äh+m?|ähm|ok(ay)?|ja|so|und|dann|noch|außerdem|ausserdem|weiterhin|sowie|nächster punkt|punkt \d+)[,:]?\s+/i;
/** Element-Code wie „FST-7K2M“ (auch gesprochen „FST 7K2M“); der zweite Teil braucht eine Ziffer, damit normale Wörter nicht greifen. */
const CODE =
  /(?<![\p{L}\d])(?!(?:bis|ab|zu|für|nach|vor|aus|zwei|zwo|drei|vier|acht|neun|zehn|elf|ein|eine|eins|typ|mit|und|von|bei|im|am|an|auf|die|der|das|den|dem|ca|nur|noch|raum|haus|nr|no|tor|bau|teil|flur|ebene|halle|block|trakt|whg|bad|wc|zi|zim|app|apt|top|eg|og|ug|dg|kg|tg|zg)[- ])([A-Za-z]{2,4})[- ](?=[A-Za-z]*\d)(?!(?:t|ei2?|k|f)\s?\d0(?![\p{L}\d]))([A-Za-z0-9]{3,6})(?![\p{L}\d])/iu;
const ASSET_VERB = /(?<![\p{L}])(?:neu anlegen|anlegen|angelegt|erfassen|erfasst|aufnehmen|aufgenommen|hinzufügen|eintragen|eingetragen|verbaut|eingebaut|vorhanden)(?![\p{L}])/giu;
/** Teilmenge („eine davon zweiflügelig“): passt auf kein ganzes Element */
const SUBSET = /(?<![\p{L}])(?:davon|die mittlere|der mittlere|die linke|die rechte|die erste|die letzte|bei einer|bei einem|eine der|einer der)(?![\p{L}])/iu;

const ADJ =
  '(?:neue[nrs]?|weitere[n]?|zusätzliche[n]?|einzelne[n]?|baugleiche[n]?|gleiche[n]?|alte[n]?|vorhandene[n]?|einflügelige[n]?|zweiflügelige[n]?|doppelflügelige[n]?|rauchdichte[n]?|(?:t|ei2?|k)\\s?(?:30|60|90)|rs)';
const ADJ_ATTR = /(?:t|ei2?|k)\s?(?:30|60|90)|(?<![\p{L}])rs(?![\p{L}])|einflügelige[n]?|zweiflügelige[n]?|doppelflügelige[n]?|rauchdichte[n]?/giu;
/** Anzahl unmittelbar vor dem Artwort: „drei“, „3x“, „3 Stück“, „zwei neue“, „zwo T30-“ */
const COUNT_BEFORE = new RegExp(`(?:^|[\\s,(:])(${NUM})(?:\\s*[x×]|\\s+(?:stück|stk\\.?|mal))?\\s*(?:${ADJ}[-–\\s]*)*$`, 'iu');
/** Zahl nach diesen Wörtern ist eine Raum- oder Platznummer, keine Anzahl */
const ROOM_BEFORE = /(?:raum|zimmer|büro|haus|achse|halle|gebäude|ebene|etage|nr|nummer|wohnung|whg|bauteil|block|trakt|flur|treppenhaus|tür|tor|ausgang|eingang|platz|stellplatz|top)\.?\s*$/iu;
/** Nummer direkt nach dem Artwort: „Tür 36“, „Türen 12 bis 15“, „Tür 1 bis Tür 4“ (nicht „Tür 3. OG“, nicht „6 kg“) */
const NUM_AFTER = new RegExp(
  '^\\s*(?:(?:nr\\.?|nummer|no\\.?|#)\\s*)?(\\d{1,4})(?:\\s*(?:bis|-|–)\\s*(?:(?:tür(?:e|en)?|nr\\.?|nummer)\\s*)?(\\d{1,4}))?(?![\\d.,]|\\s*(?:kg|kilo\\w*|l|liter|mm|cm|m|x|×|stück|stk|og|obergeschoss|etage|stock|ug|eg)(?![\\p{L}]))',
  'iu',
);
const NUM_ANY = /(?<![\p{L}])(?:nummer|nr\.?)\s*(\d{1,4})(?:\s*(?:bis|-|–)\s*(\d{1,4}))?(?![\d])/iu;
const COUNT_AFTER = new RegExp(`^\\s*,?\\s*(${NUM})\\s*(?:stück|stk\\.?|x|×)(?![\\p{L}])`, 'iu');

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------- Stammdaten ----------
/** Nur Felder und Werte, die die Art kennt (eingebaute Arten); eigene Arten behalten Feuerwiderstand und Rauchschutz. */
function validAttributes(key: string, attrs: Attrs): Attrs {
  const def = (CATEGORIES as Record<string, (typeof CATEGORIES)[keyof typeof CATEGORIES] | undefined>)[key];
  if (!def) return Object.fromEntries(Object.entries(attrs).filter(([k]) => k === 'rating' || k === 'smoke'));
  const out: Attrs = {};
  for (const [k, v] of Object.entries(attrs)) {
    const f = def.attributes.find((x) => x.key === k);
    if (!f) continue;
    if (f.type === 'select' && !(f.options ?? []).includes(String(v))) continue;
    if (f.type === 'boolean' && typeof v !== 'boolean') continue;
    if ((f.type ?? 'text') !== 'boolean' && typeof v !== 'string') continue;
    out[k] = v;
  }
  return out;
}

const DOOR_FEATURES: [string, RegExp][] = [
  ['holdOpen', /(?<![\p{L}])(?:feststellanlage\w*|feststelleinrichtung\w*|fsa|haftmagnet\w*|feststellung)(?![\p{L}])/iu],
  ['closer', /(?<![\p{L}])(?:obentürschließer\w*|obentuerschliesser\w*|ots|türschließer\w*|tuerschliesser\w*|schließer)(?![\p{L}])/iu],
  ['dropSeal', /(?<![\p{L}])(?:absenkdichtung\w*|automatische dichtung)(?![\p{L}])/iu],
  ['peephole', /(?<![\p{L}])(?:türspion\w*|spion\w*)(?![\p{L}])/iu],
];

/** Stammdaten aus dem Text lösen (je nach Art); der Text ohne die Treffer kommt zurück. */
function takeAttributes(text: string, key: string | null): { attrs: Attrs; text: string } {
  let t = text;
  const attrs: Attrs = {};
  const take = (re: RegExp, f: (m: RegExpMatchArray, before: string) => void) => {
    const m = t.match(re);
    if (!m) return false;
    f(m, t.slice(0, m.index));
    t = `${t.slice(0, m.index)} ${t.slice((m.index ?? 0) + m[0].length)}`;
    return true;
  };
  const custom = !!key && !(key in CATEGORIES);
  const door = key === 'fire_door' || custom;
  // Feuerwiderstand (mit „-RS“/„Sa“ als Rauchschutz)
  take(/(?<![\p{L}\d])(?:(T)\s?-?(30|60|90)|(EI)\s?2?\s?-?(30|60|90)|(K)\s?-?(30|60|90))(?:\s?-\s?(RS|Sa|S200)|\s(Sa|S200))?(?![\p{L}\d])[-–]?/iu, (m) => {
    const [kind, n] = m[1] ? ['T', m[2]] : m[3] ? ['EI', m[4]] : ['K', m[6]];
    if (key === 'damper') {
      if (kind === 'K') attrs.rating = `K${n}`;
      else if (kind === 'EI') attrs.rating = `EI ${n} S`;
    } else if (door) {
      if (kind === 'T') attrs.rating = `T${n}`;
      else if (kind === 'EI') attrs.rating = `EI2 ${n}`;
      else if (custom) attrs.rating = `K${n}`;
    }
    if ((m[7] || m[8]) && door) attrs.smoke = true;
  });
  if (door) {
    while (take(/(?<![\p{L}])(?:mit Rauchschutz|Rauchschutz|rauchdicht\w*|S200)(?![\p{L}\d])/iu, () => (attrs.smoke = true)));
    while (take(/(?<![\p{L}-])(?:RS|Sa)(?![\p{L}\d])/u, () => (attrs.smoke = true)));
    take(/(?<![\p{L}])(?:zwei|2|doppel)[\s-]?fl(?:ü|ue)ge?l\w*/iu, () => (attrs.leaves = '2-flügelig'));
    take(/(?<![\p{L}])(?:ein|1)[\s-]?fl(?:ü|ue)ge?l\w*/iu, () => (attrs.leaves = '1-flügelig'));
  }
  if (key === 'fire_door')
    for (const [field, re] of DOOR_FEATURES)
      take(re, (_, before) => {
        const pol = before.match(/.*(?<![\p{L}])(mit|ohne)(?![\p{L}])/isu);
        attrs[field] = pol?.[1]?.toLowerCase() !== 'ohne';
      });
  if (key === 'hold_open') {
    take(new RegExp(`(?<![\\p{L}])(${NUM})\\s+(?:rauch)?(?:melder\\w*|rauchschalter\\w*)`, 'iu'), (m) => (attrs.detectors = String(parseCount(m[1]!) ?? '')));
    take(/(?<![\p{L}])(?:hand(?:taster|auslösetaster|auslöser|auslösung)\w*)/iu, () => (attrs.manualRelease = true));
    take(/(?<![\p{L}])HAT(?![\p{L}])/u, () => (attrs.manualRelease = true));
    take(/(?<![\p{L}])haftmagnet\w*/iu, () => (attrs.holdDevice = 'Haftmagnet'));
    take(/(?<![\p{L}])(?:mit\s+)?(?:sturz-?\s?und\s?decken\w*|decken-?\s?und\s?sturz\w*)/iu, () => (attrs.trigger = 'Sturz- und Deckenmelder'));
    take(/(?<![\p{L}])(?:mit\s+)?deckenmelder\w*/iu, () => (attrs.trigger = 'Deckenmelder'));
    take(/(?<![\p{L}])(?:mit\s+)?(?:rauchschalter|sturzmelder)\w*(?:\s+im\s+sturz)?/iu, () => (attrs.trigger = 'Rauchschalter im Sturz'));
    take(/(?<![\p{L}])gleitschiene\w*/iu, () => (attrs.holdDevice = 'Gleitschiene mit Feststellung'));
    take(/(?<![\p{L}])freilauf\w*/iu, () => (attrs.holdDevice = 'Freilauftürschließer'));
  }
  if (key === 'extinguisher') {
    take(new RegExp(`(?<![\\p{L}])(${NUM})\\s*(?:kg|kilo(?:gramm)?|l|liter)(?![\\p{L}])`, 'iu'), (m) => (attrs.size = String(parseCount(m[1]!) ?? '')));
    take(/(?<![\p{L}])(?:abc[\s-]?)?pulver\w*|(?<![\p{L}])abc(?![\p{L}])/iu, () => (attrs.agent = 'ABC-Pulver'));
    take(/(?<![\p{L}])schaum\w*/iu, () => (attrs.agent = 'Schaum'));
    take(/(?<![\p{L}])(?:co2|co₂|kohlendioxid)(?![\p{L}\d])/iu, () => (attrs.agent = 'CO₂'));
    take(/(?<![\p{L}])fettbrand\w*/iu, () => (attrs.agent = 'Fettbrand'));
  }
  if (key === 'smoke_alarm') {
    take(/(?<![\p{L}])(?:mit\s+)?(?:(?:zehn|10)[\s-]?jahres\w*|langzeit\w*|lithium\w*)/iu, () => (attrs.battery = '10-Jahres-Lithium'));
    take(/(?<![\p{L}])(?:mit\s+)?(?:9\s?v(?:olt)?|neun volt|wechselbatterie\w*)(?![\p{L}])/iu, () => (attrs.battery = 'Wechselbatterie 9V'));
    take(/(?<![\p{L}])(?:netzbetrieb\w*|230\s?v(?:olt)?)(?![\p{L}])/iu, () => (attrs.battery = 'Netzbetrieb'));
  }
  if (key === 'damper') {
    take(/(?<![\p{L}])(?:federrücklauf\w*|stellmotor\w*)/iu, () => (attrs.actuator = 'Federrücklaufmotor'));
    take(/(?<![\p{L}])(?:schmelzlot\w*|mechanisch\w*)/iu, () => (attrs.actuator = 'Mechanisch'));
  }
  if (key && key in CATEGORIES) take(/(?<![\p{L}])baujahr\s*:?\s*((?:19|20)\d\d)(?!\d)/iu, (m) => (attrs.year = m[1]!));
  return { attrs, text: t };
}

const MAKER =
  /(?<![\p{L}])(?:von(?:\s+der)?\s+firma|vom\s+hersteller|hersteller(?:in)?|fabrikat|marke|firma|fa\.|von)\s*:?\s+(?!(?:der|die|das|dem|den|einer|einem|außen|innen|oben|unten|links|rechts|hinten|vorne|hier|dort|ca|etwa|ihm|ihr|uns)(?![\p{L}]))([\p{L}][\p{L}\d&.+-]*)/iu;

interface Details {
  floor: string;
  location: string;
  manufacturer: string;
  model: string;
  attributes: Attrs;
  number: number | null;
  numberTo: number | null;
  countAfter: number | null;
  unsure: string[];
}

/** Hersteller, Typ, Nummer, Stammdaten und Etage aus einem Text lösen; der Rest ist der Standort (oder „bitte prüfen“). */
function extractDetails(text: string, key: string | null): Details {
  let t = ` ${text} `;
  const cut = (m: RegExpMatchArray) => {
    t = `${t.slice(0, m.index)} ${t.slice((m.index ?? 0) + m[0].length)}`;
  };
  let countAfter: number | null = null;
  const ca = t.match(COUNT_AFTER);
  if (ca) {
    countAfter = parseCount(ca[1]!);
    cut(ca);
  }
  let model = '';
  const mo = t.match(/(?<![\p{L}])(?:typ|modell)\s*:?\s+([\p{L}\d][\p{L}\d./-]*)/iu);
  if (mo) {
    model = mo[1]!.replace(/[.,]+$/, '');
    cut(mo);
  }
  let number: number | null = null;
  let numberTo: number | null = null;
  const nm = t.match(NUM_ANY);
  if (nm) {
    number = Number(nm[1]);
    numberTo = nm[2] ? Number(nm[2]) : null;
    cut(nm);
  }
  const a = takeAttributes(t, key);
  t = a.text;
  let manufacturer = '';
  const mm = t.match(MAKER);
  if (mm) {
    manufacturer = cap(mm[1]!.replace(/[.,]+$/, ''));
    cut(mm);
  }
  const { floor, rest } = extractFloor(squash(t));
  const loc = cleanLocation(rest);
  return { floor, location: loc.location, manufacturer, model, attributes: a.attrs, number, numberTo, countAfter, unsure: loc.unsure ? [loc.unsure] : [] };
}

/** Am Anfang/Ende des Standorts entfernt */
const LOC_STRIP = new Set(['im', 'in', 'am', 'an', 'auf', 'bei', 'beim', 'und', 'sowie', 'plus', 'mit', 'ohne', 'dann', 'also', 'noch', 'auch', 'ja', 'so', 'außerdem', 'ausserdem', 'der', 'die', 'das', 'den', 'dem', 'des', 'zusätzlich']);
const LOC_STRIP_END = new Set([...LOC_STRIP, 'von', 'vom', 'zum', 'zur', 'vor', 'vorm', 'neben', 'hinter']);
/** überall entfernt */
const LOC_FILLER = new Set(['äh', 'ähm', 'halt', 'eben', 'mal', 'quasi', 'eigentlich', 'bitte', 'genau', 'ok', 'okay', 'noch']);
/** Wörter, die in keinem Standort stehen: ab hier hat die Regel den Satz nicht verstanden */
const LOC_JUNK = new Set([
  ...['und', 'oder', 'sowie', 'plus', 'aber', 'dann', 'ist', 'sind', 'war', 'waren', 'hat', 'haben', 'wird', 'werden', 'wurde', 'wurden', 'muss', 'müssen', 'soll', 'sollen', 'kann', 'können'],
  ...['gibt', 'jeweils', 'pro', 'davon', 'insgesamt', 'alle', 'jede', 'jeder', 'jedes', 'jedem', 'jeden', 'ich', 'wir', 'man', 'es', 'er', 'wo', 'wie', 'was', 'weil', 'dass'],
  ...['einer', 'eine', 'ein', 'einen', 'eins', 'stück', 'von', 'mit', 'ohne', 'nicht'],
  ...Object.keys(NUMBER_WORDS).filter((w) => !w.startsWith('ein')),
]);

/** nach diesen Wörtern gehört ein Zahlwort zum Ort („Ebene minus eins“, „Haus zwei“) */
const ROOMISH = new Set(['ebene', 'minus', 'raum', 'haus', 'etage', 'nummer', 'nr', 'zimmer', 'bauteil', 'block', 'treppenhaus', 'wohnung', 'achse', 'halle', 'gebäude', 'top', 'aufgang', 'eingang']);

/** Standort aus dem Rest: Präpositionen, Verben und Satzzeichen entfernen; Unverstandenes getrennt zurückgeben. */
function cleanLocation(rest: string): { location: string; unsure: string } {
  const s = squash(rest.replace(ASSET_VERB, ' ').replace(/[,;:–()]+/g, ' ').replace(/(?<![\p{L}])(?:stück|stk\.?)(?![\p{L}])/giu, ' '));
  let tokens = s
    .split(' ')
    .map((w) => w.replace(/^[-–.]+|[-–.]+$/g, ''))
    .filter((w) => w && !LOC_FILLER.has(w.toLowerCase()));
  const strip = () => {
    while (tokens.length && LOC_STRIP.has(tokens[0]!.toLowerCase())) tokens = tokens.slice(1);
    while (tokens.length && LOC_STRIP_END.has(tokens.at(-1)!.toLowerCase())) tokens = tokens.slice(0, -1);
  };
  strip();
  const k = tokens.findIndex((w, i) => LOC_JUNK.has(w.toLowerCase()) && !(parseCount(w) != null && i > 0 && ROOMISH.has(tokens[i - 1]!.toLowerCase())));
  let unsure = '';
  if (k >= 0) {
    const restTokens = tokens.slice(k);
    tokens = tokens.slice(0, k);
    strip();
    if (restTokens.some((w) => !LOC_JUNK.has(w.toLowerCase()) && !LOC_STRIP_END.has(w.toLowerCase()))) unsure = restTokens.join(' ');
  }
  if (tokens.length > 6) {
    unsure = squash(`${tokens.join(' ')} ${unsure}`);
    tokens = [];
  }
  return { location: cap(tokens.join(' ')), unsure };
}

export interface AssetPhrase {
  count: number;
  category: string;
  floor: string;
  location: string;
  manufacturer: string;
  model?: string;
  attributes: Record<string, string | boolean>;
  /** mit ausdrücklicher Anzahl („drei …“, „3x …“) oder Nummernbereich */
  counted: boolean;
  /** feste (erste) Nummer */
  number?: number | null;
  /** Hersteller oder ausdrückliche Stammdaten genannt (nicht nur aus dem Artwort) */
  detail?: boolean;
  /** nicht zugeordnete Reste */
  unsure?: string[];
}

interface Segment {
  anchor: Anchor;
  head: string;
  adj: string;
  count: number | null;
  tail: string;
  raw: string;
}

/** Text mit Artwörtern in Element-Abschnitte zerlegen: [Ort/Anzahl] Artwort [Nummer, Hersteller, Ort]. */
function segments(text: string, categories: CaptureCategory[]): Segment[] {
  const anchors = findAnchors(text, categories);
  if (!anchors.length) return [];
  const starts: number[] = [];
  const counts: (number | null)[] = [];
  const adjs: string[] = [];
  anchors.forEach((a, i) => {
    const prevEnd = i ? anchors[i - 1]!.end : 0;
    const before = text.slice(prevEnd, a.start);
    let cm = before.match(COUNT_BEFORE);
    let count = cm ? parseCount(cm[1]!) : null;
    const lead = cm && /^[\s,(:]/.test(cm[0]) ? 1 : 0;
    if (cm && /^\d/.test(cm[1]!) && ROOM_BEFORE.test(before.slice(0, cm.index! + lead))) {
      cm = null;
      count = null;
    }
    if (cm && count != null) {
      starts.push(prevEnd + cm.index! + lead);
      // nur Stammdaten zwischen Anzahl und Artwort („zwei T30-Türen“); „neue“, „Stück“, „x“ fallen weg
      adjs.push([...cm[0].slice(lead).replace(new RegExp(`^${NUM}`, 'iu'), '').matchAll(ADJ_ATTR)].map((x) => x[0]).join(' '));
    } else {
      starts.push(a.start);
      adjs.push('');
    }
    counts.push(count);
  });
  const heads: string[] = [text.slice(0, starts[0])];
  const tails: string[] = [];
  anchors.forEach((a, i) => {
    const end = i + 1 < anchors.length ? starts[i + 1]! : text.length;
    const gap = text.slice(a.end, end);
    if (i + 1 >= anchors.length) {
      tails.push(gap);
      return;
    }
    // letztes Bindewort trennt: davor gehört zum Element, danach ist Ort/Anzahl des nächsten
    const conns = [...gap.matchAll(/(?:^|\s)(?:und|sowie|plus|dann|danach|anschließend|außerdem|ausserdem)(?=\s|$)/giu)];
    let cut = -1;
    let cutEnd = -1;
    const last = conns.at(-1);
    if (last) {
      cut = last.index!;
      cutEnd = last.index! + last[0].length;
    } else {
      // ohne Bindewort: ein zweiter Ort mit Etage beginnt das nächste Element
      for (const m of gap.matchAll(/(?:^|\s)(?=(?:im|in der|in den|auf der|auf dem)\s)/giu)) {
        if (m.index! > 0 && extractFloor(gap.slice(m.index!)).floor) {
          cut = m.index!;
          cutEnd = m.index!;
        }
      }
    }
    if (cut < 0) {
      tails.push(gap);
      heads.push('');
    } else {
      tails.push(gap.slice(0, cut));
      heads.push(gap.slice(cutEnd));
    }
  });
  return anchors.map((a, i) => ({
    anchor: a,
    head: heads[i] ?? '',
    adj: adjs[i]!,
    count: counts[i]!,
    tail: tails[i]!,
    raw: squash(`${heads[i] ?? ''} ${text.slice(starts[i]!, i + 1 < anchors.length ? a.end + tails[i]!.length : text.length)}`),
  }));
}

/** Ein Abschnitt → Element-Angaben. */
function buildAsset(seg: Segment): AssetPhrase {
  const key = seg.anchor.key;
  let tail = seg.tail;
  let number: number | null = null;
  let numberTo: number | null = null;
  const na = tail.match(NUM_AFTER);
  if (na) {
    number = Number(na[1]);
    numberTo = na[2] ? Number(na[2]) : null;
    tail = tail.slice(na[0].length);
  }
  const hd = extractDetails(`${seg.head} ${seg.adj}`.replace(/[-–]\s*$/, ''), key);
  const td = extractDetails(tail, key);
  number ??= hd.number ?? td.number;
  numberTo ??= hd.numberTo ?? td.numberTo;
  const unsure = [...hd.unsure, ...td.unsure];
  let count = seg.count ?? td.countAfter;
  if (number != null && numberTo != null && numberTo >= number && numberTo - number < MAX_BULK_ASSETS) {
    const n = numberTo - number + 1;
    if (count != null && count !== n) unsure.push(`Anzahl ${count} passt nicht zu den Nummern ${number} bis ${numberTo}`);
    count = n;
  }
  if (count != null && count > MAX_BULK_ASSETS) unsure.push(`${count} Stück – höchstens ${MAX_BULK_ASSETS} auf einmal`);
  const explicit = { ...hd.attributes, ...td.attributes };
  const manufacturer = hd.manufacturer || td.manufacturer;
  return {
    count: Math.min(Math.max(count ?? 1, 1), MAX_BULK_ASSETS),
    category: key,
    floor: hd.floor || td.floor,
    location: squash(`${hd.location} ${td.location ? (hd.location ? td.location.replace(/^./, (c) => c.toLowerCase()) : td.location) : ''}`),
    manufacturer,
    model: hd.model || td.model,
    attributes: validAttributes(key, { ...seg.anchor.attrs, ...explicit }),
    counted: count != null,
    number,
    detail: !!manufacturer || Object.keys(validAttributes(key, explicit)).length > 0,
    unsure,
  };
}

/** „drei Feuerschutztüren im EG Flur von Hörmann T30“ → Element-Angaben (erstes Artwort); ohne Artwort null. */
export function parseAssetPhrase(text: string, categories: CaptureCategory[]): AssetPhrase | null {
  const seg = segments(normalizeSpeech(text), categories)[0];
  return seg ? buildAsset(seg) : null;
}

/** „fünf Feuerlöscher im Erdgeschoss Flur“ → Sammelanlage (nur mit Anzahl, ohne Mangelwörter); sonst null. */
export function parseAssetBatch(text: string, categories: CaptureCategory[]): Pick<CaptureItem, 'count' | 'category' | 'floor' | 'location' | 'manufacturer' | 'attributes'> | null {
  if (DEFECT_HINT.test(text) || CODE.test(text)) return null;
  const a = parseAssetPhrase(text, categories);
  if (!a?.counted) return null;
  return { count: a.count, category: a.category, floor: a.floor, location: a.location, manufacturer: a.manufacturer, attributes: a.attributes };
}

// ---------- Schwere, Maßnahme, Frist ----------
const SEVERITY_RULES: [RegExp, Severity][] = [
  [/\b(kritisch|lebensgefahr|gefährlich|gefahr im verzug|sofort|akut|brandgefahr|nicht funktionsfähig|funktioniert (gar )?nicht|ohne funktion)\b/i, 'critical'],
  [/\b(dringend|erheblich|schwer(wiegend)?|stark|hoch|fehlt komplett|fehlt (?:\S+ ){0,3}komplett|komplett fehl\w*|vollständig defekt)\b/i, 'high'],
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
  const m = text.match(new RegExp(`(?<![\\p{L}])(?:in|binnen|innerhalb von) (${NUM}) tag(?:en)?(?![\\p{L}])`, 'iu'));
  if (m) return parseCount(m[1]!);
  const w = text.match(new RegExp(`(?<![\\p{L}])(?:in|binnen|innerhalb von) (${NUM}) wochen?(?![\\p{L}])`, 'iu'));
  return w ? (parseCount(w[1]!) ?? 0) * 7 : null;
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

// ---------- Zerlegen ----------
/** Satzgrenzen (nicht nach „1.“ wie in „1. OG“) und Bindewörter. */
const SENTENCE = /(?<=[!?;]|(?<!\d)\.)\s+|\s+(?:und dann|außerdem|ausserdem|nächster punkt|weiterhin)\s+|\n+/i;

type UnitKind = 'note' | 'task' | 'defect' | 'assets' | 'weak' | 'neutral';

interface Unit {
  text: string;
  kind: UnitKind;
  segs: Segment[];
  subset?: boolean;
}

interface Draft {
  kind: 'note' | 'task' | 'defect' | 'asset' | 'neutral';
  parts: string[];
  asset?: AssetPhrase;
  /** Mangel/Auftrag/Notiz an einem Wort erkannt (sonst nur Rest-Text) */
  hinted?: boolean;
  sentence: number;
}

const refOf = (text: string, cats: CaptureCategory[]) => findElementRef(text, cats);

/** Grobe Absicht eines Teils, für das Trennen an „und“. */
function strongKind(text: string, cats: CaptureCategory[]): 'note' | 'task' | 'defect' | 'asset' | 'other' {
  if (NOTE_HINT.test(text)) return 'note';
  if (TASK_HINT.test(text)) return 'task';
  if (DEFECT_HINT.test(text)) return 'defect';
  if (CODE.test(text)) return 'other';
  return segments(text, cats).some((s) => s.count != null) ? 'asset' : 'other';
}

/** An „und/sowie“ trennen, wenn sich die Absicht ändert („Tür 4 klemmt und Hausmeister informieren“); sonst zusammenlassen. */
function splitIntent(clause: string, cats: CaptureCategory[]): string[] {
  const parts = clause.split(/\s+(und|sowie)\s+/i);
  if (parts.length === 1) return [clause];
  const groups: { kind: string; text: string; ref: number | null }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const p = parts[i]!;
    const sep = i > 0 ? ` ${parts[i - 1]} ` : '';
    const kind = strongKind(p, cats);
    const ref = kind === 'defect' || kind === 'task' ? (refOf(p, cats)?.number ?? null) : null;
    const g = groups.at(-1);
    if (!g) groups.push({ kind, text: p, ref });
    else if (kind === 'other' || g.kind === 'other' || (g.kind === kind && !(ref != null && g.ref != null && ref !== g.ref))) {
      g.text += sep + p;
      if (g.kind === 'other') g.kind = kind;
      g.ref ??= ref;
    } else groups.push({ kind, text: p, ref });
  }
  return groups.map((g) => g.text);
}

function classifyUnit(text: string, cats: CaptureCategory[]): Unit[] {
  if (NOTE_HINT.test(text)) return [{ text, kind: 'note', segs: [] }];
  if (TASK_HINT.test(text)) return [{ text, kind: 'task', segs: [] }];
  if (DEFECT_HINT.test(text)) return [{ text, kind: 'defect', segs: [] }];
  if (CODE.test(text)) return [{ text, kind: 'neutral', segs: [] }];
  const sub = text.match(SUBSET);
  if (sub) {
    // „sieben Feuerlöscher fünf davon Schaum“: vorne ein Element, ab der Zahl vor „davon“ ein Rest zum Prüfen
    const before = text.slice(0, sub.index);
    const cnt = before.match(new RegExp(`(?:^|\\s)${NUM}\\s*$`, 'iu'));
    const cutAt = cnt ? cnt.index! : sub.index!;
    const left = text.slice(0, cutAt).trim();
    const lu = left ? classifyUnit(left, cats) : [];
    const rest: Unit = { text: text.slice(cutAt).trim(), kind: 'neutral', segs: [], subset: true };
    return lu.length === 1 && (lu[0]!.kind === 'assets' || lu[0]!.kind === 'weak') ? [lu[0]!, rest] : [{ ...rest, text }];
  }
  const segs = segments(text, cats);
  if (!segs.length) return [{ text, kind: 'neutral', segs }];
  return [{ text, kind: segs.some((s) => s.count != null) ? 'assets' : 'weak', segs }];
}

const ELLIPTIC_PART = new RegExp(`^(.*?)(?:^|\\s)(${NUM})(?:\\s*(?:stück|stk\\.?|x|×))?(?:\\s+(?:weitere|mehr))?$`, 'iu');
const PLACE_START = /^(?:im|in|am|auf|bei|beim|vor|neben|hinter)\s/iu;

/** „…, im ersten OG zwei und im zweiten OG zwei“: Anzahl ohne Artwort nach einem Element meint dieselbe Art. */
function elliptic(text: string): { head: string; count: number; raw: string }[] | null {
  const out: { head: string; count: number; raw: string }[] = [];
  for (const raw of text.split(/\s+(?:und|sowie|plus)\s+/i)) {
    const m = raw.trim().match(ELLIPTIC_PART);
    const count = m ? parseCount(m[2]!) : null;
    if (!m || count == null) return null;
    const head = m[1]!.trim();
    if (head && !PLACE_START.test(head) && !extractFloor(head).floor) return null;
    out.push({ head, count, raw: raw.trim() });
  }
  return out;
}

/** Darf ein Element ohne Anzahl angelegt werden? Hängt von der Vorgabe des Sheets ab. */
function weakIsAsset(a: AssetPhrase, prefer: CaptureContext['prefer']): boolean {
  if (prefer === 'assets') return true;
  if (prefer === 'findings') return !!a.detail;
  return !!a.detail || !!a.floor || !!a.location || a.number != null;
}

/** Hat der Text einen Ort (Etage oder Standort)? */
const hasPlace = (text: string) => {
  const d = extractDetails(text, null);
  return !!d.floor || !!d.location;
};

/** Ein Satz → Einträge. */
function parseSentence(sentence: string, ctx: CaptureContext, cats: CaptureCategory[], sid: number): Draft[] {
  const clauses = sentence
    .split(/\s*,\s*|\s+[–—]\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
  let units: Unit[] = clauses.flatMap((c) => splitIntent(c, cats)).flatMap((t) => classifyUnit(t, cats));
  // Ort/Hersteller vor dem Artwort, durch Komma getrennt („Gebäude B, EG, drei Feuerlöscher“): gehört zum folgenden Element
  const merged: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === 'neutral' && !u.subset) {
      let j = i;
      while (j < units.length && units[j]!.kind === 'neutral' && !units[j]!.subset) j++;
      const next = units[j];
      const run = units.slice(i, j).map((x) => x.text);
      const afterAsset = merged.some((m) => m.kind === 'assets' || m.kind === 'weak');
      if (next && (next.kind === 'assets' || next.kind === 'weak') && (!afterAsset || run.some(hasPlace))) {
        const text = `${run.join(' ')} ${next.text}`;
        merged.push(...classifyUnit(text, cats));
        i = j;
        continue;
      }
    }
    merged.push(u);
  }
  units = merged;
  // Gibt es im Satz einen Mangel/Auftrag, ist ein Artwort ohne Anzahl nur dessen Ort („Tür im 2. OG, Dichtung fehlt“)
  const hasFinding = units.some((u) => u.kind === 'defect' || u.kind === 'task');
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  const start = (d: Omit<Draft, 'sentence'>) => {
    cur = { ...d, sentence: sid };
    drafts.push(cur);
  };
  for (const u of units) {
    let kind: UnitKind = u.kind;
    let assets: AssetPhrase[] = [];
    if (kind === 'assets' || kind === 'weak') {
      assets = u.segs.map(buildAsset);
      const ok = kind === 'assets' || (!hasFinding && !STATEMENT.test(u.text) && assets.every((a) => weakIsAsset(a, ctx.prefer)));
      kind = ok ? 'assets' : 'neutral';
    }
    const now = cur as Draft | null;
    if (kind === 'assets') {
      u.segs.forEach((s, n) => start({ kind: 'asset', parts: [s.raw], asset: assets[n] }));
    } else if (kind === 'neutral') {
      const ell = !u.subset && now?.kind === 'asset' && now.asset ? elliptic(u.text) : null;
      if (ell && now?.asset) {
        const key = now.asset.category;
        for (const e of ell) start({ kind: 'asset', parts: [e.raw], asset: buildAsset({ anchor: { key, start: 0, end: 0, attrs: {} }, head: e.head, adj: '', count: e.count, tail: '', raw: e.raw }) });
      } else if (!now) start({ kind: 'neutral', parts: [u.text] });
      else {
        now.parts.push(u.text);
        // „…, von Hörmann“: Angaben ergänzen das Element; „…, alle T30“ alle Elemente des Satzes; Teilmengen und Reste → „bitte prüfen“
        if (now.kind === 'asset' && now.asset) {
          if (!u.subset && /^(?:alle|jeweils|je|beide|sämtliche)(?![\p{L}])/iu.test(u.text)) {
            for (const d of drafts) if (d.kind === 'asset' && d.asset) mergeDetails(d.asset, u.text, false);
          } else mergeDetails(now.asset, u.text, !!u.subset);
        }
      }
    } else {
      const ref = refOf(u.text, cats)?.number ?? null;
      const curRef = now && now.kind !== 'asset' ? (refOf(now.parts.join(' '), cats)?.number ?? null) : null;
      if (now && now.kind === 'neutral') {
        now.kind = kind;
        now.hinted = true;
        now.parts.push(u.text);
      } else if (now && now.kind === kind && !(ref != null && curRef != null && ref !== curRef)) now.parts.push(u.text);
      else start({ kind, parts: [u.text], hinted: true });
    }
  }
  return drafts;
}

/** Angaben aus einem nachgestellten Satzteil an ein Element hängen. */
function mergeDetails(a: AssetPhrase, text: string, subset: boolean) {
  a.unsure ??= [];
  if (subset) {
    a.unsure.push(squash(text));
    return;
  }
  const d = extractDetails(text, a.category);
  a.floor ||= d.floor;
  a.manufacturer ||= d.manufacturer;
  a.model ||= d.model;
  a.attributes = validAttributes(a.category, { ...d.attributes, ...a.attributes });
  if (a.number == null && d.number != null) {
    a.number = d.number;
    if (d.numberTo != null && d.numberTo >= d.number && d.numberTo - d.number < MAX_BULK_ASSETS) {
      a.count = d.numberTo - d.number + 1;
      a.counted = true;
    }
  }
  if (!a.location) a.location = d.location;
  else if (d.location) a.unsure.push(d.location);
  a.unsure.push(...d.unsure);
}

/**
 * Orte weitergeben: Ein Ort gilt für alle folgenden Elemente bis zum nächsten Ort (auch über Sätze); Elemente ohne Ort,
 * vor denen im selben Satz noch keiner genannt wurde, nehmen den ersten Ort danach im selben Satz. Nur ein Standort
 * ohne Etage behält die Etage davor.
 */
function carryPlaces(drafts: Draft[]) {
  let ctx: { floor: string; location: string } | null = null;
  const assets = drafts.filter((d) => d.kind === 'asset' && d.asset);
  assets.forEach((d, i) => {
    const a = d.asset!;
    if (a.floor || a.location) {
      if (!a.floor && ctx?.floor) a.floor = ctx.floor;
      ctx = { floor: a.floor, location: a.location };
      return;
    }
    const placedBefore = assets.slice(0, i).some((x) => x.sentence === d.sentence && (x.asset!.floor || x.asset!.location));
    const later = placedBefore ? undefined : assets.slice(i + 1).find((x) => x.sentence === d.sentence && (x.asset!.floor || x.asset!.location));
    const src = later ? { floor: later.asset!.floor, location: later.asset!.location } : ctx;
    if (src) {
      a.floor = src.floor;
      a.location = src.location;
    }
  });
}

/** Diktat in einzelne Feststellungen, Aufgaben, Notizen und Elemente zerlegen. */
export function parseCapture(text: string, ctx: CaptureContext = {}): CaptureItem[] {
  // Im Prüfablauf (Prüfpunkte bekannt) geht es nur um Befunde – dort entsteht nie ein neues Element
  const cats = ctx.checkpoints?.length ? [] : (ctx.categories ?? Object.values(CATEGORIES));
  const refCats = ctx.categories ?? Object.values(CATEGORIES);
  // Begriffe des Katalogs („OTS“ → „Obentürschließer“, „FSA“ → „Feststellanlage“), shared/vocab.ts; dann Sprache glätten
  const sentences = normalizeSpeech(expandTerms(normalizeSpeech(text), clientVocabulary().terms))
    .split(SENTENCE)
    .map((s) => s.trim().replace(/[.;]+$/, ''))
    .filter((s) => s.replace(FILLER, '').length >= 3);
  const drafts = sentences.flatMap((raw, sid) => {
    let s = raw;
    while (FILLER.test(s)) s = s.replace(FILLER, '');
    return parseSentence(s, ctx, cats, sid);
  });
  carryPlaces(drafts);
  return drafts
    .map((d): CaptureItem | null => {
      let s = d.parts.join(', ');
      while (FILLER.test(s)) s = s.replace(FILLER, '');
      if (s.length < 2) return null;
      if (d.kind === 'asset' && d.asset) {
        const a = d.asset;
        const unsure = [...new Set((a.unsure ?? []).filter(Boolean))].join(' · ');
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
          model: a.model ?? '',
          attributes: a.attributes,
          number: a.number ?? null,
          ...(unsure ? { unsure } : {}),
        };
      }
      const isNote = d.kind === 'note' || NOTE_HINT.test(s);
      s = s.replace(NOTE_HINT, '');
      const code = s.match(CODE);
      const kind: CaptureKind = isNote ? 'note' : d.kind === 'task' ? 'task' : 'defect';
      const title = cap(s.length > 120 ? `${s.slice(0, 117).trimEnd()} …` : s);
      // „Tür sieben“ → „Tür 7“ nur für den Verweis (beim Anlegen hieße „Tür zwei Rauchmelder“ etwas anderes)
      const refText = s.replace(new RegExp(`(?<![\\p{L}])(tür|türe|fsa|bsk|klappe|löscher|melder|element|nummer|nr\\.?)\\s+(${NUM})(?![\\p{L}\\d])`, 'giu'), (m, w: string, n: string) => {
        const v = /^ein/i.test(n) ? null : parseCount(n);
        return v == null ? m : `${w} ${v}`;
      });
      const ref = kind === 'note' || code ? null : findElementRef(refText, refCats);
      return {
        kind,
        title,
        note: s.length > 120 ? s : '',
        severity: kind === 'note' ? 'low' : suggestSeverity(s),
        measure: kind === 'defect' ? suggestMeasure(s) : '',
        assetCode: code ? `${code[1]}-${code[2]}`.toUpperCase() : null,
        checkpointId: kind === 'defect' ? matchCheckpoint(s, ctx.checkpoints) : null,
        dueInDays: kind === 'task' ? dueInDays(s, ctx.now) : null,
        elementRef: ref ? { number: ref.number, category: ref.category } : null,
        // ohne Mangel- oder Auftragswort nur vermutet
        ...(kind === 'defect' && !d.hinted ? { unsure: s } : {}),
      };
    })
    .filter((i): i is CaptureItem => i != null);
}
