import { Hono } from 'hono';
import { z } from 'zod';
import { assetQuery, mapAsset, str, tid } from './data';
import { type AppEnv, assertInScope, id, logActivity, notFound, now, requireRole } from './lib';

export const plans = new Hono<AppEnv>();

const planBody = z.object({ name: str(120).min(1, 'Name fehlt'), level: z.number().int().min(-10).max(200).default(0) });

plans.post('/buildings/:id/floor-plans', async (c) => {
  requireRole(c, 'admin');
  const b = planBody
    .extend({ fileKey: z.string().max(200), width: z.number().int().min(50).max(20000), height: z.number().int().min(50).max(20000) })
    .parse(await c.req.json());
  if (!b.fileKey.startsWith(`${tid(c)}/`)) notFound('Datei');
  const building = await c.env.DB.prepare('SELECT id FROM buildings WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), tid(c))
    .first();
  if (!building) notFound('Gebäude');
  const fid = id();
  await c.env.DB.prepare(
    'INSERT INTO floor_plans (id, tenant_id, building_id, name, level, file_key, width, height, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(fid, tid(c), building.id, b.name, b.level, b.fileKey, b.width, b.height, now())
    .run();
  await logActivity(c, 'create', 'floor_plan', fid, `Grundriss „${b.name}“ hochgeladen`);
  return c.json({ id: fid });
});

plans.get('/floor-plans/:id', async (c) => {
  const f = await c.env.DB.prepare(
    `SELECT f.id, f.name, f.level, f.width, f.height, f.file_key AS fileKey, b.id AS buildingId, b.name AS buildingName,
            p.id AS propertyId, p.name AS propertyName
       FROM floor_plans f JOIN buildings b ON b.id = f.building_id JOIN properties p ON p.id = b.property_id
      WHERE f.id = ? AND f.tenant_id = ? AND f.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'), tid(c))
    .first<Record<string, unknown>>();
  if (!f) notFound('Grundriss');
  assertInScope(c, 'building', f.buildingId as string);
  const [assets, siblings] = await Promise.all([
    assetQuery(c, 'a.building_id = ?2').bind(tid(c), f.buildingId).all(),
    c.env.DB.prepare('SELECT id, name, level FROM floor_plans WHERE building_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY level, name')
      .bind(f.buildingId, tid(c))
      .all(),
  ]);
  return c.json({ ...f, assets: assets.results.map(mapAsset), siblings: siblings.results });
});

plans.patch('/floor-plans/:id', async (c) => {
  requireRole(c, 'admin');
  const b = planBody.parse(await c.req.json());
  const r = await c.env.DB.prepare('UPDATE floor_plans SET name=?, level=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(b.name, b.level, c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Grundriss');
  return c.json({ ok: true });
});

plans.delete('/floor-plans/:id', async (c) => {
  requireRole(c, 'admin');
  const r = await c.env.DB.prepare('UPDATE floor_plans SET deleted_at=? WHERE id=? AND tenant_id=? AND deleted_at IS NULL')
    .bind(now(), c.req.param('id'), tid(c))
    .run();
  if (!r.meta.changes) notFound('Grundriss');
  await c.env.DB.prepare('UPDATE assets SET floor_plan_id=NULL, marker_x=NULL, marker_y=NULL WHERE floor_plan_id=? AND tenant_id=?')
    .bind(c.req.param('id'), tid(c))
    .run();
  return c.json({ ok: true });
});
