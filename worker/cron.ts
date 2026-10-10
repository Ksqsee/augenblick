// Täglicher Lauf: Erinnerungen, SLA-Verletzungen, automatische Archivierung, Aufräumen.
import { DAY } from '../shared/logic';
import { DEFAULT_SLA, HOUR, type Priority } from '../shared/sla';
import type { Env } from './lib';
import { notifyTenant } from './notify';

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function runDaily(env: Env, now = Date.now()) {
  const tenants = (await env.DB.prepare('SELECT id, archive_after_months FROM tenants').all<{ id: string; archive_after_months: number | null }>()).results;
  const today = dayKey(now);
  const isMonday = new Date(now).getUTCDay() === 1;
  for (const t of tenants) {
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
    // 3) SLA-Lösungsfrist überschritten
    const policies = (
      await env.DB.prepare('SELECT priority, resolution_hours FROM sla_policies WHERE tenant_id = ?').bind(t.id).all<{ priority: Priority; resolution_hours: number }>()
    ).results;
    const res = (p: Priority) => policies.find((x) => x.priority === p)?.resolution_hours ?? DEFAULT_SLA[p].resolutionHours;
    const open = (
      await env.DB.prepare("SELECT id, title, priority, created_at, assignee_id FROM tasks WHERE tenant_id = ? AND status IN ('open','in_progress')")
        .bind(t.id)
        .all<{ id: string; title: string; priority: Priority; created_at: number; assignee_id: string | null }>()
    ).results;
    for (const task of open) {
      const due = task.created_at + res(task.priority) * HOUR;
      if (due < now) {
        await notifyTenant(env, t.id, {
          userIds: task.assignee_id ? [task.assignee_id] : [],
          roles: ['owner', 'admin'],
          type: 'sla_breach',
          title: `SLA überschritten: ${task.title}`,
          link: `/aufgaben?id=${task.id}`,
          dedupe: `sla-${task.id}`,
        });
      }
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
  // 5) Aufräumen
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM password_resets WHERE expires_at < ?').bind(now - 7 * DAY),
    env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(now - 180 * DAY),
  ]);
}
