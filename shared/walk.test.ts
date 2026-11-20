import { describe, expect, it } from 'vitest';
import { draftOutcome, filterWalk, inspectionStatus, pickWalkDay, type WalkInspection, walkDays, walkResult } from './walk';

const asset = (id: string, p: Partial<{ code: string; floor: string; number: number; createdAt: number }> = {}) => ({ id, code: id.toUpperCase(), floor: 'EG', number: null as number | null, createdAt: 0, ...p });
const insp = (id: string, assetId: string, p: Partial<WalkInspection> = {}): WalkInspection => ({
  id,
  assetId,
  status: 'submitted',
  ready: false,
  result: 'ok',
  defects: 0,
  rawPending: 0,
  at: 1000,
  inspectorId: 'u1',
  inspector: 'Ina',
  ...p,
});

describe('Begehung: Tage', () => {
  it('gruppiert nach Kalendertag in der Zeitzone, neuester zuerst, mit Anzahl', () => {
    // 23:30 UTC am 19.11. ist in Berlin (MEZ) schon der 20.11.
    const t1 = Date.UTC(2026, 10, 19, 23, 30);
    const t2 = Date.UTC(2026, 10, 20, 8, 0);
    const t3 = Date.UTC(2026, 10, 12, 9, 0);
    expect(walkDays([t3, t1, t2], 'Europe/Berlin')).toEqual([
      { date: '2026-11-20', count: 2 },
      { date: '2026-11-12', count: 1 },
    ]);
    expect(walkDays([t1], 'UTC')).toEqual([{ date: '2026-11-19', count: 1 }]);
  });
  it('wählt den gewünschten Tag, sonst den neuesten, sonst heute', () => {
    const days = [{ date: '2026-11-20' }, { date: '2026-11-12' }];
    expect(pickWalkDay(days, '2026-11-12', '2026-11-21')).toBe('2026-11-12');
    expect(pickWalkDay(days, 'gestern', '2026-11-21')).toBe('2026-11-20');
    expect(pickWalkDay(days, null, '2026-11-21')).toBe('2026-11-20');
    expect(pickWalkDay([], undefined, '2026-11-21')).toBe('2026-11-21');
  });
});

describe('Begehung: Status je Element', () => {
  it('Ergebnis → bestanden, mit Mangel (auch kritisch), nicht prüfbar; unfertiger Entwurf bleibt offen', () => {
    expect(inspectionStatus({ status: 'submitted', ready: false, result: 'ok' })).toBe('ok');
    expect(inspectionStatus({ status: 'submitted', ready: false, result: 'defects' })).toBe('defects');
    expect(inspectionStatus({ status: 'submitted', ready: false, result: 'critical' })).toBe('defects');
    expect(inspectionStatus({ status: 'submitted', ready: false, result: 'not_inspectable' })).toBe('not_inspectable');
    expect(inspectionStatus({ status: 'draft', ready: true, result: 'defects' })).toBe('defects');
    expect(inspectionStatus({ status: 'draft', ready: false, result: null })).toBe('open');
  });
  it('Entwurf: Ergebnis wie beim Abschluss', () => {
    expect(draftOutcome({ answers: { a: 'ok' }, defects: [] })).toBe('ok');
    expect(draftOutcome({ answers: { a: 'ok' }, defects: [{ severity: 'medium', title: 'Dichtung' }] })).toBe('defects');
    expect(draftOutcome({ answers: {}, defects: [{ severity: 'critical' }] })).toBe('critical');
    expect(draftOutcome({ notInspectable: true, answers: {}, defects: [] })).toBe('not_inspectable');
    expect(draftOutcome({ answers: { a: 'defect' }, defects: [] })).toBe('defects');
    // festgelegt: „ohne Mängel“ nur ohne erfasste Mängel
    expect(draftOutcome({ answers: { a: 'defect' }, defects: [], resultOverride: 'ok' })).toBe('ok');
    expect(draftOutcome({ answers: {}, defects: [{ severity: 'low' }], resultOverride: 'ok' })).toBe('defects');
  });
});

describe('Begehung: Ergebnisliste und Zähler', () => {
  const assets = [asset('t3', { floor: '1. OG', number: 3 }), asset('t1', { number: 1 }), asset('t2', { number: 2 }), asset('t4', { number: 4, floor: '1. OG' }), asset('t5', { number: 5, floor: 'DG' })];
  it('zählt bestanden · mit Mangel · nicht prüfbar · offen und hält die Laufreihenfolge', () => {
    const r = walkResult(assets, [
      insp('i1', 't1'),
      insp('i2', 't2', { status: 'draft', ready: true, result: 'defects', defects: 1, rawPending: 1 }),
      insp('i3', 't3', { result: 'not_inspectable' }),
      insp('i4', 't4', { status: 'draft', ready: false, result: null }),
    ]);
    expect(r.rows.map((x) => x.asset.id)).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(r.counts).toEqual({ ok: 1, defects: 1, not_inspectable: 1, open: 2 });
    expect(r.done).toBe(3);
    expect(r.unsigned).toBe(1);
    expect(r.rawPending).toBe(1);
    expect(r.rows.find((x) => x.asset.id === 't4')).toMatchObject({ status: 'open', started: true, unsigned: false });
    expect(r.rows.find((x) => x.asset.id === 't5')).toMatchObject({ status: 'open', inspection: null, started: false });
    expect(r.rows.find((x) => x.asset.id === 't2')).toMatchObject({ unsigned: true, critical: false });
  });
  it('mehrere Prüfungen am Tag: abgeschlossen vor bereit vor angefangen, sonst die neueste', () => {
    const r = walkResult(
      [asset('t1')],
      [insp('a', 't1', { status: 'draft', ready: true, result: 'ok', at: 3000 }), insp('b', 't1', { result: 'critical', at: 2000 }), insp('c', 't1', { status: 'draft', result: null, at: 4000 })],
    );
    expect(r.rows[0]).toMatchObject({ status: 'defects', critical: true, more: 2 });
    expect(r.rows[0]!.inspection!.id).toBe('b');
    const s = walkResult([asset('t1')], [insp('a', 't1', { at: 1 }), insp('b', 't1', { result: 'defects', at: 2 })]);
    expect(s.rows[0]!.inspection!.id).toBe('b');
  });
  it('Elemente, die erst nach dem Tag angelegt wurden, fehlen – außer sie wurden an dem Tag geprüft', () => {
    const later = [asset('t1', { createdAt: 10 }), asset('t2', { createdAt: 5000 }), asset('t3', { createdAt: 6000 })];
    const r = walkResult(later, [insp('x', 't3')], { dayEnd: 1000 });
    expect(r.rows.map((x) => x.asset.id)).toEqual(['t1', 't3']);
    expect(r.counts).toEqual({ ok: 1, defects: 0, not_inspectable: 0, open: 1 });
  });
  it('filtert nach Status', () => {
    const r = walkResult(assets, [insp('i1', 't1'), insp('i2', 't2', { result: 'defects' })]);
    expect(filterWalk(r.rows, 'all')).toHaveLength(5);
    expect(filterWalk(r.rows, 'defects').map((x) => x.asset.id)).toEqual(['t2']);
    expect(filterWalk(r.rows, 'open')).toHaveLength(3);
  });
  it('leer: alles offen', () => {
    const r = walkResult(assets, []);
    expect(r.counts.open).toBe(5);
    expect(r.done).toBe(0);
  });
});
