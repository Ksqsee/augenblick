// Checkliste je Typ zum Ausdrucken (Plan v7 W): eine Seite mit den Prüfpunkten der Elementart, gegliedert nach
// Bauteil-Gruppen (`group` am Prüfpunkt bzw. Schlüsselwörter, shared/checkpoint-groups.ts) – nur die Punkte, die für
// die Stammdaten des Typs zutreffen (`appliesIf`, shared/applies.ts). Ist ein Stammdatum offen, bleibt der Punkt mit
// „falls vorhanden“ stehen. Die Checkliste ist Gedächtnisstütze, keine Eingabe: angesagt wird nur, was nicht stimmt.
import { checkpointApplies, conditionOf } from './applies';
import type { Checkpoint } from './catalog';
import { groupCheckpoints } from './checkpoint-groups';

export interface ChecklistRow {
  /** laufende Nummer auf der Checkliste */
  n: number;
  label: string;
  hint?: string;
  /** Stammdatum unbekannt: Punkt gilt nur, wenn vorhanden (Bezeichnung des Stammdatums) */
  ifPresent?: string;
}

export interface Checklist {
  groups: { key: string; label: string; rows: ChecklistRow[] }[];
  total: number;
  /** nach den Stammdaten nicht zutreffend (entfällt) */
  omitted: string[];
}

export function buildChecklist(
  checkpoints: Pick<Checkpoint, 'id' | 'label' | 'hint' | 'group' | 'appliesIf'>[],
  category: string,
  attrs: Record<string, unknown> | null | undefined,
  fieldLabel: (attr: string) => string | undefined = () => undefined,
): Checklist {
  const omitted: string[] = [];
  const kept: (Pick<Checkpoint, 'id' | 'label' | 'hint' | 'group'> & { ifPresent?: string })[] = [];
  for (const cp of checkpoints) {
    const cond = conditionOf(cp, category);
    const a = checkpointApplies(cond, attrs);
    if (a === 'no') omitted.push(cp.label);
    else kept.push({ id: cp.id, label: cp.label, hint: cp.hint, group: cp.group, ...(a === 'unknown' && cond ? { ifPresent: fieldLabel(cond.attr) ?? cond.attr } : {}) });
  }
  const groups = groupCheckpoints(kept).map((g) => ({
    key: g.key,
    label: g.label,
    rows: g.items.map(({ cp, n }) => ({ n, label: cp.label, ...(cp.hint ? { hint: cp.hint } : {}), ...(cp.ifPresent ? { ifPresent: cp.ifPresent } : {}) })),
  }));
  return { groups, total: kept.length, omitted };
}

/**
 * Anforderung als Kurzform: Feld „Anforderung“ (Paket V, z. B. „T30-RS“), sonst aus Feuerwiderstand und Rauchschutz
 * zusammengesetzt („T30“ + RS → „T30-RS“), ohne Angabe leer.
 */
export function requirementOf(attrs: Record<string, unknown> | null | undefined): string {
  const a = attrs ?? {};
  const req = a.requirement;
  if (typeof req === 'string' && req.trim()) return req.trim();
  const rating = typeof a.rating === 'string' ? a.rating.trim() : '';
  const rs = a.smoke === true || /^(ja|true)$/i.test(String(a.smoke ?? ''));
  return [rating, rs ? 'RS' : ''].filter(Boolean).join('-');
}

/** Feste Texte der Checkliste (Seite und PDF) – englische Fassung in shared/i18n.ts, ein Test prüft die Abdeckung. */
export const CHECKLIST_TEXTS = [
  'Checkliste',
  'Typ',
  'Anforderung',
  'Zulassung',
  'Elementart',
  'Element',
  'Prüfpunkt',
  'Türen mit Abweichung / Notiz',
  'falls vorhanden',
  'Nur Abweichungen ansagen – alles Übrige gilt als in Ordnung.',
  'Entfällt nach den Stammdaten',
  'Geprüfte Türen (Nummern)',
  'Notizen',
  'Datum',
  'Prüfer/in',
  'Prüfpunkte nach Bauteil',
  'Typ unbekannt',
  'Alle Punkte',
  'Kennzeichnung und Zugang',
  'Auslösung und Funktion',
  'Beschläge und Mechanik',
  'Bauteil und Einbau',
  'Weitere Punkte',
] as const;
