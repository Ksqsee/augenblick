import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { WALK_PURPOSES, type WalkPurpose } from '../shared/catalog';
import { type Answer, addMonths, computeResult, isComplete } from '../shared/logic';
import { BUILDING_TYPES, type BuildingType, questionsFor, WALK_INTERVAL_MONTHS, type WalkQuestion } from '../shared/walkthrough';
import { severityEnum, str, tid } from './data';
import { notify } from './notify';
import { type AppEnv, assertInScope, type Ctx, id, logActivity, notFound, now, parseJson, requireRole, scopeSql } from './lib';

export const walks = new Hono<AppEnv>();

const finding = z.object({
  questionId: z.string().max(40).optional(),
  title: str(300).min(1, 'Feststellung ohne Beschreibung'),
  note: str(2000).default(''),
  measure: str(1000).default(''),
  severity: severityEnum,
  photoKey: z.string().max(200).optional(),
});
const body = z.object({
  answers: z.record(z.enum(['ok', 'defect', 'na'])).default({}),
  findings: z.array(finding).max(200).default([]),
  notes: str(5000).default(''),
  participants: str(1000).default(''),
  signature: z.string().max(400_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Ungültige Unterschrift').nullable().default(null),
  signerName: str(160).default(''),
});
type Body = z.infer<typeof body>;

/** Begehungen im Zugriffsbereich: Objekt erlaubt und (falls auf ein Gebäude bezogen) Gebäude erlaubt. */
function walkScope(c: Ctx) {
  if (!c.get('user').scope) return '1=1';
  return `(${scopeSql(c, 'w.property_id', 'property')} AND (w.building_id IS NULL OR ${scopeSql(c, 'w.building_id', 'building')}))`;
}

walks.get('/walkthroughs', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.status, w.result, w.purpose, w.follow_up_of AS followUpOf, w.building_type AS buildingType, w.inspected_at AS inspectedAt, w.created_at AS createdAt, w.next_due_at AS nextDueAt,
            p.id AS propertyId, p.name AS propertyName, b.name AS buildingName, u.name AS inspector,
            (SELECT COUNT(*) FROM defects d WHERE d.walkthrough_id = w.id AND d.status = 'open') AS openDefects
       FROM walkthroughs w JOIN properties p ON p.id = w.property_id LEFT JOIN buildings b ON b.id = w.building_id
       JOIN users u ON u.id = w.inspector_id
      WHERE w.tenant_id = ? AND p.deleted_at IS NULL AND ${walkScope(c)} ORDER BY COALESCE(w.inspected_at, w.created_at) DESC LIMIT 300`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

walks.post('/properties/:id/walkthroughs', async (c) => {
  requireRole(c, 'inspector');
  assertInScope(c, 'property', c.req.param('id'));
  const b = z
    .object({
      buildingId: z.string().nullable().default(null),
      buildingType: z.enum(Object.keys(BUILDING_TYPES) as [BuildingType]).optional(),
      purpose: z.enum(Object.keys(WALK_PURPOSES) as [WalkPurpose]).default('regular'),
      followUpOf: z.string().max(40).optional(),
    })
    .parse(await c.req.json());
  const p = await c.env.DB.prepare('SELECT id, building_type FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), tid(c))
    .first<{ id: string; building_type: BuildingType }>();
  if (!p) notFound('Objekt');
  // Nachbegehung: bezieht sich auf eine abgeschlossene Begehung desselben Objekts und prüft nur deren beanstandete Fragen
  const origin =
    b.purpose === 'follow_up'
      ? await c.env.DB.prepare(
          "SELECT id, building_id, building_type, questions, answers FROM walkthroughs WHERE id = ? AND property_id = ? AND tenant_id = ? AND status = 'submitted'",
        )
          .bind(b.followUpOf ?? '', p.id, tid(c))
          .first<{ id: string; building_id: string | null; building_type: BuildingType; questions: string; answers: string }>()
      : null;
  if (b.purpose === 'follow_up' && !origin) throw new HTTPException(400, { message: 'Ausgangsbegehung für die Nachbegehung nicht gefunden' });
  const buildingId = origin ? origin.building_id : b.buildingId;
  if (buildingId) assertInScope(c, 'building', buildingId);
  else if (c.get('user').scope && !c.get('user').scope!.fullProperties.includes(p.id)) notFound('Objekt'); // ganzes Objekt nur bei voller Freigabe
  if (buildingId && !origin) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM buildings WHERE id = ? AND property_id = ? AND deleted_at IS NULL').bind(buildingId, p.id).first();
    if (!ok) notFound('Gebäude');
  }
  const draft = await c.env.DB.prepare(
    "SELECT id FROM walkthroughs WHERE property_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ? AND COALESCE(building_id,'') = ? AND purpose = ? AND COALESCE(follow_up_of,'') = ?",
  )
    .bind(p.id, tid(c), c.get('user').userId, buildingId ?? '', b.purpose, origin?.id ?? '')
    .first<{ id: string }>();
  if (draft) return c.json(draft);
  const type = origin?.building_type ?? b.buildingType ?? p.building_type ?? 'general';
  let questions = questionsFor(type);
  if (origin) {
    const answers = parseJson<Record<string, Answer>>(origin.answers, {});
    const failed = parseJson<WalkQuestion[]>(origin.questions, []).filter((q) => answers[q.id] === 'defect');
    if (failed.length) questions = failed;
  }
  const wid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO walkthroughs (id, tenant_id, property_id, building_id, building_type, inspector_id, status, questions, purpose, follow_up_of, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?)`,
  )
    .bind(wid, tid(c), p.id, buildingId, type, c.get('user').userId, JSON.stringify(questions), b.purpose, origin?.id ?? null, t, t)
    .run();
  return c.json({ id: wid });
});

async function load(c: Ctx, wid: string) {
  const r = await c.env.DB.prepare(
    `SELECT w.*, p.name AS propertyName, p.address AS propertyAddress, b.name AS buildingName, u.name AS inspectorName, t.name AS tenantName,
            f.inspected_at AS followUpDate
       FROM walkthroughs w JOIN properties p ON p.id = w.property_id LEFT JOIN buildings b ON b.id = w.building_id
       JOIN users u ON u.id = w.inspector_id JOIN tenants t ON t.id = w.tenant_id
       LEFT JOIN walkthroughs f ON f.id = w.follow_up_of AND f.tenant_id = w.tenant_id
      WHERE w.id = ? AND w.tenant_id = ? AND ${walkScope(c)}`,
  )
    .bind(wid, tid(c))
    .first<Record<string, unknown>>();
  if (!r) notFound('Begehung');
  return {
    id: r.id as string,
    propertyId: r.property_id as string,
    buildingId: r.building_id as string | null,
    buildingType: r.building_type as BuildingType,
    purpose: (r.purpose as WalkPurpose) ?? 'regular',
    followUpOf: r.follow_up_of as string | null,
    followUpDate: r.followUpDate as number | null,
    /** null = vor Einführung des Status abgeschlossen bzw. noch Entwurf */
    inspectorFireOfficer: r.inspector_fire_officer == null ? null : !!r.inspector_fire_officer,
    inspectorQualification: (r.inspector_qualification as string) ?? '',
    status: r.status as 'draft' | 'submitted',
    result: r.result as string | null,
    questions: parseJson<WalkQuestion[]>(r.questions as string, []),
    answers: parseJson<Record<string, Answer>>(r.answers as string, {}),
    findings: parseJson<Body['findings']>(r.findings as string, []),
    notes: r.notes as string,
    participants: r.participants as string,
    signature: r.signature as string | null,
    signerName: r.signer_name as string,
    inspectorId: r.inspector_id as string,
    inspectorName: r.inspectorName as string,
    inspectedAt: r.inspected_at as number | null,
    nextDueAt: r.next_due_at as number | null,
    createdAt: r.created_at as number,
    propertyName: r.propertyName as string,
    propertyAddress: r.propertyAddress as string,
    buildingName: r.buildingName as string | null,
    tenantName: r.tenantName as string,
  };
}

walks.get('/walkthroughs/:id', async (c) => c.json(await load(c, c.req.param('id'))));

async function save(c: Ctx, wid: string, b: Body) {
  const w = await load(c, wid);
  if (w.status !== 'draft') throw new HTTPException(409, { message: 'Begehung ist bereits abgeschlossen' });
  if (w.inspectorId !== c.get('user').userId && !['admin', 'owner'].includes(c.get('user').role)) {
    throw new HTTPException(403, { message: 'Nur die prüfende Person kann diesen Entwurf bearbeiten' });
  }
  // Fotos nur aus dem eigenen Workspace
  if (b.findings.some((f) => f.photoKey && !f.photoKey.startsWith(`${tid(c)}/`))) throw new HTTPException(400, { message: 'Ungültige Datei' });
  await c.env.DB.prepare('UPDATE walkthroughs SET answers=?, findings=?, notes=?, participants=?, signature=?, signer_name=?, updated_at=? WHERE id=?')
    .bind(JSON.stringify(b.answers), JSON.stringify(b.findings), b.notes, b.participants, b.signature, b.signerName, now(), wid)
    .run();
  return w;
}

walks.put('/walkthroughs/:id', async (c) => {
  requireRole(c, 'inspector');
  await save(c, c.req.param('id'), body.parse(await c.req.json()));
  return c.json({ ok: true });
});

walks.post('/walkthroughs/:id/submit', async (c) => {
  requireRole(c, 'inspector');
  const b = body.parse(await c.req.json());
  const wid = c.req.param('id');
  const w = await save(c, wid, b);
  if (!isComplete(w.questions.map((q) => q.id), b.answers)) throw new HTTPException(400, { message: 'Bitte alle Fragen beantworten' });
  if (!b.signature) throw new HTTPException(400, { message: 'Unterschrift fehlt' });
  const result = computeResult({ answers: b.answers, defects: b.findings });
  const t = now();
  // Nachbegehung verschiebt den Turnus nicht
  const next = w.followUpOf ? null : addMonths(t, WALK_INTERVAL_MONTHS);
  const byId = new Map(w.questions.map((q) => [q.id, q]));
  // wie bei Prüfungen: erst beanspruchen, dann Mängel mengenbasiert schreiben
  // Qualifikation der durchführenden Person zum Zeitpunkt der Begehung festhalten (Hinweis im Protokoll, DGUV I 205-003)
  const officer = await c.env.DB.prepare('SELECT fire_officer, fire_officer_qualification FROM memberships WHERE tenant_id = ? AND user_id = ?')
    .bind(tid(c), w.inspectorId)
    .first<{ fire_officer: number; fire_officer_qualification: string }>();
  const claim = await c.env.DB.prepare(
    "UPDATE walkthroughs SET status='submitted', result=?, inspected_at=?, next_due_at=?, updated_at=?, inspector_fire_officer=?, inspector_qualification=? WHERE id=? AND status='draft'",
  )
    .bind(result, t, next, t, officer?.fire_officer ? 1 : 0, officer?.fire_officer_qualification ?? '', wid)
    .run();
  if (!claim.meta.changes) throw new HTTPException(409, { message: 'Begehung ist bereits abgeschlossen' });
  const findings = b.findings.map((f) => ({ ...f, basis: (f.questionId && byId.get(f.questionId)?.basis) || '' }));
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  const okIds = Object.entries(b.answers).filter(([, a]) => a === 'ok').map(([k]) => k);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, property_id, walkthrough_id, checkpoint_id, title, note, measure, legal_basis, severity, status, photo_key, created_at)
         SELECT lower(hex(randomblob(8))), ?1, ?2, ?3, ${j('questionId')}, ${j('title')}, ${j('note')}, ${j('measure')}, ${j('basis')}, ${j('severity')}, 'open', ${j('photoKey')}, ?4 FROM json_each(?5)`,
      ).bind(tid(c), w.propertyId, wid, t, JSON.stringify(findings)),
      // Nachbegehung: Feststellungen zu jetzt erfüllten Fragen gelten als behoben
      ...(w.followUpOf
        ? [
            c.env.DB.prepare(
              `UPDATE defects SET status = 'resolved', resolved_at = ?1, resolved_by = ?2
                WHERE walkthrough_id = ?3 AND tenant_id = ?4 AND status = 'open' AND checkpoint_id IN (SELECT value FROM json_each(?5))`,
            ).bind(t, c.get('user').userId, w.followUpOf, tid(c), JSON.stringify(okIds)),
          ]
        : []),
    ]);
  } catch (e) {
    await c.env.DB.prepare("UPDATE walkthroughs SET status='draft', result=NULL, inspected_at=NULL, next_due_at=NULL WHERE id=?").bind(wid).run();
    throw e;
  }
  await logActivity(c, 'submit', 'walkthrough', wid, `${WALK_PURPOSES[w.purpose]} ${w.propertyName} abgeschlossen`);
  await notify(c, {
    roles: ['owner', 'admin'],
    type: 'walkthrough_submitted',
    title: `Begehung ${w.propertyName} abgeschlossen`,
    body: b.findings.length ? `${b.findings.length} Feststellungen` : 'Ohne Feststellungen',
    link: `/druck/begehung/${wid}`,
  });
  return c.json({ ok: true, result, nextDueAt: next });
});

walks.delete('/walkthroughs/:id', async (c) => {
  requireRole(c, 'inspector');
  const u = c.get('user');
  const isAdmin = ['admin', 'owner'].includes(u.role);
  const r = await c.env.DB.prepare("DELETE FROM walkthroughs WHERE id = ? AND tenant_id = ? AND status = 'draft' AND (inspector_id = ? OR ?)")
    .bind(c.req.param('id'), tid(c), u.userId, isAdmin ? 1 : 0)
    .run();
  if (!r.meta.changes) throw new HTTPException(409, { message: 'Nur eigene Entwürfe können verworfen werden' });
  return c.json({ ok: true });
});
