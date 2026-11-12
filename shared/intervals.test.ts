import { describe, expect, it } from 'vitest';
import { applyInterval, describeProposal, effectiveInterval, proposeInterval } from './intervals';
import { addMonths, type Result } from './logic';

const h = (...rs: Result[]) => rs.map((result, i) => ({ at: 1000 * (i + 1), result }));

describe('effectiveInterval', () => {
  it('Standard ohne Anpassung', () => expect(effectiveInterval(12, undefined)).toBe(12));
  it('angepasster Wert', () => expect(effectiveInterval(12, { intervalMonths: 6 })).toBe(6));
  it('nie länger als der Standard', () => expect(effectiveInterval(6, { intervalMonths: 12 })).toBe(6));
  it('nie unter 1 Monat', () => expect(effectiveInterval(12, { intervalMonths: 0 })).toBe(1));
});

describe('proposeInterval', () => {
  it('zwei Prüfungen mit Mängeln in Folge → halbieren', () => {
    expect(proposeInterval(12, null, h('ok', 'defects', 'critical'))).toEqual({ kind: 'shorten', from: 12, to: 6, standard: 12 });
  });
  it('eine Prüfung mit Mängeln reicht nicht', () => {
    expect(proposeInterval(12, null, h('defects', 'ok', 'defects'))).toBeNull();
  });
  it('Reihenfolge wird nach Datum bestimmt', () => {
    const list = [
      { at: 3, result: 'ok' as const },
      { at: 1, result: 'defects' as const },
      { at: 2, result: 'defects' as const },
    ];
    expect(proposeInterval(12, null, list)).toBeNull();
  });
  it('„nicht prüfbar“ unterbricht die Folge nicht und zählt nicht', () => {
    expect(proposeInterval(12, null, h('defects', 'not_inspectable', 'defects'))?.to).toBe(6);
    expect(proposeInterval(12, null, h('defects', 'not_inspectable'))).toBeNull();
  });
  it('nur Prüfungen nach der letzten Entscheidung zählen', () => {
    expect(proposeInterval(12, { intervalMonths: 6, intervalAt: 2000 }, h('defects', 'defects'))).toBeNull();
    expect(proposeInterval(12, { intervalMonths: 6, intervalAt: 2000 }, h('defects', 'defects', 'defects', 'critical'))).toEqual({ kind: 'shorten', from: 6, to: 3, standard: 12 });
  });
  it('nie unter 1 Monat', () => {
    expect(proposeInterval(1, null, h('defects', 'defects'))).toBeNull();
    expect(proposeInterval(12, { intervalMonths: 1, intervalAt: 0 }, h('defects', 'defects'))).toBeNull();
    expect(proposeInterval(3, null, h('defects', 'defects'))?.to).toBe(1);
  });
  it('vier mängelfreie Prüfungen mit verkürztem Intervall → Standard', () => {
    const s = { intervalMonths: 6, intervalAt: 500 };
    expect(proposeInterval(12, s, h('ok', 'ok', 'ok'))).toBeNull();
    expect(proposeInterval(12, s, h('ok', 'ok', 'ok', 'ok'))).toEqual({ kind: 'restore', from: 6, to: 12, standard: 12 });
    expect(proposeInterval(12, s, h('ok', 'ok', 'defects', 'ok', 'ok', 'ok'))).toBeNull();
  });
  it('ohne Verkürzung keine Rückkehr', () => {
    expect(proposeInterval(12, null, h('ok', 'ok', 'ok', 'ok'))).toBeNull();
  });
  it('Standard gesenkt: Anpassung über dem Standard gilt nicht', () => {
    expect(proposeInterval(6, { intervalMonths: 12, intervalAt: 0 }, h('ok', 'ok', 'ok', 'ok'))).toBeNull();
  });
});

describe('applyInterval', () => {
  const last = Date.UTC(2026, 0, 15);
  it('verkürzt und rechnet den Termin ab der letzten Prüfung neu', () => {
    const s = applyInterval({ enabled: true, lastAt: last, lastResult: 'defects', nextDueAt: addMonths(last, 12) }, 12, 6, last + 1);
    expect(s).toMatchObject({ intervalMonths: 6, intervalAt: last + 1, nextDueAt: addMonths(last, 6) });
  });
  it('Standard entfernt die Anpassung', () => {
    const s = applyInterval({ enabled: true, lastAt: last, lastResult: 'ok', intervalMonths: 6 }, 12, 12, 9);
    expect(s.intervalMonths).toBeNull();
    expect(s.nextDueAt).toBe(addMonths(last, 12));
  });
  it('nie länger als der Standard', () => expect(applyInterval({ enabled: true }, 12, 24, 1).intervalMonths).toBeNull());
  it('nicht prüfbar: Termin bleibt', () => {
    expect(applyInterval({ enabled: true, lastAt: last, lastResult: 'not_inspectable', nextDueAt: 5 }, 12, 6, 1).nextDueAt).toBe(5);
  });
  it('Texte', () => {
    expect(describeProposal({ kind: 'shorten', from: 12, to: 6, standard: 12 })).toBe('Intervall von 12 auf 6 Monate verkürzen');
    expect(describeProposal({ kind: 'shorten', from: 2, to: 1, standard: 12 })).toBe('Intervall von 2 auf 1 Monat verkürzen');
  });
});
