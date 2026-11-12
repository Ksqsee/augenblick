// Selbstanpassende Prüfintervalle (Autopilot-Schritt 5 „Lernen“, Schlüssel `adapt_intervals`, Logik in shared/intervals.ts).
// Stufe je Workspace in `tenants.adapt_intervals_mode`: off | suggest | auto (bei ausgeschaltetem Autopiloten wirkt „off“).
// - suggest: Vorschläge in GET /now (und /smart/suggestions) (Aktion POST /smart/intervals/apply) und auf der Elementseite
// - auto: wird beim Abschluss einer Prüfung angewendet (worker/inspections.ts → finalize) und protokolliert
// Im Autopilot als Regel `adapt_intervals` registriert (worker/automation.ts liest/schreibt dieselbe Spalte);
// übernommene und automatisch angewendete Intervalle stehen im Autopilot-Protokoll, „Rückgängig“ = revertIntervals.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type AdaptMode, applyInterval, describeProposal, effectiveInterval, type HistoryEntry, type IntervalProposal, proposeInterval } from '../shared/intervals';
import { type Result, type Schedules, summarizeSchedules } from '../shared/logic';
import { autopilotEnabled, logAutomation } from './automation';
import { listCategories } from './categories';
import { tid } from './data';
import { type AppEnv, type Ctx, logActivity, notFound, now, parseJson, requireRole, scopeSql } from './lib';

export const intervals = new Hono<AppEnv>();

/** Wirksame Stufe des Schritts „Lernen“: gespeicherte Stufe, „off“ solange der Autopilot ausgeschaltet ist. */
export async function adaptMode(c: Ctx): Promise<AdaptMode> {
  const m = await c.env.DB.prepare('SELECT adapt_intervals_mode FROM tenants WHERE id = ?').bind(tid(c)).first<string>('adapt_intervals_mode');
  if (!(await autopilotEnabled(c.env, tid(c)))) return 'off';
  return m === 'off' || m === 'auto' ? m : 'suggest';
}

/** Schreibt die Prüfarten eines Elements und die daraus abgeleiteten Spalten. */
export function writeSchedules(c: Ctx, assetId: string, s: Schedules, lastInspectionId?: string | null) {
  const sum = summarizeSchedules(s);
  return c.env.DB.prepare(
    `UPDATE assets SET schedules = ?, next_due_at = ?, last_inspected_at = ?, last_result = ?, updated_at = ?,
            last_inspection_id = COALESCE(?, last_inspection_id) WHERE id = ?`,
  )
    .bind(JSON.stringify(s), sum.nextDueAt, sum.lastAt, sum.lastResult, now(), lastInspectionId ?? null, assetId)
    .run();
}

/**
 * Letzte gültige reguläre Prüfungen je Element und Prüfart (Schlüssel `assetId|schedule`), höchstens 10 je Paar.
 * Nachprüfungen zählen nicht (sie schreiben den Turnus nicht fort), berichtigte Prüfungen nur in der neuen Fassung.
 */
export async function intervalHistory(c: Ctx, assetIds: string[] | null): Promise<Map<string, HistoryEntry[]>> {
  const rows = (
    await c.env.DB.prepare(
      `SELECT asset_id, schedule, result, inspected_at FROM (
         SELECT i.asset_id, i.schedule, i.result, i.inspected_at,
                ROW_NUMBER() OVER (PARTITION BY i.asset_id, i.schedule ORDER BY i.inspected_at DESC) AS rn
           FROM inspections i
          WHERE i.tenant_id = ?1 AND i.status = 'submitted' AND i.superseded_at IS NULL AND i.purpose != 'follow_up' AND i.inspected_at IS NOT NULL
            AND (?2 IS NULL OR i.asset_id IN (SELECT value FROM json_each(?2)))
       ) WHERE rn <= 10 LIMIT 50000`,
    )
      .bind(tid(c), assetIds ? JSON.stringify(assetIds) : null)
      .all<{ asset_id: string; schedule: string | null; result: Result; inspected_at: number }>()
  ).results;
  const out = new Map<string, HistoryEntry[]>();
  for (const r of rows) {
    const k = `${r.asset_id}|${r.schedule ?? 'main'}`;
    out.set(k, [...(out.get(k) ?? []), { at: r.inspected_at, result: r.result }]);
  }
  return out;
}

export interface IntervalSuggestion extends IntervalProposal {
  assetId: string;
  code: string;
  location: string;
  buildingName: string;
  propertyName: string;
  schedule: string;
  scheduleLabel: string;
  text: string;
}

interface AssetRow {
  id: string;
  code: string;
  category: string;
  location: string;
  schedules: string;
  buildingName: string;
  propertyName: string;
}

/** Standardintervalle aller Prüfarten des Workspaces (inkl. eigener Vorlagen): `category|schedule` → Monate. */
async function standards(c: Ctx) {
  const map = new Map<string, { months: number; label: string }>();
  for (const cat of await listCategories(c)) for (const s of cat.schedulesEffective) map.set(`${cat.key}|${s.key}`, { months: s.intervalMonths, label: s.label });
  return map;
}

/** Offene Vorschläge im Zugriffsbereich (optional nur für ein Element). */
export async function intervalSuggestions(c: Ctx, assetId?: string): Promise<IntervalSuggestion[]> {
  const assets = (
    await c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, a.schedules, b.name AS buildingName, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL AND (?2 IS NULL OR a.id = ?2)
          AND ${scopeSql(c, 'b.id', 'building')}
          AND (a.last_result IN ('defects','critical') OR a.schedules LIKE '%"intervalMonths":%' OR EXISTS (
                SELECT 1 FROM inspections x WHERE x.asset_id = a.id AND x.status = 'submitted' AND x.result IN ('defects','critical')))
        LIMIT 5000`,
    )
      .bind(tid(c), assetId ?? null)
      .all<AssetRow>()
  ).results;
  if (!assets.length) return [];
  const [history, std] = await Promise.all([intervalHistory(c, assets.map((a) => a.id)), standards(c)]);
  const out: IntervalSuggestion[] = [];
  for (const a of assets) {
    const sched = parseJson<Schedules>(a.schedules, {});
    for (const [key, st] of Object.entries(sched)) {
      if (!st.enabled && key !== 'main') continue;
      const s = std.get(`${a.category}|${key}`);
      if (!s) continue;
      const p = proposeInterval(s.months, st, history.get(`${a.id}|${key}`) ?? []);
      if (!p) continue;
      out.push({ ...p, assetId: a.id, code: a.code, location: a.location, buildingName: a.buildingName, propertyName: a.propertyName, schedule: key, scheduleLabel: s.label, text: describeProposal(p) });
    }
  }
  // Verkürzungen zuerst (Sicherheit), dann Rückkehr zum Standard
  return out.sort((x, y) => (x.kind === y.kind ? x.code.localeCompare(y.code) : x.kind === 'shorten' ? -1 : 1));
}

/** Element im Zugriffsbereich mit Standardintervall der Prüfart laden. */
async function loadTarget(c: Ctx, assetId: string, schedule: string) {
  const a = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.schedules, b.id AS buildingId, b.property_id AS propertyId FROM assets a JOIN buildings b ON b.id = a.building_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL AND ${scopeSql(c, 'a.building_id', 'building')}`,
  )
    .bind(assetId, tid(c))
    .first<{ id: string; code: string; category: string; schedules: string; buildingId: string; propertyId: string }>();
  if (!a) notFound('Element');
  const s = (await standards(c)).get(`${a.category}|${schedule}`);
  const schedules = parseJson<Schedules>(a.schedules, {});
  if (!s || !schedules[schedule]) throw new HTTPException(400, { message: 'Diese Prüfart ist für das Element nicht aktiv' });
  return { ...a, schedules, standard: s.months, label: s.label };
}

/** Intervall setzen (Standard = Anpassung entfernen) und protokollieren. */
async function changeInterval(c: Ctx, t: Awaited<ReturnType<typeof loadTarget>>, schedule: string, months: number, summary: string) {
  const next = { ...t.schedules, [schedule]: applyInterval(t.schedules[schedule], t.standard, months, now()) };
  await writeSchedules(c, t.id, next);
  await logActivity(c, 'adapt_interval', 'asset', t.id, `${t.code} (${t.label}): ${summary}`);
  return next[schedule];
}

intervals.get('/smart/intervals', async (c) => {
  const assetId = c.req.query('assetId');
  return c.json({ mode: await adaptMode(c), suggestions: (await adaptMode(c)) === 'off' ? [] : await intervalSuggestions(c, assetId || undefined) });
});

const target = z.object({ assetId: z.string().max(40), schedule: z.string().max(40).default('main') });

/** Vorschlag übernehmen. `months` muss dem aktuellen Vorschlag entsprechen (sonst 409: Daten haben sich geändert). */
intervals.post('/smart/intervals/apply', async (c) => {
  requireRole(c, 'admin');
  const b = target.extend({ months: z.number().int().min(1).max(240) }).parse(await c.req.json());
  const t = await loadTarget(c, b.assetId, b.schedule);
  const history = (await intervalHistory(c, [t.id])).get(`${t.id}|${b.schedule}`) ?? [];
  const p = proposeInterval(t.standard, t.schedules[b.schedule], history);
  if (!p || p.to !== b.months) throw new HTTPException(409, { message: 'Der Vorschlag ist nicht mehr aktuell' });
  const from = t.schedules[b.schedule].intervalMonths ?? null;
  const st = await changeInterval(c, t, b.schedule, p.to, describeProposal(p));
  await logIntervalChange(c, { assetId: t.id, code: t.code, buildingId: t.buildingId, propertyId: t.propertyId, schedule: b.schedule, label: t.label, from, to: st.intervalMonths ?? null, text: describeProposal(p) });
  return c.json({ ok: true, intervalMonths: effectiveInterval(t.standard, st), nextDueAt: st.nextDueAt ?? null });
});

/** Angepasstes Intervall auf den Standard zurücksetzen. */
intervals.post('/smart/intervals/reset', async (c) => {
  requireRole(c, 'admin');
  const b = target.parse(await c.req.json());
  const t = await loadTarget(c, b.assetId, b.schedule);
  if (t.schedules[b.schedule].intervalMonths == null) throw new HTTPException(409, { message: 'Das Intervall entspricht bereits dem Standard' });
  const st = await changeInterval(c, t, b.schedule, t.standard, `Intervall auf ${t.standard} Monate (Standard) zurückgesetzt`);
  return c.json({ ok: true, intervalMonths: t.standard, nextDueAt: st.nextDueAt ?? null });
});

// ---------- Autopilot-Protokoll und Rückgängig ----------
/** Was „Rückgängig“ braucht: Intervall vorher (`from`) und nachher (`to`), jeweils null = Standard. */
export interface IntervalUndo {
  assetId: string;
  schedule: string;
  from: number | null;
  to: number | null;
}

/** Angewendetes Intervall ins Autopilot-Protokoll schreiben (Regel `adapt_intervals`, rückgängig zu machen). */
export function logIntervalChange(
  c: Ctx,
  e: { assetId: string; code: string; buildingId: string; propertyId: string; schedule: string; label: string; from: number | null; to: number | null; text: string; auto?: boolean },
) {
  return logAutomation(
    c,
    {
      key: 'adapt_intervals',
      summary: `${e.code} (${e.label}): ${e.text}${e.auto ? ' – automatisch' : ''}`,
      entityType: 'asset',
      entityId: e.assetId,
      buildingId: e.buildingId,
      propertyId: e.propertyId,
      link: `/elemente/${e.assetId}`,
      undo: { intervals: [{ assetId: e.assetId, schedule: e.schedule, from: e.from, to: e.to }] },
    },
    // automatisch beim Prüfungsabschluss angewendet: Akteur ist der Autopilot
    { system: e.auto },
  );
}

/**
 * Rückgängig: Intervall auf den vorherigen Wert (null = Standard) setzen – nur, wenn noch das angewendete gilt
 * (sonst hat jemand es inzwischen geändert und es bleibt). Element im Workspace und Bereich, sonst bleibt es.
 */
export async function revertIntervals(c: Ctx, list: IntervalUndo[]) {
  let reverted = 0;
  let kept = 0;
  for (const u of list) {
    let t: Awaited<ReturnType<typeof loadTarget>>;
    try {
      t = await loadTarget(c, u.assetId, u.schedule);
    } catch {
      kept++;
      continue;
    }
    if ((t.schedules[u.schedule].intervalMonths ?? null) !== u.to) {
      kept++;
      continue;
    }
    const months = u.from ?? t.standard;
    await changeInterval(c, t, u.schedule, months, `Intervall auf ${months} Monate zurückgesetzt (Autopilot rückgängig)`);
    reverted++;
  }
  return { reverted, kept };
}
