import { describe, expect, it } from 'vitest';
import { CATEGORIES, INSPECTION_KINDS, INSPECTION_PURPOSES, SEVERITIES, WALK_PURPOSES } from './catalog';
import { readFileSync } from 'node:fs';
import { CREDENTIAL_KINDS } from './credentials';
import { tr, zonedDay } from './i18n';
import { WALK_QUESTIONS, WALK_SECTIONS } from './walkthrough';

describe('Dokumentsprache', () => {
  it('alle eingebauten Standardtexte haben eine englische Fassung', () => {
    const texts: string[] = [...Object.values(INSPECTION_KINDS), ...Object.values(INSPECTION_PURPOSES), ...Object.values(WALK_PURPOSES), ...Object.values(SEVERITIES), ...Object.values(WALK_SECTIONS), ...WALK_QUESTIONS.map((q) => q.text)];
    for (const c of Object.values(CATEGORIES)) {
      texts.push(c.label, ...c.checkpoints.map((p) => p.label), ...c.maintenance.map((m) => m.label), ...c.attributes.map((a) => a.label));
      for (const s of c.schedules) texts.push(s.label, ...(s.checkpoints ?? []).map((p) => p.label));
    }
    // Feststellanlage (v5) vollständig: Mehrzahl, Hinweise und Auswahlwerte
    const fsa = CATEGORIES.hold_open;
    texts.push(fsa.plural, ...fsa.checkpoints.flatMap((p) => (p.hint ? [p.hint] : [])), ...fsa.attributes.flatMap((a) => a.options ?? []));
    for (const a of CATEGORIES.fire_door.attributes) texts.push(a.label);
    // Plan v7: Tür, Fenster, Drehtürantrieb vollständig – Mehrzahl, Gruppen, Hinweise und Auswahlwerte
    // (Anforderungen wie „T30-RS“ und „1-/2-flügelig“ bleiben als Kürzel bzw. sind schon übersetzt)
    for (const k of ['fire_door', 'window', 'door_drive'] as const) {
      const c = CATEGORIES[k];
      texts.push(c.plural, ...c.checkpoints.flatMap((p) => [p.group ?? '', p.hint ?? ''].filter(Boolean)));
      texts.push(...c.attributes.flatMap((a) => (a.options ?? []).filter((o) => !/^(T\d|RS$)/.test(o))));
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
    const src = ['src/pdf/reports.ts', 'src/pdf/nacharbeit.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const used = [...src.matchAll(/T\('([^']+)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(50);
    expect(used.filter((t) => tr('en', t) === t && !['Code', 'Status', 'in', 'Name', 'Pos.'].includes(t))).toEqual([]);
  });
  it('Nachweis-Arten und Ergebnisse (Sammelmappe, Protokoll) sind übersetzt', () => {
    const texts = [...Object.values(CREDENTIAL_KINDS), 'Nr.', 'Ohne Mängel', 'Mit Mängeln', 'Kritisch', 'Nicht prüfbar', 'Stk', 'Std', 'lfm', 'pauschal'];
    expect(texts.filter((t) => tr('en', t) === t)).toEqual([]);
  });
  it('Filterbeschreibung des Berichtsgenerators ist übersetzt', () => {
    const src = readFileSync('src/components/InspectionFilters.tsx', 'utf8');
    const periods = [...src.slice(src.indexOf('const PERIODS'), src.indexOf('];', src.indexOf('const PERIODS'))).matchAll(/\['\w*', '([^']+)'\]/g)].map((m) => m[1]);
    const labels = [...src.matchAll(/out\.push\(\['([^']+)'/g)].map((m) => m[1]);
    expect(periods.length).toBeGreaterThan(4);
    expect(labels.length).toBeGreaterThan(5);
    expect([...periods, ...labels].filter((t) => tr('en', t) === t)).toEqual([]);
  });
  it('Ortsdatum in der Zeitzone', () => {
    // 23:30 UTC am Sonntag = Montag 01:30 in Berlin
    expect(zonedDay(Date.parse('2026-10-11T23:30:00Z'), 'Europe/Berlin')).toEqual({ ymd: '2026-10-12', weekday: 1 });
    expect(zonedDay(Date.parse('2026-10-11T23:30:00Z'), 'America/New_York')).toEqual({ ymd: '2026-10-11', weekday: 0 });
  });
});
