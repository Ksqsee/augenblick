import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { account, auth } from './auth';
import { categories } from './categories';
import { runDaily } from './cron';
import { inspections } from './inspections';
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
app.route('/account', account);

// Alles Weitere nur mit gültiger Sitzung (einmalige Prüfung)
const secured = new Hono<AppEnv>();
secured.use('*', requireAuth);
secured.route('/', categories);
secured.route('/', inspections);
secured.route('/', notifications);
secured.route('/', walks);
secured.route('/', plans);
secured.route('/', reports);
secured.route('/', work);
secured.route('/', data);
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

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDaily(env));
  },
} satisfies ExportedHandler<Env>;
