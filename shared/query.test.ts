import { describe, expect, it } from 'vitest';
import { parseQuery, queryUrl } from './query';

const ctx = {
  categories: [
    { key: 'extinguisher', label: 'Feuerlöscher', plural: 'Feuerlöscher' },
    { key: 'fire_door', label: 'Feuerschutztür', plural: 'Feuerschutztüren' },
    { key: 'smoke_alarm', label: 'Rauchwarnmelder', plural: 'Rauchwarnmelder' },
  ],
  properties: [
    { id: 'p1', name: 'Grundschule Am Stadtpark' },
    { id: 'p2', name: 'Seniorenresidenz Elbblick' },
  ],
};

describe('Suche in normaler Sprache', () => {
  it('erkennt Fälligkeit, Art und Objekt', () => {
    const q = parseQuery('überfällige Feuerlöscher in der Grundschule', ctx)!;
    expect(q).toMatchObject({ target: 'assets', due: 'overdue', category: 'extinguisher', propertyId: 'p1' });
    expect(queryUrl(q)).toBe('/elemente?status=overdue&kategorie=extinguisher&objekt=p1');
  });
  it('Mehrzahl und Restsuche', () => {
    const q = parseQuery('Feuerschutztüren Elbblick 2. OG nie geprüft', ctx)!;
    expect(q).toMatchObject({ due: 'never', category: 'fire_door', propertyId: 'p2' });
    expect(q.rest).toBe('2. og');
  });
  it('bald fällig diese Woche', () => {
    expect(parseQuery('was ist diese Woche fällig', ctx)?.due).toBe('soon');
  });
  it('normale Codesuche bleibt normal', () => {
    expect(parseQuery('FL-7K2M', ctx)).toBeNull();
    expect(parseQuery('Küche', ctx)).toBeNull();
  });
  it('Mängel und Aufgaben', () => {
    expect(parseQuery('offene Mängel', ctx)?.target).toBe('defects');
    expect(parseQuery('meine Aufgaben', ctx)?.target).toBe('tasks');
  });
});
