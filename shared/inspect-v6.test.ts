// Plan v6, Paket T: Laufreihenfolge (A3), Bedingungen an Prüfpunkten (A4), Prüfpunkt-Zuordnung (A5),
// Wartungs-Synonyme (C4), Widersprüche (C6) und Stammdaten-Prüfung (D1).
import { describe, expect, it } from 'vitest';
import { allOkAnswers, checkpointApplies, conditionOf } from './applies';
import { validateAttributes } from './asset-fields';
import { CATALOG_SEED_DEFECTS, CATEGORIES, type CatalogDefect } from './catalog';
import { assignCheckpoint, matchMaintenance, workContradiction } from './inspect-match';
import { compareWalk, floorRank, walkSort } from './walk-order';

const catalog: CatalogDefect[] = CATALOG_SEED_DEFECTS.map((d, i) => ({ ...d, id: `d${i}` }));
const door = CATEGORIES.fire_door;
const fsa = CATEGORIES.hold_open;

describe('Laufreihenfolge (A3)', () => {
  it('Etagen von unten nach oben, Unbekanntes ans Ende', () => {
    const floors = ['DG', '2. OG', 'EG', '1. OG', 'UG', 'ZG', 'TG', '2. UG', 'Technik', '', 'KG', 'OG 3'];
    expect([...floors].sort((a, b) => floorRank(a) - floorRank(b))).toEqual(['TG', '2. UG', 'UG', 'KG', 'EG', 'ZG', '1. OG', '2. OG', 'OG 3', 'DG', 'Technik', '']);
  });
  it('Bericht: setup UG → EG → 1. OG → 2. OG kommt in genau dieser Reihenfolge zurück', () => {
    // Anlage-Reihenfolge = sort_index; alphabetisch wäre 1. OG, 2. OG, EG, UG
    const made = [
      { code: 'FST-001', floor: 'UG', sortIndex: 1 },
      { code: 'FST-002', floor: 'EG', sortIndex: 2 },
      { code: 'FL-003', floor: 'EG', sortIndex: 3 },
      { code: 'FST-004', floor: '1. OG', sortIndex: 4 },
      { code: 'FST-005', floor: '2. OG', sortIndex: 5 },
    ];
    const shuffled = [made[3]!, made[4]!, made[1]!, made[0]!, made[2]!];
    expect(walkSort(shuffled).map((a) => a.code)).toEqual(['FST-001', 'FST-002', 'FL-003', 'FST-004', 'FST-005']);
  });
  it('innerhalb der Etage Anlage-Reihenfolge, Bestand nach Nummer und Anlagezeit', () => {
    const a = { code: 'FST-009', floor: 'EG', sortIndex: 1 };
    const b = { code: 'FST-002', floor: 'EG', sortIndex: 2 };
    expect(compareWalk(a, b)).toBeLessThan(0);
    const c = { code: 'X-2', floor: 'EG', sortIndex: null, number: null, createdAt: 5 };
    const d = { code: 'X-1', floor: 'EG', sortIndex: null, number: null, createdAt: 9 };
    expect(walkSort([d, c]).map((x) => x.code)).toEqual(['X-2', 'X-1']);
  });
});

describe('Bedingungen an Prüfpunkten (A4)', () => {
  const answersFor = (attrs: Record<string, unknown>) => allOkAnswers(door.checkpoints, {}, 'fire_door', attrs);
  const id = (label: RegExp) => door.checkpoints.find((c) => label.test(c.label))!.id;
  it('FST ohne Feststellanlage: „löst aus“ und „Melder der FSA“ entfallen, einflügelig: Schließfolge entfällt', () => {
    const r = answersFor({ holdOpen: false, leaves: '1-flügelig' });
    expect(r.answers[id(/Feststellanlage löst/)]).toBe('na');
    expect(r.answers[id(/Rauchmelder der Feststellanlage/)]).toBe('na');
    expect(r.answers[id(/Schließfolge/)]).toBe('na');
    expect(r.answers[id(/Obentürschließer/)]).toBe('ok');
    expect(r.unknown).toEqual([]);
    expect(r.na).toHaveLength(3);
  });
  it('mit Feststellanlage und zweiflügelig: alles i. O.', () => {
    const r = answersFor({ holdOpen: true, leaves: '2-flügelig' });
    expect(Object.values(r.answers).every((a) => a === 'ok')).toBe(true);
    expect(r.ok).toHaveLength(door.checkpoints.length);
  });
  it('unbekanntes Stammdatum: Punkt bleibt offen, gezielte Rückfrage', () => {
    const r = answersFor({});
    expect(r.answers[id(/Feststellanlage löst/)]).toBeUndefined();
    expect(r.unknown.map((u) => u.question)).toContain('Hat die Tür eine Feststellanlage?');
    expect(r.unknown.map((u) => u.question)).toContain('Ist die Tür ein- oder zweiflügelig?');
  });
  it('beantwortete Punkte bleiben; Bedingung über die Bezeichnung auch ohne gespeichertes Feld', () => {
    const r = allOkAnswers(door.checkpoints, { [id(/Feststellanlage löst/)]: 'defect' }, 'fire_door', { holdOpen: false });
    expect(r.answers[id(/Feststellanlage löst/)]).toBe('defect');
    expect(conditionOf({ label: 'Feststellanlage löst bei Auslösung aus' }, 'fire_door')).toEqual({ attr: 'holdOpen', equals: true });
    expect(conditionOf({ label: 'Feststellanlage löst bei Auslösung aus' }, 'extinguisher')).toBeNull();
    expect(checkpointApplies({ attr: 'holdOpen', equals: true }, { holdOpen: 'nein' })).toBe('no');
    expect(checkpointApplies({ attr: 'leaves', equals: '2-flügelig' }, { leaves: '2-Flügelig' })).toBe('yes');
  });
  it('Monatliche Sichtkontrolle trägt die Bedingung ebenfalls', () => {
    const visual = door.schedules.find((s) => s.key === 'visual')!.checkpoints!;
    expect(allOkAnswers(visual, {}, 'fire_door', { holdOpen: false }).na).toHaveLength(1);
  });
});

describe('Prüfpunkt-Zuordnung (A5)', () => {
  const label = (cps: { id: string; label: string }[], id: string | null) => cps.find((c) => c.id === id)?.label ?? null;
  it('Bericht: „Dichtung beschädigt oder fehlend“ landet bei den Dichtungen, nicht beim Türblatt', () => {
    const r = assignCheckpoint('Dichtung beschädigt oder fehlend', door.checkpoints, { defects: catalog, category: 'fire_door' });
    expect(label(door.checkpoints, r.id)).toMatch(/^Dichtungen/);
    expect(r.unsure).toBe(false);
  });
  it('klare Treffer', () => {
    expect(label(door.checkpoints, assignCheckpoint('Obentürschließer zieht nicht ganz zu', door.checkpoints).id)).toMatch(/^Obentürschließer/);
    expect(label(door.checkpoints, assignCheckpoint('Glasleiste lose', door.checkpoints).id)).toMatch(/^Verglasung/);
    expect(label(door.checkpoints, assignCheckpoint('Tür schließt nicht', door.checkpoints).id)).toMatch(/^Obentürschließer/);
  });
  it('unsicher → keine Zuordnung, Kandidaten für die Rückfrage', () => {
    const r = assignCheckpoint('Melder', fsa.checkpoints);
    expect(r.id).toBeNull();
    expect(r.unsure).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(1);
    expect(assignCheckpoint('irgendwas Unbekanntes', door.checkpoints)).toMatchObject({ id: null, unsure: false });
    expect(assignCheckpoint('beschädigt', door.checkpoints).id).toBeNull();
  });
});

describe('Wartungsarbeiten mit Synonymen (C4) und Widersprüche (C6)', () => {
  it('andere Worte für dieselbe Arbeit', () => {
    expect(matchMaintenance('Batterie gewechselt', CATEGORIES.smoke_alarm.maintenance)?.key).toBe('battery');
    expect(matchMaintenance('Schließer eingestellt', door.maintenance)?.key).toBe('closer');
    expect(matchMaintenance('Türschließer justiert', door.maintenance)?.key).toBe('closer');
    expect(matchMaintenance('Melder sauber gemacht', fsa.maintenance)?.key).toBe('detectorCleaned');
    expect(matchMaintenance('Melder ersetzt', fsa.maintenance)?.key).toBe('detectorReplaced');
    expect(matchMaintenance('Dichtung erneuert', door.maintenance)?.key).toBe('seals');
    expect(matchMaintenance('Melder gereinigt', fsa.maintenance)?.key).toBe('detectorCleaned');
    expect(matchMaintenance('closer', door.maintenance)?.key).toBe('closer');
    expect(matchMaintenance('Fenster geputzt', door.maintenance)).toBeNull();
  });
  it('Arbeit „Melder gereinigt“ widerspricht Mangel „Melder verschmutzt“', () => {
    expect(workContradiction('Melder gereinigt', 'Melder verschmutzt')).toMatch(/widersprechen sich/);
    expect(workContradiction('Melder gereinigt', 'Melder über der Austauschfrist')).toBeNull();
    expect(workContradiction('Schließer nachjustiert', 'Obentürschließer schließt nicht')).toMatch(/widersprechen/);
    expect(workContradiction('Bänder geschmiert', 'Dichtung fehlt')).toBeNull();
  });
});

describe('Stammdaten prüfen (D1)', () => {
  const year = new Date().getFullYear();
  it('Bericht: rating „T45“, leaves „zwei“ als Auswahl, Baujahr 1890', () => {
    const r = validateAttributes(door.attributes, { rating: 'T45', leaves: 'zwei', year: 1890 });
    expect(r.errors.map((e) => e.key).sort()).toEqual(['rating', 'year']);
    expect(r.errors.find((e) => e.key === 'rating')!.message).toMatch(/T30/);
    expect(r.errors.find((e) => e.key === 'year')!.message).toMatch(/1950/);
    // „zwei“ ist eindeutig „2-flügelig“
    expect(r.values.leaves).toBe('2-flügelig');
  });
  it('gültige Werte werden vereinheitlicht', () => {
    const r = validateAttributes(door.attributes, { rating: 't30', year: '2019', holdOpen: 'ja', smoke: 'nein', leaves: '1' });
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual({ rating: 'T30', year: 2019, holdOpen: true, smoke: false, leaves: '1-flügelig' });
    expect(validateAttributes(door.attributes, { year: year + 1 }).errors).toEqual([]);
    expect(validateAttributes(door.attributes, { year: year + 2 }).errors).toHaveLength(1);
    expect(validateAttributes(door.attributes, { leaves: 'drei' }).errors).toHaveLength(1);
    expect(validateAttributes(door.attributes, { holdOpen: 'vielleicht' }).errors).toHaveLength(1);
    expect(validateAttributes(CATEGORIES.extinguisher.attributes, { size: 'sechs' }).errors).toHaveLength(1);
    expect(validateAttributes(CATEGORIES.extinguisher.attributes, { size: '6' }).values.size).toBe(6);
    expect(validateAttributes(door.attributes, { nope: 1 }).unknown).toEqual(['nope']);
    expect(validateAttributes(CATEGORIES.smoke_alarm.attributes, { manufactured: '2026-02-30' }).errors).toHaveLength(1);
  });
});
