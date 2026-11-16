// Angebotsliste (Plan v7, Paket V): offene Mängel eines Objekts → Katalog-Mangel → Leistungen (Bedingung auf die
// Stammdaten des Elements) → Menge → Türnummern → Preis. Reine Funktion; der Endpunkt GET /properties/:id/offer
// (worker/offer.ts) liest Mängel und Katalog und gibt das Ergebnis unverändert weiter. Paket X baut Seite und Export.
import type { CatalogDefect, CatalogService, ServiceCondition } from './catalog';
import { requirementOf } from './catalog-door';
import { foldText, matchCatalogDefects } from './vocab';

export interface OfferDefect {
  id: string;
  title: string;
  /** Elementart (Schlüssel) des Elements oder null (Mangel ohne Element) */
  category: string | null;
  /** Code des Elements (z. B. „T-036“, „FST-7K2M“) oder null */
  code: string | null;
  attributes: Record<string, unknown> | null;
}

export interface OfferLine {
  serviceKey: string;
  title: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Codes der Elemente (Türen), sortiert, ohne Doppelte */
  doors: string[];
  /** IDs der Mängel */
  defects: string[];
}

export interface OfferUnmapped {
  defectId: string;
  title: string;
  /** Code des Elements oder null */
  door: string | null;
  /** warum keine Position (Zusatz zur Form aus dem Plan) */
  reason: string;
}

export interface Offer {
  lines: OfferLine[];
  unmapped: OfferUnmapped[];
  /** Summe netto in Euro */
  net: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Menge auf drei Nachkommastellen (lfm), ohne Rundungsrauschen */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const fold = (v: unknown) => foldText(String(v ?? '')).replace(/\s+/g, '');
const truthy = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^(ja|j|yes|true|1|x|vorhanden|mit)$/i.test(s)) return true;
  if (/^(nein|n|no|false|0|keine?|ohne)$/i.test(s)) return false;
  return null;
};

export type ConditionResult = { ok: true } | { ok: false; missing: string[] };

/**
 * Passt die Bedingung einer Leistung zu den Stammdaten? Alle Felder müssen passen; eine Liste heißt „einer davon“.
 * `requirement` kommt bei älteren Türen aus Feuerwiderstand/Rauchschutz. Fehlt ein Stammdatum, ist es „unbekannt“
 * (Rückgabe mit `missing`), nicht „passt nicht“.
 */
export function conditionMatches(cond: ServiceCondition | null | undefined, attrs: Record<string, unknown> | null | undefined): ConditionResult & { mismatch?: boolean } {
  const missing: string[] = [];
  let mismatch = false;
  for (const [k, want] of Object.entries(cond ?? {})) {
    const have = k === 'requirement' ? requirementOf(attrs) : attrs?.[k];
    if (have == null || have === '') {
      missing.push(k);
      continue;
    }
    let hit: boolean;
    if (typeof want === 'boolean') hit = truthy(have) === want;
    else if (Array.isArray(want)) hit = want.some((w) => fold(w) === fold(have));
    else hit = fold(want) === fold(have);
    if (!hit) mismatch = true;
  }
  if (mismatch) return { ok: false, missing, mismatch: true };
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Katalog-Mangel zum Mangeltext: gleiche Bezeichnung bzw. Formulierung, sonst bester klarer Treffer der Art. */
export function catalogDefectFor(d: Pick<OfferDefect, 'title' | 'category'>, defects: CatalogDefect[]): CatalogDefect | null {
  const fits = (x: CatalogDefect) => !x.category || !d.category || x.category === d.category;
  const t = fold(d.title);
  const exact =
    defects.find((x) => fits(x) && x.category === d.category && fold(x.title) === t) ??
    defects.find((x) => fits(x) && fold(x.title) === t) ??
    defects.find((x) => fits(x) && (x.synonyms ?? []).some((s) => fold(s) === t));
  if (exact) return exact;
  const m = matchCatalogDefects(d.title, defects, { category: d.category, limit: 2 });
  if (!m[0] || m[0].score < 0.75) return null;
  // nicht eindeutig (zwei gleich gute) → lieber keine Zuordnung
  if (m[1] && m[1].score >= m[0].score) return null;
  return m[0].defect;
}

const LABEL: Record<string, string> = { requirement: 'Anforderung', leaves: 'Flügel', soundproof: 'Schallschutz', holdOpen: 'Feststellanlage' };

/**
 * Angebotsliste rechnen: je offenem Mangel die zugeordneten Leistungen, deren Bedingung zu den Stammdaten passt;
 * gleiche Leistungen werden zusammengefasst (Mengen summiert, Türen und Mängel gesammelt). Mängel ohne Katalog-Mangel,
 * ohne Zuordnung oder ohne passende Leistung stehen unter `unmapped` (mit Grund).
 */
export function computeOffer(defects: OfferDefect[], catalogDefects: CatalogDefect[], services: CatalogService[]): Offer {
  const byKey = new Map(services.map((s) => [fold(s.key), s]));
  const lines = new Map<string, OfferLine & { order: number }>();
  const unmapped: OfferUnmapped[] = [];
  let order = 0;
  for (const d of defects) {
    const cd = catalogDefectFor(d, catalogDefects);
    const miss = (reason: string) => unmapped.push({ defectId: d.id, title: d.title, door: d.code, reason });
    if (!cd) {
      miss('Kein passender Katalog-Mangel');
      continue;
    }
    const candidates = (cd.serviceKeys ?? [])
      .map((k) => byKey.get(fold(k)))
      .filter((s): s is CatalogService => !!s && (!s.category || !d.category || s.category === d.category));
    if (!candidates.length) {
      miss(cd.serviceKeys?.length ? 'Zugeordnete Leistung fehlt im Katalog' : 'Keine Leistung zugeordnet');
      continue;
    }
    const chosen: CatalogService[] = [];
    const missing = new Set<string>();
    for (const s of candidates) {
      const r = conditionMatches(s.condition, d.attributes);
      if (r.ok) chosen.push(s);
      else if (!r.mismatch) r.missing.forEach((m) => missing.add(m));
    }
    if (!chosen.length) {
      miss(missing.size ? `Stammdaten fehlen: ${[...missing].map((m) => LABEL[m] ?? m).join(', ')}` : 'Keine Leistung passt zu den Stammdaten');
      continue;
    }
    const qty = cd.quantity && cd.quantity > 0 ? cd.quantity : 1;
    for (const s of chosen) {
      const k = fold(s.key);
      const line =
        lines.get(k) ??
        ({ serviceKey: s.key, title: s.title, unit: s.unit, unitPrice: round2(s.price), quantity: 0, total: 0, doors: [], defects: [], order: order++ } as OfferLine & { order: number });
      line.quantity = round3(line.quantity + qty);
      if (d.code && !line.doors.includes(d.code)) line.doors.push(d.code);
      if (!line.defects.includes(d.id)) line.defects.push(d.id);
      lines.set(k, line);
    }
  }
  const out = [...lines.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _o, ...l }) => ({ ...l, total: round2(l.unitPrice * l.quantity), doors: [...l.doors].sort(codeSort) }));
  return { lines: out, unmapped, net: round2(out.reduce((n, l) => n + l.total, 0)) };
}

/** Codes natürlich sortiert: T-2 vor T-10 */
const codeSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
