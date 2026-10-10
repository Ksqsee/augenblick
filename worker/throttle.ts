// Begrenzung von Fehlversuchen gegen das Durchprobieren von Passwörtern, Tokens und API-Schlüsseln.
import { HTTPException } from 'hono/http-exception';
import { type Ctx, sha256Hex } from './lib';

const MIN = 60_000;

/** Grenzwerte: höchstens `max` Fehlversuche je Zeitfenster. */
export const LIMITS = {
  'login-user': { max: 8, windowMs: 15 * MIN }, // je E-Mail
  'login-ip': { max: 25, windowMs: 15 * MIN }, // je IP-Adresse
  'password-user': { max: 8, windowMs: 15 * MIN }, // aktuelles Passwort bei Änderung/Löschung/Einladung
  'token-ip': { max: 30, windowMs: 15 * MIN }, // ungültige Links und API-Schlüssel
  'register-ip': { max: 10, windowMs: 60 * MIN }, // neue Registrierungen
} as const;
export type ThrottleScope = keyof typeof LIMITS;

export class TooManyRequests extends HTTPException {
  constructor(readonly retryAfter: number) {
    const minutes = Math.max(1, Math.ceil(retryAfter / 60));
    super(429, { message: `Zu viele Versuche. Bitte in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} erneut versuchen.` });
  }
}

export const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'local';

const key = async (scope: string, ident: string) => (await sha256Hex(`${scope}:${ident.trim().toLowerCase()}`)).slice(0, 32);

/** Wirft 429, wenn das Limit erreicht ist. */
export async function assertNotThrottled(c: Ctx, scope: ThrottleScope, ident: string) {
  const { max, windowMs } = LIMITS[scope];
  const t = Date.now();
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM auth_throttle WHERE scope = ? AND ident = ? AND created_at > ?')
    .bind(scope, await key(scope, ident), t - windowMs)
    .first<{ n: number; first: number | null }>();
  if (row && row.n >= max) throw new TooManyRequests(Math.ceil(((row.first ?? t) + windowMs - t) / 1000));
}

export async function recordFailure(c: Ctx, scope: ThrottleScope, ident: string) {
  await c.env.DB.prepare('INSERT INTO auth_throttle (scope, ident, created_at) VALUES (?,?,?)').bind(scope, await key(scope, ident), Date.now()).run();
}

export async function clearFailures(c: Ctx, scope: ThrottleScope, ident: string) {
  await c.env.DB.prepare('DELETE FROM auth_throttle WHERE scope = ? AND ident = ?').bind(scope, await key(scope, ident)).run();
}
