// Kalender-Abo (iCal/ICS): fällige Prüfungen je Gebäude und Tag, Begehungen und eigene Aufgaben – in Outlook, Google oder Apple Kalender.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { addDays, bundleDue, type CalendarEvent, dayKey, daysBetween, type DueRow, isDayKey, sortEvents } from '../shared/calendar';
import type { Role } from '../shared/catalog';
import { taskScope } from './data';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, RANK, requireSession, resolveScope, scopeSql, sha256Hex, token } from './lib';
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
    lines.push(...event(`walk-${w.id}`, w.due < n ? today : ymd(w.due, tz), `${w.due < n ? 'Überfällig' : 'Fällig'}: Begehung ${w.name}`, `Brandschutzbegehung ${w.name}`, `${origin}/objekte/${w.id}?tab=begehung`, n));
  }
  for (const t of tasks.results as { id: string; title: string; due: number; priority: string }[]) {
    lines.push(...event(`task-${t.id}`, ymd(t.due, tz), `Aufgabe: ${t.title}`, `Priorität ${t.priority === 'high' ? 'hoch' : t.priority === 'low' ? 'niedrig' : 'mittel'}`, `${origin}/maengel?art=aufgaben&aufgabe=${t.id}`, n));
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=900', 'content-disposition': 'inline; filename="pruefkompass.ics"' },
  });
});

// ---------- Kalender in der App (Plan v8 1) ----------
/**
 * GET /calendar/events?from=JJJJ-MM-TT&to=JJJJ-MM-TT – Einträge für Monat und Liste, Tage in der Zeitzone des Workspaces.
 * Überfälliges (vor heute fällig, noch offen) kommt immer mit, unabhängig von `from` (Block „Überfällig“).
 * Rechte und Zugriffsbereich wie die Quellen: Elemente über das Gebäude, Begehungen über das ganze Objekt, Aufgaben wie
 * GET /tasks, Zulassungen wie der Katalog (ab Prüfer), Nachweise wie GET /credentials. Eine Abfrage-Runde (DB.batch).
 */
export const calendarEvents = new Hono<AppEnv>();

const MAX_SPAN_DAYS = 400;
const calTz = (tz: string | null | undefined) => {
  try {
    if (tz) new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
};

calendarEvents.get('/calendar/events', async (c) => {
  const u = c.get('user');
  const q = c.req.query();
  const n = now();
  const from = q.from ?? new Date(n).toISOString().slice(0, 10);
  const to = q.to ?? addDays(from, 42);
  if (!isDayKey(from) || !isDayKey(to)) throw new HTTPException(400, { message: 'from und to als JJJJ-MM-TT angeben' });
  const span = daysBetween(from, to);
  if (span < 0 || span > MAX_SPAN_DAYS) throw new HTTPException(400, { message: `Zeitraum höchstens ${MAX_SPAN_DAYS} Tage, to nicht vor from` });
  // Grenzen in ms mit einem Tag Rand (Zeitzone erst aus derselben Abfrage-Runde bekannt), genau gefiltert wird nach dem Tag
  const fromMs = Date.parse(`${from}T00:00:00Z`) - DAY;
  const toMs = Date.parse(`${to}T00:00:00Z`) + 2 * DAY;
  // Fälligkeiten vor dieser Grenze kommen je Objekt zusammengefasst (SQL), danach je Fälligkeit (gebündelt in shared/calendar)
  const split = Math.min(fromMs, n - DAY);
  const ctx = c as Ctx;
  const DB = c.env.DB;
  const assetFrom = `FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
       WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND a.next_due_at IS NOT NULL
         AND ${scopeSql(ctx, 'a.building_id', 'building')}`;
  const doors = "SUM(CASE WHEN a.category = 'fire_door' THEN 1 ELSE 0 END) AS doors";
  const [tzRow, overdueRows, dueRows, walks, tasks, approvals, creds] = await DB.batch([
    DB.prepare('SELECT timezone FROM tenants WHERE id = ?').bind(u.tenantId),
    DB.prepare(`SELECT p.id AS propertyId, p.name AS propertyName, MIN(a.next_due_at) AS due, COUNT(*) AS n, ${doors} ${assetFrom} AND a.next_due_at < ?2 GROUP BY p.id`).bind(
      u.tenantId,
      split,
    ),
    DB.prepare(
      `SELECT p.id AS propertyId, p.name AS propertyName, a.next_due_at AS due, COUNT(*) AS n, ${doors} ${assetFrom} AND a.next_due_at >= ?2 AND a.next_due_at < ?3
        GROUP BY p.id, a.next_due_at LIMIT 5000`,
    ).bind(u.tenantId, split, toMs),
    DB.prepare(
      `SELECT p.id, p.name, MAX(w.next_due_at) AS due FROM properties p JOIN walkthroughs w ON w.property_id = p.id AND w.status = 'submitted'
        WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND ${scopeSql(ctx, 'p.id', 'fullProperty')} GROUP BY p.id HAVING due IS NOT NULL AND due < ?2`,
    ).bind(u.tenantId, toMs),
    DB.prepare(
      `SELECT t.id, t.title, t.kind, t.due_at AS due, t.defect_id AS defectId, d.title AS defectTitle, p.id AS propertyId, p.name AS propertyName
         FROM tasks t LEFT JOIN defects d ON d.id = t.defect_id
         LEFT JOIN assets ta ON ta.id = t.asset_id LEFT JOIN buildings ba ON ba.id = ta.building_id LEFT JOIN buildings bb ON bb.id = t.building_id
         LEFT JOIN properties p ON p.id = COALESCE(t.property_id, d.property_id, ba.property_id, bb.property_id) AND p.deleted_at IS NULL
        WHERE t.tenant_id = ?1 AND t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at < ?3 AND (t.due_at >= ?2 OR t.due_at < ?4)
          AND ${taskScope(ctx, 't')}
        ORDER BY t.due_at LIMIT 1000`,
    ).bind(u.tenantId, fromMs, toMs, n),
    // Katalog wie GET /catalog erst ab Prüfer (Leseschlüssel und Lesezugriff sehen keine Zulassungen)
    RANK[u.role] >= RANK.inspector
      ? DB.prepare(
          `SELECT id, manufacturer, model, approval_valid_until AS until FROM catalog_products
            WHERE tenant_id = ?1 AND approval_valid_until >= ?2 AND approval_valid_until <= ?3 LIMIT 500`,
        ).bind(u.tenantId, from, to)
      : DB.prepare('SELECT NULL AS id WHERE 0'),
    DB.prepare(
      `SELECT mc.id, mc.user_id AS userId, us.name, mc.title, mc.valid_until AS until FROM member_credentials mc JOIN users us ON us.id = mc.user_id
         JOIN memberships m ON m.user_id = mc.user_id AND m.tenant_id = mc.tenant_id
        WHERE mc.tenant_id = ?1 AND mc.valid_until IS NOT NULL AND mc.valid_until >= ?2 AND mc.valid_until < ?3 LIMIT 500`,
    ).bind(u.tenantId, fromMs, toMs),
  ]);
  const tz = calTz((tzRow.results[0] as { timezone?: string } | undefined)?.timezone);
  const today = dayKey(n, tz);
  const inRange = (d: string) => d >= from && d <= to;
  const events: CalendarEvent[] = bundleDue([...(overdueRows.results as DueRow[]), ...(dueRows.results as DueRow[])], tz, n).filter((e) => e.overdue || inRange(e.date));

  for (const w of walks.results as { id: string; name: string; due: number }[]) {
    const date = dayKey(w.due, tz);
    const overdue = date < today;
    if (!overdue && !inRange(date)) continue;
    events.push({ date, kind: 'round', title: `${w.name}: Brandschutzbegehung ${overdue ? 'überfällig' : 'fällig'}`, propertyId: w.id, propertyName: w.name, link: `/objekte/${w.id}?tab=begehung`, ...(overdue ? { overdue } : {}) });
  }
  type TaskRow = { id: string; title: string; kind: string; due: number; defectId: string | null; defectTitle: string | null; propertyId: string | null; propertyName: string | null };
  for (const t of tasks.results as TaskRow[]) {
    const date = dayKey(t.due, tz);
    const overdue = date < today;
    if (!overdue && !inRange(date)) continue;
    const base = { date, ...(t.propertyId ? { propertyId: t.propertyId, propertyName: t.propertyName ?? '' } : {}), ...(overdue ? { overdue } : {}) };
    // Aufgaben ohne Objekt stehen nur im Kalender – ihr Eintrag öffnet die objektübergreifende Liste
    const loose = `/maengel?art=aufgaben&aufgabe=${t.id}`;
    if (t.defectId)
      events.push({ ...base, kind: 'defect', title: `Mangel: ${t.defectTitle ?? t.title}`, link: t.propertyId ? `/objekte/${t.propertyId}?tab=maengel&mangel=${t.defectId}` : loose });
    else if (t.kind === 'inspection') events.push({ ...base, kind: 'round', title: t.title, link: t.propertyId ? `/objekte/${t.propertyId}?tab=begehung` : loose });
    else events.push({ ...base, kind: 'task', title: t.title, link: t.propertyId ? `/objekte/${t.propertyId}?tab=maengel&aufgabe=${t.id}` : loose });
  }
  for (const a of approvals.results as { id: string | null; manufacturer: string; model: string; until: string }[]) {
    if (!a.id || !isDayKey(a.until)) continue;
    events.push({ date: a.until, kind: 'approval', title: `Zulassung endet: ${[a.manufacturer, a.model].filter(Boolean).join(' ')}`, link: '/einstellungen?tab=catalog' });
  }
  for (const cr of creds.results as { id: string; userId: string; name: string; title: string; until: number }[]) {
    const date = dayKey(cr.until, tz);
    if (!inRange(date)) continue;
    events.push({ date, kind: 'credential', title: `Nachweis endet: ${cr.title || 'Befähigungsnachweis'} (${cr.name})`, link: cr.userId === u.userId ? '/einstellungen' : '/einstellungen/team' });
  }
  return c.json({ from, to, today, timeZone: tz, events: sortEvents(events) });
});
