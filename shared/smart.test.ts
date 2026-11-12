import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './catalog';
import { matchCheckpoint, parseCapture, suggestMeasure, suggestSeverity } from './smart';

describe('Diktat auswerten (ohne KI)', () => {
  it('zerlegt mehrere Feststellungen und erkennt Schwere und Maßnahme', () => {
    const items = parseCapture('Äh, Tür schließt nicht richtig. Außerdem fehlt die Dichtung oben, gering. Feuerlöscher FL-7K2M Plombe fehlt, dringend.');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'defect', title: 'Tür schließt nicht richtig', measure: 'Türschließer einstellen bzw. tauschen', severity: 'medium' });
    expect(items[1]).toMatchObject({ severity: 'low', measure: 'Dichtung ersetzen' });
    expect(items[2]).toMatchObject({ severity: 'high', assetCode: 'FL-7K2M', measure: 'Neu plombieren und Gerät prüfen lassen' });
  });
  it('erkennt Aufgaben mit Frist und Notizen', () => {
    const [task, note] = parseCapture('Fachfirma für Brandschutzklappe beauftragen bis nächste Woche. Notiz: Hausmeister hat Schlüssel');
    expect(task).toMatchObject({ kind: 'task', dueInDays: 7, measure: '' });
    expect(note).toMatchObject({ kind: 'note', title: 'Hausmeister hat Schlüssel' });
  });
  it('ordnet Prüfpunkte über gemeinsame Wörter zu', () => {
    const cps = CATEGORIES.fire_door.checkpoints;
    expect(matchCheckpoint('Die Dichtungen sind übermalt', cps)).toBe(cps.find((c) => c.label.startsWith('Dichtungen'))!.id);
    expect(matchCheckpoint('nichts Passendes', cps)).toBeNull();
    const [d] = parseCapture('Verglasung hat einen Riss', { checkpoints: cps });
    expect(d.checkpointId).toBe(cps.find((c) => c.label.startsWith('Verglasung'))!.id);
  });
  it('Schwere und Maßnahme einzeln', () => {
    expect(suggestSeverity('Fluchtweg versperrt, Gefahr im Verzug')).toBe('critical');
    expect(suggestSeverity('Schild leicht verblasst')).toBe('low');
    expect(suggestMeasure('Fluchtweg mit Kartons zugestellt')).toBe('Zugang freiräumen');
    expect(suggestMeasure('alles gut')).toBe('');
  });
});

describe('Element-Code im Text', () => {
  it('erkennt Codes, auch gesprochen, aber keine normalen Wörter', () => {
    expect(parseCapture('Brandschutztür BSK-8Z9L schließt nicht')[0].assetCode).toBe('BSK-8Z9L');
    expect(parseCapture('Feuerlöscher fl 7k2m fehlt')[0].assetCode).toBe('FL-7K2M');
    expect(parseCapture('Tür im OG klemmt stark')[0].assetCode).toBeNull();
  });
});
