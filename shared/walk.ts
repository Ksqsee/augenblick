// Begehung eines Objekts (Plan v8, Paket Z): eine Begehung = alle Prüfungen des Objekts an einem Kalendertag – kein
// eigenes Datenmodell. Hier liegt die Logik der Ergebnisliste für Worker (GET /properties/:id/walk) und App:
// Tage bilden (in der Zeitzone des Workspaces), den Tag wählen, je Element den Stand des Tages bestimmen
// (bestanden · mit Mangel · nicht prüfbar · noch offen) und zählen.
import { dayIn } from './dates';
import { type Answer, computeResult, finalResult, type Result, type ResultOverride } from './logic';
import { compareWalk, type WalkItem } from './walk-order';

export type WalkStatus = 'ok' | 'defects' | 'not_inspectable' | 'open';
export const WALK_STATUSES: WalkStatus[] = ['ok', 'defects', 'not_inspectable', 'open'];

/** Eine Prüfung des Tages, wie sie der Endpunkt liefert. */
export interface WalkInspection {
  id: string;
  assetId: string;
  status: 'draft' | 'submitted';
  /** Entwurf liegt zur Unterschrift bereit */
  ready: boolean;
  /** abgeschlossen: gespeichertes Ergebnis; bereiter Entwurf: Ergebnis wie beim Abschluss; sonst null */
  result: Result | null;
  /** Zahl der erfassten Mängel */
  defects: number;
  /** nicht ausgewertete Rohnotizen (Diktat) */
  rawPending: number;
  /** Zeitpunkt (abgeschlossen: Prüfdatum, Entwurf: angelegt) */
  at: number;
  inspectorId: string;
  inspector: string;
}

/** Ergebnis eines Entwurfs wie beim Abschluss (automatisch oder vom Prüfer festgelegt). */
export function draftOutcome(d: { notInspectable?: boolean; answers?: Record<string, Answer> | null; defects?: { severity: string; title?: string }[] | null; resultOverride?: ResultOverride | null }): Result {
  const defects = (d.defects ?? []).map((x) => ({ title: x.title ?? '', severity: x.severity as 'low' }));
  return finalResult(computeResult({ notInspectable: !!d.notInspectable, answers: d.answers ?? {}, defects }), d.resultOverride ?? null, defects.length);
}

/** Tage mit Prüfungen, neuester zuerst, mit Anzahl. */
export function walkDays(times: number[], timeZone?: string): { date: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of times) {
    const d = dayIn(t, timeZone);
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return [...m].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Gewählter Tag: der gewünschte (falls gültig), sonst der neueste Tag mit Prüfungen, sonst heute. */
export function pickWalkDay(days: { date: string }[], wanted: string | null | undefined, today: string): string {
  if (wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted)) return wanted;
  return days[0]?.date ?? today;
}

/** Stand einer Prüfung in der Ergebnisliste. Unfertige Entwürfe zählen als „noch offen“ (angefangen). */
export function inspectionStatus(i: Pick<WalkInspection, 'status' | 'ready' | 'result'>): WalkStatus {
  if (i.status === 'draft' && !i.ready) return 'open';
  if (!i.result) return 'open';
  if (i.result === 'not_inspectable') return 'not_inspectable';
  return i.result === 'ok' ? 'ok' : 'defects';
}

export interface WalkRow<A> {
  asset: A;
  status: WalkStatus;
  /** maßgebliche Prüfung des Tages (null = an diesem Tag nicht angefasst) */
  inspection: WalkInspection | null;
  /** weitere Prüfungen desselben Elements am selben Tag */
  more: number;
  critical: boolean;
  /** bereit, aber noch nicht unterschrieben */
  unsigned: boolean;
  /** angefangen, noch nicht bereit */
  started: boolean;
}

export interface WalkResult<A> {
  rows: WalkRow<A>[];
  counts: Record<WalkStatus, number>;
  /** geprüft (alles außer „noch offen“) */
  done: number;
  /** davon noch nicht unterschrieben */
  unsigned: number;
  /** Prüfungen mit nicht ausgewertetem Diktat */
  rawPending: number;
}

/** Vorrang, wenn ein Element am Tag mehrfach geprüft wurde: abgeschlossen vor bereit vor angefangen, dann die neueste. */
const weight = (i: WalkInspection) => (i.status === 'submitted' ? 2 : i.ready ? 1 : 0);

/**
 * Ergebnisliste eines Tages. Elemente, die erst nach dem Tag angelegt wurden, fehlen (`dayEnd`); Elemente mit einer
 * Prüfung des Tages stehen immer drin – auch wenn sie inzwischen archiviert wären, fehlen sie nur, wenn `assets` sie
 * nicht mehr enthält. Reihenfolge: Laufreihenfolge (Etage, Anlage, Nummer).
 */
export function walkResult<A extends WalkItem & { id: string }>(assets: A[], inspections: WalkInspection[], opts: { dayEnd?: number } = {}): WalkResult<A> {
  const by = new Map<string, WalkInspection[]>();
  for (const i of inspections) by.set(i.assetId, [...(by.get(i.assetId) ?? []), i]);
  const rows: WalkRow<A>[] = [];
  for (const a of [...assets].sort(compareWalk)) {
    const list = by.get(a.id) ?? [];
    if (!list.length && opts.dayEnd != null && a.createdAt != null && a.createdAt > opts.dayEnd) continue;
    const main = list.reduce<WalkInspection | null>((m, i) => (!m || weight(i) > weight(m) || (weight(i) === weight(m) && i.at > m.at) ? i : m), null);
    const status = main ? inspectionStatus(main) : 'open';
    rows.push({
      asset: a,
      status,
      inspection: main,
      more: Math.max(0, list.length - 1),
      critical: main?.result === 'critical' && status === 'defects',
      unsigned: !!main && main.status === 'draft' && main.ready,
      started: !!main && main.status === 'draft' && !main.ready,
    });
  }
  const counts: Record<WalkStatus, number> = { ok: 0, defects: 0, not_inspectable: 0, open: 0 };
  for (const r of rows) counts[r.status]++;
  return {
    rows,
    counts,
    done: rows.length - counts.open,
    unsigned: rows.filter((r) => r.unsigned).length,
    rawPending: rows.filter((r) => (r.inspection?.rawPending ?? 0) > 0).length,
  };
}

/** Zeilen für einen Filter (`all` = alle). */
export function filterWalk<A>(rows: WalkRow<A>[], filter: WalkStatus | 'all'): WalkRow<A>[] {
  return filter === 'all' ? rows : rows.filter((r) => r.status === filter);
}
