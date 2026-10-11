import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Category, type Checkpoint, type CustomKind, INSPECTION_KINDS, type InspectionPurpose, kindLabel } from '../shared/catalog';
import { type Answer, addMonths, applyInspection, computeResult, DAY, finalResult, isComplete, type Result, type Schedules, summarizeSchedules } from '../shared/logic';
import { getCategoryDef, getSchedule, listCategories } from './categories';
import { assetQuery, mapAsset, severityEnum, str, tid } from './data';
import { type AppEnv, assertInScope, type Ctx, id, logActivity, notFound, now, parseJson, requireRole, scopeSql } from './lib';
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
  /** veraltet: einzelne Art; neu ist `kinds` */
  kind: z.string().max(40).optional(),
  kinds: z.array(z.string().max(40)).max(10).optional(),
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

/** Eigene Prüfungsarten des Workspaces. */
export async function tenantKinds(c: Ctx): Promise<CustomKind[]> {
  const raw = await c.env.DB.prepare('SELECT inspection_kinds FROM tenants WHERE id = ?').bind(tid(c)).first<string>('inspection_kinds');
  return parseJson<CustomKind[]>(raw, []);
}

/** Arten der Prüfung aus dem Body (alt: `kind`, neu: `kinds`), gegen eingebaute und eigene Arten geprüft. */
async function kindsOf(c: Ctx, b: InspectionBody): Promise<string[]> {
  const list = [...new Set(b.kinds ?? (b.kind ? [b.kind] : []))];
  if (list.some((k) => !(k in INSPECTION_KINDS))) {
    const custom = await tenantKinds(c);
    const bad = list.find((k) => !(k in INSPECTION_KINDS) && !custom.some((x) => x.key === k));
    if (bad) throw new HTTPException(400, { message: `Unbekannte Art der Prüfung: ${bad}` });
  }
  return list;
}

const isTenantKey = (c: Ctx, key: string) => key.startsWith(`${tid(c)}/`);

inspections.get('/inspections', async (c) => {
  const q = c.req.query();
  const args: unknown[] = [tid(c)];
  const where: string[] =
    q.superseded === '1' ? ['i.superseded_at IS NOT NULL'] : [q.archived === '1' ? 'i.archived_at IS NOT NULL' : 'i.archived_at IS NULL', 'i.superseded_at IS NULL'];
  if (q.status === 'draft' || q.status === 'submitted') {
    args.push(q.status);
    where.push(`i.status = ?${args.length}`);
  }
  // Filter für Liste und Berichtsgenerator
  const eq: [string, string | undefined][] = [
    ['p.id', q.propertyId],
    ['b.id', q.buildingId],
    ['a.category', q.category],
    ['i.result', q.result],
    ['i.inspector_id', q.inspectorId],
    ['i.purpose', q.purpose],
    ['i.schedule', q.schedule],
  ];
  for (const [col, v] of eq) {
    if (!v) continue;
    args.push(v);
    where.push(`${col} = ?${args.length}`);
  }
  for (const [col, v, op] of [
    ['COALESCE(i.inspected_at, i.created_at)', q.from, '>='],
    ['COALESCE(i.inspected_at, i.created_at)', q.to, '<='],
  ] as const) {
    if (!v || !/^\d{1,15}$/.test(v)) continue;
    args.push(Number(v));
    where.push(`${col} ${op} ?${args.length}`);
  }
  if (q.kind) {
    args.push(q.kind);
    where.push(`EXISTS (SELECT 1 FROM json_each(i.kinds) k WHERE k.value = ?${args.length})`);
  }
  if (q.q) {
    args.push(`%${q.q.toLowerCase()}%`);
    const n = args.length;
    where.push(`(lower(a.code) LIKE ?${n} OR lower(a.location) LIKE ?${n} OR lower(b.name) LIKE ?${n} OR lower(p.name) LIKE ?${n} OR lower(COALESCE(a.label_code, '')) LIKE ?${n})`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.kind, i.kinds, i.purpose, i.schedule, i.status, i.result, i.inspected_at AS inspectedAt, i.created_at AS createdAt, i.next_due_at AS nextDueAt,
            i.archived_at AS archivedAt, i.superseded_at AS supersededAt, i.superseded_by AS supersededBy, i.supersedes_id AS supersedesId, a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            u.name AS inspector, i.inspector_id AS inspectorId, b.id AS buildingId
       FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id
       JOIN properties p ON p.id = b.property_id JOIN users u ON u.id = i.inspector_id
      WHERE i.tenant_id = ?1 AND ${scopeSql(c, 'a.building_id', 'building')} AND ${where.join(' AND ')} ORDER BY COALESCE(i.inspected_at, i.created_at) DESC LIMIT 1000`,
  )
    .bind(...args)
    .all();
  return c.json(rows.results.map((r) => ({ ...r, kinds: parseJson<string[]>(r.kinds as string, []) })));
});

async function loadAsset(c: Ctx, assetId: string) {
  const a = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.schedules, b.property_id AS propertyId FROM assets a JOIN buildings b ON b.id = a.building_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL AND ${scopeSql(c, 'a.building_id', 'building')}`,
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

/**
 * Termine von Elementen vollständig aus der Prüfhistorie neu berechnen (nach Wiedereröffnen/Löschen).
 * Feste Zahl an Queries, egal wie viele Elemente (D1: höchstens 100 Parameter und 50/1000 Queries je Aufruf).
 */
export async function recomputeAssets(c: Ctx, assetIds: string[]) {
  if (!assetIds.length) return;
  const ids = JSON.stringify(assetIds);
  const [assets, history] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, schedules FROM assets WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))').bind(tid(c), ids),
    c.env.DB.prepare(
      "SELECT asset_id, id, schedule, result, inspected_at, next_due_at FROM inspections WHERE tenant_id = ? AND status = 'submitted' AND superseded_at IS NULL AND asset_id IN (SELECT value FROM json_each(?)) ORDER BY inspected_at",
    ).bind(tid(c), ids),
  ]);
  const rows = history.results as { asset_id: string; id: string; schedule: string; result: Result; inspected_at: number; next_due_at: number | null }[];
  const updates = (assets.results as { id: string; schedules: string }[]).map((a) => {
    const own = rows.filter((r) => r.asset_id === a.id);
    let s: Schedules = {};
    for (const [k, v] of Object.entries(parseJson<Schedules>(a.schedules, {}))) {
      const inspected = own.some((r) => r.schedule === k);
      // Manuell gesetzte Ersttermine optionaler Prüfarten bleiben erhalten
      s[k] = v.baseline
        ? { enabled: true, baseline: v.baseline, lastAt: v.baseline.lastAt, nextDueAt: v.baseline.nextDueAt }
        : { enabled: v.enabled || k === 'main', nextDueAt: !inspected && k !== 'main' ? (v.nextDueAt ?? null) : null };
    }
    for (const r of own) s = applyInspection(s, r.schedule, r.inspected_at, r.result, r.next_due_at);
    const sum = summarizeSchedules(s);
    return { id: a.id, s, n: sum.nextDueAt, l: sum.lastAt, r: sum.lastResult, i: own.at(-1)?.id ?? null };
  });
  await c.env.DB.prepare(
    `UPDATE assets SET schedules = json_extract(u.value, '$.s'), next_due_at = json_extract(u.value, '$.n'), last_inspected_at = json_extract(u.value, '$.l'),
            last_result = json_extract(u.value, '$.r'), last_inspection_id = json_extract(u.value, '$.i'), updated_at = ?
       FROM json_each(?) u WHERE assets.id = json_extract(u.value, '$.id') AND assets.tenant_id = ?`,
  )
    .bind(now(), JSON.stringify(updates), tid(c))
    .run();
}

inspections.post('/assets/:id/inspections', async (c) => {
  requireRole(c, 'inspector');
  const a = await loadAsset(c, c.req.param('id'));
  const body = z
    .object({ schedule: z.string().max(40).optional(), purpose: z.enum(['regular', 'follow_up']).default('regular'), followUpOf: z.string().max(40).optional() })
    .parse(await c.req.json().catch(() => ({})));
  // Nachprüfung: bezieht sich auf eine gültige, abgeschlossene Prüfung desselben Elements
  const origin =
    body.purpose === 'follow_up'
      ? await c.env.DB.prepare(
          "SELECT id, schedule, checkpoints, answers FROM inspections WHERE id = ? AND asset_id = ? AND tenant_id = ? AND status = 'submitted' AND superseded_at IS NULL",
        )
          .bind(body.followUpOf ?? '', a.id, tid(c))
          .first<{ id: string; schedule: string; checkpoints: string; answers: string }>()
      : null;
  if (body.purpose === 'follow_up' && !origin) throw new HTTPException(400, { message: 'Ausgangsprüfung für die Nachprüfung nicht gefunden' });
  const schedule = origin?.schedule ?? body.schedule ?? summarizeSchedules(a.schedules).nextKey ?? 'main';
  const existing = await c.env.DB.prepare(
    "SELECT id FROM inspections WHERE asset_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ? AND schedule = ? AND purpose = ? AND COALESCE(follow_up_of, '') = ?",
  )
    .bind(a.id, tid(c), c.get('user').userId, schedule, body.purpose, origin?.id ?? '')
    .first<{ id: string }>();
  if (existing) return c.json(existing);
  let checkpoints = (await getSchedule(c, a.category, schedule)).checkpoints;
  if (origin) {
    // Nachprüfung: nur die Prüfpunkte, die bei der Ausgangsprüfung einen Mangel hatten
    const answers = parseJson<Record<string, Answer>>(origin.answers, {});
    const failed = parseJson<Checkpoint[]>(origin.checkpoints, []).filter((p) => answers[p.id] === 'defect');
    if (failed.length) checkpoints = failed;
  }
  const iid = id();
  const t = now();
  const last = await c.env.DB.prepare("SELECT 1 FROM inspections WHERE asset_id = ? AND status = 'submitted' LIMIT 1").bind(a.id).first();
  const kind = origin ? 'after_repair' : last ? 'periodic' : 'initial';
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, kinds, purpose, follow_up_of, reason, status, schedule, answers, maintenance, checkpoints, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?,'{}','{"items":[],"defects":[]}',?,?,?)`,
  )
    .bind(iid, tid(c), a.id, c.get('user').userId, kind, JSON.stringify([kind]), body.purpose, origin?.id ?? null, 'planned', schedule, JSON.stringify(checkpoints), t, t)
    .run();
  return c.json({ id: iid });
});

export async function loadInspection(c: Ctx, iid: string) {
  const row = await c.env.DB.prepare(
    `SELECT i.*, u.name AS inspectorName, a.code, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes,
            b.name AS buildingName, b.address AS buildingAddress, p.id AS propertyId, p.name AS propertyName, p.address AS propertyAddress,
            p.pdf_pattern AS propertyPdfPattern, t.name AS tenantName, t.inspection_kinds AS customKinds,
            o.inspected_at AS supersedesDate, n.inspected_at AS supersededByDate, f.inspected_at AS followUpDate
       FROM inspections i JOIN users u ON u.id = i.inspector_id JOIN assets a ON a.id = i.asset_id
       JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id JOIN tenants t ON t.id = i.tenant_id
       LEFT JOIN inspections o ON o.id = i.supersedes_id AND o.tenant_id = i.tenant_id
       LEFT JOIN inspections n ON n.id = i.superseded_by AND n.tenant_id = i.tenant_id
       LEFT JOIN inspections f ON f.id = i.follow_up_of AND f.tenant_id = i.tenant_id
      WHERE i.id = ? AND i.tenant_id = ? AND ${scopeSql(c, 'a.building_id', 'building')}`,
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
  const kinds = parseJson<string[]>(row.kinds as string, []);
  const custom = parseJson<CustomKind[]>(row.customKinds as string, []);
  return {
    id: row.id as string,
    assetId: row.asset_id as string,
    propertyId: row.propertyId as string,
    status: row.status as 'draft' | 'submitted',
    kind: row.kind as string,
    kinds: kinds.length ? kinds : [row.kind as string],
    kindLabels: (kinds.length ? kinds : [row.kind as string]).map((k) => kindLabel(k, custom)),
    purpose: row.purpose as InspectionPurpose,
    supersedesId: row.supersedes_id as string | null,
    supersedesDate: row.supersedesDate as number | null,
    supersededBy: row.superseded_by as string | null,
    supersededAt: row.superseded_at as number | null,
    supersededByDate: row.supersededByDate as number | null,
    followUpOf: row.follow_up_of as string | null,
    followUpDate: row.followUpDate as number | null,
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

function storeDraft(c: Ctx, iid: string, b: InspectionBody, kinds: string[]) {
  return c.env.DB.prepare('UPDATE inspections SET kind=COALESCE(?, kind), kinds=?, answers=?, maintenance=?, notes=?, signature=?, signer_name=?, updated_at=? WHERE id=?').bind(
    kinds[0] ?? null,
    JSON.stringify(kinds),
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
  const kinds = await kindsOf(c, b);
  const insp = await loadInspection(c, iid);
  if (insp.status !== 'draft') throw new HTTPException(409, { message: 'Prüfung ist bereits abgeschlossen' });
  if (insp.inspectorId !== c.get('user').userId && !['admin', 'owner'].includes(c.get('user').role)) {
    throw new HTTPException(403, { message: 'Nur der Prüfer kann diesen Entwurf bearbeiten' });
  }
  await storeDraft(c, iid, b, kinds).run();
  return { ...insp, kinds };
}

/** Validiert, berechnet Ergebnis + Termin und schreibt Prüfung, Element, Mängel und Fotos. */
async function finalize(
  c: Ctx,
  opts: {
    iid: string;
    assetId: string;
    propertyId: string;
    category: Category;
    schedule: string;
    code: string;
    checkpoints: Checkpoint[];
    body: InspectionBody;
    kinds: string[];
    inspectedAt: number;
    /** Berichtigung: diese Prüfung wird ersetzt */
    supersedesId?: string | null;
    /** Nachprüfung: Mängel dieser Prüfung werden bei „i. O.“ als behoben markiert; der Prüfturnus bleibt */
    followUpOf?: string | null;
  },
) {
  const b = opts.body;
  if (!opts.kinds.length) throw new HTTPException(400, { message: 'Bitte mindestens eine Art der Prüfung auswählen' });
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
  const nextDue = result === 'not_inspectable' || opts.followUpOf ? null : addMonths(t, sched.intervalMonths);
  const asset = await loadAsset(c, opts.assetId);
  const schedules = applyInspection(asset.schedules, opts.schedule, t, result, nextDue);
  // Erst den Abschluss beanspruchen (nur aus dem Entwurf): ein gleichzeitiger zweiter Abschluss bekommt 409 und schreibt nichts
  const claim = await c.env.DB.prepare("UPDATE inspections SET status='submitted', result=?, inspected_at=?, next_due_at=?, updated_at=? WHERE id=? AND status='draft'")
    .bind(result, t, nextDue, now(), opts.iid)
    .run();
  if (!claim.meta.changes) throw new HTTPException(409, { message: 'Prüfung ist bereits abgeschlossen' });
  const rollback = () =>
    c.env.DB.prepare("UPDATE inspections SET status='draft', result=NULL, inspected_at=NULL, next_due_at=NULL WHERE id=?").bind(opts.iid).run();
  if (opts.supersedesId) {
    // Ursprüngliche Prüfung als berichtigt markieren – nur einmal möglich
    const sup = await c.env.DB.prepare('UPDATE inspections SET superseded_at = ?, superseded_by = ? WHERE id = ? AND tenant_id = ? AND superseded_at IS NULL')
      .bind(now(), opts.iid, opts.supersedesId, tid(c))
      .run();
    if (!sup.meta.changes) {
      await rollback();
      throw new HTTPException(409, { message: 'Diese Prüfung wurde bereits berichtigt' });
    }
  }
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  const extra: D1PreparedStatement[] = [];
  if (opts.supersedesId) {
    // Mängel der ersetzten Prüfung: Status übernehmen, Aufgaben umhängen, alte Einträge entfernen
    const same = "COALESCE(o.checkpoint_id, '') = COALESCE(n.checkpoint_id, '') AND o.title = n.title";
    extra.push(
      c.env.DB.prepare(
        `UPDATE defects AS n SET status = 'resolved', resolved_at = o.resolved_at, resolved_by = o.resolved_by
           FROM defects o WHERE n.inspection_id = ?1 AND o.inspection_id = ?2 AND o.status = 'resolved' AND ${same}`,
      ).bind(opts.iid, opts.supersedesId),
      c.env.DB.prepare(
        `UPDATE tasks SET defect_id = (SELECT n.id FROM defects n JOIN defects o ON o.id = tasks.defect_id WHERE n.inspection_id = ?1 AND ${same} LIMIT 1)
          WHERE defect_id IN (SELECT id FROM defects WHERE inspection_id = ?2)`,
      ).bind(opts.iid, opts.supersedesId),
      c.env.DB.prepare('DELETE FROM defects WHERE inspection_id = ?').bind(opts.supersedesId),
      c.env.DB.prepare('DELETE FROM attachments WHERE inspection_id = ?').bind(opts.supersedesId),
    );
  }
  if (opts.followUpOf) {
    // Nachprüfung: Mängel an Prüfpunkten, die jetzt i. O. sind, gelten als behoben
    const okIds = Object.entries(b.answers).filter(([, a]) => a === 'ok').map(([k]) => k);
    extra.push(
      c.env.DB.prepare(
        `UPDATE defects SET status = 'resolved', resolved_at = ?1, resolved_by = ?2
          WHERE inspection_id = ?3 AND tenant_id = ?4 AND status = 'open' AND checkpoint_id IN (SELECT value FROM json_each(?5))`,
      ).bind(t, c.get('user').userId, opts.followUpOf, tid(c), JSON.stringify(okIds)),
    );
  }
  try {
    // Mängel und Fotos mengenbasiert: feste Zahl an Statements
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, property_id, asset_id, inspection_id, checkpoint_id, title, note, measure, severity, status, photo_key, created_at)
         SELECT lower(hex(randomblob(8))), ?1, ?2, ?3, ?4, ${j('checkpointId')}, ${j('title')}, ${j('note')}, ${j('measure')}, ${j('severity')}, 'open', ${j('photoKey')}, ?5 FROM json_each(?6)`,
      ).bind(tid(c), opts.propertyId, opts.assetId, opts.iid, t, JSON.stringify(b.defects)),
      c.env.DB.prepare(
        `INSERT INTO attachments (id, tenant_id, asset_id, inspection_id, file_key, name, content_type, caption, created_by, created_at)
         SELECT lower(hex(randomblob(8))), ?1, ?2, ?3, ${j('key')}, 'Foto', 'image/jpeg', ${j('caption')}, ?4, ?5 FROM json_each(?6)`,
      ).bind(tid(c), opts.assetId, opts.iid, c.get('user').userId, t, JSON.stringify(b.photos)),
      ...extra,
    ]);
  } catch (e) {
    await rollback();
    if (opts.supersedesId) {
      await c.env.DB.prepare('UPDATE inspections SET superseded_at = NULL, superseded_by = NULL WHERE id = ? AND superseded_by = ?').bind(opts.supersedesId, opts.iid).run();
    }
    throw e;
  }
  if (opts.supersedesId) {
    // Historie hat sich geändert: Termine aus allen gültigen Prüfungen neu berechnen
    await recomputeAssets(c, [opts.assetId]);
    await logActivity(c, 'correct', 'inspection', opts.iid, `Prüfung ${opts.code} (${sched.label}) berichtigt`);
  } else {
    if (schedules !== asset.schedules) await writeSchedules(c, opts.assetId, schedules, opts.iid);
    await logActivity(c, 'submit', 'inspection', opts.iid, `${opts.followUpOf ? 'Nachprüfung' : 'Prüfung'} ${opts.code} (${sched.label}) abgeschlossen`);
  }
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
  // Berichtigung behält das Prüfdatum der ersetzten Prüfung
  const inspectedAt = insp.purpose === 'correction' && insp.supersedesDate ? insp.supersedesDate : now();
  const r = await finalize(c, {
    iid,
    assetId: insp.assetId,
    propertyId: insp.propertyId,
    category: insp.asset.category,
    schedule: insp.schedule,
    code: insp.asset.code,
    checkpoints: insp.checkpoints,
    body: b,
    kinds: insp.kinds,
    inspectedAt,
    supersedesId: insp.purpose === 'correction' ? insp.supersedesId : null,
    followUpOf: insp.followUpOf,
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
  const kinds = await kindsOf(c, body);
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
    .bind(iid, tid(c), a.id, c.get('user').userId, kinds[0] ?? 'periodic', body.schedule, JSON.stringify(body.checkpoints), body.clientId, body.inspectedAt, n)
    .run();
  await storeDraft(c, iid, body, kinds).run();
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
      kinds,
      inspectedAt: body.inspectedAt,
    });
    return c.json({ id: iid, ...r });
  } catch (e) {
    // vollständig zurückrollen, damit ein erneuter Versuch mit derselben clientId sauber startet
    await c.env.DB.batch([...dropSubmittedArtifacts(c, iid), c.env.DB.prepare('DELETE FROM inspections WHERE id = ?').bind(iid)]);
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
/** Mängel/Fotos abgeschlossener Prüfungen löschen; `ids` als JSON-Liste (ein Parameter, beliebig viele Prüfungen). */
function dropSubmittedArtifacts(c: Ctx, iid: string | string[]) {
  const ids = JSON.stringify(Array.isArray(iid) ? iid : [iid]);
  const inList = 'inspection_id IN (SELECT value FROM json_each(?))';
  return [
    c.env.DB.prepare(`UPDATE tasks SET defect_id = NULL WHERE defect_id IN (SELECT id FROM defects WHERE ${inList})`).bind(ids),
    c.env.DB.prepare(`DELETE FROM defects WHERE ${inList}`).bind(ids),
    c.env.DB.prepare(`DELETE FROM attachments WHERE ${inList}`).bind(ids),
  ];
}

/** Abgeschlossene Prüfung wieder als Entwurf öffnen. */
inspections.post('/inspections/:id/reopen', async (c) => {
  requireRole(c, 'admin');
  const insp = await loadInspection(c, c.req.param('id'));
  if (insp.status !== 'submitted') throw new HTTPException(409, { message: 'Prüfung ist nicht abgeschlossen' });
  if (insp.supersededAt) throw new HTTPException(409, { message: 'Eine berichtigte Prüfung kann nicht wieder geöffnet werden' });
  await c.env.DB.batch([
    ...dropSubmittedArtifacts(c, insp.id),
    c.env.DB.prepare("UPDATE inspections SET status='draft', result=NULL, inspected_at=NULL, next_due_at=NULL, archived_at=NULL, signature=NULL, updated_at=? WHERE id=?").bind(
      now(),
      insp.id,
    ),
  ]);
  await recomputeAssets(c, [insp.assetId]);
  await logActivity(c, 'reopen', 'inspection', insp.id, `Prüfung ${insp.asset.code} wieder geöffnet`);
  return c.json({ ok: true });
});

/**
 * Abgeschlossene Prüfung berichtigen: legt einen Entwurf mit allen Angaben an. Beim Abschluss
 * ersetzt er die ursprüngliche Prüfung; diese bleibt unverändert als Nachweis erhalten.
 */
inspections.post('/inspections/:id/correct', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const old = await c.env.DB.prepare(
    `SELECT i.* FROM inspections i JOIN assets a ON a.id = i.asset_id WHERE i.id = ? AND i.tenant_id = ? AND ${scopeSql(c, 'a.building_id', 'building')}`,
  )
    .bind(c.req.param('id'), tid(c))
    .first<Record<string, unknown>>();
  if (!old) notFound('Prüfung');
  if (old.status !== 'submitted') throw new HTTPException(409, { message: 'Nur abgeschlossene Prüfungen können berichtigt werden' });
  if (old.superseded_at) throw new HTTPException(409, { message: 'Diese Prüfung wurde bereits berichtigt' });
  if (old.inspector_id !== u.userId && !['admin', 'owner'].includes(u.role)) {
    throw new HTTPException(403, { message: 'Nur die prüfende Person oder ein Admin kann berichtigen' });
  }
  const open = await c.env.DB.prepare("SELECT id FROM inspections WHERE supersedes_id = ? AND tenant_id = ? AND status = 'draft'")
    .bind(old.id, tid(c))
    .first<{ id: string }>();
  if (open) return c.json(open);
  const iid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, kinds, purpose, supersedes_id, follow_up_of, reason, status, schedule,
                              answers, maintenance, checkpoints, notes, signer_name, created_at, updated_at)
     SELECT ?1, tenant_id, asset_id, ?2, kind, kinds, 'correction', id, follow_up_of, 'correction', 'draft', schedule,
            answers, maintenance, checkpoints, notes, '', ?3, ?3 FROM inspections WHERE id = ?4`,
  )
    .bind(iid, u.userId, t, old.id)
    .run();
  return c.json({ id: iid });
});

const idList = z.object({ ids: z.array(z.string().max(40)).min(1).max(500) });

inspections.post('/inspections/batch-delete', async (c) => {
  requireRole(c, 'admin');
  const { ids } = idList.parse(await c.req.json());
  const rows = (
    await c.env.DB.prepare('SELECT id, asset_id FROM inspections WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(tid(c), JSON.stringify(ids))
      .all<{ id: string; asset_id: string }>()
  ).results;
  if (!rows.length) return c.json({ deleted: 0 });
  const found = rows.map((r) => r.id);
  await c.env.DB.batch([
    ...dropSubmittedArtifacts(c, found),
    // Gelöschte Berichtigung: die ersetzte Prüfung gilt wieder
    c.env.DB.prepare('UPDATE inspections SET superseded_at = NULL, superseded_by = NULL WHERE tenant_id = ? AND superseded_by IN (SELECT value FROM json_each(?))').bind(
      tid(c),
      JSON.stringify(found),
    ),
    c.env.DB.prepare('DELETE FROM inspections WHERE tenant_id = ? AND id IN (SELECT value FROM json_each(?))').bind(tid(c), JSON.stringify(found)),
  ]);
  await recomputeAssets(c, [...new Set(rows.map((r) => r.asset_id))]);
  await logActivity(c, 'delete', 'inspection', null, `${rows.length} Prüfungen gelöscht`);
  return c.json({ deleted: rows.length });
});

inspections.post('/inspections/archive', async (c) => {
  requireRole(c, 'admin');
  const b = idList.extend({ archived: z.boolean() }).parse(await c.req.json());
  const r = await c.env.DB.prepare(`UPDATE inspections SET archived_at = ? WHERE tenant_id = ? AND status = 'submitted' AND id IN (SELECT value FROM json_each(?))`)
    .bind(b.archived ? now() : null, tid(c), JSON.stringify(b.ids))
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
  assertInScope(c, 'building', b.id as string);
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
  const a = await loadAsset(c, c.req.param('id')); // prüft auch den Zugriffsbereich
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
  const row = await c.env.DB.prepare(
    `SELECT file_key, inspection_id FROM attachments WHERE id = ? AND tenant_id = ? AND asset_id IN (SELECT id FROM assets WHERE ${scopeSql(c, 'building_id', 'building')})`,
  )
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
