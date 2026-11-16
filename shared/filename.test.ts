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
    expect(buildFileName('', { datum: '2026-01-01', code: 'X', art: 'Y' })).toBe('X_2026-01-01_Y.pdf');
    expect(buildFileName('{code}', {})).toBe('dokument.pdf');
  });
  it('Standard und frühere Vorgabe: Ident_Datum_Art (Plan v7 X)', () => {
    const vars = { datum: '2025-06-25', code: 'T-036', art: 'Tür' };
    expect(buildFileName(null, vars)).toBe('T-036_2025-06-25_Tür.pdf');
    expect(buildFileName('{datum}_{code}_{art}', vars)).toBe('T-036_2025-06-25_Tür.pdf');
    // Tür und Feststellanlage derselben Öffnung am selben Tag: verschiedene Namen
    expect(buildFileName(null, { datum: '2025-06-25', code: 'FSA-009', art: 'Feststellanlage' })).toBe('FSA-009_2025-06-25_Feststellanlage.pdf');
    // selbst gewähltes Muster bleibt
    expect(buildFileName('{objekt}_{code}', { objekt: 'Haus A', code: 'T-1' })).toBe('Haus-A_T-1.pdf');
  });
  it('numbers duplicates', () => {
    const used = new Set<string>();
    expect(uniqueName('a.pdf', used)).toBe('a.pdf');
    expect(uniqueName('a.pdf', used)).toBe('a-2.pdf');
  });
});
