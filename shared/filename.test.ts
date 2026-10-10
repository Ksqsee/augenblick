import { describe, expect, it } from 'vitest';
import { buildFileName, uniqueName } from './filename';

describe('buildFileName', () => {
  it('fills placeholders and sanitizes', () => {
    expect(buildFileName('{datum}_{code}_{objekt}', { datum: '2026-10-10', code: 'FST-7K2M', objekt: 'Grundschule Am Park/Nord' })).toBe(
      '2026-10-10_FST-7K2M_Grundschule-Am-Park-Nord.pdf',
    );
  });
  it('keeps umlauts and drops unknown placeholders', () => {
    expect(buildFileName('{art} {gibtsnicht} Prüfung', { art: 'Feuerschutztür' })).toBe('Feuerschutztür-Prüfung.pdf');
  });
  it('falls back to default pattern and name', () => {
    expect(buildFileName('', { datum: '2026-01-01', code: 'X', art: 'Y' })).toBe('2026-01-01_X_Y.pdf');
    expect(buildFileName('{code}', {})).toBe('dokument.pdf');
  });
  it('numbers duplicates', () => {
    const used = new Set<string>();
    expect(uniqueName('a.pdf', used)).toBe('a.pdf');
    expect(uniqueName('a.pdf', used)).toBe('a-2.pdf');
  });
});
