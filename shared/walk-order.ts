// Laufreihenfolge eines Rundgangs (Plan v6, A3): Etagen von unten nach oben, innerhalb der Etage in der Reihenfolge,
// in der die Elemente angelegt wurden (`sort_index`, sonst Nummer und Anlagezeit). Eine Funktion für Worker
// (tour, plan, Rundgang-API) und App (Rundgang, Offline-Rundgang), damit überall dieselbe Reihenfolge gilt.

/** Rang einer Etage: TG < 2. UG < UG/KG < EG < ZG < 1. OG < … < DG; Unbekanntes und Leeres ans Ende. */
export function floorRank(floor: string | null | undefined): number {
  const f = (floor ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/\s+/g, ' ')
    .trim();
  if (!f) return 10_000;
  if (/^(tg|tiefgarage)\b/.test(f)) return -100;
  let m = f.match(/^(-?\d{1,2})\s*\.?\s*(ug|untergeschoss|kg|kellergeschoss|keller|souterrain)\b/);
  if (m) return -Math.abs(Number(m[1]));
  m = f.match(/^(ug|untergeschoss|kg|kellergeschoss|keller|souterrain)\s*(-?\d{1,2})?\b/);
  if (m) return m[2] ? -Math.abs(Number(m[2])) : -1;
  if (/^(eg|erdgeschoss|hochparterre|parterre)\b/.test(f)) return 0;
  if (/^(zg|zwischengeschoss|mezzanin)\b/.test(f)) return 0.5;
  m = f.match(/^(\d{1,2})\s*\.?\s*(og|obergeschoss|etage|stock|stockwerk)\b/);
  if (m) return Number(m[1]);
  m = f.match(/^(og|obergeschoss|etage)\s*(\d{1,2})\b/);
  if (m) return Number(m[2]);
  if (/^(og|obergeschoss)\b/.test(f)) return 1;
  if (/^(dg|dachgeschoss|dachboden|spitzboden)\b/.test(f)) return 1_000;
  // reine Zahl: „0“ = EG, „-1“ = UG, „3“ = 3. OG
  m = f.match(/^(-?\d{1,2})$/);
  if (m) return Number(m[1]);
  return 5_000;
}

export interface WalkItem {
  code: string;
  floor?: string | null;
  sortIndex?: number | null;
  number?: number | null;
  createdAt?: number | null;
}

const cmpStr = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const nullsLast = (x: number | null | undefined, y: number | null | undefined) =>
  x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y;

/** Vergleich zweier Elemente in Laufreihenfolge. */
export function compareWalk(a: WalkItem, b: WalkItem): number {
  const ra = floorRank(a.floor);
  const rb = floorRank(b.floor);
  if (ra !== rb) return ra - rb;
  // unbekannte Etagen untereinander nach Namen gruppieren
  if (ra >= 5_000) {
    const c = cmpStr(a.floor ?? '', b.floor ?? '');
    if (c) return c;
  }
  return nullsLast(a.sortIndex, b.sortIndex) || nullsLast(a.number, b.number) || nullsLast(a.createdAt, b.createdAt) || cmpStr(a.code, b.code);
}

/** Kopie in Laufreihenfolge. */
export const walkSort = <T extends WalkItem>(items: T[]): T[] => [...items].sort(compareWalk);
