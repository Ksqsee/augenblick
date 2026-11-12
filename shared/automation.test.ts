import { describe, expect, it } from 'vitest';
import { type AssignRule, autoSeverities, canUndo, matchRule, nextRecurrence, reportPeriod } from './automation';
import { DAY } from './logic';

const rule = (r: Partial<AssignRule>): AssignRule => ({ id: 'r', category: null, severities: ['high'], assigneeId: null, subcontractorId: null, days: null, ...r });

describe('Autopilot', () => {
  it('nimmt die erste passende Zuweisungsregel', () => {
    const rules = [rule({ id: 'a', category: 'fire_door', severities: ['critical'] }), rule({ id: 'b', severities: ['high', 'critical'] })];
    expect(matchRule(rules, { category: 'fire_door', severity: 'critical' })?.id).toBe('a');
    expect(matchRule(rules, { category: 'damper', severity: 'critical' })?.id).toBe('b');
    expect(matchRule(rules, { category: null, severity: 'high' })?.id).toBe('b');
    expect(matchRule(rules, { category: 'damper', severity: 'low' })).toBeNull();
  });
  it('legt immer für hoch/kritisch an, weitere Stufen nur per Regel', () => {
    expect(autoSeverities([])).toEqual(['high', 'critical']);
    expect(autoSeverities([rule({ severities: ['medium'] })])).toEqual(['medium', 'high', 'critical']);
  });
  it('rechnet den nächsten Termin wiederkehrender Aufgaben', () => {
    const due = Date.UTC(2026, 0, 31);
    expect(new Date(nextRecurrence('monthly', due, due, due)).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(new Date(nextRecurrence('quarterly', due, due, due)).toISOString().slice(0, 10)).toBe('2026-04-30');
    expect(new Date(nextRecurrence('yearly', null, due, due)).toISOString().slice(0, 10)).toBe('2027-01-31');
    // sehr spät erledigt: Termin springt in die Zukunft
    const now = Date.UTC(2026, 5, 10);
    expect(nextRecurrence('monthly', due, now, now)).toBeGreaterThan(now);
  });
  it('Berichtsmonat ist der Vormonat', () => {
    expect(reportPeriod('2026-11-01')).toEqual({ period: '2026-10', label: 'Oktober 2026' });
    expect(reportPeriod('2027-01-15')).toEqual({ period: '2026-12', label: 'Dezember 2026' });
  });
  it('Rückgängig nur 7 Tage und nur einmal', () => {
    const now = Date.UTC(2026, 10, 12);
    expect(canUndo({ at: now - DAY, undo: {}, undoneAt: null }, now)).toBe(true);
    expect(canUndo({ at: now - 8 * DAY, undo: {}, undoneAt: null }, now)).toBe(false);
    expect(canUndo({ at: now, undo: {}, undoneAt: now }, now)).toBe(false);
    expect(canUndo({ at: now, undo: null, undoneAt: null }, now)).toBe(false);
  });
});
