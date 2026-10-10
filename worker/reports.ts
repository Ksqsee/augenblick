// Archiv erstellter Berichte: Der Browser erzeugt PDF/ZIP und legt eine Kopie hier ab.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { tid } from './data';
import { type AppEnv, id, notFound, now, requireRole } from './lib';

export const REPORT_KINDS = { compliance: 'Compliance-Übersicht', defects: 'Mängelbericht', property: 'Objektbericht', protocols: 'Prüfprotokolle (ZIP)' } as const;
const MAX_REPORT = 25 * 1024 * 1024;
const TYPES = ['application/pdf', 'application/zip'];

export const reports = new Hono<AppEnv>();

reports.get('/reports', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.kind, r.title, r.file_name AS fileName, r.content_type AS contentType, r.size, r.property_id AS propertyId,
            r.created_at AS createdAt, u.name AS createdBy, r.created_by AS createdById
       FROM reports r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.tenant_id = ? ORDER BY r.created_at DESC LIMIT 200`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

reports.post('/reports', async (c) => {
  requireRole(c, 'inspector');
  const meta = z
    .object({
      kind: z.enum(Object.keys(REPORT_KINDS) as [keyof typeof REPORT_KINDS]),
      title: z.string().trim().min(1).max(200),
      fileName: z.string().trim().min(1).max(200),
      propertyId: z.string().max(40).optional(),
    })
    .parse(c.req.query());
  const type = (c.req.header('content-type') ?? '').split(';')[0];
  if (!TYPES.includes(type)) throw new HTTPException(415, { message: 'Nur PDF oder ZIP' });
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HTTPException(400, { message: 'Leere Datei' });
  if (buf.byteLength > MAX_REPORT) throw new HTTPException(413, { message: 'Bericht zu groß (max. 25 MB)' });
  const rid = id();
  const key = `${tid(c)}/report-${rid}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare(
    'INSERT INTO reports (id, tenant_id, kind, title, file_name, file_key, content_type, size, property_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(rid, tid(c), meta.kind, meta.title, meta.fileName, key, type, buf.byteLength, meta.propertyId ?? null, c.get('user').userId, now())
    .run();
  return c.json({ id: rid });
});

reports.get('/reports/:id/file', async (c) => {
  const r = await c.env.DB.prepare('SELECT file_key, file_name, content_type FROM reports WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tid(c))
    .first<{ file_key: string; file_name: string; content_type: string }>();
  if (!r) notFound('Bericht');
  const obj = await c.env.FILES.get(r.file_key);
  if (!obj) notFound('Datei');
  const ascii = r.file_name.normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '') || 'bericht';
  return new Response(obj.body, {
    headers: {
      'content-type': r.content_type,
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.file_name)}`,
      'cache-control': 'private, max-age=3600',
    },
  });
});

reports.delete('/reports/:id', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const r = await c.env.DB.prepare('SELECT file_key, created_by FROM reports WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tid(c))
    .first<{ file_key: string; created_by: string | null }>();
  if (!r) notFound('Bericht');
  if (r.created_by !== u.userId) requireRole(c, 'admin');
  await c.env.FILES.delete(r.file_key);
  await c.env.DB.prepare('DELETE FROM reports WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});
