import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CATEGORIES, type Category } from '../shared/catalog';
import { addMonths } from '../shared/logic';
import { getTemplate, str, tid, uniqueCode } from './data';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, requireRole, token } from './lib';

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

// ---------- Aufgaben ----------
const taskBody = z.object({
  title: str(200).min(1, 'Titel fehlt'),
  description: str(5000).default(''),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).default('open'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueAt: z.number().int().nullable().default(null),
  assigneeId: z.string().nullable().default(null),
  subcontractorId: z.string().nullable().default(null),
  assetId: z.string().nullable().default(null),
  defectId: z.string().nullable().default(null),
  propertyId: z.string().nullable().default(null),
});
type TaskBody = z.infer<typeof taskBody>;

work.get('/tasks', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at AS dueAt, t.created_at AS createdAt, t.updated_at AS updatedAt,
            t.assignee_id AS assigneeId, u.name AS assigneeName, t.subcontractor_id AS subcontractorId, s.company AS subcontractorName,
            t.share_token AS shareToken, t.external_note AS externalNote, t.external_done_at AS externalDoneAt,
            t.asset_id AS assetId, a.code AS assetCode, t.defect_id AS defectId,
            COALESCE(t.property_id, d.property_id) AS propertyId, p.name AS propertyName
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN assets a ON a.id = t.asset_id
       LEFT JOIN subcontractors s ON s.id = t.subcontractor_id LEFT JOIN defects d ON d.id = t.defect_id
       LEFT JOIN properties p ON p.id = COALESCE(t.property_id, d.property_id)
      WHERE t.tenant_id = ? ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, COALESCE(t.due_at, 9e15), t.created_at DESC`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

async function checkRefs(c: Ctx, b: TaskBody) {
  const one = (sql: string, v: string) => c.env.DB.prepare(sql).bind(tid(c), v).first();
  if (b.assigneeId && !(await one('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?', b.assigneeId)))
    throw new HTTPException(400, { message: 'Zuständige Person ist kein Mitglied' });
  if (b.subcontractorId && !(await one('SELECT 1 FROM subcontractors WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL', b.subcontractorId)))
    throw new HTTPException(400, { message: 'Subunternehmer nicht gefunden' });
  if (b.assetId && !(await one('SELECT 1 FROM assets WHERE tenant_id = ? AND id = ?', b.assetId))) throw new HTTPException(400, { message: 'Element nicht gefunden' });
  if (b.defectId && !(await one('SELECT 1 FROM defects WHERE tenant_id = ? AND id = ?', b.defectId))) throw new HTTPException(400, { message: 'Mangel nicht gefunden' });
  if (b.propertyId && !(await one('SELECT 1 FROM properties WHERE tenant_id = ? AND id = ?', b.propertyId)))
    throw new HTTPException(400, { message: 'Objekt nicht gefunden' });
}

work.post('/tasks', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkRefs(c, b);
  const tk = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, status, priority, due_at, assignee_id, subcontractor_id, asset_id, defect_id, property_id, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(tk, tid(c), b.title, b.description, b.status, b.priority, b.dueAt, b.assigneeId, b.subcontractorId, b.assetId, b.defectId, b.propertyId, c.get('user').userId, t, t)
    .run();
  await logActivity(c, 'create', 'task', tk, `Aufgabe „${b.title}“ angelegt`);
  return c.json({ id: tk });
});

async function resolveLinkedDefect(c: Ctx, defectId: string | null, by: string | null) {
  if (!defectId) return;
  await c.env.DB.prepare("UPDATE defects SET status='resolved', resolved_at=?, resolved_by=? WHERE id=? AND tenant_id=? AND status='open'")
    .bind(now(), by, defectId, tid(c))
    .run();
}

work.patch('/tasks/:id', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkRefs(c, b);
  const r = await c.env.DB.prepare(
    `UPDATE tasks SET title=?, description=?, status=?, priority=?, due_at=?, assignee_id=?, subcontractor_id=?, asset_id=?, defect_id=?, property_id=?, updated_at=?,
            share_token = CASE WHEN ? IS NULL THEN NULL ELSE share_token END
      WHERE id=? AND tenant_id=?`,
  )
    .bind(b.title, b.description, b.status, b.priority, b.dueAt, b.assigneeId, b.subcontractorId, b.assetId, b.defectId, b.propertyId, now(), b.subcontractorId, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Aufgabe');
  if (b.status === 'done') await resolveLinkedDefect(c, b.defectId, c.get('user').userId);
  return c.json({ ok: true });
});

work.delete('/tasks/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM tasks WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});

/** Externen Link für Subunternehmer erzeugen. */
work.post('/tasks/:id/share', async (c) => {
  requireRole(c, 'inspector');
  const t = await c.env.DB.prepare('SELECT subcontractor_id, share_token FROM tasks WHERE id=? AND tenant_id=?')
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
  await c.env.DB.prepare('UPDATE tasks SET share_token=NULL WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});

// ---------- Import ----------
const importRow = z.object({
  property: str(160).min(1),
  building: str(160).min(1),
  category: z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]),
  code: str(40).optional(),
  labelCode: str(60).optional(),
  location: str(200).default(''),
  floor: str(60).default(''),
  manufacturer: str(120).default(''),
  model: str(120).default(''),
  year: z.number().int().min(1900).max(2100).optional(),
  lastInspectedAt: z.number().int().optional(),
});

work.post('/import/assets', async (c) => {
  requireRole(c, 'admin');
  const { rows, dryRun } = z.object({ rows: z.array(importRow).min(1).max(1000), dryRun: z.boolean().default(true) }).parse(await c.req.json());
  const t = now();
  const lower = (s: string) => s.trim().toLowerCase();

  const [props, builds, codes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM properties WHERE tenant_id = ? AND deleted_at IS NULL').bind(tid(c)),
    c.env.DB.prepare(
      'SELECT b.id, b.name, b.property_id AS propertyId FROM buildings b WHERE b.tenant_id = ? AND b.deleted_at IS NULL',
    ).bind(tid(c)),
    c.env.DB.prepare('SELECT upper(code) AS code, upper(COALESCE(label_code, \'\')) AS label FROM assets WHERE tenant_id = ? AND deleted_at IS NULL').bind(tid(c)),
  ]);
  const propByName = new Map((props.results as { id: string; name: string }[]).map((p) => [lower(p.name), p.id]));
  const buildByKey = new Map((builds.results as { id: string; name: string; propertyId: string }[]).map((b) => [`${b.propertyId}|${lower(b.name)}`, b.id]));
  const usedCodes = new Set((codes.results as { code: string; label: string }[]).flatMap((r) => [r.code, r.label].filter(Boolean)));

  const stmts: D1PreparedStatement[] = [];
  const newProps = new Map<string, string>();
  const newBuilds = new Map<string, string>();
  const results: { line: number; status: 'ok' | 'error'; code?: string; message?: string }[] = [];
  const intervals = new Map<Category, number>();

  for (const [i, r] of rows.entries()) {
    const line = i + 2;
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
    let pid = propByName.get(lower(r.property)) ?? newProps.get(lower(r.property));
    if (!pid) {
      pid = id();
      newProps.set(lower(r.property), pid);
      stmts.push(
        c.env.DB.prepare('INSERT INTO properties (id, tenant_id, name, created_at, updated_at) VALUES (?,?,?,?,?)').bind(pid, tid(c), r.property, t, t),
      );
    }
    const bKey = `${pid}|${lower(r.building)}`;
    let bid = buildByKey.get(bKey) ?? newBuilds.get(bKey);
    if (!bid) {
      bid = id();
      newBuilds.set(bKey, bid);
      stmts.push(
        c.env.DB.prepare('INSERT INTO buildings (id, tenant_id, property_id, name, created_at, updated_at) VALUES (?,?,?,?,?,?)').bind(bid, tid(c), pid, r.building, t, t),
      );
    }
    const finalCode = code ?? (await uniqueCode(c, r.category, usedCodes));
    usedCodes.add(finalCode);
    if (label) usedCodes.add(label);
    if (!intervals.has(r.category)) intervals.set(r.category, (await getTemplate(c, r.category)).intervalMonths);
    const next = r.lastInspectedAt ? addMonths(r.lastInspectedAt, intervals.get(r.category)!) : null;
    const attrs = r.year ? { [r.category === 'smoke_alarm' ? 'manufactured' : 'year']: r.category === 'smoke_alarm' ? `${r.year}-01-01` : r.year } : {};
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO assets (id, tenant_id, building_id, category, code, label_code, location, floor, manufacturer, model, attributes, last_inspected_at, next_due_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id(), tid(c), bid, r.category, finalCode, label ?? null, r.location, r.floor, r.manufacturer, r.model, JSON.stringify(attrs), r.lastInspectedAt ?? null, next, t, t),
    );
    results.push({ line, status: 'ok', code: finalCode });
  }

  const summary = {
    created: results.filter((r) => r.status === 'ok').length,
    failed: results.filter((r) => r.status === 'error').length,
    newProperties: newProps.size,
    newBuildings: newBuilds.size,
  };
  if (!dryRun && stmts.length) {
    for (let i = 0; i < stmts.length; i += 200) await c.env.DB.batch(stmts.slice(i, i + 200));
    await logActivity(c, 'import', 'asset', null, `${summary.created} Elemente importiert`);
  }
  return c.json({ dryRun, summary, results });
});

// ---------- Öffentlicher Aufgaben-Link (ohne Login) ----------
export const publicApi = new Hono<AppEnv>();

async function taskByToken(c: Ctx) {
  const tok = c.req.param('token') ?? '';
  if (tok.length < 20) notFound('Aufgabe');
  const r = await c.env.DB.prepare(
    `SELECT t.id, t.tenant_id AS tenantId, t.title, t.description, t.status, t.priority, t.due_at AS dueAt, t.defect_id AS defectId,
            t.external_note AS externalNote, t.external_done_at AS externalDoneAt,
            te.name AS tenantName, s.company AS subcontractorName,
            a.code AS assetCode, a.category, a.location, a.floor, b.name AS buildingName,
            COALESCE(p1.name, p2.name, p3.name) AS propertyName, COALESCE(p1.address, p2.address, p3.address) AS propertyAddress,
            d.title AS defectTitle, d.severity AS defectSeverity, d.note AS defectNote, d.photo_key AS photoKey, d.legal_basis AS legalBasis
       FROM tasks t JOIN tenants te ON te.id = t.tenant_id LEFT JOIN subcontractors s ON s.id = t.subcontractor_id
       LEFT JOIN assets a ON a.id = t.asset_id LEFT JOIN buildings b ON b.id = a.building_id LEFT JOIN properties p1 ON p1.id = b.property_id
       LEFT JOIN defects d ON d.id = t.defect_id LEFT JOIN properties p2 ON p2.id = d.property_id LEFT JOIN properties p3 ON p3.id = t.property_id
      WHERE t.share_token = ?`,
  )
    .bind(tok)
    .first<Record<string, unknown>>();
  if (!r) notFound('Aufgabe');
  return r;
}

publicApi.get('/tasks/:token', async (c) => {
  const r = await taskByToken(c);
  const { tenantId: _t, id: _i, defectId: _d, ...rest } = r;
  return c.json({ ...rest, hasPhoto: !!r.photoKey, photoKey: undefined });
});

publicApi.get('/tasks/:token/photo', async (c) => {
  const r = await taskByToken(c);
  if (!r.photoKey) notFound('Foto');
  const obj = await c.env.FILES.get(r.photoKey as string);
  if (!obj) notFound('Foto');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'private, max-age=3600' } });
});

publicApi.post('/tasks/:token', async (c) => {
  const r = await taskByToken(c);
  const b = z.object({ status: z.enum(['in_progress', 'done']), note: str(2000).default('') }).parse(await c.req.json());
  if (r.status === 'done' || r.status === 'cancelled') throw new HTTPException(409, { message: 'Aufgabe ist bereits abgeschlossen' });
  const t = now();
  await c.env.DB.prepare('UPDATE tasks SET status=?, external_note=?, external_done_at=?, updated_at=? WHERE id=?')
    .bind(b.status, b.note, b.status === 'done' ? t : null, t, r.id)
    .run();
  if (b.status === 'done' && r.defectId) {
    await c.env.DB.prepare("UPDATE defects SET status='resolved', resolved_at=? WHERE id=? AND status='open'").bind(t, r.defectId).run();
  }
  await c.env.DB.prepare('INSERT INTO activity (id, tenant_id, user_id, action, entity, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id(), r.tenantId, null, 'external', 'task', r.id, `${r.subcontractorName ?? 'Subunternehmer'}: „${r.title}“ ${b.status === 'done' ? 'erledigt' : 'in Arbeit'}`, t)
    .run();
  return c.json({ ok: true });
});
