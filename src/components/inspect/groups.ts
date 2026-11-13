// Prüfpunkte in Gruppen (v5): die Prüfliste wird eingeklappt nach Gruppen gezeigt, damit der Normalfall
// („alles in Ordnung“) nicht an 16 Zeilen mit je drei Knöpfen vorbei muss. Die Kataloge kennen keine Gruppen;
// sie entstehen hier aus Schlüsselwörtern der Bezeichnung. Bringt ein Prüfpunkt selbst `group` mit, gilt diese.
// Reihenfolge der Gruppen: wie ihr erster Punkt in der Liste. Nummern bleiben die der Liste.
import type { Answer } from '../../../shared/logic';

export interface CheckGroup<T> {
  key: string;
  label: string;
  /** Punkte mit ihrer Nummer in der Gesamtliste (1-basiert) */
  items: { cp: T; n: number }[];
}

const RULES: [string, string, RegExp][] = [
  ['mark', 'Kennzeichnung und Zugang', /kennzeichn|schild|plakette|anleitung|dokumentation|zulassung|standort|zugänglich|revisionsöffnung/i],
  ['function', 'Auslösung und Funktion', /funktion(?!sfähig)|auslös|feststell|rauchmelder|rauchschalter|keil|festhalt|endlage|stellantrieb|federrücklauf|leitsystem|alarm|prüftaste|batterie|druckanzeige|treibmittel|füllmenge|löschmittel|austauschfrist|betriebsstellung/i],
  ['mechanics', 'Beschläge und Mechanik', /schließ|schloss(?!en)|bänder|drücker|beschlag|falle|freilauf|halterung|sicherung|plombe|schlauch|ventil/i],
  ['body', 'Bauteil und Einbau', /türblatt|zarge|dicht|verglas|glas|gehäuse|einbau|montiert|abstand|klappenblatt|behälter|schwelle|bodenspalt|innenwand|verformung|korrosion|verschmutz|öffnungen/i],
];
const REST: [string, string] = ['rest', 'Weitere Punkte'];

/** Bis zu so vielen Punkten keine Unterteilung – eine Gruppe „Alle Punkte“. */
const SMALL = 6;

export function groupCheckpoints<T extends { id: string; label: string; group?: string }>(cps: T[]): CheckGroup<T>[] {
  if (cps.length <= SMALL && !cps.some((c) => c.group)) return [{ key: 'all', label: 'Alle Punkte', items: cps.map((cp, i) => ({ cp, n: i + 1 })) }];
  const by = new Map<string, CheckGroup<T>>();
  cps.forEach((cp, i) => {
    const [key, label] = cp.group ? [`g:${cp.group}`, cp.group] : (RULES.find(([, , re]) => re.test(cp.label)) ?? REST);
    const g = by.get(key) ?? { key, label, items: [] };
    g.items.push({ cp, n: i + 1 });
    by.set(key, g);
  });
  return [...by.values()];
}

export interface GroupCount {
  total: number;
  ok: number;
  defect: number;
  na: number;
  open: number;
}

export function countGroup(ids: string[], answers: Record<string, Answer | undefined>): GroupCount {
  const c: GroupCount = { total: ids.length, ok: 0, defect: 0, na: 0, open: 0 };
  for (const i of ids) {
    const a = answers[i];
    if (a === 'ok') c.ok++;
    else if (a === 'defect') c.defect++;
    else if (a === 'na') c.na++;
    else c.open++;
  }
  return c;
}

/** Zähler der Gruppenzeile, z. B. „6 von 6 i. O.“ oder „4 von 6 i. O. · 1 Mangel · 1 offen“. */
export function groupSummary(c: GroupCount): string {
  return [
    `${c.ok} von ${c.total} i. O.`,
    c.defect && (c.defect === 1 ? '1 Mangel' : `${c.defect} Mängel`),
    c.na && `${c.na} n. z.`,
    c.open && c.open < c.total && `${c.open} offen`,
  ]
    .filter(Boolean)
    .join(' · ');
}
