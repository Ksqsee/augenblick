// Kritische und hohe Befunde in bereitgelegten Prüfungen (Plan v6 A2). Sie werden bewusst nicht vorab als Mangel
// angelegt (beim Abschluss entstünden Doppelte), sondern sichtbar gemacht: ganz oben in „Jetzt“ (GET /now) und im
// MCP-briefing, und beim Bereitlegen mit kritischem Befund sofort als Benachrichtigung an Inhaber/Admins und die
// prüfende Person.
import { Hono } from 'hono';
import { tid } from './data';
import { type AppEnv, type Ctx, scopeSql } from './lib';
import { notifyTenant } from './notify';

export const pendingRoutes = new Hono<AppEnv>();
/** Schwere Befunde, die auf eine Unterschrift warten (für briefing und Fremdsysteme), im Zugriffsbereich. */
pendingRoutes.get('/inspections/pending-findings', async (c) => c.json(await pendingSevereFindings(c)));

export interface PendingFinding {
  inspectionId: string;
  inspectorId: string;
  inspector: string;
  readyAt: number;
  code: string;
  location: string;
  buildingName: string;
  propertyName: string;
  title: string;
  severity: 'high' | 'critical';
}

/** Schwere Befunde (Standard: hoch und kritisch) in Prüfungen, die zur Unterschrift bereitliegen – im Zugriffsbereich. */
export async function pendingSevereFindings(c: Ctx, severities: ('high' | 'critical')[] = ['high', 'critical']): Promise<PendingFinding[]> {
  return (
    await c.env.DB.prepare(
      `SELECT i.id AS inspectionId, i.inspector_id AS inspectorId, u.name AS inspector, i.ready_at AS readyAt, a.code, a.location,
              b.name AS buildingName, p.name AS propertyName,
              json_extract(j.value, '$.title') AS title, json_extract(j.value, '$.severity') AS severity
         FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
         JOIN users u ON u.id = i.inspector_id, json_each(COALESCE(json_extract(i.maintenance, '$.defects'), '[]')) j
        WHERE i.tenant_id = ?1 AND i.status = 'draft' AND i.ready_at IS NOT NULL AND a.deleted_at IS NULL AND p.deleted_at IS NULL
          AND json_extract(j.value, '$.severity') IN (SELECT value FROM json_each(?2)) AND ${scopeSql(c, 'a.building_id', 'building')}
        ORDER BY CASE json_extract(j.value, '$.severity') WHEN 'critical' THEN 0 ELSE 1 END, i.ready_at LIMIT 200`,
    )
      .bind(tid(c), JSON.stringify(severities))
      .all<PendingFinding>()
  ).results;
}

/**
 * Nach dem Bereitlegen (PUT /inspections/:id mit ready): enthält die Prüfung einen kritischen Befund, sofort Inhaber
 * und Admins sowie die prüfende Person benachrichtigen – auch wenn sie selbst (z. B. über Claude) bereitgelegt hat.
 * Je Prüfung nur einmal (dedupe).
 */
export async function notifyCriticalReady(c: Ctx, inspectionId: string) {
  const rows = (await pendingSevereFindings(c, ['critical'])).filter((r) => r.inspectionId === inspectionId);
  if (!rows.length) return;
  const r = rows[0];
  const what = rows.length === 1 ? `„${r.title}“` : `${rows.length} kritische Befunde (u. a. „${r.title}“)`;
  const body = `${what} – bereitgelegt von ${r.inspector}${r.location ? `, ${r.location}` : ''}, ${r.propertyName}. Erst mit der Unterschrift wird daraus ein Mangel mit Aufgabe.`;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  // prüfende Person: zur Unterschrift; Admins: zur Prüfung (unterschreiben kann nur die prüfende Person)
  await notifyTenant(
    c.env,
    tid(c),
    { userIds: [r.inspectorId], type: 'critical_defect', title: `Kritischer Befund wartet auf deine Unterschrift: ${r.code}`, body, link: '/unterschreiben', dedupe: `ready-critical-${inspectionId}` },
    ctx,
  );
  await notifyTenant(
    c.env,
    tid(c),
    { roles: ['owner', 'admin'], exceptUserId: r.inspectorId, type: 'critical_defect', title: `Kritischer Befund wartet auf Unterschrift: ${r.code}`, body, link: `/pruefung/${inspectionId}`, dedupe: `ready-critical-${inspectionId}` },
    ctx,
  );
  if (pending.length) c.executionCtx.waitUntil(Promise.allSettled(pending));
}
