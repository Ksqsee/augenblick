// Bekannte Mängel im Prüfablauf: offene Mängel des Elements werden beim passenden Prüfpunkt
// angezeigt. „Weiterhin vorhanden“ verknüpft den bestehenden Mangel statt einen neuen anzulegen,
// „Behoben“ schließt ihn mit dem Abschluss der Prüfung.
import type { Severity } from './catalog';
import type { Answer } from './logic';

/** Offener Mangel eines Elements aus einer früheren Prüfung (oder manuell erfasst). */
export interface KnownDefect {
  id: string;
  checkpointId: string | null;
  title: string;
  note: string;
  measure: string;
  severity: Severity;
  createdAt: number;
}

export interface CarryLike {
  checkpointId?: string;
  title: string;
  /** verknüpfter bestehender Mangel */
  knownId?: string;
  /** Datum, an dem der verknüpfte Mangel festgestellt wurde */
  since?: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Erfasste Mängel mit den offenen Mängeln des Elements abgleichen (Server, beim Abschluss).
 * 1. Ausdrücklich verknüpfte Mängel (`knownId`) bleiben verknüpft, solange der Mangel noch offen ist.
 * 2. Ein neuer Mangel mit derselben Bezeichnung wie ein offener wird ebenfalls verknüpft
 *    (bevorzugt am selben Prüfpunkt) – so entstehen auch offline oder per Diktat keine Doppel.
 * Jeder offene Mangel wird höchstens einmal verknüpft; als behoben gemeldete werden nie verknüpft.
 */
export function linkKnownDefects<T extends CarryLike>(defects: T[], known: KnownDefect[], resolved: string[] = []): T[] {
  const free = new Map(known.filter((k) => !resolved.includes(k.id)).map((k) => [k.id, k]));
  const explicit = defects.map((d) => {
    const k = d.knownId ? free.get(d.knownId) : undefined;
    if (k) {
      free.delete(k.id);
      return { ...d, since: k.createdAt };
    }
    const rest = { ...d };
    delete rest.knownId;
    delete rest.since;
    return rest;
  });
  return explicit.map((d) => {
    if (d.knownId) return d;
    const same = [...free.values()].filter((k) => norm(k.title) === norm(d.title));
    const k = same.find((x) => (x.checkpointId ?? '') === (d.checkpointId ?? '')) ?? same[0];
    if (!k) return d;
    free.delete(k.id);
    return { ...d, knownId: k.id, since: k.createdAt };
  });
}

/** Bekannte Mängel einem Prüfpunkt zuordnen; ohne passenden Prüfpunkt landen sie im eigenen Block. */
export function groupKnownDefects(known: KnownDefect[], checkpointIds: string[]) {
  const ids = new Set(checkpointIds);
  const byCheckpoint = new Map<string, KnownDefect[]>();
  const loose: KnownDefect[] = [];
  for (const k of known) {
    if (k.checkpointId && ids.has(k.checkpointId)) byCheckpoint.set(k.checkpointId, [...(byCheckpoint.get(k.checkpointId) ?? []), k]);
    else loose.push(k);
  }
  return { byCheckpoint, loose };
}

type CarryDefect = CarryLike & { note: string; severity: Severity; measure?: string };
export interface CarryDraft<D extends CarryDefect> {
  answers: Record<string, Answer>;
  defects: D[];
  /** als behoben gemeldete bekannte Mängel (IDs) */
  resolvedDefects?: string[];
}
export type KnownDecision = 'open' | 'present' | 'resolved';

export function knownDecision(draft: CarryDraft<CarryDefect>, id: string): KnownDecision {
  if (draft.resolvedDefects?.includes(id)) return 'resolved';
  return draft.defects.some((d) => d.knownId === id) ? 'present' : 'open';
}

/**
 * Entscheidung zu einem bekannten Mangel in den Entwurf übernehmen (Oberfläche, auch offline).
 * „present“ beantwortet den Prüfpunkt mit „Mangel“ und verknüpft den Mangel, „resolved“ mit „i. O.“,
 * „open“ nimmt die Entscheidung zurück.
 */
export function decideKnown<T extends CarryDraft<CarryDefect>>(draft: T, k: KnownDefect, decision: KnownDecision, checkpointIds: string[]): T {
  const cp = k.checkpointId && checkpointIds.includes(k.checkpointId) ? k.checkpointId : undefined;
  const answers = { ...draft.answers };
  let defects = draft.defects.filter((d) => d.knownId !== k.id);
  const resolvedDefects = (draft.resolvedDefects ?? []).filter((x) => x !== k.id);
  if (decision === 'present') {
    if (cp) {
      // ein neu erfasster Mangel am selben Punkt wird durch den bekannten ersetzt
      defects = defects.filter((d) => !(d.checkpointId === cp && !d.knownId));
      answers[cp] = 'defect';
    }
    defects.push({ checkpointId: cp, title: k.title, note: k.note, measure: k.measure, severity: k.severity, knownId: k.id, since: k.createdAt });
  } else if (decision === 'resolved') {
    resolvedDefects.push(k.id);
    if (cp && !defects.some((d) => d.checkpointId === cp && d.knownId)) {
      defects = defects.filter((d) => d.checkpointId !== cp);
      answers[cp] = 'ok';
    }
  } else if (cp && !defects.some((d) => d.checkpointId === cp)) {
    delete answers[cp];
  }
  return { ...draft, answers, defects: defects as T['defects'], resolvedDefects };
}
