// Absichtserkennung im Erfassen-Sheet (Plan v5, Paket Q): Elemente, Mängel, Aufgaben und Notizen aus einem Satz.
// Läuft mit und ohne die Art „Feststellanlage“ (hold_open, Paket P): Arten kommen immer aus den Katalog-Definitionen.
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './catalog';
import { type CaptureCategory, findCategory, parseCapture } from './smart';

const cats: CaptureCategory[] = Object.values(CATEGORIES);
/** Mittwoch, 11.11.2026 – „bis Freitag“ sind dann zwei Tage */
const now = new Date(2026, 10, 11, 9).getTime();
const parse = (t: string, prefer?: 'assets' | 'findings') => parseCapture(t, { categories: cats, now, prefer });
const kinds = (t: string, prefer?: 'assets' | 'findings') => parse(t, prefer).map((i) => i.kind);

describe('Elemente aus einem Satz', () => {
  it('Ort vorweg, Hersteller und Feuerwiderstand, zweite Art erbt den Ort', () => {
    const items = parse('Im Erdgeschoss Flur drei Feuerschutztüren von Hörmann T30 und zwei Feuerlöscher');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'asset', count: 3, category: 'fire_door', floor: 'EG', location: 'Flur', manufacturer: 'Hörmann', attributes: { rating: 'T30' } });
    expect(items[1]).toMatchObject({ kind: 'asset', count: 2, category: 'extinguisher', floor: 'EG', location: 'Flur', manufacturer: '' });
  });
  it('„drei Feuerschutztüren im EG Flur“', () => {
    expect(parse('drei Feuerschutztüren im EG Flur')).toEqual([expect.objectContaining({ kind: 'asset', count: 3, category: 'fire_door', floor: 'EG', location: 'Flur' })]);
  });
  it('Art + Ort ohne Anzahl: „Tür Raum 306 von Westag“', () => {
    expect(parse('Tür Raum 306 von Westag')[0]).toMatchObject({ kind: 'asset', count: 1, category: 'fire_door', location: 'Raum 306', manufacturer: 'Westag', floor: '' });
  });
  it('Werkstattsprache: zwo, T30-Türen, Keller', () => {
    expect(parse('zwo T30-Türen im Keller')[0]).toMatchObject({ kind: 'asset', count: 2, category: 'fire_door', floor: 'UG', location: '', attributes: { rating: 'T30' } });
  });
  it('Werkstattsprache: 3x RWM OG Büro', () => {
    expect(parse('3x RWM OG Büro')[0]).toMatchObject({ kind: 'asset', count: 3, category: 'smoke_alarm', floor: 'OG', location: 'Büro' });
  });
  it('Werkstattsprache: 2 FST EG Treppenhaus Nord', () => {
    expect(parse('2 FST EG Treppenhaus Nord')[0]).toMatchObject({ kind: 'asset', count: 2, category: 'fire_door', floor: 'EG', location: 'Treppenhaus Nord' });
  });
  it('Kurzwort „Löscher“ und Tiefgarage', () => {
    expect(parse('fünf Löscher in der Tiefgarage')[0]).toMatchObject({ kind: 'asset', count: 5, category: 'extinguisher', floor: 'TG' });
  });
  it('„ein Rauchmelder Küche“', () => {
    expect(parse('ein Rauchmelder Küche')[0]).toMatchObject({ kind: 'asset', count: 1, category: 'smoke_alarm', location: 'Küche' });
  });
  it('Abkürzung ohne Anzahl mit Ort: „BSK im UG Technikraum“', () => {
    expect(parse('BSK im UG Technikraum')[0]).toMatchObject({ kind: 'asset', count: 1, category: 'damper', floor: 'UG', location: 'Technikraum' });
  });
  it('Zahlwort zwölf und Etage in Worten', () => {
    expect(parse('zwölf Rauchwarnmelder im zweiten Obergeschoss')[0]).toMatchObject({ count: 12, category: 'smoke_alarm', floor: '2. OG' });
  });
  it('Rauchschutz und Hersteller nach dem Artwort', () => {
    expect(parse('Feuerschutztür T30 RS von Hörmann im Treppenhaus')[0]).toMatchObject({
      kind: 'asset',
      count: 1,
      manufacturer: 'Hörmann',
      location: 'Treppenhaus',
      attributes: { rating: 'T30', smoke: true },
    });
  });
  it('„sowie“ trennt zwei Aufzählungen', () => {
    const items = parse('drei Türen im EG sowie 4 Feuerlöscher im 1. OG');
    expect(items.map((i) => [i.count, i.category, i.floor])).toEqual([
      [3, 'fire_door', 'EG'],
      [4, 'extinguisher', '1. OG'],
    ]);
  });
  it('Umlaute ausgeschrieben', () => {
    expect(parse('zwei Feuerschutztueren im DG')[0]).toMatchObject({ kind: 'asset', count: 2, category: 'fire_door', floor: 'DG' });
  });
  it('eigene Art mit Synonym aus dem Katalog', () => {
    const own = [...cats, { key: 'c_rwa', label: 'RWA-Anlage', plural: 'RWA-Anlagen', synonyms: ['Rauchabzug'] }];
    expect(parseCapture('ein Rauchabzug im Treppenhaus', { categories: own })[0]).toMatchObject({ kind: 'asset', category: 'c_rwa', location: 'Treppenhaus' });
    expect(findCategory('zwei RWA-Anlagen im Lager', own)).toMatchObject({ key: 'c_rwa' });
  });
  it('Feststellanlage, sobald der Katalog die Art kennt (sonst kein Element)', () => {
    const items = parse('Im Erdgeschoss Flur drei Feuerschutztüren und eine Feststellanlage');
    if ('hold_open' in CATEGORIES) {
      expect(items.map((i) => i.kind)).toEqual(['asset', 'asset']);
      expect(items[1]).toMatchObject({ count: 1, category: 'hold_open', floor: 'EG', location: 'Flur' });
    } else {
      expect(items[0]).toMatchObject({ kind: 'asset', count: 3, category: 'fire_door' });
      expect(items[1]?.kind).not.toBe('asset');
    }
    const fsa = [...cats, { key: 'hold_open', label: 'Feststellanlage', plural: 'Feststellanlagen' }];
    expect(parseCapture('eine FSA Treppenhaus', { categories: fsa })[0]).toMatchObject({ kind: 'asset', category: 'hold_open', location: 'Treppenhaus' });
  });
});

describe('Mängel bleiben Mängel', () => {
  it('„Tür schließt nicht“ ist ein Mangel, kein Element', () => {
    expect(parse('Tür schließt nicht')).toEqual([expect.objectContaining({ kind: 'defect', title: 'Tür schließt nicht' })]);
  });
  it('„zwei Feuerlöscher fehlen im Flur“', () => {
    expect(kinds('zwei Feuerlöscher fehlen im Flur')).toEqual(['defect']);
  });
  it('„Tür im OG klemmt stark“ mit Schwere', () => {
    expect(parse('Tür im OG klemmt stark')[0]).toMatchObject({ kind: 'defect', severity: 'high' });
  });
  it('Artwort mit Ort ist nur der Ort des Mangels', () => {
    expect(parse('Tür im 2. OG, Dichtung fehlt')).toEqual([expect.objectContaining({ kind: 'defect', title: 'Tür im 2. OG, Dichtung fehlt', measure: 'Dichtung ersetzen' })]);
  });
  it('Code im Satz meint ein vorhandenes Element', () => {
    expect(parse('Feuerlöscher FL-7K2M Plombe fehlt')[0]).toMatchObject({ kind: 'defect', assetCode: 'FL-7K2M' });
  });
  it('„Raum 306“ ist kein Element-Code', () => {
    expect(parse('Tür Raum 306 klemmt')[0]).toMatchObject({ kind: 'defect', assetCode: null });
  });
  it('Fluchtweg zugestellt, sofort', () => {
    expect(parse('Fluchtweg im EG mit Kartons zugestellt, sofort räumen')[0]).toMatchObject({ kind: 'defect', severity: 'critical', measure: 'Zugang freiräumen' });
  });
  it('Aussage statt Anlage: „Tür im Keller ist in Ordnung“', () => {
    expect(kinds('Tür im Keller ist in Ordnung')).not.toContain('asset');
  });
  it('keine Art erkannt: „fünf Kartons im Flur“', () => {
    expect(kinds('fünf Kartons im Flur')).toEqual(['defect']);
  });
});

describe('Aufgaben, Notizen und gemischte Sätze', () => {
  it('„Hausmeister informieren bis Freitag“ → Aufgabe mit Frist', () => {
    expect(parse('Hausmeister informieren bis Freitag')[0]).toMatchObject({ kind: 'task', dueInDays: 2 });
  });
  it('„drei Feuerlöscher bestellen“ ist ein Auftrag', () => {
    expect(kinds('drei Feuerlöscher bestellen')).toEqual(['task']);
  });
  it('Notiz', () => {
    expect(parse('Notiz: Schlüssel beim Hausmeister')[0]).toMatchObject({ kind: 'note', title: 'Schlüssel beim Hausmeister' });
  });
  it('gemischt: Elemente, Mangel, Aufgabe', () => {
    const items = parse('Drei Feuerschutztüren im EG Flur, die mittlere schließt nicht. Hausmeister bis Freitag informieren.');
    expect(items.map((i) => i.kind)).toEqual(['asset', 'defect', 'task']);
    expect(items[0]).toMatchObject({ count: 3, floor: 'EG', location: 'Flur' });
    expect(items[1]).toMatchObject({ title: 'Die mittlere schließt nicht', measure: 'Türschließer einstellen bzw. tauschen' });
    expect(items[2]).toMatchObject({ dueInDays: 2 });
  });
  it('gemischt in einem Satz mit „und“: Mangel und neue Elemente', () => {
    expect(kinds('Tür zum Keller klemmt und zwei Rauchmelder im Flur')).toEqual(['defect', 'asset']);
  });
  it('Mangel, dann Auftrag mit Komma', () => {
    expect(kinds('Tür schließt nicht, Hausmeister informieren')).toEqual(['defect', 'task']);
  });
});

describe('Vorgabe des Sheets', () => {
  it('Modus „Elemente“ nimmt auch ein bloßes Artwort', () => {
    expect(kinds('Feuerschutztür')).toEqual(['defect']);
    expect(parse('Feuerschutztür', 'assets')[0]).toMatchObject({ kind: 'asset', count: 1, category: 'fire_door' });
  });
  it('Modus „Mängel“ verlangt Anzahl oder Hersteller', () => {
    expect(kinds('Tür Raum 306', 'findings')).toEqual(['defect']);
    expect(kinds('Tür Raum 306 von Westag', 'findings')).toEqual(['asset']);
    expect(kinds('zwei Türen Raum 306', 'findings')).toEqual(['asset']);
  });
  it('ohne Arten (Prüfablauf) entstehen keine Elemente', () => {
    expect(parseCapture('drei Feuerlöscher im Flur', { categories: [] }).map((i) => i.kind)).toEqual(['defect']);
  });
});
