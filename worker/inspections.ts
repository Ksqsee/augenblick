import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type KnownDefect, linkKnownDefects } from '../shared/carry';
import { type Category, type Checkpoint, type CustomKind, INSPECTION_KINDS, type InspectionPurpose, kindLabel } from '../shared/catalog';
import { type Answer, addMonths, applyInspection, computeResult, DAY, finalResult, isComplete, type Result, type Schedules, summarizeSchedules } from '../shared/logic';
import { describeProposal, effectiveInterval, type IntervalProposal, proposeInterval } from '../shared/intervals';
import { getCategoryDef, getSchedule, listCategories } from './categories';
import { assetQuery, mapAsset, severityEnum, str, tid } from './data';
import { type AppEnv, assertInScope, type Ctx, id, logActivity, notFound, now, parseJson, RANK, requireRole, requireStructure, scopeSql } from './lib';
import { adaptMode, intervalHistory, logIntervalChange, writeSchedules } from './intervals';
import { notify } from './notify';
import { notifyCriticalReady } from './pending';
import { afterTasksDone, afterVerification, autoDefectTasks, closeFinishedRounds } from './automation';
import { mergeRawNotes, RAW_NOTE_TEXT_MAX, RAW_NOTES_MAX, type RawNote } from '../shared/announce';
import { conditionOf } from '../shared/applies';
import { readCatalog } from './catalog';

export const inspections = new Hono<AppEnv>();

const answerEnum = z.enum(['ok', 'defect', 'na']);
const defectInput = z.object({
  checkpointId: z.string().max(40).optional(),
  title: str(300).min(1, 'Mangel ohne Beschreibung'),
  note: str(2000).default(''),
  measure: str(1000).default(''),
  severity: severityEnum,
  photoKey: z.string().max(200).optional(),
  /** bekannter, weiterhin vorhandener Mangel (wird verknüpft statt neu angelegt) */
  knownId: z.string().max(40).optional(),
  since: z.number().int().optional(),
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
  /** bekannte Mängel, die bei dieser Prüfung als behoben gemeldet wurden */
  resolvedDefects: z.array(z.string().max(40)).max(100).default([]),
});
type InspectionBody = z.infer<typeof inspectionBody>;

/** Rohnotiz aus App, Offline-Warteschlange oder Claude (Plan v7 W). „ausgewertet“ setzt nur PATCH …/raw-notes. */
const rawNoteInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/, 'Ungültige Notiz-ID'),
  text: str(RAW_NOTE_TEXT_MAX).min(1, 'Notiz ohne Text'),
  at: z.number().int().min(0),
  source: z.enum(['app', 'offline', 'mcp']).default('app'),
  kind: z.enum(['announce', 'finding', 'type']).optional(),
  summary: str(300).optional(),
  critical: z.boolean().optional(),
});
type RawNoteInput = z.infer<typeof rawNoteInput>;

/**
 * Eingehende Rohnotizen bereinigen: nie schon „ausgewertet“, Zeit nicht in der Zukunft, Quelle passend zum Zugang
 * (API-Schlüssel/OAuth = Claude bzw. Fremdsystem → „mcp“; Browser-Sitzung → „app“ oder „offline“).
 */
function cleanRawNotes(c: Ctx, notes: RawNoteInput[]): RawNote[] {
  const viaKey = !!c.get('user').apiKeyId;
  const t = now();
  return notes.map((n) => ({
    id: n.id,
    text: n.text,
    at: Math.min(n.at, t),
    source: viaKey ? 'mcp' : n.source === 'mcp' ? 'app' : n.source,
    ...(n.kind ? { kind: n.kind } : {}),
    ...(n.summary ? { summary: n.summary } : {}),
    ...(n.critical ? { critical: true } : {}),
    evaluated: false,
  }));
}

/** Rohnotizen anhängen – Vergleich und Tausch in einer Anweisung, damit gleichzeitige Einträge nicht verloren gehen. */
async function appendRawNotes(c: Ctx, iid: string, add: RawNote[]): Promise<RawNote[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await c.env.DB.prepare('SELECT raw_notes FROM inspections WHERE id = ? AND tenant_id = ?').bind(iid, tid(c)).first<string>('raw_notes');
    if (cur == null) notFound('Prüfung');
    const next = mergeRawNotes(parseJson<RawNote[]>(cur, []), add);
    const r = await c.env.DB.prepare('UPDATE inspections SET raw_notes = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND raw_notes = ?')
      .bind(JSON.stringify(next), now(), iid, tid(c), cur)
      .run();
    if (r.meta.changes) return next;
  }
  throw new HTTPException(409, { message: 'Notiz konnte nicht gespeichert werden – bitte erneut versuchen' });
}

/** SQL: Zahl der nicht ausgewerteten Rohnotizen einer Prüfung (Alias i). */
const RAW_PENDING_SQL = "(SELECT COUNT(*) FROM json_each(i.raw_notes) j WHERE COALESCE(json_extract(j.value, '$.evaluated'), 0) = 0)";

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
  // Bereit zur Unterschrift: nur eigene Entwürfe (unterschreiben kann nur die prüfende Person)
  if (q.status === 'ready') {
    args.push(c.get('user').userId);
    where.push("i.status = 'draft'", 'i.ready_at IS NOT NULL', `i.inspector_id = ?${args.length}`);
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
            i.archived_at AS archivedAt, i.ready_at AS readyAt, i.superseded_at AS supersededAt, i.superseded_by AS supersededBy, i.supersedes_id AS supersedesId, a.id AS assetId, a.code, a.category, a.location, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName,
            u.name AS inspector, i.inspector_id AS inspectorId, b.id AS buildingId, ${RAW_PENDING_SQL} AS rawPending
       FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id
       JOIN properties p ON p.id = b.property_id JOIN users u ON u.id = i.inspector_id
      WHERE i.tenant_id = ?1 AND ${scopeSql(c, 'a.building_id', 'building')} AND ${where.join(' AND ')} ORDER BY COALESCE(i.inspected_at, i.created_at) DESC LIMIT 1000`,
  )
    .bind(...args)
    .all();
  return c.json(rows.results.map((r) => ({ ...r, kinds: parseJson<string[]>(r.kinds as string, []) })));
});

export async function loadAsset(c: Ctx, assetId: string) {
  const a = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.category, a.schedules, b.id AS buildingId, b.property_id AS propertyId FROM assets a JOIN buildings b ON b.id = a.building_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL AND ${scopeSql(c, 'a.building_id', 'building')}`,
  )
    .bind(assetId, tid(c))
    .first<{ id: string; code: string; category: Category; schedules: string; buildingId: string; propertyId: string }>();
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
    const stored = parseJson<Schedules>(a.schedules, {});
    for (const [k, v] of Object.entries(stored)) {
      const inspected = own.some((r) => r.schedule === k);
      // Angepasstes Intervall (shared/intervals.ts) bleibt erhalten
      const interval = v.intervalAt != null ? { intervalMonths: v.intervalMonths ?? null, intervalAt: v.intervalAt } : {};
      // Manuell gesetzte Ersttermine optionaler Prüfarten bleiben erhalten
      s[k] = v.baseline
        ? { enabled: true, baseline: v.baseline, lastAt: v.baseline.lastAt, nextDueAt: v.baseline.nextDueAt, ...interval }
        : { enabled: v.enabled || k === 'main', nextDueAt: !inspected && k !== 'main' ? (v.nextDueAt ?? null) : null, ...interval };
    }
    for (const r of own) s = applyInspection(s, r.schedule, r.inspected_at, r.result, r.next_due_at);
    // Intervall nach der letzten Prüfung geändert: Termin wie beim Ändern ab der letzten Prüfung (siehe applyInterval)
    for (const [k, v] of Object.entries(s)) {
      if (v.intervalAt != null && v.lastAt != null && v.intervalAt > v.lastAt && v.lastResult && v.lastResult !== 'not_inspectable' && v.intervalMonths) {
        s[k] = { ...v, nextDueAt: addMonths(v.lastAt, v.intervalMonths) };
      }
    }
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
  const body: { schedule?: string; purpose: 'regular' | 'follow_up'; followUpOf?: string; taskId?: string; repair?: boolean; general?: boolean; rawNote?: RawNoteInput } = z
    .object({
      schedule: z.string().max(40).optional(),
      purpose: z.enum(['regular', 'follow_up']).default('regular'),
      followUpOf: z.string().max(40).optional(),
      /** aus einer Aufgabe gestartet: Prüfauftrag = Regelprüfung, Mängelbehebung = Nachprüfung der Ausgangsprüfung */
      taskId: z.string().max(40).optional(),
      /** Typ unbekannt (Plan v7 W): allgemeine Checkliste – nur Prüfpunkte ohne Bedingung auf Stammdaten */
      general: z.boolean().optional(),
      /** Ansage bzw. gesprochener Typ gleich als Rohnotiz an die Prüfung */
      rawNote: rawNoteInput.optional(),
    })
    .parse(await c.req.json().catch(() => ({})));
  if (body.taskId && body.purpose === 'regular') {
    const task = await c.env.DB.prepare(
      `SELECT t.kind, t.defect_id AS defectId, d.inspection_id AS inspectionId FROM tasks t LEFT JOIN defects d ON d.id = t.defect_id AND d.tenant_id = t.tenant_id
        WHERE t.id = ? AND t.tenant_id = ? AND t.asset_id = ?`,
    )
      .bind(body.taskId, tid(c), a.id)
      .first<{ kind: string; defectId: string | null; inspectionId: string | null }>();
    // Mängelbehebung und Nachprüf-Auftrag des Autopiloten (Prüfauftrag mit Mangel) starten die Nachprüfung
    if (task?.kind === 'defect' || (task?.kind === 'inspection' && task.defectId)) {
      const from = task.inspectionId
        ? await c.env.DB.prepare("SELECT id FROM inspections WHERE id = ? AND tenant_id = ? AND status = 'submitted' AND superseded_at IS NULL").bind(task.inspectionId, tid(c)).first()
        : null;
      if (from) Object.assign(body, { purpose: 'follow_up', followUpOf: task.inspectionId });
      else body.repair = true;
    }
  }
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
  if (existing) {
    if (body.rawNote) await appendRawNotes(c, existing.id, cleanRawNotes(c, [body.rawNote]));
    return c.json(existing);
  }
  let checkpoints = (await getSchedule(c, a.category, schedule)).checkpoints;
  if (body.general && !origin) {
    const plain = checkpoints.filter((p) => !conditionOf(p, a.category));
    if (plain.length) checkpoints = plain;
  }
  if (origin) {
    // Nachprüfung: nur die Prüfpunkte, die bei der Ausgangsprüfung einen Mangel hatten
    const answers = parseJson<Record<string, Answer>>(origin.answers, {});
    const failed = parseJson<Checkpoint[]>(origin.checkpoints, []).filter((p) => answers[p.id] === 'defect');
    if (failed.length) checkpoints = failed;
  }
  const iid = id();
  const t = now();
  // Vorbelegung der Art: Erstprüfung, solange das Element nie geprüft wurde (auch kein übernommener Termin), sonst wiederkehrend
  const last = await c.env.DB.prepare("SELECT 1 FROM inspections WHERE asset_id = ? AND status = 'submitted' LIMIT 1").bind(a.id).first();
  const kind = origin ? 'after_repair' : body.repair ? 'after_repair' : last || summarizeSchedules(a.schedules).lastAt ? 'periodic' : 'initial';
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, kinds, purpose, follow_up_of, reason, status, schedule, answers, maintenance, checkpoints, created_at, updated_at, raw_notes)
     VALUES (?,?,?,?,?,?,?,?,?,'draft',?,'{}','{"items":[],"defects":[]}',?,?,?,?)`,
  )
    .bind(
      iid,
      tid(c),
      a.id,
      c.get('user').userId,
      kind,
      JSON.stringify([kind]),
      body.purpose,
      origin?.id ?? null,
      'planned',
      schedule,
      JSON.stringify(checkpoints),
      t,
      t,
      JSON.stringify(body.rawNote ? cleanRawNotes(c, [body.rawNote]) : []),
    )
    .run();
  return c.json({ id: iid });
});

/** Offene, sichtbare Mängel eines Elements – ohne die der genannten Prüfungen (eigene, ersetzte). */
async function openDefectsOf(c: Ctx, assetId: string, exclude: (string | null | undefined)[]): Promise<KnownDefect[]> {
  const rows = await c.env.DB.prepare(
    `SELECT id, checkpoint_id AS checkpointId, title, note, measure, severity, created_at AS createdAt FROM defects
      WHERE tenant_id = ? AND asset_id = ? AND status = 'open' AND hidden_at IS NULL
        AND COALESCE(inspection_id, '') NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at LIMIT 100`,
  )
    .bind(tid(c), assetId, JSON.stringify(exclude.filter(Boolean)))
    .all<KnownDefect>();
  return rows.results;
}

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
    resolvedDefects?: string[];
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
  // Behebung der hier festgestellten Mängel (für Protokoll und PDF)
  const resolutions = (
    await c.env.DB.prepare(
      `SELECT d.checkpoint_id AS checkpointId, d.title, d.resolved_at AS resolvedAt, u.name AS resolvedByName, d.resolution_note AS note, d.resolution_photo_key AS photoKey
         FROM defects d LEFT JOIN users u ON u.id = d.resolved_by WHERE d.inspection_id = ? AND d.tenant_id = ? AND d.status = 'resolved'`,
    )
      .bind(iid, tid(c))
      .all<{ checkpointId: string | null; title: string; resolvedAt: number; resolvedByName: string | null; note: string; photoKey: string | null }>()
  ).results;
  // Bekannte Mängel: nur im Entwurf, offene Mängel des Elements aus anderen Prüfungen
  const knownDefects = row.status === 'draft' ? await openDefectsOf(c, row.asset_id as string, [iid, row.supersedes_id as string | null]) : [];
  return {
    resolutions,
    knownDefects,
    resolvedDefects: extra.resolvedDefects ?? [],
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
    /** Entwurf vollständig, wartet auf die Unterschrift */
    readyAt: (row.ready_at as number | null) ?? null,
    /** Rohdiktat (Plan v7 W): gesprochene bzw. getippte Texte, bis Claude sie auswertet */
    rawNotes: parseJson<RawNote[]>(row.raw_notes as string, []),
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

/**
 * Prüfungen mit Rohdiktat (Standard: nur mit nicht ausgewerteten Notizen) – für Claude (MCP `list raw_notes`,
 * `briefing`). Eigene Prüfungen; Admins sehen alle im Zugriffsbereich. Je Prüfung Element, Stammdaten, Rohtexte und
 * die bisherige Zuordnung (Mängel, Antworten).
 */
inspections.get('/inspections/raw-notes', async (c) => {
  requireRole(c, 'inspector');
  const q = c.req.query();
  const admin = RANK[c.get('user').role] >= RANK.admin;
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.status, i.ready_at AS readyAt, i.inspected_at AS inspectedAt, i.created_at AS createdAt, i.raw_notes AS rawNotes, i.answers, i.maintenance,
            i.checkpoints, i.notes, u.name AS inspector, a.id AS assetId, a.code, a.number, a.category, a.location, a.floor, a.manufacturer, a.model, a.attributes,
            b.name AS buildingName, p.id AS propertyId, p.name AS propertyName, ${RAW_PENDING_SQL} AS pending
       FROM inspections i JOIN assets a ON a.id = i.asset_id JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
       JOIN users u ON u.id = i.inspector_id
      WHERE i.tenant_id = ?1 AND ${scopeSql(c, 'a.building_id', 'building')} AND i.superseded_at IS NULL AND i.archived_at IS NULL AND a.deleted_at IS NULL
        AND (?2 OR i.inspector_id = ?3) AND (?4 = '' OR p.id = ?4) AND i.raw_notes != '[]' AND (?5 OR ${RAW_PENDING_SQL} > 0)
      ORDER BY COALESCE(i.inspected_at, i.created_at) DESC LIMIT 200`,
  )
    .bind(tid(c), admin ? 1 : 0, c.get('user').userId, q.propertyId ?? '', q.all === '1' ? 1 : 0)
    .all<Record<string, unknown>>();
  return c.json(
    rows.results.map((r) => {
      const extra = parseJson<{ defects?: { title: string; severity: string; checkpointId?: string; knownId?: string }[] }>(r.maintenance as string, {});
      const { maintenance: _m, answers, checkpoints, rawNotes, attributes, ...rest } = r;
      return {
        ...rest,
        pending: Number(r.pending) || 0,
        rawNotes: parseJson<RawNote[]>(rawNotes as string, []),
        attributes: parseJson<Record<string, unknown>>(attributes as string, {}),
        answers: parseJson<Record<string, Answer>>(answers as string, {}),
        checkpoints: parseJson<Checkpoint[]>(checkpoints as string, []).map((p) => ({ id: p.id, label: p.label })),
        defects: (extra.defects ?? []).map((d) => ({ title: d.title, severity: d.severity, checkpointId: d.checkpointId ?? null, known: !!d.knownId })),
      };
    }),
  );
});

inspections.get('/inspections/:id', async (c) => c.json(await loadInspection(c, c.req.param('id'))));

function storeDraft(c: Ctx, iid: string, b: InspectionBody, kinds: string[]) {
  return c.env.DB.prepare('UPDATE inspections SET kind=COALESCE(?, kind), kinds=?, answers=?, maintenance=?, notes=?, signature=?, signer_name=?, updated_at=? WHERE id=?').bind(
    kinds[0] ?? null,
    JSON.stringify(kinds),
    JSON.stringify(b.answers),
    JSON.stringify({ items: b.maintenance, defects: b.defects, notInspectable: b.notInspectable, photos: b.photos, resultOverride: b.resultOverride, resultReason: b.resultReason, resolvedDefects: b.resolvedDefects }),
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
  const asset = await loadAsset(c, opts.assetId);
  const state = asset.schedules[opts.schedule];
  let interval = effectiveInterval(sched.intervalMonths, state);
  // Selbstanpassende Intervalle, Stufe „Automatisch“: nur reguläre, aktuelle Prüfungen (keine Nachprüfung/Berichtigung/Nachzügler)
  let adapted: IntervalProposal | null = null;
  const current = !(state?.lastAt != null && state.lastAt > t);
  if (current && result !== 'not_inspectable' && !opts.followUpOf && !opts.supersedesId && (await adaptMode(c)) === 'auto') {
    const history = (await intervalHistory(c, [opts.assetId])).get(`${opts.assetId}|${opts.schedule}`) ?? [];
    adapted = proposeInterval(sched.intervalMonths, state, [...history, { at: t, result }]);
    if (adapted) interval = adapted.to;
  }
  // Nicht prüfbar: Termin bleibt, damit das Element weiter als fällig auftaucht.
  const nextDue = result === 'not_inspectable' || opts.followUpOf ? null : addMonths(t, interval);
  let schedules = applyInspection(asset.schedules, opts.schedule, t, result, nextDue);
  if (adapted && schedules !== asset.schedules) {
    schedules = { ...schedules, [opts.schedule]: { ...schedules[opts.schedule], intervalMonths: adapted.to === adapted.standard ? null : adapted.to, intervalAt: t } };
  }
  // Bekannte Mängel: weiterhin vorhandene (oder gleich benannte) verknüpfen statt doppelt anlegen, behobene schließen
  const known = await openDefectsOf(c, opts.assetId, [opts.iid, opts.supersedesId]);
  const resolvedKnown = b.resolvedDefects.filter((x) => known.some((k) => k.id === x));
  const linked = linkKnownDefects(b.defects, known, resolvedKnown);
  const fresh = linked.filter((d) => !d.knownId);
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
        `UPDATE defects AS n SET status = o.status, resolved_at = o.resolved_at, resolved_by = o.resolved_by, resolution_note = o.resolution_note,
                resolution_photo_key = o.resolution_photo_key, hidden_at = o.hidden_at, hidden_by = o.hidden_by, hidden_reason = o.hidden_reason,
                invalid_at = o.invalid_at, invalid_by = o.invalid_by, invalid_reason = o.invalid_reason, reopened_at = o.reopened_at
           FROM defects o WHERE n.inspection_id = ?1 AND o.inspection_id = ?2 AND (o.status IN ('resolved','invalid') OR o.hidden_at IS NOT NULL OR o.reopened_at IS NOT NULL) AND ${same}`,
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
  if (linked.some((d) => d.knownId) || b.defects.some((d) => d.knownId)) {
    // Verknüpfung im Protokoll festhalten (bekannte Mängel behalten ihr ursprüngliches Datum)
    extra.push(c.env.DB.prepare("UPDATE inspections SET maintenance = json_set(maintenance, '$.defects', json(?)) WHERE id = ?").bind(JSON.stringify(linked), opts.iid));
  }
  if (resolvedKnown.length) {
    const tz = (await c.env.DB.prepare('SELECT timezone FROM tenants WHERE id = ?').bind(tid(c)).first<string>('timezone')) || 'Europe/Berlin';
    let day: string;
    try {
      day = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).format(t);
    } catch {
      day = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(t);
    }
    extra.push(
      c.env.DB.prepare(
        `UPDATE defects SET status = 'resolved', resolved_at = ?1, resolved_by = ?2, resolution_note = ?3
          WHERE tenant_id = ?4 AND asset_id = ?5 AND status = 'open' AND id IN (SELECT value FROM json_each(?6))`,
      ).bind(t, c.get('user').userId, `Bei Prüfung vom ${day} behoben`, tid(c), opts.assetId, JSON.stringify(resolvedKnown)),
    );
  }
  try {
    // Mängel und Fotos mengenbasiert: feste Zahl an Statements
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, property_id, asset_id, inspection_id, checkpoint_id, title, note, measure, severity, status, photo_key, created_at)
         SELECT lower(hex(randomblob(8))), ?1, ?2, ?3, ?4, ${j('checkpointId')}, ${j('title')}, ${j('note')}, ${j('measure')}, ${j('severity')}, 'open', ${j('photoKey')}, ?5 FROM json_each(?6)`,
      ).bind(tid(c), opts.propertyId, opts.assetId, opts.iid, t, JSON.stringify(fresh)),
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
    if (adapted) {
      await logActivity(c, 'adapt_interval', 'asset', opts.assetId, `${opts.code} (${sched.label}): ${describeProposal(adapted)} – automatisch`);
      await logIntervalChange(c, {
        assetId: opts.assetId,
        code: opts.code,
        buildingId: asset.buildingId,
        propertyId: asset.propertyId,
        schedule: opts.schedule,
        label: sched.label,
        from: state?.intervalMonths ?? null,
        to: schedules[opts.schedule]?.intervalMonths ?? null,
        text: describeProposal(adapted),
        auto: true,
      });
    }
  }
  // Offene Prüfaufträge für dieses Element sind mit der Prüfung erledigt
  const done = await c.env.DB.prepare(
    `UPDATE tasks SET status = 'done', closed_at = ?1, updated_at = ?1, first_response_at = COALESCE(first_response_at, ?1)
      WHERE tenant_id = ?2 AND asset_id = ?3 AND kind = 'inspection' AND status IN ('open','in_progress') RETURNING id`,
  )
    .bind(t, tid(c), opts.assetId)
    .all<{ id: string }>();
  if (done.results.length) {
    await c.env.DB.prepare(
      `INSERT INTO task_comments (id, tenant_id, task_id, user_id, author_name, body, created_at)
       SELECT lower(hex(randomblob(8))), ?1, value, ?2, ?3, ?4, ?5 FROM json_each(?6)`,
    )
      .bind(tid(c), c.get('user').userId, c.get('user').name, `Mit der Prüfung ${opts.code} erledigt.`, t, JSON.stringify(done.results.map((r) => r.id)))
      .run();
  }
  // Wiederkehrende Prüfaufträge: Folgeauftrag anlegen
  if (done.results.length) await afterTasksDone(c, done.results.map((r) => r.id));
  // Autopilot „Nachprüfen“: Mangel behoben → protokollieren; besteht weiter → Mängelbehebung wieder öffnen
  if (done.results.length) await afterVerification(c, done.results.map((r) => r.id), opts.code);
  // Rundgang des Gebäudes (Woche planen) erledigt sich, wenn dort nichts mehr im Planungsfenster fällig ist
  await closeFinishedRounds(c, opts.assetId);
  // Autopilot (assign_defect_tasks): schwere Mängel bekommen sofort eine Aufgabe, ggf. mit Zuweisung nach Regeln
  if (b.defects.length) await autoDefectTasks(c, { inspectionId: opts.iid });
  if (result === 'critical') {
    await notify(c, { roles: ['owner', 'admin'], type: 'critical_defect', title: `Kritischer Mangel an ${opts.code}`, body: b.defects.find((d) => d.severity === 'critical')?.title ?? '', link: `/druck/protokoll/${opts.iid}` });
  }
  return { result, nextDueAt: nextDue };
}

/** Was einem Entwurf zum Abschluss noch fehlt (ohne Unterschrift) – leer = bereit zur Unterschrift. */
export function draftMissing(checkpoints: Checkpoint[], b: Pick<InspectionBody, 'answers' | 'notInspectable' | 'defects' | 'resultOverride' | 'resultReason'>, kinds: string[]) {
  const missing: string[] = [];
  if (!kinds.length) missing.push('Art der Prüfung');
  if (!isComplete(checkpoints.map((p) => p.id), b.answers, b.notInspectable)) {
    const open = checkpoints.filter((p) => !b.answers[p.id]);
    missing.push(`${open.length} ${open.length === 1 ? 'Prüfpunkt' : 'Prüfpunkte'} ohne Bewertung: ${open.map((p) => p.label).join('; ')}`);
  }
  if (b.resultOverride && !b.notInspectable) {
    const computed = computeResult({ notInspectable: b.notInspectable, answers: b.answers, defects: b.defects });
    if (b.resultOverride === 'ok' && b.defects.length) missing.push('„Ohne Mängel“ passt nicht zu erfassten Mängeln');
    else if (b.resultOverride !== computed && b.resultReason.trim().length < 3) missing.push('Begründung für die abweichende Gesamtbewertung');
  }
  return missing;
}

inspections.put('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  const raw = (await c.req.json()) as Record<string, unknown>;
  const b = inspectionBody.parse(raw);
  const ready = z.boolean().optional().parse(raw?.ready);
  const insp = await saveDraft(c, c.req.param('id'), b);
  // „Bereit zur Unterschrift“: mit ready=true setzen, sobald vollständig; unvollständig gespeichert → zurücknehmen
  const missing = draftMissing(insp.checkpoints, b, insp.kinds);
  if (missing.length) await c.env.DB.prepare('UPDATE inspections SET ready_at = NULL WHERE id = ?').bind(insp.id).run();
  else if (ready === true) {
    await c.env.DB.prepare('UPDATE inspections SET ready_at = COALESCE(ready_at, ?) WHERE id = ?').bind(now(), insp.id).run();
    // Plan v6 A2: kritischer Befund wartet auf Unterschrift → sofort Bescheid geben (worker/pending.ts)
    if (insp.readyAt == null) await notifyCriticalReady(c, insp.id);
  }
  else if (ready === false) await c.env.DB.prepare('UPDATE inspections SET ready_at = NULL WHERE id = ?').bind(insp.id).run();
  const isReady = !missing.length && (ready === true || (ready === undefined && insp.readyAt != null));
  return c.json({ ok: true, ready: isReady, missing });
});

/** Gespeicherten Entwurf mit dem übergebenen Inhalt abschließen (Abschluss in der App und Sammel-Unterschrift). */
async function finalizeDraft(c: Ctx, insp: LoadedInspection, b: InspectionBody) {
  // Berichtigung behält das Prüfdatum der ersetzten Prüfung
  const inspectedAt = insp.purpose === 'correction' && insp.supersedesDate ? insp.supersedesDate : now();
  return finalize(c, {
    iid: insp.id,
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
}

inspections.post('/inspections/:id/submit', async (c) => {
  requireRole(c, 'inspector');
  const b = inspectionBody.parse(await c.req.json());
  const insp = await saveDraft(c, c.req.param('id'), b);
  const r = await finalizeDraft(c, insp, b);
  return c.json({ ok: true, ...r });
});

/**
 * Mehrere bereitstehende Entwürfe der angemeldeten Person mit einer Unterschrift abschließen.
 * Nur mit Browser-Sitzung: API-Schlüssel und OAuth-Token (Claude) unterschreiben nie.
 * Jede Prüfung wird einzeln wie beim normalen Abschluss geprüft; Fehler werden je ID gemeldet.
 */
inspections.post('/inspections/sign', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  if (u.apiKeyId) throw new HTTPException(403, { message: 'Unterschreiben geht nur in der App – nicht mit API-Schlüssel oder über Claude' });
  const b = z
    .object({
      ids: z.array(z.string().max(40)).min(1, 'Keine Prüfungen ausgewählt').max(100),
      signature: inspectionBody.shape.signature.removeDefault().unwrap(),
      signerName: str(160).optional(),
    })
    .parse(await c.req.json());
  const signed: { id: string; code: string; result: string; nextDueAt: number | null }[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const iid of [...new Set(b.ids)]) {
    try {
      const insp = await loadInspection(c, iid);
      // Fremde, nicht bereite oder schon abgeschlossene Prüfungen: einheitlich „nicht gefunden“ (keine Auskunft über fremde Entwürfe)
      if (insp.inspectorId !== u.userId || insp.status !== 'draft' || insp.readyAt == null) notFound('Bereite Prüfung');
      const body = inspectionBody.parse({
        kinds: insp.kinds,
        notInspectable: insp.notInspectable,
        answers: insp.answers,
        maintenance: insp.maintenance,
        defects: insp.defects,
        photos: insp.photos,
        notes: insp.notes ?? '',
        signature: b.signature,
        signerName: b.signerName || insp.signerName || u.name,
        resultOverride: insp.resultOverride,
        resultReason: insp.resultReason,
        resolvedDefects: insp.resolvedDefects,
      });
      await storeDraft(c, iid, body, insp.kinds).run();
      const r = await finalizeDraft(c, insp, body);
      signed.push({ id: iid, code: insp.asset.code, result: r.result, nextDueAt: r.nextDueAt });
    } catch (e) {
      failed.push({ id: iid, error: e instanceof HTTPException ? e.message : e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Ungültige Daten') : 'Interner Fehler' });
      if (!(e instanceof HTTPException) && !(e instanceof z.ZodError)) console.error('sign', e);
    }
  }
  if (signed.length) await logActivity(c, 'submit', 'inspection', null, `${signed.length} ${signed.length === 1 ? 'Prüfung' : 'Prüfungen'} gemeinsam unterschrieben`);
  return c.json({ signed, failed });
});

/** Body einer offline erfassten Prüfung. */
export const offlineBody = inspectionBody
  .extend({
    clientId: z.string().min(8).max(64),
    assetId: z.string().max(40),
    schedule: z.string().max(40).default('main'),
    inspectedAt: z.number().int(),
    checkpoints: z
      .array(
        z.object({
          id: str(40).min(1),
          label: str(300).min(1),
          hint: str(300).optional(),
          group: str(60).optional(),
          appliesIf: z.object({ attr: z.string().max(40), equals: z.union([z.string().max(60), z.boolean()]) }).optional(),
        }),
      )
      .min(1)
      .max(100),
    /** Rohdiktat ohne Netz (Plan v7 W) */
    rawNotes: z.array(rawNoteInput).max(RAW_NOTES_MAX).default([]),
    /**
     * Nur als Entwurf übertragen (Tür angesagt, Befund eingesprochen, noch ohne Unterschrift): legt den Entwurf an bzw.
     * ergänzt den offenen Entwurf der Person; mit `ready` und vollständig → bereit zur Unterschrift.
     */
    draftOnly: z.boolean().default(false),
    ready: z.boolean().optional(),
  });

/**
 * Offline erfasste Prüfung übernehmen (idempotent über clientId). `inspectorId` = Person, die offline geprüft hat
 * (beim erneuten Versuch aus `offline_failures` nicht zwingend die angemeldete Person). Route: worker/offline.ts.
 */
export async function submitOffline(c: Ctx, raw: unknown, inspectorId: string, receivedAt = now()) {
  const body = offlineBody.parse(raw);
  checkKeys(c, body);
  const kinds = await kindsOf(c, body);
  const a = await loadAsset(c, body.assetId); // prüft auch den Zugriffsbereich
  const existing = await c.env.DB.prepare('SELECT id FROM inspections WHERE tenant_id = ? AND client_id = ? AND inspector_id = ?')
    .bind(tid(c), body.clientId, inspectorId)
    .first<{ id: string }>();
  if (existing) return { id: existing.id, duplicate: true };
  const n = now();
  // Plausibel zum Zeitpunkt des Eingangs (beim erneuten Versuch: der ersten Übertragung)
  if (body.inspectedAt > receivedAt + 5 * 60_000 || body.inspectedAt < receivedAt - 90 * DAY) throw new HTTPException(400, { message: 'Prüfdatum unplausibel' });
  const notes = cleanRawNotes(c, body.rawNotes).map((x) => (x.source === 'app' ? { ...x, source: 'offline' as const } : x));
  if (body.draftOnly) return submitOfflineDraft(c, body, kinds, a, inspectorId, notes);
  const iid = id();
  await c.env.DB.prepare(
    `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, reason, status, schedule, answers, maintenance, checkpoints, client_id, created_at, updated_at, raw_notes)
     VALUES (?,?,?,?,?,'offline','draft',?,'{}','{"items":[],"defects":[]}',?,?,?,?,?)`,
  )
    .bind(iid, tid(c), a.id, inspectorId, kinds[0] ?? 'periodic', body.schedule, JSON.stringify(body.checkpoints), body.clientId, body.inspectedAt, n, JSON.stringify(mergeRawNotes([], notes)))
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
    return { id: iid, ...r };
  } catch (e) {
    // vollständig zurückrollen, damit ein erneuter Versuch mit derselben clientId sauber startet
    await c.env.DB.batch([...dropSubmittedArtifacts(c, iid), c.env.DB.prepare('DELETE FROM inspections WHERE id = ?').bind(iid)]);
    throw e;
  }
}

/**
 * Offline angesagte Tür als Entwurf übernehmen (ohne Unterschrift): ergänzt den offenen Entwurf derselben Person für
 * dieses Element (offline ist neuer) oder legt einen an. Vollständig und `ready` → bereit zur Unterschrift.
 */
async function submitOfflineDraft(
  c: Ctx,
  body: z.infer<typeof offlineBody>,
  kinds: string[],
  a: Awaited<ReturnType<typeof loadAsset>>,
  inspectorId: string,
  notes: RawNote[],
) {
  const open = await c.env.DB.prepare(
    "SELECT id FROM inspections WHERE asset_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ? AND schedule = ? AND purpose = 'regular' AND follow_up_of IS NULL ORDER BY created_at LIMIT 1",
  )
    .bind(a.id, tid(c), inspectorId, body.schedule)
    .first<{ id: string }>();
  let iid: string;
  if (open) {
    iid = open.id;
    await c.env.DB.prepare('UPDATE inspections SET checkpoints = ?, client_id = COALESCE(client_id, ?) WHERE id = ?').bind(JSON.stringify(body.checkpoints), body.clientId, iid).run();
  } else {
    iid = id();
    await c.env.DB.prepare(
      `INSERT INTO inspections (id, tenant_id, asset_id, inspector_id, kind, kinds, reason, status, schedule, answers, maintenance, checkpoints, client_id, created_at, updated_at, raw_notes)
       VALUES (?,?,?,?,?,?,'offline','draft',?,'{}','{"items":[],"defects":[]}',?,?,?,?,'[]')`,
    )
      .bind(iid, tid(c), a.id, inspectorId, kinds[0] ?? 'periodic', JSON.stringify(kinds), body.schedule, JSON.stringify(body.checkpoints), body.clientId, body.inspectedAt, now())
      .run();
  }
  await storeDraft(c, iid, body, kinds).run();
  if (notes.length) await appendRawNotes(c, iid, notes);
  const missing = draftMissing(body.checkpoints, body, kinds);
  const ready = !missing.length && body.ready === true;
  if (ready) {
    const r = await c.env.DB.prepare('UPDATE inspections SET ready_at = ? WHERE id = ? AND ready_at IS NULL').bind(now(), iid).run();
    if (r.meta.changes) await notifyCriticalReady(c, iid);
  } else await c.env.DB.prepare('UPDATE inspections SET ready_at = NULL WHERE id = ?').bind(iid).run();
  await logActivity(c, 'offline_draft', 'inspection', iid, `Offline angesagte Prüfung ${a.code} als Entwurf übertragen`);
  return { id: iid, draft: true, ready, missing };
}

// ---------- Rohdiktat (Plan v7 W) ----------
/** Rohnotizen an einen Entwurf hängen (eigener Entwurf, Admins auch fremde – wie beim Speichern). */
inspections.post('/inspections/:id/raw-notes', async (c) => {
  requireRole(c, 'inspector');
  const b = z.object({ notes: z.array(rawNoteInput).min(1).max(10) }).parse(await c.req.json());
  const insp = await loadInspection(c, c.req.param('id'));
  if (insp.status !== 'draft') throw new HTTPException(409, { message: 'Prüfung ist bereits abgeschlossen' });
  if (insp.inspectorId !== c.get('user').userId && RANK[c.get('user').role] < RANK.admin) throw new HTTPException(403, { message: 'Nur der Prüfer kann diesen Entwurf bearbeiten' });
  return c.json({ rawNotes: await appendRawNotes(c, insp.id, cleanRawNotes(c, b.notes)) });
});

/** Rohnotizen als ausgewertet markieren (oder zurücknehmen) – Claude über MCP `inspect`, in der App von Hand. */
inspections.patch('/inspections/:id/raw-notes', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({ ids: z.array(z.string().max(40)).max(RAW_NOTES_MAX).optional(), all: z.boolean().optional(), evaluated: z.boolean() })
    .refine((x) => x.all || x.ids?.length, 'Welche Notizen? `ids` oder `all: true`')
    .parse(await c.req.json());
  const insp = await loadInspection(c, c.req.param('id'));
  if (insp.inspectorId !== c.get('user').userId && RANK[c.get('user').role] < RANK.admin) throw new HTTPException(403, { message: 'Nur die prüfende Person oder ein Admin' });
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await c.env.DB.prepare('SELECT raw_notes FROM inspections WHERE id = ?').bind(insp.id).first<string>('raw_notes');
    const list = parseJson<RawNote[]>(cur, []);
    const t = now();
    let changed = 0;
    const next = list.map((n) => {
      if (!(b.all || b.ids!.includes(n.id)) || n.evaluated === b.evaluated) return n;
      changed++;
      return { ...n, evaluated: b.evaluated, evaluatedAt: b.evaluated ? t : null };
    });
    if (!changed) return c.json({ changed: 0, rawNotes: list });
    const r = await c.env.DB.prepare('UPDATE inspections SET raw_notes = ?, updated_at = ? WHERE id = ? AND raw_notes = ?').bind(JSON.stringify(next), t, insp.id, cur).run();
    if (r.meta.changes) {
      await logActivity(c, 'evaluate', 'inspection', insp.id, `Diktat zu ${insp.asset.code}: ${changed} ${changed === 1 ? 'Notiz' : 'Notizen'} ${b.evaluated ? 'ausgewertet' : 'wieder offen'}`);
      return c.json({ changed, rawNotes: next });
    }
  }
  throw new HTTPException(409, { message: 'Bitte erneut versuchen' });
});

// ---------- Element archivieren (v6 B8-Rest, Plan v7 W) ----------
/**
 * Element archivieren = in den Papierkorb (30 Tage in der App wiederherstellbar, Admins). Admin-Sitzung oder
 * Schreib-Schlüssel/Token einer Person, die bei diesem Aufruf Admin/Inhaber ohne Bereichseinschränkung ist
 * (`requireStructure`, wie #33) – damit auch über Claude (MCP `update_asset` mit `archive: true`).
 */
inspections.post('/assets/:id/archive', async (c) => {
  requireStructure(c);
  const b = z.object({ reason: str(300).default('') }).parse(await c.req.json().catch(() => ({})));
  const a = await c.env.DB.prepare('SELECT id, code FROM assets WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').bind(c.req.param('id'), tid(c)).first<{ id: string; code: string }>();
  if (!a) notFound('Element');
  await c.env.DB.prepare('UPDATE assets SET deleted_at = ?, deleted_label = label_code, label_code = NULL WHERE id = ? AND deleted_at IS NULL').bind(now(), a.id).run();
  await logActivity(c, 'archive', 'asset', a.id, `Element ${a.code} archiviert${b.reason ? ` (${b.reason})` : ''}`);
  return c.json({ ok: true, code: a.code });
});

inspections.delete('/inspections/:id', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const isAdmin = ['admin', 'owner'].includes(u.role);
  // Eigene Entwürfe verwerfen; fremde nur als Admin
  const r = await c.env.DB.prepare(
    `DELETE FROM inspections WHERE id = ? AND tenant_id = ? AND status = 'draft' AND (inspector_id = ? OR ?)
        AND asset_id IN (SELECT id FROM assets WHERE ${scopeSql(c, 'building_id', 'building')})`,
  )
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
  // offene Mängel je Element, damit „Bekannte Mängel“ auch ohne Netz erscheinen
  const openDefects = await c.env.DB.prepare(
    `SELECT d.id, d.asset_id AS assetId, d.checkpoint_id AS checkpointId, d.title, d.note, d.measure, d.severity, d.created_at AS createdAt FROM defects d
      JOIN assets a ON a.id = d.asset_id WHERE d.tenant_id = ? AND a.building_id = ? AND a.deleted_at IS NULL AND d.status = 'open' AND d.hidden_at IS NULL ORDER BY d.created_at LIMIT 2000`,
  )
    .bind(tid(c), b.id)
    .all();
  // Katalog-Typen für „Tür ansagen“ ohne Netz (Plan v7 W) – ab Prüfer
  const products = RANK[c.get('user').role] >= RANK.inspector ? (await readCatalog(c)).products : [];
  return c.json({ building: b, assets: assets.results.map(mapAsset), categories: await listCategories(c), openDefects: openDefects.results, products, preparedAt: now() });
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
