import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './catalog';
import { buildChecklist, CHECKLIST_TEXTS, requirementOf } from './checklist';
import { tr } from './i18n';

const door = CATEGORIES.fire_door;
const label = (k: string) => door.attributes.find((a) => a.key === k)?.label;

describe('Checkliste je Typ', () => {
  it('nur zutreffende Punkte, Unbekanntes „falls vorhanden“', () => {
    const conds = door.checkpoints.filter((c) => c.appliesIf);
    expect(conds.length).toBeGreaterThan(0);
    // alle Bedingungen erfüllt → alle Punkte
    const yes = Object.fromEntries(conds.map((c) => [c.appliesIf!.attr, c.appliesIf!.equals]));
    expect(buildChecklist(door.checkpoints, 'fire_door', yes).total).toBe(door.checkpoints.length);
    // keine Bedingung erfüllt → bedingte Punkte entfallen
    const no = Object.fromEntries(conds.map((c) => [c.appliesIf!.attr, typeof c.appliesIf!.equals === 'boolean' ? !c.appliesIf!.equals : '__anders__']));
    const n = buildChecklist(door.checkpoints, 'fire_door', no);
    expect(n.total).toBe(door.checkpoints.length - conds.length);
    expect(n.omitted).toEqual(conds.map((c) => c.label));
    // ohne Stammdaten: alles da, bedingte mit „falls vorhanden“
    const u = buildChecklist(door.checkpoints, 'fire_door', {}, label);
    const rows = u.groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(door.checkpoints.length);
    expect(rows.filter((r) => r.ifPresent).length).toBe(conds.length);
    // fortlaufende Nummern über die Gruppen
    expect(rows.map((r) => r.n).sort((a, b) => a - b)).toEqual(rows.map((_, i) => i + 1));
  });
  it('Anforderung aus Feld oder Feuerwiderstand + Rauchschutz', () => {
    expect(requirementOf({ requirement: 'T90-RS' })).toBe('T90-RS');
    expect(requirementOf({ rating: 'T30', smoke: true })).toBe('T30-RS');
    expect(requirementOf({ rating: 'T30' })).toBe('T30');
    expect(requirementOf({})).toBe('');
  });
  it('alle festen Texte (Seite und PDF) haben eine englische Fassung', () => {
    expect(CHECKLIST_TEXTS.filter((t) => tr('en', t) === t)).toEqual([]);
    const src = readFileSync('src/pdf/checklist.ts', 'utf8');
    const used = [...src.matchAll(/T\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(8);
    expect(used.filter((t) => tr('en', t) === t)).toEqual([]);
  });
});
