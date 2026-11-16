import { describe, expect, it } from 'vitest';
import { DateInputError, dayIn, dayTimeIn, findRelativeDate, monthRange, parseDateInput, zonedTime } from './dates';

const TZ = 'Europe/Berlin';
// Montag, 16.11.2026, 10:00 Berlin
const NOW = Date.UTC(2026, 10, 16, 9, 0);
const day = (v: unknown, o: Parameters<typeof parseDateInput>[1] = {}) => {
  const p = parseDateInput(v, { timeZone: TZ, now: NOW, ...o });
  return dayIn(p.at, TZ);
};

describe('streng geprüfte Kalenderdaten (A6)', () => {
  it('lehnt 30.02. ab statt auf den 02.03. zu rutschen', () => {
    expect(() => day('2026-02-30', { allowPast: true })).toThrow(DateInputError);
    expect(() => day('2026-02-30', { allowPast: true })).toThrow(/Februar 2026 hat nur 28 Tage/);
    expect(() => day('30.02.2027')).toThrow(/Februar 2027 hat nur 28 Tage/);
    expect(() => day('2026-13-01')).toThrow(/Monat 13/);
    expect(() => day('2026-04-31')).toThrow(/April 2026 hat nur 30 Tage/);
    expect(() => day('2026-11-00')).toThrow(/Tag 0/);
  });
  it('Schaltjahre', () => {
    expect(day('2028-02-29')).toBe('2028-02-29');
    expect(() => day('2027-02-29')).toThrow(DateInputError);
  });
  it('Vergangenheit nur mit allowPast', () => {
    expect(() => day('2026-11-15')).toThrow(/liegt in der Vergangenheit/);
    expect(() => day('2026-11-15')).toThrow(/allowPast/);
    expect(day('2026-11-15', { allowPast: true })).toBe('2026-11-15');
    expect(day('2026-11-16')).toBe('2026-11-16');
    expect(() => day('gestern')).toThrow(/Vergangenheit/);
  });
  it('Unsinn wird mit Beispielen abgelehnt', () => {
    expect(() => day('irgendwann')).toThrow(/verstehe ich nicht als Datum.*morgen/);
    expect(() => day('')).toThrow(/fehlt/);
    expect(() => day('2026-11-20T25:00')).toThrow(/Uhrzeit/);
    expect(() => day('2026-11-20', { field: 'due', allowPast: false, now: Date.UTC(2026, 11, 1) })).toThrow(/^due:/);
  });
  it('deutsche Kurzformen', () => {
    expect(day('30.11.2026')).toBe('2026-11-30');
    expect(day('30.11.')).toBe('2026-11-30');
    expect(day('1.12.26')).toBe('2026-12-01');
  });
});

describe('relative Angaben (C1)', () => {
  it('alle Wörter', () => {
    expect(day('heute')).toBe('2026-11-16');
    expect(day('sofort')).toBe('2026-11-16');
    expect(day('morgen')).toBe('2026-11-17');
    expect(day('Morgen')).toBe('2026-11-17');
    expect(day('übermorgen')).toBe('2026-11-18');
    expect(day('bis morgen')).toBe('2026-11-17');
    expect(day('Freitag')).toBe('2026-11-20');
    expect(day('am Mittwoch')).toBe('2026-11-18');
    expect(day('bis Freitag')).toBe('2026-11-20');
    // heute ist Montag: „Montag“ meint den nächsten
    expect(day('Montag')).toBe('2026-11-23');
    expect(day('nächsten Dienstag')).toBe('2026-11-17');
    expect(day('nächste Woche')).toBe('2026-11-23');
    expect(day('übernächste Woche')).toBe('2026-11-30');
    expect(day('Ende der Woche')).toBe('2026-11-20');
    expect(day('in 3 Tagen')).toBe('2026-11-19');
    expect(day('in drei Tagen')).toBe('2026-11-19');
    expect(day('in zwei Wochen')).toBe('2026-11-30');
    expect(day('in einer Woche')).toBe('2026-11-23');
    expect(day('in 2 Monaten')).toBe('2027-01-16');
    expect(day('Ende des Monats')).toBe('2026-11-30');
    expect(day('Monatsende')).toBe('2026-11-30');
    expect(day('Ende nächsten Monats')).toBe('2026-12-31');
    expect(day('nächsten Monat')).toBe('2026-12-01');
  });
  it('Monatsgrenzen und Jahreswechsel', () => {
    const jan31 = Date.UTC(2027, 0, 31, 9);
    expect(day('morgen', { now: jan31 })).toBe('2027-02-01');
    expect(day('in 1 Monat', { now: jan31 })).toBe('2027-02-28');
    expect(day('Ende des Monats', { now: Date.UTC(2028, 1, 10, 9) })).toBe('2028-02-29');
    const dec31 = Date.UTC(2026, 11, 31, 9);
    expect(day('übermorgen', { now: dec31 })).toBe('2027-01-02');
    expect(day('nächsten Monat', { now: dec31 })).toBe('2027-01-01');
  });
  it('im Fließtext (Regel-Parser)', () => {
    expect(findRelativeDate('Hausmeister informieren bis Freitag', NOW, TZ)?.days).toBe(4);
    expect(findRelativeDate('Fachfirma beauftragen, nächste Woche', NOW, TZ)?.days).toBe(7);
    expect(findRelativeDate('übermorgen Termin', NOW, TZ)?.days).toBe(2);
    expect(findRelativeDate('in 3 Tagen Nachprüfung', NOW, TZ)?.days).toBe(3);
    expect(findRelativeDate('Tür schließt nicht', NOW, TZ)).toBeNull();
  });
});

describe('Zeitzone des Workspaces (E1)', () => {
  it('Zeit ohne Zone gilt als Ortszeit', () => {
    const p = parseDateInput('2026-11-16T12:00', { timeZone: TZ, now: NOW, allowPast: true });
    // 12:00 Berlin (Winterzeit) = 11:00 UTC
    expect(p.at).toBe(Date.UTC(2026, 10, 16, 11, 0));
    expect(dayTimeIn(p.at, TZ)).toBe('2026-11-16 12:00');
    const summer = parseDateInput('2026-07-01T12:00', { timeZone: TZ, allowPast: true, now: NOW });
    expect(summer.at).toBe(Date.UTC(2026, 6, 1, 10, 0));
    const ny = parseDateInput('2026-11-16T12:00', { timeZone: 'America/New_York', allowPast: true, now: NOW });
    expect(ny.at).toBe(Date.UTC(2026, 10, 16, 17, 0));
  });
  it('mit Zone bleibt die Zone', () => {
    expect(parseDateInput('2026-11-16T12:00Z', { timeZone: TZ, allowPast: true, now: NOW }).at).toBe(Date.UTC(2026, 10, 16, 12));
    expect(parseDateInput('2026-11-16T12:00+02:00', { timeZone: TZ, allowPast: true, now: NOW }).at).toBe(Date.UTC(2026, 10, 16, 10));
  });
  it('„heute“ hängt an der Zone: kurz nach Mitternacht Berlin ist in UTC noch gestern', () => {
    const late = Date.UTC(2026, 10, 16, 23, 30); // 17.11. 00:30 Berlin
    expect(day('heute', { now: late })).toBe('2026-11-17');
    expect(dayIn(parseDateInput('heute', { timeZone: 'UTC', now: late }).at, 'UTC')).toBe('2026-11-16');
  });
  it('Tagesgrenzen für Zeiträume', () => {
    const from = parseDateInput('2026-11-01', { timeZone: TZ, allowPast: true, time: 'start', now: NOW }).at;
    const to = parseDateInput('2026-11-30', { timeZone: TZ, allowPast: true, time: 'end', now: NOW }).at;
    expect(from).toBe(Date.UTC(2026, 9, 31, 23));
    expect(to).toBe(Date.UTC(2026, 10, 30, 23) - 1);
    const r = monthRange('2026-11', TZ);
    expect([r.from, r.to]).toEqual([from, to]);
    expect(dayIn(r.to, TZ)).toBe('2026-11-30');
    expect(() => monthRange('2026-13', TZ)).toThrow(DateInputError);
  });
  it('Sommerzeit-Umstellung', () => {
    // 29.03.2026: 02:00 → 03:00
    expect(zonedTime({ y: 2026, m: 3, d: 29 }, 12, 0, 0, TZ)).toBe(Date.UTC(2026, 2, 29, 10));
    expect(zonedTime({ y: 2026, m: 3, d: 29 }, 0, 0, 0, TZ)).toBe(Date.UTC(2026, 2, 28, 23));
  });
});
