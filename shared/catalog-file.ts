// Katalog-Datei (Plan v7, Paket V): eine JSON-Datei mit Leistungen, Produkten (Türtypen mit Aliassen), Katalog-Mängeln
// (mit Zuordnung zu Leistungen) und Begriffen – z. B. docs/wissen/katalog-seehafer.json. Die Katalogseite lädt sie
// („Aus Datei laden“) über denselben Stapel-Endpunkt wie MCP `catalog upsert` (POST /catalog/batch): erst Vorschau,
// dann übernehmen. Einträge mit `unsicher: true` und `notiz` werden zu einer Notiz „Unsicher: …“.
import type { CatalogKind } from './vocab';
import { foldText } from './vocab';
import type { CatalogProduct } from './catalog';
import { wholeTypeMatches } from './announce';

export const CATALOG_FILE_FORMAT = 'pruefkompass-katalog';
/** Reihenfolge beim Laden: Leistungen vor den Mängeln, die auf sie verweisen */
export const CATALOG_FILE_ORDER: CatalogKind[] = ['services', 'products', 'defects', 'terms'];
/** Höchstzahl je Aufruf des Stapel-Endpunkts */
export const BATCH_SIZE = 200;

export interface CatalogFile {
  format: string;
  version: number;
  titel?: string;
  stand?: string;
  quelle?: string;
  hinweis?: string;
  services?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  defects?: Record<string, unknown>[];
  terms?: Record<string, unknown>[];
}

/** Datei lesen und grob prüfen; Fehler als deutscher Satz. */
export function parseCatalogFile(text: string): CatalogFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  const d = doc as CatalogFile;
  if (!d || typeof d !== 'object' || d.format !== CATALOG_FILE_FORMAT) throw new Error(`Keine Katalog-Datei (Feld „format“ muss „${CATALOG_FILE_FORMAT}“ sein).`);
  if (d.version !== 1) throw new Error(`Version ${String(d.version)} wird nicht unterstützt.`);
  for (const k of CATALOG_FILE_ORDER) if (d[k] != null && !Array.isArray(d[k])) throw new Error(`„${k}“ muss eine Liste sein.`);
  return d;
}

/** Eintrag der Datei → Eintrag für den Stapel-Endpunkt (ohne `unsicher`/`notiz`, die gehen in `note`). */
export function fileItem(kind: CatalogKind, item: Record<string, unknown>): Record<string, unknown> {
  const { unsicher, notiz, ...rest } = item;
  if (kind === 'terms') return rest;
  const notes = [typeof rest.note === 'string' ? rest.note : '', typeof notiz === 'string' ? notiz : ''].filter(Boolean).join(' ');
  if (unsicher === true) rest.note = `Unsicher: ${notes || 'bitte prüfen'}`.slice(0, 500);
  else if (notes) rest.note = notes.slice(0, 500);
  return rest;
}

/** Stapel je Liste (höchstens BATCH_SIZE Einträge je Stapel), in Ladereihenfolge. */
export function catalogFileBatches(doc: CatalogFile): { kind: CatalogKind; items: Record<string, unknown>[] }[] {
  const out: { kind: CatalogKind; items: Record<string, unknown>[] }[] = [];
  for (const kind of CATALOG_FILE_ORDER) {
    const items = (doc[kind] ?? []).map((x) => fileItem(kind, x));
    for (let i = 0; i < items.length; i += BATCH_SIZE) out.push({ kind, items: items.slice(i, i + BATCH_SIZE) });
  }
  return out;
}

/** Wie viele Einträge je Liste sind als unsicher markiert? */
export function uncertainCounts(doc: CatalogFile): Record<CatalogKind, number> {
  const n = (k: CatalogKind) => (doc[k] ?? []).filter((x) => x.unsicher === true).length;
  return { services: n('services'), products: n('products'), defects: n('defects'), terms: n('terms') };
}

const key = (s: string) => foldText(s).replace(/\s+/g, '');

/**
 * Katalog-Produkt zu einem genannten Typ („SK32“, „T30 RS“, „Premio T30-RS“, „Hörmann H3“): Alias, Typ oder
 * Hersteller + Typ. Passen mehrere, entscheidet der Hersteller (falls genannt); bleibt es mehrdeutig, kein Treffer.
 * Ist ein Hersteller genannt und passt er nicht zum einzigen Treffer, ebenfalls kein Treffer.
 */
export function productForType<P extends Pick<CatalogProduct, 'manufacturer' | 'model' | 'category' | 'aliases'>>(
  type: string,
  products: P[] | undefined,
  opts: { manufacturer?: string; category?: string | null } = {},
): P | null {
  if (!key(type) || !products?.length) return null;
  // dieselben Schreibweisen wie bei „Tür ansagen“ (shared/announce.ts), hier aber nur für die ganze Zelle
  const hits = wholeTypeMatches(type, products, opts.category);
  const m = key((opts.manufacturer ?? '').replace(/[()]/g, ''));
  const byMaker = (p: P) => {
    const pm = key(p.manufacturer);
    return !!m && !!pm && (pm.includes(m) || m.includes(pm));
  };
  if (hits.length === 1) return !m || byMaker(hits[0]!) || /offen|unbekannt/i.test(hits[0]!.manufacturer) ? hits[0]! : null;
  const narrowed = hits.filter(byMaker);
  return narrowed.length === 1 ? narrowed[0]! : null;
}
