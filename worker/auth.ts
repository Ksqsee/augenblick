import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ROLES } from '../shared/catalog';
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
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, tenant_id, expires_at) VALUES (?,?,?,?)')
    .bind(sid, userId, tenantId, now() + SESSION_TTL_MS)
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
  await startSession(c, user.id, inv.tenant_id);
  return c.json({ ok: true });
});

// --- angemeldet ---
export const account = new Hono<AppEnv>();
account.use('*', requireAuth);

account.get('/me', async (c) => {
  const u = c.get('user');
  const tenant = await c.env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(u.tenantId).first();
  const workspaces = await c.env.DB.prepare(
    'SELECT t.id, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ? ORDER BY t.name',
  )
    .bind(u.userId)
    .all();
  return c.json({ user: { id: u.userId, name: u.name, email: u.email, role: u.role }, tenant, workspaces: workspaces.results });
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
  const { name } = z.object({ name: z.string().trim().min(2).max(120) }).parse(await c.req.json());
  await c.env.DB.prepare('UPDATE tenants SET name = ? WHERE id = ?').bind(name, c.get('user').tenantId).run();
  await logActivity(c, 'update', 'tenant', null, `Firmenname geändert: ${name}`);
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
