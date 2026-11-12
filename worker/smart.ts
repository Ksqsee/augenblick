// Smarte Funktionen: Rundgänge planen, Vorschläge für die Startseite, Aufgaben aus Mängeln.
import { Hono } from 'hono';
import { z } from 'zod';
import { DAY } from '../shared/logic';
import { DEFAULT_SLA, HOUR } from '../shared/sla';
import { sortByUrgency } from '../shared/tasks';
import { defectScope, taskScope, tid } from './data';
import { intervalSuggestions, adaptMode } from './intervals';
import { type AppEnv, type Ctx, id, logActivity, now, RANK, requireRole, scopeSql } from './lib';

export const smart = new Hono<AppEnv>();

interface DueAsset {
  id: string;
  code: string;
  category: string;
  location: string;
  floor: string;
  nextDueAt: number | null;
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
}

/** Fällige Elemente (überfällig + Vorschau) je Gebäude, in Laufreihenfolge (Etage, Standort). */
async function rounds(c: Ctx, days: number) {
  const n = now();
  const rows = (
    await c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, a.floor, a.next_due_at AS nextDueAt,
              b.id AS buildingId, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
          AND (a.next_due_at IS NULL OR a.next_due_at < ?2) AND ${scopeSql(c, 'b.id', 'building')}
        ORDER BY p.name, b.name, a.floor, a.location, a.code LIMIT 2000`,
    )
      .bind(tid(c), n + days * DAY)
      .all<DueAsset>()
  ).results;
  const by = new Map<string, { buildingId: string; buildingName: string; propertyId: string; propertyName: string; overdue: number; due: number; never: number; earliest: number | null; assets: DueAsset[] }>();
  for (const r of rows) {
    const g = by.get(r.buildingId) ?? { buildingId: r.buildingId, buildingName: r.buildingName, propertyId: r.propertyId, propertyName: r.propertyName, overdue: 0, due: 0, never: 0, earliest: null, assets: [] };
    if (r.nextDueAt == null) g.never++;
    else if (r.nextDueAt < n) g.overdue++;
    else g.due++;
    if (r.nextDueAt != null && (g.earliest == null || r.nextDueAt < g.earliest)) g.earliest = r.nextDueAt;
    g.assets.push(r);
    by.set(r.buildingId, g);
  }
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || (a.earliest ?? 0) - (b.earliest ?? 0) || b.assets.length - a.assets.length);
}

smart.get('/smart/rounds', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days') ?? 30) || 30));
  return c.json(await rounds(c, days));
});

export interface Suggestion {
  id: string;
  kind: 'round' | 'defects_without_task' | 'walkthrough_due' | 'stale_drafts' | 'overdue_tasks' | 'never_inspected' | 'interval';
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  /** Ziel in der App oder eine Aktion, die die App ausführt */
  link?: string;
  action?: { label: string; endpoint: string; body?: unknown };
  count: number;
}

/** Was jetzt zu tun ist – priorisierte Vorschläge aus den Daten des Workspaces. */
smart.get('/smart/suggestions', async (c) => {
  const n = now();
  const t = tid(c);
  const u = c.get('user');
  const [r, defects, walks, drafts, tasks] = await Promise.all([
    rounds(c, 14),
    c.env.DB.prepare(
      `SELECT d.id, d.severity FROM defects d WHERE d.tenant_id = ?1 AND d.status = 'open' AND d.hidden_at IS NULL AND d.severity IN ('high','critical')
          AND ${defectScope(c, 'd')} AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.defect_id = d.id) LIMIT 200`,
    )
      .bind(t)
      .all<{ id: string; severity: string }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.name, (SELECT MAX(w.next_due_at) FROM walkthroughs w WHERE w.property_id = p.id AND w.status = 'submitted') AS due
         FROM properties p WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND ${scopeSql(c, 'p.id', 'fullProperty')}`,
    )
      .bind(t)
      .all<{ id: string; name: string; due: number | null }>(),
    c.env.DB.prepare("SELECT id, asset_id FROM inspections WHERE tenant_id = ? AND status = 'draft' AND inspector_id = ? AND updated_at < ? ORDER BY updated_at LIMIT 20")
      .bind(t, u.userId, n - 2 * DAY)
      .all<{ id: string; asset_id: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND status IN ('open','in_progress') AND due_at < ? AND (assignee_id = ? OR assignee_id IS NULL) AND ${taskScope(c, 'tasks')}`,
    )
      .bind(t, n, u.userId)
      .first<number>('n'),
  ]);
  const out: Suggestion[] = [];
  for (const g of r.slice(0, 3)) {
    if (!g.overdue && !g.due) continue;
    out.push({
      id: `round-${g.buildingId}`,
      kind: 'round',
      tone: g.overdue ? 'bad' : 'warn',
      title: `Rundgang ${g.buildingName}`,
      text: `${g.propertyName}: ${g.overdue ? `${g.overdue} überfällig` : ''}${g.overdue && g.due ? ', ' : ''}${g.due ? `${g.due} in den nächsten 14 Tagen` : ''}${g.never ? `, ${g.never} nie geprüft` : ''}`,
      link: `/rundgang/${g.buildingId}`,
      count: g.overdue + g.due,
    });
  }
  const crit = defects.results.filter((d) => d.severity === 'critical').length;
  if (defects.results.length) {
    out.push({
      id: 'defects-without-task',
      kind: 'defects_without_task',
      tone: crit ? 'bad' : 'warn',
      title: `${defects.results.length} schwere ${defects.results.length === 1 ? 'Mangel' : 'Mängel'} ohne Aufgabe`,
      text: crit ? `${crit} davon kritisch. Für jeden Mangel eine Aufgabe mit SLA-Frist anlegen.` : 'Für jeden Mangel eine Aufgabe mit SLA-Frist anlegen.',
      action: u.role === 'viewer' ? undefined : { label: 'Aufgaben anlegen', endpoint: '/smart/tasks-from-defects', body: { severities: ['high', 'critical'] } },
      link: '/maengel',
      count: defects.results.length,
    });
  }
  for (const w of walks.results) {
    if (w.due != null && w.due > n + 30 * DAY) continue;
    out.push({
      id: `walk-${w.id}`,
      kind: 'walkthrough_due',
      tone: w.due == null || w.due < n ? 'bad' : 'warn',
      title: `Begehung ${w.name}`,
      text: w.due == null ? 'Noch keine Begehung abgeschlossen.' : w.due < n ? 'Begehung ist überfällig.' : 'Begehung in den nächsten 30 Tagen fällig.',
      link: `/objekte/${w.id}`,
      count: 1,
    });
  }
  if (drafts.results.length) {
    out.push({
      id: 'stale-drafts',
      kind: 'stale_drafts',
      tone: 'info',
      title: `${drafts.results.length} angefangene ${drafts.results.length === 1 ? 'Prüfung' : 'Prüfungen'}`,
      text: 'Seit über zwei Tagen nicht abgeschlossen – fortsetzen oder verwerfen.',
      link: drafts.results.length === 1 ? `/pruefung/${drafts.results[0].id}` : '/pruefungen?tab=drafts',
      count: drafts.results.length,
    });
  }
  if (tasks) {
    out.push({ id: 'overdue-tasks', kind: 'overdue_tasks', tone: 'warn', title: `${tasks} überfällige ${tasks === 1 ? 'Aufgabe' : 'Aufgaben'}`, text: 'Dir zugewiesen oder noch ohne Zuständige.', link: '/aufgaben', count: tasks });
  }
  // Selbstanpassende Prüfintervalle, Stufe „Vorschlagen“ (nur wer sie übernehmen darf). Sie bekommen einen festen Platz,
  // damit sie nicht hinter Rundgängen verschwinden; weitere stehen auf der Elementseite.
  const intervalOut: Suggestion[] = [];
  if (RANK[u.role] >= RANK.admin && (await adaptMode(c)) === 'suggest') {
    for (const s of (await intervalSuggestions(c)).slice(0, 1)) {
      intervalOut.push({
        id: `interval-${s.assetId}-${s.schedule}`,
        kind: 'interval',
        tone: s.kind === 'shorten' ? 'warn' : 'info',
        title: `${s.code}: ${s.text}`,
        text:
          s.kind === 'shorten'
            ? `Zwei Prüfungen in Folge mit Mängeln (${s.scheduleLabel}). ${[s.buildingName, s.propertyName].filter(Boolean).join(' · ')}`
            : `Vier mängelfreie Prüfungen in Folge (${s.scheduleLabel}). ${[s.buildingName, s.propertyName].filter(Boolean).join(' · ')}`,
        link: `/elemente/${s.assetId}`,
        action: { label: s.kind === 'shorten' ? 'Verkürzen' : 'Zurücksetzen', endpoint: '/smart/intervals/apply', body: { assetId: s.assetId, schedule: s.schedule, months: s.to } },
        count: 1,
      });
    }
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count);
  return c.json([...out.slice(0, 6 - intervalOut.length), ...intervalOut]);
});

/** Für offene schwere Mängel ohne Aufgabe je eine Aufgabe anlegen (Frist nach SLA-Richtlinie). */
export async function tasksFromDefects(c: Ctx, opts: { severities: string[]; inspectionId?: string; defectId?: string }) {
  const t = tid(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT d.id, d.title, d.measure, d.severity, d.asset_id, d.property_id, a.code
         FROM defects d LEFT JOIN assets a ON a.id = d.asset_id
        WHERE d.tenant_id = ?1 AND d.status = 'open' AND d.hidden_at IS NULL AND d.severity IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR d.inspection_id = ?3) AND (?4 IS NULL OR d.id = ?4) AND ${defectScope(c, 'd')}
          AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.defect_id = d.id) LIMIT 200`,
    )
      .bind(t, JSON.stringify(opts.severities), opts.inspectionId ?? null, opts.defectId ?? null)
      .all<{ id: string; title: string; measure: string; severity: string; asset_id: string | null; property_id: string; code: string | null }>()
  ).results;
  if (!rows.length) return 0;
  const sla = await c.env.DB.prepare('SELECT priority, resolution_hours FROM sla_policies WHERE tenant_id = ?').bind(t).all<{ priority: string; resolution_hours: number }>();
  const hours = (p: 'high' | 'medium') => sla.results.find((s) => s.priority === p)?.resolution_hours ?? DEFAULT_SLA[p].resolutionHours;
  const n = now();
  const items = rows.map((d) => {
    const priority = d.severity === 'critical' || d.severity === 'high' ? 'high' : 'medium';
    return {
      id: id(),
      title: `${d.code ? `${d.code}: ` : ''}${d.measure || d.title}`.slice(0, 200),
      description: `Automatisch aus Mangel „${d.title}“ angelegt.${d.measure ? ` Maßnahme: ${d.measure}` : ''}`,
      priority,
      due: n + hours(priority) * HOUR,
      asset: d.asset_id,
      defect: d.id,
      property: d.property_id,
    };
  });
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, kind, status, priority, due_at, asset_id, defect_id, property_id, labels, created_by, created_at, updated_at)
     SELECT ${j('id')}, ?1, ${j('title')}, ${j('description')}, 'defect', 'open', ${j('priority')}, ${j('due')}, ${j('asset')}, ${j('defect')}, ${j('property')}, '[]', ?2, ?3, ?3 FROM json_each(?4)`,
  )
    .bind(t, c.get('user').userId, n, JSON.stringify(items))
    .run();
  // Anlegende Person beobachtet die neuen Aufgaben
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at)
     SELECT ${j('id')}, m.user_id, ?1, ?3 FROM json_each(?4) JOIN memberships m ON m.tenant_id = ?1 AND m.user_id = ?2`,
  )
    .bind(t, c.get('user').userId, n, JSON.stringify(items))
    .run();
  return items.length;
}

/**
 * Handlungsbedarf: schwere offene Mängel ohne Aufgabe, überfällige Aufgaben und überfällige Elemente –
 * in einer Liste, nach Dringlichkeit sortiert (siehe shared/tasks.ts).
 */
export async function actionRequired(c: Ctx) {
  const t = tid(c);
  const n = now();
  const [defects, tasks, assets] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT d.id, d.title, d.severity, d.created_at AS createdAt, a.id AS assetId, a.code, p.name AS propertyName, b.name AS buildingName
         FROM defects d JOIN properties p ON p.id = d.property_id LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN buildings b ON b.id = a.building_id
        WHERE d.tenant_id = ?1 AND d.status = 'open' AND d.hidden_at IS NULL AND d.severity IN ('high','critical') AND p.deleted_at IS NULL
          AND (a.id IS NULL OR a.deleted_at IS NULL) AND ${defectScope(c, 'd')}
          AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.defect_id = d.id AND k.status IN ('open','in_progress')) LIMIT 300`,
    ).bind(t),
    c.env.DB.prepare(
      `SELECT k.id, k.title, k.kind, k.priority, k.due_at AS dueAt, u.name AS assigneeName, a.code
         FROM tasks k LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN assets a ON a.id = k.asset_id
        WHERE k.tenant_id = ?1 AND k.status IN ('open','in_progress') AND k.due_at < ?2 AND ${taskScope(c, 'k')} LIMIT 300`,
    ).bind(t, n),
    c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, a.next_due_at AS dueAt, b.name AS buildingName, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
          AND a.next_due_at < ?2 AND ${scopeSql(c, 'b.id', 'building')} ORDER BY a.next_due_at LIMIT 300`,
    ).bind(t, n),
  ]);
  type R = Record<string, unknown>;
  const items = [
    ...(defects.results as R[]).map((d) => ({
      kind: 'defect' as const,
      id: d.id as string,
      level: d.severity as string,
      at: d.createdAt as number,
      title: d.title as string,
      subtitle: [d.code ?? 'Begehung', d.buildingName, d.propertyName].filter(Boolean).join(' · '),
      reason: 'ohne Aufgabe',
      assetId: (d.assetId as string | null) ?? null,
    })),
    ...(tasks.results as R[]).map((k) => ({
      kind: 'task' as const,
      id: k.id as string,
      level: k.priority as string,
      at: k.dueAt as number,
      title: k.title as string,
      subtitle: [k.code, k.assigneeName ?? 'ohne Zuständige'].filter(Boolean).join(' · '),
      reason: 'Aufgabe überfällig',
      assetId: null,
    })),
    ...(assets.results as R[]).map((a) => ({
      kind: 'asset' as const,
      id: a.id as string,
      level: null,
      at: a.dueAt as number,
      title: `${a.code}${a.location ? ` – ${a.location}` : ''}`,
      subtitle: [a.buildingName, a.propertyName].filter(Boolean).join(' · '),
      reason: 'Prüfung überfällig',
      assetId: a.id as string,
    })),
  ];
  return sortByUrgency(items, n).slice(0, 300);
}

smart.get('/smart/action-required', async (c) => c.json(await actionRequired(c)));

smart.post('/smart/tasks-from-defects', async (c) => {
  requireRole(c, 'inspector');
  const b = z.object({ severities: z.array(z.enum(['low', 'medium', 'high', 'critical'])).min(1).default(['high', 'critical']) }).parse(await c.req.json().catch(() => ({})));
  const created = await tasksFromDefects(c, b);
  if (created) await logActivity(c, 'create', 'task', null, `${created} Aufgaben aus Mängeln angelegt`);
  return c.json({ created });
});
