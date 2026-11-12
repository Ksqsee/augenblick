import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { ai } from './ai';
import { automation } from './automation';
import { mcpRoutes } from './mcp';
import { cleanupOAuth, oauthPublic, oauthSession, wellKnown } from './oauth';
import { smart } from './smart';
import { nowRoutes } from './now';
import { sharePublic, shares } from './shares';
import { calendar, calendarPublic } from './calendar';
import { account, auth } from './auth';
import { categories } from './categories';
import { runDaily } from './cron';
import { inspections } from './inspections';
import { intervals } from './intervals';
import { offline } from './offline';
import { partnerPublic, partners } from './partners';
import { notifications } from './notify';
import { data } from './data';
import { type AppEnv, csrfGuard, type Env, requireAuth } from './lib';
import { plans } from './plans';
import { reports } from './reports';
import { TooManyRequests } from './throttle';
import { walks } from './walkthroughs';
import { publicApi, work } from './work';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
  c.header('x-frame-options', 'DENY');
  c.header('strict-transport-security', 'max-age=31536000');
  // API-Antworten und Dateien dürfen nie als Seite mit Skripten laufen (z. B. SVG/HTML aus dem Speicher).
  // PDFs ausgenommen, damit der Browser-PDF-Viewer funktioniert.
  if (!(c.res.headers.get('content-type') ?? '').startsWith('application/pdf')) {
    c.header('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox");
  }
  if (!c.res.headers.get('cache-control')) c.header('cache-control', 'no-store');
});
app.use('*', csrfGuard);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/public', publicApi);
app.route('/public', sharePublic);
app.route('/public', calendarPublic);
app.route('/public', partnerPublic);
app.route('/account', calendar);
app.route('/account', account);
// MCP für Claude & Co.: eigene Authentifizierung per API-Schlüssel, Werkzeuge rufen intern die API auf
// OAuth für MCP-Clients (Registrierung, Token ohne Sitzung; Freigabe mit neuem Schlüssel nur angemeldet)
app.route('/', oauthPublic);
app.route('/', oauthSession);
app.route('/', mcpRoutes((req, c) => Promise.resolve(app.fetch(req, c.env, c.executionCtx))));

// Alles Weitere nur mit gültiger Sitzung (einmalige Prüfung)
const secured = new Hono<AppEnv>();
secured.use('*', requireAuth);
secured.route('/', categories);
secured.route('/', offline);
secured.route('/', inspections);
secured.route('/', intervals);
secured.route('/', partners);
secured.route('/', notifications);
secured.route('/', walks);
secured.route('/', plans);
secured.route('/', reports);
secured.route('/', work);
secured.route('/', data);
secured.route('/', ai);
secured.route('/', smart);
secured.route('/', nowRoutes);
secured.route('/', shares);
secured.route('/', automation);
app.route('/', secured);

app.notFound((c) => c.json({ error: 'Nicht gefunden' }, 404));
app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: err.issues[0]?.message ?? 'Ungültige Eingabe', issues: err.issues }, 400);
  }
  if (err instanceof TooManyRequests) return c.json({ error: err.message }, 429, { 'retry-after': String(err.retryAfter) });
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Interner Fehler' }, 500);
});

/**
 * Ungelesenen Anfragekörper zu Ende lesen (z. B. POST, der schon an Anmeldung oder Rolle scheitert).
 * Lokal setzt workerd sonst die Keep-Alive-Verbindung zurück, und die nächste Anfrage auf ihr endet im
 * Dev-Server mit ECONNRESET → 500 „fetch failed“ (sporadische E2E-Fehler). Nur kleine Körper mit Länge.
 */
async function drainUnreadBody(req: Request) {
  if (!req.body || req.bodyUsed) return;
  const len = Number(req.headers.get('content-length') ?? Number.NaN);
  if (!(len <= 1_000_000)) return;
  await req.arrayBuffer().catch(() => undefined);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // OAuth-Metadaten liegen außerhalb von /api (Standardpfade)
    if (new URL(req.url).pathname.startsWith('/.well-known/')) return wellKnown(req) ?? new Response('Not found', { status: 404 });
    const res = await app.fetch(req, env, ctx);
    await drainUnreadBody(req);
    return res;
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // scheduledTime = geplanter Zeitpunkt (lokal per ?time= steuerbar, z. B. für einen Montag in den Tests)
    ctx.waitUntil(runDaily(env, event.scheduledTime || Date.now()));
    ctx.waitUntil(cleanupOAuth(env.DB));
  },
} satisfies ExportedHandler<Env>;
