import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { account, auth } from './auth';
import { data } from './data';
import { type AppEnv, csrfGuard } from './lib';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('cache-control', c.res.headers.get('cache-control') ?? 'no-store');
});
app.use('*', csrfGuard);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/auth', auth);
app.route('/account', account);
app.route('/', data);

app.notFound((c) => c.json({ error: 'Nicht gefunden' }, 404));
app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: err.issues[0]?.message ?? 'Ungültige Eingabe', issues: err.issues }, 400);
  }
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Interner Fehler' }, 500);
});

export default app;
