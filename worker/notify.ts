import { Hono } from 'hono';
import { z } from 'zod';
import type { Role } from '../shared/catalog';
import { DEFAULT_QUIET, inQuietHours, type QuietHours } from '../shared/quiet';
import { type AppEnv, type Ctx, type Env, id, now, parseJson, sessionOnly } from './lib';
import { sendPush } from './push';

export const NOTIFY_TYPES = {
  task_assigned: 'Aufgabe zugewiesen',
  task_comment: 'Kommentar zu meiner Aufgabe',
  task_external: 'Rückmeldung von Subunternehmern',
  critical_defect: 'Kritischer Mangel festgestellt',
  walkthrough_submitted: 'Begehung abgeschlossen',
  due_reminder: 'Fällige und überfällige Prüfungen',
  sla_breach: 'SLA-Frist überschritten',
  member_joined: 'Neues Teammitglied',
  account_security: 'Anmeldung von neuem Gerät',
} as const;
export type NotifyType = keyof typeof NOTIFY_TYPES;
type Prefs = Partial<Record<NotifyType, { inApp?: boolean; push?: boolean }>> & { quiet?: QuietHours };

export interface NotifyInput {
  userIds?: string[];
  roles?: Role[];
  type: NotifyType;
  title: string;
  body?: string;
  link?: string;
  /** verhindert Doppelte (z. B. tägliche Erinnerung) */
  dedupe?: string;
  /** Auslöser nicht selbst benachrichtigen */
  exceptUserId?: string;
  /** „Nicht stören“ übergehen (nur für den Push-Test) */
  ignoreQuiet?: boolean;
}

/** Benachrichtigung an Personen/Rollen eines Workspaces (respektiert Einstellungen). */
export async function notifyTenant(env: Env, tenantId: string, n: NotifyInput, ctx?: { waitUntil(p: Promise<unknown>): void }) {
  const parts: string[] = [];
  const args: unknown[] = [tenantId];
  if (n.userIds?.length) {
    parts.push('m.user_id IN (SELECT value FROM json_each(?))');
    args.push(JSON.stringify(n.userIds));
  }
  if (n.roles?.length) {
    parts.push(`m.role IN (${n.roles.map(() => '?').join(',')})`);
    args.push(...n.roles);
  }
  if (!parts.length) return;
  const members = (
    await env.DB.prepare(`SELECT m.user_id, m.notify_prefs FROM memberships m WHERE m.tenant_id = ? AND (${parts.join(' OR ')})`)
      .bind(...args)
      .all<{ user_id: string; notify_prefs: string }>()
  ).results.filter((m) => m.user_id !== n.exceptUserId);
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  const inserted: string[] = [];
  const pushWanted: string[] = [];
  for (const m of members) {
    const all = parseJson<Prefs>(m.notify_prefs, {});
    const p = all[n.type] ?? {};
    if (p.inApp !== false) {
      inserted.push(m.user_id);
      stmts.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO notifications (id, tenant_id, user_id, type, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(id(), tenantId, m.user_id, n.type, n.title, n.body ?? '', n.link ?? null, n.dedupe ?? null, t),
      );
    }
    if (p.push !== false && (n.ignoreQuiet || !inQuietHours(all.quiet, t))) pushWanted.push(m.user_id);
  }
  const results = stmts.length ? await env.DB.batch(stmts) : [];
  // Bereits vorhandene Meldung (gleicher dedupe-Schlüssel) nicht erneut per Push senden
  const duplicate = new Set(inserted.filter((_, i) => n.dedupe && !results[i]?.meta.changes));
  const pushTo = pushWanted.filter((u) => !duplicate.has(u));
  if (pushTo.length && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    const work = pushAll(env, pushTo, { title: n.title, body: n.body ?? '', link: n.link ?? '/' });
    if (ctx) ctx.waitUntil(work);
    else await work;
  }
}

async function pushAll(env: Env, userIds: string[], data: { title: string; body: string; link: string }) {
  const subs = (
    await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(userIds))
      .all<{ id: string; endpoint: string; p256dh: string; auth: string }>()
  ).results;
  const cfg = { publicKey: env.VAPID_PUBLIC_KEY!, privateKey: env.VAPID_PRIVATE_KEY!, subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.com' };
  await Promise.all(
    subs.filter((s) => isPushService(s.endpoint)).map(async (s) => {
      try {
        if (!(await sendPush(cfg, s, data))) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
      } catch (e) {
        console.error('push failed', e);
      }
    }),
  );
}

export function notify(c: Ctx, n: NotifyInput) {
  return notifyTenant(c.env, c.get('user').tenantId, { exceptUserId: c.get('user').userId, ...n }, c.executionCtx);
}

// ---------- Routen ----------
export const notifications = new Hono<AppEnv>();
for (const path of ['/notifications', '/notifications/*', '/push/*']) notifications.use(path, sessionOnly);

notifications.get('/notifications', async (c) => {
  const u = c.get('user');
  const [items, unread] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, type, title, body, link, read_at AS readAt, created_at AS createdAt FROM notifications
        WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 60`,
    ).bind(u.userId, u.tenantId),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND tenant_id = ? AND read_at IS NULL').bind(u.userId, u.tenantId),
  ]);
  return c.json({ items: items.results, unread: (unread.results[0] as { n: number }).n });
});

notifications.post('/notifications/read', async (c) => {
  const u = c.get('user');
  const { ids } = z.object({ ids: z.array(z.string()).max(200).optional() }).parse(await c.req.json());
  if (ids?.length) {
    await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND tenant_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(now(), u.userId, u.tenantId, JSON.stringify(ids))
      .run();
  } else {
    await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND tenant_id = ? AND read_at IS NULL').bind(now(), u.userId, u.tenantId).run();
  }
  return c.json({ ok: true });
});

notifications.get('/notifications/settings', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT notify_prefs FROM memberships WHERE user_id = ? AND tenant_id = ?').bind(u.userId, u.tenantId).first<{ notify_prefs: string }>();
  const subs = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(u.userId).first<number>('n');
  const { quiet, ...prefs } = parseJson<Prefs>(row?.notify_prefs, {});
  return c.json({ types: NOTIFY_TYPES, prefs, quiet: { ...DEFAULT_QUIET, ...quiet }, pushAvailable: !!c.env.VAPID_PUBLIC_KEY, vapidPublicKey: c.env.VAPID_PUBLIC_KEY ?? null, pushDevices: subs ?? 0 });
});

notifications.put('/notifications/settings', async (c) => {
  const prefs = z.record(z.enum(Object.keys(NOTIFY_TYPES) as [NotifyType]), z.object({ inApp: z.boolean().optional(), push: z.boolean().optional() })).parse(await c.req.json());
  await savePrefs(c, (old) => ({ ...prefs, quiet: old.quiet }));
  return c.json({ ok: true });
});

notifications.put('/notifications/quiet', async (c) => {
  const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit als HH:MM');
  const quiet = z
    .object({ enabled: z.boolean(), from: hhmm, to: hhmm, weekends: z.boolean().default(false), timeZone: z.string().max(60).default(DEFAULT_QUIET.timeZone) })
    .parse(await c.req.json());
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: quiet.timeZone });
  } catch {
    quiet.timeZone = DEFAULT_QUIET.timeZone;
  }
  await savePrefs(c, (old) => ({ ...old, quiet }));
  return c.json({ ok: true });
});

async function savePrefs(c: Ctx, update: (old: Prefs) => Prefs) {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT notify_prefs FROM memberships WHERE user_id = ? AND tenant_id = ?').bind(u.userId, u.tenantId).first<{ notify_prefs: string }>();
  const next = update(parseJson<Prefs>(row?.notify_prefs, {}));
  await c.env.DB.prepare('UPDATE memberships SET notify_prefs = ? WHERE user_id = ? AND tenant_id = ?').bind(JSON.stringify(next), u.userId, u.tenantId).run();
}

/** Nur Endpunkte der bekannten Browser-Push-Dienste (kein Versand an beliebige URLs). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', '.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];
export function isPushService(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => (h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h));
  } catch {
    return false;
  }
}

notifications.post('/push/subscribe', async (c) => {
  const b = z.object({ endpoint: z.string().url().max(800), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(await c.req.json());
  if (!isPushService(b.endpoint)) return c.json({ error: 'Unbekannter Push-Dienst' }, 400);
  const u = c.get('user');
  // höchstens 10 Geräte je Person: älteste Abos entfernen
  await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint != ? AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint != ? ORDER BY created_at DESC LIMIT 9)',
  )
    .bind(u.userId, b.endpoint, u.userId, b.endpoint)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  )
    .bind(id(), c.get('user').userId, b.endpoint, b.keys.p256dh, b.keys.auth, now())
    .run();
  return c.json({ ok: true });
});

notifications.post('/push/unsubscribe', async (c) => {
  const { endpoint } = z.object({ endpoint: z.string().max(800) }).parse(await c.req.json());
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, c.get('user').userId).run();
  return c.json({ ok: true });
});

notifications.post('/push/test', async (c) => {
  await notifyTenant(c.env, c.get('user').tenantId, { userIds: [c.get('user').userId], type: 'due_reminder', title: 'Testbenachrichtigung', body: 'Push-Benachrichtigungen funktionieren.', link: '/', ignoreQuiet: true });
  return c.json({ ok: true });
});
