// Katalog je Workspace (v5 Paket P): Produkte (Hersteller/Typ mit Vorgaben), typische Mängel, Begriffe.
// Lesen ab Prüfer; Schreiben nur mit Admin-Sitzung oder Schreib-Schlüssel einer Admin-/Inhaber-Person
// (`requireStructure`, Befund #33/#34). Grundausstattung genau einmal je Workspace (beim Anlegen bzw. ersten Lesen).
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CATALOG_LIMITS, CATALOG_SEED_DEFECTS, CATALOG_SEED_TERMS, type CatalogDefect, type CatalogProduct, type CatalogTerm } from '../shared/catalog';
import { type CatalogKind, entryKey, foldText, planCatalogMerge } from '../shared/vocab';
import { getCategoryDef } from './categories';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireRole, requireStructure } from './lib';

const tid = (c: Ctx) => c.get('user').tenantId;
const str = (max: number) => z.string().trim().max(max);
const KINDS = ['products', 'defects', 'terms'] as const;
const TABLE: Record<CatalogKind, string> = { products: 'catalog_products', defects: 'catalog_defects', terms: 'catalog_terms' };
const LABEL: Record<CatalogKind, string> = { products: 'Produkt', defects: 'Katalog-Mangel', terms: 'Begriff' };

// ---------- Eingaben ----------
const attrValue = z.union([z.string().trim().max(200), z.number().finite(), z.boolean(), z.null()]);
const fields = {
  products: z.object({
    manufacturer: str(120).min(1, 'Hersteller fehlt'),
    model: str(120).min(1, 'Typ fehlt'),
    category: str(40).default(''),
    defaults: z
      .record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/, 'Ungültiger Feldname'), attrValue)
      .refine((o) => Object.keys(o).length <= 30, 'Höchstens 30 Vorgabewerte')
      .default({}),
    approval: str(120).default(''),
    note: str(500).default(''),
  }),
  defects: z.object({
    title: str(200).min(2, 'Bezeichnung fehlt'),
    synonyms: z.array(str(120).min(1)).max(20).default([]),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    measure: str(300).default(''),
    category: str(40).default(''),
  }),
  terms: z.object({
    term: str(40).min(1, 'Begriff fehlt'),
    meaning: str(200).min(1, 'Bedeutung fehlt'),
  }),
} as const;
type Input = { products: z.infer<typeof fields.products>; defects: z.infer<typeof fields.defects>; terms: z.infer<typeof fields.terms> };

const kindParam = (c: Ctx): CatalogKind => {
  const k = c.req.param('kind');
  if (!KINDS.includes(k as CatalogKind)) notFound('Katalogliste');
  return k as CatalogKind;
};

/** Art muss leer oder eine Elementart des Workspaces sein (eingebaut oder eigene). */
async function assertCategory(c: Ctx, category: string) {
  if (category) await getCategoryDef(c, category);
}

// ---------- Zeilen ----------
type Row = Record<string, unknown> & { id: string };
const fromRow = (kind: CatalogKind, r: Row) =>
  kind === 'products'
    ? ({ id: r.id, manufacturer: r.manufacturer, model: r.model, category: r.category, defaults: parseJson(r.defaults as string, {}), approval: r.approval, note: r.note } as CatalogProduct)
    : kind === 'defects'
      ? ({ id: r.id, title: r.title, synonyms: parseJson(r.synonyms as string, []), severity: r.severity, measure: r.measure, category: r.category } as CatalogDefect)
      : ({ id: r.id, term: r.term, meaning: r.meaning } as CatalogTerm);

const COLS: Record<CatalogKind, string[]> = {
  products: ['manufacturer', 'model', 'category', 'defaults', 'approval', 'note'],
  defects: ['title', 'synonyms', 'severity', 'measure', 'category'],
  terms: ['term', 'meaning'],
};
const dbValue = (k: string, v: unknown) => (k === 'defaults' || k === 'synonyms' ? JSON.stringify(v ?? (k === 'defaults' ? {} : [])) : (v ?? ''));

function insertStmt(c: Ctx, kind: CatalogKind, e: Record<string, unknown>, t: number) {
  const cols = COLS[kind];
  return c.env.DB.prepare(
    `INSERT INTO ${TABLE[kind]} (id, tenant_id, ${cols.join(', ')}, match_key, created_at, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
  ).bind(id(), tid(c), ...cols.map((k) => dbValue(k, e[k])), entryKey(kind, e), t, t);
}
function updateStmt(c: Ctx, kind: CatalogKind, rowId: string, e: Record<string, unknown>, t: number) {
  const cols = COLS[kind];
  return c.env.DB.prepare(`UPDATE ${TABLE[kind]} SET ${cols.map((k) => `${k} = ?`).join(', ')}, match_key = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).bind(
    ...cols.map((k) => dbValue(k, e[k])),
    entryKey(kind, e),
    t,
    rowId,
    tid(c),
  );
}

async function listKind(c: Ctx, kind: CatalogKind) {
  const order = kind === 'products' ? 'manufacturer, model' : kind === 'defects' ? 'category, title' : 'term';
  const rows = await c.env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE tenant_id = ? ORDER BY ${order} COLLATE NOCASE`).bind(tid(c)).all<Row>();
  return rows.results.map((r) => fromRow(kind, r));
}

async function countKind(c: Ctx, kind: CatalogKind) {
  return (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLE[kind]} WHERE tenant_id = ?`).bind(tid(c)).first<number>('n')) ?? 0;
}

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

// ---------- Grundausstattung ----------
/**
 * Statements für die Grundausstattung (Begriffe und typische Mängel). Wirkt nur, wenn der Workspace noch nicht
 * ausgestattet wurde: Die Markierung wird atomar gesetzt, die Einträge nur mit genau dieser Markierung eingefügt
 * (INSERT OR IGNORE schützt zusätzlich vor Dubletten). Gelöschte Grundeinträge kommen dadurch nie zurück.
 */
export function seedCatalogStatements(db: D1Database, tenantId: string, t = Date.now()) {
  const terms = CATALOG_SEED_TERMS.map((x) => ({ ...x, id: id(), key: entryKey('terms', x) }));
  const defects = CATALOG_SEED_DEFECTS.map((x) => ({ ...x, synonyms: JSON.stringify(x.synonyms), id: id(), key: entryKey('defects', x) }));
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  const guard = 'EXISTS (SELECT 1 FROM tenants WHERE id = ?1 AND catalog_seeded_at = ?2)';
  return [
    db.prepare('UPDATE tenants SET catalog_seeded_at = ?2 WHERE id = ?1 AND catalog_seeded_at IS NULL').bind(tenantId, t),
    db
      .prepare(`INSERT OR IGNORE INTO catalog_terms (id, tenant_id, term, meaning, match_key, created_at, updated_at) SELECT ${j('id')}, ?1, ${j('term')}, ${j('meaning')}, ${j('key')}, ?2, ?2 FROM json_each(?3) WHERE ${guard}`)
      .bind(tenantId, t, JSON.stringify(terms)),
    db
      .prepare(
        `INSERT OR IGNORE INTO catalog_defects (id, tenant_id, title, synonyms, severity, measure, category, match_key, created_at, updated_at)
         SELECT ${j('id')}, ?1, ${j('title')}, ${j('synonyms')}, ${j('severity')}, ${j('measure')}, ${j('category')}, ${j('key')}, ?2, ?2 FROM json_each(?3) WHERE ${guard}`,
      )
      .bind(tenantId, t, JSON.stringify(defects)),
  ];
}

/** Bestehende Workspaces bekommen die Grundausstattung beim ersten Lesen (idempotent). */
export async function ensureCatalog(c: Ctx) {
  const seeded = await c.env.DB.prepare('SELECT catalog_seeded_at AS s FROM tenants WHERE id = ?').bind(tid(c)).first<{ s: number | null }>();
  if (seeded && seeded.s == null) await c.env.DB.batch(seedCatalogStatements(c.env.DB, tid(c), now()));
}

/** Katalog des Workspaces (für MCP, Vorschläge). */
export async function readCatalog(c: Ctx) {
  await ensureCatalog(c);
  const [products, defects, terms] = await Promise.all(KINDS.map((k) => listKind(c, k)));
  return { products: products as CatalogProduct[], defects: defects as CatalogDefect[], terms: terms as CatalogTerm[] };
}

// ---------- Routen ----------
export const catalog = new Hono<AppEnv>();

catalog.get('/catalog', async (c) => {
  requireRole(c, 'inspector');
  return c.json(await readCatalog(c));
});

catalog.get('/catalog/:kind', async (c) => {
  requireRole(c, 'inspector');
  const kind = kindParam(c);
  await ensureCatalog(c);
  const q = foldText(c.req.query('q') ?? '');
  const cat = c.req.query('category') ?? '';
  const rows = (await listKind(c, kind)) as unknown as Record<string, unknown>[];
  return c.json(
    rows.filter(
      (r) =>
        (!cat || !r.category || r.category === cat) &&
        (!q || foldText(Object.values(r).filter((v) => typeof v === 'string' || Array.isArray(v)).flat().join(' ')).includes(q)),
    ),
  );
});

/**
 * Stapel anlegen/ändern (MCP `catalog`, Übernahme aus Dokumenten): gleicher Schlüssel (Hersteller+Typ, Art+Titel,
 * Begriff) ändert den vorhandenen Eintrag, sonst neu. `dryRun` (Standard) liefert nur die Vorschau.
 */
catalog.post('/catalog/batch', async (c) => {
  requireStructure(c);
  const raw = z
    .object({ kind: z.enum(KINDS), items: z.array(z.record(z.unknown())).min(1).max(200), dryRun: z.boolean().default(true) })
    .parse(await c.req.json());
  const kind = raw.kind;
  const errors: { index: number; error: string }[] = [];
  const valid: Record<string, unknown>[] = [];
  const cats = new Map<string, boolean>();
  for (const [i, item] of raw.items.entries()) {
    const p = fields[kind].safeParse(item);
    if (!p.success) {
      errors.push({ index: i, error: p.error.issues[0]?.message ?? 'Ungültig' });
      continue;
    }
    const cat = (p.data as { category?: string }).category;
    if (cat) {
      if (!cats.has(cat)) cats.set(cat, await getCategoryDef(c, cat).then(() => true, () => false));
      if (!cats.get(cat)) {
        errors.push({ index: i, error: `Unbekannte Elementart „${cat}“` });
        continue;
      }
    }
    valid.push(p.data);
  }
  await ensureCatalog(c);
  const existing = (await listKind(c, kind)) as unknown as (Record<string, unknown> & { id: string })[];
  const plan = planCatalogMerge(kind, existing, valid);
  if (existing.length + plan.create.length > CATALOG_LIMITS[kind])
    throw new HTTPException(400, { message: `Höchstens ${CATALOG_LIMITS[kind]} Einträge je Liste (vorhanden: ${existing.length}, neu: ${plan.create.length})` });
  const result = {
    dryRun: raw.dryRun,
    create: plan.create.map((e) => summary(kind, e)),
    update: plan.update.map((u) => ({ entry: summary(kind, u.after), changes: u.changes })),
    unchanged: plan.unchanged,
    errors,
  };
  if (!raw.dryRun && (plan.create.length || plan.update.length)) {
    const t = now();
    // ein Batch = eine Transaktion
    await c.env.DB.batch([...plan.create.map((e) => insertStmt(c, kind, e, t)), ...plan.update.map((u) => updateStmt(c, kind, u.id, u.after, t))]);
    await logActivity(c, 'update', 'catalog', null, `Katalog (${LABEL[kind]}): ${plan.create.length} neu, ${plan.update.length} geändert`);
  }
  return c.json(result);
});

catalog.post('/catalog/:kind', async (c) => {
  requireStructure(c);
  const kind = kindParam(c);
  const b = fields[kind].parse(await c.req.json()) as Input[typeof kind];
  if ('category' in b) await assertCategory(c, b.category);
  await ensureCatalog(c);
  if ((await countKind(c, kind)) >= CATALOG_LIMITS[kind]) throw new HTTPException(400, { message: `Höchstens ${CATALOG_LIMITS[kind]} Einträge je Liste` });
  const stmt = insertStmt(c, kind, b, now());
  try {
    await stmt.run();
  } catch (e) {
    if (isUnique(e)) throw new HTTPException(409, { message: `${LABEL[kind]} gibt es schon` });
    throw e;
  }
  const row = await c.env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE tenant_id = ? AND match_key = ?`).bind(tid(c), entryKey(kind, b)).first<Row>();
  await logActivity(c, 'create', 'catalog', row?.id ?? null, `${LABEL[kind]} „${summary(kind, b)}“ angelegt`);
  return c.json(fromRow(kind, row!));
});

catalog.patch('/catalog/:kind/:id', async (c) => {
  requireStructure(c);
  const kind = kindParam(c);
  const old = await c.env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND tenant_id = ?`).bind(c.req.param('id'), tid(c)).first<Row>();
  if (!old) notFound(LABEL[kind]);
  // Teiländerung: fehlende Felder vom Bestand
  const merged = { ...fromRow(kind, old), ...((await c.req.json()) as Record<string, unknown>) };
  const b = fields[kind].parse(merged) as Input[typeof kind];
  if ('category' in b) await assertCategory(c, b.category);
  try {
    await updateStmt(c, kind, old.id, b, now()).run();
  } catch (e) {
    if (isUnique(e)) throw new HTTPException(409, { message: `${LABEL[kind]} gibt es schon` });
    throw e;
  }
  await logActivity(c, 'update', 'catalog', old.id, `${LABEL[kind]} „${summary(kind, b)}“ geändert`);
  return c.json(fromRow(kind, { ...old, ...b, defaults: JSON.stringify((b as Record<string, unknown>).defaults ?? {}), synonyms: JSON.stringify((b as Record<string, unknown>).synonyms ?? []) }));
});

catalog.delete('/catalog/:kind/:id', async (c) => {
  requireStructure(c);
  const kind = kindParam(c);
  const old = await c.env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND tenant_id = ?`).bind(c.req.param('id'), tid(c)).first<Row>();
  if (!old) notFound(LABEL[kind]);
  await c.env.DB.prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ? AND tenant_id = ?`).bind(old.id, tid(c)).run();
  await logActivity(c, 'delete', 'catalog', old.id, `${LABEL[kind]} „${summary(kind, old)}“ gelöscht`);
  return c.json({ ok: true });
});

function summary(kind: CatalogKind, e: Record<string, unknown>) {
  const s = (k: string) => String(e[k] ?? '');
  return kind === 'products' ? `${s('manufacturer')} ${s('model')}` : kind === 'defects' ? s('title') : `${s('term')} = ${s('meaning')}`;
}
