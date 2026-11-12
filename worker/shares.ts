// Kunden-Freigabe je Objekt: Auftraggeber sehen Prüfstatus, offene Mängel und letzte Prüfungen – ohne Konto, nur lesend.
import { Hono } from 'hono';
import { z } from 'zod';
import { tid } from './data';
import { type AppEnv, assertInScope, type Ctx, id, logActivity, notFound, now, requireRole, sha256Hex, token } from './lib';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';

export const shares = new Hono<AppEnv>();

shares.get('/properties/:id/shares', async (c) => {
  requireRole(c, 'admin');
  assertInScope(c, 'property', c.req.param('id'));
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.label, s.show_defects AS showDefects, s.created_at AS createdAt, s.expires_at AS expiresAt, s.revoked_at AS revokedAt,
            s.last_viewed_at AS lastViewedAt, s.views, u.name AS createdBy
       FROM property_shares s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.tenant_id = ? AND s.property_id = ? ORDER BY s.revoked_at IS NOT NULL, s.created_at DESC`,
  )
    .bind(tid(c), c.req.param('id'))
    .all();
  return c.json(rows.results.map((r) => ({ ...r, showDefects: !!r.showDefects })));
});

shares.post('/properties/:id/shares', async (c) => {
  requireRole(c, 'admin');
  const pid = c.req.param('id');
  assertInScope(c, 'property', pid);
  const b = z
    .object({ label: z.string().trim().max(120).default(''), showDefects: z.boolean().default(true), expiresInDays: z.number().int().min(1).max(730).nullable().default(365) })
    .parse(await c.req.json());
  const p = await c.env.DB.prepare('SELECT name FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(pid, tid(c)).first<string>('name');
  if (!p) notFound('Objekt');
  const tok = token();
  const sid = id();
  await c.env.DB.prepare('INSERT INTO property_shares (id, tenant_id, property_id, token_hash, label, show_defects, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(sid, tid(c), pid, await sha256Hex(tok), b.label, b.showDefects ? 1 : 0, c.get('user').userId, now(), b.expiresInDays ? now() + b.expiresInDays * 86_400_000 : null)
    .run();
  await logActivity(c, 'create', 'property', pid, `Kunden-Freigabe für „${p}“ erstellt${b.label ? ` (${b.label})` : ''}`);
  // Der Link wird nur jetzt im Klartext ausgegeben
  return c.json({ id: sid, token: tok });
});

shares.delete('/shares/:id', async (c) => {
  requireRole(c, 'admin');
  const r = await c.env.DB.prepare('UPDATE property_shares SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL').bind(now(), c.req.param('id'), tid(c)).run();
  if (!r.meta.changes) notFound('Freigabe');
  await logActivity(c, 'delete', 'property', null, 'Kunden-Freigabe widerrufen');
  return c.json({ ok: true });
});

/** Öffentliche Ansicht (ohne Anmeldung). Keine internen IDs, keine Personen, keine Fotos. */
export const sharePublic = new Hono<AppEnv>();

async function shareByToken(c: Ctx) {
  const tok = c.req.param('token') ?? '';
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  const s =
    tok.length >= 20
      ? await c.env.DB.prepare(
          `SELECT s.id, s.tenant_id AS tenantId, s.property_id AS propertyId, s.show_defects AS showDefects, s.expires_at AS expiresAt, s.revoked_at AS revokedAt, s.last_viewed_at AS lastViewedAt
             FROM property_shares s JOIN properties p ON p.id = s.property_id AND p.deleted_at IS NULL WHERE s.token_hash = ?`,
        )
          .bind(await sha256Hex(tok))
          .first<{ id: string; tenantId: string; propertyId: string; showDefects: number; expiresAt: number | null; revokedAt: number | null; lastViewedAt: number | null }>()
      : null;
  if (!s || s.revokedAt || (s.expiresAt && s.expiresAt < now())) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Freigabe');
  }
  return s;
}

sharePublic.get('/property/:token', async (c) => {
  const s = await shareByToken(c);
  const DB = c.env.DB;
  const [head, assets, defects, recent] = await DB.batch([
    DB.prepare('SELECT p.name, p.address, t.name AS tenantName, t.phone AS tenantPhone, t.email AS tenantEmail, t.logo_key AS logoKey FROM properties p JOIN tenants t ON t.id = p.tenant_id WHERE p.id = ?').bind(s.propertyId),
    DB.prepare(
      `SELECT a.code, a.category, a.location, a.floor, a.next_due_at AS nextDueAt, a.last_inspected_at AS lastInspectedAt, b.name AS buildingName,
              (SELECT i.result FROM inspections i WHERE i.asset_id = a.id AND i.status = 'submitted' AND i.superseded_at IS NULL ORDER BY i.inspected_at DESC LIMIT 1) AS lastResult,
              (SELECT COUNT(*) FROM defects d WHERE d.asset_id = a.id AND d.status = 'open' AND d.hidden_at IS NULL) AS openDefects
         FROM assets a JOIN buildings b ON b.id = a.building_id
        WHERE b.property_id = ? AND a.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY b.name, a.floor, a.location, a.code`,
    ).bind(s.propertyId),
    DB.prepare(
      `SELECT d.title, d.severity, d.measure, d.created_at AS createdAt, a.code FROM defects d LEFT JOIN assets a ON a.id = d.asset_id
        WHERE d.property_id = ? AND d.status = 'open' AND d.hidden_at IS NULL ORDER BY CASE d.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, d.created_at LIMIT 200`,
    ).bind(s.propertyId),
    DB.prepare(
      `SELECT a.code, a.category, i.inspected_at AS inspectedAt, i.result FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id
        WHERE b.property_id = ? AND i.status = 'submitted' AND i.superseded_at IS NULL ORDER BY i.inspected_at DESC LIMIT 15`,
    ).bind(s.propertyId),
  ]);
  if (!s.lastViewedAt || s.lastViewedAt < now() - 60_000) {
    c.executionCtx.waitUntil(DB.prepare('UPDATE property_shares SET last_viewed_at = ?, views = views + 1 WHERE id = ?').bind(now(), s.id).run());
  }
  const h = head.results[0] as Record<string, unknown>;
  const n = now();
  const list = assets.results as { nextDueAt: number | null; lastResult: string | null }[];
  return c.json({
    property: { name: h.name, address: h.address },
    provider: { name: h.tenantName, phone: h.tenantPhone, email: h.tenantEmail, hasLogo: !!h.logoKey },
    counts: {
      assets: list.length,
      overdue: list.filter((a) => a.nextDueAt != null && a.nextDueAt < n).length,
      never: list.filter((a) => a.nextDueAt == null).length,
      soon: list.filter((a) => a.nextDueAt != null && a.nextDueAt >= n && a.nextDueAt < n + 30 * 86_400_000).length,
    },
    assets: list,
    defects: s.showDefects ? defects.results : null,
    recent: recent.results,
    generatedAt: n,
  });
});

sharePublic.get('/property/:token/logo', async (c) => {
  const s = await shareByToken(c);
  const key = await c.env.DB.prepare('SELECT logo_key FROM tenants WHERE id = ?').bind(s.tenantId).first<string>('logo_key');
  if (!key || !key.startsWith(`${s.tenantId}/`)) notFound('Logo');
  const obj = await c.env.FILES.get(key);
  if (!obj) notFound('Logo');
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'private, max-age=3600' } });
});
