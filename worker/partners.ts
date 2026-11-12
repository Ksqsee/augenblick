// Partner-Zugang: Subunternehmer als Firma mit Einladungscode. Ein widerrufbarer Code je Firma öffnet die
// Sammelseite /partner/:code mit allen offenen Aufträgen dieser Firma (ohne Konto). Gespeichert wird nur der
// SHA-256-Hash des Codes; der Code selbst wird beim Erzeugen genau einmal angezeigt.
// Datenumfang je Auftrag wie beim Einzel-Link (worker/work.ts → PUBLIC_TASK_SQL/publicTask): keine internen
// Notizen, IDs oder Personen. Aufträge werden über eine vom Code abgeleitete Referenz angesprochen.
import { Hono } from 'hono';
import { tid } from './data';
import { type AppEnv, type Ctx, logActivity, notFound, now, requireRole, sha256Hex, token } from './lib';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';
import { externalUpdate, PUBLIC_TASK_SQL, publicTask, publicTaskPhoto } from './work';

// ---------- Verwaltung (angemeldet, Admin) ----------
export const partners = new Hono<AppEnv>();

/** Neuen Code erzeugen; ein vorhandener verliert sofort seine Gültigkeit. */
partners.post('/subcontractors/:id/partner-code', async (c) => {
  requireRole(c, 'admin');
  const code = token();
  const t = now();
  const r = await c.env.DB.prepare(
    'UPDATE subcontractors SET partner_code_hash = ?, partner_code_created_at = ?, partner_code_used_at = NULL WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL RETURNING company',
  )
    .bind(await sha256Hex(code), t, c.req.param('id'), tid(c))
    .first<{ company: string }>();
  if (!r) notFound('Subunternehmer');
  await logActivity(c, 'share', 'subcontractor', c.req.param('id'), `Partner-Zugang für „${r.company}“ erzeugt`);
  return c.json({ code, createdAt: t });
});

partners.delete('/subcontractors/:id/partner-code', async (c) => {
  requireRole(c, 'admin');
  const r = await c.env.DB.prepare(
    'UPDATE subcontractors SET partner_code_hash = NULL, partner_code_created_at = NULL, partner_code_used_at = NULL WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL RETURNING company',
  )
    .bind(c.req.param('id'), tid(c))
    .first<{ company: string }>();
  if (!r) notFound('Subunternehmer');
  await logActivity(c, 'unshare', 'subcontractor', c.req.param('id'), `Partner-Zugang für „${r.company}“ widerrufen`);
  return c.json({ ok: true });
});

// ---------- Öffentliche Sammelseite (ohne Login) ----------
export const partnerPublic = new Hono<AppEnv>();

interface Partner {
  id: string;
  tenantId: string;
  company: string;
  tenantName: string;
  usedAt: number | null;
  hash: string;
}

/** Code prüfen (gedrosselt je IP wie alle Links); ungültig/widerrufen → 404. */
async function partnerByCode(c: Ctx): Promise<Partner> {
  const code = c.req.param('code') ?? '';
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  const hash = code.length >= 20 && code.length <= 100 ? await sha256Hex(code) : null;
  const p = hash
    ? await c.env.DB.prepare(
        `SELECT s.id, s.tenant_id AS tenantId, s.company, te.name AS tenantName, s.partner_code_used_at AS usedAt, s.partner_code_hash AS hash
           FROM subcontractors s JOIN tenants te ON te.id = s.tenant_id WHERE s.partner_code_hash = ? AND s.deleted_at IS NULL`,
      )
        .bind(hash)
        .first<Partner>()
    : null;
  if (!p) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Zugang');
  }
  if ((p.usedAt ?? 0) < now() - 60_000) c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE subcontractors SET partner_code_used_at = ? WHERE id = ?').bind(now(), p.id).run());
  return p;
}

/** Referenz eines Auftrags auf der Partner-Seite: aus Code-Hash und Aufgaben-ID abgeleitet, verrät die ID nicht. */
const refOf = async (p: Partner, taskId: string) => (await sha256Hex(`${p.hash}:${taskId}`)).slice(0, 20);

/** Offene Aufträge der Firma, je mit Referenz. */
async function openTasks(c: Ctx, p: Partner) {
  const rows = (
    await c.env.DB.prepare(`${PUBLIC_TASK_SQL} WHERE t.tenant_id = ? AND t.subcontractor_id = ? AND t.status IN ('open','in_progress') ORDER BY t.due_at IS NULL, t.due_at LIMIT 500`)
      .bind(p.tenantId, p.id)
      .all<Record<string, unknown>>()
  ).results;
  return Promise.all(rows.map(async (r) => ({ ref: await refOf(p, r.id as string), row: r })));
}

async function taskByRef(c: Ctx, p: Partner) {
  const ref = c.req.param('ref') ?? '';
  const hit = (await openTasks(c, p)).find((t) => t.ref === ref);
  if (!hit) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Auftrag');
  }
  return hit;
}

partnerPublic.get('/partner/:code', async (c) => {
  const p = await partnerByCode(c);
  const tasks = await openTasks(c, p);
  return c.json({ company: p.company, tenantName: p.tenantName, tasks: tasks.map((t) => ({ ref: t.ref, ...publicTask(t.row) })) });
});

partnerPublic.get('/partner/:code/tasks/:ref', async (c) => {
  const p = await partnerByCode(c);
  const t = await taskByRef(c, p);
  return c.json({ ref: t.ref, ...publicTask(t.row) });
});

partnerPublic.get('/partner/:code/tasks/:ref/photo', async (c) => {
  const p = await partnerByCode(c);
  return publicTaskPhoto(c, (await taskByRef(c, p)).row);
});

partnerPublic.post('/partner/:code/tasks/:ref', async (c) => {
  const p = await partnerByCode(c);
  const t = await taskByRef(c, p);
  await externalUpdate(c, t.row, await c.req.json());
  return c.json({ ok: true });
});
