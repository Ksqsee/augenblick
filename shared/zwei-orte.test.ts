// Plan v8: Ampel-Rangfolge der Objektliste und Bündelung der Kalender-Einträge.
import { describe, expect, it } from 'vitest';
import { type AmpelCounts, ampelNotes, ampelTier, matchesAmpel, placeOf, sinceText, sortByUrgency } from './ampel';
import { addMonths, bundleDue, byDay, dayKey, isDayKey, monthGrid, sortEvents } from './calendar';
import { DAY } from './logic';

const NOW = Date.UTC(2026, 10, 20, 10, 0); // 20.11.2026, 11:00 in Berlin
const p = (name: string, x: Partial<AmpelCounts> = {}): AmpelCounts => ({ name, nextDue: null, overdue: 0, openDefects: 0, criticalDefects: 0, pendingSignatures: 0, ...x });

describe('Ampel: Rangfolge „dringendstes zuerst“', () => {
  it('überfällig vor kritisch vor bald fällig vor Unterschrift vor Mängeln vor später vor nichts', () => {
    const list = [
      p('Nichts'),
      p('Später', { nextDue: NOW + 90 * DAY }),
      p('Mängel', { openDefects: 3, nextDue: NOW + 200 * DAY }),
      p('Unterschrift', { pendingSignatures: 2 }),
      p('Bald', { nextDue: NOW + 10 * DAY }),
      p('Kritisch', { openDefects: 1, criticalDefects: 1, nextDue: NOW + 100 * DAY }),
      p('Überfällig', { overdue: 4, nextDue: NOW - 20 * DAY }),
    ];
    expect(sortByUrgency(list, NOW).map((x) => x.name)).toEqual(['Überfällig', 'Kritisch', 'Bald', 'Unterschrift', 'Mängel', 'Später', 'Nichts']);
  });
  it('gleiche Stufe: länger überfällig zuerst, dann mehr kritische Mängel, dann Name', () => {
    const list = [p('B', { overdue: 1, nextDue: NOW - 2 * DAY }), p('A', { overdue: 9, nextDue: NOW - 30 * DAY }), p('D', { criticalDefects: 1, openDefects: 1 }), p('C', { criticalDefects: 3, openDefects: 3 })];
    expect(sortByUrgency(list, NOW).map((x) => x.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(sortByUrgency([p('Zeta'), p('Äpfel'), p('Bahnhof')], NOW).map((x) => x.name)).toEqual(['Äpfel', 'Bahnhof', 'Zeta']);
  });
  it('Stufen und Filter', () => {
    expect(ampelTier(p('x', { nextDue: NOW + 30 * DAY }), NOW)).toBe(2);
    expect(ampelTier(p('x', { nextDue: NOW + 31 * DAY }), NOW)).toBe(5);
    const bald = p('x', { nextDue: NOW + 5 * DAY });
    expect(matchesAmpel(bald, 'faellig', NOW)).toBe(true);
    expect(matchesAmpel(p('x', { nextDue: NOW + 60 * DAY }), 'faellig', NOW)).toBe(false);
    expect(matchesAmpel(p('x', { openDefects: 1 }), 'maengel', NOW)).toBe(true);
    expect(matchesAmpel(p('x'), 'maengel', NOW)).toBe(false);
    expect(matchesAmpel(p('x', { pendingSignatures: 1 }), 'unterschrift', NOW)).toBe(true);
    expect(matchesAmpel(p('x'), 'alle', NOW)).toBe(true);
  });
  it('höchstens drei Angaben, nur was ungleich null ist; Zinnober nur für Überfälliges und Kritisches', () => {
    expect(ampelNotes(p('leer'), NOW)).toEqual([]);
    const all = ampelNotes(p('x', { overdue: 2, nextDue: NOW - 21 * DAY, openDefects: 3, criticalDefects: 1, pendingSignatures: 4 }), NOW, 'Europe/Berlin');
    expect(all.map((n) => [n.kind, n.tone, n.text])).toEqual([
      ['due', 'bad', 'überfällig seit 3 Wochen'],
      ['defects', 'bad', '3 Mängel, 1 kritisch'],
      ['signatures', 'muted', '4 zu unterschreiben'],
    ]);
    const soon = ampelNotes(p('x', { nextDue: Date.UTC(2026, 11, 3, 9), openDefects: 1 }), NOW, 'Europe/Berlin');
    expect(soon.map((n) => [n.tone, n.text])).toEqual([
      ['warn', 'fällig 03.12.'],
      ['muted', '1 Mangel'],
    ]);
    expect(ampelNotes(p('x', { nextDue: NOW + 400 * DAY }), NOW, 'Europe/Berlin')[0]!.text).toMatch(/^fällig \d\d\.\d\d\.\d\d$/);
  });
  it('„seit“ und Ort', () => {
    expect(sinceText(NOW - DAY, NOW)).toBe('seit 1 Tag');
    expect(sinceText(NOW - 13 * DAY, NOW)).toBe('seit 13 Tagen');
    expect(sinceText(NOW - 100 * DAY, NOW)).toBe('seit 3 Monaten');
    expect(placeOf('Hafenstraße 4\n20457 Hamburg')).toBe('Hamburg');
    expect(placeOf('Am Markt 1, 01067 Dresden')).toBe('Dresden');
    expect(placeOf('')).toBe('');
  });
});

describe('Kalender: Bündelung je Objekt und Tag', () => {
  const TZ = 'Europe/Berlin';
  it('Tages-Schlüssel in der Zeitzone des Workspaces', () => {
    expect(dayKey(Date.UTC(2026, 10, 20, 23, 30), TZ)).toBe('2026-11-21');
    expect(dayKey(Date.UTC(2026, 10, 20, 23, 30), 'UTC')).toBe('2026-11-20');
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-02-28')).toBe(true);
    expect(isDayKey('x')).toBe(false);
  });
  it('gleiches Objekt, gleicher Tag → ein Eintrag mit Anzahl; Türen heißen Türen', () => {
    const day = Date.UTC(2026, 11, 3, 8);
    const ev = bundleDue(
      [
        { propertyId: 'h', propertyName: 'Hotel X', due: day, n: 40, doors: 40 },
        { propertyId: 'h', propertyName: 'Hotel X', due: day + 3 * 3_600_000, n: 32, doors: 32 },
        { propertyId: 's', propertyName: 'Schule', due: day, n: 2, doors: 1 },
        { propertyId: 'h', propertyName: 'Hotel X', due: day + 2 * DAY, n: 1, doors: 1 },
      ],
      TZ,
      NOW,
    );
    const sorted = sortEvents(ev);
    expect(sorted.map((e) => [e.date, e.title, e.count, e.link])).toEqual([
      ['2026-12-03', 'Hotel X: 72 Türen fällig', 72, '/objekte/h?tab=begehung'],
      ['2026-12-03', 'Schule: 2 Prüfungen fällig', 2, '/objekte/s?tab=begehung'],
      ['2026-12-05', 'Hotel X: 1 Tür fällig', 1, '/objekte/h?tab=begehung'],
    ]);
    expect(ev.every((e) => !e.overdue)).toBe(true);
  });
  it('Überfälliges je Objekt zu einem Eintrag am frühesten Tag; heute Fälliges ist nicht überfällig', () => {
    const ev = bundleDue(
      [
        { propertyId: 'h', propertyName: 'Hotel X', due: NOW - 40 * DAY, n: 3, doors: 3 },
        { propertyId: 'h', propertyName: 'Hotel X', due: NOW - 2 * DAY, n: 2, doors: 2 },
        { propertyId: 'h', propertyName: 'Hotel X', due: NOW - 3_600_000, n: 1, doors: 1 },
      ],
      TZ,
      NOW,
    );
    const over = ev.filter((e) => e.overdue);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ date: dayKey(NOW - 40 * DAY, TZ), count: 5, title: 'Hotel X: 5 Türen überfällig' });
    expect(ev.find((e) => !e.overdue)).toMatchObject({ date: '2026-11-20', count: 1 });
  });
  it('Monatsraster ab Montag, Folgemonat und Reihenfolge je Tag', () => {
    const g = monthGrid('2026-11');
    expect(g[0]![0]).toBe('2026-10-26');
    expect(g.at(-1)!.at(-1)).toBe('2026-12-06');
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid('2021-02')).toHaveLength(4);
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    const m = byDay([
      { date: '2026-11-21', kind: 'task', title: 'B', link: '/' },
      { date: '2026-11-21', kind: 'due', title: 'A', link: '/' },
      { date: '2026-11-20', kind: 'credential', title: 'C', link: '/' },
    ]);
    expect([...m.keys()]).toEqual(['2026-11-20', '2026-11-21']);
    expect(m.get('2026-11-21')!.map((e) => e.kind)).toEqual(['due', 'task']);
  });
});
