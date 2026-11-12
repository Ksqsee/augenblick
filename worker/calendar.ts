// Kalender-Abo (iCal/ICS): fällige Prüfungen je Gebäude und Tag, Begehungen und eigene Aufgaben – in Outlook, Google oder Apple Kalender.
import { Hono } from 'hono';
import type { Role } from '../shared/catalog';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, requireSession, resolveScope, scopeSql, sha256Hex, token } from './lib';
import { assertNotThrottled, clientIp, recordFailure } from './throttle';

const DAY = 86_400_000;

/** Verwaltung des eigenen Abos (nur mit Sitzung). */
export const calendar = new Hono<AppEnv>();
calendar.use('/calendar-feed', requireSession);

calendar.get('/calendar-feed', async (c) => {
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT created_at AS createdAt, last_fetched_at AS lastFetchedAt FROM calendar_feeds WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(u.tenantId, u.userId)
    .first();
  return c.json(row ?? null);
});

/** Neuen Link erzeugen (ein bestehender wird dabei ungültig). */
calendar.post('/calendar-feed', async (c) => {
  const u = c.get('user');
  const tok = token();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE calendar_feeds SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL').bind(now(), u.tenantId, u.userId),
    c.env.DB.prepare('INSERT INTO calendar_feeds (id, tenant_id, user_id, token_hash, created_at) VALUES (?,?,?,?,?)').bind(id(), u.tenantId, u.userId, await sha256Hex(tok), now()),
  ]);
  await logActivity(c, 'create', 'calendar', null, 'Kalender-Abo erstellt');
  return c.json({ token: tok });
});

calendar.delete('/calendar-feed', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare('UPDATE calendar_feeds SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL').bind(now(), u.tenantId, u.userId).run();
  return c.json({ ok: true });
});

// ---------- ICS ----------
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Zeilen nach RFC 5545 auf 75 Oktette falten. */
function fold(line: string) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const ymd = (ts: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts).replace(/-/g, '');
const nextDay = (d: string) => {
  const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + 1));
  return x.toISOString().slice(0, 10).replace(/-/g, '');
};
const stamp = (ts: number) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function event(uid: string, day: string, summary: string, description: string, url: string, at: number) {
  return ['BEGIN:VEVENT', `UID:${uid}@pruefkompass`, `DTSTAMP:${stamp(at)}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDay(day)}`, `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(description)}`, `URL:${url}`, 'TRANSP:TRANSPARENT', 'END:VEVENT'];
}

export const calendarPublic = new Hono<AppEnv>();

calendarPublic.get('/calendar/:file', async (c) => {
  const tok = c.req.param('file').replace(/\.ics$/, '');
  await assertNotThrottled(c, 'token-ip', clientIp(c));
  const f =
    tok.length >= 20
      ? await c.env.DB.prepare(
          `SELECT f.id, f.tenant_id AS tenantId, f.user_id AS userId, m.role, m.scope AS rawScope, m.can_create AS canCreate, t.timezone, t.name AS tenantName
             FROM calendar_feeds f JOIN memberships m ON m.user_id = f.user_id AND m.tenant_id = f.tenant_id JOIN tenants t ON t.id = f.tenant_id
            WHERE f.token_hash = ? AND f.revoked_at IS NULL`,
        )
          .bind(await sha256Hex(tok))
          .first<{ id: string; tenantId: string; userId: string; role: Role; rawScope: string | null; canCreate: number; timezone: string; tenantName: string }>()
      : null;
  if (!f) {
    await recordFailure(c, 'token-ip', clientIp(c));
    notFound('Kalender');
  }
  // Gleicher Zugriffsbereich wie in der App
  c.set('user', { sessionId: `cal:${f.id}`, userId: f.userId, tenantId: f.tenantId, role: f.role, name: '', email: '', ...(await resolveScope(c as Ctx, f.tenantId, f.role, f.rawScope, f.canCreate)) });
  const tz = f.timezone || 'Europe/Berlin';
  const n = now();
  const origin = new URL(c.req.url).origin;
  const DB = c.env.DB;
  const [assets, walks, tasks] = await DB.batch([
    DB.prepare(
      `SELECT a.code, a.location, a.floor, a.next_due_at AS due, b.id AS bid, b.name AS building, p.name AS property
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND a.next_due_at IS NOT NULL AND a.next_due_at < ?2
          AND ${scopeSql(c as Ctx, 'b.id', 'building')}
        ORDER BY a.next_due_at LIMIT 3000`,
    ).bind(f.tenantId, n + 180 * DAY),
    DB.prepare(
      `SELECT p.id, p.name, MAX(w.next_due_at) AS due FROM properties p JOIN walkthroughs w ON w.property_id = p.id AND w.status = 'submitted'
        WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND ${scopeSql(c as Ctx, 'p.id', 'property')} GROUP BY p.id HAVING due IS NOT NULL AND due < ?2`,
    ).bind(f.tenantId, n + 180 * DAY),
    DB.prepare(
      `SELECT id, title, due_at AS due, priority FROM tasks WHERE tenant_id = ? AND status IN ('open','in_progress') AND due_at IS NOT NULL AND (assignee_id = ? OR (assignee_id IS NULL AND created_by = ?)) LIMIT 500`,
    ).bind(f.tenantId, f.userId, f.userId),
  ]);
  c.executionCtx.waitUntil(DB.prepare('UPDATE calendar_feeds SET last_fetched_at = ? WHERE id = ?').bind(n, f.id).run());

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pruefkompass//Kalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`Prüfkompass · ${f.tenantName}`)}`, `X-WR-TIMEZONE:${tz}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  const today = ymd(n, tz);
  // Überfälliges gesammelt auf heute, Rest je Gebäude und Fälligkeitstag
  const groups = new Map<string, { day: string; building: string; property: string; bid: string; overdue: boolean; items: string[] }>();
  for (const a of assets.results as { code: string; location: string; floor: string; due: number; bid: string; building: string; property: string }[]) {
    const overdue = a.due < n;
    const day = overdue ? today : ymd(a.due, tz);
    const k = `${a.bid}:${day}:${overdue}`;
    const g = groups.get(k) ?? { day, building: a.building, property: a.property, bid: a.bid, overdue, items: [] };
    g.items.push(`${a.code}${a.floor || a.location ? ` (${[a.floor, a.location].filter(Boolean).join(', ')})` : ''}`);
    groups.set(k, g);
  }
  for (const [k, g] of groups) {
    const what = `${g.items.length} ${g.items.length === 1 ? 'Prüfung' : 'Prüfungen'}`;
    lines.push(
      ...event(
        `due-${k.replace(/[^a-z0-9]/gi, '')}`,
        g.day,
        `${g.overdue ? 'Überfällig' : 'Fällig'}: ${what} · ${g.building}`,
        `${g.property} · ${g.building}\n${g.items.join('\n')}\n\nRundgang starten: ${origin}/rundgang/${g.bid}`,
        `${origin}/rundgang/${g.bid}`,
        n,
      ),
    );
  }
  for (const w of walks.results as { id: string; name: string; due: number }[]) {
    lines.push(...event(`walk-${w.id}`, w.due < n ? today : ymd(w.due, tz), `${w.due < n ? 'Überfällig' : 'Fällig'}: Begehung ${w.name}`, `Brandschutzbegehung ${w.name}`, `${origin}/objekte/${w.id}`, n));
  }
  for (const t of tasks.results as { id: string; title: string; due: number; priority: string }[]) {
    lines.push(...event(`task-${t.id}`, ymd(t.due, tz), `Aufgabe: ${t.title}`, `Priorität ${t.priority === 'high' ? 'hoch' : t.priority === 'low' ? 'niedrig' : 'mittel'}`, `${origin}/aufgaben?id=${t.id}`, n));
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900', 'content-disposition': 'inline; filename="pruefkompass.ics"' },
  });
});
