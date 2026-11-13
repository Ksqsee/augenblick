// Fachwortschatz des Workspaces für die Regel-Auswertung (ohne KI): Begriffe aus dem Katalog, typische Mängel mit
// Schwere/Maßnahme und sprechbare Element-Nummern („Tür 36“, „Nummer 36“). Läuft im Browser und im Worker.
// Der Katalog selbst liegt je Workspace in D1 (worker/catalog.ts); hier nur reine Funktionen.
import type { CatalogDefect, CatalogProduct, CatalogTerm, Severity } from './catalog';

export type { CatalogDefect, CatalogProduct, CatalogTerm } from './catalog';

// ---------- Normalisieren ----------
/** Kleinbuchstaben, Umlaute ausgeschrieben, nur Buchstaben/Ziffern/Leerzeichen. */
export const foldText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Vergleichsschlüssel für Dubletten (Groß-/Kleinschreibung, Umlaute, Satzzeichen egal). */
export const catalogKey = (...parts: string[]) => parts.map(foldText).join('|');

const STOP = new Set(['oder', 'und', 'nicht', 'eine', 'einer', 'eines', 'einem', 'einen', 'der', 'die', 'das', 'den', 'dem', 'des', 'mit', 'ohne', 'bei', 'beim', 'nach', 'wird', 'ist', 'sind', 'zu', 'im', 'in', 'am', 'an', 'auf']);
const stems = (s: string) =>
  foldText(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => w.slice(0, 6));

// ---------- Begriffe ----------
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Gewöhnliche deutsche Wörter, die zugleich als Abkürzung im Katalog stehen können (HAT, TOR, OST …) */
const COMMON_WORDS = new Set(['hat', 'tor', 'ost', 'bad', 'rat', 'tag', 'alt', 'art', 'not', 'rot', 'gut', 'mal', 'das', 'der', 'die', 'den', 'dem', 'ist', 'und', 'mit', 'von', 'vor', 'aus', 'bei', 'ein', 'man', 'nur', 'neu', 'oft', 'wer', 'wie', 'was', 'wo', 'zur', 'zum']);

/**
 * Abkürzungen im Text durch ihre Bedeutung ersetzen („OTS schließt nicht“ → „Obentürschließer schließt nicht“).
 * Nur ganze Wörter; Abkürzungen mit zwei Zeichen nur in der gespeicherten Schreibweise (sonst würde „st“ o. ä. greifen),
 * längere auch klein gesprochen („ots“). Bindestrich-Wörter bleiben lesbar („RS-Tür“ → „Rauchschutz-Tür“).
 */
export function expandTerms(text: string, terms: Pick<CatalogTerm, 'term' | 'meaning'>[] = []): string {
  if (!terms.length || !text) return text;
  let out = text;
  for (const t of [...terms].sort((a, b) => b.term.length - a.term.length)) {
    const term = t.term.trim();
    if (!term || !t.meaning.trim() || term.length > 40) continue;
    // nicht vor einem Code-Teil oder einer Nummer („FST-7K2M“, „FSA 2“ bleiben Codes bzw. Element-Verweise)
    const re = new RegExp(`(?<![\\p{L}\\d-])${escapeRe(term)}(?![\\p{L}\\d]|[- ]?[A-Za-z]{0,5}\\d)`, term.length <= 2 ? 'gu' : 'giu');
    // klein bzw. anders geschrieben nur, wenn es kein gewöhnliches Wort ist („Zarge hat Rost“ bleibt, „HAT“ wird erklärt)
    out = out.replace(re, (m) => (m !== term && COMMON_WORDS.has(m.toLowerCase()) ? m : t.meaning.trim()));
  }
  return out;
}

// ---------- Mängel ----------
export interface DefectMatch {
  defect: CatalogDefect;
  /** 0–1: Anteil der Wortstämme des besten Ausdrucks (Titel oder Synonym), die im Text vorkommen */
  score: number;
}

/**
 * Passende Katalog-Mängel zum Text, bester zuerst. Ein Ausdruck passt, wenn mindestens zwei seiner Wortstämme
 * (bei Ein-Wort-Ausdrücken: der eine) im Text stehen und mindestens 60 % seiner Stämme vorkommen.
 * Mit `category` nur Mängel dieser Art oder ohne Art.
 */
export function matchCatalogDefects(text: string, defects: CatalogDefect[] = [], opts: { category?: string | null; limit?: number } = {}): DefectMatch[] {
  if (!defects.length) return [];
  const t = new Set(stems(text));
  if (!t.size) return [];
  const out: DefectMatch[] = [];
  for (const d of defects) {
    if (opts.category && d.category && d.category !== opts.category) continue;
    let best = 0;
    for (const phrase of [d.title, ...(d.synonyms ?? [])]) {
      const ws = [...new Set(stems(phrase))];
      if (!ws.length) continue;
      const common = ws.filter((w) => t.has(w)).length;
      if (common < Math.min(2, ws.length)) continue;
      best = Math.max(best, common / ws.length);
    }
    if (best >= 0.6) out.push({ defect: d, score: best });
  }
  return out.sort((a, b) => b.score - a.score || a.defect.title.localeCompare(b.defect.title)).slice(0, opts.limit ?? 5);
}

/** Bester Katalog-Mangel oder null. */
export const matchCatalogDefect = (text: string, defects: CatalogDefect[] = [], category?: string | null): CatalogDefect | null =>
  matchCatalogDefects(text, defects, { category, limit: 1 })[0]?.defect ?? null;

// ---------- Produkte ----------
/** Produkte zur Eingabe (Hersteller und/oder Typ), passende Art zuerst; leere Eingabe = alle der Art. */
export function suggestProducts(query: { manufacturer?: string; model?: string }, products: CatalogProduct[] = [], category?: string | null, limit = 8): CatalogProduct[] {
  const m = foldText(query.manufacturer ?? '');
  const t = foldText(query.model ?? '');
  return products
    .filter((p) => !category || !p.category || p.category === category)
    .filter((p) => (!m || foldText(p.manufacturer).includes(m)) && (!t || foldText(p.model).includes(t) || foldText(`${p.manufacturer} ${p.model}`).includes(t)))
    .sort((a, b) => Number(b.category === category) - Number(a.category === category) || `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`))
    .slice(0, limit);
}

/** Vorgaben eines Produkts auf Stammdaten anwenden: leere Felder füllen, vorhandene Werte bleiben (außer `overwrite`). */
export function applyProductDefaults<T extends Record<string, unknown>>(attrs: T, product: Pick<CatalogProduct, 'defaults' | 'approval'>, allowed: string[], overwrite = false): T {
  const out: Record<string, unknown> = { ...attrs };
  const vals: Record<string, unknown> = { ...product.defaults, ...(product.approval ? { approval: product.approval } : {}) };
  for (const [k, v] of Object.entries(vals)) {
    if (!allowed.includes(k)) continue;
    if (overwrite || out[k] == null || out[k] === '' || out[k] === false) out[k] = v;
  }
  return out as T;
}

// ---------- Sprechbare Nummern ----------
/** Laufende Nummer → Code, z. B. („FST“, 7) → „FST-007“. */
export const numberCode = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;

/**
 * Freier Code für eine laufende Nummer. Codes sind im Workspace eindeutig, Nummern nur je Objekt: Ist „FST-001“ schon
 * in einem anderen Objekt vergeben, wird „FST-001-2“, „FST-001-3“ … gewählt.
 */
export function freeNumberCode(prefix: string, n: number, taken: (code: string) => boolean): string {
  const base = numberCode(prefix, n);
  if (!taken(base)) return base;
  for (let k = 2; k < 1000; k++) if (!taken(`${base}-${k}`)) return `${base}-${k}`;
  throw new Error('Kein freier Code');
}

/** Laufende Nummer aus einem Code („FSA-012“ → 12, „FST-001-2“ → 1); Zufallscodes → null. */
export function codeNumber(code: string): number | null {
  const m = code.match(/^[A-Za-z0-9]{2,5}-(\d{1,5})(?:-\d{1,3})?$/);
  return m ? Number(m[1]) : null;
}

/** Wörter für Elementarten beim Sprechen („Tür 36“, „FSA 2“). Eigene Arten kommen über `categories` hinzu. */
const KIND_WORDS: Record<string, string> = {
  tuer: 'fire_door',
  tuere: 'fire_door',
  feuerschutztuer: 'fire_door',
  brandschutztuer: 'fire_door',
  rauchschutztuer: 'fire_door',
  fst: 'fire_door',
  feststellanlage: 'hold_open',
  feststeller: 'hold_open',
  fsa: 'hold_open',
  klappe: 'damper',
  brandschutzklappe: 'damper',
  bsk: 'damper',
  loescher: 'extinguisher',
  feuerloescher: 'extinguisher',
  fl: 'extinguisher',
  melder: 'smoke_alarm',
  rauchmelder: 'smoke_alarm',
  rauchwarnmelder: 'smoke_alarm',
  rwm: 'smoke_alarm',
};
/** Allgemeine Wörter vor einer Nummer (ohne Art). */
const GENERIC_WORDS = new Set(['nummer', 'nr', 'no', 'element', 'position', 'pos', 'ident', 'identnummer', 'id']);

export interface KindWordSource {
  key: string;
  label: string;
  plural?: string;
  prefix?: string;
}

function kindOf(word: string, categories: KindWordSource[]): string | null {
  const w = foldText(word).replace(/\s+/g, '');
  for (const c of categories) {
    if ([c.label, c.plural ?? '', c.prefix ?? ''].some((f) => f && foldText(f).replace(/\s+/g, '') === w)) return c.key;
  }
  return KIND_WORDS[w] ?? KIND_WORDS[w.replace(/(en|n|e|s)$/, '')] ?? null;
}

export interface ElementRef {
  number: number;
  /** genannte Art (Schlüssel) oder null bei „Nummer 36“ / „36“ */
  category: string | null;
  /** erkannter Textteil, z. B. „Tür 36“ */
  match: string;
}

const NUM = '(\\d{1,5})';
const REF_RE = new RegExp(`(?<![\\p{L}\\d])(\\p{L}[\\p{L}]*)\\.?\\s*(?:-\\s*)?(?:(?:nr|nummer|no)\\.?\\s*)?${NUM}(?![\\p{L}\\d])`, 'giu');

/**
 * Sprechbare Element-Nummer im Text finden: „Tür 36“, „Tür Nr. 36“, „Nummer 36“, „Nr. 36“, „FSA 2“, „FST-036“.
 * Nur mit Art- oder Nummernwort davor (nicht „Raum 306“, nicht „2. OG“). Eine bloße Zahl zählt nur mit `bare: true`
 * und nur, wenn der ganze Text die Zahl ist („36“).
 */
export function findElementRef(text: string, categories: KindWordSource[] = [], opts: { bare?: boolean } = {}): ElementRef | null {
  const t = text.trim();
  if (opts.bare) {
    const m = t.match(/^#?\s*(\d{1,5})$/);
    if (m) return { number: Number(m[1]), category: null, match: t };
  }
  for (const m of t.matchAll(REF_RE)) {
    const word = m[1]!;
    const fw = foldText(word);
    const generic = GENERIC_WORDS.has(fw);
    const kind = generic ? null : kindOf(word, categories);
    if (!generic && !kind) continue;
    // „Tür Nummer 36“: Nummernwort nach Artwort ist im Muster enthalten; „Tür 1. OG“ ist keine Nummer
    const after = t.slice((m.index ?? 0) + m[0].length);
    if (/^\.\s*(og|ug|obergeschoss|etage|stock)\b/i.test(after)) continue;
    const n = Number(m[2]);
    if (!n) continue;
    return { number: n, category: kind, match: m[0].trim() };
  }
  return null;
}

/** Ganze Eingabe als Element-Verweis (Suche, MCP): „Tür 36“, „Nummer 36“, „36“, „FSA-002“. */
export const parseElementRef = (q: string, categories: KindWordSource[] = []): ElementRef | null => {
  const r = findElementRef(q, categories, { bare: true });
  return r && r.match.length >= q.trim().length - 1 ? r : null;
};

export interface NumberedAsset {
  code: string;
  number?: number | null;
  category: string;
}

/**
 * Elemente zu einem Verweis: zuerst gleiche Nummer und passende Art, dann gleiche Nummer (Nummern sind je Objekt über
 * alle Arten eindeutig), zuletzt ältere Codes mit dieser Zahl am Ende („FST-36“).
 */
export function matchElementRef<T extends NumberedAsset>(ref: ElementRef, assets: T[]): T[] {
  const byNumber = assets.filter((a) => a.number === ref.number);
  const typed = ref.category ? byNumber.filter((a) => a.category === ref.category) : byNumber;
  if (typed.length) return typed;
  if (byNumber.length) return byNumber;
  return assets.filter((a) => a.number == null && codeNumber(a.code) === ref.number && (!ref.category || a.category === ref.category));
}

// ---------- Katalog-Abgleich (Stapel aus MCP/Import) ----------
export type CatalogKind = 'products' | 'defects' | 'terms';
const KEY_FIELDS: Record<CatalogKind, string[]> = { products: ['manufacturer', 'model'], defects: ['category', 'title'], terms: ['term'] };

/** Schlüssel eines Eintrags je Liste (Dubletten-Erkennung, eindeutig je Workspace). */
export function entryKey(kind: CatalogKind, e: Record<string, unknown>): string {
  const s = (k: string) => String(e[k] ?? '');
  return catalogKey(...KEY_FIELDS[kind].map(s));
}

export interface MergePlan<T> {
  create: T[];
  update: { id: string; before: Record<string, unknown>; after: T; changes: string[] }[];
  unchanged: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Eingehende Einträge mit dem Bestand abgleichen: neu anlegen oder vorhandene (gleicher Schlüssel) ändern.
 * Nur genannte Felder ändern sich; doppelte Einträge im Stapel zählen einmal (der letzte gilt).
 */
export function planCatalogMerge<T extends Record<string, unknown>>(kind: CatalogKind, existing: (Record<string, unknown> & { id: string })[], incoming: T[]): MergePlan<T> {
  const byKey = new Map(existing.map((e) => [entryKey(kind, e), e]));
  const seen = new Map<string, T>();
  for (const i of incoming) seen.set(entryKey(kind, i), { ...(seen.get(entryKey(kind, i)) ?? {}), ...i });
  const plan: MergePlan<T> = { create: [], update: [], unchanged: 0 };
  for (const [key, inc] of seen) {
    const old = byKey.get(key);
    if (!old) {
      plan.create.push(inc);
      continue;
    }
    // Schlüsselfelder, die sich nur in der Schreibweise unterscheiden, behalten die gespeicherte Form
    const keep = (k: string) => k === 'id' || inc[k] === undefined || (KEY_FIELDS[kind].includes(k) && foldText(String(inc[k])) === foldText(String(old[k] ?? '')));
    const after = { ...old, ...Object.fromEntries(Object.entries(inc).filter(([k]) => !keep(k))) } as unknown as T;
    const changes = Object.keys(inc).filter((k) => !keep(k) && !same(old[k], inc[k]));
    if (changes.length) plan.update.push({ id: old.id, before: old, after, changes });
    else plan.unchanged++;
  }
  return plan;
}

// ---------- Wortschatz im Browser ----------
/**
 * Katalog des angemeldeten Workspaces für die Regel-Auswertung im Browser (Diktat, Vorschläge). Wird nach dem Laden
 * von /catalog gesetzt (src/App.tsx). Im Worker bleibt er leer – dort wird der Katalog je Anfrage übergeben.
 */
let clientVocab: { terms: CatalogTerm[]; defects: CatalogDefect[] } = { terms: [], defects: [] };
export function setClientVocab(v: { terms: CatalogTerm[]; defects: CatalogDefect[] }) {
  clientVocab = { terms: v.terms ?? [], defects: v.defects ?? [] };
}
export const clientVocabulary = () => clientVocab;

export const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];
