import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import { toImportRows } from './importing';
import { buildXlsx } from './xlsx';

describe('buildXlsx', () => {
  it('lässt sich wieder einlesen und importieren', async () => {
    const bytes = buildXlsx('Elemente', [
      ['Objekt', 'Gebäude', 'Art', 'Code', 'Etikett', 'Standort', 'Etage', 'Hersteller', 'Modell', 'Baujahr', 'Letzte Prüfung', 'Ergebnis'],
      ['Schule & Hort', 'Haus <A>', 'Feuerlöscher', 'FL-AB12', '', 'Flur "Nord"', 'EG', 'Gloria', 'PD6', 2019, new Date(Date.UTC(2025, 2, 14, 12)), 'Ohne Mängel'],
    ]);
    const sheets = await readXlsxFile(Buffer.from(bytes));
    const table = (Array.isArray(sheets[0]) ? sheets : (sheets as unknown as { data: unknown[][] }[])[0].data) as unknown[][];
    const { rows, errors } = toImportRows(table);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ property: 'Schule & Hort', building: 'Haus <A>', category: 'extinguisher', code: 'FL-AB12', location: 'Flur "Nord"', year: 2019 });
    expect(new Date(rows[0].lastInspectedAt!).toISOString().slice(0, 10)).toBe('2025-03-14');
  });

  it('englischer Export wird ebenfalls erkannt', async () => {
    const bytes = buildXlsx('Items', [
      ['Property', 'Building', 'Type', 'Code', 'Label', 'Location', 'Floor', 'Manufacturer', 'Model', 'Year', 'Last inspection', 'Result'],
      ['Office', 'Main', 'Fire door', 'FST-AB12', '', 'Stairs', '1', 'Hörmann', 'T30', 2015, new Date(Date.UTC(2025, 0, 2, 12)), 'No defects'],
    ]);
    const sheets = await readXlsxFile(Buffer.from(bytes));
    const table = (Array.isArray(sheets[0]) ? sheets : (sheets as unknown as { data: unknown[][] }[])[0].data) as unknown[][];
    const { rows, errors } = toImportRows(table);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ property: 'Office', category: 'fire_door', floor: '1', manufacturer: 'Hörmann', year: 2015 });
  });
});
