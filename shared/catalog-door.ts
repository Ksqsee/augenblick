// Elementart „Tür“ (Plan v7, V): Feld Anforderung (keine · RS · T30 · T30-RS · T90 · T90-RS) statt Feuerwiderstand
// (`rating`) und Rauchschutz (`smoke`). Ältere Daten und Eingaben mit den alten Feldnamen werden hier umgerechnet –
// beim Lesen (Bedingungen, Angebotsliste) und beim Schreiben (API, MCP, Import).

export const REQUIREMENTS = ['keine', 'RS', 'T30', 'T30-RS', 'T90', 'T90-RS'] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/** Anforderungen mit Feuerwiderstand (Brandschutz-Prüfpunkte) bzw. mit Rauchschutz. */
export const FIRE_REQUIREMENTS: Requirement[] = ['T30', 'T30-RS', 'T90', 'T90-RS'];
export const SMOKE_REQUIREMENTS: Requirement[] = ['RS', 'T30-RS', 'T90-RS'];
/** Alles außer „keine“: Tür mit Zulassung bzw. Prüfzeugnis. */
export const RATED_REQUIREMENTS: Requirement[] = ['RS', 'T30', 'T30-RS', 'T90', 'T90-RS'];

const fold = (s: unknown) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[–—]/g, '-');

const YES = /^(ja|j|yes|true|1|x|vorhanden|mit)$/i;
const NO = /^(nein|n|no|false|0|keine?|ohne)$/i;
const truthy = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return YES.test(s) ? true : NO.test(s) ? false : null;
};

/** Feuerwiderstand aus alten Werten: T30/EI2 30 → 30, T90/EI2 90 → 90; T60/EI2 60 gibt es in der Auswahl nicht. */
function fireClass(rating: unknown): 30 | 90 | 'none' | null {
  const r = fold(rating);
  if (!r) return null;
  if (/^(T0|OHNE|KEINE?|-)$/.test(r)) return 'none';
  const m = r.match(/^(?:T|EI2?|EI)-?(30|60|90)/);
  if (!m) return null;
  return m[1] === '30' ? 30 : m[1] === '90' ? 90 : null;
}

/**
 * Anforderung aus Text: „T30-RS“, „T30 RS“, „t30rs“, „RS“, „T90“, „keine“, „T0“, „EI2 30 Sa“, „RS / SSK 3“.
 * Null, wenn nichts Eindeutiges darin steht.
 */
export function parseRequirement(text: unknown): Requirement | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const exact = REQUIREMENTS.find((r) => fold(r) === fold(raw));
  if (exact) return exact;
  if (/^(ohne|keine?|t0|-|–)$/i.test(raw)) return 'keine';
  const s = raw.toUpperCase();
  const fire = s.match(/(?<![A-Z\d])(?:T|EI2?)\s?-?(30|90)(?!\d)/);
  const smoke = /(?<![A-Z])(RS|SA|S200)(?![A-Z])/.test(s) || /RAUCHSCHUTZ|RAUCHDICHT/.test(s);
  if (fire) return `T${fire[1]}${smoke ? '-RS' : ''}` as Requirement;
  if (/(?<![A-Z\d])(?:T|EI2?)\s?-?60(?!\d)/.test(s)) return null;
  return smoke ? 'RS' : null;
}

/**
 * Anforderung eines Elements: gespeichertes Feld `requirement` oder – für Bestand und alte Eingaben – aus
 * `rating` + `smoke`. Null, wenn unbekannt (z. B. nur „smoke: false“ ohne Feuerwiderstand oder T60).
 */
export function requirementOf(attrs: Record<string, unknown> | null | undefined): Requirement | null {
  if (!attrs) return null;
  const direct = attrs.requirement != null && attrs.requirement !== '' ? parseRequirement(attrs.requirement) : null;
  if (direct) return direct;
  const fire = fireClass(attrs.rating);
  const smoke = truthy(attrs.smoke);
  if (fire === 30 || fire === 90) return `T${fire}${smoke ? '-RS' : ''}` as Requirement;
  if (fire === 'none') return smoke ? 'RS' : 'keine';
  if (fire === null && attrs.rating != null && attrs.rating !== '') return null; // T60 o. Ä.: nicht umrechenbar
  if (smoke === true) return 'RS';
  return null;
}

/** Hat die Anforderung Feuerwiderstand bzw. Rauchschutz? */
export const isFireRated = (r: Requirement | null) => (r ? FIRE_REQUIREMENTS.includes(r) : null);
export const isSmokeTight = (r: Requirement | null) => (r ? SMOKE_REQUIREMENTS.includes(r) : null);

export interface LegacyResult {
  attrs: Record<string, unknown>;
  /** Fehlermeldung, wenn alte Werte sich nicht umrechnen lassen (z. B. „T45“) */
  error?: string;
}

/**
 * Eingabe mit alten Feldnamen (`rating`, `smoke`) in `requirement` umrechnen und die alten Felder entfernen.
 * Ein ausdrücklich angegebenes `requirement` gewinnt. Nicht umrechenbare Werte (T45, T60) ergeben einen Fehler mit
 * den erlaubten Werten – so bleibt die Meldung bei MCP und API verständlich.
 */
export function normalizeDoorInput(input: Record<string, unknown>): LegacyResult {
  if (!('rating' in input) && !('smoke' in input)) return { attrs: input };
  const { rating, smoke, ...rest } = input;
  if (rest.requirement != null && rest.requirement !== '') return { attrs: rest };
  const ratingSet = rating != null && rating !== '';
  if (ratingSet && fireClass(rating) == null)
    return { attrs: rest, error: `Feuerwiderstand „${String(rating)}“ gibt es nicht – Anforderung möglich: ${REQUIREMENTS.join(', ')}.` };
  const req = requirementOf({ rating, smoke });
  if (req) return { attrs: { ...rest, requirement: req } };
  return { attrs: rest };
}

/** Stammdaten einer Tür beim Lesen: `requirement` ergänzen, wenn nur alte Felder da sind (die bleiben stehen). */
export function withRequirement<T extends Record<string, unknown>>(attrs: T): T & { requirement?: Requirement } {
  if (!attrs || (attrs.requirement != null && attrs.requirement !== '')) return attrs;
  const r = requirementOf(attrs);
  return r ? { ...attrs, requirement: r } : attrs;
}
