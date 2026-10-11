import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Role } from '../shared/catalog';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  email: string;
  /** gesetzt, wenn die Anfrage per API-Schlüssel statt Sitzung kommt */
  apiKeyId?: string;
  /** Zugriffsbereich (nur Prüfer/Lesezugriff); null = gesamter Workspace */
  scope?: Scope | null;
  /** darf neue Elemente anlegen */
  canCreate?: boolean;
}

/** Aufgelöster Zugriffsbereich: erlaubte Gebäude und die Objekte, zu denen sie gehören. */
export interface Scope {
  properties: string[];
  buildings: string[];
  /** vollständig freigegebene Objekte (nicht nur einzelne Gebäude) */
  fullProperties: string[];
}
/** Gespeicherte Form in `memberships.scope`. */
export interface ScopeSetting {
  propertyIds: string[];
  buildingIds: string[];
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

/** Nur Browser-Sitzung (Konto, Benachrichtigungen, Push). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (bearer(c)) throw new HTTPException(403, { message: 'Mit API-Schlüssel nicht verfügbar' });
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) throw new HTTPException(401, { message: 'Nicht angemeldet' });
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sessionId, s.user_id AS userId, s.tenant_id AS tenantId, s.expires_at, m.role, m.scope AS rawScope, m.can_create AS canCreate, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.tenant_id = s.tenant_id
      WHERE s.id = ?`,
  )
    .bind(sid)
    .first<Omit<SessionUser, 'scope' | 'canCreate'> & { expires_at: number; rawScope: string | null; canCreate: number }>();
  if (!row || row.expires_at < now()) throw new HTTPException(401, { message: 'Sitzung abgelaufen' });
  const { rawScope, canCreate, expires_at: _, ...user } = row;
  c.set('user', { ...user, ...(await resolveScope(c, user.tenantId, user.role, rawScope, canCreate)) });
  await next();
};

export const API_KEY_PREFIX = 'pk_';
const bearer = (c: Ctx) => {
  const h = c.req.header('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sitzung oder API-Schlüssel. Ein Schlüssel handelt im Namen der Person, die ihn erstellt hat,
 * höchstens mit Rolle „Lesezugriff“ (read) bzw. „Prüfer“ (write) – und nie mit mehr Rechten als sie selbst.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = bearer(c);
  if (!key) return requireSession(c, next);
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  const reject = async (message: string): Promise<never> => {
    await recordFailure(c, 'token-ip', clientIp(c));
    throw new HTTPException(401, { message });
  };
  if (!key.startsWith(API_KEY_PREFIX)) return reject('Ungültiger API-Schlüssel');
  const row = await c.env.DB.prepare(
    `SELECT k.id, k.tenant_id, k.scope, k.name, k.expires_at, k.revoked_at, k.last_used_at, k.created_by, m.role, m.scope AS rawScope, m.can_create AS canCreate
       FROM api_keys k JOIN memberships m ON m.user_id = k.created_by AND m.tenant_id = k.tenant_id
      WHERE k.key_hash = ?`,
  )
    .bind(await sha256Hex(key))
    .first<{ id: string; tenant_id: string; scope: 'read' | 'write'; name: string; expires_at: number | null; revoked_at: number | null; last_used_at: number | null; created_by: string; role: Role; rawScope: string | null; canCreate: number }>();
  if (!row || row.revoked_at || (row.expires_at && row.expires_at < now())) return reject('Ungültiger oder widerrufener API-Schlüssel');
  const cap: Role = row.scope === 'write' ? 'inspector' : 'viewer';
  const role = RANK[row.role] < RANK[cap] ? row.role : cap;
  c.set('user', {
    sessionId: `api:${row.id}`,
    userId: row.created_by,
    tenantId: row.tenant_id,
    role,
    name: `API: ${row.name}`,
    email: '',
    apiKeyId: row.id,
    // Bereich der Person, die den Schlüssel erstellt hat (falls sie inzwischen eingeschränkt wurde)
    ...(await resolveScope(c, row.tenant_id, row.role, row.rawScope, row.canCreate)),
  });
  if ((row.last_used_at ?? 0) < now() - 60_000) c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(now(), row.id).run());
  await next();
};

/** Persönliche Bereiche (Benachrichtigungen, Push) nur mit Browser-Sitzung. */
export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user')?.apiKeyId) throw new HTTPException(403, { message: 'Mit API-Schlüssel nicht verfügbar' });
  await next();
};

/** Schreibende Requests brauchen einen eigenen Header (CSRF-Schutz zusätzlich zu SameSite). */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Mit API-Schlüssel (Authorization-Header) gibt es kein Cookie-Risiko
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('x-pk') !== '1' && !c.req.header('authorization')?.startsWith('Bearer ')) {
    throw new HTTPException(403, { message: 'Ungültige Anfrage' });
  }
  await next();
};

export const RANK: Record<Role, number> = { viewer: 0, inspector: 1, admin: 2, owner: 3 };

const SAFE_ID = /^[a-z0-9]{1,40}$/;

/** Gespeicherten Bereich in erlaubte Gebäude/Objekte auflösen. Admins und Inhaber sind nie eingeschränkt. */
async function resolveScope(c: Ctx, tenantId: string, role: Role, raw: string | null, canCreate: number): Promise<Pick<SessionUser, 'scope' | 'canCreate'>> {
  if (RANK[role] >= RANK.admin) return { scope: null, canCreate: true };
  const set = parseJson<ScopeSetting | null>(raw, null);
  if (!set) return { scope: null, canCreate: !!canCreate };
  const rows = (
    await c.env.DB.prepare(
      `SELECT id, property_id FROM buildings WHERE tenant_id = ? AND deleted_at IS NULL
          AND (property_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?)))`,
    )
      .bind(tenantId, JSON.stringify(set.propertyIds ?? []), JSON.stringify(set.buildingIds ?? []))
      .all<{ id: string; property_id: string }>()
  ).results;
  return {
    scope: {
      buildings: rows.map((r) => r.id),
      properties: [...new Set([...(set.propertyIds ?? []), ...rows.map((r) => r.property_id)])],
      fullProperties: set.propertyIds ?? [],
    },
    canCreate: !!canCreate,
  };
}

/**
 * SQL-Bedingung für den Zugriffsbereich: `col` ist eine Gebäude- bzw. Objekt-ID-Spalte.
 * Die IDs stammen aus der Datenbank und werden zusätzlich auf [a-z0-9] geprüft, bevor sie als Literale eingesetzt werden.
 */
export function scopeSql(c: Ctx, col: string, kind: 'building' | 'property'): string {
  const s = c.get('user').scope;
  if (!s) return '1=1';
  const ids = (kind === 'building' ? s.buildings : s.properties).filter((x) => SAFE_ID.test(x));
  return ids.length ? `${col} IN (${ids.map((x) => `'${x}'`).join(',')})` : '0=1';
}

/** Gebäude/Objekt im Zugriffsbereich? Sonst 404 (Existenz nicht verraten). */
export function assertInScope(c: Ctx, kind: 'building' | 'property', idValue: string | null | undefined) {
  const s = c.get('user').scope;
  if (!s) return;
  if (!idValue || !(kind === 'building' ? s.buildings : s.properties).includes(idValue)) notFound(kind === 'building' ? 'Gebäude' : 'Objekt');
}

/** Eingeschränkte Mitglieder ohne Anlegerecht dürfen keine neuen Elemente anlegen. */
export function requireCreate(c: Ctx) {
  if (c.get('user').canCreate === false) throw new HTTPException(403, { message: 'Keine Berechtigung, neue Einträge anzulegen' });
}

/** Für Bereiche ohne Objektbezug (Import, Workspace-Berichte): nur ohne Einschränkung. */
export function requireUnscoped(c: Ctx) {
  if (c.get('user').scope) throw new HTTPException(403, { message: 'Nur ohne eingeschränkten Zugriffsbereich möglich' });
}

export function requireRole(c: Ctx, min: Role) {
  if (RANK[c.get('user').role] < RANK[min]) throw new HTTPException(403, { message: 'Keine Berechtigung' });
}

export async function logActivity(c: Ctx, action: string, entity: string, entityId: string | null, summary: string) {
  const u = c.get('user');
  await c.env.DB.prepare(
    'INSERT INTO activity (id, tenant_id, user_id, action, entity, entity_id, summary, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(id(), u.tenantId, u.userId, action, entity, entityId, u.apiKeyId ? `${summary} (${u.name})` : summary, now())
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
