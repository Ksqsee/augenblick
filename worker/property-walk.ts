// Begehung eines Objekts (Plan v8, Paket Z): GET /properties/:id/walk?date=JJJJ-MM-TT liefert die Prüfungen des Objekts
// an einem Kalendertag (Zeitzone des Workspaces) – die Ergebnisliste im Reiter „Begehung“ –, die Tage mit Prüfungen zur
// Auswahl und die Zahl der eigenen Prüfungen, die im Objekt auf die Unterschrift warten. Ohne `date` der neueste Tag mit
// Prüfungen. Eine Abfrage (Batch), kein N+1: Entwürfe werden in SQL auf Mängelzahl, „kritisch“, „nicht prüfbar“ und
// Festlegung verdichtet, das Ergebnis wie beim Abschluss rechnet shared/walk.ts.
// Rechte wie die Prüfungsliste (GET /inspections): alle Mitglieder; Objekt nur im eigenen Workspace und Zugriffsbereich
// (`assertInScope`, sonst 404), Prüfungen nur in freigegebenen Gebäuden (`scopeSql`). Befund #40 in docs/security.md.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type Ymd, zonedTime } from '../shared/dates';
import type { Result, ResultOverride } from '../shared/logic';
import { draftOutcome, pickWalkDay, walkDays, type WalkInspection } from '../shared/walk';
import { dayIn } from '../shared/dates';
import { tid } from './data';
import { type AppEnv, assertInScope, notFound, scopeSql } from './lib';

export const propertyWalk = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RAW_PENDING = "(SELECT COUNT(*) FROM json_each(i.raw_notes) j WHERE COALESCE(json_extract(j.value, '$.evaluated'), 0) = 0)";
/** höchstens so viele Tage in der Auswahl (neueste zuerst) */
const MAX_DAYS = 120;

function parseDay(v: string): Ymd {
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (!DATE.test(v) || check.toISOString().slice(0, 10) !== v) throw new HTTPException(400, { message: `Datum „${v}“ ungültig (JJJJ-MM-TT)` });
  return { y, m, d };
}

interface Row {
  id: string;
  assetId: string;
  status: 'draft' | 'submitted';
  result: Result | null;
  readyAt: number | null;
  at: number;
  inspectorId: string;
  inspector: string;
  defects: number | null;
  critical: number;
  notInspectable: number | null;
  override: ResultOverride | null;
  defectAnswer: number;
  rawPending: number;
}

propertyWalk.get('/properties/:id/walk', async (c) => {
  const pid = c.req.param('id');
  assertInScope(c, 'property', pid);
  const wanted = c.req.query('date');
  if (wanted) parseDay(wanted);
  const t = tid(c);
  const [prop, tenant, rows] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(pid, t),
    c.env.DB.prepare('SELECT timezone FROM tenants WHERE id = ?').bind(t),
    c.env.DB.prepare(
      `SELECT i.id, i.asset_id AS assetId, i.status, i.result, i.ready_at AS readyAt, COALESCE(i.inspected_at, i.created_at) AS at,
              i.inspector_id AS inspectorId, u.name AS inspector,
              json_array_length(i.maintenance, '$.defects') AS defects,
              EXISTS (SELECT 1 FROM json_each(i.maintenance, '$.defects') d WHERE json_extract(d.value, '$.severity') = 'critical') AS critical,
              json_extract(i.maintenance, '$.notInspectable') AS notInspectable,
              json_extract(i.maintenance, '$.resultOverride') AS override,
              CASE WHEN i.status = 'draft' THEN EXISTS (SELECT 1 FROM json_each(i.answers) x WHERE x.value = 'defect') ELSE 0 END AS defectAnswer,
              ${RAW_PENDING} AS rawPending
         FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id JOIN users u ON u.id = i.inspector_id
        WHERE i.tenant_id = ?1 AND b.property_id = ?2 AND a.deleted_at IS NULL AND i.archived_at IS NULL AND i.superseded_at IS NULL
          AND ${scopeSql(c, 'a.building_id', 'building')}
        ORDER BY at DESC LIMIT 5000`,
    ).bind(t, pid),
  ]);
  if (!prop!.results.length) notFound('Objekt');
  const tz = ((tenant!.results[0] as { timezone?: string } | undefined)?.timezone as string) || 'Europe/Berlin';
  const all = rows!.results as unknown as Row[];
  const days = walkDays(all.map((r) => r.at), tz);
  const today = dayIn(Date.now(), tz);
  const date = pickWalkDay(days, wanted, today);
  const day = parseDay(date);
  const from = zonedTime(day, 0, 0, 0, tz);
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  const to = zonedTime({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() }, 0, 0, 0, tz);
  const me = c.get('user').userId;
  const inspections: WalkInspection[] = all
    .filter((r) => r.at >= from && r.at < to)
    .map((r) => {
      const n = Number(r.defects ?? 0);
      const ready = r.status === 'draft' && r.readyAt != null;
      const result =
        r.status === 'submitted'
          ? r.result
          : ready
            ? draftOutcome({
                notInspectable: !!r.notInspectable,
                answers: r.defectAnswer ? { x: 'defect' } : {},
                defects: Array.from({ length: n }, (_, k) => ({ severity: k === 0 && r.critical ? 'critical' : 'medium' })),
                resultOverride: r.override,
              })
            : null;
      return { id: r.id, assetId: r.assetId, status: r.status, ready, result, defects: n, rawPending: Number(r.rawPending ?? 0), at: r.at, inspectorId: r.inspectorId, inspector: r.inspector };
    });
  return c.json({
    date,
    today,
    timeZone: tz,
    from,
    to: to - 1,
    days: days.slice(0, MAX_DAYS),
    inspections,
    /** eigene Prüfungen im Objekt, die auf die Unterschrift warten (alle Tage) */
    pending: all.filter((r) => r.status === 'draft' && r.readyAt != null && r.inspectorId === me).length,
  });
});
