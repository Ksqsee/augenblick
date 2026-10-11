// Archiv erstellter Berichte: Der Browser erzeugt PDF/ZIP und legt eine Kopie hier ab.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { tid } from './data';
import { type AppEnv, assertInScope, id, notFound, now, requireRole, scopeSql } from './lib';

export const REPORT_KINDS = {
  compliance: 'Compliance-Übersicht',
  defects: 'Mängelbericht',
  property: 'Objektbericht',
  protocols: 'Prüfprotokolle (ZIP)',
  selection: 'Prüfbericht (Auswahl)',
  annual: 'Jahresbericht',
} as const;

/** Berichte im Zugriffsbereich: eingeschränkte Mitglieder sehen nur Berichte zu ihren Objekten. */
const reportScope = (c: Parameters<typeof scopeSql>[0]) => (c.get('user').scope ? `r.property_id IS NOT NULL AND ${scopeSql(c, 'r.property_id', 'property')}` : '1=1');
const MAX_REPORT = 25 * 1024 * 1024;
const TYPES = ['application/pdf', 'application/zip'];

export const reports = new Hono<AppEnv>();

reports.get('/reports', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.kind, r.title, r.file_name AS fileName, r.content_type AS contentType, r.size, r.property_id AS propertyId,
            r.created_at AS createdAt, u.name AS createdBy, r.created_by AS createdById
       FROM reports r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.tenant_id = ? AND ${reportScope(c)} ORDER BY r.created_at DESC LIMIT 200`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

/**
 * Daten für den Jahresbericht: je Objekt Prüfungen, Mängel mit Behebungsquote, Begehungen und
 * Brandschutzbeauftragte eines Kalenderjahres (in der Zeitzone des Workspaces gerechnet ab 1.1. UTC).
 */
reports.get('/reports/annual', async (c) => {
  const year = Number(c.req.query('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HTTPException(400, { message: 'Ungültiges Jahr' });
  const pid = c.req.query('propertyId');
  if (pid) assertInScope(c, 'property', pid);
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const t = tid(c);
  const pf = pid ? 'AND p.id = ?4' : '';
  const sb = scopeSql(c, 'b.id', 'building');
  const sp = scopeSql(c, 'p.id', 'property');
  const binds = pid ? [t, from, to, pid] : [t, from, to];
  const [props, insp, defects, walks, officers] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT p.id, p.name, p.address FROM properties p WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND ${sp} ${pid ? 'AND p.id = ?2' : ''} ORDER BY p.name`).bind(
      ...(pid ? [t, pid] : [t]),
    ),
    c.env.DB.prepare(
      `SELECT p.id AS propertyId, a.category, i.result, i.purpose, COUNT(*) AS n
         FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE i.tenant_id = ?1 AND i.status = 'submitted' AND i.superseded_at IS NULL AND i.inspected_at >= ?2 AND i.inspected_at < ?3 AND ${sb} ${pf}
        GROUP BY p.id, a.category, i.result, i.purpose`,
    ).bind(...binds),
    c.env.DB.prepare(
      `SELECT d.property_id AS propertyId, d.severity, d.status, d.walkthrough_id IS NOT NULL AS fromWalk, d.created_at AS createdAt, d.resolved_at AS resolvedAt
         FROM defects d JOIN properties p ON p.id = d.property_id LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN buildings b ON b.id = a.building_id
        WHERE d.tenant_id = ?1 AND d.created_at >= ?2 AND d.created_at < ?3 AND ${sp} AND (d.asset_id IS NULL OR ${sb}) ${pf}`,
    ).bind(...binds),
    c.env.DB.prepare(
      `SELECT w.property_id AS propertyId, w.inspected_at AS inspectedAt, w.purpose, w.result, u.name AS inspector,
              w.inspector_fire_officer AS fireOfficer, w.inspector_qualification AS qualification,
              (SELECT COUNT(*) FROM defects d WHERE d.walkthrough_id = w.id) AS findings
         FROM walkthroughs w JOIN properties p ON p.id = w.property_id JOIN users u ON u.id = w.inspector_id
        WHERE w.tenant_id = ?1 AND w.status = 'submitted' AND w.inspected_at >= ?2 AND w.inspected_at < ?3 AND ${sp} ${pf} ORDER BY w.inspected_at`,
    ).bind(...binds),
    c.env.DB.prepare(
      `SELECT f.property_id AS propertyId, f.name, f.qualification, f.appointed_from AS appointedFrom, f.appointed_to AS appointedTo
         FROM fire_officers f JOIN properties p ON p.id = f.property_id
        WHERE f.tenant_id = ?1 AND f.appointed_from < ?3 AND (f.appointed_to IS NULL OR f.appointed_to >= ?2) AND ${sp} ${pf} ORDER BY f.appointed_from`,
    ).bind(...binds),
  ]);
  type D = { propertyId: string; severity: string; status: string; fromWalk: number; createdAt: number; resolvedAt: number | null };
  const rows = (props.results as { id: string; name: string; address: string }[]).map((p) => {
    const ins = (insp.results as { propertyId: string; category: string; result: string; purpose: string; n: number }[]).filter((r) => r.propertyId === p.id);
    const ds = (defects.results as D[]).filter((d) => d.propertyId === p.id);
    const resolved = ds.filter((d) => d.status === 'resolved' && d.resolvedAt);
    const days = resolved.map((d) => (d.resolvedAt! - d.createdAt) / 86_400_000);
    const byResult: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const r of ins) {
      byResult[r.result] = (byResult[r.result] ?? 0) + r.n;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + r.n;
    }
    return {
      ...p,
      inspections: ins.reduce((s, r) => s + r.n, 0),
      followUps: ins.filter((r) => r.purpose === 'follow_up').reduce((s, r) => s + r.n, 0),
      byResult,
      byCategory,
      defects: {
        total: ds.length,
        critical: ds.filter((d) => d.severity === 'critical').length,
        fromWalkthroughs: ds.filter((d) => d.fromWalk).length,
        resolved: resolved.length,
        open: ds.length - resolved.length,
        resolutionRate: ds.length ? Math.round((resolved.length / ds.length) * 100) : null,
        avgDaysToResolve: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      },
      walkthroughs: (walks.results as Record<string, unknown>[])
        .filter((w) => w.propertyId === p.id)
        .map((w) => ({ ...w, fireOfficer: w.fireOfficer == null ? null : !!w.fireOfficer })),
      fireOfficers: (officers.results as Record<string, unknown>[]).filter((f) => f.propertyId === p.id),
    };
  });
  return c.json({ year, from, to, properties: rows });
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
  if (c.get('user').scope) assertInScope(c, 'property', meta.propertyId);
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
  const r = await c.env.DB.prepare(`SELECT file_key, file_name, content_type FROM reports r WHERE id = ? AND tenant_id = ? AND ${reportScope(c)}`)
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
  const r = await c.env.DB.prepare(`SELECT file_key, created_by FROM reports r WHERE id = ? AND tenant_id = ? AND ${reportScope(c)}`)
    .bind(c.req.param('id'), tid(c))
    .first<{ file_key: string; created_by: string | null }>();
  if (!r) notFound('Bericht');
  if (r.created_by !== u.userId) requireRole(c, 'admin');
  await c.env.FILES.delete(r.file_key);
  await c.env.DB.prepare('DELETE FROM reports WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), tid(c)).run();
  return c.json({ ok: true });
});
