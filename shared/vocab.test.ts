import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG_SEED_DEFECTS, CATALOG_SEED_TERMS, CATEGORIES, type CatalogDefect, type CatalogProduct } from './catalog';
import { parseCapture, suggestMeasure, suggestSeverity } from './smart';
import {
  applyProductDefaults,
  codeNumber,
  entryKey,
  expandTerms,
  findElementRef,
  freeNumberCode,
  matchCatalogDefect,
  matchCatalogDefects,
  matchElementRef,
  numberCode,
  parseElementRef,
  planCatalogMerge,
  setClientVocab,
  suggestProducts,
} from './vocab';

const defects: CatalogDefect[] = CATALOG_SEED_DEFECTS.map((d, i) => ({ ...d, id: `d${i}` }));
const terms = CATALOG_SEED_TERMS.map((t, i) => ({ ...t, id: `t${i}` }));

describe('laufende Nummern', () => {
  it('Code aus Präfix und Nummer, dreistellig', () => {
    expect(numberCode('FST', 1)).toBe('FST-001');
    expect(numberCode('FSA', 36)).toBe('FSA-036');
    expect(numberCode('FST', 1234)).toBe('FST-1234');
  });
  it('freier Code: in anderem Objekt vergebene Nummer bekommt einen Zusatz', () => {
    const taken = new Set(['FST-001', 'FST-001-2']);
    expect(freeNumberCode('FST', 2, (c) => taken.has(c))).toBe('FST-002');
    expect(freeNumberCode('FST', 1, (c) => taken.has(c))).toBe('FST-001-3');
  });
  it('Nummer aus dem Code lesen, Zufallscodes ohne Nummer', () => {
    expect(codeNumber('FSA-012')).toBe(12);
    expect(codeNumber('FST-001-2')).toBe(1);
    expect(codeNumber('FST-7K2M')).toBeNull();
    expect(codeNumber('FL-3MX9')).toBeNull();
  });
});

describe('Element-Verweise („Tür 36“)', () => {
  it('Artwort oder Nummernwort mit Zahl', () => {
    expect(findElementRef('Tür 36 schließt nicht')).toMatchObject({ number: 36, category: 'fire_door', match: 'Tür 36' });
    expect(findElementRef('an der Tür Nr. 17 fehlt die Dichtung')).toMatchObject({ number: 17, category: 'fire_door' });
    expect(findElementRef('Nummer 36')).toMatchObject({ number: 36, category: null });
    expect(findElementRef('Nr. 5 prüfen')).toMatchObject({ number: 5, category: null });
    expect(findElementRef('FSA 2 löst nicht aus')).toMatchObject({ number: 2, category: 'hold_open' });
    expect(findElementRef('Feststellanlage 4')).toMatchObject({ number: 4, category: 'hold_open' });
    expect(findElementRef('FST-036')).toMatchObject({ number: 36, category: 'fire_door' });
  });
  it('keine Verweise: Raum, Etage, freie Zahlen', () => {
    expect(findElementRef('Tür Raum 306')).toBeNull();
    expect(findElementRef('Tür 1. OG klemmt')).toBeNull();
    expect(findElementRef('in 3 Tagen erledigen')).toBeNull();
    expect(findElementRef('36')).toBeNull();
    expect(findElementRef('36', [], { bare: true })).toMatchObject({ number: 36, category: null });
  });
  it('eigene Arten über Bezeichnung und Präfix', () => {
    const cats = [{ key: 'c_tor_ab12', label: 'Rolltor', plural: 'Rolltore', prefix: 'TOR' }];
    expect(findElementRef('Rolltor 3', cats)).toMatchObject({ number: 3, category: 'c_tor_ab12' });
    expect(findElementRef('TOR 3', cats)).toMatchObject({ number: 3, category: 'c_tor_ab12' });
  });
  it('ganze Eingabe als Verweis (Suche)', () => {
    expect(parseElementRef('Tür 36')).toMatchObject({ number: 36 });
    expect(parseElementRef('36')).toMatchObject({ number: 36 });
    expect(parseElementRef('Treppenhaus 36 Nord')).toBeNull();
  });
  it('Zuordnung: Nummer und Art, dann nur Nummer, dann alte Codes', () => {
    const assets = [
      { code: 'FST-036', number: 36, category: 'fire_door' },
      { code: 'FSA-037', number: 37, category: 'hold_open' },
      { code: 'FST-36', number: null, category: 'fire_door' },
      { code: 'FST-7K2M', number: null, category: 'fire_door' },
    ];
    expect(matchElementRef({ number: 36, category: 'fire_door', match: '' }, assets).map((a) => a.code)).toEqual(['FST-036']);
    expect(matchElementRef({ number: 37, category: 'fire_door', match: '' }, assets).map((a) => a.code)).toEqual(['FSA-037']);
    expect(matchElementRef({ number: 36, category: null, match: '' }, assets.slice(2)).map((a) => a.code)).toEqual(['FST-36']);
    expect(matchElementRef({ number: 99, category: null, match: '' }, assets)).toEqual([]);
  });
});

describe('Begriffe', () => {
  it('Abkürzungen werden ausgeschrieben, Codes bleiben', () => {
    expect(expandTerms('OTS schließt nicht', terms)).toBe('Obentürschließer schließt nicht');
    expect(expandTerms('ots defekt', terms)).toBe('Obentürschließer defekt');
    expect(expandTerms('RS-Tür mit OL', terms)).toBe('Rauchschutz-Tür mit Oberlicht');
    expect(expandTerms('Tür FST-7K2M und FSA 2', terms)).toBe('Tür FST-7K2M und FSA 2');
    expect(expandTerms('erst', terms)).toBe('erst');
    expect(expandTerms('st 4', terms)).toBe('st 4');
  });
  it('Regel-Parser versteht Begriffe des Katalogs', () => {
    setClientVocab({ terms, defects: [] });
    const [it] = parseCapture('drei FSA im EG Flur');
    expect(it).toMatchObject({ kind: 'asset', count: 3, category: 'hold_open', floor: 'EG', location: 'Flur' });
    expect(parseCapture('OTS zieht nicht zu')[0]!.title).toBe('Obentürschließer zieht nicht zu');
  });
  afterEach(() => setClientVocab({ terms: [], defects: [] }));
});

describe('Mängel aus dem Katalog', () => {
  it('Titel oder Synonym erkennt den typischen Mangel', () => {
    expect(matchCatalogDefect('Tür fällt nicht ins Schloss', defects)?.title).toBe('Tür schließt nicht vollständig');
    expect(matchCatalogDefect('Melder löst bei Prüfrauch nicht aus', defects)?.title).toBe('Feststellanlage löst bei Rauch nicht aus');
    expect(matchCatalogDefect('Dichtung ist übermalt', defects)?.title).toBe('Dichtung überstrichen');
    expect(matchCatalogDefect('alles in Ordnung', defects)).toBeNull();
  });
  it('Art schränkt ein', () => {
    expect(matchCatalogDefects('Melder verschmutzt', defects, { category: 'fire_door' })).toEqual([]);
    expect(matchCatalogDefects('Melder verschmutzt', defects, { category: 'hold_open' })[0]!.defect.severity).toBe('medium');
  });
  it('Vorschläge für Schwere und Maßnahme nutzen den Katalog, ausdrückliche Wörter gehen vor', () => {
    expect(suggestSeverity('Feststellanlage gibt bei Stromausfall nicht frei, hält bei Stromausfall', defects)).toBe('critical');
    expect(suggestMeasure('Magnet hält nicht', defects)).toBe('Haftmagnet und Gegenplatte reinigen, ausrichten oder tauschen');
    expect(suggestSeverity('Magnet hält nicht, sofort', defects)).toBe('critical');
    // ohne Katalog wie bisher
    expect(suggestMeasure('Fluchtweg mit Kartons zugestellt', [])).toBe('Zugang freiräumen');
  });
  it('Grundausstattung: rund 25 Mängel mit Schwere und Maßnahme, Arten gültig, Begriffe eindeutig', () => {
    expect(CATALOG_SEED_DEFECTS.length).toBeGreaterThanOrEqual(24);
    for (const d of CATALOG_SEED_DEFECTS) {
      expect(d.measure.length).toBeGreaterThan(5);
      expect(Object.keys(CATEGORIES)).toContain(d.category);
    }
    const keys = CATALOG_SEED_DEFECTS.map((d) => entryKey('defects', d));
    expect(new Set(keys).size).toBe(keys.length);
    const tk = CATALOG_SEED_TERMS.map((t) => entryKey('terms', t));
    expect(new Set(tk).size).toBe(tk.length);
  });
});

describe('Produkte', () => {
  const products: CatalogProduct[] = [
    { id: 'p1', manufacturer: 'Hörmann', model: 'H3 OD', category: 'fire_door', defaults: { rating: 'T30', smoke: true, doorType: 'T30-1' }, approval: 'Z-6.20-1', note: '' },
    { id: 'p2', manufacturer: 'Hörmann', model: 'HM 50', category: 'hold_open', defaults: { holdDevice: 'Haftmagnet' }, approval: '', note: '' },
    { id: 'p3', manufacturer: 'Teckentrup', model: 'RS 62', category: 'fire_door', defaults: {}, approval: '', note: '' },
  ];
  it('Vorschläge nach Hersteller/Typ und Art', () => {
    expect(suggestProducts({ manufacturer: 'hoer' }, products, 'fire_door').map((p) => p.id)).toEqual(['p1']);
    expect(suggestProducts({}, products, 'fire_door').map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(suggestProducts({ model: 'rs 6' }, products, null).map((p) => p.id)).toEqual(['p3']);
  });
  it('Vorgaben füllen nur leere, erlaubte Felder', () => {
    const allowed = CATEGORIES.fire_door.attributes.map((a) => a.key);
    expect(applyProductDefaults({ rating: 'T90', smoke: false }, products[0]!, allowed)).toEqual({ rating: 'T90', smoke: true, doorType: 'T30-1', approval: 'Z-6.20-1' });
    expect(applyProductDefaults({ rating: 'T90' }, products[0]!, allowed, true)).toMatchObject({ rating: 'T30' });
    expect(applyProductDefaults({}, { defaults: { fremd: 'x' }, approval: '' }, allowed)).toEqual({});
  });
});

describe('Katalog-Abgleich', () => {
  const existing = [
    { id: 'a', term: 'OTS', meaning: 'Obentürschließer' },
    { id: 'b', term: 'RS', meaning: 'Rauchschutz' },
  ];
  it('neu, geändert, unverändert – Schlüssel unabhängig von Schreibweise', () => {
    const plan = planCatalogMerge('terms', existing, [
      { term: 'ots', meaning: 'Obentürschließer' },
      { term: 'RS', meaning: 'Rauchschutz (Tür)' },
      { term: 'GLS', meaning: 'Gleitschiene' },
      { term: 'GLS', meaning: 'Gleitschiene mit Feststellung' },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.update).toMatchObject([{ id: 'b', changes: ['meaning'] }]);
    expect(plan.create).toEqual([{ term: 'GLS', meaning: 'Gleitschiene mit Feststellung' }]);
  });
  it('Mängel: gleicher Titel in anderer Art ist ein eigener Eintrag', () => {
    const plan = planCatalogMerge('defects', [{ id: 'x', title: 'Melder verschmutzt', category: 'hold_open', severity: 'medium' }], [
      { title: 'Melder verschmutzt', category: 'smoke_alarm', severity: 'low' },
      { title: 'melder verschmutzt', category: 'hold_open', severity: 'high' },
    ]);
    expect(plan.create).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: 'x', changes: ['severity'] });
  });
});
