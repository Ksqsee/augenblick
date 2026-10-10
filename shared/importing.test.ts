import { describe, expect, it } from 'vitest';
import { parseCategory, parseCsv, parseDate, toImportRows } from './importing';

describe('parseCategory', () => {
  it('accepts labels, prefixes and aliases', () => {
    expect(parseCategory('Feuerschutztür')).toBe('fire_door');
    expect(parseCategory('Brandschutztür')).toBe('fire_door');
    expect(parseCategory('bsk')).toBe('damper');
    expect(parseCategory('Feuerlöscher')).toBe('extinguisher');
    expect(parseCategory('Rauchmelder')).toBe('smoke_alarm');
    expect(parseCategory('Aufzug')).toBeNull();
  });
});

describe('parseDate', () => {
  it('parses german, iso and excel dates', () => {
    expect(new Date(parseDate('18.09.2026')!).toISOString().slice(0, 10)).toBe('2026-09-18');
    expect(new Date(parseDate('2026-01-05')!).toISOString().slice(0, 10)).toBe('2026-01-05');
    expect(new Date(parseDate(46000)!).toISOString().slice(0, 10)).toBe('2025-12-09');
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('morgen')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles semicolons, quotes and newlines in cells', () => {
    expect(parseCsv('﻿A;B\n"x;y";"a ""b"""\r\n1;2')).toEqual([
      ['A', 'B'],
      ['x;y', 'a "b"'],
      ['1', '2'],
    ]);
  });
  it('detects comma separator', () => {
    expect(parseCsv('A,B\n1,2')).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
  });
});

describe('toImportRows', () => {
  it('maps headers and reports row errors', () => {
    const r = toImportRows([
      ['Liegenschaft', 'Gebäude', 'Art', 'Raum', 'Letzte Prüfung'],
      ['Schule', 'Haus A', 'Tür', 'R 1', '01.02.2026'],
      ['Schule', 'Haus A', 'Aufzug', '', ''],
      ['Schule', '', 'Tür', '', ''],
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ property: 'Schule', building: 'Haus A', category: 'fire_door', location: 'R 1' });
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
  it('requires core columns', () => {
    expect(toImportRows([['Name']]).errors[0].message).toMatch(/Spalte fehlt/);
  });
});

describe('Zeilennummern', () => {
  it('bleiben die Zeile der Quelldatei, auch wenn davor Zeilen fehlschlagen', () => {
    const { rows, errors } = toImportRows([
      ['Objekt', 'Gebäude', 'Art'],
      ['A', 'Haus', 'Feuerlöscher'],
      ['A', 'Haus', 'Gibt es nicht'],
      ['A', 'Haus', 'Rauchmelder'],
    ]);
    expect(errors).toEqual([{ line: 3, message: 'Unbekannte Art „Gibt es nicht“' }]);
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
  });
});
