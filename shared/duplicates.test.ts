import { describe, expect, it } from 'vitest';
import { CATALOG_SEED_DEFECTS, CATALOG_SEED_TERMS } from './catalog';
import { CATALOG_EXTRA_DEFECTS } from './catalog-extra';
import { expandCatalogDefects, findDuplicate, splitFindings } from './duplicates';
import { matchCatalogDefects } from './vocab';

const defects = CATALOG_SEED_DEFECTS.map((d, i) => ({ ...d, id: `d${i}` }));
const vocab = { terms: CATALOG_SEED_TERMS, defects };
const open = (...titles: string[]) => titles.map((title, i) => ({ id: `x${i}`, title }));

describe('Duplikat-Abgleich (B2)', () => {
  it('Abkürzungen werden vor dem Vergleich ausgeschrieben', () => {
    const existing = open('Obentürschließer schließt nicht');
    expect(findDuplicate('OTS zieht nicht zu', existing, vocab)?.candidate.title).toBe('Obentürschließer schließt nicht');
    expect(findDuplicate('Obentürschließer schließt nicht', open('OTS schließt nicht'), vocab)?.reason).toBe('similar');
    // ohne Begriffe (alter Stand) kein Treffer
    expect(findDuplicate('OTS zieht nicht zu', existing, {})).toBeNull();
  });
  it('Katalog-Synonyme: verschiedene Worte, derselbe Katalog-Mangel', () => {
    const hit = findDuplicate('Tür fällt nicht ins Schloss', open('Schließer zu schwach'), vocab, 'fire_door');
    expect(hit?.reason).toBe('catalog');
    expect(hit?.via).toBe('Tür schließt nicht vollständig');
  });
  it('verschiedene Probleme bleiben getrennt', () => {
    expect(findDuplicate('Dichtung fehlt', open('Obentürschließer schließt nicht'), vocab, 'fire_door')).toBeNull();
    expect(findDuplicate('Feuerlöscher Plombe fehlt', open('Rauchwarnmelder verschmutzt'), vocab)).toBeNull();
    expect(findDuplicate('', open('x'), vocab)).toBeNull();
    expect(findDuplicate('Tür klemmt', [], vocab)).toBeNull();
  });
  it('Befunde in Entwürfen zählen als Kandidaten (Herkunft bleibt erhalten)', () => {
    const draft = [{ title: 'OTS zieht nicht zu', source: 'draft' as const }];
    expect(findDuplicate('Obentürschließer zieht nicht zu', draft, vocab)?.candidate.source).toBe('draft');
  });
});

describe('mehrere Befunde zerlegen (C3)', () => {
  it('Komma, „und“, „außerdem“, Semikolon', () => {
    expect(splitFindings('OTS zieht nicht zu, Dichtung fehlt und Spion verkratzt')).toEqual(['OTS zieht nicht zu', 'Dichtung fehlt', 'Spion verkratzt']);
    expect(splitFindings('Haftmagnet brummt; außerdem Rauchmelder verschmutzt.')).toEqual(['Haftmagnet brummt', 'Rauchmelder verschmutzt']);
    expect(splitFindings('Tür klemmt')).toEqual(['Tür klemmt']);
  });
  it('einzelne Wörter hängen am vorigen Befund', () => {
    expect(splitFindings('Dichtung beschädigt und lose')).toEqual(['Dichtung beschädigt und lose']);
  });
  it('„1. OG“ trennt nicht', () => {
    expect(splitFindings('Tür im 1. OG schließt nicht')).toEqual(['Tür im 1. OG schließt nicht']);
  });
  it('Katalog matcht ausgeschriebene Begriffe in beide Richtungen', () => {
    const own = [{ id: 'o', title: 'OTS ölt', synonyms: [], severity: 'low' as const, measure: 'Schließer tauschen', category: 'fire_door' }];
    expect(matchCatalogDefects('Obentürschließer ölt', own)).toHaveLength(0);
    expect(matchCatalogDefects('Obentürschließer ölt', expandCatalogDefects(own, CATALOG_SEED_TERMS))[0]?.defect.title).toBe('OTS ölt');
  });
});

describe('Grundausstattung Nachtrag (F6)', () => {
  it('typische Mängel für Feuerlöscher, Rauchwarnmelder und Brandschutzklappen', () => {
    for (const k of ['extinguisher', 'smoke_alarm', 'damper']) expect(CATALOG_EXTRA_DEFECTS.filter((d) => d.category === k).length).toBeGreaterThanOrEqual(4);
    const all = [...CATALOG_SEED_DEFECTS, ...CATALOG_EXTRA_DEFECTS];
    expect(new Set(all.map((d) => `${d.category}|${d.title.toLowerCase()}`)).size).toBe(all.length);
    const extra = CATALOG_EXTRA_DEFECTS.map((d, i) => ({ ...d, id: `e${i}` }));
    expect(matchCatalogDefects('Plombe am Löscher fehlt', extra, { category: 'extinguisher' })[0]?.defect.category).toBe('extinguisher');
    expect(matchCatalogDefects('Rauchmelder piept', extra, { category: 'smoke_alarm' })[0]?.defect.category).toBe('smoke_alarm');
  });
});
