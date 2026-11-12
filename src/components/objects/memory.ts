// Merkt sich, wo zuletzt Elemente angelegt wurden (Objekt, Gebäude, Etage) – nur im Browser,
// damit mehrere Elemente nacheinander ohne erneutes Auswählen erfasst werden können.
const KEY = 'pk:last-place';

export interface LastPlace {
  propertyId?: string;
  buildingId?: string;
  /** zuletzt benutzte Etage je Gebäude */
  floors?: Record<string, string>;
}

export function readLastPlace(): LastPlace {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as LastPlace) : {};
  } catch {
    return {};
  }
}

export function rememberPlace(p: { propertyId?: string; buildingId: string; floor: string }) {
  try {
    const cur = readLastPlace();
    const floors = { ...(cur.floors ?? {}), [p.buildingId]: p.floor };
    // nicht unbegrenzt wachsen lassen
    const keys = Object.keys(floors);
    if (keys.length > 50) delete floors[keys[0]!];
    localStorage.setItem(KEY, JSON.stringify({ propertyId: p.propertyId ?? cur.propertyId, buildingId: p.buildingId, floors }));
  } catch {
    /* privates Fenster o. Ä. – ohne Gedächtnis weiter */
  }
}

export const lastFloor = (buildingId: string) => readLastPlace().floors?.[buildingId] ?? '';
