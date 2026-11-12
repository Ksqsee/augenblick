// Autopilot: Regeln mit drei Stufen (aus · vorschlagen · automatisch), Protokoll mit „Rückgängig“ und die Regeln selbst.
// Läuft aus Anfragen (Mangel erfasst, Aufgabe erledigt), aus dem täglichen Cron und auf Knopfdruck aus einem Vorschlag.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  type AssignRule,
  AUTOMATION_KEYS,
  AUTOMATION_MODES,
  AUTOMATIONS,
  type AutomationKey,
  type AutomationMode,
  automationDef,
  autoSeverities,
  canUndo,
  matchRule,
  nextRecurrence,
  PLAN_HORIZON_DAYS,
  periodLabel,
  type Recurrence,
  RECURRENCES,
  reportPeriod,
  SEVERITY_KEYS,
  STALE_DAYS,
} from '../shared/automation';
import type { Role } from '../shared/catalog';
import { zonedDay } from '../shared/i18n';
import { DAY } from '../shared/logic';
import { DEFAULT_SLA, HOUR } from '../shared/sla';
import { defectScope, taskScope, tid } from './data';
import { type AppEnv, type Ctx, type Env, id, logActivity, notFound, now, parseJson, RANK, requireRole, type ScopeSetting, scopeSql, type SessionUser, token } from './lib';
import { type IntervalUndo, revertIntervals } from './intervals';
import { notify } from './notify';

export const automation = new Hono<AppEnv>();

// ---------- Einstellungen ----------
export interface AutomationSetting {
  mode: AutomationMode;
  config: Record<string, unknown>;
  /** ausdrücklich gespeichert (sonst Standard) */
  custom: boolean;
}
export type AutomationSettings = Record<AutomationKey, AutomationSetting>;

/** Stufen und Einstellungen aller Regeln eines Workspaces (fehlende = Standard). */
export async function loadSettings(env: Env, tenantId: string): Promise<AutomationSettings> {
  const [rows, tenant] = await env.DB.batch([
    env.DB.prepare('SELECT key, mode, config FROM automation_settings WHERE tenant_id = ?').bind(tenantId),
    env.DB.prepare('SELECT auto_tasks, adapt_intervals_mode FROM tenants WHERE id = ?').bind(tenantId),
  ]);
  const saved = rows.results as { key: string; mode: AutomationMode; config: string }[];
  const tr = tenant.results[0] as { auto_tasks?: number; adapt_intervals_mode?: string } | undefined;
  const autoTasks = !!tr?.auto_tasks;
  const out = {} as AutomationSettings;
  for (const def of AUTOMATIONS) {
    // Selbstanpassende Intervalle: einzige Quelle ist tenants.adapt_intervals_mode (auch im Firmenprofil einstellbar)
    if (def.key === 'adapt_intervals') {
      const m = tr?.adapt_intervals_mode;
      out[def.key] = { mode: m === 'off' || m === 'auto' ? m : 'suggest', config: {}, custom: m != null && m !== def.defaultMode };
      continue;
    }
    const r = saved.find((s) => s.key === def.key);
    // „Aufgaben für schwere Mängel“ (Schalter im Firmenprofil) bestimmt die Stufe, solange nichts gespeichert ist
    const fallback: AutomationMode = def.key === 'assign_defect_tasks' ? (autoTasks ? 'auto' : 'suggest') : def.defaultMode;
    out[def.key] = { mode: r?.mode ?? fallback, config: parseJson<Record<string, unknown>>(r?.config, {}), custom: !!r };
  }
  return out;
}

const ruleSchema = z.object({
  id: z.string().max(40).default(() => id(8)),
  category: z.string().max(40).nullable().default(null),
  severities: z.array(z.enum(SEVERITY_KEYS)).min(1, 'Mindestens eine Schwere wählen').max(4),
  assigneeId: z.string().max(40).nullable().default(null),
  subcontractorId: z.string().max(40).nullable().default(null),
  days: z.number().int().min(1).max(365).nullable().default(null),
});
const assignConfig = z.object({ rules: z.array(ruleSchema).max(30).default([]) });

export function rulesOf(config: Record<string, unknown>): AssignRule[] {
  const r = assignConfig.safeParse(config);
  return r.success ? r.data.rules : [];
}

// ---------- Protokoll ----------
interface Undo {
  /** angelegte Aufgaben (nur unbearbeitete, Status „offen“, werden gelöscht) */
  deleteTasks?: string[];
  /** vorherige Prioritäten (nur zurückgesetzt, wenn noch „hoch“) */
  priorities?: { id: string; priority: string }[];
  /** Wiederholung der Vorgängerin beenden */
  stopRecurrence?: string[];
  /** archivierte Monatsberichte */
  deleteReports?: string[];
  /** Monatsberichte werden gerade im Browser erzeugt */
  pending?: boolean;
  /** angepasste Prüfintervalle: zurück auf `from` (null = Standard), nur wenn noch `to` gilt */
  intervals?: IntervalUndo[];
}
export interface LogEntry {
  key: AutomationKey;
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  buildingId?: string | null;
  propertyId?: string | null;
  assigneeId?: string | null;
  link?: string | null;
  undo?: Undo | null;
}

function logStatement(env: Env, tenantId: string, actor: string, e: LogEntry, at = now()) {
  const lid = id();
  return {
    id: lid,
    stmt: env.DB.prepare(
      `INSERT INTO automation_log (id, tenant_id, key, at, summary, entity_type, entity_id, building_id, property_id, assignee_id, link, undo, actor)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      lid,
      tenantId,
      e.key,
      at,
      e.summary.slice(0, 300),
      e.entityType ?? null,
      e.entityId ?? null,
      e.buildingId ?? null,
      e.propertyId ?? null,
      e.assigneeId ?? null,
      e.link ?? null,
      e.undo ? JSON.stringify(e.undo) : null,
      actor,
    ),
  };
}

/** Protokolleintrag aus anderen Modulen (z. B. worker/intervals.ts). */
export async function logAutomation(c: Ctx, e: LogEntry, opts: { system?: boolean } = {}) {
  const s = logStatement(c.env, tid(c), opts.system ? 'system' : c.get('user').userId, e);
  await s.stmt.run();
  return s.id;
}

async function writeLogs(c: Ctx, entries: LogEntry[], at = now()) {
  if (!entries.length) return [];
  const st = entries.map((e) => logStatement(c.env, tid(c), c.get('user').userId, e, at));
  await c.env.DB.batch(st.map((s) => s.stmt));
  return st.map((s) => s.id);
}

/**
 * Für eingeschränkte Mitglieder: Einträge zu Gebäuden/Objekten im Bereich und solche, bei denen sie zuständig sind.
 * Einträge ohne Ort (z. B. Monatsberichte für alle Objekte) sehen nur Mitglieder ohne Einschränkung.
 */
function logScope(c: Ctx, l = 'l') {
  const u = c.get('user');
  if (!u.scope) return '1=1';
  const me = /^[a-z0-9]{1,40}$/.test(u.userId) ? `'${u.userId}'` : "''";
  return `(${l}.assignee_id = ${me} OR CASE WHEN ${l}.building_id IS NOT NULL THEN ${scopeSql(c, `${l}.building_id`, 'building')}
               WHEN ${l}.property_id IS NOT NULL THEN ${scopeSql(c, `${l}.property_id`, 'fullProperty')} ELSE 0 END)`;
}

// ---------- Hilfen ----------
/** Ablauf ohne angemeldete Person (Cron, öffentlicher Link): Kontext mit vollem Zugriff, Akteur „system“. */
export function systemCtx(env: Env, tenantId: string, pending: Promise<unknown>[]): Ctx {
  const user: SessionUser = { sessionId: 'system', userId: 'system', tenantId, role: 'owner', name: 'Autopilot', email: '', scope: null, canCreate: true };
  return {
    env,
    get: (k: string) => (k === 'user' ? user : undefined),
    executionCtx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) },
  } as unknown as Ctx;
}

type Access = { role: Role; scope: ScopeSetting | null; name: string };
/** Rolle, Bereich und Name von Mitgliedern (für Zuweisungen durch Regeln). */
async function memberAccess(env: Env, tenantId: string, userIds: (string | null | undefined)[]): Promise<Map<string, Access>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = (
    await env.DB.prepare(
      'SELECT m.user_id, m.role, m.scope, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND m.user_id IN (SELECT value FROM json_each(?))',
    )
      .bind(tenantId, JSON.stringify(ids))
      .all<{ user_id: string; role: Role; scope: string | null; name: string }>()
  ).results;
  return new Map(rows.map((r) => [r.user_id, { role: r.role, scope: RANK[r.role] >= RANK.admin ? null : parseJson<ScopeSetting | null>(r.scope, null), name: r.name }]));
}

/** Darf das Mitglied an diesem Ort arbeiten (mindestens Prüfer, Ort im Bereich)? */
function canWorkAt(m: Access | undefined, place: { buildingId: string | null; propertyId: string | null }): boolean {
  if (!m || RANK[m.role] < RANK.inspector) return false;
  if (!m.scope) return true;
  if (place.buildingId) return (m.scope.buildingIds ?? []).includes(place.buildingId) || (!!place.propertyId && (m.scope.propertyIds ?? []).includes(place.propertyId));
  return !!place.propertyId && (m.scope.propertyIds ?? []).includes(place.propertyId);
}

/** Notizen an Zuständige, je Person gebündelt. */
async function notifyAssigned(c: Ctx, items: { assigneeId: string | null; id: string; title: string }[]) {
  const by = new Map<string, { id: string; title: string }[]>();
  for (const i of items) if (i.assigneeId) by.set(i.assigneeId, [...(by.get(i.assigneeId) ?? []), i]);
  for (const [userId, list] of by) {
    await notify(c, {
      userIds: [userId],
      type: 'task_assigned',
      title: list.length === 1 ? `Neue Aufgabe: ${list[0].title}` : `${list.length} neue Aufgaben`,
      body: 'Vom Autopiloten zugewiesen',
      link: list.length === 1 ? `/aufgaben?id=${list[0].id}` : '/aufgaben',
    });
  }
}

/** Beobachter eintragen (nur Mitglieder). */
async function watch(c: Ctx, pairs: { taskId: string; userId: string | null }[], at: number) {
  const list = pairs.filter((p) => p.userId);
  if (!list.length) return;
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at)
     SELECT json_extract(j.value, '$.taskId'), m.user_id, ?1, ?2 FROM json_each(?3) j JOIN memberships m ON m.tenant_id = ?1 AND m.user_id = json_extract(j.value, '$.userId')`,
  )
    .bind(tid(c), at, JSON.stringify(list))
    .run();
}

/** Ort (Gebäude/Objekt) und Zuständige von Aufgaben – für Protokoll und Bereich. */
async function taskPlaces(c: Ctx, ids: string[]) {
  if (!ids.length) return new Map<string, { title: string; assigneeId: string | null; buildingId: string | null; propertyId: string | null }>();
  const rows = (
    await c.env.DB.prepare(
      `SELECT t.id, t.title, t.assignee_id AS assigneeId, COALESCE(t.building_id, a.building_id, da.building_id) AS buildingId,
              COALESCE(t.property_id, d.property_id, b.property_id) AS propertyId
         FROM tasks t LEFT JOIN assets a ON a.id = t.asset_id LEFT JOIN defects d ON d.id = t.defect_id LEFT JOIN assets da ON da.id = d.asset_id
         LEFT JOIN buildings b ON b.id = COALESCE(t.building_id, a.building_id, da.building_id)
        WHERE t.tenant_id = ? AND t.id IN (SELECT value FROM json_each(?))`,
    )
      .bind(tid(c), JSON.stringify(ids))
      .all<{ id: string; title: string; assigneeId: string | null; buildingId: string | null; propertyId: string | null }>()
  ).results;
  return new Map(rows.map((r) => [r.id, r]));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

// ---------- Regel: Mängel zuweisen (assign_defect_tasks) ----------
/**
 * Für offene Mängel ohne Aufgabe je eine Aufgabe anlegen. Zuweisungsregeln bestimmen Person/Subunternehmer und Frist,
 * sonst gilt die SLA-Lösungsfrist. Schreibt das Protokoll (ein Eintrag je Ort und Zuständigen).
 */
export async function createDefectTasks(c: Ctx, opts: { severities: string[]; inspectionId?: string; walkthroughId?: string; defectId?: string }, n = now()) {
  const t = tid(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT d.id, d.title, d.measure, d.severity, d.asset_id, d.property_id, a.code, a.category, COALESCE(a.building_id, w.building_id) AS building_id
         FROM defects d LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN walkthroughs w ON w.id = d.walkthrough_id
        WHERE d.tenant_id = ?1 AND d.status = 'open' AND d.hidden_at IS NULL AND d.severity IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR d.inspection_id = ?3) AND (?4 IS NULL OR d.id = ?4) AND (?5 IS NULL OR d.walkthrough_id = ?5) AND ${defectScope(c, 'd')}
          AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.defect_id = d.id) LIMIT 200`,
    )
      .bind(t, JSON.stringify(opts.severities), opts.inspectionId ?? null, opts.defectId ?? null, opts.walkthroughId ?? null)
      .all<{ id: string; title: string; measure: string; severity: string; asset_id: string | null; property_id: string; code: string | null; category: string | null; building_id: string | null }>()
  ).results;
  if (!rows.length) return 0;
  const settings = await loadSettings(c.env, t);
  const rules = rulesOf(settings.assign_defect_tasks.config);
  const [sla, subs] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT priority, resolution_hours FROM sla_policies WHERE tenant_id = ?').bind(t),
    c.env.DB.prepare('SELECT id, company FROM subcontractors WHERE tenant_id = ? AND deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))').bind(
      t,
      JSON.stringify(rules.map((r) => r.subcontractorId).filter(Boolean)),
    ),
  ]);
  const hours = (p: 'high' | 'medium') => (sla.results as { priority: string; resolution_hours: number }[]).find((s) => s.priority === p)?.resolution_hours ?? DEFAULT_SLA[p].resolutionHours;
  const subName = new Map((subs.results as { id: string; company: string }[]).map((s) => [s.id, s.company]));
  const access = await memberAccess(c.env, t, rules.map((r) => r.assigneeId));
  const items = rows.map((d) => {
    const priority = d.severity === 'critical' || d.severity === 'high' ? 'high' : 'medium';
    const rule = matchRule(rules, { category: d.category, severity: d.severity });
    const place = { buildingId: d.building_id, propertyId: d.property_id };
    // Person nur, wenn sie (noch) Mitglied mit Zugriff auf den Ort ist; Subunternehmer nur, wenn nicht gelöscht
    const assignee = rule?.assigneeId && canWorkAt(access.get(rule.assigneeId), place) ? rule.assigneeId : null;
    const sub = rule?.subcontractorId && subName.has(rule.subcontractorId) ? rule.subcontractorId : null;
    return {
      id: id(),
      title: `${d.code ? `${d.code}: ` : ''}${d.measure || d.title}`.slice(0, 200),
      description: `Automatisch aus Mangel „${d.title}“ angelegt.${d.measure ? ` Maßnahme: ${d.measure}` : ''}`,
      priority,
      due: rule?.days ? n + rule.days * DAY : n + hours(priority) * HOUR,
      asset: d.asset_id,
      defect: d.id,
      property: d.property_id,
      assignee,
      sub,
      // Subunternehmer bekommt direkt den Link für die Rückmeldung
      share: sub ? token() : null,
      ...place,
    };
  });
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, kind, status, priority, due_at, asset_id, defect_id, property_id, assignee_id, subcontractor_id, share_token,
                        labels, created_by, created_at, updated_at)
     SELECT ${j('id')}, ?1, ${j('title')}, ${j('description')}, 'defect', 'open', ${j('priority')}, ${j('due')}, ${j('asset')}, ${j('defect')}, ${j('property')},
            ${j('assignee')}, ${j('sub')}, ${j('share')}, '[]', ?2, ?3, ?3 FROM json_each(?4)`,
  )
    .bind(t, c.get('user').userId, n, JSON.stringify(items))
    .run();
  // Anlegende Person und Zuständige beobachten die neuen Aufgaben
  await watch(c, items.flatMap((i) => [{ taskId: i.id, userId: c.get('user').userId }, { taskId: i.id, userId: i.assignee }]), n);
  await notifyAssigned(c, items.map((i) => ({ assigneeId: i.assignee, id: i.id, title: i.title })));
  // Protokoll: ein Eintrag je Ort + Zuständigen (damit Bereich und Rückgängig sauber passen)
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    const k = `${i.buildingId ?? ''}|${i.propertyId}|${i.assignee ?? ''}|${i.sub ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const code = opts.inspectionId ? rows.find((r) => r.code)?.code : null;
  await writeLogs(
    c,
    [...groups.values()].map((g) => {
      const who = g[0].assignee ? access.get(g[0].assignee)?.name : g[0].sub ? subName.get(g[0].sub) : null;
      return {
        key: 'assign_defect_tasks' as const,
        summary: `${g.length === 1 ? `Aufgabe „${g[0].title}“` : `${g.length} Aufgaben`} aus ${code ? `Prüfung ${code}` : opts.walkthroughId ? 'Begehung' : g.length === 1 ? 'Mangel' : 'Mängeln'} angelegt${who ? `, an ${who}` : ''}`,
        entityType: g.length === 1 ? 'task' : opts.inspectionId ? 'inspection' : opts.walkthroughId ? 'walkthrough' : null,
        entityId: g.length === 1 ? g[0].id : (opts.inspectionId ?? opts.walkthroughId ?? null),
        buildingId: g[0].buildingId,
        propertyId: g[0].propertyId,
        assigneeId: g[0].assignee,
        link: g.length === 1 ? `/aufgaben?id=${g[0].id}` : '/aufgaben',
        undo: { deleteTasks: g.map((i) => i.id) },
      };
    }),
    n,
  );
  return items.length;
}

/** Nach dem Erfassen von Mängeln (Prüfung, Meldung, Begehung): in Stufe „Automatisch“ sofort Aufgaben anlegen. */
export async function autoDefectTasks(c: Ctx, opts: { inspectionId?: string; walkthroughId?: string; defectId?: string }) {
  const s = (await loadSettings(c.env, tid(c))).assign_defect_tasks;
  if (s.mode !== 'auto') return 0;
  return createDefectTasks(c, { severities: autoSeverities(rulesOf(s.config)), ...opts });
}

// ---------- Regel: Woche planen (plan_week) ----------
function planCandidates(c: Ctx, n: number) {
  return c.env.DB.prepare(
    `SELECT b.id, b.name, b.property_id AS propertyId, MIN(a.next_due_at) AS earliest, COUNT(*) AS assets
       FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
      WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
        AND a.next_due_at IS NOT NULL AND a.next_due_at < ?2 AND ${scopeSql(c, 'b.id', 'building')}
        AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.tenant_id = ?1 AND k.building_id = b.id AND k.kind = 'inspection' AND k.status IN ('open','in_progress'))
      GROUP BY b.id ORDER BY earliest LIMIT 100`,
  )
    .bind(tid(c), n + PLAN_HORIZON_DAYS * DAY)
    .all<{ id: string; name: string; propertyId: string; earliest: number; assets: number }>();
}

/** Je Gebäude mit Fälligkeiten in 14 Tagen einen Prüfauftrag „Rundgang …“ anlegen (keine Dopplung). */
export async function planWeek(c: Ctx, n = now()) {
  const t = tid(c);
  const rows = (await planCandidates(c, n)).results;
  if (!rows.length) return 0;
  // Wer hat in diesem Gebäude zuletzt geprüft? (SQLite: Spalten zur MAX-Zeile)
  const last = (
    await c.env.DB.prepare(
      `SELECT a.building_id AS bid, i.inspector_id AS uid, MAX(i.inspected_at) AS at FROM inspections i JOIN assets a ON a.id = i.asset_id
        WHERE i.tenant_id = ? AND i.status = 'submitted' AND a.building_id IN (SELECT value FROM json_each(?)) GROUP BY a.building_id`,
    )
      .bind(t, JSON.stringify(rows.map((r) => r.id)))
      .all<{ bid: string; uid: string }>()
  ).results;
  const access = await memberAccess(c.env, t, last.map((l) => l.uid));
  const items = rows.map((b) => {
    const uid = last.find((l) => l.bid === b.id)?.uid ?? null;
    const place = { buildingId: b.id, propertyId: b.propertyId };
    return {
      id: id(),
      title: `Rundgang ${b.name}`.slice(0, 200),
      description: `${b.assets} ${b.assets === 1 ? 'Element ist' : 'Elemente sind'} in den nächsten ${PLAN_HORIZON_DAYS} Tagen fällig oder überfällig. Vom Autopiloten geplant.`,
      due: b.earliest,
      priority: b.earliest < n ? 'high' : 'medium',
      assignee: uid && canWorkAt(access.get(uid), place) ? uid : null,
      ...place,
    };
  });
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, kind, status, priority, due_at, building_id, property_id, assignee_id, labels, created_by, created_at, updated_at)
     SELECT ${j('id')}, ?1, ${j('title')}, ${j('description')}, 'inspection', 'open', ${j('priority')}, ${j('due')}, ${j('buildingId')}, ${j('propertyId')}, ${j('assignee')},
            '[]', ?2, ?3, ?3 FROM json_each(?4)`,
  )
    .bind(t, c.get('user').userId, n, JSON.stringify(items))
    .run();
  await watch(c, items.flatMap((i) => [{ taskId: i.id, userId: c.get('user').userId }, { taskId: i.id, userId: i.assignee }]), n);
  await notifyAssigned(c, items.map((i) => ({ assigneeId: i.assignee, id: i.id, title: i.title })));
  await writeLogs(
    c,
    items.map((i) => ({
      key: 'plan_week' as const,
      summary: `Prüfauftrag „${i.title}“ angelegt${i.assignee ? `, an ${access.get(i.assignee)?.name}` : ''}`,
      entityType: 'task',
      entityId: i.id,
      buildingId: i.buildingId,
      propertyId: i.propertyId,
      assigneeId: i.assignee,
      link: `/aufgaben?id=${i.id}`,
      undo: { deleteTasks: [i.id] },
    })),
    n,
  );
  return items.length;
}

/**
 * Rundgang erledigt: Ein von „Woche planen“ angelegter Prüfauftrag „Rundgang …“ schließt sich beim Prüfungsabschluss,
 * sobald im Gebäude kein Element mehr vor Ablauf seines Planungsfensters (Anlage + 14 Tage) fällig ist.
 * Wiederkehrende Aufträge bleiben außen vor; „Woche planen“ legt in der nächsten Woche wie gewohnt neu an.
 */
export async function closeFinishedRounds(c: Ctx, assetId: string, n = now()) {
  const t = tid(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT k.id, k.title, k.building_id AS buildingId, k.property_id AS propertyId, k.assignee_id AS assigneeId FROM tasks k
        WHERE k.tenant_id = ?1 AND k.kind = 'inspection' AND k.asset_id IS NULL AND k.recurrence IS NULL AND k.status IN ('open','in_progress')
          AND k.building_id = (SELECT building_id FROM assets WHERE id = ?2 AND tenant_id = ?1)
          AND EXISTS (SELECT 1 FROM automation_log l WHERE l.tenant_id = ?1 AND l.key = 'plan_week' AND l.entity_id = k.id AND l.undone_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.tenant_id = ?1 AND a.building_id = k.building_id AND a.deleted_at IS NULL
                            AND a.next_due_at IS NOT NULL AND a.next_due_at < k.created_at + ?3)`,
    )
      .bind(t, assetId, PLAN_HORIZON_DAYS * DAY)
      .all<{ id: string; title: string; buildingId: string; propertyId: string | null; assigneeId: string | null }>()
  ).results;
  if (!rows.length) return 0;
  const done = await c.env.DB.prepare(
    `UPDATE tasks SET status = 'done', closed_at = ?1, updated_at = ?1, first_response_at = COALESCE(first_response_at, ?1)
      WHERE tenant_id = ?2 AND status IN ('open','in_progress') AND id IN (SELECT value FROM json_each(?3)) RETURNING id`,
  )
    .bind(n, t, JSON.stringify(rows.map((r) => r.id)))
    .all<{ id: string }>();
  const closed = rows.filter((r) => done.results.some((d) => d.id === r.id));
  if (!closed.length) return 0;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO task_comments (id, tenant_id, task_id, user_id, author_name, body, created_at)
       SELECT lower(hex(randomblob(8))), ?1, value, NULL, 'Autopilot', ?2, ?3 FROM json_each(?4)`,
    ).bind(t, 'Alle fälligen Elemente des Gebäudes sind geprüft – Rundgang abgeschlossen.', n, JSON.stringify(closed.map((r) => r.id))),
    ...closed.map(
      (r) =>
        logStatement(c.env, t, 'system', {
          key: 'plan_week',
          summary: `${r.title} abgeschlossen`,
          entityType: 'task',
          entityId: r.id,
          buildingId: r.buildingId,
          propertyId: r.propertyId,
          assigneeId: r.assigneeId,
          link: `/aufgaben?id=${r.id}`,
        }, n).stmt,
    ),
  ]);
  return closed.length;
}

// ---------- Regel: Fristen eskalieren (escalate_sla) ----------
function escalateCandidates(c: Ctx, n: number) {
  return c.env.DB.prepare(
    `SELECT k.id, k.title, k.priority, k.assignee_id AS assigneeId FROM tasks k
      WHERE k.tenant_id = ?1 AND k.status IN ('open','in_progress') AND k.due_at < ?2 AND k.priority != 'high' AND ${taskScope(c, 'k')}
        AND NOT EXISTS (SELECT 1 FROM automation_log l WHERE l.tenant_id = ?1 AND l.key = 'escalate_sla' AND l.entity_id = k.id)
      ORDER BY k.due_at LIMIT 50`,
  )
    .bind(tid(c), n)
    .all<{ id: string; title: string; priority: string; assigneeId: string | null }>();
}

/** Überfällige Aufgaben: Priorität „hoch“, Admins (und Zuständige) benachrichtigen. Je Aufgabe nur einmal. */
export async function escalateSla(c: Ctx, n = now()) {
  const rows = (await escalateCandidates(c, n)).results;
  if (!rows.length) return 0;
  await c.env.DB.prepare(`UPDATE tasks SET priority = 'high', updated_at = ?1 WHERE tenant_id = ?2 AND id IN (SELECT value FROM json_each(?3))`)
    .bind(n, tid(c), JSON.stringify(rows.map((r) => r.id)))
    .run();
  const places = await taskPlaces(c, rows.map((r) => r.id));
  for (const r of rows) {
    await notify(c, {
      userIds: r.assigneeId ? [r.assigneeId] : [],
      roles: ['owner', 'admin'],
      type: 'sla_breach',
      title: `Frist überschritten: ${r.title}`,
      body: 'Priorität auf „Hoch“ gesetzt',
      link: `/aufgaben?id=${r.id}`,
      dedupe: `esc-${r.id}`,
    });
  }
  await writeLogs(
    c,
    rows.map((r) => ({
      key: 'escalate_sla' as const,
      summary: `Frist von „${r.title}“ überschritten, Priorität auf Hoch gesetzt`,
      entityType: 'task',
      entityId: r.id,
      buildingId: places.get(r.id)?.buildingId,
      propertyId: places.get(r.id)?.propertyId,
      assigneeId: r.assigneeId,
      link: `/aufgaben?id=${r.id}`,
      undo: { priorities: [{ id: r.id, priority: r.priority }] },
    })),
    n,
  );
  return rows.length;
}

// ---------- Regel: Offene Mängel nachhalten (close_stale) ----------
function staleCandidates(c: Ctx, n: number) {
  return c.env.DB.prepare(
    `SELECT k.id, k.title, k.assignee_id AS assigneeId, k.created_by AS createdBy, k.defect_id AS defectId FROM tasks k JOIN defects d ON d.id = k.defect_id
      WHERE k.tenant_id = ?1 AND k.kind = 'defect' AND k.status = 'done' AND k.closed_at < ?2 AND d.status = 'open' AND d.hidden_at IS NULL AND ${taskScope(c, 'k')}
        AND NOT EXISTS (SELECT 1 FROM automation_log l WHERE l.tenant_id = ?1 AND l.key = 'close_stale' AND l.entity_id = k.id)
      ORDER BY k.closed_at LIMIT 50`,
  )
    .bind(tid(c), n - STALE_DAYS * DAY)
    .all<{ id: string; title: string; assigneeId: string | null; createdBy: string; defectId: string }>();
}

/** Behebung seit 14 Tagen erledigt, Mangel noch offen → Zuständige (sonst Anlegende, sonst Admins) erinnern. */
export async function closeStale(c: Ctx, n = now()) {
  const rows = (await staleCandidates(c, n)).results;
  if (!rows.length) return 0;
  const places = await taskPlaces(c, rows.map((r) => r.id));
  const access = await memberAccess(c.env, tid(c), rows.flatMap((r) => [r.assigneeId, r.createdBy]));
  for (const r of rows) {
    const who = [r.assigneeId, r.createdBy].find((u) => u && access.has(u)) ?? null;
    await notify(c, {
      userIds: who ? [who] : [],
      roles: who ? [] : ['owner', 'admin'],
      type: 'automation',
      title: `Mangel noch offen: ${r.title}`,
      body: `Die Behebung ist seit über ${STALE_DAYS} Tagen erledigt. Mangel schließen oder Aufgabe wieder öffnen.`,
      link: `/maengel?id=${r.defectId}`,
      dedupe: `stale-${r.id}`,
    });
  }
  await writeLogs(
    c,
    rows.map((r) => ({
      key: 'close_stale' as const,
      summary: `Erinnerung verschickt: Mangel zu „${r.title}“ ist nach der Behebung noch offen`,
      entityType: 'task',
      entityId: r.id,
      buildingId: places.get(r.id)?.buildingId,
      propertyId: places.get(r.id)?.propertyId,
      assigneeId: r.assigneeId,
      link: `/maengel?id=${r.defectId}`,
      undo: null,
    })),
    n,
  );
  return rows.length;
}

// ---------- Regel: Wiederkehrende Aufgaben (recurring_tasks) ----------
function recurringCandidates(c: Ctx, ids: string[] | null) {
  return c.env.DB.prepare(
    `SELECT k.id, k.title, k.description, k.kind, k.priority, k.due_at AS dueAt, k.closed_at AS closedAt, k.assignee_id AS assigneeId, k.subcontractor_id AS subcontractorId,
            k.asset_id AS assetId, k.property_id AS propertyId, k.building_id AS buildingId, k.labels, k.recurrence
       FROM tasks k
      WHERE k.tenant_id = ?1 AND k.recurrence IS NOT NULL AND k.status = 'done' AND (?2 IS NULL OR k.id IN (SELECT value FROM json_each(?2))) AND ${taskScope(c, 'k')}
        AND NOT EXISTS (SELECT 1 FROM tasks x WHERE x.recurs_from = k.id) LIMIT 100`,
  )
    .bind(tid(c), ids ? JSON.stringify(ids) : null)
    .all<{
      id: string;
      title: string;
      description: string;
      kind: string;
      priority: string;
      dueAt: number | null;
      closedAt: number | null;
      assigneeId: string | null;
      subcontractorId: string | null;
      assetId: string | null;
      propertyId: string | null;
      buildingId: string | null;
      labels: string;
      recurrence: Recurrence;
    }>();
}

/** Für erledigte Aufgaben mit Wiederholung die nächste anlegen (eine je Vorgängerin). */
export async function createRecurrences(c: Ctx, ids: string[] | null, n = now()) {
  const rows = (await recurringCandidates(c, ids)).results;
  if (!rows.length) return 0;
  const items = rows.map((r) => ({
    id: id(),
    from: r.id,
    title: r.title,
    description: r.description,
    // Folge einer Mängelbehebung ist eine allgemeine Aufgabe (der Mangel gehört zur Vorgängerin)
    kind: r.kind === 'defect' ? 'other' : r.kind,
    priority: r.priority,
    due: nextRecurrence(r.recurrence, r.dueAt, r.closedAt ?? n, n),
    assignee: r.assigneeId,
    sub: r.subcontractorId,
    asset: r.assetId,
    property: r.propertyId,
    building: r.buildingId,
    labels: r.labels,
    recurrence: r.recurrence,
  }));
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, tenant_id, title, description, kind, status, priority, due_at, assignee_id, subcontractor_id, asset_id, property_id, building_id, labels,
                        recurrence, recurs_from, created_by, created_at, updated_at)
     SELECT ${j('id')}, ?1, ${j('title')}, ${j('description')}, ${j('kind')}, 'open', ${j('priority')}, ${j('due')}, ${j('assignee')}, ${j('sub')}, ${j('asset')},
            ${j('property')}, ${j('building')}, ${j('labels')}, ${j('recurrence')}, ${j('from')}, ?2, ?3, ?3 FROM json_each(?4)`,
  )
    .bind(tid(c), c.get('user').userId, n, JSON.stringify(items))
    .run();
  // Beobachter der Vorgängerin beobachten auch die Folgeaufgabe
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at)
     SELECT json_extract(j.value, '$.id'), w.user_id, ?1, ?2 FROM json_each(?3) j JOIN task_watchers w ON w.task_id = json_extract(j.value, '$.from') AND w.tenant_id = ?1`,
  )
    .bind(tid(c), n, JSON.stringify(items.map((i) => ({ id: i.id, from: i.from }))))
    .run();
  await notifyAssigned(c, items.map((i) => ({ assigneeId: i.assignee, id: i.id, title: i.title })));
  const places = await taskPlaces(c, items.map((i) => i.id));
  await writeLogs(
    c,
    items.map((i) => ({
      key: 'recurring_tasks' as const,
      summary: `Folgeaufgabe „${i.title}“ angelegt (${RECURRENCES[i.recurrence].toLowerCase()})`,
      entityType: 'task',
      entityId: i.id,
      buildingId: places.get(i.id)?.buildingId,
      propertyId: places.get(i.id)?.propertyId,
      assigneeId: i.assignee,
      link: `/aufgaben?id=${i.id}`,
      undo: { deleteTasks: [i.id], stopRecurrence: [i.from] },
    })),
    n,
  );
  return items.length;
}

/** Nach dem Erledigen von Aufgaben: in Stufe „Automatisch“ Folgeaufgaben anlegen. */
export async function afterTasksDone(c: Ctx, ids: string[]) {
  if (!ids.length) return 0;
  const has = await c.env.DB.prepare("SELECT 1 FROM tasks WHERE tenant_id = ? AND recurrence IS NOT NULL AND status = 'done' AND id IN (SELECT value FROM json_each(?)) LIMIT 1")
    .bind(tid(c), JSON.stringify(ids))
    .first();
  if (!has) return 0;
  if ((await loadSettings(c.env, tid(c))).recurring_tasks.mode !== 'auto') return 0;
  return createRecurrences(c, ids);
}

// ---------- Regel: Monatsberichte (monthly_report) ----------
/** Stand der Monatsberichte: Berichtsmonat (Vormonat), schon erledigt/in Arbeit? Fertige Einträge zählen, laufende bis 30 Min. */
async function monthlyState(env: Env, tenantId: string, n: number) {
  const tz = (await env.DB.prepare('SELECT timezone FROM tenants WHERE id = ?').bind(tenantId).first<string>('timezone')) ?? 'Europe/Berlin';
  const { period, label } = reportPeriod(zonedDay(n, tz).ymd);
  const [done, props] = await env.DB.batch([
    env.DB.prepare(
      `SELECT 1 FROM automation_log WHERE tenant_id = ?1 AND key = 'monthly_report' AND entity_id = ?2 AND undone_at IS NULL
          AND NOT (COALESCE(json_extract(undo, '$.pending'), 0) = 1 AND at < ?3) LIMIT 1`,
    ).bind(tenantId, period, n - 30 * 60_000),
    env.DB.prepare('SELECT COUNT(*) AS n FROM properties WHERE tenant_id = ? AND deleted_at IS NULL').bind(tenantId),
  ]);
  return { period, label, done: done.results.length > 0, properties: (props.results[0] as { n: number }).n };
}

// ---------- Ausführung (Cron) ----------
/** Täglicher Lauf je Workspace: Regeln in Stufe „Automatisch“ (plan_week nur montags in der Zeitzone des Workspaces). */
export async function runScheduled(env: Env, tenant: { id: string; timezone: string }, n: number) {
  const s = await loadSettings(env, tenant.id);
  const pending: Promise<unknown>[] = [];
  const c = systemCtx(env, tenant.id, pending);
  const steps: [AutomationKey, () => Promise<number>][] = [
    ['escalate_sla', () => escalateSla(c, n)],
    ['close_stale', () => closeStale(c, n)],
    // Nachholen, falls Aufgaben erledigt wurden, während die Regel nicht automatisch lief
    ['recurring_tasks', () => createRecurrences(c, null, n)],
    ['plan_week', () => (zonedDay(n, tenant.timezone).weekday === 1 ? planWeek(c, n) : Promise.resolve(0))],
  ];
  for (const [key, fn] of steps) {
    if (s[key].mode !== 'auto') continue;
    try {
      await fn();
    } catch (e) {
      console.error('automation', tenant.id, key, e);
    }
  }
  await Promise.allSettled(pending);
}

// ---------- Vorschläge (Stufe „Vorschlagen“) ----------
export interface AutomationSuggestion {
  id: string;
  kind: 'automation';
  automation: AutomationKey;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  link?: string;
  action?: { label: string; endpoint: string; body?: unknown };
  count: number;
}

export async function automationSuggestions(c: Ctx): Promise<AutomationSuggestion[]> {
  const u = c.get('user');
  if (RANK[u.role] < RANK.inspector) return [];
  const s = await loadSettings(c.env, tid(c));
  const n = now();
  const out: AutomationSuggestion[] = [];
  const run = (key: AutomationKey, label: string) => ({ label, endpoint: `/automation/${key}/run` });
  if (s.plan_week.mode === 'suggest') {
    const k = (await planCandidates(c, n)).results.length;
    if (k)
      out.push({
        id: 'auto-plan_week',
        kind: 'automation',
        automation: 'plan_week',
        tone: 'info',
        title: `Prüfaufträge für ${plural(k, 'ein Gebäude', 'Gebäude')} anlegen`,
        text: `Rundgänge mit Fälligkeiten in den nächsten ${PLAN_HORIZON_DAYS} Tagen als Aufträge planen.`,
        action: run('plan_week', 'Aufträge anlegen'),
        link: '/aufgaben',
        count: k,
      });
  }
  if (s.escalate_sla.mode === 'suggest') {
    const k = (await escalateCandidates(c, n)).results.length;
    if (k)
      out.push({
        id: 'auto-escalate_sla',
        kind: 'automation',
        automation: 'escalate_sla',
        tone: 'warn',
        title: `${plural(k, 'Eine Aufgabe', 'Aufgaben')} über der Frist`,
        text: 'Priorität auf „Hoch“ setzen und die Admins benachrichtigen.',
        action: run('escalate_sla', 'Eskalieren'),
        link: '/aufgaben',
        count: k,
      });
  }
  if (s.recurring_tasks.mode === 'suggest') {
    const k = (await recurringCandidates(c, null)).results.length;
    if (k)
      out.push({
        id: 'auto-recurring_tasks',
        kind: 'automation',
        automation: 'recurring_tasks',
        tone: 'info',
        title: `${plural(k, 'Eine wiederkehrende Aufgabe', 'wiederkehrende Aufgaben')} erledigt`,
        text: 'Die nächsten Termine als Aufgaben anlegen.',
        action: run('recurring_tasks', 'Folgeaufgaben anlegen'),
        link: '/aufgaben',
        count: k,
      });
  }
  if (s.close_stale.mode === 'suggest') {
    const k = (await staleCandidates(c, n)).results.length;
    if (k)
      out.push({
        id: 'auto-close_stale',
        kind: 'automation',
        automation: 'close_stale',
        tone: 'info',
        title: `${plural(k, 'Ein Mangel', 'Mängel')} nach erledigter Behebung noch offen`,
        text: 'Die Zuständigen an das Schließen erinnern.',
        action: run('close_stale', 'Erinnern'),
        link: '/maengel',
        count: k,
      });
  }
  if (s.monthly_report.mode === 'suggest' && RANK[u.role] >= RANK.admin && !u.scope) {
    const m = await monthlyState(c.env, tid(c), n);
    if (!m.done && m.properties)
      out.push({
        id: 'auto-monthly_report',
        kind: 'automation',
        automation: 'monthly_report',
        tone: 'info',
        title: `Monatsberichte ${m.label} bereit`,
        text: `Für ${plural(m.properties, 'ein Objekt', 'Objekte')} den Objektbericht erzeugen und im Archiv ablegen.`,
        // PDFs entstehen im Browser: die Berichtsseite erzeugt und archiviert sie beim Öffnen dieses Links
        link: '/berichte?monatsbericht=1',
        count: m.properties,
      });
  }
  return out;
}

// ---------- Routen ----------
const keyParam = (c: Ctx) => {
  const k = c.req.param('key') ?? '';
  if (!automationDef(k)) notFound('Regel');
  return k as AutomationKey;
};

/** Regeln mit Stufe und „zuletzt ausgeführt“. Einstellungen (Zuweisungsregeln) nur für Admins. */
automation.get('/automation', async (c) => {
  const s = await loadSettings(c.env, tid(c));
  const last = (await c.env.DB.prepare('SELECT key, MAX(at) AS at FROM automation_log WHERE tenant_id = ? GROUP BY key').bind(tid(c)).all<{ key: string; at: number }>()).results;
  const admin = RANK[c.get('user').role] >= RANK.admin;
  return c.json(
    AUTOMATIONS.map((d) => ({
      key: d.key,
      title: d.title,
      description: d.description,
      mode: s[d.key].mode,
      defaultMode: d.defaultMode,
      adminOnly: !!d.adminOnly,
      lastRunAt: last.find((l) => l.key === d.key)?.at ?? null,
      ...(admin ? { config: d.key === 'assign_defect_tasks' ? { rules: rulesOf(s[d.key].config) } : {} } : {}),
    })),
  );
});

/** Stufe und/oder Einstellungen einer Regel ändern (nur Admins). */
automation.put('/automation', async (c) => {
  requireRole(c, 'admin');
  const b = z
    .object({
      key: z.enum(AUTOMATION_KEYS),
      mode: z.enum(Object.keys(AUTOMATION_MODES) as [AutomationMode, ...AutomationMode[]]).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    })
    .refine((x) => x.mode !== undefined || x.config !== undefined, 'Nichts zu ändern')
    .parse(await c.req.json());
  const t = tid(c);
  const current = (await loadSettings(c.env, t))[b.key];
  let config = current.config;
  if (b.config !== undefined) {
    if (b.key !== 'assign_defect_tasks') throw new HTTPException(400, { message: 'Diese Regel hat keine Einstellungen' });
    const parsed = assignConfig.parse(b.config);
    for (const r of parsed.rules) {
      if (!!r.assigneeId === !!r.subcontractorId) throw new HTTPException(400, { message: 'Je Regel genau eine Person oder einen Subunternehmer wählen' });
      if (r.assigneeId) {
        const m = (await memberAccess(c.env, t, [r.assigneeId])).get(r.assigneeId);
        if (!m) throw new HTTPException(400, { message: 'Zuständige Person ist kein Mitglied' });
        if (RANK[m.role] < RANK.inspector) throw new HTTPException(400, { message: 'Lesezugriff kann keine Aufgaben übernehmen' });
      }
      if (r.subcontractorId && !(await c.env.DB.prepare('SELECT 1 FROM subcontractors WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(r.subcontractorId, t).first()))
        throw new HTTPException(400, { message: 'Subunternehmer nicht gefunden' });
    }
    config = parsed;
  }
  const mode = b.mode ?? current.mode;
  // adapt_intervals: Stufe liegt nur in tenants.adapt_intervals_mode (auch im Firmenprofil einstellbar)
  const stmts =
    b.key === 'adapt_intervals'
      ? [c.env.DB.prepare('UPDATE tenants SET adapt_intervals_mode = ? WHERE id = ?').bind(mode, t)]
      : [
          c.env.DB.prepare(
            `INSERT INTO automation_settings (tenant_id, key, mode, config, updated_at, updated_by) VALUES (?,?,?,?,?,?)
             ON CONFLICT (tenant_id, key) DO UPDATE SET mode = excluded.mode, config = excluded.config, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          ).bind(t, b.key, mode, JSON.stringify(config), now(), c.get('user').userId),
        ];
  // Schalter „Aufgaben für schwere Mängel“ im Firmenprofil bleibt im Gleichklang
  if (b.key === 'assign_defect_tasks') stmts.push(c.env.DB.prepare('UPDATE tenants SET auto_tasks = ? WHERE id = ?').bind(mode === 'auto' ? 1 : 0, t));
  await c.env.DB.batch(stmts);
  const def = automationDef(b.key)!;
  if (b.mode !== undefined && b.mode !== current.mode) await logActivity(c, 'update', 'automation', null, `Autopilot: „${def.title}“ auf ${AUTOMATION_MODES[mode]} gestellt`);
  if (b.config !== undefined) await logActivity(c, 'update', 'automation', null, `Autopilot: Einstellungen für „${def.title}“ geändert`);
  return c.json({ key: b.key, mode, ...(b.key === 'assign_defect_tasks' ? { config: { rules: rulesOf(config) } } : {}) });
});

/** Protokoll (neueste zuerst), im Zugriffsbereich. */
automation.get('/automation/log', async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
  const key = c.req.query('key');
  if (key && !automationDef(key)) throw new HTTPException(400, { message: 'Unbekannte Regel' });
  const before = Number(c.req.query('before') ?? 0) || null;
  const u = c.get('user');
  const rows = (
    await c.env.DB.prepare(
      `SELECT l.id, l.key, l.at, l.summary, l.link, l.undo, l.undone_at AS undoneAt, l.assignee_id AS assigneeId, l.actor,
              CASE WHEN l.actor = 'system' THEN 'Autopilot' ELSE u.name END AS actorName
         FROM automation_log l LEFT JOIN users u ON u.id = l.actor
        WHERE l.tenant_id = ?1 AND (?2 IS NULL OR l.key = ?2) AND (?3 IS NULL OR l.at < ?3) AND ${logScope(c)}
          AND NOT (COALESCE(json_extract(l.undo, '$.pending'), 0) = 1 AND l.undone_at IS NULL)
        ORDER BY l.at DESC LIMIT ?4`,
    )
      .bind(tid(c), key ?? null, before, limit)
      .all<{ id: string; key: string; at: number; summary: string; link: string | null; undo: string | null; undoneAt: number | null; assigneeId: string | null; actor: string; actorName: string | null }>()
  ).results;
  const n = now();
  const admin = RANK[u.role] >= RANK.admin;
  return c.json(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      title: automationDef(r.key)?.title ?? r.key,
      at: r.at,
      summary: r.summary,
      ...(r.link ? { link: r.link } : {}),
      actorName: r.actorName ?? 'Autopilot',
      undoable: canUndo({ at: r.at, undo: r.undo, undoneAt: r.undoneAt }, n) && RANK[u.role] >= RANK.inspector && (admin || r.assigneeId === u.userId),
      undoneAt: r.undoneAt,
    })),
  );
});

/** Eintrag rückgängig machen (7 Tage; Admins oder die Person, der die Regel etwas zugewiesen hat). */
automation.post('/automation/log/:id/undo', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const row = await c.env.DB.prepare(`SELECT l.id, l.key, l.at, l.summary, l.undo, l.undone_at, l.assignee_id FROM automation_log l WHERE l.id = ? AND l.tenant_id = ? AND ${logScope(c)}`)
    .bind(c.req.param('id'), tid(c))
    .first<{ id: string; key: string; at: number; summary: string; undo: string | null; undone_at: number | null; assignee_id: string | null }>();
  if (!row) notFound('Eintrag');
  if (RANK[u.role] < RANK.admin && row.assignee_id !== u.userId) throw new HTTPException(403, { message: 'Keine Berechtigung' });
  const n = now();
  const undo = parseJson<Undo | null>(row.undo, null);
  if (!undo || undo.pending || !canUndo({ at: row.at, undo, undoneAt: row.undone_at }, n)) throw new HTTPException(409, { message: 'Dieser Eintrag lässt sich nicht (mehr) rückgängig machen' });
  // Zuerst markieren – verhindert doppeltes Rückgängigmachen bei gleichzeitigen Klicks
  const mark = await c.env.DB.prepare('UPDATE automation_log SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL').bind(n, u.userId, row.id).run();
  if (!mark.meta.changes) throw new HTTPException(409, { message: 'Bereits rückgängig gemacht' });
  const t = tid(c);
  let removed = 0;
  let kept = 0;
  if (undo.deleteTasks?.length) {
    const ids = JSON.stringify(undo.deleteTasks);
    // Nur Aufgaben entfernen, an denen noch niemand arbeitet; begonnene, erledigte und abgebrochene bleiben
    const open = (
      await c.env.DB.prepare(`SELECT id FROM tasks WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?)) AND status = 'open'`)
        .bind(t, ids)
        .all<{ id: string }>()
    ).results.map((r) => r.id);
    const del = JSON.stringify(open);
    if (open.length)
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM task_comments WHERE tenant_id = ? AND task_id IN (SELECT value FROM json_each(?))').bind(t, del),
        c.env.DB.prepare('DELETE FROM task_watchers WHERE tenant_id = ? AND task_id IN (SELECT value FROM json_each(?))').bind(t, del),
        c.env.DB.prepare('DELETE FROM tasks WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))').bind(t, del),
      ]);
    removed = open.length;
    kept = undo.deleteTasks.length - open.length;
  }
  // Folgeaufgabe zurückgenommen: die Reihe endet bei der Vorgängerin (sonst entstünde sie beim nächsten Lauf neu)
  if (undo.stopRecurrence?.length) {
    await c.env.DB.prepare('UPDATE tasks SET recurrence = NULL WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))').bind(t, JSON.stringify(undo.stopRecurrence)).run();
  }
  if (undo.priorities?.length) {
    for (const p of undo.priorities) {
      const r = await c.env.DB.prepare("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND priority = 'high'").bind(p.priority, n, p.id, t).run();
      if (r.meta.changes) removed++;
      else kept++;
    }
  }
  if (undo.intervals?.length) {
    const r = await revertIntervals(c, undo.intervals);
    removed += r.reverted;
    kept += r.kept;
  }
  if (undo.deleteReports?.length) {
    const reps = (
      await c.env.DB.prepare('SELECT id, file_key FROM reports WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))')
        .bind(t, JSON.stringify(undo.deleteReports))
        .all<{ id: string; file_key: string }>()
    ).results;
    for (const r of reps) await c.env.FILES.delete(r.file_key);
    if (reps.length) await c.env.DB.prepare('DELETE FROM reports WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))').bind(t, JSON.stringify(reps.map((r) => r.id))).run();
    removed += reps.length;
  }
  await logActivity(c, 'undo', 'automation', row.id, `Autopilot rückgängig: ${row.summary}`);
  return c.json({ ok: true, reverted: removed, kept });
});

/** Regel einmal ausführen (Knopf eines Vorschlags). Stufe „Aus“ → 409. */
automation.post('/automation/:key/run', async (c) => {
  const key = keyParam(c);
  const def = automationDef(key)!;
  requireRole(c, def.adminOnly ? 'admin' : 'inspector');
  const s = await loadSettings(c.env, tid(c));
  if (s[key].mode === 'off') throw new HTTPException(409, { message: 'Diese Regel ist ausgeschaltet' });
  let done = 0;
  if (key === 'plan_week') done = await planWeek(c);
  else if (key === 'escalate_sla') done = await escalateSla(c);
  else if (key === 'close_stale') done = await closeStale(c);
  else if (key === 'recurring_tasks') done = await createRecurrences(c, null);
  else if (key === 'assign_defect_tasks') done = await createDefectTasks(c, { severities: autoSeverities(rulesOf(s[key].config)) });
  else if (key === 'adapt_intervals') throw new HTTPException(400, { message: 'Intervall-Vorschläge einzeln übernehmen: auf „Heute“ oder auf der Elementseite' });
  else throw new HTTPException(400, { message: 'Monatsberichte entstehen im Browser: Berichte öffnen und „Monatsberichte erzeugen“ wählen' });
  // created: Anzahl angelegter Aufgaben (wie /smart/tasks-from-defects), nur bei Regeln, die Aufgaben anlegen
  return c.json({ key, done, ...(key === 'escalate_sla' || key === 'close_stale' ? {} : { created: done }) });
});

// Monatsberichte: der Browser einer Admin-Person erzeugt die PDFs. Ablauf: Status → Platz reservieren → PDFs archivieren → abschließen.
const requireMonthly = (c: Ctx) => {
  requireRole(c, 'admin');
  if (c.get('user').scope) throw new HTTPException(403, { message: 'Nur ohne eingeschränkten Zugriffsbereich möglich' });
};

automation.get('/automation/monthly-report', async (c) => {
  requireMonthly(c);
  const mode = (await loadSettings(c.env, tid(c))).monthly_report.mode;
  const m = await monthlyState(c.env, tid(c), now());
  return c.json({ mode, period: m.period, label: m.label, properties: m.properties, due: mode !== 'off' && !m.done && m.properties > 0 });
});

automation.post('/automation/monthly-report/claim', async (c) => {
  requireMonthly(c);
  const t = tid(c);
  if ((await loadSettings(c.env, t)).monthly_report.mode === 'off') throw new HTTPException(409, { message: 'Diese Regel ist ausgeschaltet' });
  const n = now();
  const m = await monthlyState(c.env, t, n);
  // Liegengebliebene Reservierung (Browser geschlossen) freigeben
  await c.env.DB.prepare(
    `UPDATE automation_log SET undone_at = ?1, undone_by = 'system' WHERE tenant_id = ?2 AND key = 'monthly_report' AND entity_id = ?3 AND undone_at IS NULL
        AND json_extract(undo, '$.pending') = 1 AND at < ?4`,
  )
    .bind(n, t, m.period, n - 30 * 60_000)
    .run();
  const lid = id();
  // Atomar: nur eine Reservierung je Monat
  const r = await c.env.DB.prepare(
    `INSERT INTO automation_log (id, tenant_id, key, at, summary, entity_type, entity_id, undo, actor)
     SELECT ?1, ?2, 'monthly_report', ?3, ?4, 'report_month', ?5, '{"pending":true}', ?6
      WHERE NOT EXISTS (SELECT 1 FROM automation_log WHERE tenant_id = ?2 AND key = 'monthly_report' AND entity_id = ?5 AND undone_at IS NULL)`,
  )
    .bind(lid, t, n, `Monatsberichte ${m.label} werden erzeugt`, m.period, c.get('user').userId)
    .run();
  if (!r.meta.changes) throw new HTTPException(409, { message: `Monatsberichte ${m.label} sind bereits erzeugt oder in Arbeit` });
  const props = (
    await c.env.DB.prepare('SELECT id, name FROM properties WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 100').bind(t).all<{ id: string; name: string }>()
  ).results;
  return c.json({ logId: lid, period: m.period, label: m.label, properties: props });
});

automation.post('/automation/monthly-report/:id/complete', async (c) => {
  requireMonthly(c);
  const { reportIds } = z.object({ reportIds: z.array(z.string().max(40)).max(100) }).parse(await c.req.json());
  const t = tid(c);
  const row = await c.env.DB.prepare(
    "SELECT id, entity_id FROM automation_log WHERE id = ? AND tenant_id = ? AND key = 'monthly_report' AND undone_at IS NULL AND json_extract(undo, '$.pending') = 1",
  )
    .bind(c.req.param('id'), t)
    .first<{ id: string; entity_id: string }>();
  if (!row) notFound('Reservierung');
  // Nur eigene, gerade archivierte Berichte dieses Workspaces übernehmen
  const ok = (
    await c.env.DB.prepare('SELECT id FROM reports WHERE tenant_id = ? AND created_by = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(t, c.get('user').userId, JSON.stringify(reportIds))
      .all<{ id: string }>()
  ).results.map((r) => r.id);
  const label = periodLabel(row.entity_id);
  await c.env.DB.prepare('UPDATE automation_log SET summary = ?, undo = ?, link = ?, at = ? WHERE id = ?')
    .bind(`${plural(ok.length, 'Ein Monatsbericht', 'Monatsberichte')} ${label} archiviert`, ok.length ? JSON.stringify({ deleteReports: ok }) : null, '/berichte', now(), row.id)
    .run();
  return c.json({ ok: true, archived: ok.length });
});
