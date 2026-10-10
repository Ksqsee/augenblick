import { CATEGORIES, type Category } from './catalog';

/** Spalten der Import-Vorlage (Reihenfolge = Vorlage). */
export const IMPORT_COLUMNS = [
  { key: 'property', label: 'Objekt', required: true },
  { key: 'building', label: 'Gebäude', required: true },
  { key: 'category', label: 'Art', required: true },
  { key: 'code', label: 'Code', required: false },
  { key: 'labelCode', label: 'Etikett', required: false },
  { key: 'location', label: 'Standort', required: false },
  { key: 'floor', label: 'Etage', required: false },
  { key: 'manufacturer', label: 'Hersteller', required: false },
  { key: 'model', label: 'Modell', required: false },
  { key: 'year', label: 'Baujahr', required: false },
  { key: 'lastInspectedAt', label: 'Letzte Prüfung', required: false },
] as const;
export type ImportKey = (typeof IMPORT_COLUMNS)[number]['key'];

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
  [norm('Brandschutztür')]: 'fire_door',
  [norm('Brandschutztuer')]: 'fire_door',
  [norm('Tür')]: 'fire_door',
  [norm('BST')]: 'fire_door',
  [norm('Rauchschutztür')]: 'fire_door',
  [norm('Klappe')]: 'damper',
  [norm('Löscher')]: 'extinguisher',
  [norm('Rauchmelder')]: 'smoke_alarm',
  [norm('Melder')]: 'smoke_alarm',
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
  for (const c of IMPORT_COLUMNS) aliases[norm(c.label)] = c.key;
  Object.assign(aliases, {
    liegenschaft: 'property',
    haus: 'building',
    kategorie: 'category',
    typ: 'category',
    elementart: 'category',
    elementcode: 'code',
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
  labelCode?: string;
  location: string;
  floor: string;
  manufacturer: string;
  model: string;
  year?: number;
  lastInspectedAt?: number;
}

/** Tabellenzeilen in Import-Zeilen umwandeln, mit Fehlern je Zeile. */
export function toImportRows(table: unknown[][], extra?: { key: string; label: string; plural: string; prefix: string }[]): { rows: ImportRow[]; errors: { line: number; message: string }[] } {
  const [head, ...body] = table;
  const keys = mapHeader((head ?? []).map((h) => String(h ?? '')));
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !keys.includes(c.key));
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Spalte fehlt: ${missing.map((m) => m.label).join(', ')}` }] };
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const rec: Partial<Record<ImportKey, unknown>> = {};
    keys.forEach((k, j) => k && (rec[k] = cells[j]));
    const s = (k: ImportKey) => (rec[k] == null ? '' : String(rec[k]).trim());
    if (!s('property') || !s('building')) return errors.push({ line, message: 'Objekt oder Gebäude leer' });
    const category = parseCategory(s('category'), extra);
    if (!category) return errors.push({ line, message: `Unbekannte Art „${s('category')}“` });
    const last = rec.lastInspectedAt != null && s('lastInspectedAt') ? parseDate(rec.lastInspectedAt) : null;
    if (s('lastInspectedAt') && last == null) return errors.push({ line, message: `Datum nicht lesbar „${s('lastInspectedAt')}“` });
    const year = s('year') ? Number(s('year')) : undefined;
    rows.push({
      property: s('property'),
      building: s('building'),
      category,
      code: s('code').toUpperCase() || undefined,
      labelCode: s('labelCode').toUpperCase() || undefined,
      location: s('location'),
      floor: s('floor'),
      manufacturer: s('manufacturer'),
      model: s('model'),
      year: year && Number.isFinite(year) ? year : undefined,
      lastInspectedAt: last ?? undefined,
    });
  });
  return { rows, errors };
}
