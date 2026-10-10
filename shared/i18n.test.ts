import { describe, expect, it } from 'vitest';
import { CATEGORIES, INSPECTION_KINDS, SEVERITIES } from './catalog';
import { readFileSync } from 'node:fs';
import { tr, zonedDay } from './i18n';
import { WALK_QUESTIONS, WALK_SECTIONS } from './walkthrough';

describe('Dokumentsprache', () => {
  it('alle eingebauten Standardtexte haben eine englische Fassung', () => {
    const texts: string[] = [...Object.values(INSPECTION_KINDS), ...Object.values(SEVERITIES), ...Object.values(WALK_SECTIONS), ...WALK_QUESTIONS.map((q) => q.text)];
    for (const c of Object.values(CATEGORIES)) {
      texts.push(c.label, ...c.checkpoints.map((p) => p.label), ...c.maintenance.map((m) => m.label), ...c.attributes.map((a) => a.label));
      for (const s of c.schedules) texts.push(s.label, ...(s.checkpoints ?? []).map((p) => p.label));
    }
    const missing = texts.filter((t) => tr('en', t) === t);
    expect(missing).toEqual([]);
  });
  it('Deutsch und eigene Texte bleiben unverändert', () => {
    expect(tr('de', 'Feuerlöscher')).toBe('Feuerlöscher');
    expect(tr('en', 'Mein eigener Prüfpunkt')).toBe('Mein eigener Prüfpunkt');
    expect(tr('en', 'Prüfprotokoll')).toBe('Inspection report');
    expect(tr('de', 'Prüfprotokoll')).toBe('Prüfprotokoll');
  });
  it('alle festen PDF-Texte haben eine englische Fassung', () => {
    const src = readFileSync('src/pdf/reports.ts', 'utf8');
    const used = [...src.matchAll(/T\('([^']+)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(50);
    expect(used.filter((t) => tr('en', t) === t && !['Code', 'Status', 'in'].includes(t))).toEqual([]);
  });
  it('Ortsdatum in der Zeitzone', () => {
    // 23:30 UTC am Sonntag = Montag 01:30 in Berlin
    expect(zonedDay(Date.parse('2026-10-11T23:30:00Z'), 'Europe/Berlin')).toEqual({ ymd: '2026-10-12', weekday: 1 });
    expect(zonedDay(Date.parse('2026-10-11T23:30:00Z'), 'America/New_York')).toEqual({ ymd: '2026-10-11', weekday: 0 });
  });
});
