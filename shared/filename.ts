export const PDF_PLACEHOLDERS: Record<string, string> = {
  datum: 'Prüfdatum (JJJJ-MM-TT)',
  code: 'Element-Code',
  art: 'Elementart',
  pruefart: 'Prüfart',
  objekt: 'Objekt',
  gebaeude: 'Gebäude',
  standort: 'Standort',
  ergebnis: 'Ergebnis',
};

export const DEFAULT_PDF_PATTERN = '{datum}_{code}_{art}';

/** Dateiname aus Muster, z. B. „{datum}_{code}_{objekt}“ → „2026-10-10_FST-7K2M_Grundschule.pdf“. */
export function buildFileName(pattern: string | null | undefined, vars: Partial<Record<keyof typeof PDF_PLACEHOLDERS, string>>, ext = 'pdf'): string {
  const raw = (pattern || DEFAULT_PDF_PATTERN).replace(/\{(\w+)\}/g, (_, k: string) => vars[k as keyof typeof vars] ?? '');
  const clean = raw
    .normalize('NFC')
    .replace(/[/\\?%*:|"<>\n\r\t]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/[-_]{2,}/g, (m) => m[0])
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 120);
  return `${clean || 'dokument'}.${ext}`;
}

/** Doppelte Namen (z. B. im ZIP) durchnummerieren. */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  for (let i = 2; ; i++) {
    const n = `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
}
