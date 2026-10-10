import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Role } from '../shared/catalog';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  email: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
export type Ctx = Context<AppEnv>;

export const SESSION_COOKIE = 'pk_session';
export const SESSION_TTL_MS = 30 * 86_400_000;

export const now = () => Date.now();

export function id(len = 16): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

const ITERATIONS = 100_000;

function b64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) throw new HTTPException(401, { message: 'Nicht angemeldet' });
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sessionId, s.user_id AS userId, s.tenant_id AS tenantId, s.expires_at, m.role, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
      WHERE s.id = ?`,
  )
    .bind(sid)
    .first<SessionUser & { expires_at: number }>();
  if (!row || row.expires_at < now()) throw new HTTPException(401, { message: 'Sitzung abgelaufen' });
  c.set('user', row);
  await next();
};

/** Schreibende Requests brauchen einen eigenen Header (CSRF-Schutz zusätzlich zu SameSite). */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-pk') !== '1') {
    throw new HTTPException(403, { message: 'Ungültige Anfrage' });
  }
  await next();
};

const RANK: Record<Role, number> = { viewer: 0, inspector: 1, admin: 2, owner: 3 };

export function requireRole(c: Ctx, min: Role) {
  if (RANK[c.get('user').role] < RANK[min]) throw new HTTPException(403, { message: 'Keine Berechtigung' });
}

export async function logActivity(c: Ctx, action: string, entity: string, entityId: string | null, summary: string) {
  const u = c.get('user');
  await c.env.DB.prepare(
    'INSERT INTO activity (id, tenant_id, user_id, action, entity, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(id(), u.tenantId, u.userId, action, entity, entityId, summary, now())
    .run();
}

export function notFound(what = 'Eintrag'): never {
  throw new HTTPException(404, { message: `${what} nicht gefunden` });
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
