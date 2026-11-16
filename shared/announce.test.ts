import { describe, expect, it } from 'vitest';
import {
  announcedAssetBody,
  findAnnounced,
  germanNumber,
  matchProductType,
  mergeRawNotes,
  parseAnnouncement,
  pendingRawNotes,
  rawNote,
  resolveAnnouncedType,
  type RawNote,
} from './announce';
import type { CatalogProduct } from './catalog';

const p = (id: string, manufacturer: string, model: string, extra: Partial<CatalogProduct & { aliases: string[] }> = {}) => ({
  id,
  manufacturer,
  model,
  category: 'fire_door',
  defaults: {},
  approval: '',
  note: '',
  ...extra,
});
const PRODUCTS = [
  p('sk32', 'Westag + Getalit', 'SK32', { defaults: { holdOpen: false, leaves: '1-flügelig', dropSeal: true, peephole: true } }),
  p('wg30rs', 'Westag + Getalit', 'T30 RS', { approval: 'Z-6.16-1211' }),
  p('wg30', 'Westag + Getalit', 'T30'),
  p('nov30', 'Novoferm', 'Premio T30-RS', { approval: 'Z-6.20-2205' }),
  p('nov90', 'Novoferm', 'Premio T90-RS'),
  p('hh41', 'Herholz', 'RS-1 Typ 4.1', { aliases: ['RS SSK 3', 'Gastzimmertür'] }),
  p('hh30', 'Herholz', 'T30-RS Typ 4.1'),
  p('ext', 'Gloria', 'PD 6 GA', { category: 'extinguisher' }),
];

describe('Zahlwörter', () => {
  it('Ziffern und Wörter bis 99 999', () => {
    expect(germanNumber('354')).toBe(354);
    expect(germanNumber('dreihundertvierundfünfzig')).toBe(354);
    expect(germanNumber('drei hundert vier und fünfzig')).toBe(354);
    expect(germanNumber('achthundertzehn')).toBe(810);
    expect(germanNumber('zwölf')).toBe(12);
    expect(germanNumber('einhundert')).toBe(100);
    expect(germanNumber('hundertundeins')).toBe(101);
    expect(germanNumber('tausendzwei')).toBe(1002);
    expect(germanNumber('zweitausenddreihundert')).toBe(2300);
    expect(germanNumber('Typ')).toBeNull();
    expect(germanNumber('zehnhundert')).toBeNull();
  });
});

describe('Ansage zerlegen', () => {
  it('Tür, Nummer, Typ', () => {
    const a = parseAnnouncement('Tür 354 Typ SK32');
    expect(a).toMatchObject({ number: 354, location: 'Raum 354', typeText: 'SK32', sameType: false, finding: '' });
  });
  it('Zahlwörter und Satzzeichen', () => {
    const a = parseAnnouncement('Tür dreihundertvierundfünfzig, Typ SK 32, Türstopper fehlt');
    expect(a).toMatchObject({ number: 354, typeText: 'SK 32', finding: 'Türstopper fehlt' });
  });
  it('„Zimmer 810“ ist Nummer und Standort', () => {
    expect(parseAnnouncement('Zimmer achthundertzehn Typ T30')).toMatchObject({ number: 810, location: 'Zimmer 810', typeText: 'T30' });
    expect(parseAnnouncement('Tür 12 im Zimmer 810 Typ SK32')).toMatchObject({ number: 12, location: 'Zimmer 810', typeText: 'SK32' });
    expect(parseAnnouncement('Nummer 36 Raum 1.04')).toMatchObject({ number: 36 });
  });
  it('„T dreißig RS“ wird geglättet', () => {
    expect(parseAnnouncement('Tür 7 Typ T dreißig R S').typeText).toBe('T30 RS');
    expect(parseAnnouncement('Tür 8 Typ t-30 RS').typeText).toBe('T30 RS');
  });
  it('gleicher Typ / nochmal so eine', () => {
    expect(parseAnnouncement('Tür 355, gleicher Typ')).toMatchObject({ number: 355, sameType: true, typeText: '' });
    expect(parseAnnouncement('Tür 356 nochmal so eine')).toMatchObject({ number: 356, sameType: true });
    expect(parseAnnouncement('Nochmal so eine, Tür 357, Dichtung fehlt')).toMatchObject({ number: 357, sameType: true, finding: 'Dichtung fehlt' });
    expect(parseAnnouncement('Tür 358 wie vorher').sameType).toBe(true);
  });
  it('ohne Nummer: nichts', () => {
    expect(parseAnnouncement('Typ SK32').number).toBeNull();
    expect(parseAnnouncement('eine Tür vom Typ SK32').number).toBeNull();
  });
  it('ohne Schlüsselwort Typ: Rest nach der Nummer', () => {
    expect(parseAnnouncement('Tür 400 Novoferm Premio T30 RS').typeText).toBe('Novoferm Premio T30 RS');
  });
});

describe('Typ im Katalog', () => {
  it('Modell, Bindestrich und Leerzeichen egal, längster Treffer', () => {
    expect(matchProductType('SK 32', PRODUCTS).product?.id).toBe('sk32');
    expect(matchProductType('T30 RS', PRODUCTS).product?.id).toBe('wg30rs');
    expect(matchProductType('T30', PRODUCTS).product?.id).toBe('wg30');
    expect(matchProductType('Premio T30 RS', PRODUCTS).product?.id).toBe('nov30');
  });
  it('Hersteller-Kurzformen', () => {
    expect(matchProductType('Novo Premio T90 RS', PRODUCTS).product?.id).toBe('nov90');
    expect(matchProductType('Westag T30', PRODUCTS).product?.id).toBe('wg30');
    // nur Hersteller: Auswahl seiner Typen
    expect(matchProductType('Novoferm', PRODUCTS).candidates.map((x) => x.id)).toEqual(['nov30', 'nov90']);
  });
  it('Aliasse (Feld aus Paket V)', () => {
    expect(matchProductType('RS SSK 3', PRODUCTS).product?.id).toBe('hh41');
    expect(matchProductType('Gastzimmertür', PRODUCTS).product?.id).toBe('hh41');
  });
  it('Rest nach dem Typ ist der Befund', () => {
    const m = matchProductType('SK32 Türstopper fehlt', PRODUCTS);
    expect(m.product?.id).toBe('sk32');
    expect(m.rest).toBe('Türstopper fehlt');
  });
  it('andere Elementart zählt nicht, Unbekanntes bleibt unbekannt', () => {
    expect(matchProductType('PD 6 GA', PRODUCTS, 'fire_door').product).toBeNull();
    expect(matchProductType('Brandschutztür grau', PRODUCTS).product).toBeNull();
    expect(matchProductType('Brandschutztür grau', PRODUCTS).candidates).toEqual([]);
  });
  it('Ansage auflösen: gleicher Typ, unbekannter Typ', () => {
    const last = PRODUCTS[0]!;
    expect(resolveAnnouncedType(parseAnnouncement('Tür 355 gleicher Typ'), PRODUCTS, last).product?.id).toBe('sk32');
    expect(resolveAnnouncedType(parseAnnouncement('Tür 355 gleicher Typ'), PRODUCTS, null).unknown).toBe(true);
    const u = resolveAnnouncedType(parseAnnouncement('Tür 360 Typ Blechtür grün'), PRODUCTS);
    expect(u).toMatchObject({ product: null, unknown: true });
    const f = resolveAnnouncedType(parseAnnouncement('Tür 354 Typ SK32 Türstopper fehlt, Band lose'), PRODUCTS);
    expect(f.product?.id).toBe('sk32');
    expect(f.finding).toBe('Türstopper fehlt, Band lose');
  });
});

describe('Tür anlegen oder finden', () => {
  it('Stammdaten aus dem Katalog-Typ, feste Nummer, Standort', () => {
    const b = announcedAssetBody({ number: 354, location: 'Raum 354' }, PRODUCTS[0]!, ['holdOpen', 'leaves', 'dropSeal', 'approval']);
    expect(b).toEqual({
      category: 'fire_door',
      number: 354,
      location: 'Raum 354',
      manufacturer: 'Westag + Getalit',
      model: 'SK32',
      attributes: { holdOpen: false, leaves: '1-flügelig', dropSeal: true },
    });
    expect(announcedAssetBody({ number: 1, location: '' }, PRODUCTS[1]!, ['approval']).attributes).toEqual({ approval: 'Z-6.16-1211' });
    expect(announcedAssetBody({ number: 9, location: 'Raum 9' }, null, [])).toMatchObject({ model: 'unbekannt', manufacturer: '', attributes: {} });
  });
  it('Nummer im Objekt: gleiche Art gefunden, andere Art ist ein Widerspruch', () => {
    const assets = [
      { id: 'a', code: 'FL-004', number: 4, category: 'extinguisher' },
      { id: 'b', code: 'FST-7K2M', number: null, category: 'fire_door' },
      { id: 'c', code: 'T-354', number: 354, category: 'fire_door' },
      { id: 'd', code: 'FST-012', number: null, category: 'fire_door' },
    ];
    const label = (k: string) => (k === 'extinguisher' ? 'Feuerlöscher' : 'Tür');
    expect(findAnnounced(354, assets, 'fire_door', label)).toEqual({ asset: assets[2] });
    expect(findAnnounced(12, assets, 'fire_door', label)).toEqual({ asset: assets[3] });
    expect(findAnnounced(4, assets, 'fire_door', label)).toEqual({ conflict: 'Nummer 4 ist ein Feuerlöscher (FL-004)' });
    expect(findAnnounced(5, assets, 'fire_door', label)).toBeNull();
  });
});

describe('Rohdiktat', () => {
  it('kritische Wörter, offen/ausgewertet, Obergrenze', () => {
    const n = rawNote('Tür klemmt, sofort sperren', 'app', 'finding');
    expect(n).toMatchObject({ source: 'app', kind: 'finding', evaluated: false, critical: true });
    expect(rawNote('Dichtung fehlt', 'offline', 'finding').critical).toBeUndefined();
    const many: RawNote[] = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, text: `t${i}`, at: i, source: 'app', evaluated: i < 5 }));
    const merged = mergeRawNotes([], many);
    expect(merged).toHaveLength(50);
    expect(pendingRawNotes(merged)).toHaveLength(50);
    expect(mergeRawNotes(merged.slice(0, 2), [merged[0]!])).toHaveLength(2);
  });
});
