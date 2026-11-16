// Befähigungsnachweise je Mitglied (Plan v7, Paket X, Migration 0028).
// Lesen: alle Mitglieder des Workspaces (die Nachweise stehen ohnehin auf jedem Protokoll).
// Ändern: die Person selbst (ab Prüfer) oder Admins für alle; API-Schlüssel haben höchstens Prüferrechte,
// ändern also nur die Nachweise der Person, die den Schlüssel erstellt hat.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CREDENTIAL_KINDS, type CredentialKind } from '../shared/credentials';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, RANK, requireRole } from './lib';

export const credentials = new Hono<AppEnv>();
const tid = (c: Ctx) => c.get('user').tenantId;

const SELECT = `SELECT c.id, c.user_id AS userId, c.kind, c.title, c.issuer, c.number, c.valid_until AS validUntil, c.categories, c.updated_at AS updatedAt
                  FROM member_credentials c`;
type Row = { id: string; userId: string; kind: CredentialKind; title: string; issuer: string; number: string; validUntil: number | null; categories: string; updatedAt: number };
const out = (r: Row) => ({ ...r, categories: parseJson<string[]>(r.categories, []) });

const body = z.object({
  kind: z.enum(Object.keys(CREDENTIAL_KINDS) as [CredentialKind]),
  title: z.string().trim().max(200).default(''),
  issuer: z.string().trim().max(120).default(''),
  number: z.string().trim().max(80).default(''),
  validUntil: z.number().int().min(0).max(8_000_000_000_000).nullable().default(null),
  categories: z.array(z.string().trim().regex(/^[a-z0-9_-]{1,40}$/)).max(30).default([]),
});

/** Darf die angemeldete Person die Nachweise von `userId` ändern? Selbst ab Prüfer, andere nur als Admin. */
function assertMayEdit(c: Ctx, userId: string) {
  const u = c.get('user');
  if (userId === u.userId) requireRole(c, 'inspector');
  else if (RANK[u.role] < RANK.admin) throw new HTTPException(403, { message: 'Nachweise anderer Mitglieder ändern nur Admins' });
}

async function assertMember(c: Ctx, userId: string) {
  const m = await c.env.DB.prepare('SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tid(c), userId).first();
  if (!m) notFound('Mitglied');
}

/** Alle Nachweise im Workspace (optional einer Person). */
credentials.get('/credentials', async (c) => {
  const userId = c.req.query('userId');
  const rows = await c.env.DB.prepare(`${SELECT} WHERE c.tenant_id = ?1 ${userId ? 'AND c.user_id = ?2' : ''} ORDER BY c.user_id, c.valid_until IS NULL DESC, c.valid_until DESC, c.created_at`)
    .bind(...(userId ? [tid(c), userId] : [tid(c)]))
    .all<Row>();
  return c.json(rows.results.map(out));
});

credentials.post('/credentials', async (c) => {
  const raw = (await c.req.json()) as Record<string, unknown>;
  const userId = z.string().regex(/^[a-z0-9]{1,40}$/).optional().parse(raw.userId) ?? c.get('user').userId;
  assertMayEdit(c, userId);
  const b = body.parse(raw);
  await assertMember(c, userId);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM member_credentials WHERE tenant_id = ? AND user_id = ?').bind(tid(c), userId).first<number>('n');
  if ((count ?? 0) >= 50) throw new HTTPException(400, { message: 'Höchstens 50 Nachweise je Person' });
  const cid = id();
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO member_credentials (id, tenant_id, user_id, kind, title, issuer, number, valid_until, categories, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(cid, tid(c), userId, b.kind, b.title, b.issuer, b.number, b.validUntil, JSON.stringify([...new Set(b.categories)]), c.get('user').userId, t, t)
    .run();
  await logActivity(c, 'create', 'member', userId, `Nachweis hinzugefügt: ${b.title || CREDENTIAL_KINDS[b.kind]}`);
  return c.json({ id: cid });
});

async function load(c: Ctx) {
  const r = await c.env.DB.prepare(`${SELECT} WHERE c.id = ? AND c.tenant_id = ?`).bind(c.req.param('id'), tid(c)).first<Row>();
  if (!r) notFound('Nachweis');
  return r;
}

credentials.put('/credentials/:id', async (c) => {
  const cur = await load(c);
  assertMayEdit(c, cur.userId);
  const b = body.parse(await c.req.json());
  await c.env.DB.prepare('UPDATE member_credentials SET kind=?, title=?, issuer=?, number=?, valid_until=?, categories=?, updated_at=? WHERE id=? AND tenant_id=?')
    .bind(b.kind, b.title, b.issuer, b.number, b.validUntil, JSON.stringify([...new Set(b.categories)]), now(), cur.id, tid(c))
    .run();
  await logActivity(c, 'update', 'member', cur.userId, `Nachweis geändert: ${b.title || CREDENTIAL_KINDS[b.kind]}`);
  return c.json({ ok: true });
});

credentials.delete('/credentials/:id', async (c) => {
  const cur = await load(c);
  assertMayEdit(c, cur.userId);
  await c.env.DB.prepare('DELETE FROM member_credentials WHERE id = ? AND tenant_id = ?').bind(cur.id, tid(c)).run();
  await logActivity(c, 'delete', 'member', cur.userId, `Nachweis entfernt: ${cur.title || CREDENTIAL_KINDS[cur.kind]}`);
  return c.json({ ok: true });
});
