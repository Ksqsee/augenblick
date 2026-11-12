// OAuth 2.1 für den MCP-Server (Claude & Co. verbinden sich per „Anmelden“ statt mit eingefügtem Schlüssel).
// Ablauf: dynamische Client-Registrierung → Freigabeseite in der App (/oauth/authorize) → Code (PKCE S256) → Token.
// Jede Freigabe ist an einen API-Schlüssel gebunden: entweder einen vorhandenen (eingefügt) oder einen neu erstellten.
// Access-Token (pko_…) und Refresh-Token (pkr_…) gelten nur, solange der Schlüssel gültig ist; widerrufen = getrennt.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type AppEnv, API_KEY_PREFIX, type Ctx, id, logActivity, now, requireRole, requireSession, sha256Hex, token } from './lib';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';

export const ACCESS_PREFIX = 'pko_';
const REFRESH_PREFIX = 'pkr_';
const CODE_TTL = 10 * 60_000;
const ACCESS_TTL = 60 * 60_000;
const REFRESH_TTL = 90 * 86_400_000;
export const SCOPES = ['read', 'write'] as const;

/** Metadaten nach RFC 9728 (geschützte Ressource) und RFC 8414 (Autorisierungsserver). */
export function wellKnown(req: Request): Response | null {
  const url = new URL(req.url);
  const o = url.origin;
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'max-age=300', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' } });
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return new Response(
      JSON.stringify({ resource: `${o}/api/mcp`, authorization_servers: [o], bearer_methods_supported: ['header'], scopes_supported: SCOPES, resource_name: 'Prüfkompass' }),
      { headers: cors },
    );
  }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) {
    return new Response(
      JSON.stringify({
        issuer: o,
        authorization_endpoint: `${o}/oauth/authorize`,
        token_endpoint: `${o}/api/oauth/token`,
        registration_endpoint: `${o}/api/oauth/register`,
        revocation_endpoint: `${o}/api/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: SCOPES,
      }),
      { headers: cors },
    );
  }
  return null;
}

export const resourceMetadataUrl = (c: Ctx) => `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource/api/mcp`;

/** Erlaubte Rücksprungadressen: https oder Loopback (lokale Clients wie Claude Code). */
function validRedirect(u: string) {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
  } catch {
    return false;
  }
}

async function s256(verifier: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const oauthError = (error: string, description: string, status = 400) =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
  });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

async function loadClient(c: Ctx, clientId: string, redirectUri?: string) {
  const row = await c.env.DB.prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?').bind(clientId).first<{ id: string; name: string; redirect_uris: string }>();
  if (!row) throw new HTTPException(400, { message: 'Unbekannte Anwendung' });
  const uris = JSON.parse(row.redirect_uris) as string[];
  if (redirectUri !== undefined && !uris.includes(redirectUri)) throw new HTTPException(400, { message: 'Rücksprungadresse ist für diese Anwendung nicht registriert' });
  return { ...row, uris };
}

/** Öffentliche OAuth-Endpunkte (ohne Sitzung) – CSRF-frei, weil ohne Cookies. */
export const oauthPublic = new Hono<AppEnv>();

oauthPublic.options('/oauth/*', () => new Response(null, { status: 204, headers: CORS }));

/** Dynamische Client-Registrierung (RFC 7591), nur öffentliche Clients mit PKCE. */
oauthPublic.post('/oauth/register', async (c) => {
  await assertNotThrottled(c, 'register-ip', clientIp(c));
  const b = await c.req.json().catch(() => null);
  const p = z
    .object({ client_name: z.string().trim().max(120).optional(), redirect_uris: z.array(z.string().max(500)).min(1).max(10) })
    .safeParse(b);
  if (!p.success || !p.data.redirect_uris.every(validRedirect)) return oauthError('invalid_redirect_uri', 'redirect_uris: nur https oder Loopback-Adressen');
  await recordFailure(c, 'register-ip', clientIp(c)); // zählt Registrierungen je IP (Missbrauchsschutz)
  const cid = `pkc_${token().slice(0, 24)}`;
  const name = p.data.client_name || new URL(p.data.redirect_uris[0]).hostname;
  await c.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)').bind(cid, name, JSON.stringify(p.data.redirect_uris), now()).run();
  return c.json(
    {
      client_id: cid,
      client_id_issued_at: Math.floor(now() / 1000),
      client_name: name,
      redirect_uris: p.data.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
    CORS,
  );
});

/** Angaben für die Freigabeseite. */
oauthPublic.get('/oauth/client', async (c) => {
  const cl = await loadClient(c, c.req.query('client_id') ?? '', c.req.query('redirect_uri') ?? '');
  return c.json({ name: cl.name, redirectHost: new URL(c.req.query('redirect_uri')!).host });
});

const authorizeBody = z.object({
  clientId: z.string().max(80),
  redirectUri: z.string().max(500),
  codeChallenge: z.string().min(43).max(128),
  codeChallengeMethod: z.literal('S256'),
  state: z.string().max(500).optional(),
});

async function issueCode(c: Ctx, b: z.infer<typeof authorizeBody>, apiKeyId: string, scope: string) {
  await loadClient(c, b.clientId, b.redirectUri);
  const code = token();
  await c.env.DB.prepare('INSERT INTO oauth_codes (code_hash, client_id, api_key_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(await sha256Hex(code), b.clientId, apiKeyId, b.redirectUri, b.codeChallenge, scope, now() + CODE_TTL)
    .run();
  const u = new URL(b.redirectUri);
  u.searchParams.set('code', code);
  if (b.state) u.searchParams.set('state', b.state);
  u.searchParams.set('iss', new URL(c.req.url).origin);
  return c.json({ redirectTo: u.toString() });
}

/** Freigabe mit einem vorhandenen API-Schlüssel (keine Anmeldung nötig). */
oauthPublic.post('/oauth/authorize/key', async (c) => {
  const b = authorizeBody.extend({ apiKey: z.string().max(200) }).parse(await c.req.json());
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  const row = b.apiKey.startsWith(API_KEY_PREFIX)
    ? await c.env.DB.prepare('SELECT id, scope, expires_at, revoked_at FROM api_keys WHERE key_hash = ?').bind(await sha256Hex(b.apiKey.trim())).first<{ id: string; scope: string; expires_at: number | null; revoked_at: number | null }>()
    : null;
  if (!row || row.revoked_at || (row.expires_at && row.expires_at < now())) {
    await recordFailure(c, 'token-ip', clientIp(c));
    throw new HTTPException(400, { message: 'Ungültiger oder widerrufener API-Schlüssel' });
  }
  return issueCode(c, b, row.id, row.scope);
});

/** Token-Endpunkt: Code gegen Tokens tauschen bzw. Refresh (mit Rotation). */
oauthPublic.post('/oauth/token', async (c) => {
  const ct = c.req.header('content-type') ?? '';
  const raw: Record<string, string> = ct.includes('application/json') ? await c.req.json().catch(() => ({})) : Object.fromEntries(new URLSearchParams(await c.req.text()));
  const DB = c.env.DB;
  const ip = clientIp(c);
  await assertNotThrottled(c, 'token-ip', ip);
  const fail = async (error: string, desc: string) => {
    await recordFailure(c, 'token-ip', ip);
    return oauthError(error, desc);
  };
  const keyValid = async (apiKeyId: string) =>
    !!(await DB.prepare('SELECT 1 FROM api_keys WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)').bind(apiKeyId, now()).first());

  let clientId: string;
  let apiKeyId: string;
  let scope: string;
  if (raw.grant_type === 'authorization_code') {
    if (!raw.code || !raw.code_verifier || !raw.client_id || !raw.redirect_uri) return fail('invalid_request', 'code, code_verifier, client_id und redirect_uri sind erforderlich');
    const row = await DB.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').bind(await sha256Hex(raw.code)).first<{
      client_id: string;
      api_key_id: string;
      redirect_uri: string;
      code_challenge: string;
      scope: string;
      expires_at: number;
      used_at: number | null;
    }>();
    if (!row || row.used_at || row.expires_at < now() || row.client_id !== raw.client_id || row.redirect_uri !== raw.redirect_uri) return fail('invalid_grant', 'Code ungültig oder abgelaufen');
    // Einmalig: gleichzeitige Doppelverwendung verhindern
    const upd = await DB.prepare('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').bind(now(), await sha256Hex(raw.code)).run();
    if (!upd.meta.changes) return fail('invalid_grant', 'Code bereits verwendet');
    if ((await s256(raw.code_verifier)) !== row.code_challenge) return fail('invalid_grant', 'PKCE-Prüfung fehlgeschlagen');
    ({ client_id: clientId, api_key_id: apiKeyId, scope } = row);
  } else if (raw.grant_type === 'refresh_token') {
    if (!raw.refresh_token?.startsWith(REFRESH_PREFIX)) return fail('invalid_grant', 'Refresh-Token ungültig');
    const h = await sha256Hex(raw.refresh_token);
    const row = await DB.prepare("SELECT client_id, api_key_id, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'")
      .bind(h)
      .first<{ client_id: string; api_key_id: string; expires_at: number; revoked_at: number | null }>();
    if (!row || row.revoked_at || row.expires_at < now() || (raw.client_id && raw.client_id !== row.client_id)) return fail('invalid_grant', 'Refresh-Token ungültig oder abgelaufen');
    const upd = await DB.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(now(), h).run();
    if (!upd.meta.changes) return fail('invalid_grant', 'Refresh-Token bereits verwendet');
    clientId = row.client_id;
    apiKeyId = row.api_key_id;
    scope = (await DB.prepare('SELECT scope FROM api_keys WHERE id = ?').bind(apiKeyId).first<string>('scope')) ?? 'read';
  } else {
    return oauthError('unsupported_grant_type', 'Nur authorization_code und refresh_token');
  }
  if (!(await keyValid(apiKeyId))) return fail('invalid_grant', 'Der zugehörige API-Schlüssel wurde widerrufen');
  const access = `${ACCESS_PREFIX}${token()}`;
  const refresh = `${REFRESH_PREFIX}${token()}`;
  const t = now();
  const ins = 'INSERT INTO oauth_tokens (token_hash, kind, client_id, api_key_id, expires_at, created_at) VALUES (?,?,?,?,?,?)';
  await DB.batch([
    DB.prepare(ins).bind(await sha256Hex(access), 'access', clientId, apiKeyId, t + ACCESS_TTL, t),
    DB.prepare(ins).bind(await sha256Hex(refresh), 'refresh', clientId, apiKeyId, t + REFRESH_TTL, t),
  ]);
  return new Response(JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', 'access-control-allow-origin': '*' },
  });
});

/** Token widerrufen (RFC 7009) – antwortet immer 200. */
oauthPublic.post('/oauth/revoke', async (c) => {
  const raw = Object.fromEntries(new URLSearchParams(await c.req.text()));
  if (raw.token) await c.env.DB.prepare('UPDATE oauth_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(now(), await sha256Hex(raw.token)).run();
  return new Response(null, { status: 200, headers: { 'access-control-allow-origin': '*' } });
});

/** Freigabe mit Anmeldung: neuen API-Schlüssel nur für diese Verbindung erstellen (Admins). */
export const oauthSession = new Hono<AppEnv>();
oauthSession.use('/oauth/authorize/session', requireSession);
oauthSession.post('/oauth/authorize/session', async (c) => {
  requireRole(c, 'admin');
  const b = authorizeBody.extend({ scope: z.enum(SCOPES) }).parse(await c.req.json());
  const client = await loadClient(c, b.clientId, b.redirectUri);
  const u = c.get('user');
  const key = `${API_KEY_PREFIX}${token()}`;
  const kid = id();
  const name = `${client.name.slice(0, 50)} (verbunden ${new Date().toISOString().slice(0, 10)})`;
  // Der Schlüssel selbst wird nie angezeigt – er existiert nur, damit die Verbindung widerrufbar ist
  await c.env.DB.prepare('INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scope, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
    .bind(kid, u.tenantId, name, 'oauth', await sha256Hex(key), b.scope, u.userId, now())
    .run();
  await logActivity(c, 'create', 'api_key', kid, `Verbindung „${client.name}“ per OAuth freigegeben (${b.scope === 'write' ? 'lesen und schreiben' : 'nur lesen'})`);
  return issueCode(c, b, kid, b.scope);
});

/** Abgelaufene Codes/Tokens aufräumen (Cron). */
export async function cleanupOAuth(db: D1Database) {
  const t = now();
  await db.batch([db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(t - 86_400_000), db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(t - 86_400_000)]);
}
