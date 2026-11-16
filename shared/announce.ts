// „Tür ansagen“ (Plan v7, Paket W): „Tür 354, Typ SK32“ → Nummer, Standort und Typ aus dem Katalog. Läuft im
// Browser (auch ohne Netz, mit dem geladenen Katalog) und im Worker (MCP inspect). Reine Regeln, keine KI.
// Dazu das Rohdiktat an der Prüfung: was gesagt oder getippt wurde, bleibt als Text erhalten, bis Claude es auswertet.
import type { AttributeField, CatalogProduct } from './catalog';
import { normalizeSpeech, suggestSeverity } from './smart';
import { codeNumber, describeByType, foldText } from './vocab';

// ---------- Rohdiktat ----------
export type RawNoteSource = 'app' | 'offline' | 'mcp';
/** announce = Ansage an der Tür, finding = Befund, type = gesprochener Typ, der nicht im Katalog steht */
export type RawNoteKind = 'announce' | 'finding' | 'type';

export interface RawNote {
  id: string;
  text: string;
  /** Zeitpunkt der Eingabe (ms) */
  at: number;
  source: RawNoteSource;
  kind?: RawNoteKind;
  /** von Claude (oder in der App von Hand) ausgewertet */
  evaluated: boolean;
  evaluatedAt?: number | null;
  /** grobe Einordnung durch den Regel-Parser, z. B. „1 Mangel: Türstopper fehlt“ */
  summary?: string;
  /** kritisches Wort erkannt („sofort“, „Brandgefahr“ …) */
  critical?: boolean;
}

/** Höchstzahl Rohnotizen je Prüfung und Länge je Text. */
export const RAW_NOTES_MAX = 50;
export const RAW_NOTE_TEXT_MAX = 2000;

export const RAW_SOURCE_LABEL: Record<RawNoteSource, string> = { app: 'App', offline: 'Offline', mcp: 'Claude' };

export const pendingRawNotes = (notes: RawNote[] | null | undefined) => (notes ?? []).filter((n) => !n.evaluated);

/** Neue Rohnotiz (ID im Browser über crypto.randomUUID, im Worker ebenso). */
export function rawNote(text: string, source: RawNoteSource, kind: RawNoteKind, extra: Partial<RawNote> = {}): RawNote {
  const t = text.trim().slice(0, RAW_NOTE_TEXT_MAX);
  return {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 20),
    text: t,
    at: Date.now(),
    source,
    kind,
    evaluated: false,
    critical: kind !== 'type' && suggestSeverity(t, []) === 'critical' ? true : undefined,
    ...extra,
  };
}

/** Neue Notizen anhängen (gleiche ID nur einmal), höchstens RAW_NOTES_MAX – die ältesten ausgewerteten fallen zuerst weg. */
export function mergeRawNotes(prev: RawNote[], add: RawNote[]): RawNote[] {
  const out = [...prev];
  for (const n of add) if (n.text && !out.some((o) => o.id === n.id)) out.push(n);
  while (out.length > RAW_NOTES_MAX) {
    const i = out.findIndex((n) => n.evaluated);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}

// ---------- Zahlwörter ----------
const UNIT: Record<string, number> = { null: 0, ein: 1, eins: 1, eine: 1, einen: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TEEN: Record<string, number> = {
  zehn: 10,
  elf: 11,
  zwoelf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fuenfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
};
const TENS: Record<string, number> = { zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };
const UNIT_RE = '(ein|zwei|zwo|drei|vier|fuenf|sechs|sieben|acht|neun)';

function below100(s: string): number | null {
  const x = s.replace(/^und/, '');
  if (x === '') return 0;
  if (x in UNIT) return UNIT[x]!;
  if (x in TEEN) return TEEN[x]!;
  if (x in TENS) return TENS[x]!;
  const m = x.match(new RegExp(`^${UNIT_RE}und(${Object.keys(TENS).join('|')})$`));
  return m ? UNIT[m[1]!]! + TENS[m[2]!]! : null;
}

function below1000(s: string): number | null {
  const h = s.indexOf('hundert');
  if (h < 0) return below100(s);
  const left = s.slice(0, h);
  const l = left === '' ? 1 : below100(left);
  if (l == null || l < 1 || l > 9) return null;
  const right = below100(s.slice(h + 7));
  return right == null ? null : l * 100 + right;
}

/**
 * Zahl aus Ziffern oder deutschen Zahlwörtern bis 99 999 („dreihundertvierundfünfzig“, „drei hundert vier und
 * fünfzig“, „achthundertzehn“, „tausendzwei“). Unbekanntes → null.
 */
export function germanNumber(word: string): number | null {
  let s = foldText(word).replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d{1,5}$/.test(s)) return Number(s);
  let total = 0;
  const t = s.indexOf('tausend');
  if (t >= 0) {
    const left = s.slice(0, t);
    const l = left === '' ? 1 : below1000(left);
    if (l == null || l < 1 || l > 99) return null;
    total = l * 1000;
    s = s.slice(t + 7);
    if (s === '') return total;
  }
  const r = below1000(s);
  if (r == null) return null;
  const n = total + r;
  return n >= 0 && n <= 99_999 ? n : null;
}

// ---------- Ansage zerlegen ----------
const fold1 = (w: string) => foldText(w).replace(/\s+/g, '');
const DOOR_WORDS = new Set(['tuer', 'tuere', 'tur', 'door', 'nummer', 'nr', 'ident', 'identnummer', 'identnr', 'element']);
const ROOM_WORDS: Record<string, string> = {
  raum: 'Raum',
  zimmer: 'Zimmer',
  zi: 'Zimmer',
  zimmernummer: 'Zimmer',
  buero: 'Büro',
  wohnung: 'Wohnung',
  whg: 'Wohnung',
  apartment: 'Apartment',
  appartement: 'Apartment',
};
const TYPE_WORDS = new Set(['typ', 'tuertyp', 'type', 'modell', 'bauart', 'model']);
const FILLER = new Set(['im', 'in', 'der', 'die', 'das', 'vom', 'von', 'beim', 'am', 'an', 'mit', 'ist', 'eine', 'ein', 'also', 'so']);
const SAME_TYPE = [
  'gleicher typ',
  'gleiche typ',
  'gleichen typ',
  'selber typ',
  'selbe typ',
  'derselbe typ',
  'gleiches modell',
  'gleiche tuer',
  'gleiche wie vorher',
  'gleiche wie eben',
  'nochmal so eine',
  'noch mal so eine',
  'noch so eine',
  'nochmal so einen',
  'noch so einer',
  'auch so eine',
  'wie vorher',
  'wie eben',
  'wie die letzte',
  'wie davor',
  'dito',
  'ebenso',
];
const isNumberish = (w: string) => /^\d{1,5}[a-z]?$/i.test(w) || /^[a-zäöüß]+$/i.test(w);

export interface Announcement {
  /** angesagte Nummer (Ident-Nr.) – feste Nummer der Tür im Objekt */
  number: number | null;
  /** Standort, z. B. „Raum 354“ oder „Zimmer 810“ */
  location: string;
  /** gesprochener Typ (geglättet), leer wenn keiner genannt */
  typeText: string;
  /** „gleicher Typ“, „nochmal so eine“ → letzten Typ übernehmen */
  sameType: boolean;
  /** was nach der Ansage gesagt wurde („…, Türstopper fehlt“) */
  finding: string;
  /** der ganze Text, wie er ankam */
  text: string;
}

/** Zahl ab Position i (Ziffern oder bis zu fünf Zahlwörter); liefert Zahl, Anzahl Wörter und Schreibweise. */
function numberAt(words: string[], i: number): { n: number; len: number; shown: string } | null {
  for (let k = Math.min(6, words.length - i); k >= 1; k--) {
    const part = words.slice(i, i + k);
    if (!part.every((w) => isNumberish(w.replace(/[^\p{L}\d]/gu, '')))) continue;
    const digits = k === 1 ? part[0]!.match(/^(\d{1,5})([a-z]?)$/i) : null;
    if (digits) return { n: Number(digits[1]), len: 1, shown: part[0]! };
    // „eine Tür“: Artikel sind keine Nummer
    if (k === 1 && ['ein', 'eine', 'einen', 'null'].includes(fold1(part[0]!))) continue;
    const n = germanNumber(part.join(''));
    if (n != null) return { n, len: k, shown: String(n) };
  }
  return null;
}

/** Text aufteilen: Abschnitte an Satzzeichen bzw. Gedankenstrichen (nicht im Wort: „T30-RS“ bleibt). */
const segments = (t: string) =>
  t
    .replace(/(?<![\p{L}])(Nr|Zi)\./giu, '$1')
    .split(/\s*(?:[,;:.!?]+|\s[–—-]\s)\s*/u)
    .map((x) => x.trim())
    .filter(Boolean);

/** Gesprochene Ansage zerlegen: Nummer, Standort, Typ, „gleicher Typ“ und anschließender Befund. */
export function parseAnnouncement(input: string): Announcement {
  const text = input.trim();
  const norm = normalizeSpeech(text)
    // „R S“ / „r s“ → RS, „T dreißig R S“ ist nach normalizeSpeech „T30 R S“
    .replace(/(?<![\p{L}])[Rr]\s[Ss](?![\p{L}])/gu, 'RS');
  const segs = segments(norm);
  let number: number | null = null;
  let location = '';
  let typeText = '';
  let sameType = false;
  let headEnd = -1;
  let preSame = false;
  const isSame = (s: string) => {
    const f = ` ${foldText(s)} `;
    return SAME_TYPE.some((p) => f.includes(` ${p} `));
  };
  for (let si = 0; si < segs.length; si++) {
    const words = segs[si]!.split(/\s+/);
    const folded = words.map(fold1);
    // Kopf: erster Abschnitt mit Tür-/Raumnummer
    if (headEnd < 0) {
      const used = new Set<number>();
      let doorNo: number | null = null;
      let room: { label: string; shown: string; n: number } | null = null;
      for (let i = 0; i < words.length; i++) {
        const w = folded[i]!;
        const roomLabel = ROOM_WORDS[w];
        if (!DOOR_WORDS.has(w) && !roomLabel) continue;
        let j = i + 1;
        if (folded[j] === 'nummer' || folded[j] === 'nr') j++;
        const num = numberAt(words, j);
        if (!num) continue;
        for (let k = i; k < j + num.len; k++) used.add(k);
        if (roomLabel) room ??= { label: roomLabel, shown: num.shown, n: num.n };
        else doorNo ??= num.n;
        i = j + num.len - 1;
      }
      if (doorNo == null && !room) {
        // keine Nummer: „nochmal so eine, Tür 356“ – der Typ-Hinweis darf vorne stehen
        if (isSame(segs[si]!)) preSame = true;
        continue;
      }
      headEnd = si;
      number = doorNo ?? room!.n;
      location = room ? `${room.label} ${room.shown}` : `Raum ${number}`;
      sameType = preSame || isSame(segs[si]!);
      const rest = words.map((w, k) => (used.has(k) ? null : w)).filter((w): w is string => w != null);
      const kw = rest.findIndex((w) => TYPE_WORDS.has(fold1(w)));
      let tt = kw >= 0 ? rest.slice(kw + 1) : rest;
      while (tt.length && FILLER.has(fold1(tt[0]!))) tt = tt.slice(1);
      if (!sameType) typeText = tt.join(' ');
      continue;
    }
    // weitere Abschnitte direkt nach dem Kopf: „Typ SK32“, „gleicher Typ“
    if (si === headEnd + 1 && !typeText && !sameType) {
      if (isSame(segs[si]!)) {
        sameType = true;
        headEnd = si;
        continue;
      }
      if (TYPE_WORDS.has(folded[0]!)) {
        typeText = words.slice(1).join(' ');
        headEnd = si;
        continue;
      }
    }
    break;
  }
  if (headEnd < 0) return { number: null, location: '', typeText: '', sameType: isSame(norm), finding: '', text };
  const finding = segs.slice(headEnd + 1).join(', ');
  return { number, location, typeText: typeText.trim(), sameType, finding, text };
}

// ---------- Typ im Katalog finden ----------
/** Hersteller-Kurzformen, wie sie gesprochen oder in Listen geschrieben werden („Novo“ → Novoferm). */
export const MANUFACTURER_SHORT: Record<string, string[]> = {
  novoferm: ['novo'],
  schueco: ['schueko', 'schuko', 'schuco'],
  hoermann: ['hormann', 'hoerman'],
  westaggetalit: ['westag', 'getalit', 'wg'],
  teckentrup: ['tecke', 'teckentrupp'],
  schoerghuber: ['schorghuber'],
  jeldwen: ['jeldwen'],
  ferrowicstyle: ['ferro', 'wicstyle'],
  dormakaba: ['dorma', 'kaba'],
  dorma: ['dormakaba'],
};

type ProductLike = Pick<CatalogProduct, 'id' | 'manufacturer' | 'model' | 'category'> & { aliases?: string[] | null } & Partial<CatalogProduct>;

/** Schreibweisen des Herstellers (gefaltet, ohne Leerzeichen). */
export function manufacturerForms(manufacturer: string): string[] {
  const full = fold1(manufacturer);
  if (!full) return [];
  const forms = new Set([full]);
  const first = foldText(manufacturer).split(' ')[0] ?? '';
  if (first.length >= 4) forms.add(first);
  for (const [k, v] of Object.entries(MANUFACTURER_SHORT)) if (full.includes(k)) v.forEach((x) => forms.add(x));
  return [...forms];
}

/** So kann der Typ genannt werden: Aliasse (Paket V), Modell, Hersteller + Modell (auch mit Kurzform). */
export function productPhrases(p: Pick<ProductLike, 'manufacturer' | 'model' | 'aliases'>): string[] {
  const out = new Set<string>();
  for (const a of Array.isArray(p.aliases) ? p.aliases : []) if (typeof a === 'string' && fold1(a)) out.add(fold1(a));
  const model = fold1(p.model);
  if (model) {
    out.add(model);
    for (const m of manufacturerForms(p.manufacturer)) out.add(m + model);
  }
  return [...out];
}

export interface TypeMatch<P extends ProductLike = ProductLike> {
  /** eindeutiger Treffer */
  product: P | null;
  /** mehrere passen gleich gut (zur Auswahl) */
  candidates: P[];
  /** Wörter nach dem erkannten Typ – das ist schon der Befund */
  rest: string;
}

/**
 * Typ zum gesprochenen Text: längster zusammenhängender Treffer (Leerzeichen und Bindestriche egal, „SK 32“ = „SK32“,
 * „T30 RS“ = „T30-RS“). Passen mehrere gleich lang, gewinnt der Hersteller, der im Text vorkommt; sonst Auswahl.
 * Nur Hersteller genannt → dessen Typen zur Auswahl.
 */
export function matchProductType<P extends ProductLike>(typeText: string, products: P[], category?: string | null): TypeMatch<P> {
  const none: TypeMatch<P> = { product: null, candidates: [], rest: '' };
  const words = typeText.split(/\s+/).filter(Boolean);
  if (!words.length) return none;
  const wf = words.map(fold1);
  const pool = products.filter((p) => !category || !p.category || p.category === category);
  let best: { len: number; end: number; ps: P[] } = { len: 0, end: -1, ps: [] };
  for (const p of pool) {
    const phrases = productPhrases(p);
    for (let i = 0; i < wf.length; i++) {
      let acc = '';
      for (let j = i; j < Math.min(wf.length, i + 8); j++) {
        acc += wf[j];
        if (!acc || !phrases.includes(acc)) continue;
        if (acc.length > best.len) best = { len: acc.length, end: j, ps: [p] };
        else if (acc.length === best.len && !best.ps.includes(p)) {
          best.ps.push(p);
          best.end = Math.max(best.end, j);
        }
      }
    }
  }
  const all = wf.join('');
  if (best.ps.length) {
    let ps = best.ps;
    if (ps.length > 1) {
      // Hersteller im Text entscheidet
      const named = ps.filter((p) => manufacturerForms(p.manufacturer).some((m) => all.includes(m)));
      if (named.length) ps = named;
    }
    const rest = words
      .slice(best.end + 1)
      .join(' ')
      .replace(/^(?:und|,)\s+/i, '')
      .trim();
    return ps.length === 1 ? { product: ps[0]!, candidates: [], rest } : { product: null, candidates: ps, rest };
  }
  // nur der Hersteller: seine Typen zur Auswahl
  const byMaker = pool.filter((p) => manufacturerForms(p.manufacturer).some((m) => wf.includes(m) || all === m));
  if (byMaker.length === 1) return { product: byMaker[0]!, candidates: [], rest: '' };
  return { product: null, candidates: byMaker.slice(0, 8), rest: '' };
}

/**
 * Typen, deren Schreibweise (Alias, Typ, Hersteller + Typ, auch mit Hersteller-Kurzform) dem ganzen Text entspricht –
 * die strenge Form von `matchProductType` für Listen, in denen die Zelle nur den Typ enthält (Import).
 */
export function wholeTypeMatches<P extends Pick<ProductLike, 'manufacturer' | 'model' | 'category' | 'aliases'>>(typeText: string, products: P[], category?: string | null): P[] {
  const t = fold1(typeText);
  if (!t) return [];
  return products.filter((p) => (!category || !p.category || p.category === category) && productPhrases(p).includes(t));
}

/** Modell-Eintrag für Türen, deren Typ nicht im Katalog steht. */
export const UNKNOWN_TYPE = 'unbekannt';

/** Kurzform eines Typs für Anzeige und Rohnotiz. */
export const productLabel = (p: Pick<CatalogProduct, 'manufacturer' | 'model'>) => [p.manufacturer, p.model].filter(Boolean).join(' ');

export interface AnnouncedType<P extends ProductLike = ProductLike> {
  product: P | null;
  candidates: P[];
  /** Typ genannt, aber nicht im Katalog (oder gar keiner genannt) */
  unknown: boolean;
  /** Befund aus dem Rest nach dem Typ bzw. nach der Ansage */
  finding: string;
}

/** Typ der Ansage auflösen: „gleicher Typ“ → letzter, sonst Katalog. */
export function resolveAnnouncedType<P extends ProductLike>(a: Announcement, products: P[], last?: P | null, category = 'fire_door'): AnnouncedType<P> {
  if (a.sameType) return { product: last ?? null, candidates: [], unknown: !last, finding: a.finding };
  if (!a.typeText) return { product: null, candidates: [], unknown: true, finding: a.finding };
  const m = matchProductType(a.typeText, products, category);
  const finding = [m.rest, a.finding].filter(Boolean).join(', ');
  if (m.product) return { product: m.product, candidates: [], unknown: false, finding };
  return { product: null, candidates: m.candidates, unknown: !m.candidates.length, finding };
}

export interface AnnounceAssetBody {
  category: string;
  number: number;
  location: string;
  manufacturer: string;
  model: string;
  attributes: Record<string, string | number | boolean | null>;
}

/**
 * Neue Tür aus der Ansage: feste Nummer, Standort, Stammdaten aus dem Katalog-Typ (bzw. Typ „unbekannt“ ohne
 * Stammdaten – allgemeine Checkliste). Ein bekannter Typ beschreibt die Tür vollständig (`describeByType`).
 */
export function announcedAssetBody(
  a: Pick<Announcement, 'number' | 'location'>,
  product: ProductLike | null,
  fields: Pick<AttributeField, 'key' | 'type' | 'options'>[],
  category = 'fire_door',
): AnnounceAssetBody {
  if (a.number == null) throw new Error('Nummer fehlt');
  const cat = product?.category || category;
  return {
    category: cat,
    number: a.number,
    location: a.location || `Raum ${a.number}`,
    manufacturer: product?.manufacturer ?? '',
    model: product?.model ?? UNKNOWN_TYPE,
    attributes: product
      ? (describeByType(
          {},
          { defaults: product.defaults ?? {}, approval: product.approval ?? '', requirement: product.requirement, model: product.model },
          fields,
          cat,
        ) as AnnounceAssetBody['attributes'])
      : {},
  };
}

export interface NumberedAsset {
  id: string;
  code: string;
  number?: number | null;
  category: string;
}

/**
 * Element mit der angesagten Nummer im Objekt: gleiche Art → gefunden; nur andere Arten → Widerspruch
 * („Nummer 354 ist ein Feuerlöscher (FL-354)“, wie Plan v6 A1); nichts → anlegen.
 */
export function findAnnounced<A extends NumberedAsset>(number: number, assets: A[], category: string, labelOf: (key: string) => string): { asset: A } | { conflict: string } | null {
  const hits = assets.filter((x) => (x.number != null ? x.number === number : codeNumber(x.code) === number));
  const same = hits.find((x) => x.category === category);
  if (same) return { asset: same };
  const other = hits[0];
  if (other) return { conflict: `Nummer ${number} ist ${/e$/.test(labelOf(other.category)) ? 'eine' : 'ein'} ${labelOf(other.category)} (${other.code})` };
  return null;
}
