import { describe, expect, it } from 'vitest';
import { DAY } from './logic';
import { defaultTaskKind, dueGroup, groupByDue, sortByUrgency, taskKindError, urgency } from './tasks';

// Mittwoch, 11.11.2026, 10:00 lokale Zeit
const NOW = new Date(2026, 10, 11, 10, 0).getTime();
const at = (d: number, h = 12) => new Date(2026, 10, 11 + d, h, 0).getTime();

describe('Aufgaben nach Fälligkeit gruppieren', () => {
  it('ordnet Termine den Gruppen zu', () => {
    expect(dueGroup(null, NOW)).toBe('none');
    expect(dueGroup(at(-1), NOW)).toBe('overdue');
    expect(dueGroup(at(0, 8), NOW)).toBe('today'); // heute früher am Tag zählt noch als heute
    expect(dueGroup(at(0, 23), NOW)).toBe('today');
    expect(dueGroup(at(4), NOW)).toBe('week'); // Sonntag
    expect(dueGroup(at(5), NOW)).toBe('later'); // Montag
  });
  it('am Sonntag gibt es keine Restwoche', () => {
    const sunday = new Date(2026, 10, 15, 9).getTime();
    expect(dueGroup(new Date(2026, 10, 16, 12).getTime(), sunday)).toBe('later');
  });
  it('liefert Gruppen in fester Reihenfolge ohne leere', () => {
    const g = groupByDue([{ dueAt: at(10) }, { dueAt: null }, { dueAt: at(-3) }, { dueAt: at(-1) }], NOW);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([
      ['overdue', 2],
      ['later', 1],
      ['none', 1],
    ]);
    expect(g[0].label).toBe('Überfällig');
  });
});

describe('Aufgabentyp', () => {
  it('Standard und Prüfung der Verknüpfung', () => {
    expect(defaultTaskKind({ defectId: 'd1' })).toBe('defect');
    expect(defaultTaskKind({})).toBe('other');
    expect(taskKindError('inspection', {})).toMatch(/Element/);
    expect(taskKindError('inspection', { assetId: 'a' })).toBeNull();
    expect(taskKindError('defect', { assetId: 'a' })).toMatch(/Mangel/);
    expect(taskKindError('other', {})).toBeNull();
  });
});

describe('Handlungsbedarf nach Dringlichkeit', () => {
  it('kritische Mängel zuerst, dann hohe Aufgaben, Mängel, Elemente', () => {
    const items = sortByUrgency(
      [
        { kind: 'asset' as const, at: NOW - 10 * DAY, id: 'asset' },
        { kind: 'task' as const, level: 'high', at: NOW - 2 * DAY, id: 'task-high' },
        { kind: 'defect' as const, level: 'high', at: NOW - 1 * DAY, id: 'defect-high' },
        { kind: 'defect' as const, level: 'critical', at: NOW, id: 'defect-crit' },
        { kind: 'task' as const, level: 'low', at: NOW - 1 * DAY, id: 'task-low' },
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['defect-crit', 'task-high', 'defect-high', 'task-low', 'asset']);
  });
  it('Alter erhöht die Dringlichkeit, aber gedeckelt', () => {
    expect(urgency({ kind: 'asset', at: NOW - 20 * DAY }, NOW)).toBeGreaterThan(urgency({ kind: 'asset', at: NOW - 2 * DAY }, NOW));
    expect(urgency({ kind: 'asset', at: NOW - 400 * DAY }, NOW)).toBe(60);
    expect(urgency({ kind: 'asset', at: NOW + 5 * DAY }, NOW)).toBe(30);
  });
});
