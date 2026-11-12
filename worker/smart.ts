// Smarte Funktionen: Rundgänge, Aufgaben aus Mängeln und die Alt-Pfade /smart/suggestions und /smart/action-required –
// beide dünne Hüllen über die Quellen von GET /now (worker/now.ts).
import { Hono } from 'hono';
import { z } from 'zod';
import { rankNow } from '../shared/now';
import { sortByUrgency } from '../shared/tasks';
import { tid } from './data';
import { createDefectTasks } from './automation';
import { type AppEnv, type Ctx, logActivity, now, requireRole, scopeSql } from './lib';
import { collectNow, dueRounds, overdueTasks, severeDefectsWithoutTask } from './now';

export const smart = new Hono<AppEnv>();

smart.get('/smart/rounds', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
  return c.json(await dueRounds(c, days));
});

/** Alt-Pfad (Fremdsysteme, MCP): dieselben Zeilen wie GET /now, ungekürzt und im früheren Format (link oder action). */
export interface Suggestion {
  id: string;
  kind: string;
  automation?: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  link?: string;
  action?: { label: string; endpoint: string; body?: unknown };
  count: number;
}

smart.get('/smart/suggestions', async (c) => {
  const r = rankNow(await collectNow(c), now(), Number.MAX_SAFE_INTEGER);
  return c.json(
    r.items.map(
      (i): Suggestion => ({
        id: i.id,
        kind: i.kind,
        ...(i.automation ? { automation: i.automation } : {}),
        tone: i.tone,
        title: i.title,
        text: i.text,
        ...(i.action.link ? { link: i.action.link } : { action: { label: i.action.label, endpoint: i.action.endpoint!, ...(i.action.body !== undefined ? { body: i.action.body } : {}) } }),
        count: i.count,
      }),
    ),
  );
});

/** Für offene Mängel ohne Aufgabe je eine Aufgabe anlegen (Zuweisungsregeln und Protokoll: siehe automation.ts). */
export function tasksFromDefects(c: Ctx, opts: { severities: string[]; inspectionId?: string; defectId?: string }) {
  return createDefectTasks(c, opts);
}

/**
 * Handlungsbedarf: schwere offene Mängel ohne Aufgabe, überfällige Aufgaben und überfällige Elemente –
 * in einer Liste, nach Dringlichkeit sortiert (siehe shared/tasks.ts).
 */
export async function actionRequired(c: Ctx) {
  const t = tid(c);
  const n = now();
  // Dieselben Quellen wie GET /now (worker/now.ts); hier alle Aufgaben im Bereich und einzelne Elemente
  const [defects, tasks, assets] = await Promise.all([
    severeDefectsWithoutTask(c, true),
    overdueTasks(c, false),
    c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, a.next_due_at AS dueAt, b.name AS buildingName, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
          AND a.next_due_at < ?2 AND ${scopeSql(c, 'b.id', 'building')} ORDER BY a.next_due_at LIMIT 300`,
    )
      .bind(t, n)
      .all(),
  ]);
  type R = Record<string, unknown>;
  const items = [
    ...(defects.results as R[]).map((d) => ({
      kind: 'defect' as const,
      id: d.id as string,
      level: d.severity as string,
      at: d.createdAt as number,
      title: d.title as string,
      subtitle: [d.code ?? 'Begehung', d.buildingName, d.propertyName].filter(Boolean).join(' · '),
      reason: 'ohne Aufgabe',
      assetId: (d.assetId as string | null) ?? null,
    })),
    ...(tasks.results as R[]).map((k) => ({
      kind: 'task' as const,
      id: k.id as string,
      level: k.priority as string,
      at: k.dueAt as number,
      title: k.title as string,
      subtitle: [k.code, k.assigneeName ?? 'ohne Zuständige'].filter(Boolean).join(' · '),
      reason: 'Aufgabe überfällig',
      assetId: null,
    })),
    ...(assets.results as R[]).map((a) => ({
      kind: 'asset' as const,
      id: a.id as string,
      level: null,
      at: a.dueAt as number,
      title: `${a.code}${a.location ? ` – ${a.location}` : ''}`,
      subtitle: [a.buildingName, a.propertyName].filter(Boolean).join(' · '),
      reason: 'Prüfung überfällig',
      assetId: a.id as string,
    })),
  ];
  return sortByUrgency(items, n).slice(0, 300);
}

smart.get('/smart/action-required', async (c) => c.json(await actionRequired(c)));

smart.post('/smart/tasks-from-defects', async (c) => {
  requireRole(c, 'inspector');
  const b = z.object({ severities: z.array(z.enum(['low', 'medium', 'high', 'critical'])).min(1).default(['high', 'critical']) }).parse(await c.req.json().catch(() => ({})));
  const created = await tasksFromDefects(c, b);
  if (created) await logActivity(c, 'create', 'task', null, `${created} Aufgaben aus Mängeln angelegt`);
  return c.json({ created });
});
