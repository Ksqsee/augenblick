import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CATEGORIES, type Category, type Checkpoint, INSPECTION_KINDS, SEVERITIES } from '../shared/catalog';
import { type Answer, addMonths, computeResult, DAY, isComplete, SOON_WINDOW_DAYS } from '../shared/logic';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireAuth, requireRole } from './lib';

export const data = new Hono<AppEnv>();
data.use('*', requireAuth);

const tid = (c: Ctx) => c.get('user').tenantId;
const categoryEnum = z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]);
const str = (max = 500) => z.string().trim().max(max);

// ---------- Vorlagen ----------
async function getTemplate(c: Ctx, category: Category) {
  const def = CATEGORIES[category];
  const o = await c.env.DB.prepare('SELECT checkpoints, interval_months FROM template_overrides WHERE tenant_id = ? AND category = ?')
    .bind(tid(c), category)
    .first<{ checkpoints: string; interval_months: number }>();
  return {
    ...def,
    customized: !!o,
    intervalMonths: o?.interval_months ?? def.intervalMonths,
    checkpoints: o ? parseJson<Checkpoint[]>(o.checkpoints, def.checkpoints) : def.checkpoints,
  };
}

data.get('/templates', async (c) => {
  return c.json(await Promise.all((Object.keys(CATEGORIES) as Category[]).map((k) => getTemplate(c, k))));
});

data.put('/templates/:category', async (c) => {
  requireRole(c, 'admin');
  const category = categoryEnum.parse(c.req.param('category'));
  const body = z
    .object({
      intervalMonths: z.number().int().min(1).max(120),
      checkpoints: z.array(z.object({ id: str(40).min(1), label: str(300).min(2), hint: str(300).optional() })).min(1).max(100),
    })
    .parse(await c.req.json());
  await c.env.DB.prepare(
    `INSERT INTO template_overrides (tenant_id, category, checkpoints, interval_months, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT (tenant_id, category) DO UPDATE SET checkpoints = excluded.checkpoints, interval_months = excluded.interval_months, updated_at = excluded.updated_at`,
  )
    .bind(tid(c), category, JSON.stringify(body.checkpoints), body.intervalMonths, now())
    .run();
  await logActivity(c, 'update', 'template', category, `Prüfvorlage „${CATEGORIES[category].label}“ angepasst`);
  return c.json({ ok: true });
});

data.delete('/templates/:category', async (c) => {
  requireRole(c, 'admin');
  const category = categoryEnum.parse(c.req.param('category'));
  await c.env.DB.prepare('DELETE FROM template_overrides WHERE tenant_id = ? AND category = ?').bind(tid(c), category).run();
  return c.json({ ok: true });
});

// ---------- Dashboard ----------
data.get('/dashboard', async (c) => {
  const t = tid(c);
  const n = now();
  const soon = n + SOON_WINDOW_DAYS * DAY;
  const [counts, props, recent, tasks] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM properties WHERE tenant_id = ?1 AND deleted_at IS NULL) AS properties,
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL) AS assets,
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND next_due_at < ?2) AS overdue,
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND next_due_at BETWEEN ?2 AND ?3) AS soon,
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND next_due_at IS NULL) AS never,
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND last_result = 'not_inspectable') AS notInspectable,
         (SELECT COUNT(*) FROM defects WHERE tenant_id = ?1 AND status = 'open') AS openDefects,
         (SELECT COUNT(*) FROM defects WHERE tenant_id = ?1 AND status = 'open' AND severity = 'critical') AS criticalDefects,
         (SELECT COUNT(*) FROM inspections WHERE tenant_id = ?1 AND status = 'submitted' AND inspected_at > ?4) AS inspections30d,
         (SELECT COUNT(*) FROM inspections WHERE tenant_id = ?1 AND status = 'draft') AS drafts`,
    ).bind(t, n, soon, n - 30 * DAY),
    propertyStatusQuery(c, n, soon).bind(t, n, soon),
    c.env.DB.prepare(
      `SELECT i.id, i.result, i.inspected_at AS inspectedAt, a.code, a.category, a.location, u.name AS inspector
         FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN users u ON u.id = i.inspector_id
        WHERE i.tenant_id = ? AND i.status = 'submitted' ORDER BY i.inspected_at DESC LIMIT 8`,
    ).bind(t),
    c.env.DB.prepare(
      `SELECT id, title, priority, due_at AS dueAt, status FROM tasks
        WHERE tenant_id = ? AND status IN ('open','in_progress') ORDER BY COALESCE(due_at, 9e15), created_at LIMIT 6`,
    ).bind(t),
  ]);
  return c.json({ counts: counts.results[0], properties: props.results, recent: recent.results, tasks: tasks.results });
});

function propertyStatusQuery(c: Ctx, _n: number, _soon: number) {
  return c.env.DB.prepare(
    `SELECT p.id, p.name, p.address, p.contact_name AS contactName,
            COUNT(a.id) AS assets,
            SUM(CASE WHEN a.next_due_at < ?2 THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN a.next_due_at BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END) AS soon,
            SUM(CASE WHEN a.id IS NOT NULL AND a.next_due_at IS NULL THEN 1 ELSE 0 END) AS never,
            (SELECT COUNT(*) FROM defects d JOIN assets a2 ON a2.id = d.asset_id JOIN buildings b2 ON b2.id = a2.building_id
              WHERE b2.property_id = p.id AND d.status = 'open') AS openDefects,
            MAX(a.last_inspected_at) AS lastInspectedAt,
            MIN(a.next_due_at) AS nextDueAt
       FROM properties p
       LEFT JOIN buildings b ON b.property_id = p.id AND b.deleted_at IS NULL
       LEFT JOIN assets a ON a.building_id = b.id AND a.deleted_at IS NULL
      WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.name`,
  );
}

// ---------- Objekte ----------
const propertyBody = z.object({
  name: str(160).min(1, 'Name fehlt'),
  address: str(400).default(''),
  description: str(2000).default(''),
  contactName: str(160).default(''),
  contactPhone: str(60).default(''),
  contactEmail: z.union([z.literal(''), z.string().trim().email()]).default(''),
});

data.get('/properties', async (c) => {
  const n = now();
  const rows = await propertyStatusQuery(c, n, n + SOON_WINDOW_DAYS * DAY)
    .bind(tid(c), n, n + SOON_WINDOW_DAYS * DAY)
    .all();
  return c.json(rows.results);
});

data.post('/properties', async (c) => {
  requireRole(c, 'admin');
  const b = propertyBody.parse(await c.req.json());
  const pid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO properties (id, tenant_id, name, address, description, contact_name, contact_phone, contact_email, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(pid, tid(c), b.name, b.address, b.description, b.contactName, b.contactPhone, b.contactEmail, t, t)
    .run();
  await logActivity(c, 'create', 'property', pid, `Objekt „${b.name}“ angelegt`);
  return c.json({ id: pid });
});

data.get('/properties/:id', async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT id, name, address, description, contact_name AS contactName, contact_phone AS contactPhone, contact_email AS contactEmail, created_at AS createdAt
       FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('id'), tid(c))
    .first();
  if (!p) notFound('Objekt');
  const buildings = await c.env.DB.prepare(
    'SELECT id, name, address FROM buildings WHERE property_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY name',
  )
    .bind(p.id, tid(c))
    .all();
  const assets = await assetQuery(c, 'b.property_id = ?').bind(tid(c), p.id).all();
  return c.json({ ...p, buildings: buildings.results, assets: assets.results.map(mapAsset) });
});

data.patch('/properties/:id', async (c) => {
  requireRole(c, 'admin');
  const b = propertyBody.parse(await c.req.json());
  const r = await c.env.DB.prepare(
    `UPDATE properties SET name=?, address=?, description=?, contact_name=?, contact_phone=?, contact_email=?, updated_at=?
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
  )
    .bind(b.name, b.address, b.description, b.contactName, b.contactPhone, b.contactEmail, now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Objekt');
  return c.json({ ok: true });
});

data.delete('/properties/:id', async (c) => {
  requireRole(c, 'admin');
  const t = now();
  const pid = c.req.param('id');
  const r = await c.env.DB.prepare('UPDATE properties SET deleted_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(t, pid, tid(c))
    .run();
  if (!r.meta.changes) notFound('Objekt');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE assets SET deleted_at = ? WHERE tenant_id = ? AND deleted_at IS NULL AND building_id IN (SELECT id FROM buildings WHERE property_id = ?)',
    ).bind(t, tid(c), pid),
    c.env.DB.prepare('UPDATE buildings SET deleted_at = ? WHERE tenant_id = ? AND property_id = ? AND deleted_at IS NULL').bind(t, tid(c), pid),
  ]);
  await logActivity(c, 'delete', 'property', pid, 'Objekt gelöscht');
  return c.json({ ok: true });
});

// ---------- Gebäude ----------
const buildingBody = z.object({ name: str(160).min(1, 'Name fehlt'), address: str(400).default('') });

data.post('/properties/:id/buildings', async (c) => {
  requireRole(c, 'admin');
  const b = buildingBody.parse(await c.req.json());
  const p = await c.env.DB.prepare('SELECT id FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), tid(c))
    .first();
  if (!p) notFound('Objekt');
  const bid = id();
  const t = now();
  await c.env.DB.prepare('INSERT INTO buildings (id, tenant_id, property_id, name, address, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .bind(bid, tid(c), p.id, b.name, b.address, t, t)
    .run();
  await logActivity(c, 'create', 'building', bid, `Gebäude „${b.name}“ angelegt`);
  return c.json({ id: bid });
});

data.patch('/buildings/:id', async (c) => {
  requireRole(c, 'admin');
  const b = buildingBody.parse(await c.req.json());
  const r = await c.env.DB.prepare('UPDATE buildings SET name=?, address=?, updated_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(b.name, b.address, now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Gebäude');
  return c.json({ ok: true });
});

data.delete('/buildings/:id', async (c) => {
  requireRole(c, 'admin');
  const t = now();
  const r = await c.env.DB.prepare('UPDATE buildings SET deleted_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(t, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Gebäude');
  await c.env.DB.prepare('UPDATE assets SET deleted_at=? WHERE building_id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(t, c.req.param('id'), tid(c))
    .run();
  return c.json({ ok: true });
});

// ---------- Elemente ----------
function assetQuery(c: Ctx, where = '1=1', order = 'a.code') {
  return c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes,
            a.last_inspection_id AS lastInspectionId, a.last_inspected_at AS lastInspectedAt, a.last_result AS lastResult,
            a.next_due_at AS nextDueAt, a.created_at AS createdAt,
            b.id AS buildingId, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            (SELECT COUNT(*) FROM defects d WHERE d.asset_id = a.id AND d.status = 'open') AS openDefects
       FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
      WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND ${where}
      ORDER BY ${order}`,
  );
}
const mapAsset = (r: Record<string, unknown>) => ({ ...r, attributes: parseJson(r.attributes as string, {}) });

data.get('/assets', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [tid(c)];
  const n = now();
  if (q.category && q.category in CATEGORIES) {
    args.push(q.category);
    where.push(`a.category = ?${args.length}`);
  }
  if (q.buildingId) {
    args.push(q.buildingId);
    where.push(`a.building_id = ?${args.length}`);
  }
  if (q.q) {
    args.push(`%${q.q.toLowerCase()}%`);
    const i = args.length;
    where.push(`(lower(a.code) LIKE ?${i} OR lower(a.location) LIKE ?${i} OR lower(a.manufacturer) LIKE ?${i} OR lower(b.name) LIKE ?${i} OR lower(p.name) LIKE ?${i})`);
  }
  if (q.due === 'overdue') where.push(`a.next_due_at < ${n}`);
  if (q.due === 'soon') where.push(`a.next_due_at BETWEEN ${n} AND ${n + SOON_WINDOW_DAYS * DAY}`);
  if (q.due === 'never') where.push('a.next_due_at IS NULL');
  if (q.due === 'not_inspectable') where.push(`a.last_result = 'not_inspectable'`);
  if (q.due === 'defects') where.push(`EXISTS (SELECT 1 FROM defects d WHERE d.asset_id = a.id AND d.status = 'open')`);
  const order = q.due ? 'COALESCE(a.next_due_at, 0), a.code' : 'p.name, b.name, a.code';
  const rows = await assetQuery(c, where.join(' AND ') || '1=1', order)
    .bind(...args)
    .all();
  return c.json(rows.results.map(mapAsset));
});

const assetBody = z.object({
  buildingId: z.string().min(1),
  category: categoryEnum,
  location: str(200).default(''),
  floor: str(60).default(''),
  manufacturer: str(120).default(''),
  model: str(120).default(''),
  attributes: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
  code: str(40).optional(),
});

async function uniqueCode(c: Ctx, category: Category) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 8; i++) {
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % alphabet.length]).join('');
    const code = `${CATEGORIES[category].prefix}-${rnd}`;
    const hit = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ? AND code = ?').bind(tid(c), code).first();
    if (!hit) return code;
  }
  throw new HTTPException(500, { message: 'Kein freier Code gefunden' });
}

data.post('/assets', async (c) => {
  requireRole(c, 'inspector');
  const b = assetBody.parse(await c.req.json());
  const building = await c.env.DB.prepare('SELECT id FROM buildings WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(b.buildingId, tid(c))
    .first();
  if (!building) notFound('Gebäude');
  const code = b.code?.toUpperCase() || (await uniqueCode(c, b.category));
  const dup = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ? AND code = ?').bind(tid(c), code).first();
  if (dup) throw new HTTPException(409, { message: `Code ${code} ist bereits vergeben` });
  const aid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO assets (id, tenant_id, building_id, category, code, location, floor, manufacturer, model, attributes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(aid, tid(c), b.buildingId, b.category, code, b.location, b.floor, b.manufacturer, b.model, JSON.stringify(b.attributes), t, t)
    .run();
  await logActivity(c, 'create', 'asset', aid, `${CATEGORIES[b.category].label} ${code} angelegt`);
  return c.json({ id: aid, code });
});

data.get('/assets/by-code/:code', async (c) => {
  const row = await c.env.DB.prepare('SELECT id FROM assets WHERE tenant_id = ? AND upper(code) = upper(?) AND deleted_at IS NULL')
    .bind(tid(c), c.req.param('code'))
    .first();
  if (!row) notFound('Element');
  return c.json(row);
});

data.get('/assets/:id', async (c) => {
  const a = await assetQuery(c, 'a.id = ?2').bind(tid(c), c.req.param('id')).first();
  if (!a) notFound('Element');
  const [inspections, defects] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT i.id, i.kind, i.status, i.result, i.inspected_at AS inspectedAt, i.created_at AS createdAt, u.name AS inspector
         FROM inspections i JOIN users u ON u.id = i.inspector_id WHERE i.asset_id = ? AND i.tenant_id = ? ORDER BY COALESCE(i.inspected_at, i.created_at) DESC`,
    ).bind(a.id, tid(c)),
    c.env.DB.prepare(
      `SELECT id, title, note, severity, status, created_at AS createdAt, resolved_at AS resolvedAt, inspection_id AS inspectionId
         FROM defects WHERE asset_id = ? AND tenant_id = ? ORDER BY status = 'open' DESC, created_at DESC`,
    ).bind(a.id, tid(c)),
  ]);
  return c.json({ ...mapAsset(a), inspections: inspections.results, defects: defects.results });
});

data.patch('/assets/:id', async (c) => {
  requireRole(c, 'inspector');
  const b = assetBody.omit({ category: true, code: true }).parse(await c.req.json());
  const building = await c.env.DB.prepare('SELECT id FROM buildings WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(b.buildingId, tid(c))
    .first();
  if (!building) notFound('Gebäude');
  const r = await c.env.DB.prepare(
    `UPDATE assets SET building_id=?, location=?, floor=?, manufacturer=?, model=?, attributes=?, updated_at=?
      WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
  )
    .bind(b.buildingId, b.location, b.floor, b.manufacturer, b.model, JSON.stringify(b.attributes), now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  return c.json({ ok: true });
});

data.delete('/assets/:id', async (c) => {
  requireRole(c, 'admin');
  const r = await c.env.DB.prepare('UPDATE assets SET deleted_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  await logActivity(c, 'delete', 'asset', c.req.param('id'), 'Element gelöscht');
  return c.json({ ok: true });
});

// ---------- Prüfungen ----------
const answerEnum = z.enum(['ok', 'defect', 'na']);
const defectInput = z.object({
  checkpointId: z.string().max(40).optional(),
  title: str(300).min(1),
  note: str(2000).default(''),
  severity: z.enum(Object.keys(SEVERITIES) as ['low', 'medium', 'high', 'critical']),
  photoKey: z.string().max(200).optional(),
});
const inspectionBody = z.object({
  kind: z.enum(Object.keys(INSPECTION_KINDS) as [keyof typeof INSPECTION_KINDS]),
  notInspectable: z.boolean().default(false),
  answers: z.record(answerEnum).default({}),
  maintenance: z.array(z.string().max(40)).default([]),
  defects: z.array(defectInput).max(100).default([]),
  notes: str(5000).default(''),
  signature: z.string().max(400_000).nullable().default(null),
  signerName: str(160).default(''),
});
type InspectionBody = z.infer<typeof inspectionBody>;

data.get('/inspections', async (c) => {
  const q = c.req.query();
  const args: unknown[] = [tid(c)];
  let where = '1=1';
  if (q.status === 'draft' || q.status === 'submitted') {
    args.push(q.status);
    where = `i.status = ?${args.length}`;
  }
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.kind, i.status, i.result, i.inspected_at AS inspectedAt, i.created_at AS createdAt, i.next_due_at AS nextDueAt,
            a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.name AS propertyName, u.name AS inspector
       FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id
       JOIN properties p ON p.id = b.property_id JOIN users u ON u.id = i.inspector_id
      WHERE i.tenant_id = ?1 AND ${where} ORDER BY COALESCE(i.inspected_at, i.created_at) DESC LIMIT 500`,
  )
    .bind(...args)
    .all();
  return c.json(rows.results);
});

data.post('/assets/:id/inspections', async (c) => {
  requireRole(c, 'inspector');
  const a = await c.env.DB.prepare('SELECT id, category FROM assets WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), tid(c))
    .first<{ id: string; category: Category }>();
  if (!a) notFound('Element');
  const existing = await c.env.DB.prepare(
    "SELECT id FROM inspections WHERE asset_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ?",
  )
    .bind(a.id, tid(c), c.get('user').userId)
    .first<{ id: string }>();
  if (existing) return c.json(existing);
  const tpl = await getTemplate(c, a.category);
  const iid = id();
  const t = now();
  const last = await c.env.DB.prepare("SELECT 1 FROM inspections WHERE asset_id = ? AND status = 'submitted' LIMIT 1").bind(a.id).first();
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, reason, status, answers, maintenance, checkpoints, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'draft','{}','{"items":[],"defects":[]}',?,?,?)`,
  )
    .bind(iid, tid(c), a.id, c.get('user').userId, last ? 'periodic' : 'initial', 'planned', JSON.stringify(tpl.checkpoints), t, t)
    .run();
  return c.json({ id: iid });
});

async function loadInspection(c: Ctx, iid: string) {
  const row = await c.env.DB.prepare(
    `SELECT i.*, u.name AS inspectorName, a.code, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes,
            b.name AS buildingName, b.address AS buildingAddress, p.name AS propertyName, p.address AS propertyAddress, t.name AS tenantName
       FROM inspections i JOIN users u ON u.id = i.inspector_id JOIN assets a ON a.id = i.asset_id
       JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = ? AND i.tenant_id = ?`,
  )
    .bind(iid, tid(c))
    .first<Record<string, unknown>>();
  if (!row) notFound('Prüfung');
  const extra = parseJson<{ items: string[]; defects: InspectionBody['defects']; notInspectable?: boolean }>(row.maintenance as string, {
    items: [],
    defects: [],
  });
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    status: row.status as 'draft' | 'submitted',
    kind: row.kind as string,
    result: row.result as string | null,
    answers: parseJson<Record<string, Answer>>(row.answers as string, {}),
    maintenance: extra.items,
    defects: extra.defects,
    notInspectable: !!extra.notInspectable,
    checkpoints: parseJson<Checkpoint[]>(row.checkpoints as string, []),
    notes: row.notes as string,
    signature: row.signature as string | null,
    signerName: row.signer_name as string,
    inspectorId: row.inspector_id as string,
    inspectorName: row.inspectorName as string,
    inspectedAt: row.inspected_at as number | null,
    nextDueAt: row.next_due_at as number | null,
    createdAt: row.created_at as number,
    asset: {
      code: row.code,
      category: row.category as Category,
      location: row.location,
      floor: row.floor,
      manufacturer: row.manufacturer,
      model: row.model,
      attributes: parseJson(row.attributes as string, {}),
      buildingName: row.buildingName,
      buildingAddress: row.buildingAddress,
      propertyName: row.propertyName,
      propertyAddress: row.propertyAddress,
    },
    tenantName: row.tenantName as string,
  };
}

data.get('/inspections/:id', async (c) => c.json(await loadInspection(c, c.req.param('id'))));

async function saveDraft(c: Ctx, iid: string, b: InspectionBody) {
  const insp = await loadInspection(c, iid);
  if (insp.status !== 'draft') throw new HTTPException(409, { message: 'Prüfung ist bereits abgeschlossen' });
  if (insp.inspectorId !== c.get('user').userId && !['admin', 'owner'].includes(c.get('user').role)) {
    throw new HTTPException(403, { message: 'Nur der Prüfer kann diesen Entwurf bearbeiten' });
  }
  await c.env.DB.prepare('UPDATE inspections SET kind=?, answers=?, maintenance=?, notes=?, signature=?, signer_name=?, updated_at=? WHERE id=?')
    .bind(
      b.kind,
      JSON.stringify(b.answers),
      JSON.stringify({ items: b.maintenance, defects: b.defects, notInspectable: b.notInspectable }),
      b.notes,
      b.signature,
      b.signerName,
      now(),
      iid,
    )
    .run();
  return insp;
}

data.put('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  await saveDraft(c, c.req.param('id'), inspectionBody.parse(await c.req.json()));
  return c.json({ ok: true });
});

data.post('/inspections/:id/submit', async (c) => {
  requireRole(c, 'inspector');
  const b = inspectionBody.parse(await c.req.json());
  const iid = c.req.param('id');
  const insp = await saveDraft(c, iid, b);
  if (!isComplete(insp.checkpoints.map((p) => p.id), b.answers, b.notInspectable)) {
    throw new HTTPException(400, { message: 'Bitte alle Prüfpunkte bewerten' });
  }
  if (!b.signature) throw new HTTPException(400, { message: 'Unterschrift fehlt' });
  const tpl = await getTemplate(c, insp.asset.category);
  const result = computeResult({ notInspectable: b.notInspectable, answers: b.answers, defects: b.defects });
  const t = now();
  // Nicht prüfbar: Termin bleibt, damit das Element weiter als fällig auftaucht.
  const nextDue = result === 'not_inspectable' ? null : addMonths(t, tpl.intervalMonths);
  const stmts = [
    c.env.DB.prepare("UPDATE inspections SET status='submitted', result=?, inspected_at=?, next_due_at=?, updated_at=? WHERE id=?").bind(
      result,
      t,
      nextDue,
      t,
      iid,
    ),
    nextDue
      ? c.env.DB.prepare('UPDATE assets SET last_inspection_id=?, last_inspected_at=?, last_result=?, next_due_at=?, updated_at=? WHERE id=?').bind(
          iid,
          t,
          result,
          nextDue,
          t,
          insp.assetId,
        )
      : c.env.DB.prepare('UPDATE assets SET last_inspection_id=?, last_inspected_at=?, last_result=?, updated_at=? WHERE id=?').bind(
          iid,
          t,
          result,
          t,
          insp.assetId,
        ),
    ...b.defects.map((d) =>
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, asset_id, inspection_id, checkpoint_id, title, note, severity, status, photo_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,'open',?,?)`,
      ).bind(id(), tid(c), insp.assetId, iid, d.checkpointId ?? null, d.title, d.note, d.severity, d.photoKey ?? null, t),
    ),
  ];
  await c.env.DB.batch(stmts);
  await logActivity(c, 'submit', 'inspection', iid, `Prüfung ${insp.asset.code} abgeschlossen`);
  return c.json({ ok: true, result, nextDueAt: nextDue });
});

data.delete('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  const r = await c.env.DB.prepare("DELETE FROM inspections WHERE id = ? AND tenant_id = ? AND status = 'draft'")
    .bind(c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) throw new HTTPException(409, { message: 'Nur Entwürfe können verworfen werden' });
  return c.json({ ok: true });
});

// ---------- Mängel ----------
data.get('/defects', async (c) => {
  const status = c.req.query('status') === 'resolved' ? 'resolved' : c.req.query('status') === 'all' ? null : 'open';
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.note, d.severity, d.status, d.created_at AS createdAt, d.resolved_at AS resolvedAt, d.inspection_id AS inspectionId,
            d.photo_key AS photoKey, a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            (SELECT t.id FROM tasks t WHERE t.defect_id = d.id LIMIT 1) AS taskId
       FROM defects d JOIN assets a ON a.id = d.asset_id JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
      WHERE d.tenant_id = ?1 AND (?2 IS NULL OR d.status = ?2) AND a.deleted_at IS NULL
      ORDER BY CASE d.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, d.created_at DESC`,
  )
    .bind(tid(c), status)
    .all();
  return c.json(rows.results);
});

data.patch('/defects/:id', async (c) => {
  requireRole(c, 'inspector');
  const { status } = z.object({ status: z.enum(['open', 'resolved']) }).parse(await c.req.json());
  const t = now();
  const r = await c.env.DB.prepare('UPDATE defects SET status=?, resolved_at=?, resolved_by=? WHERE id=? AND tenant_id=?')
    .bind(status, status === 'resolved' ? t : null, status === 'resolved' ? c.get('user').userId : null, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Mangel');
  await logActivity(c, status === 'resolved' ? 'resolve' : 'reopen', 'defect', c.req.param('id'), status === 'resolved' ? 'Mangel behoben' : 'Mangel wieder geöffnet');
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
  assetId: z.string().nullable().default(null),
  defectId: z.string().nullable().default(null),
});

data.get('/tasks', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_at AS dueAt, t.created_at AS createdAt, t.updated_at AS updatedAt,
            t.assignee_id AS assigneeId, u.name AS assigneeName, t.asset_id AS assetId, a.code AS assetCode, t.defect_id AS defectId
       FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id LEFT JOIN assets a ON a.id = t.asset_id
      WHERE t.tenant_id = ? ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, COALESCE(t.due_at, 9e15), t.created_at DESC`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

async function checkTaskRefs(c: Ctx, b: z.infer<typeof taskBody>) {
  if (b.assigneeId) {
    const m = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tid(c), b.assigneeId).first();
    if (!m) throw new HTTPException(400, { message: 'Zuständige Person ist kein Mitglied' });
  }
  if (b.assetId) {
    const a = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ? AND id = ?').bind(tid(c), b.assetId).first();
    if (!a) throw new HTTPException(400, { message: 'Element nicht gefunden' });
  }
  if (b.defectId) {
    const d = await c.env.DB.prepare('SELECT 1 FROM defects WHERE tenant_id = ? AND id = ?').bind(tid(c), b.defectId).first();
    if (!d) throw new HTTPException(400, { message: 'Mangel nicht gefunden' });
  }
}

data.post('/tasks', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkTaskRefs(c, b);
  const tk = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, status, priority, due_at, assignee_id, asset_id, defect_id, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(tk, tid(c), b.title, b.description, b.status, b.priority, b.dueAt, b.assigneeId, b.assetId, b.defectId, c.get('user').userId, t, t)
    .run();
  await logActivity(c, 'create', 'task', tk, `Aufgabe „${b.title}“ angelegt`);
  return c.json({ id: tk });
});

data.patch('/tasks/:id', async (c) => {
  requireRole(c, 'inspector');
  const b = taskBody.parse(await c.req.json());
  await checkTaskRefs(c, b);
  const r = await c.env.DB.prepare(
    'UPDATE tasks SET title=?, description=?, status=?, priority=?, due_at=?, assignee_id=?, asset_id=?, defect_id=?, updated_at=? WHERE id=? AND tenant_id=?',
  )
    .bind(b.title, b.description, b.status, b.priority, b.dueAt, b.assigneeId, b.assetId, b.defectId, now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Aufgabe');
  if (b.status === 'done' && b.defectId) {
    await c.env.DB.prepare("UPDATE defects SET status='resolved', resolved_at=?, resolved_by=? WHERE id=? AND tenant_id=? AND status='open'")
      .bind(now(), c.get('user').userId, b.defectId, tid(c))
      .run();
  }
  return c.json({ ok: true });
});

data.delete('/tasks/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM tasks WHERE id=? AND tenant_id=?').bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});

// ---------- Dateien (Fotos) ----------
const MAX_UPLOAD = 8 * 1024 * 1024;

data.post('/files', async (c) => {
  requireRole(c, 'inspector');
  const type = c.req.header('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HTTPException(415, { message: 'Nur JPEG, PNG oder WebP' });
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD) throw new HTTPException(413, { message: 'Datei zu groß (max. 8 MB)' });
  const key = `${tid(c)}/${id(24)}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key });
});

data.get('/files/:tenant/:name', async (c) => {
  if (c.req.param('tenant') !== tid(c)) notFound('Datei');
  const obj = await c.env.FILES.get(`${c.req.param('tenant')}/${c.req.param('name')}`);
  if (!obj) notFound('Datei');
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' },
  });
});

// ---------- Export ----------
data.get('/export/assets.csv', async (c) => {
  const rows = (await assetQuery(c, '1=1', 'p.name, b.name, a.code').bind(tid(c)).all()).results;
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const date = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : '');
  const head = ['Code', 'Kategorie', 'Objekt', 'Gebäude', 'Standort', 'Etage', 'Hersteller', 'Modell', 'Letzte Prüfung', 'Ergebnis', 'Nächste Prüfung', 'Offene Mängel'];
  const lines = rows.map((r) =>
    [
      r.code,
      CATEGORIES[r.category as Category]?.label ?? r.category,
      r.propertyName,
      r.buildingName,
      r.location,
      r.floor,
      r.manufacturer,
      r.model,
      date(r.lastInspectedAt),
      r.lastResult ?? '',
      date(r.nextDueAt),
      r.openDefects,
    ]
      .map(esc)
      .join(';'),
  );
  return new Response('﻿' + [head.join(';'), ...lines].join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="elemente.csv"' },
  });
});
