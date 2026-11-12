import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './catalog';
import { extractFloor, matchCategory, parseAssetBatch, parseCapture, parseCount } from './smart';

const cats = Object.values(CATEGORIES);

describe('Sammelanlage per Diktat (Regeln)', () => {
  it('Zahlwörter eins bis zwanzig und Ziffern', () => {
    const words = ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig'];
    words.forEach((w, i) => expect(parseCount(w)).toBe(i + 1));
    expect(parseCount('Ein')).toBe(1);
    expect(parseCount('12')).toBe(12);
    expect(parseCount('Tür')).toBeNull();
  });

  it('„fünf Feuerlöscher im Erdgeschoss Flur“', () => {
    const [it] = parseCapture('fünf Feuerlöscher im Erdgeschoss Flur');
    expect(it).toMatchObject({ kind: 'asset', count: 5, category: 'extinguisher', floor: 'EG', location: 'Flur' });
  });

  it('Mehrzahl, Ziffern, Etagen und mehrere Sammelanlagen in einem Satz', () => {
    const items = parseCapture('3 Feuerschutztüren im 2. OG Treppenhaus Nord und zwölf Rauchwarnmelder im Keller anlegen');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'asset', count: 3, category: 'fire_door', floor: '2. OG', location: 'Treppenhaus Nord' });
    expect(items[1]).toMatchObject({ kind: 'asset', count: 12, category: 'smoke_alarm', floor: 'UG', location: '' });
  });

  it('Etagen in Worten und eigene Arten', () => {
    expect(extractFloor('im zweiten Obergeschoss Küche')).toEqual({ floor: '2. OG', rest: 'Küche' });
    expect(extractFloor('Dachgeschoss Abstellraum').floor).toBe('DG');
    const own = [{ key: 'c_rwa', label: 'RWA-Anlage', plural: 'RWA-Anlagen' }];
    expect(matchCategory('RWA-Anlagen im Lager', own)).toEqual({ key: 'c_rwa', length: 'RWA-Anlagen'.length });
    expect(parseAssetBatch('zwei RWA-Anlagen im Lager', own)).toMatchObject({ count: 2, category: 'c_rwa', location: 'Lager' });
  });

  it('Mängel und normale Sätze bleiben Mängel', () => {
    expect(parseCapture('zwei Feuerlöscher fehlen im Flur')[0]!.kind).toBe('defect');
    expect(parseCapture('Tür im 2. OG schließt nicht')[0]).toMatchObject({ kind: 'defect', title: 'Tür im 2. OG schließt nicht' });
    expect(parseAssetBatch('fünf Kartons im Flur', cats)).toBeNull();
  });

  it('begrenzt die Anzahl', () => {
    expect(parseAssetBatch('200 Feuerlöscher im Lager', cats)?.count).toBe(50);
  });
});
