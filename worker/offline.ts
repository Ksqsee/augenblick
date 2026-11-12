// Offline erfasste Prüfungen übernehmen und abgelehnte Übertragungen auf dem Server aufbewahren
// („Übertragungen prüfen“ auf der Offline-Seite: erneut versuchen oder löschen).
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import { tid } from './data';
import { submitOffline } from './inspections';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, RANK, requireRole, scopeSql } from './lib';
import { notify } from './notify';

export const offline = new Hono<AppEnv>();

/** Höchstgröße der gespeicherten Prüfungsdaten (ohne Unterschrift). Größere Daten werden nur mit Grund gemerkt. */
export const MAX_FAILURE_PAYLOAD = 256 * 1024;
/** Höchstzahl offener abgelehnter Übertragungen je Person (Schutz vor Speicher-Flut). */
export const MAX_OPEN_FAILURES = 200;
const SIGNATURE = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

/** Status und Text eines Fehlers wie in der API-Antwort (worker/index.ts → onError). */
function describeError(e: unknown): { status: number; message: string } {
  if (e instanceof ZodError) return { status: 400, message: e.issues[0]?.message ?? 'Ungültige Eingabe' };
  if (e instanceof HTTPException) return { status: e.status, message: e.message };
  return { status: 500, message: 'Interner Fehler' };
}

/** Anmeldung, Rechte und Drosselung sind keine inhaltlichen Ablehnungen – sie werden nicht aufbewahrt. */
const storable = (status: number) => ![401, 403, 429].includes(status);

/**
 * Abgelehnte Übertragung merken (je Person und clientId einmal; Wiederholungen zählen hoch).
 * Die Unterschrift wird als Datei im Speicher des Workspaces abgelegt, die Daten enthalten nur Schlüssel.
 */
async function recordFailure(c: Ctx, raw: unknown, err: { status: number; message: string }): Promise<string | null> {
  const u = c.get('user');
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const clientId = typeof body?.clientId === 'string' && body.clientId.length >= 8 && body.clientId.length <= 64 ? body.clientId : null;
  if (!clientId) return null; // ohne Kennung nicht zuordenbar (und nicht erneut übertragbar)
  const assetId = typeof body?.assetId === 'string' && body.assetId.length <= 40 ? body.assetId : null;
  const prev = await c.env.DB.prepare('SELECT id, signature_key FROM offline_failures WHERE tenant_id = ? AND user_id = ? AND client_id = ?')
    .bind(tid(c), u.userId, clientId)
    .first<{ id: string; signature_key: string | null }>();
  if (!prev) {
    const open = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM offline_failures WHERE tenant_id = ? AND user_id = ? AND resolved_at IS NULL')
      .bind(tid(c), u.userId)
      .first<number>('n');
    if ((open ?? 0) >= MAX_OPEN_FAILURES) return null;
  }
  // Element nur benennen, wenn die Person es sehen darf (gelöschte eingeschlossen)
  const asset = assetId
    ? await c.env.DB.prepare(`SELECT a.code, a.category FROM assets a WHERE a.id = ? AND a.tenant_id = ? AND ${scopeSql(c, 'a.building_id', 'building')}`)
        .bind(assetId, tid(c))
        .first<{ code: string; category: string }>()
    : null;
  const { signature, ...rest } = body ?? {};
  let payload: string | null = JSON.stringify(rest);
  if (payload.length > MAX_FAILURE_PAYLOAD) payload = null;
  let signatureKey: string | null = null;
  const m = payload && typeof signature === 'string' && signature.length <= 400_000 ? SIGNATURE.exec(signature) : null;
  if (m) {
    signatureKey = `${tid(c)}/${id(24)}`;
    await c.env.FILES.put(signatureKey, Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0)), { httpMetadata: { contentType: `image/${m[1]}` } });
  }
  const t = now();
  const fid = prev?.id ?? id();
  await c.env.DB.prepare(
    `INSERT INTO offline_failures (id, tenant_id, user_id, asset_id, asset_code, client_id, status, reason, payload, signature_key, attempts, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)
     ON CONFLICT (tenant_id, user_id, client_id) DO UPDATE SET status = ?7, reason = ?8, payload = ?9, signature_key = ?10, asset_id = ?4, asset_code = ?5,
            attempts = attempts + 1, updated_at = ?11, resolved_at = NULL, resolved_by = NULL, inspection_id = NULL`,
  )
    .bind(fid, tid(c), u.userId, assetId, asset?.code ?? '', clientId, err.status, err.message.slice(0, 500), payload, signatureKey, t)
    .run();
  if (prev?.signature_key && prev.signature_key !== signatureKey) await c.env.FILES.delete(prev.signature_key);
  if (!prev) {
    await notify(c, {
      userIds: [u.userId],
      roles: ['owner', 'admin'],
      exceptUserId: undefined,
      type: 'offline_failure',
      title: `Offline-Prüfung ${asset?.code ?? ''} nicht übernommen`.replace('  ', ' '),
      body: `${u.name}: ${err.message}`,
      link: '/offline?tab=uebertragungen',
      dedupe: `offline_failure:${fid}`,
    });
  }
  return fid;
}

offline.post('/inspections/offline', async (c) => {
  requireRole(c, 'inspector');
  const raw = await c.req.json().catch(() => null);
  try {
    return c.json(await submitOffline(c, raw, c.get('user').userId));
  } catch (e) {
    const err = describeError(e);
    if (!storable(err.status)) throw e;
    if (err.status >= 500) console.error(e);
    const failureId = await recordFailure(c, raw, err);
    return c.json({ error: err.message, failureId }, err.status as 400);
  }
});

const isAdmin = (c: Ctx) => RANK[c.get('user').role] >= RANK.admin;

interface FailureRow {
  id: string;
  user_id: string;
  asset_id: string | null;
  asset_code: string;
  client_id: string;
  status: number;
  reason: string;
  payload: string | null;
  signature_key: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
}

/** Eintrag laden: Admins alle des Workspaces, sonst nur eigene. */
async function loadFailure(c: Ctx, fid: string) {
  const r = await c.env.DB.prepare('SELECT * FROM offline_failures WHERE id = ? AND tenant_id = ? AND resolved_at IS NULL AND (user_id = ? OR ?)')
    .bind(fid, tid(c), c.get('user').userId, isAdmin(c) ? 1 : 0)
    .first<FailureRow>();
  if (!r) notFound('Übertragung');
  return r;
}

offline.get('/offline/failures', async (c) => {
  requireRole(c, 'inspector');
  const all = isAdmin(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT f.id, f.user_id AS userId, u.name AS userName, f.asset_id AS assetId, f.asset_code AS assetCode, f.status, f.reason, f.attempts,
              f.created_at AS createdAt, f.updated_at AS updatedAt, f.payload IS NOT NULL AS retryable,
              json_extract(f.payload, '$.inspectedAt') AS inspectedAt, json_extract(f.payload, '$.schedule') AS schedule,
              a.category, b.name AS buildingName, p.name AS propertyName,
              (a.id IS NOT NULL AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND ${scopeSql(c, 'a.building_id', 'building')}) AS assetAvailable
         FROM offline_failures f JOIN users u ON u.id = f.user_id
         LEFT JOIN assets a ON a.id = f.asset_id AND a.tenant_id = f.tenant_id
         LEFT JOIN buildings b ON b.id = a.building_id LEFT JOIN properties p ON p.id = b.property_id
        WHERE f.tenant_id = ?1 AND f.resolved_at IS NULL AND (?2 OR f.user_id = ?3) ORDER BY f.updated_at DESC LIMIT 500`,
    )
      .bind(tid(c), all ? 1 : 0, c.get('user').userId)
      .all<Record<string, unknown>>()
  ).results;
  return c.json(
    rows.map((r) => ({
      ...r,
      retryable: !!r.retryable,
      assetAvailable: !!r.assetAvailable,
      // Ort nur zeigen, wenn das Element im Zugriffsbereich liegt
      buildingName: r.assetAvailable ? r.buildingName : null,
      propertyName: r.assetAvailable ? r.propertyName : null,
    })),
  );
});

/**
 * Erneut übertragen – serverseitig mit den gespeicherten Daten. Optional an ein anderes Element derselben Art
 * (wenn das ursprüngliche gelöscht wurde). Die Prüfung bleibt der Person zugeordnet, die offline geprüft hat.
 */
offline.post('/offline/failures/:id/retry', async (c) => {
  requireRole(c, 'inspector');
  const b = z.object({ assetId: z.string().max(40).optional() }).parse(await c.req.json().catch(() => ({})));
  const f = await loadFailure(c, c.req.param('id'));
  if (!f.payload) throw new HTTPException(409, { message: 'Die Daten waren zu groß oder unvollständig und wurden nicht gespeichert' });
  const body = parseJson<Record<string, unknown>>(f.payload, {});
  if (b.assetId && b.assetId !== body.assetId) {
    // Ersatz-Element: gleiche Art wie das ursprüngliche, damit Prüfpunkte und Prüfart passen
    const [orig, repl] = await c.env.DB.batch([
      c.env.DB.prepare('SELECT category FROM assets WHERE id = ? AND tenant_id = ?').bind(String(body.assetId ?? ''), tid(c)),
      c.env.DB.prepare(`SELECT a.category FROM assets a WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL AND ${scopeSql(c, 'a.building_id', 'building')}`).bind(b.assetId, tid(c)),
    ]);
    const o = (orig.results[0] as { category: string } | undefined)?.category;
    const r = (repl.results[0] as { category: string } | undefined)?.category;
    if (!r) notFound('Element');
    if (o && o !== r) throw new HTTPException(400, { message: 'Bitte ein Element derselben Art wählen' });
    body.assetId = b.assetId;
  }
  if (f.signature_key) {
    const obj = await c.env.FILES.get(f.signature_key);
    if (obj) {
      const bytes = new Uint8Array(await obj.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      body.signature = `data:${obj.httpMetadata?.contentType ?? 'image/png'};base64,${btoa(bin)}`;
    }
  }
  try {
    const r = await submitOffline(c, body, f.user_id, f.created_at);
    await c.env.DB.prepare('UPDATE offline_failures SET resolved_at = ?, resolved_by = ?, inspection_id = ?, payload = NULL, signature_key = NULL, updated_at = ? WHERE id = ?')
      .bind(now(), c.get('user').userId, r.id, now(), f.id)
      .run();
    if (f.signature_key) await c.env.FILES.delete(f.signature_key);
    await logActivity(c, 'retry', 'inspection', r.id, `Offline-Prüfung ${f.asset_code || ''} erneut übertragen`.replace('  ', ' '));
    return c.json({ ok: true, inspectionId: r.id, duplicate: !!(r as { duplicate?: boolean }).duplicate });
  } catch (e) {
    const err = describeError(e);
    if (err.status >= 500) console.error(e);
    await c.env.DB.prepare('UPDATE offline_failures SET status = ?, reason = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?')
      .bind(err.status, err.message.slice(0, 500), now(), f.id)
      .run();
    throw e;
  }
});

offline.delete('/offline/failures/:id', async (c) => {
  requireRole(c, 'inspector');
  const f = await loadFailure(c, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM offline_failures WHERE id = ?').bind(f.id).run();
  if (f.signature_key) await c.env.FILES.delete(f.signature_key);
  await logActivity(c, 'delete', 'offline_failure', f.id, `Abgelehnte Offline-Prüfung ${f.asset_code || ''} gelöscht`.replace('  ', ' '));
  return c.json({ ok: true });
});
