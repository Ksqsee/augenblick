import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Category, type Checkpoint, INSPECTION_KINDS } from '../shared/catalog';
import { type Answer, addMonths, applyInspection, computeResult, DAY, finalResult, isComplete, type Result, type Schedules, summarizeSchedules } from '../shared/logic';
import { getCategoryDef, getSchedule, listCategories } from './categories';
import { assetQuery, mapAsset, severityEnum, str, tid } from './data';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireRole } from './lib';
import { notify } from './notify';

export const inspections = new Hono<AppEnv>();

const answerEnum = z.enum(['ok', 'defect', 'na']);
const defectInput = z.object({
  checkpointId: z.string().max(40).optional(),
  title: str(300).min(1, 'Mangel ohne Beschreibung'),
  note: str(2000).default(''),
  measure: str(1000).default(''),
  severity: severityEnum,
  photoKey: z.string().max(200).optional(),
});
const photoInput = z.object({ key: z.string().max(200), caption: str(300).default('') });
const inspectionBody = z.object({
  kind: z.enum(Object.keys(INSPECTION_KINDS) as [keyof typeof INSPECTION_KINDS]),
  notInspectable: z.boolean().default(false),
  answers: z.record(answerEnum).default({}),
  maintenance: z.array(z.string().max(40)).default([]),
  defects: z.array(defectInput).max(100).default([]),
  photos: z.array(photoInput).max(40).default([]),
  notes: str(5000).default(''),
  signature: z.string().max(400_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Ungültige Unterschrift').nullable().default(null),
  signerName: str(160).default(''),
  resultOverride: z.enum(['ok', 'defects', 'critical']).nullable().default(null),
  resultReason: str(500).default(''),
});
type InspectionBody = z.infer<typeof inspectionBody>;

const isTenantKey = (c: Ctx, key: string) => key.startsWith(`${tid(c)}/`);

inspections.get('/inspections', async (c) => {
  const q = c.req.query();
  const args: unknown[] = [tid(c)];
  const where: string[] = [q.archived === '1' ? 'i.archived_at IS NOT NULL' : 'i.archived_at IS NULL'];
  if (q.status === 'draft' || q.status === 'submitted') {
    args.push(q.status);
    where.push(`i.status = ?${args.length}`);
  }
  if (q.propertyId) {
    args.push(q.propertyId);
    where.push(`p.id = ?${args.length}`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.kind, i.schedule, i.status, i.result, i.inspected_at AS inspectedAt, i.created_at AS createdAt, i.next_due_at AS nextDueAt,
            i.archived_at AS archivedAt, a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            u.name AS inspector
       FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id
       JOIN properties p ON p.id = b.property_id JOIN users u ON u.id = i.inspector_id
      WHERE i.tenant_id = ?1 AND ${where.join(' AND ')} ORDER BY COALESCE(i.inspected_at, i.created_at) DESC LIMIT 1000`,
  )
    .bind(...args)
    .all();
  return c.json(rows.results);
});

async function loadAsset(c: Ctx, assetId: string) {
  const a = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.schedules, b.property_id AS propertyId FROM assets a JOIN buildings b ON b.id = a.building_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`,
  )
    .bind(assetId, tid(c))
    .first<{ id: string; code: string; category: Category; schedules: string; propertyId: string }>();
  if (!a) notFound('Element');
  return { ...a, schedules: parseJson<Schedules>(a.schedules, {}) };
}

/** Prüfart eines Elements aktivieren/deaktivieren, ersten Termin setzen. */
inspections.put('/assets/:id/schedules', async (c) => {
  requireRole(c, 'inspector');
  const b = z.object({ key: z.string().max(40), enabled: z.boolean(), nextDueAt: z.number().int().nullable().optional() }).parse(await c.req.json());
  if (b.key === 'main' && !b.enabled) throw new HTTPException(400, { message: 'Die Hauptprüfung kann nicht deaktiviert werden' });
  const a = await loadAsset(c, c.req.param('id'));
  await getSchedule(c, a.category, b.key); // existiert die Prüfart?
  const prev = a.schedules[b.key] ?? { enabled: false };
  const next: Schedules = {
    ...a.schedules,
    [b.key]: { ...prev, enabled: b.enabled, nextDueAt: b.nextDueAt !== undefined ? b.nextDueAt : (prev.nextDueAt ?? (b.enabled ? now() : null)) },
  };
  await writeSchedules(c, a.id, next);
  return c.json({ ok: true });
});

function writeSchedules(c: Ctx, assetId: string, s: Schedules, lastInspectionId?: string | null) {
  const sum = summarizeSchedules(s);
  return c.env.DB.prepare(
    `UPDATE assets SET schedules = ?, next_due_at = ?, last_inspected_at = ?, last_result = ?, updated_at = ?,
            last_inspection_id = COALESCE(?, last_inspection_id) WHERE id = ?`,
  )
    .bind(JSON.stringify(s), sum.nextDueAt, sum.lastAt, sum.lastResult, now(), lastInspectionId ?? null, assetId)
    .run();
}

/** Termine eines Elements vollständig aus der Prüfhistorie neu berechnen (nach Wiedereröffnen/Löschen). */
export async function recomputeAsset(c: Ctx, assetId: string) {
  const a = await loadAsset(c, assetId);
  const rows = (
    await c.env.DB.prepare(
      "SELECT id, schedule, result, inspected_at, next_due_at FROM inspections WHERE asset_id = ? AND status = 'submitted' ORDER BY inspected_at",
    )
      .bind(assetId)
      .all<{ id: string; schedule: string; result: Result; inspected_at: number; next_due_at: number | null }>()
  ).results;
  const fresh: Schedules = {};
  for (const [k, v] of Object.entries(a.schedules)) {
    const inspected = rows.some((r) => r.schedule === k);
    // Manuell gesetzte Ersttermine optionaler Prüfarten bleiben erhalten
    fresh[k] = v.baseline
      ? { enabled: true, baseline: v.baseline, lastAt: v.baseline.lastAt, nextDueAt: v.baseline.nextDueAt }
      : { enabled: v.enabled || k === 'main', nextDueAt: !inspected && k !== 'main' ? (v.nextDueAt ?? null) : null };
  }
  let lastId: string | null = null;
  let s = fresh;
  for (const r of rows) {
    s = applyInspection(s, r.schedule, r.inspected_at, r.result, r.next_due_at);
    lastId = r.id;
  }
  await c.env.DB.prepare('UPDATE assets SET last_inspection_id = ? WHERE id = ?').bind(lastId, assetId).run();
  await writeSchedules(c, assetId, s);
}

inspections.post('/assets/:id/inspections', async (c) => {
  requireRole(c, 'inspector');
  const a = await loadAsset(c, c.req.param('id'));
  const body = z.object({ schedule: z.string().max(40).optional() }).parse(await c.req.json().catch(() => ({})));
  const schedule = body.schedule ?? summarizeSchedules(a.schedules).nextKey ?? 'main';
  const existing = await c.env.DB.prepare(
    "SELECT id FROM inspections WHERE asset_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ? AND schedule = ?",
  )
    .bind(a.id, tid(c), c.get('user').userId, schedule)
    .first<{ id: string }>();
  if (existing) return c.json(existing);
  const sched = await getSchedule(c, a.category, schedule);
  const iid = id();
  const t = now();
  const last = await c.env.DB.prepare("SELECT 1 FROM inspections WHERE asset_id = ? AND status = 'submitted' LIMIT 1").bind(a.id).first();
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, reason, status, schedule, answers, maintenance, checkpoints, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'draft',?,'{}','{"items":[],"defects":[]}',?,?,?)`,
  )
    .bind(iid, tid(c), a.id, c.get('user').userId, last ? 'periodic' : 'initial', 'planned', schedule, JSON.stringify(sched.checkpoints), t, t)
    .run();
  return c.json({ id: iid });
});

export async function loadInspection(c: Ctx, iid: string) {
  const row = await c.env.DB.prepare(
    `SELECT i.*, u.name AS inspectorName, a.code, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes,
            b.name AS buildingName, b.address AS buildingAddress, p.id AS propertyId, p.name AS propertyName, p.address AS propertyAddress,
            p.pdf_pattern AS propertyPdfPattern, t.name AS tenantName
       FROM inspections i JOIN users u ON u.id = i.inspector_id JOIN assets a ON a.id = i.asset_id
       JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = ? AND i.tenant_id = ?`,
  )
    .bind(iid, tid(c))
    .first<Record<string, unknown>>();
  if (!row) notFound('Prüfung');
  const extra = parseJson<{
    items: string[];
    defects: InspectionBody['defects'];
    photos?: InspectionBody['photos'];
    notInspectable?: boolean;
    resultOverride?: InspectionBody['resultOverride'];
    resultReason?: string;
  }>(
    row.maintenance as string,
    { items: [], defects: [] },
  );
  const category = row.category as Category;
  const def = await getCategoryDef(c, category).catch(() => null);
  const scheduleKey = (row.schedule as string) ?? 'main';
  const scheduleLabel = def ? ((def.schedules ?? []).find((s) => s.key === scheduleKey)?.label ?? 'Prüfung') : 'Prüfung';
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    propertyId: row.propertyId as string,
    status: row.status as 'draft' | 'submitted',
    kind: row.kind as string,
    schedule: scheduleKey,
    scheduleLabel,
    result: row.result as Result | null,
    answers: parseJson<Record<string, Answer>>(row.answers as string, {}),
    maintenance: extra.items,
    defects: extra.defects,
    photos: extra.photos ?? [],
    notInspectable: !!extra.notInspectable,
    resultOverride: extra.resultOverride ?? null,
    resultReason: extra.resultReason ?? '',
    checkpoints: parseJson<Checkpoint[]>(row.checkpoints as string, []),
    notes: row.notes as string,
    signature: row.signature as string | null,
    signerName: row.signer_name as string,
    inspectorId: row.inspector_id as string,
    inspectorName: row.inspectorName as string,
    inspectedAt: row.inspected_at as number | null,
    nextDueAt: row.next_due_at as number | null,
    archivedAt: row.archived_at as number | null,
    createdAt: row.created_at as number,
    asset: {
      code: row.code as string,
      category,
      categoryLabel: def?.label ?? category,
      norm: def?.norm ?? '',
      location: row.location as string,
      floor: row.floor as string,
      manufacturer: row.manufacturer as string,
      model: row.model as string,
      attributes: parseJson<Record<string, unknown>>(row.attributes as string, {}),
      buildingName: row.buildingName as string,
      buildingAddress: row.buildingAddress as string,
      propertyName: row.propertyName as string,
      propertyAddress: row.propertyAddress as string,
    },
    propertyPdfPattern: row.propertyPdfPattern as string | null,
    tenantName: row.tenantName as string,
  };
}
export type LoadedInspection = Awaited<ReturnType<typeof loadInspection>>;

inspections.get('/inspections/:id', async (c) => c.json(await loadInspection(c, c.req.param('id'))));

function storeDraft(c: Ctx, iid: string, b: InspectionBody) {
  return c.env.DB.prepare('UPDATE inspections SET kind=?, answers=?, maintenance=?, notes=?, signature=?, signer_name=?, updated_at=? WHERE id=?').bind(
    b.kind,
    JSON.stringify(b.answers),
    JSON.stringify({ items: b.maintenance, defects: b.defects, notInspectable: b.notInspectable, photos: b.photos, resultOverride: b.resultOverride, resultReason: b.resultReason }),
    b.notes,
    b.signature,
    b.signerName,
    now(),
    iid,
  );
}

function checkKeys(c: Ctx, b: InspectionBody) {
  for (const k of [...b.photos.map((p) => p.key), ...b.defects.map((d) => d.photoKey).filter(Boolean)] as string[]) {
    if (!isTenantKey(c, k)) throw new HTTPException(400, { message: 'Ungültige Datei' });
  }
}

async function saveDraft(c: Ctx, iid: string, b: InspectionBody) {
  checkKeys(c, b);
  const insp = await loadInspection(c, iid);
  if (insp.status !== 'draft') throw new HTTPException(409, { message: 'Prüfung ist bereits abgeschlossen' });
  if (insp.inspectorId !== c.get('user').userId && !['admin', 'owner'].includes(c.get('user').role)) {
    throw new HTTPException(403, { message: 'Nur der Prüfer kann diesen Entwurf bearbeiten' });
  }
  await storeDraft(c, iid, b).run();
  return insp;
}

/** Validiert, berechnet Ergebnis + Termin und schreibt Prüfung, Element, Mängel und Fotos. */
async function finalize(
  c: Ctx,
  opts: { iid: string; assetId: string; propertyId: string; category: Category; schedule: string; code: string; checkpoints: Checkpoint[]; body: InspectionBody; inspectedAt: number },
) {
  const b = opts.body;
  if (!isComplete(opts.checkpoints.map((p) => p.id), b.answers, b.notInspectable)) {
    throw new HTTPException(400, { message: 'Bitte alle Prüfpunkte bewerten' });
  }
  if (!b.signature) throw new HTTPException(400, { message: 'Unterschrift fehlt' });
  const sched = await getSchedule(c, opts.category, opts.schedule);
  const computed = computeResult({ notInspectable: b.notInspectable, answers: b.answers, defects: b.defects });
  if (b.resultOverride && !b.notInspectable) {
    if (b.resultOverride === 'ok' && b.defects.length) throw new HTTPException(400, { message: '„Ohne Mängel“ ist nur ohne erfasste Mängel möglich' });
    if (b.resultOverride !== computed && b.resultReason.trim().length < 3) throw new HTTPException(400, { message: 'Bitte begründen, warum die Gesamtbewertung abweicht' });
  }
  const result = finalResult(computed, b.resultOverride, b.defects.length);
  const t = opts.inspectedAt;
  // Nicht prüfbar: Termin bleibt, damit das Element weiter als fällig auftaucht.
  const nextDue = result === 'not_inspectable' ? null : addMonths(t, sched.intervalMonths);
  const asset = await loadAsset(c, opts.assetId);
  const schedules = applyInspection(asset.schedules, opts.schedule, t, result, nextDue);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE inspections SET status='submitted', result=?, inspected_at=?, next_due_at=?, updated_at=? WHERE id=?").bind(result, t, nextDue, now(), opts.iid),
    ...b.defects.map((d) =>
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, property_id, asset_id, inspection_id, checkpoint_id, title, note, measure, severity, status, photo_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      ).bind(id(), tid(c), opts.propertyId, opts.assetId, opts.iid, d.checkpointId ?? null, d.title, d.note, d.measure, d.severity, d.photoKey ?? null, t),
    ),
    ...b.photos.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO attachments (id, tenant_id, asset_id, inspection_id, file_key, name, content_type, caption, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id(), tid(c), opts.assetId, opts.iid, p.key, 'Foto', 'image/jpeg', p.caption, c.get('user').userId, t),
    ),
  ]);
  if (schedules !== asset.schedules) await writeSchedules(c, opts.assetId, schedules, opts.iid);
  await logActivity(c, 'submit', 'inspection', opts.iid, `Prüfung ${opts.code} (${sched.label}) abgeschlossen`);
  if (result === 'critical') {
    await notify(c, { roles: ['owner', 'admin'], type: 'critical_defect', title: `Kritischer Mangel an ${opts.code}`, body: b.defects.find((d) => d.severity === 'critical')?.title ?? '', link: `/druck/protokoll/${opts.iid}` });
  }
  return { result, nextDueAt: nextDue };
}

inspections.put('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  await saveDraft(c, c.req.param('id'), inspectionBody.parse(await c.req.json()));
  return c.json({ ok: true });
});

inspections.post('/inspections/:id/submit', async (c) => {
  requireRole(c, 'inspector');
  const b = inspectionBody.parse(await c.req.json());
  const iid = c.req.param('id');
  const insp = await saveDraft(c, iid, b);
  const r = await finalize(c, {
    iid,
    assetId: insp.assetId,
    propertyId: insp.propertyId,
    category: insp.asset.category,
    schedule: insp.schedule,
    code: insp.asset.code,
    checkpoints: insp.checkpoints,
    body: b,
    inspectedAt: now(),
  });
  return c.json({ ok: true, ...r });
});

/** Offline erfasste Prüfung übernehmen (idempotent über clientId). */
inspections.post('/inspections/offline', async (c) => {
  requireRole(c, 'inspector');
  const body = inspectionBody
    .extend({
      clientId: z.string().min(8).max(64),
      assetId: z.string(),
      schedule: z.string().max(40).default('main'),
      inspectedAt: z.number().int(),
      checkpoints: z.array(z.object({ id: str(40).min(1), label: str(300).min(1), hint: str(300).optional() })).min(1).max(100),
    })
    .parse(await c.req.json());
  checkKeys(c, body);
  const existing = await c.env.DB.prepare('SELECT id FROM inspections WHERE tenant_id = ? AND client_id = ?').bind(tid(c), body.clientId).first<{ id: string }>();
  if (existing) return c.json({ id: existing.id, duplicate: true });
  const n = now();
  if (body.inspectedAt > n + 5 * 60_000 || body.inspectedAt < n - 90 * DAY) throw new HTTPException(400, { message: 'Prüfdatum unplausibel' });
  const a = await loadAsset(c, body.assetId);
  const iid = id();
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, reason, status, schedule, answers, maintenance, checkpoints, client_id, created_at, updated_at)
     VALUES (?,?,?,?,?,'offline','draft',?,'{}','{"items":[],"defects":[]}',?,?,?,?)`,
  )
    .bind(iid, tid(c), a.id, c.get('user').userId, body.kind, body.schedule, JSON.stringify(body.checkpoints), body.clientId, body.inspectedAt, n)
    .run();
  await storeDraft(c, iid, body).run();
  try {
    const r = await finalize(c, {
      iid,
      assetId: a.id,
      propertyId: a.propertyId,
      category: a.category,
      schedule: body.schedule,
      code: a.code,
      checkpoints: body.checkpoints,
      body,
      inspectedAt: body.inspectedAt,
    });
    return c.json({ id: iid, ...r });
  } catch (e) {
    await c.env.DB.prepare('DELETE FROM inspections WHERE id = ?').bind(iid).run();
    throw e;
  }
});

inspections.delete('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const isAdmin = ['admin', 'owner'].includes(u.role);
  // Eigene Entwürfe verwerfen; fremde nur als Admin
  const r = await c.env.DB.prepare("DELETE FROM inspections WHERE id = ? AND tenant_id = ? AND status = 'draft' AND (inspector_id = ? OR ?)")
    .bind(c.req.param('id'), tid(c), u.userId, isAdmin ? 1 : 0)
    .run();
  if (!r.meta.changes) throw new HTTPException(409, { message: 'Nur eigene Entwürfe können verworfen werden' });
  return c.json({ ok: true });
});

/** Löscht Mängel/Fotos einer abgeschlossenen Prüfung (Aufgaben bleiben, Verknüpfung wird gelöst). */
function dropSubmittedArtifacts(c: Ctx, iid: string) {
  return [
    c.env.DB.prepare('UPDATE tasks SET defect_id = NULL WHERE defect_id IN (SELECT id FROM defects WHERE inspection_id = ?)').bind(iid),
    c.env.DB.prepare('DELETE FROM defects WHERE inspection_id = ?').bind(iid),
    c.env.DB.prepare('DELETE FROM attachments WHERE inspection_id = ?').bind(iid),
  ];
}

/** Abgeschlossene Prüfung wieder als Entwurf öffnen. */
inspections.post('/inspections/:id/reopen', async (c) => {
  requireRole(c, 'admin');
  const insp = await loadInspection(c, c.req.param('id'));
  if (insp.status !== 'submitted') throw new HTTPException(409, { message: 'Prüfung ist nicht abgeschlossen' });
  await c.env.DB.batch([
    ...dropSubmittedArtifacts(c, insp.id),
    c.env.DB.prepare("UPDATE inspections SET status='draft', result=NULL, inspected_at=NULL, next_due_at=NULL, archived_at=NULL, signature=NULL, updated_at=? WHERE id=?").bind(
      now(),
      insp.id,
    ),
  ]);
  await recomputeAsset(c, insp.assetId);
  await logActivity(c, 'reopen', 'inspection', insp.id, `Prüfung ${insp.asset.code} wieder geöffnet`);
  return c.json({ ok: true });
});

const idList = z.object({ ids: z.array(z.string().max(40)).min(1).max(500) });

inspections.post('/inspections/batch-delete', async (c) => {
  requireRole(c, 'admin');
  const { ids } = idList.parse(await c.req.json());
  const ph = ids.map(() => '?').join(',');
  const rows = (await c.env.DB.prepare(`SELECT id, asset_id FROM inspections WHERE tenant_id = ? AND id IN (${ph})`).bind(tid(c), ...ids).all<{ id: string; asset_id: string }>())
    .results;
  if (!rows.length) return c.json({ deleted: 0 });
  await c.env.DB.batch(rows.flatMap((r) => [...dropSubmittedArtifacts(c, r.id), c.env.DB.prepare('DELETE FROM inspections WHERE id = ?').bind(r.id)]));
  for (const assetId of new Set(rows.map((r) => r.asset_id))) await recomputeAsset(c, assetId);
  await logActivity(c, 'delete', 'inspection', null, `${rows.length} Prüfungen gelöscht`);
  return c.json({ deleted: rows.length });
});

inspections.post('/inspections/archive', async (c) => {
  requireRole(c, 'admin');
  const b = idList.extend({ archived: z.boolean() }).parse(await c.req.json());
  const ph = b.ids.map(() => '?').join(',');
  const r = await c.env.DB.prepare(`UPDATE inspections SET archived_at = ? WHERE tenant_id = ? AND status = 'submitted' AND id IN (${ph})`)
    .bind(b.archived ? now() : null, tid(c), ...b.ids)
    .run();
  await logActivity(c, b.archived ? 'archive' : 'restore', 'inspection', null, `${r.meta.changes} Prüfungen ${b.archived ? 'archiviert' : 'wiederhergestellt'}`);
  return c.json({ changed: r.meta.changes });
});

/** Alles, was für die Offline-Prüfung eines Gebäudes nötig ist. */
inspections.get('/offline/buildings/:id', async (c) => {
  const b = await c.env.DB.prepare(
    `SELECT b.id, b.name, p.id AS propertyId, p.name AS propertyName FROM buildings b JOIN properties p ON p.id = b.property_id
      WHERE b.id = ? AND b.tenant_id = ? AND b.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'), tid(c))
    .first();
  if (!b) notFound('Gebäude');
  const assets = await assetQuery(c, 'a.building_id = ?2').bind(tid(c), b.id).all();
  return c.json({ building: b, assets: assets.results.map(mapAsset), categories: await listCategories(c), preparedAt: now() });
});

// ---------- Anhänge an Elementen ----------
inspections.post('/assets/:id/attachments', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({ key: z.string().max(200), name: str(200).default(''), contentType: z.string().max(80), size: z.number().int().min(0).default(0), caption: str(300).default('') })
    .parse(await c.req.json());
  if (!isTenantKey(c, b.key)) throw new HTTPException(400, { message: 'Ungültige Datei' });
  const a = await loadAsset(c, c.req.param('id'));
  const aid = id();
  await c.env.DB.prepare(
    'INSERT INTO attachments (id, tenant_id, asset_id, file_key, name, content_type, size, caption, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(aid, tid(c), a.id, b.key, b.name, b.contentType, b.size, b.caption, c.get('user').userId, now())
    .run();
  return c.json({ id: aid });
});

inspections.delete('/attachments/:id', async (c) => {
  requireRole(c, 'inspector');
  const row = await c.env.DB.prepare('SELECT file_key, inspection_id FROM attachments WHERE id = ? AND tenant_id = ?')
    .bind(c.req.param('id'), tid(c))
    .first<{ file_key: string; inspection_id: string | null }>();
  if (!row) notFound('Anhang');
  // Fotos aus abgeschlossenen Prüfungen sind Nachweise – nur Admins dürfen sie entfernen
  if (row.inspection_id) requireRole(c, 'admin');
  await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(c.req.param('id')).run();
  const still = await c.env.DB.prepare('SELECT 1 FROM attachments WHERE file_key = ?').bind(row.file_key).first();
  if (!still) await c.env.FILES.delete(row.file_key);
  return c.json({ ok: true });
});
