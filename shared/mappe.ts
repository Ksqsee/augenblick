// Sammelmappe (Plan v7, Paket X): alle abgeschlossenen Protokolle eines Objekts in einem PDF – erst die ohne Mangel,
// dann nach gleichem Mangel gruppiert, am Ende die nicht prüfbaren. So hat der Betrieb bisher von Hand gearbeitet
// (docs/wissen/seehafer-unterlagen.md, Abschnitt 7): Protokolle ohne Mangel, dann je Mangelgruppe, dann zusammenfügen.
import { compareWalk } from './walk-order';

export interface MappeItem {
  id: string;
  code: string;
  floor?: string | null;
  location: string;
  category: string;
  result: string | null;
  notInspectable: boolean;
  inspectedAt: number;
  inspectorId: string;
  /** Titel der festgestellten Mängel */
  defects: string[];
  sortIndex?: number | null;
  number?: number | null;
  createdAt?: number | null;
}

export type MappeSectionKind = 'clean' | 'defects' | 'not_inspectable';
export interface MappeSection<T extends MappeItem = MappeItem> {
  key: string;
  kind: MappeSectionKind;
  /** Mängel der Gruppe in Originalschreibweise (leer bei „ohne Mangel“ und „nicht prüfbar“) */
  defects: string[];
  items: T[];
}

/** Vergleichsschlüssel eines Mangels: Groß/klein, Leerzeichen, Satzzeichen am Rand und ein vorangestelltes „Hinweis:“ zählen nicht. */
export function defectKey(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/^\s*hinweis\s*:?\s*/, '')
    .replace(/\s*([/:,;])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!–-]+|[\s.,;:!–-]+$/g, '');
}

const hasDefects = (i: MappeItem) => i.defects.length > 0 || i.result === 'defects' || i.result === 'critical';

/**
 * Protokolle in Abschnitte teilen. Eine Gruppe enthält die Prüfungen mit genau denselben Mängeln (unabhängig von
 * Reihenfolge und Schreibweise) – so wie früher ein Protokoll „einmal angepasst und für alle Türen mit diesem Mangel
 * gespeichert“ wurde. Gruppen nach Größe, dann nach Titel; innerhalb eines Abschnitts in Laufreihenfolge.
 */
export function groupMappe<T extends MappeItem>(items: T[]): MappeSection<T>[] {
  const clean: T[] = [];
  const blocked: T[] = [];
  const groups = new Map<string, MappeSection<T>>();
  for (const it of items) {
    if (it.notInspectable || it.result === 'not_inspectable') blocked.push(it);
    else if (!hasDefects(it)) clean.push(it);
    else {
      const seen = new Map<string, string>();
      for (const d of it.defects) {
        const k = defectKey(d);
        if (k && !seen.has(k)) seen.set(k, d.trim().replace(/^\s*hinweis\s*:?\s*/i, ''));
      }
      const keys = [...seen.keys()].sort();
      const key = keys.join('|');
      let g = groups.get(key);
      if (!g) {
        g = { key: `defects:${key}`, kind: 'defects', defects: keys.map((k) => seen.get(k)!), items: [] };
        groups.set(key, g);
      }
      g.items.push(it);
    }
  }
  const sorted = (list: T[]) => [...list].sort(compareWalk);
  const out: MappeSection<T>[] = [];
  if (clean.length) out.push({ key: 'clean', kind: 'clean', defects: [], items: sorted(clean) });
  const gs = [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.defects.join(' + ').localeCompare(b.defects.join(' + '), 'de'));
  for (const g of gs) out.push({ ...g, items: sorted(g.items) });
  if (blocked.length) out.push({ key: 'not_inspectable', kind: 'not_inspectable', defects: [], items: sorted(blocked) });
  return out;
}

export interface MappeCounts {
  total: number;
  clean: number;
  withDefects: number;
  notInspectable: number;
}

export function mappeCounts(sections: MappeSection[]): MappeCounts {
  const n = (k: MappeSectionKind) => sections.filter((s) => s.kind === k).reduce((s, x) => s + x.items.length, 0);
  const clean = n('clean');
  const withDefects = n('defects');
  const notInspectable = n('not_inspectable');
  return { total: clean + withDefects + notInspectable, clean, withDefects, notInspectable };
}

/**
 * Seitenzahlen der Protokolle in der Mappe: Deckblatt (1 Seite), Inhaltsliste (`tocPages`), dann je Abschnitt
 * ein Zwischenblatt (nur Mangelgruppen und „nicht prüfbar“) und die Protokolle mit ihrer Seitenzahl.
 * Gibt je Prüfung die erste Seite und je Abschnitt die Seite des Zwischenblatts bzw. des ersten Protokolls zurück.
 */
export function mappePages(sections: MappeSection[], pagesOf: (id: string) => number, tocPages: number) {
  let page = 1 + tocPages + 1;
  const item = new Map<string, number>();
  const section = new Map<string, number>();
  for (const s of sections) {
    section.set(s.key, page);
    if (s.kind !== 'clean') page += 1;
    for (const it of s.items) {
      item.set(it.id, page);
      page += Math.max(1, pagesOf(it.id));
    }
  }
  return { item, section, total: page - 1 };
}
