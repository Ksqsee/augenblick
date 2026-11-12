import { describe, expect, it } from 'vitest';
import { type CarryLike, decideKnown, groupKnownDefects, type KnownDefect, knownDecision, linkKnownDefects } from './carry';

const k = (id: string, checkpointId: string | null, title: string, createdAt = 1000): KnownDefect => ({ id, checkpointId, title, note: '', measure: '', severity: 'medium', createdAt });

describe('Bekannte Mängel im Prüfablauf', () => {
  it('ordnet nach Prüfpunkt, sonst eigener Block', () => {
    const g = groupKnownDefects([k('a', 'p1', 'Schließer'), k('b', null, 'Keil'), k('c', 'p9', 'alt')], ['p1', 'p2']);
    expect(g.byCheckpoint.get('p1')!.map((x) => x.id)).toEqual(['a']);
    expect(g.loose.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('verknüpft ausdrücklich und über gleiche Bezeichnung, jeden höchstens einmal', () => {
    const known = [k('a', 'p1', 'Schließer defekt', 10), k('b', null, 'Keil unter der Tür', 20)];
    const out = linkKnownDefects<CarryLike>(
      [
        { checkpointId: 'p1', title: 'anders formuliert', knownId: 'a' },
        { title: '  keil unter der  Tür ' },
        { title: 'Keil unter der Tür' },
        { title: 'Neu', knownId: 'weg' },
      ],
      known,
    );
    expect(out.map((d) => d.knownId)).toEqual(['a', 'b', undefined, undefined]);
    expect(out[0]!.since).toBe(10);
    expect(out[1]!.since).toBe(20);
  });

  it('als behoben gemeldete werden nicht verknüpft', () => {
    expect(linkKnownDefects<CarryLike>([{ title: 'Schließer defekt' }], [k('a', 'p1', 'Schließer defekt')], ['a'])[0]!.knownId).toBeUndefined();
  });

  it('Weiterhin vorhanden / Behoben / zurücknehmen', () => {
    const a = k('a', 'p1', 'Schließer defekt', 5);
    const base = { answers: {}, defects: [{ checkpointId: 'p1', title: 'p1', note: '', severity: 'medium' as const }], resolvedDefects: [] as string[] };
    const present = decideKnown(base, a, 'present', ['p1']);
    expect(present.answers).toEqual({ p1: 'defect' });
    expect(present.defects).toEqual([{ checkpointId: 'p1', title: 'Schließer defekt', note: '', measure: '', severity: 'medium', knownId: 'a', since: 5 }]);
    expect(knownDecision(present, 'a')).toBe('present');
    const resolved = decideKnown(present, a, 'resolved', ['p1']);
    expect(resolved.answers).toEqual({ p1: 'ok' });
    expect(resolved.defects).toEqual([]);
    expect(resolved.resolvedDefects).toEqual(['a']);
    expect(knownDecision(resolved, 'a')).toBe('resolved');
    const undone = decideKnown(resolved, a, 'open', ['p1']);
    expect(undone.answers).toEqual({});
    expect(knownDecision(undone, 'a')).toBe('open');
    // ohne passenden Prüfpunkt: nur verknüpfen, keine Antwort
    const loose = decideKnown({ answers: {}, defects: [] }, k('b', 'p9', 'Keil'), 'present', ['p1']);
    expect(loose.answers).toEqual({});
    expect(loose.defects[0]).toMatchObject({ knownId: 'b', checkpointId: undefined });
  });
});
