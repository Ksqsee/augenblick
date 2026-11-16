// Angebotsliste eines Objekts (Plan v7, Paket V): GET /properties/:id/offer rechnet aus den offenen Mängeln und dem
// Katalog (Zuordnung Mangel → Leistung, Preis nach Bedingung auf die Stammdaten) die Positionen. Lesen ab Prüfer und
// nur im eigenen Zugriffsbereich (Preise sind intern: kein Lesezugriff, keine Kunden-/Partnerfreigabe).
// Form: { lines: [{ serviceKey, title, unit, unitPrice, quantity, total, doors, defects }], unmapped: [{ defectId, title,
// door, reason }], net } – siehe docs/api.md. Paket X baut Seite und Excel/PDF darauf.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { computeOffer, type OfferDefect } from '../shared/catalog-offer';
import { readCatalog } from './catalog';
import { defectScope } from './data';
import { type AppEnv, type Ctx, assertInScope, notFound, parseJson, requireRole } from './lib';

export const offer = new Hono<AppEnv>();

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** JJJJ-MM-TT → Beginn bzw. Ende des Tages (UTC) in ms; ungültig → 400 */
function dayBound(v: string | undefined, end: boolean): number | null {
  if (!v) return null;
  const d = new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!DATE.test(v) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new HTTPException(400, { message: `Datum „${v}“ ungültig (JJJJ-MM-TT)` });
  return d.getTime();
}

/** Offene Mängel eines Objekts (optional nur aus bestimmten Prüfungen bzw. in einem Zeitraum) mit Element-Stammdaten. */
export async function offerDefects(c: Ctx, propertyId: string, opts: { inspectionIds?: string[] | null; from?: number | null; to?: number | null } = {}) {
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.title, a.category, a.code, a.attributes
       FROM defects d LEFT JOIN assets a ON a.id = d.asset_id AND a.deleted_at IS NULL
      WHERE d.tenant_id = ?1 AND d.property_id = ?2 AND d.status = 'open' AND d.hidden_at IS NULL AND ${defectScope(c, 'd')}
        AND (?3 IS NULL OR d.inspection_id IN (SELECT value FROM json_each(?3)))
        AND (?4 IS NULL OR d.created_at >= ?4) AND (?5 IS NULL OR d.created_at <= ?5)
      ORDER BY COALESCE(a.number, 999999), a.code, d.created_at
      LIMIT 5000`,
  )
    .bind(c.get('user').tenantId, propertyId, opts.inspectionIds ? JSON.stringify(opts.inspectionIds) : null, opts.from ?? null, opts.to ?? null)
    .all<{ id: string; title: string; category: string | null; code: string | null; attributes: string | null }>();
  return rows.results.map(
    (r): OfferDefect => ({ id: r.id, title: r.title, category: r.category, code: r.code, attributes: r.attributes ? parseJson<Record<string, unknown>>(r.attributes, {}) : null }),
  );
}

offer.get('/properties/:id/offer', async (c) => {
  requireRole(c, 'inspector');
  const pid = c.req.param('id');
  assertInScope(c, 'property', pid);
  const p = await c.env.DB.prepare('SELECT id FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(pid, c.get('user').tenantId).first();
  if (!p) notFound('Objekt');
  const q = c.req.query();
  const inspectionIds = q.inspectionIds
    ? [...new Set(q.inspectionIds.split(',').map((x) => x.trim()).filter(Boolean))]
    : null;
  if (inspectionIds && (inspectionIds.length > 500 || inspectionIds.some((x) => x.length > 64))) throw new HTTPException(400, { message: 'Zu viele oder ungültige Prüfungen' });
  const from = dayBound(q.from, false);
  const to = dayBound(q.to, true);
  if (from != null && to != null && from > to) throw new HTTPException(400, { message: '„von“ liegt nach „bis“' });
  const [defects, cat] = await Promise.all([offerDefects(c, pid, { inspectionIds, from, to }), readCatalog(c)]);
  return c.json(computeOffer(defects, cat.defects, cat.services));
});
