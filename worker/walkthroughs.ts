import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { type Answer, addMonths, computeResult, isComplete } from '../shared/logic';
import { BUILDING_TYPES, type BuildingType, questionsFor, WALK_INTERVAL_MONTHS, type WalkQuestion } from '../shared/walkthrough';
import { severityEnum, str, tid } from './data';
import { notify } from './notify';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireRole } from './lib';

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

walks.get('/walkthroughs', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.status, w.result, w.building_type AS buildingType, w.inspected_at AS inspectedAt, w.created_at AS createdAt, w.next_due_at AS nextDueAt,
            p.id AS propertyId, p.name AS propertyName, b.name AS buildingName, u.name AS inspector,
            (SELECT COUNT(*) FROM defects d WHERE d.walkthrough_id = w.id AND d.status = 'open') AS openDefects
       FROM walkthroughs w JOIN properties p ON p.id = w.property_id LEFT JOIN buildings b ON b.id = w.building_id
       JOIN users u ON u.id = w.inspector_id
      WHERE w.tenant_id = ? AND p.deleted_at IS NULL ORDER BY COALESCE(w.inspected_at, w.created_at) DESC LIMIT 300`,
  )
    .bind(tid(c))
    .all();
  return c.json(rows.results);
});

walks.post('/properties/:id/walkthroughs', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({ buildingId: z.string().nullable().default(null), buildingType: z.enum(Object.keys(BUILDING_TYPES) as [BuildingType]).optional() })
    .parse(await c.req.json());
  const p = await c.env.DB.prepare('SELECT id, building_type FROM properties WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'), tid(c))
    .first<{ id: string; building_type: BuildingType }>();
  if (!p) notFound('Objekt');
  if (b.buildingId) {
    const ok = await c.env.DB.prepare('SELECT 1 FROM buildings WHERE id = ? AND property_id = ? AND deleted_at IS NULL').bind(b.buildingId, p.id).first();
    if (!ok) notFound('Gebäude');
  }
  const draft = await c.env.DB.prepare(
    "SELECT id FROM walkthroughs WHERE property_id = ? AND tenant_id = ? AND status = 'draft' AND inspector_id = ? AND COALESCE(building_id,'') = ?",
  )
    .bind(p.id, tid(c), c.get('user').userId, b.buildingId ?? '')
    .first<{ id: string }>();
  if (draft) return c.json(draft);
  const type = b.buildingType ?? p.building_type ?? 'general';
  const wid = id();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO walkthroughs (id, tenant_id, property_id, building_id, building_type, inspector_id, status, questions, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'draft',?,?,?)`,
  )
    .bind(wid, tid(c), p.id, b.buildingId, type, c.get('user').userId, JSON.stringify(questionsFor(type)), t, t)
    .run();
  return c.json({ id: wid });
});

async function load(c: Ctx, wid: string) {
  const r = await c.env.DB.prepare(
    `SELECT w.*, p.name AS propertyName, p.address AS propertyAddress, b.name AS buildingName, u.name AS inspectorName, t.name AS tenantName
       FROM walkthroughs w JOIN properties p ON p.id = w.property_id LEFT JOIN buildings b ON b.id = w.building_id
       JOIN users u ON u.id = w.inspector_id JOIN tenants t ON t.id = w.tenant_id
      WHERE w.id = ? AND w.tenant_id = ?`,
  )
    .bind(wid, tid(c))
    .first<Record<string, unknown>>();
  if (!r) notFound('Begehung');
  return {
    id: r.id as string,
    propertyId: r.property_id as string,
    buildingId: r.building_id as string | null,
    buildingType: r.building_type as BuildingType,
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
  const next = addMonths(t, WALK_INTERVAL_MONTHS);
  const byId = new Map(w.questions.map((q) => [q.id, q]));
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE walkthroughs SET status='submitted', result=?, inspected_at=?, next_due_at=?, updated_at=? WHERE id=?").bind(result, t, next, t, wid),
    ...b.findings.map((f) =>
      c.env.DB.prepare(
        `INSERT INTO defects (id, tenant_id, property_id, walkthrough_id, checkpoint_id, title, note, measure, legal_basis, severity, status, photo_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      ).bind(id(), tid(c), w.propertyId, wid, f.questionId ?? null, f.title, f.note, f.measure, (f.questionId && byId.get(f.questionId)?.basis) || '', f.severity, f.photoKey ?? null, t),
    ),
  ]);
  await logActivity(c, 'submit', 'walkthrough', wid, `Begehung ${w.propertyName} abgeschlossen`);
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
