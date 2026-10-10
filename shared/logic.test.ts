import { describe, expect, it } from 'vitest';
import { addMonths, computeResult, DAY, dueState, isComplete } from './logic';

describe('computeResult', () => {
  it('ok without defects', () => {
    expect(computeResult({ answers: { p1: 'ok', p2: 'na' }, defects: [] })).toBe('ok');
  });
  it('defects when a checkpoint fails', () => {
    expect(computeResult({ answers: { p1: 'defect' }, defects: [] })).toBe('defects');
  });
  it('critical wins over defects', () => {
    expect(computeResult({ answers: { p1: 'defect' }, defects: [{ title: 'x', severity: 'critical' }] })).toBe('critical');
  });
  it('not inspectable overrides everything', () => {
    expect(computeResult({ notInspectable: true, answers: { p1: 'defect' }, defects: [] })).toBe('not_inspectable');
  });
});

describe('addMonths', () => {
  it('clamps to month end', () => {
    expect(new Date(addMonths(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
  it('adds years', () => {
    expect(new Date(addMonths(Date.UTC(2026, 8, 18), 24)).toISOString().slice(0, 10)).toBe('2028-09-18');
  });
});

describe('dueState', () => {
  const now = Date.UTC(2026, 9, 10);
  it('classifies', () => {
    expect(dueState(null, now)).toBe('never');
    expect(dueState(now - DAY, now)).toBe('overdue');
    expect(dueState(now + 10 * DAY, now)).toBe('soon');
    expect(dueState(now + 60 * DAY, now)).toBe('ok');
  });
});

describe('isComplete', () => {
  it('requires all answers unless not inspectable', () => {
    expect(isComplete(['p1', 'p2'], { p1: 'ok' })).toBe(false);
    expect(isComplete(['p1', 'p2'], { p1: 'ok', p2: 'na' })).toBe(true);
    expect(isComplete(['p1'], {}, true)).toBe(true);
  });
});

import { applyInspection, summarizeSchedules } from './logic';

describe('schedules', () => {
  it('never inspected main → null', () => {
    expect(summarizeSchedules({}).nextDueAt).toBeNull();
    expect(summarizeSchedules({ main: { enabled: true } }).nextKey).toBe('main');
  });
  it('earliest enabled schedule wins, disabled ignored', () => {
    const s = {
      main: { enabled: true, lastAt: 10, lastResult: 'ok' as const, nextDueAt: 1000 },
      inner: { enabled: true, nextDueAt: 500 },
      strength: { enabled: false, nextDueAt: 100 },
    };
    expect(summarizeSchedules(s)).toMatchObject({ nextDueAt: 500, nextKey: 'inner', lastAt: 10 });
  });
  it('applyInspection keeps due date when not inspectable and ignores older results', () => {
    let s = applyInspection({}, 'main', 100, 'ok', 900);
    s = applyInspection(s, 'main', 200, 'not_inspectable', null);
    expect(s.main).toMatchObject({ lastAt: 200, lastResult: 'not_inspectable', nextDueAt: 900 });
    expect(applyInspection(s, 'main', 50, 'ok', 400)).toBe(s);
  });
});
