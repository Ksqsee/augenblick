// Prüfpunkte mit Bedingung auf Stammdaten (Plan v6, A4): „Feststellanlage löst aus“ gilt nur mit Feststellanlage,
// „Schließfolge“ nur bei zweiflügeligen Türen. „Alles in Ordnung“ (App und MCP inspect) setzt nicht Zutreffendes auf
// „entfällt“; ist das Stammdatum unbekannt, bleibt der Punkt offen und es wird gezielt nachgefragt.
import type { Answer } from './logic';
import { CATEGORIES, type Checkpoint, type CheckpointCondition, isBuiltin, schedulesOf } from './catalog';
import { requirementOf } from './catalog-door';

/** Gezielte Rückfrage je Stammdatum; eigene Felder bekommen eine allgemeine Frage. */
const QUESTIONS: Record<string, string> = {
  holdOpen: 'Hat die Tür eine Feststellanlage?',
  leaves: 'Ist die Tür ein- oder zweiflügelig?',
  requirement: 'Welche Anforderung hat die Tür (keine, RS, T30, T30-RS, T90, T90-RS)?',
  dropSeal: 'Hat die Tür eine Absenkdichtung?',
  peephole: 'Hat die Tür einen Türspion?',
  cardLock: 'Hat die Tür ein Kartenschloss bzw. einen elektronischen Beschlag?',
  fanlight: 'Hat das Fenster ein Oberlicht?',
  fireDoor: 'Sitzt der Antrieb an einer Brandschutztür?',
};

/**
 * Bedingungen älterer Vorlagen (v6), deren Bezeichnung es in der Tür-Vorlage (v7) nicht mehr gibt – damit Entwürfe
 * von vor der Umstellung weiter richtig entfallen.
 */
const LEGACY: Record<string, CheckpointCondition> = {};

/** Kurzer Grund, warum ein Punkt entfällt (Antworten von MCP und App): „ohne Feststellanlage“, „ohne Brandschutz“ … */
export function conditionReason(cond: CheckpointCondition): string {
  if (cond.attr === 'holdOpen') return 'ohne Feststellanlage';
  if (cond.attr === 'leaves') return 'einflügelig';
  if (cond.attr === 'requirement') {
    const list = cond.in ?? (cond.equals != null ? [String(cond.equals)] : []);
    if (list.length && list.every((r) => r.startsWith('T'))) return 'ohne Brandschutz';
    if (list.length && list.every((r) => r.includes('RS'))) return 'ohne Rauchschutz';
    return 'ohne Anforderung';
  }
  if (cond.equals === true) return `ohne ${LABELS[cond.attr] ?? cond.attr}`;
  return `${cond.attr} ≠ ${cond.in ? cond.in.join('/') : String(cond.equals)}`;
}
const LABELS: Record<string, string> = {
  dropSeal: 'Absenkdichtung',
  peephole: 'Türspion',
  cardLock: 'Kartenschloss',
  fanlight: 'Oberlicht',
  fireDoor: 'Brandschutztür',
};
export const conditionQuestion = (attr: string, label?: string) => QUESTIONS[attr] ?? `Welchen Wert hat „${label ?? attr}“?`;

const fold = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/ü/g, 'ue')
    .replace(/[^a-z0-9]+/g, '');

/**
 * Bedingung eines Prüfpunkts: am Punkt gespeichert (neue Prüfungen) oder – für ältere Entwürfe und angepasste
 * Vorlagen ohne das Feld – über die gleichlautende Bezeichnung der eingebauten Vorlage.
 */
export function conditionOf(cp: Pick<Checkpoint, 'label' | 'appliesIf'>, category: string): CheckpointCondition | null {
  if (cp.appliesIf) return cp.appliesIf;
  if (!isBuiltin(category)) return null;
  if (LEGACY[cp.label] && category === 'fire_door') return LEGACY[cp.label]!;
  for (const s of schedulesOf(CATEGORIES[category])) {
    const hit = (s.checkpoints ?? []).find((c) => c.label === cp.label && c.appliesIf);
    if (hit) return hit.appliesIf!;
  }
  return null;
}

export type Applies = 'yes' | 'no' | 'unknown';

/** Trifft die Bedingung auf die Stammdaten zu? Leere Werte sind unbekannt. */
export function checkpointApplies(cond: CheckpointCondition | null, attrs: Record<string, unknown> | null | undefined): Applies {
  if (!cond) return 'yes';
  // Anforderung: auch aus den alten Feldern Feuerwiderstand/Rauchschutz (Bestand vor v7)
  const v = cond.attr === 'requirement' ? (requirementOf(attrs) ?? null) : attrs?.[cond.attr];
  if (v == null || v === '') return 'unknown';
  if (cond.in) return cond.in.some((x) => fold(x) === fold(v)) ? 'yes' : 'no';
  if (typeof cond.equals === 'boolean') {
    const b = typeof v === 'boolean' ? v : /^(ja|true|1|yes|vorhanden)$/i.test(String(v).trim()) ? true : /^(nein|false|0|no|keine?)$/i.test(String(v).trim()) ? false : null;
    if (b == null) return 'unknown';
    return b === cond.equals ? 'yes' : 'no';
  }
  return fold(v) === fold(cond.equals ?? '') ? 'yes' : 'no';
}

export interface AllOkResult {
  answers: Record<string, Answer>;
  /** auf „entfällt“ gesetzt, weil die Bedingung nicht zutrifft */
  na: string[];
  /** offen geblieben, weil das Stammdatum fehlt – mit Rückfrage */
  unknown: { id: string; label: string; attr: string; question: string }[];
  /** auf „i. O.“ gesetzt */
  ok: string[];
}

/**
 * „Alles in Ordnung“: alle noch offenen Punkte auf „i. O.“ – außer Punkten, deren Bedingung nicht zutrifft
 * („entfällt“) oder unbekannt ist (bleiben offen). Schon beantwortete Punkte bleiben, wie sie sind.
 */
export function allOkAnswers(
  checkpoints: Pick<Checkpoint, 'id' | 'label' | 'appliesIf'>[],
  answers: Record<string, Answer | undefined>,
  category: string,
  attrs: Record<string, unknown> | null | undefined,
  fieldLabel?: (attr: string) => string | undefined,
): AllOkResult {
  const out: AllOkResult = { answers: {}, na: [], unknown: [], ok: [] };
  for (const [k, v] of Object.entries(answers)) if (v) out.answers[k] = v;
  for (const c of checkpoints) {
    if (out.answers[c.id]) continue;
    const cond = conditionOf(c, category);
    const a = checkpointApplies(cond, attrs);
    if (a === 'no') {
      out.answers[c.id] = 'na';
      out.na.push(c.id);
    } else if (a === 'unknown' && cond) {
      out.unknown.push({ id: c.id, label: c.label, attr: cond.attr, question: conditionQuestion(cond.attr, fieldLabel?.(cond.attr)) });
    } else {
      out.answers[c.id] = 'ok';
      out.ok.push(c.id);
    }
  }
  return out;
}
