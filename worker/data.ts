import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Category, SEVERITIES } from '../shared/catalog';
import { DAY, SOON_WINDOW_DAYS } from '../shared/logic';
import { BUILDING_TYPES } from '../shared/walkthrough';
import { type DocLanguage, tr } from '../shared/i18n';
import { buildXlsx } from '../shared/xlsx';
import { getCategoryDef, listCategories } from './categories';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireRole } from './lib';

export const data = new Hono<AppEnv>();

export const tid = (c: Ctx) => c.get('user').tenantId;
export const str = (max = 500) => z.string().trim().max(max);
const buildingTypeEnum = z.enum(Object.keys(BUILDING_TYPES) as [keyof typeof BUILDING_TYPES]);
export const severityEnum = z.enum(Object.keys(SEVERITIES) as ['low', 'medium', 'high', 'critical']);

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
         (SELECT COUNT(*) FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND created_at > ?4) AS newAssets,
         (SELECT COUNT(*) FROM defects WHERE tenant_id = ?1 AND status = 'open' AND asset_id IS NOT NULL) AS openDefects,
         (SELECT COUNT(*) FROM defects WHERE tenant_id = ?1 AND status = 'open' AND walkthrough_id IS NOT NULL) AS openWalkDefects,
         (SELECT COUNT(*) FROM defects WHERE tenant_id = ?1 AND status = 'open' AND severity = 'critical') AS criticalDefects,
         (SELECT COUNT(*) FROM inspections WHERE tenant_id = ?1 AND status = 'submitted' AND superseded_at IS NULL AND inspected_at > ?4) AS inspections30d,
         (SELECT COUNT(*) FROM inspections WHERE tenant_id = ?1 AND status = 'draft') AS drafts,
         (SELECT COUNT(*) FROM properties p WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND COALESCE(
            (SELECT MAX(w.next_due_at) FROM walkthroughs w WHERE w.property_id = p.id AND w.status = 'submitted'), 0) < ?3) AS walkDue`,
    ).bind(t, n, soon, n - 30 * DAY),
    propertyStatusQuery(c).bind(t, n, soon),
    c.env.DB.prepare(
      `SELECT i.id, i.result, i.inspected_at AS inspectedAt, a.code, a.category, a.location, u.name AS inspector
         FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN users u ON u.id = i.inspector_id
        WHERE i.tenant_id = ? AND i.status = 'submitted' AND i.superseded_at IS NULL ORDER BY i.inspected_at DESC LIMIT 8`,
    ).bind(t),
    c.env.DB.prepare(
      `SELECT id, title, priority, due_at AS dueAt, status FROM tasks
        WHERE tenant_id = ? AND status IN ('open','in_progress') ORDER BY COALESCE(due_at, 9e15), created_at LIMIT 6`,
    ).bind(t),
  ]);
  return c.json({ counts: counts.results[0], properties: props.results, recent: recent.results, tasks: tasks.results });
});

function propertyStatusQuery(c: Ctx) {
  return c.env.DB.prepare(
    `SELECT p.id, p.name, p.address, p.contact_name AS contactName, p.building_type AS buildingType,
            COUNT(a.id) AS assets,
            SUM(CASE WHEN a.next_due_at < ?2 THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN a.next_due_at BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END) AS soon,
            SUM(CASE WHEN a.id IS NOT NULL AND a.next_due_at IS NULL THEN 1 ELSE 0 END) AS never,
            (SELECT COUNT(*) FROM defects d WHERE d.property_id = p.id AND d.status = 'open') AS openDefects,
            (SELECT MAX(w.inspected_at) FROM walkthroughs w WHERE w.property_id = p.id AND w.status = 'submitted') AS lastWalkAt,
            (SELECT MAX(w.next_due_at) FROM walkthroughs w WHERE w.property_id = p.id AND w.status = 'submitted') AS nextWalkAt,
            MAX(a.last_inspected_at) AS lastInspectedAt,
            MIN(a.next_due_at) AS nextDueAt
       FROM properties p
       LEFT JOIN buildings b ON b.property_id = p.id AND b.deleted_at IS NULL
       LEFT JOIN assets a ON a.building_id = b.id AND a.deleted_at IS NULL
      WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL
      GROUP BY p.id ORDER BY p.name`,
  );
}

// ---------- Suche ----------
data.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  if (q.length < 2) return c.json({ properties: [], buildings: [], assets: [] });
  const like = `%${q}%`;
  const [props, builds, assets] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, name, address FROM properties WHERE tenant_id = ?1 AND deleted_at IS NULL AND (lower(name) LIKE ?2 OR lower(address) LIKE ?2) LIMIT 6`,
    ).bind(tid(c), like),
    c.env.DB.prepare(
      `SELECT b.id, b.name, p.id AS propertyId, p.name AS propertyName FROM buildings b JOIN properties p ON p.id = b.property_id
        WHERE b.tenant_id = ?1 AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND lower(b.name) LIKE ?2 LIMIT 6`,
    ).bind(tid(c), like),
    c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, b.name AS buildingName, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND (lower(a.code) LIKE ?2 OR lower(a.location) LIKE ?2 OR lower(a.manufacturer) LIKE ?2 OR lower(COALESCE(a.label_code,'')) LIKE ?2)
        LIMIT 10`,
    ).bind(tid(c), like),
  ]);
  return c.json({ properties: props.results, buildings: builds.results, assets: assets.results });
});

// ---------- Objekte ----------
const propertyBody = z.object({
  name: str(160).min(1, 'Name fehlt'),
  address: str(400).default(''),
  description: str(2000).default(''),
  contactName: str(160).default(''),
  contactPhone: str(60).default(''),
  contactEmail: z.union([z.literal(''), z.string().trim().email()]).default(''),
  buildingType: buildingTypeEnum.default('general'),
  pdfPattern: z.string().trim().max(120).nullable().default(null),
});

data.get('/properties', async (c) => {
  const n = now();
  const rows = await propertyStatusQuery(c).bind(tid(c), n, n + SOON_WINDOW_DAYS * DAY).all();
  return c.json(rows.results);
});

data.post('/properties', async (c) => {
  requireRole(c, 'admin');
  const b = propertyBody.parse(await c.req.json());
  const pid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO properties (id, tenant_id, name, address, description, contact_name, contact_phone, contact_email, building_type, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(pid, tid(c), b.name, b.address, b.description, b.contactName, b.contactPhone, b.contactEmail, b.buildingType, t, t)
    .run();
  await logActivity(c, 'create', 'property', pid, `Objekt „${b.name}“ angelegt`);
  return c.json({ id: pid });
});

data.get('/properties/:id', async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT id, name, address, description, contact_name AS contactName, contact_phone AS contactPhone, contact_email AS contactEmail,
            building_type AS buildingType, pdf_pattern AS pdfPattern, created_at AS createdAt
       FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('id'), tid(c))
    .first();
  if (!p) notFound('Objekt');
  const [buildings, plans, walks, officers] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name, address FROM buildings WHERE property_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY name').bind(
      p.id,
      tid(c),
    ),
    c.env.DB.prepare(
      `SELECT f.id, f.building_id AS buildingId, f.name, f.level, f.width, f.height, f.file_key AS fileKey,
              (SELECT COUNT(*) FROM assets a WHERE a.floor_plan_id = f.id AND a.deleted_at IS NULL) AS markers
         FROM floor_plans f JOIN buildings b ON b.id = f.building_id
        WHERE b.property_id = ? AND f.tenant_id = ? AND f.deleted_at IS NULL ORDER BY f.level, f.name`,
    ).bind(p.id, tid(c)),
    c.env.DB.prepare(
      `SELECT w.id, w.status, w.result, w.inspected_at AS inspectedAt, w.created_at AS createdAt, w.next_due_at AS nextDueAt, u.name AS inspector,
              (SELECT COUNT(*) FROM defects d WHERE d.walkthrough_id = w.id AND d.status = 'open') AS openDefects
         FROM walkthroughs w JOIN users u ON u.id = w.inspector_id
        WHERE w.property_id = ? AND w.tenant_id = ? ORDER BY COALESCE(w.inspected_at, w.created_at) DESC LIMIT 20`,
    ).bind(p.id, tid(c)),
    c.env.DB.prepare(
      `SELECT id, name, company, phone, email, qualification, appointed_from AS appointedFrom, appointed_to AS appointedTo, notes
         FROM fire_officers WHERE property_id = ? AND tenant_id = ? ORDER BY appointed_from DESC`,
    ).bind(p.id, tid(c)),
  ]);
  const assets = await assetQuery(c, 'b.property_id = ?2').bind(tid(c), p.id).all();
  return c.json({
    ...p,
    buildings: buildings.results,
    floorPlans: plans.results,
    walkthroughs: walks.results,
    fireOfficers: officers.results,
    assets: assets.results.map(mapAsset),
  });
});

data.patch('/properties/:id', async (c) => {
  requireRole(c, 'admin');
  const b = propertyBody.parse(await c.req.json());
  const r = await c.env.DB.prepare(
    `UPDATE properties SET name=?, address=?, description=?, contact_name=?, contact_phone=?, contact_email=?, building_type=?, pdf_pattern=?, updated_at=?
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
  )
    .bind(b.name, b.address, b.description, b.contactName, b.contactPhone, b.contactEmail, b.buildingType, b.pdfPattern || null, now(), c.req.param('id'), tid(c))
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

// ---------- Brandschutzbeauftragte ----------
const officerBody = z.object({
  name: str(160).min(1, 'Name fehlt'),
  company: str(160).default(''),
  phone: str(60).default(''),
  email: z.union([z.literal(''), z.string().trim().email()]).default(''),
  qualification: str(200).default(''),
  appointedFrom: z.number().int(),
  appointedTo: z.number().int().nullable().default(null),
  notes: str(2000).default(''),
});

data.post('/properties/:id/fire-officers', async (c) => {
  requireRole(c, 'admin');
  const b = officerBody.parse(await c.req.json());
  const p = await c.env.DB.prepare('SELECT id FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(c.req.param('id'), tid(c)).first();
  if (!p) notFound('Objekt');
  // Neue Bestellung beendet die bisher laufende automatisch
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE fire_officers SET appointed_to = ? WHERE property_id = ? AND tenant_id = ? AND appointed_to IS NULL AND appointed_from < ?').bind(
      b.appointedFrom,
      p.id,
      tid(c),
      b.appointedFrom,
    ),
    c.env.DB.prepare(
      `INSERT INTO fire_officers (id, tenant_id, property_id, name, company, phone, email, qualification, appointed_from, appointed_to, notes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id(), tid(c), p.id, b.name, b.company, b.phone, b.email, b.qualification, b.appointedFrom, b.appointedTo, b.notes, now()),
  ]);
  await logActivity(c, 'create', 'fire_officer', p.id as string, `Brandschutzbeauftragte/r ${b.name} bestellt`);
  return c.json({ ok: true });
});

data.patch('/fire-officers/:id', async (c) => {
  requireRole(c, 'admin');
  const b = officerBody.parse(await c.req.json());
  const r = await c.env.DB.prepare(
    'UPDATE fire_officers SET name=?, company=?, phone=?, email=?, qualification=?, appointed_from=?, appointed_to=?, notes=? WHERE id=? AND tenant_id=?',
  )
    .bind(b.name, b.company, b.phone, b.email, b.qualification, b.appointedFrom, b.appointedTo, b.notes, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Eintrag');
  return c.json({ ok: true });
});

data.delete('/fire-officers/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM fire_officers WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tid(c)).run();
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
export function assetQuery(c: Ctx, where = '1=1', order = 'a.code') {
  return c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes, a.label_code AS labelCode,
            a.floor_plan_id AS floorPlanId, a.marker_x AS markerX, a.marker_y AS markerY,
            a.last_inspection_id AS lastInspectionId, a.last_inspected_at AS lastInspectedAt, a.last_result AS lastResult,
            a.next_due_at AS nextDueAt, a.created_at AS createdAt, a.schedules,
            b.id AS buildingId, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            (SELECT COUNT(*) FROM defects d WHERE d.asset_id = a.id AND d.status = 'open') AS openDefects
       FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
      WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND ${where}
      ORDER BY ${order}`,
  );
}
export const mapAsset = (r: Record<string, unknown>) => ({ ...r, attributes: parseJson(r.attributes as string, {}), schedules: parseJson(r.schedules as string, {}) });

data.get('/assets', async (c) => {
  const q = c.req.query();
  const where: string[] = [];
  const args: unknown[] = [tid(c)];
  const n = now();
  if (q.category) {
    args.push(q.category);
    where.push(`a.category = ?${args.length}`);
  }
  if (q.buildingId) {
    args.push(q.buildingId);
    where.push(`a.building_id = ?${args.length}`);
  }
  if (q.propertyId) {
    args.push(q.propertyId);
    where.push(`b.property_id = ?${args.length}`);
  }
  if (q.q) {
    args.push(`%${q.q.toLowerCase()}%`);
    const i = args.length;
    where.push(
      `(lower(a.code) LIKE ?${i} OR lower(a.location) LIKE ?${i} OR lower(a.manufacturer) LIKE ?${i} OR lower(b.name) LIKE ?${i} OR lower(p.name) LIKE ?${i} OR lower(COALESCE(a.label_code,'')) LIKE ?${i})`,
    );
  }
  // Filter nach Prüfart: Termin dieser Prüfart statt des frühesten Termins
  const sched = q.schedule && /^[a-zA-Z0-9_]{1,40}$/.test(q.schedule) ? q.schedule : null;
  const dueCol = sched ? `json_extract(a.schedules, '$.${sched}.nextDueAt')` : 'a.next_due_at';
  if (sched) where.push(`json_extract(a.schedules, '$.${sched}.enabled') = 1`);
  if (q.due === 'overdue') where.push(`${dueCol} < ${n}`);
  if (q.due === 'soon') where.push(`${dueCol} BETWEEN ${n} AND ${n + SOON_WINDOW_DAYS * DAY}`);
  if (q.due === 'never') where.push(sched ? `json_extract(a.schedules, '$.${sched}.lastAt') IS NULL` : 'a.next_due_at IS NULL');
  if (q.due === 'new') where.push(`a.created_at > ${n - 30 * DAY}`);
  if (q.due === 'not_inspectable') where.push(`a.last_result = 'not_inspectable'`);
  if (q.due === 'defects') where.push(`EXISTS (SELECT 1 FROM defects d WHERE d.asset_id = a.id AND d.status = 'open')`);
  const order = q.due === 'new' ? 'a.created_at DESC' : q.due ? `COALESCE(${dueCol}, 0), a.code` : 'p.name, b.name, a.code';
  const rows = await assetQuery(c, where.join(' AND ') || '1=1', order)
    .bind(...args)
    .all();
  return c.json(rows.results.map(mapAsset));
});

const attrValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
const assetBody = z.object({
  buildingId: z.string().min(1),
  category: z.string().min(1).max(40),
  location: str(200).default(''),
  floor: str(60).default(''),
  manufacturer: str(120).default(''),
  model: str(120).default(''),
  attributes: z.record(attrValue).default({}),
  code: str(40).optional(),
  labelCode: str(60).optional(),
});

/** Zufälliger Code-Teil ohne verwechselbare Zeichen (0/O, 1/I). */
export function randomCode(len: number) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => alphabet[b % alphabet.length]).join('');
}

export async function uniqueCode(c: Ctx, category: Category) {
  const prefix = (await getCategoryDef(c, category)).prefix;
  for (let i = 0; i < 12; i++) {
    const code = `${prefix}-${randomCode(4)}`;
    const hit = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ? AND code = ?').bind(tid(c), code).first();
    if (!hit) return code;
  }
  throw new HTTPException(500, { message: 'Kein freier Code gefunden' });
}

async function assertLabelFree(c: Ctx, label: string, exceptAssetId?: string) {
  const hit = await c.env.DB.prepare(
    'SELECT code FROM assets WHERE tenant_id = ? AND deleted_at IS NULL AND (upper(label_code) = upper(?) OR upper(code) = upper(?)) AND id != ?',
  )
    .bind(tid(c), label, label, exceptAssetId ?? '')
    .first<{ code: string }>();
  if (hit) throw new HTTPException(409, { message: `Etikett ist bereits ${hit.code} zugeordnet` });
}

data.post('/assets', async (c) => {
  requireRole(c, 'inspector');
  const b = assetBody.parse(await c.req.json());
  const building = await c.env.DB.prepare('SELECT id FROM buildings WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(b.buildingId, tid(c))
    .first();
  if (!building) notFound('Gebäude');
  const def = await getCategoryDef(c, b.category);
  const code = b.code?.toUpperCase() || (await uniqueCode(c, b.category));
  const dup = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ? AND code = ?').bind(tid(c), code).first();
  if (dup) throw new HTTPException(409, { message: `Code ${code} ist bereits vergeben` });
  const label = b.labelCode?.toUpperCase() || null;
  if (label) await assertLabelFree(c, label);
  const aid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO assets (id, tenant_id, building_id, category, code, location, floor, manufacturer, model, attributes, label_code, schedules, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(aid, tid(c), b.buildingId, b.category, code, b.location, b.floor, b.manufacturer, b.model, JSON.stringify(b.attributes), label, JSON.stringify({ main: { enabled: true } }), t, t)
    .run();
  await logActivity(c, 'create', 'asset', aid, `${def.label} ${code} angelegt`);
  return c.json({ id: aid, code });
});

/** Code oder zugeordnetes Etikett auflösen. */
data.get('/assets/by-code/:code', async (c) => {
  const code = c.req.param('code');
  const row = await c.env.DB.prepare(
    'SELECT id FROM assets WHERE tenant_id = ? AND deleted_at IS NULL AND (upper(code) = upper(?) OR upper(label_code) = upper(?))',
  )
    .bind(tid(c), code, code)
    .first();
  if (!row) notFound('Element');
  return c.json(row);
});

data.get('/assets/:id', async (c) => {
  const a = await assetQuery(c, 'a.id = ?2').bind(tid(c), c.req.param('id')).first();
  if (!a) notFound('Element');
  const [inspections, defects, plan, files] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT i.id, i.kind, i.kinds, i.purpose, i.schedule, i.status, i.result, i.inspected_at AS inspectedAt, i.created_at AS createdAt, i.archived_at AS archivedAt,
              i.superseded_at AS supersededAt, u.name AS inspector
         FROM inspections i JOIN users u ON u.id = i.inspector_id WHERE i.asset_id = ? AND i.tenant_id = ? ORDER BY COALESCE(i.inspected_at, i.created_at) DESC`,
    ).bind(a.id, tid(c)),
    c.env.DB.prepare(
      `SELECT id, title, note, severity, status, created_at AS createdAt, resolved_at AS resolvedAt, inspection_id AS inspectionId, photo_key AS photoKey
         FROM defects WHERE asset_id = ? AND tenant_id = ? ORDER BY status = 'open' DESC, created_at DESC`,
    ).bind(a.id, tid(c)),
    c.env.DB.prepare('SELECT id, name, width, height, file_key AS fileKey FROM floor_plans WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(
      a.floorPlanId ?? '',
      tid(c),
    ),
    c.env.DB.prepare(
      `SELECT id, file_key AS fileKey, name, content_type AS contentType, size, caption, inspection_id AS inspectionId, created_at AS createdAt
         FROM attachments WHERE asset_id = ? AND tenant_id = ? ORDER BY created_at DESC`,
    ).bind(a.id, tid(c)),
  ]);
  return c.json({
    ...mapAsset(a),
    inspections: (inspections.results as Record<string, unknown>[]).map((r) => ({ ...r, kinds: parseJson<string[]>(r.kinds as string, []) })),
    defects: defects.results,
    floorPlan: plan.results[0] ?? null,
    attachments: files.results,
  });
});

data.patch('/assets/:id', async (c) => {
  requireRole(c, 'inspector');
  const b = assetBody.omit({ category: true, code: true }).parse(await c.req.json());
  const building = await c.env.DB.prepare('SELECT id FROM buildings WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(b.buildingId, tid(c))
    .first();
  if (!building) notFound('Gebäude');
  const label = b.labelCode?.toUpperCase() || null;
  if (label) await assertLabelFree(c, label, c.req.param('id'));
  const r = await c.env.DB.prepare(
    `UPDATE assets SET building_id=?, location=?, floor=?, manufacturer=?, model=?, attributes=?, label_code=?, updated_at=?,
            floor_plan_id = CASE WHEN building_id = ? THEN floor_plan_id ELSE NULL END
      WHERE id=? AND tenant_id=? AND deleted_at IS NULL`,
  )
    .bind(b.buildingId, b.location, b.floor, b.manufacturer, b.model, JSON.stringify(b.attributes), label, now(), b.buildingId, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  return c.json({ ok: true });
});

/** Vorgedrucktes Etikett einem Element zuordnen (oder lösen mit null). */
data.put('/assets/:id/label', async (c) => {
  requireRole(c, 'inspector');
  const { labelCode } = z.object({ labelCode: str(60).nullable() }).parse(await c.req.json());
  const label = labelCode?.toUpperCase() || null;
  if (label) await assertLabelFree(c, label, c.req.param('id'));
  const r = await c.env.DB.prepare('UPDATE assets SET label_code=?, updated_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(label, now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  await logActivity(c, 'label', 'asset', c.req.param('id'), label ? `Etikett ${label} zugeordnet` : 'Etikett gelöst');
  return c.json({ ok: true });
});

/** Position auf dem Grundriss setzen (x/y relativ 0..1) oder entfernen. */
data.put('/assets/:id/marker', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({ floorPlanId: z.string().nullable(), x: z.number().min(0).max(1).nullable(), y: z.number().min(0).max(1).nullable() })
    .parse(await c.req.json());
  if (b.floorPlanId) {
    const ok = await c.env.DB.prepare(
      `SELECT 1 FROM floor_plans f JOIN assets a ON a.building_id = f.building_id
        WHERE f.id = ? AND a.id = ? AND f.tenant_id = ? AND f.deleted_at IS NULL`,
    )
      .bind(b.floorPlanId, c.req.param('id'), tid(c))
      .first();
    if (!ok) throw new HTTPException(400, { message: 'Grundriss gehört nicht zum Gebäude des Elements' });
  }
  const r = await c.env.DB.prepare('UPDATE assets SET floor_plan_id=?, marker_x=?, marker_y=?, updated_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(b.floorPlanId, b.floorPlanId ? b.x : null, b.floorPlanId ? b.y : null, now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  return c.json({ ok: true });
});

data.delete('/assets/:id', async (c) => {
  requireRole(c, 'admin');
  const r = await c.env.DB.prepare('UPDATE assets SET deleted_at=?, deleted_label=label_code, label_code=NULL WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Element');
  await logActivity(c, 'delete', 'asset', c.req.param('id'), 'Element gelöscht');
  return c.json({ ok: true });
});

// ---------- Papierkorb ----------
export const TRASH_DAYS = 30;

/** Gelöschte Elemente der letzten 30 Tage (nur Admins). */
data.get('/trash/assets', async (c) => {
  requireRole(c, 'admin');
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.location, a.deleted_at AS deletedAt, b.name AS buildingName, p.name AS propertyName,
            b.deleted_at IS NOT NULL OR p.deleted_at IS NOT NULL AS parentDeleted
       FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
      WHERE a.tenant_id = ? AND a.deleted_at > ? ORDER BY a.deleted_at DESC LIMIT 500`,
  )
    .bind(tid(c), now() - TRASH_DAYS * DAY)
    .all();
  return c.json(rows.results);
});

/** Element aus dem Papierkorb wiederherstellen (innerhalb von 30 Tagen, Gebäude und Objekt müssen noch bestehen). */
data.post('/assets/:id/restore', async (c) => {
  requireRole(c, 'admin');
  const a = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.deleted_at, a.deleted_label, b.deleted_at AS bDel, p.deleted_at AS pDel
       FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id WHERE a.id = ? AND a.tenant_id = ?`,
  )
    .bind(c.req.param('id'), tid(c))
    .first<{ id: string; code: string; deleted_at: number | null; deleted_label: string | null; bDel: number | null; pDel: number | null }>();
  if (!a || !a.deleted_at) notFound('Gelöschtes Element');
  if (a.deleted_at < now() - TRASH_DAYS * DAY) throw new HTTPException(410, { message: `Nur innerhalb von ${TRASH_DAYS} Tagen wiederherstellbar` });
  if (a.bDel || a.pDel) throw new HTTPException(409, { message: 'Gebäude oder Objekt wurde ebenfalls gelöscht' });
  // Etikett nur zurückgeben, wenn es inzwischen nicht neu vergeben wurde
  let label = a.deleted_label;
  if (label) {
    const taken = await c.env.DB.prepare('SELECT 1 FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL AND (upper(label_code) = upper(?2) OR upper(code) = upper(?2))')
      .bind(tid(c), label)
      .first();
    if (taken) label = null;
  }
  await c.env.DB.prepare('UPDATE assets SET deleted_at = NULL, deleted_label = NULL, label_code = ?, updated_at = ? WHERE id = ?').bind(label, now(), a.id).run();
  await logActivity(c, 'restore', 'asset', a.id, `Element ${a.code} wiederhergestellt`);
  return c.json({ ok: true, labelRestored: !!label || !a.deleted_label });
});

// ---------- Mängel ----------
data.get('/defects', async (c) => {
  const status = c.req.query('status') === 'resolved' ? 'resolved' : c.req.query('status') === 'all' ? null : 'open';
  const source = c.req.query('source');
  const srcWhere = source === 'walkthrough' ? 'AND d.walkthrough_id IS NOT NULL' : source === 'asset' ? 'AND d.asset_id IS NOT NULL' : '';
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.note, d.measure, d.severity, d.status, d.created_at AS createdAt, d.resolved_at AS resolvedAt, d.inspection_id AS inspectionId,
            d.walkthrough_id AS walkthroughId, d.legal_basis AS legalBasis,
            d.photo_key AS photoKey, a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            (SELECT t.id FROM tasks t WHERE t.defect_id = d.id LIMIT 1) AS taskId
       FROM defects d JOIN properties p ON p.id = d.property_id
       LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN buildings b ON b.id = a.building_id
      WHERE d.tenant_id = ?1 AND (?2 IS NULL OR d.status = ?2) AND p.deleted_at IS NULL AND (a.id IS NULL OR a.deleted_at IS NULL) ${srcWhere}
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

// ---------- Dateien (Fotos, Grundrisse) ----------
const MAX_UPLOAD = 10 * 1024 * 1024;

data.post('/files', async (c) => {
  requireRole(c, 'inspector');
  const type = c.req.header('content-type') ?? '';
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(type)) throw new HTTPException(415, { message: 'Nur JPEG, PNG, WebP oder PDF' });
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_UPLOAD) throw new HTTPException(413, { message: 'Datei zu groß (max. 10 MB)' });
  const key = `${tid(c)}/${id(24)}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ key });
});

data.get('/files/:tenant/:name', async (c) => {
  if (c.req.param('tenant') !== tid(c)) notFound('Datei');
  const obj = await c.env.FILES.get(`${c.req.param('tenant')}/${c.req.param('name')}`);
  if (!obj) notFound('Datei');
  return new Response(obj.body, {
    headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=604800, immutable' },
  });
});

// ---------- Export ----------
/** Spalten des Element-Exports – Kopfzeile passt zur Import-Vorlage (Wiederimport möglich). */
export const CSV_HEAD = ['Objekt', 'Gebäude', 'Art', 'Code', 'Etikett', 'Standort', 'Etage', 'Hersteller', 'Modell', 'Baujahr', 'Letzte Prüfung', 'Ergebnis', 'Nächste Prüfung', 'Offene Mängel'];
const RESULT_TEXT: Record<string, string> = { ok: 'Ohne Mängel', defects: 'Mit Mängeln', critical: 'Kritisch', not_inspectable: 'Nicht prüfbar' };
const CSV_HEAD_EN = ['Property', 'Building', 'Type', 'Code', 'Label', 'Location', 'Floor', 'Manufacturer', 'Model', 'Year', 'Last inspection', 'Result', 'Next inspection', 'Open defects'];

async function docLanguage(c: Ctx): Promise<DocLanguage> {
  const l = await c.env.DB.prepare('SELECT language FROM tenants WHERE id = ?').bind(tid(c)).first<string>('language');
  return l === 'en' ? 'en' : 'de';
}

async function exportRows(c: Ctx, lang: DocLanguage = 'de') {
  const rows = (await assetQuery(c, '1=1', 'p.name, b.name, a.code').bind(tid(c)).all<Record<string, unknown>>()).results.map((r) => mapAsset(r) as Record<string, unknown>);
  const labels = new Map((await listCategories(c)).map((d) => [d.key, d.label]));
  return rows.map((r) => {
    const year = Number((r.attributes as Record<string, unknown>)?.year);
    return {
      cells: [r.propertyName, r.buildingName, tr(lang, labels.get(r.category as Category) ?? String(r.category)), r.code, r.labelCode ?? '', r.location, r.floor, r.manufacturer, r.model] as (string | number | null)[],
      year: Number.isFinite(year) && year > 0 ? year : null,
      lastAt: r.lastInspectedAt as number | null,
      result: r.lastResult ? tr(lang, RESULT_TEXT[r.lastResult as string] ?? String(r.lastResult)) : '',
      nextAt: r.nextDueAt as number | null,
      defects: Number(r.openDefects ?? 0),
    };
  });
}

data.get('/export/assets.csv', async (c) => {
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v);
    // Formel-Injection in Tabellenprogrammen verhindern (Text, der mit = + - @ beginnt)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const date = (v: number | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const lang = await docLanguage(c);
  const lines = (await exportRows(c, lang)).map((r) => [...r.cells, r.year ?? '', date(r.lastAt), r.result, date(r.nextAt), r.defects].map(esc).join(';'));
  return new Response('\uFEFF' + [(lang === 'en' ? CSV_HEAD_EN : CSV_HEAD).join(';'), ...lines].join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="elemente.csv"' },
  });
});

data.get('/export/assets.xlsx', async (c) => {
  const lang = await docLanguage(c);
  const rows = await exportRows(c, lang);
  const d = (v: number | null) => (v ? new Date(v) : null);
  const bytes = buildXlsx(lang === 'en' ? 'Items' : 'Elemente', [lang === 'en' ? CSV_HEAD_EN : CSV_HEAD, ...rows.map((r) => [...r.cells, r.year, d(r.lastAt), r.result, d(r.nextAt), r.defects])], [28, 18, 20, 12, 12, 28, 10, 16, 16, 9, 14, 14, 14, 12]);
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${lang === 'en' ? 'Items' : 'Elemente'}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
});

/** Vollständiges JSON-Backup des Workspaces (ohne Passwörter, Sitzungen und Tokens). */
data.get('/export/backup.json', async (c) => {
  requireRole(c, 'admin');
  const t = tid(c);
  const tables: [string, string][] = [
    ['tenant', 'SELECT id, name, address, phone, email, website, pdf_pattern, archive_after_months, created_at FROM tenants WHERE id = ?'],
    ['members', 'SELECT u.id, u.name, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ?'],
    ['properties', 'SELECT * FROM properties WHERE tenant_id = ?'],
    ['buildings', 'SELECT * FROM buildings WHERE tenant_id = ?'],
    ['floorPlans', 'SELECT * FROM floor_plans WHERE tenant_id = ?'],
    ['assets', 'SELECT * FROM assets WHERE tenant_id = ?'],
    ['customCategories', 'SELECT * FROM custom_categories WHERE tenant_id = ?'],
    ['templateOverrides', 'SELECT * FROM template_overrides WHERE tenant_id = ?'],
    // Unterschriften (Bilddaten) nicht im Backup – sonst sprengen große Workspaces den Worker-Speicher
    [
      'inspections',
      `SELECT id, tenant_id, asset_id, inspector_id, kind, reason, status, result, answers, maintenance, checkpoints, notes, signature IS NOT NULL AS signed, signer_name,
              next_due_at, inspected_at, created_at, updated_at, client_id, schedule, archived_at, kinds, purpose, supersedes_id, superseded_by, superseded_at, follow_up_of
              FROM inspections WHERE tenant_id = ?`,
    ],
    [
      'walkthroughs',
      `SELECT id, tenant_id, property_id, building_id, building_type, inspector_id, status, result, questions, answers, findings, notes, participants,
              signature IS NOT NULL AS signed, signer_name, inspected_at, next_due_at, created_at, updated_at, purpose, follow_up_of FROM walkthroughs WHERE tenant_id = ?`,
    ],
    ['defects', 'SELECT * FROM defects WHERE tenant_id = ?'],
    ['reports', 'SELECT id, kind, title, file_name, size, property_id, created_by, created_at FROM reports WHERE tenant_id = ?'],
    ['attachments', 'SELECT * FROM attachments WHERE tenant_id = ?'],
    ['tasks', 'SELECT id, title, description, status, priority, due_at, assignee_id, subcontractor_id, asset_id, defect_id, property_id, labels, external_note, external_done_at, first_response_at, closed_at, created_by, created_at, updated_at FROM tasks WHERE tenant_id = ?'],
    ['taskComments', 'SELECT * FROM task_comments WHERE tenant_id = ?'],
    ['taskLabels', 'SELECT * FROM task_labels WHERE tenant_id = ?'],
    ['slaPolicies', 'SELECT * FROM sla_policies WHERE tenant_id = ?'],
    ['subcontractors', 'SELECT * FROM subcontractors WHERE tenant_id = ?'],
    ['fireOfficers', 'SELECT * FROM fire_officers WHERE tenant_id = ?'],
    ['activity', 'SELECT * FROM activity WHERE tenant_id = ?'],
  ];
  const res = await c.env.DB.batch(tables.map(([, sql]) => c.env.DB.prepare(sql).bind(t)));
  const out: Record<string, unknown> = { format: 'pruefkompass-backup', version: 1, exportedAt: new Date().toISOString() };
  tables.forEach(([k], i) => (out[k] = k === 'tenant' ? res[i].results[0] : res[i].results));
  await logActivity(c, 'export', 'tenant', null, 'JSON-Backup heruntergeladen');
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"` },
  });
});
