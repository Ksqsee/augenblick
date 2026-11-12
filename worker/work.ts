import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Category, Role } from '../shared/catalog';
import { DEFAULT_SLA, HOUR } from '../shared/sla';
import { addMonths } from '../shared/logic';
import { getCategoryDef, getSchedule } from './categories';
import { defaultTaskKind, type TaskKind, taskKindError } from '../shared/tasks';
import { assetInScope, defectInScope, randomCode, str, taskScope, tid } from './data';
import { type AppEnv, assertInScope, type Ctx, type Env, id, logActivity, notFound, now, parseJson, RANK, requireRole, type ScopeSetting, token } from './lib';
import { afterTasksDone, systemCtx } from './automation';
import { notify, notifyTenant } from './notify';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';

export const work = new Hono<AppEnv>();

// ---------- Subunternehmer ----------
const subBody = z.object({
  company: str(160).min(1, 'Firma fehlt'),
  contactName: str(160).default(''),
  email: z.union([z.literal(''), z.string().trim().email()]).default(''),
  phone: str(60).default(''),
  trade: str(160).default(''),
  notes: str(2000).default(''),
});

work.get('/subcontractors', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.company, s.contact_name AS contactName, s.email, s.phone, s.trade, s.notes,
            (SELECT COUNT(*) FROM tasks t WHERE t.subcontractor_id = s.id AND t.status IN ('open','in_progress')) AS openTasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.subcontractor_id = s.id AND t.status = 'done') AS doneTasks
       FROM subcontractors s WHERE s.tenant_id = ? AND s.deleted_at IS NULL ORDER BY s.company`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

work.post('/subcontractors', async (c) => {
  requireRole(c, 'admin');
  const b = subBody.parse(await c.req.json());
  const sid = id();
  await c.env.DB.prepare(
    'INSERT INTO subcontractors (id, tenant_id, company, contact_name, email, phone, trade, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(sid, tid(c), b.company, b.contactName, b.email, b.phone, b.trade, b.notes, now())
    .run();
  await logActivity(c, 'create', 'subcontractor', sid, `Subunternehmer „${b.company}“ angelegt`);
  return c.json({ id: sid });
});

work.patch('/subcontractors/:id', async (c) => {
  requireRole(c, 'admin');
  const b = subBody.parse(await c.req.json());
  const r = await c.env.DB.prepare(
    'UPDATE subcontractors SET company=?, contact_name=?, email=?, phone=?, trade=?, notes=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
  )
    .bind(b.company, b.contactName, b.email, b.phone, b.trade, b.notes, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Subunternehmer');
  return c.json({ ok: true });
});

work.delete('/subcontractors/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subcontractors SET deleted_at=? WHERE id=? AND tenant_id=?').bind(now(), c.req.param('id'), tid(c)),
    c.env.DB.prepare('UPDATE tasks SET subcontractor_id=NULL, share_token=NULL WHERE subcontractor_id=? AND tenant_id=?').bind(c.req.param('id'), tid(c)),
  ]);
  return c.json({ ok: true });
});

// ---------- Aufgaben: Labels & SLA ----------
const COLORS = ['slate', 'orange', 'blue', 'red', 'green', 'violet', 'teal', 'amber'] as const;

work.get('/tasks/labels', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.name, l.color, (SELECT COUNT(*) FROM tasks t, json_each(t.labels) j WHERE t.tenant_id = l.tenant_id AND j.value = l.id) AS used
       FROM task_labels l WHERE l.tenant_id = ? ORDER BY l.name`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

const labelBody = z.object({ name: str(40).min(1, 'Name fehlt'), color: z.enum(COLORS).default('slate') });
work.post('/tasks/labels', async (c) => {
  requireRole(c, 'admin');
  const b = labelBody.parse(await c.req.json());
  const lid = id();
  await c.env.DB.prepare('INSERT INTO task_labels (id, tenant_id, name, color, created_at) VALUES (?,?,?,?,?)').bind(lid, tid(c), b.name, b.color, now()).run();
  return c.json({ id: lid });
});
work.patch('/tasks/labels/:id', async (c) => {
  requireRole(c, 'admin');
  const b = labelBody.parse(await c.req.json());
  await c.env.DB.prepare('UPDATE task_labels SET name = ?, color = ? WHERE id = ? AND tenant_id = ?').bind(b.name, b.color, c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});
work.delete('/tasks/labels/:id', async (c) => {
  requireRole(c, 'admin');
  const lid = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM task_labels WHERE id = ? AND tenant_id = ?').bind(lid, tid(c)),
    c.env.DB.prepare(
      `UPDATE tasks SET labels = (SELECT COALESCE(json_group_array(j.value), '[]') FROM json_each(tasks.labels) j WHERE j.value != ?1)
        WHERE tenant_id = ?2 AND EXISTS (SELECT 1 FROM json_each(tasks.labels) j WHERE j.value = ?1)`,
    ).bind(lid, tid(c)),
  ]);
  return c.json({ ok: true });
});

async function slaPolicies(c: Ctx) {
  const rows = (
    await c.env.DB.prepare('SELECT priority, response_hours, resolution_hours FROM sla_policies WHERE tenant_id = ?')
      .bind(tid(c))
      .all<{ priority: 'low' | 'medium' | 'high'; response_hours: number; resolution_hours: number }>()
  ).results;
  const out = {} as Record<'low' | 'medium' | 'high', { responseHours: number; resolutionHours: number; custom: boolean }>;
  for (const p of ['high', 'medium', 'low'] as const) {
    const r = rows.find((x) => x.priority === p);
    out[p] = r ? { responseHours: r.response_hours, resolutionHours: r.resolution_hours, custom: true } : { ...DEFAULT_SLA[p], custom: false };
  }
  return out;
}

work.get('/tasks/sla-policies', async (c) => c.json(await slaPolicies(c)));
work.put('/tasks/sla-policies', async (c) => {
  requireRole(c, 'admin');
  const one = z.object({ responseHours: z.number().int().min(1).max(8760), resolutionHours: z.number().int().min(1).max(8760) });
  const b = z.object({ high: one, medium: one, low: one }).parse(await c.req.json());
  await c.env.DB.batch(
    (['high', 'medium', 'low'] as const).map((p) =>
      c.env.DB.prepare(
        `INSERT INTO sla_policies (tenant_id, priority, response_hours, resolution_hours) VALUES (?,?,?,?)
         ON CONFLICT (tenant_id, priority) DO UPDATE SET response_hours = excluded.response_hours, resolution_hours = excluded.resolution_hours`,
      ).bind(tid(c), p, b[p].responseHours, b[p].resolutionHours),
    ),
  );
  await logActivity(c, 'update', 'sla', null, 'SLA-Richtlinien geändert');
  return c.json({ ok: true });
});

// ---------- Aufgaben ----------
const kindEnum = z.enum(['inspection', 'defect', 'other']);
const statusEnum = z.enum(['open', 'in_progress', 'done', 'cancelled']);
const priorityEnum = z.enum(['low', 'medium', 'high']);
const taskBody = z.object({
  title: str(200).min(1, 'Titel fehlt'),
  description: str(5000).default(''),
  /** Aufgabentyp; ohne Angabe: mit Mangel → Mängelbehebung, sonst Sonstiges (bzw. bisheriger Typ) */
  kind: kindEnum.optional(),
  status: statusEnum.default('open'),
  priority: priorityEnum.default('medium'),
  dueAt: z.number().int().nullable().default(null),
  assigneeId: z.string().max(40).nullable().default(null),
  subcontractorId: z.string().max(40).nullable().default(null),
  assetId: z.string().max(40).nullable().default(null),
  defectId: z.string().max(40).nullable().default(null),
  propertyId: z.string().max(40).nullable().default(null),
  labels: z.array(z.string().max(40)).max(10).default([]),
  /** Beim Erledigen einer Mängelbehebung den Mangel mit schließen (Standard wie bisher: ja) */
  resolveDefect: z.boolean().default(true),
  /** Wiederholung (Autopilot recurring_tasks); beim Bearbeiten ohne Angabe unverändert */
  recurrence: z.enum(['monthly', 'quarterly', 'yearly']).nullable().optional(),
  /** Prüfauftrag für ein ganzes Gebäude (Rundgang); beim Bearbeiten ohne Angabe unverändert */
  buildingId: z.string().max(40).nullable().optional(),
});
type TaskBody = z.infer<typeof taskBody>;

const STATUS_TEXT: Record<string, string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };

work.get('/tasks', async (c) => {
  const sla = await slaPolicies(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT t.id, t.title, t.description, t.kind, t.status, t.priority, t.due_at AS dueAt, t.created_at AS createdAt, t.updated_at AS updatedAt,
              t.assignee_id AS assigneeId, u.name AS assigneeName, t.subcontractor_id AS subcontractorId, s.company AS subcontractorName,
              t.created_by AS createdBy, CASE WHEN t.created_by = 'system' THEN 'Autopilot' ELSE cu.name END AS createdByName,
              t.share_token AS shareToken, t.external_note AS externalNote, t.external_done_at AS externalDoneAt, t.labels,
              t.first_response_at AS firstResponseAt, t.closed_at AS closedAt,
              t.asset_id AS assetId, a.code AS assetCode, a.next_due_at AS assetNextDueAt, t.defect_id AS defectId,
              t.recurrence, t.recurs_from AS recursFrom, t.building_id AS buildingId, bl.name AS buildingName,
              d.title AS defectTitle, d.severity AS defectSeverity, d.status AS defectStatus,
              COALESCE(t.property_id, d.property_id) AS propertyId, p.name AS propertyName,
              (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comments,
              (SELECT COUNT(*) FROM task_watchers w WHERE w.task_id = t.id) AS watchers,
              EXISTS (SELECT 1 FROM task_watchers w WHERE w.task_id = t.id AND w.user_id = ?2) AS watching
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN users cu ON cu.id = t.created_by LEFT JOIN assets a ON a.id = t.asset_id
         LEFT JOIN subcontractors s ON s.id = t.subcontractor_id LEFT JOIN defects d ON d.id = t.defect_id
         LEFT JOIN properties p ON p.id = COALESCE(t.property_id, d.property_id) LEFT JOIN buildings bl ON bl.id = t.building_id
        WHERE t.tenant_id = ?1 AND ${taskScope(c, 't')} ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, COALESCE(t.due_at, 9e15), t.created_at DESC`,
    )
      .bind(tid(c), c.get('user').userId)
      .all<Record<string, unknown>>()
  ).results;
  const n = now();
  // Der Freigabe-Link erlaubt Rückmeldungen – nur für Personen, die Aufgaben bearbeiten dürfen
  const canShare = c.get('user').role !== 'viewer';
  return c.json(
    rows.map((r) => {
      const p = sla[r.priority as 'low' | 'medium' | 'high'];
      const created = r.createdAt as number;
      const responseDue = created + p.responseHours * HOUR;
      const resolveDue = created + p.resolutionHours * HOUR;
      const closed = (r.closedAt as number | null) ?? null;
      return {
        ...r,
        watching: !!r.watching,
        shareToken: canShare ? r.shareToken : null,
        labels: parseJson<string[]>(r.labels as string, []),
        sla: {
          responseDue,
          resolveDue,
          responseBreached: ((r.firstResponseAt as number | null) ?? closed ?? n) > responseDue,
          resolveBreached: (closed ?? n) > resolveDue && r.status !== 'cancelled',
        },
      };
    }),
  );
});

async function checkRefs(c: Ctx, b: TaskBody) {
  const one = (sql: string, v: string) => c.env.DB.prepare(sql).bind(tid(c), v).first();
  if (b.assigneeId && !(await one('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?', b.assigneeId)))
    throw new HTTPException(400, { message: 'Zuständige Person ist kein Mitglied' });
  if (b.subcontractorId && !(await one('SELECT 1 FROM subcontractors WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL', b.subcontractorId)))
    throw new HTTPException(400, { message: 'Subunternehmer nicht gefunden' });
  // Eingeschränkte Mitglieder: Bezüge außerhalb des Bereichs wie nicht vorhanden behandeln (404, keine Existenz-Auskunft)
  if (c.get('user').scope) {
    if (b.assetId) await assetInScope(c, b.assetId);
    if (b.defectId) await defectInScope(c, b.defectId);
  }
  if (b.propertyId) assertInScope(c, 'property', b.propertyId);
  if (b.assetId && !(await one('SELECT 1 FROM assets WHERE tenant_id = ? AND id = ?', b.assetId))) throw new HTTPException(400, { message: 'Element nicht gefunden' });
  if (b.defectId && !(await one('SELECT 1 FROM defects WHERE tenant_id = ? AND id = ?', b.defectId))) throw new HTTPException(400, { message: 'Mangel nicht gefunden' });
  if (b.propertyId && !(await one('SELECT 1 FROM properties WHERE tenant_id = ? AND id = ?', b.propertyId)))
    throw new HTTPException(400, { message: 'Objekt nicht gefunden' });
  if (b.buildingId) {
    assertInScope(c, 'building', b.buildingId);
    if (!(await one('SELECT 1 FROM buildings WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL', b.buildingId))) throw new HTTPException(400, { message: 'Gebäude nicht gefunden' });
  }
  for (const l of b.labels) if (!(await one('SELECT 1 FROM task_labels WHERE tenant_id = ? AND id = ?', l))) throw new HTTPException(400, { message: 'Label nicht gefunden' });
}

/** Typ bestimmen und prüfen: ausdrücklich angegeben → muss passen; sonst bisheriger bzw. Standardtyp. */
function resolveKind(b: Omit<TaskBody, 'buildingId'> & { buildingId?: string | null }, prev?: TaskKind): TaskKind {
  if (b.kind) {
    const err = taskKindError(b.kind, b);
    if (err) throw new HTTPException(400, { message: err });
    return b.kind;
  }
  if (prev && !taskKindError(prev, b) && !(prev === 'other' && b.defectId)) return prev;
  return defaultTaskKind(b);
}

const isClosed = (s: string) => s === 'done' || s === 'cancelled';

/** Personen als Beobachter eintragen (nur Mitglieder des Workspaces). */
export async function addWatchers(c: Ctx, taskIds: string[], userIds: (string | null | undefined)[]) {
  const users = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!users.length || !taskIds.length) return;
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at)
     SELECT t.value, m.user_id, ?1, ?2 FROM json_each(?3) t JOIN memberships m ON m.tenant_id = ?1 AND m.user_id IN (SELECT value FROM json_each(?4))`,
  )
    .bind(tid(c), now(), JSON.stringify(taskIds), JSON.stringify(users))
    .run();
}

/** Beobachter mehrerer Aufgaben (nur aktuelle Mitglieder). */
async function watchersOf(env: Env, tenantId: string, taskIds: string[]) {
  if (!taskIds.length) return [];
  return (
    await env.DB.prepare(
      `SELECT w.task_id AS taskId, w.user_id AS userId FROM task_watchers w JOIN memberships m ON m.user_id = w.user_id AND m.tenant_id = w.tenant_id
        WHERE w.tenant_id = ? AND w.task_id IN (SELECT value FROM json_each(?))`,
    )
      .bind(tenantId, JSON.stringify(taskIds))
      .all<{ taskId: string; userId: string }>()
  ).results;
}

/** Statuswechsel an die Beobachter melden (ohne die auslösende Person). */
async function notifyStatus(c: Ctx, changed: { id: string; title: string }[], status: string) {
  const w = await watchersOf(c.env, tid(c), changed.map((t) => t.id));
  const byUser = new Map<string, string[]>();
  for (const x of w) byUser.set(x.userId, [...(byUser.get(x.userId) ?? []), x.taskId]);
  const by = c.get('user').name;
  for (const [userId, ids] of byUser) {
    const one = ids.length === 1 ? changed.find((t) => t.id === ids[0]) : null;
    await notify(c, {
      userIds: [userId],
      type: 'task_watch',
      title: one ? `„${one.title}“: ${STATUS_TEXT[status]}` : `${ids.length} beobachtete Aufgaben: ${STATUS_TEXT[status]}`,
      body: by,
      link: one ? `/aufgaben?id=${one.id}` : '/aufgaben',
    });
  }
}

work.post('/tasks', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkRefs(c, b);
  const kind = resolveKind(b);
  const tk = id();
  const t = now();
  // Ohne Fälligkeit greift die Lösungsfrist der SLA-Richtlinie
  const due = b.dueAt ?? t + (await slaPolicies(c))[b.priority].resolutionHours * HOUR;
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, kind, status, priority, due_at, assignee_id, subcontractor_id, asset_id, defect_id, property_id, building_id, labels,
                        recurrence, first_response_at, closed_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(tk, tid(c), b.title, b.description, kind, b.status, b.priority, due, b.assigneeId, b.subcontractorId, b.assetId, b.defectId, b.propertyId, b.buildingId ?? null,
      JSON.stringify(b.labels), b.recurrence ?? null, b.status !== 'open' ? t : null, isClosed(b.status) ? t : null, c.get('user').userId, t, t)
    .run();
  // Anlegende und zuständige Person beobachten automatisch
  await addWatchers(c, [tk], [c.get('user').userId, b.assigneeId]);
  await logActivity(c, 'create', 'task', tk, `Aufgabe „${b.title}“ angelegt`);
  if (b.assigneeId) await notify(c, { userIds: [b.assigneeId], type: 'task_assigned', title: `Neue Aufgabe: ${b.title}`, body: c.get('user').name, link: `/aufgaben?id=${tk}` });
  return c.json({ id: tk, kind });
});

async function resolveLinkedDefects(c: Ctx, taskIds: string[], by: string | null) {
  if (!taskIds.length) return;
  const r = await c.env.DB.prepare(
    `UPDATE defects SET status='resolved', resolved_at=?1, resolved_by=?2
      WHERE tenant_id=?3 AND status='open' AND id IN (SELECT defect_id FROM tasks WHERE tenant_id = ?3 AND defect_id IS NOT NULL AND id IN (SELECT value FROM json_each(?4)))`,
  )
    .bind(now(), by, tid(c), JSON.stringify(taskIds))
    .run();
  if (r.meta.changes) await logActivity(c, 'resolve', 'defect', null, `${r.meta.changes === 1 ? 'Mangel' : `${r.meta.changes} Mängel`} mit erledigter Aufgabe behoben`);
}

work.patch('/tasks/:id', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkRefs(c, b);
  const prev = await c.env.DB.prepare(
    `SELECT assignee_id, status, kind, first_response_at, recurrence, building_id FROM tasks WHERE id = ? AND tenant_id = ? AND ${taskScope(c, 'tasks')}`,
  )
    .bind(c.req.param('id'), tid(c))
    .first<{ assignee_id: string | null; status: string; kind: TaskKind; first_response_at: number | null; recurrence: string | null; building_id: string | null }>();
  if (!prev) notFound('Aufgabe');
  const recurrence = b.recurrence === undefined ? prev.recurrence : b.recurrence;
  const buildingId = b.buildingId === undefined ? prev.building_id : b.buildingId;
  const kind = resolveKind({ ...b, buildingId }, prev.kind);
  const t = now();
  const firstResponse = prev.first_response_at ?? (b.status !== 'open' ? t : null);
  await c.env.DB.prepare(
    `UPDATE tasks SET title=?, description=?, kind=?, status=?, priority=?, due_at=?, assignee_id=?, subcontractor_id=?, asset_id=?, defect_id=?, property_id=?, labels=?,
            recurrence=?, building_id=?, first_response_at=?, closed_at = CASE WHEN ? THEN COALESCE(closed_at, ?) ELSE NULL END, updated_at=?,
            share_token = CASE WHEN subcontractor_id IS ? THEN share_token ELSE NULL END
      WHERE id=? AND tenant_id=?`,
  )
    .bind(b.title, b.description, kind, b.status, b.priority, b.dueAt, b.assigneeId, b.subcontractorId, b.assetId, b.defectId, b.propertyId, JSON.stringify(b.labels),
      recurrence, buildingId, firstResponse, isClosed(b.status) ? 1 : 0, t, t, b.subcontractorId, c.req.param('id'), tid(c))
    .run();
  if (b.status === 'done' && prev.status !== 'done' && b.resolveDefect) await resolveLinkedDefects(c, [c.req.param('id')], c.get('user').userId);
  if (b.assigneeId && b.assigneeId !== prev.assignee_id) {
    await addWatchers(c, [c.req.param('id')], [b.assigneeId]);
    await notify(c, { userIds: [b.assigneeId], type: 'task_assigned', title: `Aufgabe zugewiesen: ${b.title}`, body: c.get('user').name, link: `/aufgaben?id=${c.req.param('id')}` });
  }
  if (b.status !== prev.status) await notifyStatus(c, [{ id: c.req.param('id'), title: b.title }], b.status);
  // Autopilot: Folgeaufgabe für wiederkehrende Aufgaben
  const next = b.status === 'done' && prev.status !== 'done' ? await afterTasksDone(c, [c.req.param('id')]) : 0;
  return c.json({ ok: true, kind, ...(next ? { nextCreated: true } : {}) });
});

/** Mehrfachbearbeitung: Status, Zuständige, Priorität und/oder Fälligkeit für mehrere Aufgaben. */
work.post('/tasks/bulk', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({
      ids: z.array(z.string().max(40)).min(1, 'Keine Aufgaben ausgewählt').max(200),
      status: statusEnum.optional(),
      assigneeId: z.string().max(40).nullable().optional(),
      priority: priorityEnum.optional(),
      dueAt: z.number().int().nullable().optional(),
      resolveDefects: z.boolean().default(true),
    })
    .refine((x) => x.status !== undefined || x.assigneeId !== undefined || x.priority !== undefined || x.dueAt !== undefined, 'Nichts zu ändern')
    .parse(await c.req.json());
  if (b.assigneeId && !(await c.env.DB.prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tid(c), b.assigneeId).first()))
    throw new HTTPException(400, { message: 'Zuständige Person ist kein Mitglied' });
  const rows = (
    await c.env.DB.prepare(`SELECT id, title, status, assignee_id FROM tasks WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?)) AND ${taskScope(c, 'tasks')}`)
      .bind(tid(c), JSON.stringify([...new Set(b.ids)]))
      .all<{ id: string; title: string; status: string; assignee_id: string | null }>()
  ).results;
  if (!rows.length) notFound('Aufgabe');
  const t = now();
  const sets: string[] = ['updated_at = ?1'];
  const args: unknown[] = [t, tid(c), JSON.stringify(rows.map((r) => r.id))];
  const arg = (v: unknown) => {
    args.push(v);
    return `?${args.length}`;
  };
  if (b.status !== undefined) {
    const s = arg(b.status);
    sets.push(
      `status = ${s}`,
      `first_response_at = COALESCE(first_response_at, CASE WHEN ${s} != 'open' THEN ?1 END)`,
      `closed_at = CASE WHEN ${s} IN ('done','cancelled') THEN COALESCE(closed_at, ?1) ELSE NULL END`,
    );
  }
  if (b.assigneeId !== undefined) sets.push(`assignee_id = ${arg(b.assigneeId)}`);
  if (b.priority !== undefined) sets.push(`priority = ${arg(b.priority)}`);
  if (b.dueAt !== undefined) sets.push(`due_at = ${arg(b.dueAt)}`);
  await c.env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE tenant_id = ?2 AND id IN (SELECT value FROM json_each(?3))`).bind(...args).run();
  const ids = rows.map((r) => r.id);
  if (b.status === 'done' && b.resolveDefects) await resolveLinkedDefects(c, rows.filter((r) => r.status !== 'done').map((r) => r.id), c.get('user').userId);
  if (b.assigneeId) {
    const newly = rows.filter((r) => r.assignee_id !== b.assigneeId);
    await addWatchers(c, ids, [b.assigneeId]);
    if (newly.length)
      await notify(c, {
        userIds: [b.assigneeId],
        type: 'task_assigned',
        title: newly.length === 1 ? `Aufgabe zugewiesen: ${newly[0].title}` : `${newly.length} Aufgaben zugewiesen`,
        body: c.get('user').name,
        link: newly.length === 1 ? `/aufgaben?id=${newly[0].id}` : '/aufgaben',
      });
  }
  if (b.status !== undefined) await notifyStatus(c, rows.filter((r) => r.status !== b.status), b.status);
  if (b.status === 'done') await afterTasksDone(c, rows.filter((r) => r.status !== 'done').map((r) => r.id));
  await logActivity(c, 'update', 'task', null, `${rows.length} Aufgaben gemeinsam geändert`);
  return c.json({ updated: rows.length, skipped: b.ids.length - rows.length });
});

work.delete('/tasks/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM task_comments WHERE task_id = ? AND tenant_id = ?').bind(c.req.param('id'), tid(c)),
    c.env.DB.prepare('DELETE FROM task_watchers WHERE task_id = ? AND tenant_id = ?').bind(c.req.param('id'), tid(c)),
    c.env.DB.prepare('DELETE FROM tasks WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tid(c)),
  ]);
  return c.json({ ok: true });
});

interface TaskRef {
  id: string;
  title: string;
  asset_id: string | null;
  property_id: string | null;
  building_id: string | null;
  assignee_id: string | null;
  created_by: string;
}
async function taskInScope(c: Ctx) {
  const task = await c.env.DB.prepare(`SELECT id, title, asset_id, property_id, building_id, assignee_id, created_by FROM tasks WHERE id = ? AND tenant_id = ? AND ${taskScope(c, 'tasks')}`)
    .bind(c.req.param('id'), tid(c))
    .first<TaskRef>();
  if (!task) notFound('Aufgabe');
  return task;
}

/** Darf ein (anderes) Mitglied diese Aufgabe sehen? Gleiche Regeln wie `taskScope`, aber für eine fremde Mitgliedschaft. */
async function memberSeesTask(c: Ctx, userId: string, task: TaskRef): Promise<boolean> {
  const m = await c.env.DB.prepare('SELECT role, scope FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tid(c), userId).first<{ role: Role; scope: string | null }>();
  if (!m) return false;
  if (RANK[m.role] >= RANK.admin) return true;
  const s = parseJson<ScopeSetting | null>(m.scope, null);
  if (!s) return true;
  const json = (a: string[] | undefined) => JSON.stringify(a ?? []);
  if (task.asset_id) {
    return !!(await c.env.DB.prepare(
      `SELECT 1 FROM assets a JOIN buildings b ON b.id = a.building_id WHERE a.id = ? AND (b.id IN (SELECT value FROM json_each(?)) OR b.property_id IN (SELECT value FROM json_each(?)))`,
    )
      .bind(task.asset_id, json(s.buildingIds), json(s.propertyIds))
      .first());
  }
  if (task.building_id) {
    if ((s.buildingIds ?? []).includes(task.building_id)) return true;
    return !!(await c.env.DB.prepare('SELECT 1 FROM buildings WHERE id = ? AND property_id IN (SELECT value FROM json_each(?))').bind(task.building_id, json(s.propertyIds)).first());
  }
  if (task.property_id) {
    if ((s.propertyIds ?? []).includes(task.property_id)) return true;
    return !!(await c.env.DB.prepare('SELECT 1 FROM buildings WHERE property_id = ? AND id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL').bind(task.property_id, json(s.buildingIds)).first());
  }
  return userId === task.assignee_id || userId === task.created_by;
}

// ---------- Beobachter ----------
work.get('/tasks/:id/watchers', async (c) => {
  const task = await taskInScope(c);
  const rows = await c.env.DB.prepare(
    `SELECT w.user_id AS userId, u.name FROM task_watchers w JOIN memberships m ON m.user_id = w.user_id AND m.tenant_id = w.tenant_id JOIN users u ON u.id = w.user_id
      WHERE w.task_id = ? AND w.tenant_id = ? ORDER BY u.name`,
  )
    .bind(task.id, tid(c))
    .all();
  return c.json(rows.results);
});

work.post('/tasks/:id/watch', async (c) => {
  const task = await taskInScope(c);
  await addWatchers(c, [task.id], [c.get('user').userId]);
  return c.json({ ok: true, watching: true });
});

work.delete('/tasks/:id/watch', async (c) => {
  const task = await taskInScope(c);
  await c.env.DB.prepare('DELETE FROM task_watchers WHERE task_id = ? AND user_id = ? AND tenant_id = ?').bind(task.id, c.get('user').userId, tid(c)).run();
  return c.json({ ok: true, watching: false });
});

// ---------- Kommentare (interne Notizen, nie im Link für Subunternehmer) ----------
work.get('/tasks/:id/comments', async (c) => {
  const rows = (
    await c.env.DB.prepare(
      `SELECT id, user_id AS userId, author_name AS authorName, body, mentions, created_at AS createdAt FROM task_comments
        WHERE task_id = ? AND tenant_id = ? AND task_id IN (SELECT id FROM tasks WHERE ${taskScope(c, 'tasks')}) ORDER BY created_at`,
    )
      .bind(c.req.param('id'), tid(c))
      .all<Record<string, unknown>>()
  ).results;
  return c.json(rows.map((r) => ({ ...r, mentions: parseJson<string[]>(r.mentions as string, []) })));
});

work.post('/tasks/:id/comments', async (c) => {
  requireRole(c, 'inspector');
  const { body, mentions } = z
    .object({ body: str(4000).min(1, 'Kommentar ist leer'), mentions: z.array(z.string().max(40)).max(20).default([]) })
    .parse(await c.req.json());
  const task = await taskInScope(c);
  const u = c.get('user');
  const mentioned = [...new Set(mentions)].filter((m) => m !== u.userId);
  // Erwähnt werden können nur Mitglieder, die die Aufgabe auch sehen dürfen
  for (const m of mentioned) {
    const member = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tid(c), m).first();
    if (!member) throw new HTTPException(400, { message: 'Erwähnte Person ist kein Mitglied dieses Workspaces' });
    if (!(await memberSeesTask(c, m, task))) throw new HTTPException(400, { message: 'Erwähnte Person hat keinen Zugriff auf diese Aufgabe' });
  }
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO task_comments (id, tenant_id, task_id, user_id, author_name, body, mentions, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(
      id(),
      tid(c),
      task.id,
      u.userId,
      u.name,
      body,
      JSON.stringify(mentioned),
      t,
    ),
    // Erste Reaktion zählt, wenn nicht die anlegende Person kommentiert
    c.env.DB.prepare('UPDATE tasks SET first_response_at = COALESCE(first_response_at, ?), updated_at = ? WHERE id = ?').bind(u.userId !== task.created_by ? t : null, t, task.id),
  ]);
  const watchers = (await watchersOf(c.env, tid(c), [task.id])).map((w) => w.userId);
  // Erwähnte und Kommentierende beobachten die Aufgabe ab jetzt
  await addWatchers(c, [task.id], [...mentioned, u.userId]);
  if (mentioned.length) await notify(c, { userIds: mentioned, type: 'task_mention', title: `${u.name} hat dich in „${task.title}“ erwähnt`, body: body.slice(0, 160), link: `/aufgaben?id=${task.id}` });
  const others = watchers.filter((w) => !mentioned.includes(w));
  if (others.length) await notify(c, { userIds: others, type: 'task_comment', title: `Kommentar zu „${task.title}“`, body: `${u.name}: ${body.slice(0, 140)}`, link: `/aufgaben?id=${task.id}` });
  return c.json({ ok: true, mentions: mentioned });
});

// ---------- Statistik ----------
work.get('/tasks/stats', async (c) => {
  const days = Math.min(365, Math.max(7, Number(c.req.query('days') ?? 30)));
  const n = now();
  const from = n - days * 24 * HOUR;
  const sla = await slaPolicies(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT t.status, t.priority, t.due_at, t.created_at, t.closed_at, t.first_response_at, t.assignee_id, u.name AS assignee
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.tenant_id = ? AND ${taskScope(c, 't')}`,
    )
      .bind(tid(c))
      .all<{ status: string; priority: 'low' | 'medium' | 'high'; due_at: number | null; created_at: number; closed_at: number | null; first_response_at: number | null; assignee_id: string | null; assignee: string | null }>()
  ).results;
  const open = rows.filter((r) => !isClosed(r.status));
  const closedInPeriod = rows.filter((r) => r.status === 'done' && r.closed_at && r.closed_at >= from);
  const byStatus = { open: 0, in_progress: 0, done: 0, cancelled: 0 } as Record<string, number>;
  const byPriority = { high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const r of rows) byStatus[r.status]++;
  for (const r of open) byPriority[r.priority]++;
  const slaRelevant = rows.filter((r) => r.created_at >= from && r.status !== 'cancelled' && (isClosed(r.status) || r.created_at + sla[r.priority].resolutionHours * HOUR < n));
  const compliant = slaRelevant.filter((r) => (r.closed_at ?? n) <= r.created_at + sla[r.priority].resolutionHours * HOUR).length;
  const workload = new Map<string, { name: string; open: number; overdue: number }>();
  for (const r of open) {
    const k = r.assignee_id ?? '';
    const w = workload.get(k) ?? { name: r.assignee ?? 'Nicht zugewiesen', open: 0, overdue: 0 };
    w.open++;
    if (r.due_at && r.due_at < n) w.overdue++;
    workload.set(k, w);
  }
  const resolutionTimes = closedInPeriod.map((r) => r.closed_at! - r.created_at);
  const responseTimes = rows.filter((r) => r.first_response_at && r.created_at >= from).map((r) => r.first_response_at! - r.created_at);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return c.json({
    days,
    backlog: { open: open.length, overdue: open.filter((r) => r.due_at && r.due_at < n).length, byStatus, byPriority },
    throughput: { created: rows.filter((r) => r.created_at >= from).length, closed: closedInPeriod.length },
    resolution: { avgResolutionMs: avg(resolutionTimes), avgResponseMs: avg(responseTimes) },
    sla: { total: slaRelevant.length, compliant, breached: slaRelevant.length - compliant, compliancePct: slaRelevant.length ? Math.round((compliant / slaRelevant.length) * 100) : null },
    workload: [...workload.values()].sort((a, b) => b.open - a.open),
  });
});

/** Externen Link für Subunternehmer erzeugen. */
work.post('/tasks/:id/share', async (c) => {
  requireRole(c, 'inspector');
  const t = await c.env.DB.prepare(`SELECT subcontractor_id, share_token FROM tasks WHERE id=? AND tenant_id=? AND ${taskScope(c, 'tasks')}`)
    .bind(c.req.param('id'), tid(c))
    .first<{ subcontractor_id: string | null; share_token: string | null }>();
  if (!t) notFound('Aufgabe');
  if (!t.subcontractor_id) throw new HTTPException(400, { message: 'Bitte zuerst einen Subunternehmer zuweisen' });
  const tok = t.share_token ?? token();
  await c.env.DB.prepare('UPDATE tasks SET share_token=? WHERE id=?').bind(tok, c.req.param('id')).run();
  return c.json({ token: tok });
});

work.delete('/tasks/:id/share', async (c) => {
  requireRole(c, 'inspector');
  await c.env.DB.prepare(`UPDATE tasks SET share_token=NULL WHERE id=? AND tenant_id=? AND ${taskScope(c, 'tasks')}`).bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});

// ---------- Import ----------
const importRow = z.object({
  property: str(160).min(1),
  building: str(160).min(1),
  category: z.string().min(1).max(40),
  code: str(40).optional(),
  labelCode: str(60).optional(),
  location: str(200).default(''),
  floor: str(60).default(''),
  manufacturer: str(120).default(''),
  model: str(120).default(''),
  year: z.number().int().min(1900).max(2100).optional(),
  lastInspectedAt: z.number().int().optional(),
  /** Zeile in der Quelldatei (für Fehlermeldungen) */
  line: z.number().int().positive().optional(),
});

work.post('/import/assets', async (c) => {
  requireRole(c, 'admin');
  const { rows, dryRun } = z.object({ rows: z.array(importRow).min(1).max(1000), dryRun: z.boolean().default(true) }).parse(await c.req.json());
  const t = now();
  const lower = (s: string) => s.trim().toLowerCase();

  const [props, builds, codes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM properties WHERE tenant_id = ? AND deleted_at IS NULL').bind(tid(c)),
    c.env.DB.prepare('SELECT b.id, b.name, b.property_id AS propertyId FROM buildings b WHERE b.tenant_id = ? AND b.deleted_at IS NULL').bind(tid(c)),
    // Codes bleiben auch nach dem Löschen belegt (UNIQUE), Etiketten werden beim Löschen frei
    c.env.DB.prepare("SELECT upper(code) AS code, upper(COALESCE(label_code, '')) AS label FROM assets WHERE tenant_id = ?").bind(tid(c)),
  ]);
  const propByName = new Map((props.results as { id: string; name: string }[]).map((p) => [lower(p.name), p.id]));
  const buildByKey = new Map((builds.results as { id: string; name: string; propertyId: string }[]).map((b) => [`${b.propertyId}|${lower(b.name)}`, b.id]));
  const usedCodes = new Set((codes.results as { code: string; label: string }[]).flatMap((r) => [r.code, r.label].filter(Boolean)));

  const newProps: { id: string; name: string }[] = [];
  const newBuilds: { id: string; pid: string; name: string }[] = [];
  const newAssets: Record<string, unknown>[] = [];
  const results: { line: number; status: 'ok' | 'error'; code?: string; message?: string }[] = [];
  const kinds = new Map<Category, { prefix: string; interval: number } | null>();

  for (const [i, r] of rows.entries()) {
    const line = r.line ?? i + 2;
    if (!kinds.has(r.category)) {
      const def = await getCategoryDef(c, r.category).catch(() => null);
      kinds.set(r.category, def && { prefix: def.prefix, interval: (await getSchedule(c, r.category)).intervalMonths });
    }
    const kind = kinds.get(r.category);
    if (!kind) {
      results.push({ line, status: 'error', message: `Unbekannte Art „${r.category}“` });
      continue;
    }
    const code = r.code?.toUpperCase();
    const label = r.labelCode?.toUpperCase();
    if (code && usedCodes.has(code)) {
      results.push({ line, status: 'error', message: `Code ${code} existiert bereits` });
      continue;
    }
    if (label && usedCodes.has(label)) {
      results.push({ line, status: 'error', message: `Etikett ${label} ist bereits vergeben` });
      continue;
    }
    let pid = propByName.get(lower(r.property));
    if (!pid) {
      pid = id();
      propByName.set(lower(r.property), pid);
      newProps.push({ id: pid, name: r.property });
    }
    const bKey = `${pid}|${lower(r.building)}`;
    let bid = buildByKey.get(bKey);
    if (!bid) {
      bid = id();
      buildByKey.set(bKey, bid);
      newBuilds.push({ id: bid, pid, name: r.building });
    }
    let finalCode = code;
    while (!finalCode || usedCodes.has(finalCode)) finalCode = `${kind.prefix}-${randomCode(4)}`;
    usedCodes.add(finalCode);
    if (label) usedCodes.add(label);
    const next = r.lastInspectedAt ? addMonths(r.lastInspectedAt, kind.interval) : null;
    const attrs = r.year ? { [r.category === 'smoke_alarm' ? 'manufactured' : 'year']: r.category === 'smoke_alarm' ? `${r.year}-01-01` : r.year } : {};
    newAssets.push({
      id: id(), bid, category: r.category, code: finalCode, label: label ?? null, location: r.location, floor: r.floor, manufacturer: r.manufacturer, model: r.model,
      attributes: JSON.stringify(attrs), last: r.lastInspectedAt ?? null, next,
      // Übernommene letzte Prüfung als Ausgangsstand (bleibt bei Neuberechnung erhalten)
      schedules: JSON.stringify({ main: r.lastInspectedAt ? { enabled: true, lastAt: r.lastInspectedAt, nextDueAt: next, baseline: { lastAt: r.lastInspectedAt, nextDueAt: next } } : { enabled: true } }),
    });
    results.push({ line, status: 'ok', code: finalCode });
  }

  const summary = {
    created: newAssets.length,
    failed: results.filter((r) => r.status === 'error').length,
    newProperties: newProps.length,
    newBuildings: newBuilds.length,
  };
  if (!dryRun && newAssets.length) {
    // Drei Statements in einem Batch: atomar und unabhängig von der Zeilenzahl (D1-Grenzen je Aufruf)
    const j = (k: string) => `json_extract(value, '$.${k}')`;
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO properties (id, tenant_id, name, created_at, updated_at) SELECT ${j('id')}, ?1, ${j('name')}, ?2, ?2 FROM json_each(?3)`).bind(tid(c), t, JSON.stringify(newProps)),
      c.env.DB.prepare(
        `INSERT INTO buildings (id, tenant_id, property_id, name, created_at, updated_at) SELECT ${j('id')}, ?1, ${j('pid')}, ${j('name')}, ?2, ?2 FROM json_each(?3)`,
      ).bind(tid(c), t, JSON.stringify(newBuilds)),
      c.env.DB.prepare(
        `INSERT INTO assets (id, tenant_id, building_id, category, code, label_code, location, floor, manufacturer, model, attributes, last_inspected_at, next_due_at, schedules, created_at, updated_at)
         SELECT ${['id', 'bid', 'category', 'code', 'label', 'location', 'floor', 'manufacturer', 'model', 'attributes', 'last', 'next', 'schedules'].map((k, n) => (n === 0 ? j(k) + ', ?1' : j(k))).join(', ')}, ?2, ?2 FROM json_each(?3)`,
      ).bind(tid(c), t, JSON.stringify(newAssets)),
    ]);
    await logActivity(c, 'import', 'asset', null, `${summary.created} Elemente importiert`);
  }
  return c.json({ dryRun, summary, results });
});

// ---------- Öffentlicher Aufgaben-Link (ohne Login) ----------
export const publicApi = new Hono<AppEnv>();

async function taskByToken(c: Ctx) {
  const tok = c.req.param('token') ?? '';
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  if (tok.length < 20) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Aufgabe');
  }
  const r = await c.env.DB.prepare(
    `SELECT t.id, t.tenant_id AS tenantId, t.assignee_id AS assigneeId, t.created_by AS createdBy, t.title, t.description, t.status, t.priority, t.due_at AS dueAt, t.defect_id AS defectId,
            t.external_note AS externalNote, t.external_done_at AS externalDoneAt,
            te.name AS tenantName, s.company AS subcontractorName,
            a.code AS assetCode, a.category, a.location, a.floor, b.name AS buildingName,
            COALESCE(p1.name, p2.name, p3.name) AS propertyName, COALESCE(p1.address, p2.address, p3.address) AS propertyAddress,
            d.title AS defectTitle, d.severity AS defectSeverity, d.note AS defectNote, d.measure AS defectMeasure, d.photo_key AS photoKey, d.legal_basis AS legalBasis
       FROM tasks t JOIN tenants te ON te.id = t.tenant_id LEFT JOIN subcontractors s ON s.id = t.subcontractor_id
       LEFT JOIN assets a ON a.id = t.asset_id LEFT JOIN buildings b ON b.id = a.building_id LEFT JOIN properties p1 ON p1.id = b.property_id
       LEFT JOIN defects d ON d.id = t.defect_id LEFT JOIN properties p2 ON p2.id = d.property_id LEFT JOIN properties p3 ON p3.id = t.property_id
      WHERE t.share_token = ?`,
  )
    .bind(tok)
    .first<Record<string, unknown>>();
  if (!r) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Aufgabe');
  }
  return r;
}

publicApi.get('/tasks/:token', async (c) => {
  const r = await taskByToken(c);
  const { tenantId: _t, id: _i, defectId: _d, assigneeId: _a, createdBy: _cb, ...rest } = r;
  return c.json({ ...rest, hasPhoto: !!r.photoKey, photoKey: undefined });
});

publicApi.get('/tasks/:token/photo', async (c) => {
  const r = await taskByToken(c);
  if (!r.photoKey || !String(r.photoKey).startsWith(`${r.tenantId}/`)) notFound('Foto');
  const obj = await c.env.FILES.get(r.photoKey as string);
  if (!obj) notFound('Foto');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
});

publicApi.post('/tasks/:token', async (c) => {
  const r = await taskByToken(c);
  const b = z.object({ status: z.enum(['in_progress', 'done']), note: str(2000).default('') }).parse(await c.req.json());
  if (r.status === 'done' || r.status === 'cancelled') throw new HTTPException(409, { message: 'Aufgabe ist bereits abgeschlossen' });
  const t = now();
  const who = (r.subcontractorName as string | null) ?? 'Subunternehmer';
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE tasks SET status=?, external_note=?, external_done_at=?, updated_at=?, first_response_at = COALESCE(first_response_at, ?),
              closed_at = CASE WHEN ? = 'done' THEN ? ELSE closed_at END WHERE id=?`,
    ).bind(b.status, b.note, b.status === 'done' ? t : null, t, t, b.status, t, r.id),
    ...(b.note
      ? [c.env.DB.prepare('INSERT INTO task_comments (id, tenant_id, task_id, user_id, author_name, body, created_at) VALUES (?,?,?,?,?,?,?)').bind(id(), r.tenantId, r.id, null, `${who} (extern)`, b.note, t)]
      : []),
  ]);
  if (b.status === 'done' && r.defectId) {
    await c.env.DB.prepare("UPDATE defects SET status='resolved', resolved_at=? WHERE id=? AND status='open'").bind(t, r.defectId).run();
  }
  await c.env.DB.prepare('INSERT INTO activity (id, tenant_id, user_id, action, entity, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id(), r.tenantId, null, 'external', 'task', r.id, `${who}: „${r.title}“ ${b.status === 'done' ? 'erledigt' : 'in Arbeit'}`, t)
    .run();
  await notifyTenant(
    c.env,
    r.tenantId as string,
    {
      userIds: [r.assigneeId, r.createdBy, ...(await watchersOf(c.env, r.tenantId as string, [r.id as string])).map((w) => w.userId)].filter((x): x is string => typeof x === 'string'),
      roles: ['owner', 'admin'],
      type: 'task_external',
      title: `${who}: ${b.status === 'done' ? 'erledigt' : 'in Arbeit'}`,
      body: `„${r.title}“${b.note ? ` – ${b.note.slice(0, 140)}` : ''}`,
      link: `/aufgaben?id=${r.id}`,
    },
    c.executionCtx,
  );
  // Autopilot: wiederkehrende Aufgabe → Folgeaufgabe (ohne Sitzung im Namen des Systems)
  if (b.status === 'done') {
    const pending: Promise<unknown>[] = [];
    await afterTasksDone(systemCtx(c.env, r.tenantId as string, pending), [r.id as string]);
    if (pending.length) c.executionCtx.waitUntil(Promise.allSettled(pending));
  }
  return c.json({ ok: true });
});
