import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ROLES } from '../shared/catalog';
import { LEGAL_DOCS } from '../shared/legal';
import { notifyTenant } from './notify';
import {
  type AppEnv,
  type Ctx,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  id,
  logActivity,
  now,
  requireAuth,
  requireRole,
  token,
  verifyPassword,
} from './lib';

const password = z.string().min(10, 'Passwort braucht mindestens 10 Zeichen').max(200);

async function startSession(c: Ctx, userId: string, tenantId: string) {
  const sid = token();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, tenant_id, expires_at, created_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?,?)')
    .bind(sid, userId, tenantId, now() + SESSION_TTL_MS, now(), now(), (c.req.header('user-agent') ?? '').slice(0, 300))
    .run();
  setCookie(c, SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const auth = new Hono<AppEnv>();

auth.post('/register', async (c) => {
  const body = z
    .object({ company: z.string().trim().min(2).max(120), name: z.string().trim().min(2).max(120), email: z.string().trim().email(), password })
    .parse(await c.req.json());
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(body.email).first();
  if (exists) throw new HTTPException(409, { message: 'Diese E-Mail ist bereits registriert' });
  const t = now();
  const tenantId = id();
  const userId = id();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)').bind(tenantId, body.company, t),
    c.env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)').bind(
      userId,
      body.email,
      body.name,
      await hashPassword(body.password),
      t,
    ),
    c.env.DB.prepare('INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?,?,?,?)').bind(tenantId, userId, 'owner', t),
    // Die Registrierung gilt als Zustimmung zu den aktuellen Rechtstexten (Hinweis im Formular)
    ...LEGAL_DOCS.map((d) =>
      c.env.DB.prepare('INSERT INTO legal_acks (id, user_id, doc, version, accepted_at, user_agent) VALUES (?,?,?,?,?,?)').bind(
        id(),
        userId,
        d.key,
        d.version,
        t,
        (c.req.header('user-agent') ?? '').slice(0, 200),
      ),
    ),
  ]);
  await startSession(c, userId, tenantId);
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  const body = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(await c.req.json());
  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(body.email)
    .first<{ id: string; password_hash: string }>();
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    throw new HTTPException(401, { message: 'E-Mail oder Passwort falsch' });
  }
  const m = await c.env.DB.prepare('SELECT tenant_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1')
    .bind(user.id)
    .first<{ tenant_id: string }>();
  if (!m) throw new HTTPException(403, { message: 'Kein Workspace zugeordnet' });
  await startSession(c, user.id, m.tenant_id);
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Passwort über einen vom Admin erzeugten Link neu setzen. */
auth.get('/reset/:token', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT u.email, u.name FROM password_resets pr JOIN users u ON u.id = pr.user_id WHERE pr.token = ? AND pr.used_at IS NULL AND pr.expires_at > ?',
  )
    .bind(c.req.param('token'), now())
    .first();
  if (!r) throw new HTTPException(404, { message: 'Link ungültig oder abgelaufen' });
  return c.json(r);
});

auth.post('/reset/:token', async (c) => {
  const { password: pw } = z.object({ password }).parse(await c.req.json());
  const r = await c.env.DB.prepare('SELECT user_id FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > ?')
    .bind(c.req.param('token'), now())
    .first<{ user_id: string }>();
  if (!r) throw new HTTPException(404, { message: 'Link ungültig oder abgelaufen' });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pw), r.user_id),
    c.env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE token = ?').bind(now(), c.req.param('token')),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(r.user_id),
  ]);
  return c.json({ ok: true });
});

auth.get('/legal', (c) => c.json(LEGAL_DOCS));

auth.get('/invite/:token', async (c) => {
  const inv = await c.env.DB.prepare(
    `SELECT i.email, i.role, t.name AS company FROM invites i JOIN tenants t ON t.id = i.tenant_id
      WHERE i.token = ? AND i.accepted_at IS NULL`,
  )
    .bind(c.req.param('token'))
    .first();
  if (!inv) throw new HTTPException(404, { message: 'Einladung ungültig oder bereits verwendet' });
  const known = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(inv.email).first();
  return c.json({ ...inv, existingUser: !!known });
});

auth.post('/invite/:token', async (c) => {
  const inv = await c.env.DB.prepare('SELECT id, tenant_id, email, role FROM invites WHERE token = ? AND accepted_at IS NULL')
    .bind(c.req.param('token'))
    .first<{ id: string; tenant_id: string; email: string; role: string }>();
  if (!inv) throw new HTTPException(404, { message: 'Einladung ungültig oder bereits verwendet' });
  const body = z.object({ name: z.string().trim().min(2).max(120).optional(), password }).parse(await c.req.json());
  const t = now();
  let user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(inv.email)
    .first<{ id: string; password_hash: string }>();
  if (user) {
    if (!(await verifyPassword(body.password, user.password_hash))) throw new HTTPException(401, { message: 'Passwort falsch' });
  } else {
    if (!body.name) throw new HTTPException(400, { message: 'Name fehlt' });
    user = { id: id(), password_hash: await hashPassword(body.password) };
    await c.env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)')
      .bind(user.id, inv.email, body.name, user.password_hash, t)
      .run();
  }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO memberships (tenant_id, user_id, role, created_at) VALUES (?,?,?,?)').bind(
      inv.tenant_id,
      user.id,
      inv.role,
      t,
    ),
    c.env.DB.prepare('UPDATE invites SET accepted_at = ? WHERE id = ?').bind(t, inv.id),
  ]);
  const who = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(user.id).first<string>('name');
  await notifyTenant(c.env, inv.tenant_id, { roles: ['owner', 'admin'], type: 'member_joined', title: `${who} ist dem Team beigetreten`, link: '/team' }, c.executionCtx);
  await startSession(c, user.id, inv.tenant_id);
  return c.json({ ok: true });
});

// --- angemeldet ---
export const account = new Hono<AppEnv>();
account.use('*', requireAuth);
// „Zuletzt aktiv“ höchstens alle 5 Minuten aktualisieren
account.use('*', async (c, next) => {
  await next();
  const u = c.get('user');
  if (u) c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND COALESCE(last_seen_at, 0) < ?').bind(now(), u.sessionId, now() - 300_000).run());
});

account.get('/me', async (c) => {
  const u = c.get('user');
  const tenant = await c.env.DB.prepare(
    `SELECT id, name, logo_key AS logoKey, address, phone, email, website, pdf_pattern AS pdfPattern, archive_after_months AS archiveAfterMonths
       FROM tenants WHERE id = ?`,
  )
    .bind(u.tenantId)
    .first();
  const acks = (await c.env.DB.prepare('SELECT doc, version FROM legal_acks WHERE user_id = ?').bind(u.userId).all<{ doc: string; version: string }>()).results;
  const pendingLegal = LEGAL_DOCS.filter((d) => !acks.some((a) => a.doc === d.key && a.version === d.version)).map((d) => d.key);
  const workspaces = await c.env.DB.prepare(
    'SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.name',
  )
    .bind(u.userId)
    .all();
  return c.json({ user: { id: u.userId, name: u.name, email: u.email, role: u.role }, tenant, workspaces: workspaces.results, pendingLegal });
});

account.post('/switch', async (c) => {
  const { tenantId } = z.object({ tenantId: z.string() }).parse(await c.req.json());
  const u = c.get('user');
  const m = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE user_id = ? AND tenant_id = ?').bind(u.userId, tenantId).first();
  if (!m) throw new HTTPException(403, { message: 'Kein Zugriff' });
  await c.env.DB.prepare('UPDATE sessions SET tenant_id = ? WHERE id = ?').bind(tenantId, u.sessionId).run();
  return c.json({ ok: true });
});

account.patch('/profile', async (c) => {
  const body = z
    .object({ name: z.string().trim().min(2).max(120).optional(), currentPassword: z.string().optional(), newPassword: password.optional() })
    .parse(await c.req.json());
  const u = c.get('user');
  if (body.name) await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name, u.userId).run();
  if (body.newPassword) {
    const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.userId).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(body.currentPassword ?? '', row.password_hash))) {
      throw new HTTPException(401, { message: 'Aktuelles Passwort falsch' });
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(body.newPassword), u.userId),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(u.userId, u.sessionId),
    ]);
  }
  return c.json({ ok: true });
});

account.patch('/company', async (c) => {
  requireRole(c, 'admin');
  const b = z
    .object({
      name: z.string().trim().min(2).max(120),
      address: z.string().trim().max(400).default(''),
      phone: z.string().trim().max(60).default(''),
      email: z.union([z.literal(''), z.string().trim().email()]).default(''),
      website: z.string().trim().max(200).default(''),
      logoKey: z.string().max(200).nullable().optional(),
      pdfPattern: z.string().trim().min(3).max(120).optional(),
      archiveAfterMonths: z.number().int().min(6).max(240).nullable().optional(),
    })
    .parse(await c.req.json());
  const t = c.get('user').tenantId;
  if (b.logoKey && !b.logoKey.startsWith(`${t}/`)) throw new HTTPException(400, { message: 'Ungültige Datei' });
  await c.env.DB.prepare(
    `UPDATE tenants SET name = ?, address = ?, phone = ?, email = ?, website = ?,
            logo_key = CASE WHEN ? THEN ? ELSE logo_key END,
            pdf_pattern = COALESCE(?, pdf_pattern),
            archive_after_months = CASE WHEN ? THEN ? ELSE archive_after_months END
      WHERE id = ?`,
  )
    .bind(b.name, b.address, b.phone, b.email, b.website, b.logoKey !== undefined ? 1 : 0, b.logoKey ?? null, b.pdfPattern ?? null,
      b.archiveAfterMonths !== undefined ? 1 : 0, b.archiveAfterMonths ?? null, t)
    .run();
  await logActivity(c, 'update', 'tenant', null, 'Firmenprofil geändert');
  return c.json({ ok: true });
});

/** Weiteren Workspace anlegen (eigene Firma/Mandant). */
account.post('/workspaces', async (c) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(await c.req.json());
  const u = c.get('user');
  const tenantId = id();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)').bind(tenantId, name, now()),
    c.env.DB.prepare('INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?,?,?,?)').bind(tenantId, u.userId, 'owner', now()),
    c.env.DB.prepare('UPDATE sessions SET tenant_id = ? WHERE id = ?').bind(tenantId, u.sessionId),
  ]);
  return c.json({ id: tenantId });
});

// ---------- Sitzungen ----------
account.get('/sessions', async (c) => {
  const u = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, user_agent AS userAgent, expires_at AS expiresAt
       FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC`,
  )
    .bind(u.userId, now())
    .all<{ id: string }>();
  // Sitzungs-IDs sind Geheimnisse: nur gekürzt ausliefern
  return c.json(rows.results.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === u.sessionId })));
});

account.delete('/sessions/:prefix', async (c) => {
  const u = c.get('user');
  const p = c.req.param('prefix');
  if (p === 'others') {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(u.userId, u.sessionId).run();
  } else {
    if (p.length !== 12) throw new HTTPException(400, { message: 'Ungültige Sitzung' });
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 12) = ?').bind(u.userId, p).run();
  }
  return c.json({ ok: true });
});

// ---------- Rechtstexte ----------
account.post('/legal/accept', async (c) => {
  const { docs } = z.object({ docs: z.array(z.string()).min(1) }).parse(await c.req.json());
  const u = c.get('user');
  const ua = (c.req.header('user-agent') ?? '').slice(0, 300);
  const stmts = LEGAL_DOCS.filter((d) => docs.includes(d.key)).map((d) =>
    c.env.DB.prepare('INSERT INTO legal_acks (id, user_id, doc, version, accepted_at, user_agent) VALUES (?,?,?,?,?,?)').bind(id(), u.userId, d.key, d.version, now(), ua),
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

account.get('/legal/history', async (c) => {
  const rows = await c.env.DB.prepare('SELECT doc, version, accepted_at AS acceptedAt, user_agent AS userAgent FROM legal_acks WHERE user_id = ? ORDER BY accepted_at DESC')
    .bind(c.get('user').userId)
    .all();
  return c.json(rows.results);
});

// ---------- DSGVO ----------
account.get('/export', async (c) => {
  const u = c.get('user');
  const q = (sql: string, ...args: unknown[]) => c.env.DB.prepare(sql).bind(...args).all().then((r) => r.results);
  const data = {
    exportedAt: new Date().toISOString(),
    user: await c.env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(u.userId).first(),
    memberships: await q('SELECT m.tenant_id, t.name AS tenant, m.role, m.created_at FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ?', u.userId),
    sessions: await q('SELECT created_at, last_seen_at, user_agent, expires_at FROM sessions WHERE user_id = ?', u.userId),
    legalAcknowledgments: await q('SELECT doc, version, accepted_at, user_agent FROM legal_acks WHERE user_id = ?', u.userId),
    activity: await q('SELECT tenant_id, action, entity, summary, created_at FROM activity WHERE user_id = ? ORDER BY created_at', u.userId),
    inspections: await q('SELECT id, tenant_id, asset_id, status, result, inspected_at FROM inspections WHERE inspector_id = ?', u.userId),
    taskComments: await q('SELECT task_id, body, created_at FROM task_comments WHERE user_id = ?', u.userId),
    notifications: await q('SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = ?', u.userId),
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="meine-daten.json"' },
  });
});

/** Eigenes Konto löschen: personenbezogene Daten werden entfernt, Prüfnachweise bleiben (anonymisiert). */
account.post('/delete', async (c) => {
  const { password: pw } = z.object({ password: z.string().min(1) }).parse(await c.req.json());
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.userId).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(pw, row.password_hash))) throw new HTTPException(401, { message: 'Passwort falsch' });
  const soleOwner = await c.env.DB.prepare(
    `SELECT t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ?1 AND m.role = 'owner'
       AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.tenant_id = m.tenant_id AND o.role = 'owner' AND o.user_id != ?1)
       AND EXISTS (SELECT 1 FROM memberships o WHERE o.tenant_id = m.tenant_id AND o.user_id != ?1)`,
  )
    .bind(u.userId)
    .first<{ name: string }>();
  if (soleOwner) throw new HTTPException(409, { message: `Du bist alleinige/r Inhaber/in von „${soleOwner.name}“. Übertrage zuerst die Inhaberschaft.` });
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.userId),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(u.userId),
    c.env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(u.userId),
    c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(u.userId),
    c.env.DB.prepare('DELETE FROM memberships WHERE user_id = ?').bind(u.userId),
    c.env.DB.prepare('UPDATE tasks SET assignee_id = NULL WHERE assignee_id = ?').bind(u.userId),
    c.env.DB.prepare("UPDATE task_comments SET author_name = 'Gelöschte Person', user_id = NULL WHERE user_id = ?").bind(u.userId),
    c.env.DB.prepare("UPDATE users SET name = 'Gelöschte Person', email = ?, password_hash = '' WHERE id = ?").bind(`geloescht-${u.userId}@invalid`, u.userId),
  ]);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

account.get('/members', async (c) => {
  const u = c.get('user');
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, m.role, m.created_at AS joinedAt FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ? ORDER BY u.name`,
  )
    .bind(u.tenantId)
    .all();
  const invites = await c.env.DB.prepare(
    'SELECT id, email, role, token, created_at AS createdAt FROM invites WHERE tenant_id = ? AND accepted_at IS NULL ORDER BY created_at DESC',
  )
    .bind(u.tenantId)
    .all();
  return c.json({ members: members.results, invites: RANKED(u.role) ? invites.results : [] });
});
const RANKED = (r: string) => r === 'owner' || r === 'admin';

const roleEnum = z.enum(Object.keys(ROLES).filter((r) => r !== 'owner') as ['admin', 'inspector', 'viewer']);

account.post('/members/invite', async (c) => {
  requireRole(c, 'admin');
  const body = z.object({ email: z.string().trim().email(), role: roleEnum }).parse(await c.req.json());
  const u = c.get('user');
  const already = await c.env.DB.prepare(
    'SELECT 1 FROM memberships m JOIN users us ON us.id = m.user_id WHERE m.tenant_id = ? AND us.email = ?',
  )
    .bind(u.tenantId, body.email)
    .first();
  if (already) throw new HTTPException(409, { message: 'Person ist bereits Mitglied' });
  const tok = token();
  await c.env.DB.prepare('INSERT INTO invites (id, tenant_id, email, role, token, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(id(), u.tenantId, body.email, body.role, tok, u.userId, now())
    .run();
  await logActivity(c, 'invite', 'member', null, `${body.email} eingeladen (${ROLES[body.role]})`);
  return c.json({ token: tok });
});

account.delete('/members/invite/:id', async (c) => {
  requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM invites WHERE id = ? AND tenant_id = ?').bind(c.req.param('id'), c.get('user').tenantId).run();
  return c.json({ ok: true });
});

account.patch('/members/:userId', async (c) => {
  requireRole(c, 'admin');
  const { role } = z.object({ role: roleEnum }).parse(await c.req.json());
  const u = c.get('user');
  const target = c.req.param('userId');
  const cur = await c.env.DB.prepare('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(u.tenantId, target)
    .first<{ role: string }>();
  if (!cur) throw new HTTPException(404, { message: 'Mitglied nicht gefunden' });
  if (cur.role === 'owner') throw new HTTPException(400, { message: 'Die Inhaber-Rolle kann nicht geändert werden' });
  await c.env.DB.prepare('UPDATE memberships SET role = ? WHERE tenant_id = ? AND user_id = ?').bind(role, u.tenantId, target).run();
  return c.json({ ok: true });
});

/** Admin erzeugt einmaligen Link zum Neusetzen des Passworts (24 h gültig). */
account.post('/members/:userId/reset-link', async (c) => {
  requireRole(c, 'admin');
  const u = c.get('user');
  const target = await c.env.DB.prepare('SELECT m.role FROM memberships m WHERE m.tenant_id = ? AND m.user_id = ?')
    .bind(u.tenantId, c.req.param('userId'))
    .first<{ role: string }>();
  if (!target) throw new HTTPException(404, { message: 'Mitglied nicht gefunden' });
  if (target.role === 'owner' && u.role !== 'owner') throw new HTTPException(403, { message: 'Nur Inhaber können Links für Inhaber erzeugen' });
  const tok = token();
  await c.env.DB.prepare('INSERT INTO password_resets (token, user_id, created_by, expires_at) VALUES (?,?,?,?)')
    .bind(tok, c.req.param('userId'), u.userId, now() + 86_400_000)
    .run();
  await logActivity(c, 'reset', 'member', c.req.param('userId'), 'Link zum Zurücksetzen des Passworts erzeugt');
  return c.json({ token: tok });
});

/** Inhaberschaft übertragen (bisherige/r Inhaber/in wird Admin). */
account.post('/members/:userId/transfer-ownership', async (c) => {
  const u = c.get('user');
  if (u.role !== 'owner') throw new HTTPException(403, { message: 'Nur Inhaber' });
  const target = c.req.param('userId');
  const m = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(u.tenantId, target).first();
  if (!m || target === u.userId) throw new HTTPException(400, { message: 'Ungültiges Mitglied' });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE memberships SET role = 'owner' WHERE tenant_id = ? AND user_id = ?").bind(u.tenantId, target),
    c.env.DB.prepare("UPDATE memberships SET role = 'admin' WHERE tenant_id = ? AND user_id = ?").bind(u.tenantId, u.userId),
  ]);
  await logActivity(c, 'update', 'member', target, 'Inhaberschaft übertragen');
  return c.json({ ok: true });
});

account.delete('/members/:userId', async (c) => {
  requireRole(c, 'admin');
  const u = c.get('user');
  const target = c.req.param('userId');
  const cur = await c.env.DB.prepare('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(u.tenantId, target)
    .first<{ role: string }>();
  if (!cur) throw new HTTPException(404, { message: 'Mitglied nicht gefunden' });
  if (cur.role === 'owner') throw new HTTPException(400, { message: 'Inhaber kann nicht entfernt werden' });
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(u.tenantId, target),
    c.env.DB.prepare('DELETE FROM sessions WHERE tenant_id = ? AND user_id = ?').bind(u.tenantId, target),
  ]);
  return c.json({ ok: true });
});

account.get('/activity', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.summary, a.created_at AS createdAt, u.name AS userName
       FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.tenant_id = ? ORDER BY a.created_at DESC LIMIT 200`,
  )
    .bind(c.get('user').tenantId)
    .all();
  return c.json(rows.results);
});
