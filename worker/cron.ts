// Täglicher Lauf: Erinnerungen, SLA-Verletzungen, automatische Archivierung, Aufräumen.
import { zonedDay } from '../shared/i18n';
import { DAY } from '../shared/logic';
import { DEFAULT_SLA, HOUR } from '../shared/sla';
import type { Env } from './lib';
import { notifyTenant } from './notify';

export async function runDaily(env: Env, now = Date.now()) {
  // Aufräumen zuerst, damit es auch läuft, wenn ein Workspace scheitert
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM password_resets WHERE expires_at < ?').bind(now - 7 * DAY),
    env.DB.prepare('DELETE FROM auth_throttle WHERE created_at < ?').bind(now - DAY),
    env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(now - 180 * DAY),
  ]);
  // shortcut: rund 5 Queries je Workspace in einem Aufruf; ab ~150 Workspaces (D1: 1000 Queries je Aufruf, Free 50) auf Queues umstellen
  const tenants = (await env.DB.prepare('SELECT id, archive_after_months, timezone FROM tenants').all<{ id: string; archive_after_months: number | null; timezone: string }>()).results;
  for (const t of tenants) {
    try {
      await runTenant(env, t, now);
    } catch (e) {
      console.error('cron tenant', t.id, e);
    }
  }
}

async function runTenant(env: Env, t: { id: string; archive_after_months: number | null; timezone: string }, now: number) {
  // Tag und Wochentag in der Zeitzone des Workspaces
  const { ymd: today, weekday } = zonedDay(now, t.timezone);
  const isMonday = weekday === 1;
  // 1) Seit gestern überfällig gewordene Elemente
  const newlyOverdue = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM assets WHERE tenant_id = ? AND deleted_at IS NULL AND next_due_at < ? AND next_due_at >= ?',
  )
    .bind(t.id, now, now - DAY)
    .first<number>('n');
  if (newlyOverdue) {
    await notifyTenant(env, t.id, {
      roles: ['owner', 'admin', 'inspector'],
      type: 'due_reminder',
      title: `${newlyOverdue} ${newlyOverdue === 1 ? 'Prüfung ist' : 'Prüfungen sind'} seit heute überfällig`,
      link: '/pruefungen?tab=overdue',
      dedupe: `overdue-${today}`,
    });
  }
  // 2) Wochenübersicht montags
  if (isMonday) {
    const c = await env.DB.prepare(
      `SELECT SUM(next_due_at < ?2) AS overdue, SUM(next_due_at BETWEEN ?2 AND ?3) AS soon FROM assets WHERE tenant_id = ?1 AND deleted_at IS NULL`,
    )
      .bind(t.id, now, now + 30 * DAY)
      .first<{ overdue: number | null; soon: number | null }>();
    if (c && (c.overdue || c.soon)) {
      await notifyTenant(env, t.id, {
        roles: ['owner', 'admin', 'inspector'],
        type: 'due_reminder',
        title: 'Wochenübersicht Prüfungen',
        body: `${c.overdue ?? 0} überfällig · ${c.soon ?? 0} in den nächsten 30 Tagen fällig`,
        link: '/pruefungen',
        dedupe: `weekly-${today}`,
      });
    }
  }
  // 3) SLA-Lösungsfrist überschritten – nur noch nicht gemeldete, Frist in SQL berechnet
  const breached = (
    await env.DB.prepare(
      `SELECT t.id, t.title, t.assignee_id FROM tasks t LEFT JOIN sla_policies p ON p.tenant_id = t.tenant_id AND p.priority = t.priority
        WHERE t.tenant_id = ?1 AND t.status IN ('open', 'in_progress')
          AND t.created_at + COALESCE(p.resolution_hours, CASE t.priority WHEN 'high' THEN ?2 WHEN 'medium' THEN ?3 ELSE ?4 END) * ?5 < ?6
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.tenant_id = t.tenant_id AND n.dedupe_key = 'sla-' || t.id)
        LIMIT 20`,
    )
      .bind(t.id, DEFAULT_SLA.high.resolutionHours, DEFAULT_SLA.medium.resolutionHours, DEFAULT_SLA.low.resolutionHours, HOUR, now)
      .all<{ id: string; title: string; assignee_id: string | null }>()
  ).results;
  for (const task of breached) {
    await notifyTenant(env, t.id, {
      userIds: task.assignee_id ? [task.assignee_id] : [],
      roles: ['owner', 'admin'],
      type: 'sla_breach',
      title: `SLA überschritten: ${task.title}`,
      link: `/aufgaben?id=${task.id}`,
      dedupe: `sla-${task.id}`,
    });
  }
  // 4) Automatische Archivierung (neueste Prüfung je Element und Prüfart bleibt aktiv)
  if (t.archive_after_months) {
    const cutoff = now - t.archive_after_months * 30.44 * DAY;
    await env.DB.prepare(
      `UPDATE inspections SET archived_at = ?1
        WHERE tenant_id = ?2 AND status = 'submitted' AND archived_at IS NULL AND inspected_at < ?3
          AND EXISTS (SELECT 1 FROM inspections n WHERE n.asset_id = inspections.asset_id AND n.schedule = inspections.schedule
                       AND n.status = 'submitted' AND n.inspected_at > inspections.inspected_at)`,
    )
      .bind(now, t.id, cutoff)
      .run();
  }
}
