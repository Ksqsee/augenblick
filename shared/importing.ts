import { CATEGORIES, type CatalogProduct, type Category } from './catalog';
import { parseRequirement } from './catalog-door';
import { productForType } from './catalog-file';
import { applyProductDefaults } from './vocab';

/** Spalten der Import-Vorlage (Reihenfolge = Vorlage). */
export const IMPORT_COLUMNS = [
  { key: 'property', label: 'Objekt', required: true },
  { key: 'building', label: 'Gebäude', required: true },
  { key: 'category', label: 'Art', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'number', label: 'Nummer', required: false },
  { key: 'labelCode', label: 'Etikett', required: false },
  { key: 'location', label: 'Standort', required: false },
  { key: 'floor', label: 'Etage', required: false },
  { key: 'manufacturer', label: 'Hersteller', required: false },
  { key: 'model', label: 'Modell', required: false },
  { key: 'year', label: 'Baujahr', required: false },
  { key: 'lastInspectedAt', label: 'Letzte Prüfung', required: false },
] as const;
/**
 * Weitere Spalten (Plan v7): Wartungsübersicht eines Betriebs (Ident-Nr., Türtyp, Hersteller, JA-Spalten, Zulassung,
 * Intervall, letzte/nächste Prüfung, Etage, Raum). Sie werden erkannt, stehen aber nicht in der Vorlage.
 */
export const EXTRA_COLUMNS = [
  { key: 'doorType', label: 'Türtyp' },
  { key: 'requirement', label: 'Anforderung' },
  { key: 'approval', label: 'Zulassung' },
  { key: 'dropSeal', label: 'Absenkdichtung' },
  { key: 'closer', label: 'OTS' },
  { key: 'peephole', label: 'Spion' },
  { key: 'intervalDays', label: 'Prüf-Intervall in Tagen' },
  { key: 'nextDueAt', label: 'Nächste Prüfung' },
  { key: 'protocol', label: 'Protokoll Nummer' },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key'] | (typeof EXTRA_COLUMNS)[number]['key'];
/** Ja/Nein-Spalten der Wartungsübersicht (Stammdaten der Tür) */
const FLAG_KEYS = ['dropSeal', 'closer', 'peephole'] as const;
/** „Protokoll Nummer“ der Wartungsübersicht: 1 = Feststellanlage, 2 = Drehflügeltür, 3 = Drehtürantrieb */
const PROTOCOLS: Record<string, Category> = { '1': 'hold_open', '2': 'fire_door', '3': 'door_drive' };
/** Gebäude, wenn die Datei keine Spalte dafür hat (wie beim Anlegen eines Objekts) */
export const IMPORT_DEFAULT_BUILDING = 'Hauptgebäude';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

const CATEGORY_ALIASES: Record<string, Category> = {};
for (const c of Object.values(CATEGORIES)) {
  for (const a of [c.key, c.label, c.plural, c.prefix]) CATEGORY_ALIASES[norm(a)] = c.key;
}
Object.assign(CATEGORY_ALIASES, {
  [norm('Feuerschutztür')]: 'fire_door',
  [norm('Feuerschutztüren')]: 'fire_door',
  [norm('FST')]: 'fire_door',
  [norm('Drehflügeltür')]: 'fire_door',
  [norm('Türantrieb')]: 'door_drive',
  [norm('Drehflügelantrieb')]: 'door_drive',
  [norm('Antrieb')]: 'door_drive',
  [norm('Fensterelement')]: 'window',
  [norm('Window')]: 'window',
  [norm('Door operator')]: 'door_drive',
  [norm('Door')]: 'fire_door',
  [norm('Brandschutztür')]: 'fire_door',
  [norm('Brandschutztuer')]: 'fire_door',
  [norm('Tür')]: 'fire_door',
  [norm('BST')]: 'fire_door',
  [norm('Rauchschutztür')]: 'fire_door',
  [norm('Klappe')]: 'damper',
  [norm('Löscher')]: 'extinguisher',
  [norm('Rauchmelder')]: 'smoke_alarm',
  [norm('Melder')]: 'smoke_alarm',
  [norm('Feststeller')]: 'hold_open',
  [norm('Feststellanlage Tür')]: 'hold_open',
  [norm('FSA-Anlage')]: 'hold_open',
  [norm('Hold-open system')]: 'hold_open',
  [norm('Hold-open device')]: 'hold_open',
  // englischer Export
  [norm('Fire door')]: 'fire_door',
  [norm('Fire damper')]: 'damper',
  [norm('Fire extinguisher')]: 'extinguisher',
  [norm('Smoke alarm')]: 'smoke_alarm',
});

export function parseCategory(s: string, extra?: { key: string; label: string; plural: string; prefix: string }[]): Category | null {
  const n = norm(s);
  const hit = extra?.find((c) => [c.key, c.label, c.plural, c.prefix].some((x) => norm(x) === n));
  return hit?.key ?? CATEGORY_ALIASES[n] ?? null;
}

/** Kopfzeile → Spaltenschlüssel (tolerant gegenüber Schreibweisen). */
export function mapHeader(header: string[]): (ImportKey | null)[] {
  const aliases: Record<string, ImportKey> = {};
  for (const c of [...IMPORT_COLUMNS, ...EXTRA_COLUMNS]) aliases[norm(c.label)] = c.key;
  // Wartungsübersicht (Plan v7, Wissensauszug 4a) – Spaltenköpfe so, wie sie dort stehen
  for (const [h, k] of [
    ['Ident Nummer', 'number'],
    ['Ident-Nr.', 'number'],
    ['Prüf-Intervall in Tagen', 'intervalDays'],
    ['Prüfintervall', 'intervalDays'],
    ['Intervall in Tagen', 'intervalDays'],
    ['Zeitpunkt der letzten Prüfung', 'lastInspectedAt'],
    ['Nächste Prüfung spätestens am', 'nextDueAt'],
    ['Nächste Prüfung', 'nextDueAt'],
    ['Objektbeschreibung', 'property'],
    ['Zulassung / Prüfzeugnis', 'approval'],
    ['Prüfzeugnis', 'approval'],
    ['Obentürschließer', 'closer'],
    ['Türspion', 'peephole'],
    ['Protokoll', 'protocol'],
    ['Protokollnummer', 'protocol'],
  ] as [string, ImportKey][])
    aliases[norm(h)] = k;
  Object.assign(aliases, {
    liegenschaft: 'property',
    haus: 'building',
    kategorie: 'category',
    typ: 'category',
    elementart: 'category',
    elementcode: 'code',
    nr: 'number',
    identnr: 'number',
    identnummer: 'number',
    ident: 'number',
    laufendenummer: 'number',
    lfdnr: 'number',
    no: 'number',
    number: 'number',
    qr: 'labelCode',
    qrcode: 'labelCode',
    etikettcode: 'labelCode',
    ort: 'location',
    raum: 'location',
    geschoss: 'floor',
    stockwerk: 'floor',
    fabrikat: 'manufacturer',
    typmodell: 'model',
    letztepruefung: 'lastInspectedAt',
    pruefdatum: 'lastInspectedAt',
    // englischer Export
    property: 'property',
    building: 'building',
    type: 'category',
    label: 'labelCode',
    location: 'location',
    floor: 'floor',
    manufacturer: 'manufacturer',
    model: 'model',
    year: 'year',
    lastinspection: 'lastInspectedAt',
  } satisfies Record<string, ImportKey>);
  return header.map((h) => aliases[norm(h)] ?? null);
}

/** Datum aus dd.mm.yyyy, yyyy-mm-dd, Excel-Seriennummer oder Date. Ergebnis: ms (12:00 UTC) oder null. */
export function parseDate(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), 12);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return Date.UTC(1899, 11, 30, 12) + v * 86_400_000; // Excel
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    return valid(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function valid(y: number, mo: number, d: number) {
  const t = Date.UTC(y, mo - 1, d, 12);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null;
}

/** Einfacher CSV-Parser (Trennzeichen ; oder , automatisch, Anführungszeichen). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ImportRow {
  property: string;
  building: string;
  category: Category;
  code?: string;
  number?: number;
  labelCode?: string;
  location: string;
  floor: string;
  manufacturer: string;
  model: string;
  year?: number;
  lastInspectedAt?: number;
  /** Plan v7: Stammdaten (Anforderung, Absenkdichtung, OTS, Spion, Zulassung, Vorgaben des Katalog-Typs) */
  attributes?: Record<string, string | number | boolean>;
  /** Nächste Prüfung aus der Datei (sonst letzte Prüfung + Intervall) */
  nextDueAt?: number;
  /** Intervall in Monaten, wenn die Datei eines nennt (365 Tage = 12) */
  intervalMonths?: number;
  /** Türtyp aus dem Katalog (Hersteller Typ), wenn ein Alias passte */
  catalogType?: string;
  /** Zeile in der Quelldatei (Kopfzeile = 1) */
  line: number;
}

export interface ImportOptions {
  /** Objekt für Dateien ohne Objektspalte (z. B. Wartungsübersicht eines einzelnen Objekts) */
  property?: string;
  /** Katalog-Produkte: Türtyp → Hersteller, Typ und Vorgabewerte (Aliasse) */
  products?: CatalogProduct[];
}

const YES = /^(ja|j|x|yes|true|1|vorhanden)$/i;
const NO = /^(nein|n|no|false|0|-|ohne|keine?)?$/i;

/** Tabellenzeilen in Import-Zeilen umwandeln, mit Fehlern je Zeile. */
export function toImportRows(
  table: unknown[][],
  extra?: { key: string; label: string; plural: string; prefix: string }[],
  opts: ImportOptions = {},
): { rows: ImportRow[]; errors: { line: number; message: string }[] } {
  const [head, ...body] = table;
  const keys = mapHeader((head ?? []).map((h) => String(h ?? '')));
  // Plan v7: Objekt aus der Auswahl, Gebäude „Hauptgebäude“, Art aus Protokollnummer bzw. Türtyp
  const optional = new Set<ImportKey>([
    ...(opts.property?.trim() ? (['property'] as const) : []),
    'building',
    ...(keys.includes('protocol') || keys.includes('doorType') ? (['category'] as const) : []),
  ]);
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key) && !optional.has(c.key));
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Spalte fehlt: ${missing.map((m) => m.label).join(', ')}` }] };
  const hasBuilding = keys.includes('building');
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const rec: Partial<Record<ImportKey, unknown>> = {};
    keys.forEach((k, j) => k && (rec[k] = cells[j]));
    const s = (k: ImportKey) => (rec[k] == null ? '' : String(rec[k]).trim());
    const property = s('property') || opts.property?.trim() || '';
    const building = hasBuilding ? s('building') : IMPORT_DEFAULT_BUILDING;
    if (!property || !building) return errors.push({ line, message: 'Objekt oder Gebäude leer' });
    const category = s('category')
      ? parseCategory(s('category'), extra)
      : s('protocol')
        ? (PROTOCOLS[s('protocol').replace(/\.0+$/, '')] ?? null)
        : keys.includes('doorType')
          ? 'fire_door'
          : null;
    if (!category) return errors.push({ line, message: s('protocol') && !s('category') ? `Unbekannte Protokollnummer „${s('protocol')}“` : `Unbekannte Art „${s('category')}“` });
    const last = rec.lastInspectedAt != null && s('lastInspectedAt') ? parseDate(rec.lastInspectedAt) : null;
    if (s('lastInspectedAt') && last == null) return errors.push({ line, message: `Datum nicht lesbar „${s('lastInspectedAt')}“` });
    const next = rec.nextDueAt != null && s('nextDueAt') ? parseDate(rec.nextDueAt) : null;
    if (s('nextDueAt') && next == null) return errors.push({ line, message: `Datum nicht lesbar „${s('nextDueAt')}“` });
    const days = s('intervalDays') ? Number(s('intervalDays').replace(',', '.')) : null;
    if (days != null && !(Number.isFinite(days) && days >= 7 && days <= 3660)) return errors.push({ line, message: `Intervall nicht lesbar „${s('intervalDays')}“` });
    // Stammdaten: Katalog-Typ (Alias) bzw. Anforderung aus dem Türtyp, Ja/Nein-Spalten, Zulassung
    const fields = (CATEGORIES as Record<string, (typeof CATEGORIES)[keyof typeof CATEGORIES] | undefined>)[category]?.attributes.map((f) => f.key) ?? [];
    let attrs: Record<string, string | number | boolean> = {};
    let manufacturer = s('manufacturer').replace(/^\((.*)\)$/, '$1').trim();
    let model = s('model');
    let catalogType: string | undefined;
    const typeText = s('doorType');
    if (typeText) {
      const product = productForType(typeText, opts.products, { manufacturer, category });
      if (product) {
        attrs = applyProductDefaults(attrs, product, fields, true) as typeof attrs;
        manufacturer ||= product.manufacturer;
        model ||= product.model;
        catalogType = `${product.manufacturer} ${product.model}`;
      } else {
        model ||= typeText;
        const req = fields.includes('requirement') ? parseRequirement(typeText) : null;
        if (req) attrs.requirement = req;
      }
    }
    if (s('requirement') && fields.includes('requirement')) {
      const req = parseRequirement(s('requirement'));
      if (!req) return errors.push({ line, message: `Anforderung nicht lesbar „${s('requirement')}“` });
      attrs.requirement = req;
    }
    for (const k of FLAG_KEYS)
      if (keys.includes(k) && fields.includes(k)) {
        const v = s(k);
        if (YES.test(v)) attrs[k] = true;
        else if (NO.test(v)) attrs[k] = false;
        else return errors.push({ line, message: `${k === 'closer' ? 'OTS' : k === 'dropSeal' ? 'Absenkdichtung' : 'Spion'}: „${v}“ – bitte JA oder leer` });
      }
    if (s('approval') && fields.includes('approval')) attrs.approval = s('approval').slice(0, 200);
    const year = s('year') ? Number(s('year')) : undefined;
    const num = s('number') ? Number(s('number').replace(/^#/, '')) : undefined;
    if (num !== undefined && !(Number.isInteger(num) && num >= 1 && num <= 99999)) return errors.push({ line, message: `Nummer nicht lesbar „${s('number')}“` });
    rows.push({
      line,
      property,
      building,
      category,
      code: s('code').toUpperCase() || undefined,
      number: num,
      labelCode: s('labelCode').toUpperCase() || undefined,
      location: s('location'),
      floor: s('floor'),
      manufacturer,
      model,
      year: year && Number.isFinite(year) ? year : undefined,
      lastInspectedAt: last ?? undefined,
      ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
      ...(next != null ? { nextDueAt: next } : {}),
      ...(days != null ? { intervalMonths: Math.max(1, Math.round(days / 30.4375)) } : {}),
      ...(catalogType ? { catalogType } : {}),
    });
  });
  return { rows, errors };
}
