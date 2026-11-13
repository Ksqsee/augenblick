import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../../../shared/catalog';
import { countGroup, groupCheckpoints, groupSummary } from './groups';

describe('Prüfpunkte in Gruppen', () => {
  it('Feuerschutztür: vier sprechende Gruppen, jeder Punkt genau einmal, Nummern bleiben', () => {
    const cps = CATEGORIES.fire_door.checkpoints;
    const g = groupCheckpoints(cps);
    expect(g.map((x) => x.label)).toEqual(['Kennzeichnung und Zugang', 'Bauteil und Einbau', 'Beschläge und Mechanik', 'Auslösung und Funktion']);
    expect(g.flatMap((x) => x.items.map((i) => i.n)).sort((a, b) => a - b)).toEqual(cps.map((_, i) => i + 1));
    expect(g[2].items.map((i) => i.n)).toEqual([4, 5, 6, 7, 8, 15]);
  });

  it('alle eingebauten Prüflisten: keine Gruppe „Weitere Punkte“ mit mehr als zwei Punkten', () => {
    for (const c of Object.values(CATEGORIES))
      for (const s of c.schedules) {
        const g = groupCheckpoints(s.checkpoints ?? c.checkpoints);
        expect(g.reduce((n, x) => n + x.items.length, 0)).toBe((s.checkpoints ?? c.checkpoints).length);
        expect(g.find((x) => x.key === 'rest')?.items.length ?? 0, `${c.key}/${s.key}`).toBeLessThanOrEqual(2);
      }
  });

  it('kurze Listen (Nachprüfung, Sichtkontrolle) bleiben eine Gruppe; eigene Gruppen haben Vorrang', () => {
    expect(groupCheckpoints([{ id: 'a', label: 'Türblatt' }, { id: 'b', label: 'Schloss' }]).map((g) => g.label)).toEqual(['Alle Punkte']);
    const own = groupCheckpoints([
      { id: 'a', label: 'X', group: 'Dokumentation' },
      { id: 'b', label: 'Y', group: 'Funktionsprüfung' },
      { id: 'c', label: 'Z', group: 'Dokumentation' },
    ]);
    expect(own.map((g) => [g.label, g.items.length])).toEqual([
      ['Dokumentation', 2],
      ['Funktionsprüfung', 1],
    ]);
  });

  it('Zähler der Gruppenzeile', () => {
    expect(groupSummary(countGroup(['a', 'b'], { a: 'ok', b: 'ok' }))).toBe('2 von 2 i. O.');
    expect(groupSummary(countGroup(['a', 'b', 'c', 'd'], { a: 'ok', b: 'defect', c: 'na' }))).toBe('1 von 4 i. O. · 1 Mangel · 1 n. z. · 1 offen');
    expect(groupSummary(countGroup(['a', 'b'], {}))).toBe('0 von 2 i. O.');
  });
});
