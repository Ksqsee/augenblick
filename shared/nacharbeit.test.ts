import { describe, expect, it } from 'vitest';
import { type Credential, endOfDayUtc, pickCredential } from './credentials';
import { defectKey, groupMappe, type MappeItem, mappeCounts, mappePages } from './mappe';
import { normalizeOffer, type Offer, offerRows, offerText, seriesSuggestions } from './offer';

const item = (id: string, p: Partial<MappeItem> = {}): MappeItem => ({
  id,
  code: id.toUpperCase(),
  floor: 'EG',
  location: '',
  category: 'fire_door',
  result: 'ok',
  notInspectable: false,
  inspectedAt: 1,
  inspectorId: 'u1',
  defects: [],
  ...p,
});

describe('Sammelmappe: Gruppierung', () => {
  it('erst ohne Mangel, dann gleiche Mängel zusammen (Reihenfolge/Schreibweise egal), nicht prüfbar am Ende', () => {
    const s = groupMappe([
      item('t3', { defects: ['Hinweis: Türstopper fehlt'], result: 'defects' }),
      item('t1'),
      item('t5', { notInspectable: true, result: 'not_inspectable' }),
      item('t4', { defects: ['Band defekt/lose', 'Türstopper fehlt'], result: 'defects' }),
      item('t2', { defects: ['türstopper  fehlt.'], result: 'defects' }),
      item('t6', { defects: ['Türstopper fehlt', 'Band defekt / lose'], result: 'critical' }),
      item('t7', { defects: ['Dichtung fehlt'], result: 'defects' }),
    ]);
    expect(s.map((x) => [x.kind, x.items.map((i) => i.id)])).toEqual([
      ['clean', ['t1']],
      ['defects', ['t4', 't6'].sort()],
      ['defects', ['t2', 't3']],
      ['defects', ['t7']],
      ['not_inspectable', ['t5']],
    ]);
    // Gruppen gleicher Größe nach Titel; Titel ohne „Hinweis:“
    expect(s[1].defects).toEqual(['Band defekt/lose', 'Türstopper fehlt']);
    expect(s[2].defects).toEqual(['Türstopper fehlt']);
    expect(mappeCounts(s)).toEqual({ total: 7, clean: 1, withDefects: 5, notInspectable: 1 });
  });
  it('innerhalb eines Abschnitts in Laufreihenfolge (Etage, dann Anlage)', () => {
    const s = groupMappe([item('a', { floor: '1. OG', sortIndex: 1 }), item('b', { floor: 'EG', sortIndex: 5 }), item('c', { floor: 'EG', sortIndex: 2 })]);
    expect(s[0].items.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
  it('Mangel-Schlüssel', () => {
    expect(defectKey('Hinweis :Türstopper defekt muss erneuert werden')).toBe('türstopper defekt muss erneuert werden');
    expect(defectKey(' Bodenluft zu groß /Schwelle benötigt ')).toBe('bodenluft zu groß/schwelle benötigt');
  });
  it('Seitenzahlen: Deckblatt, Inhaltsliste, Zwischenblatt je Gruppe', () => {
    const s = groupMappe([item('t1'), item('t2', { defects: ['X'], result: 'defects' }), item('t3', { defects: ['X'], result: 'defects' })]);
    const pages = mappePages(s, (id) => (id === 't2' ? 2 : 1), 1);
    // 1 Deckblatt, 2 Inhaltsliste, 3 t1, 4 Zwischenblatt X, 5–6 t2, 7 t3
    expect(pages.item.get('t1')).toBe(3);
    expect(pages.section.get(s[1].key)).toBe(4);
    expect(pages.item.get('t2')).toBe(5);
    expect(pages.item.get('t3')).toBe(7);
    expect(pages.total).toBe(7);
  });
});

const cred = (id: string, p: Partial<Credential> = {}): Credential => ({
  id,
  userId: 'u1',
  kind: 'expertise',
  title: '',
  issuer: '',
  number: '',
  validUntil: null,
  categories: [],
  ...p,
});

describe('Nachweis-Auswahl', () => {
  const at = Date.UTC(2026, 10, 16);
  it('Tür: Sachkunde; Feststellanlage: Hersteller-Zertifikat, passender Hersteller zuerst', () => {
    const list = [
      cred('dgwz', { kind: 'expertise', issuer: 'DGWZ', categories: ['fire_door', 'hold_open'] }),
      cred('dorma', { kind: 'manufacturer', issuer: 'Dorma', categories: ['hold_open'] }),
      cred('eco', { kind: 'manufacturer', issuer: 'ECO Schulte', categories: ['hold_open'] }),
    ];
    expect(pickCredential(list, { category: 'fire_door', at }).credential?.id).toBe('dgwz');
    expect(pickCredential(list, { category: 'hold_open', manufacturer: 'ECO', at }).credential?.id).toBe('eco');
    expect(pickCredential(list, { category: 'hold_open', manufacturer: 'dormakaba', at }).credential?.id).toBe('dorma');
  });
  it('gültig vor abgelaufen; nur abgelaufene → expired; keiner → missing', () => {
    const old = cred('old', { categories: ['fire_door'], validUntil: endOfDayUtc('2025-12-31') });
    const neu = cred('new', { categories: ['fire_door'], validUntil: endOfDayUtc('2027-12-31') });
    expect(pickCredential([old, neu], { category: 'fire_door', at })).toEqual({ status: 'ok', credential: neu });
    expect(pickCredential([old], { category: 'fire_door', at })).toEqual({ status: 'expired', credential: old });
    expect(pickCredential([old], { category: 'fire_door', at: Date.UTC(2025, 11, 31, 12) }).status).toBe('ok');
    expect(pickCredential([neu], { category: 'extinguisher', at })).toEqual({ status: 'missing', credential: null });
  });
  it('„gilt für alle“ greift, ausdrücklich zugeordnete gehen vor', () => {
    const all = cred('all', { kind: 'other' });
    const own = cred('own', { kind: 'other', categories: ['damper'] });
    expect(pickCredential([all], { category: 'smoke_alarm', at }).credential?.id).toBe('all');
    expect(pickCredential([all, own], { category: 'damper', at }).credential?.id).toBe('own');
  });
});

const offer: Offer = {
  lines: [
    { serviceKey: '7.006', title: 'Absenkdichtung', unit: 'Stk', unitPrice: 335, quantity: 2, total: 670, doors: ['T-1', 'T-2'], defects: ['d1', 'd2'] },
    { serviceKey: 'D1', title: 'Türdichtung in der Zarge', unit: 'lfm', unitPrice: 17.35, quantity: 5.5, total: 95.43, doors: ['T-1', 'T-3', 'T-4', 'T-5', 'T-6'], defects: [] },
  ],
  unmapped: [{ defectId: 'd9', title: 'Zarge irreparabel beschädigt', door: 'T-7' }],
  net: 765.43,
};

describe('Angebotsliste', () => {
  it('Positionen mit Regie, Summe netto', () => {
    const r = offerRows(offer, [{ id: 'x', serviceKey: '1.007', title: 'An- und Abfahrt Zone 1', unit: 'Termin', unitPrice: 85, quantity: 1 }]);
    expect(r.rows.map((x) => x.pos)).toEqual(['1', '2', '3']);
    expect(r.rows[2]).toMatchObject({ extra: true, total: 85 });
    expect(r.net).toBe(850.43);
  });
  it('Serien-Vorschlag je Etage und fürs ganze Objekt', () => {
    const assets = [
      ...['T-1', 'T-3', 'T-4', 'T-5'].map((code) => ({ code, floor: 'EG', category: 'fire_door' })),
      { code: 'T-6', floor: '1. OG', category: 'fire_door' },
      ...['T-8', 'T-9', 'T-10', 'T-11', 'T-12', 'T-13'].map((code) => ({ code, floor: '2. OG', category: 'fire_door' })),
    ];
    // 5 von 11 Türen: nicht das ganze Objekt, aber 4 von 4 im EG
    const s = seriesSuggestions(offer, assets);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ scope: 'floors', floors: ['EG'], affected: 4, of: 4 });
    expect(s[0].text).toContain('der Etage EG');
    // 5 von 8 Türen: ganzes Objekt
    const s2 = seriesSuggestions(offer, assets.slice(0, 8));
    expect(s2[0]).toMatchObject({ scope: 'property', affected: 5 });
  });
  it('Kurztext für MCP nennt Positionen, Türen und nicht Zugeordnetes', () => {
    const t = offerText(offer, 'Hotel');
    expect(t).toContain('2 Positionen');
    expect(t).toContain('T-1, T-2');
    expect(t).toMatch(/Nicht zugeordnet \(1\)/);
    expect(t).toContain('T-7: Zarge irreparabel beschädigt');
  });
  it('unvollständige Antwort wird robust gelesen', () => {
    expect(normalizeOffer({ lines: [{ title: 'X', quantity: '2', unitPrice: 3, total: 6 }] })).toEqual({
      lines: [{ serviceKey: '', title: 'X', unit: '', unitPrice: 3, quantity: 2, total: 6, doors: [], defects: [] }],
      unmapped: [],
      net: 6,
    });
  });
});
