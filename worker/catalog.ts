// Katalog je Workspace (v5 Paket P): Produkte (Hersteller/Typ mit Vorgaben), typische Mängel, Begriffe.
// Lesen ab Prüfer; Schreiben nur mit Admin-Sitzung oder Schreib-Schlüssel einer Admin-/Inhaber-Person
// (`requireStructure`, Befund #33/#34). Grundausstattung genau einmal je Workspace (beim Anlegen bzw. ersten Lesen).
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CATALOG_LIMITS, CATALOG_SEED_DEFECTS, CATALOG_SEED_TERMS, type CatalogDefect, type CatalogProduct, type CatalogService, type CatalogTerm } from '../shared/catalog';
import { CATALOG_EXTRA_DEFECTS } from '../shared/catalog-extra';
import { type CatalogKind, entryKey, foldText, planCatalogMerge } from '../shared/vocab';
import { getCategoryDef, listCategories } from './categories';
import { type AppEnv, type Ctx, id, logActivity, notFound, now, parseJson, requireRole, requireStructure } from './lib';

const tid = (c: Ctx) => c.get('user').tenantId;
const KINDS = ['products', 'defects', 'terms', 'services'] as const;
const TABLE: Record<CatalogKind, string> = { products: 'catalog_products', defects: 'catalog_defects', terms: 'catalog_terms', services: 'catalog_services' };
const LABEL: Record<CatalogKind, string> = { products: 'Produkt', defects: 'Katalog-Mangel', terms: 'Begriff', services: 'Leistung' };

// ---------- Eingaben ----------
import { CATALOG_FIELDS as fields } from '../shared/catalog-schema';
type Input = {
  products: z.infer<typeof fields.products>;
  defects: z.infer<typeof fields.defects>;
  terms: z.infer<typeof fields.terms>;
  services: z.infer<typeof fields.services>;
};

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
    ? ({
        id: r.id,
        manufacturer: r.manufacturer,
        model: r.model,
        category: r.category,
        defaults: parseJson(r.defaults as string, {}),
        approval: r.approval,
        note: r.note,
        aliases: parseJson(r.aliases as string, []),
        approvalValidUntil: (r.approval_valid_until as string | null) ?? null,
        requirement: (r.requirement as string) ?? '',
      } as CatalogProduct)
    : kind === 'defects'
      ? ({
          id: r.id,
          title: r.title,
          synonyms: parseJson(r.synonyms as string, []),
          severity: r.severity,
          measure: r.measure,
          category: r.category,
          serviceKeys: parseJson(r.service_keys as string, []),
          quantity: (r.quantity as number) ?? 1,
          note: (r.note as string) ?? '',
        } as CatalogDefect)
      : kind === 'services'
        ? ({
            id: r.id,
            key: r.key,
            title: r.title,
            unit: r.unit,
            price: Math.round(Number(r.price_cents ?? 0)) / 100,
            condition: parseJson(r.condition as string, {}),
            kind: r.kind,
            category: r.category,
            note: r.note,
          } as CatalogService)
        : ({ id: r.id, term: r.term, meaning: r.meaning } as CatalogTerm);

/** Feld → Spalte je Liste (Reihenfolge = Spalten beim Schreiben) */
const COLS: Record<CatalogKind, [string, string][]> = {
  products: [
    ['manufacturer', 'manufacturer'],
    ['model', 'model'],
    ['category', 'category'],
    ['defaults', 'defaults'],
    ['approval', 'approval'],
    ['note', 'note'],
    ['aliases', 'aliases'],
    ['approvalValidUntil', 'approval_valid_until'],
    ['requirement', 'requirement'],
  ],
  defects: [
    ['title', 'title'],
    ['synonyms', 'synonyms'],
    ['severity', 'severity'],
    ['measure', 'measure'],
    ['category', 'category'],
    ['serviceKeys', 'service_keys'],
    ['quantity', 'quantity'],
    ['note', 'note'],
  ],
  terms: [
    ['term', 'term'],
    ['meaning', 'meaning'],
  ],
  services: [
    ['key', 'key'],
    ['title', 'title'],
    ['unit', 'unit'],
    ['price', 'price_cents'],
    ['condition', 'condition'],
    ['kind', 'kind'],
    ['category', 'category'],
    ['note', 'note'],
  ],
};
const JSON_FIELDS: Record<string, unknown> = { defaults: {}, synonyms: [], aliases: [], serviceKeys: [], condition: {} };
/** Vorgaben für Spalten, die ein Eintrag beim Anlegen nicht nennt */
const FALLBACK: Record<string, unknown> = { quantity: 1, unit: 'Stk', kind: 'repair', approvalValidUntil: null };
const dbValue = (k: string, v: unknown) => {
  if (k in JSON_FIELDS) return JSON.stringify(v ?? JSON_FIELDS[k]);
  if (k === 'price') return Math.round(Number(v ?? 0) * 100);
  if (v === undefined || v === null) return k in FALLBACK ? FALLBACK[k] : '';
  return v;
};

function insertStmt(c: Ctx, kind: CatalogKind, e: Record<string, unknown>, t: number) {
  const cols = COLS[kind];
  return c.env.DB.prepare(
    `INSERT INTO ${TABLE[kind]} (id, tenant_id, ${cols.map(([, col]) => col).join(', ')}, match_key, created_at, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
  ).bind(id(), tid(c), ...cols.map(([k]) => dbValue(k, e[k])), entryKey(kind, e), t, t);
}
function updateStmt(c: Ctx, kind: CatalogKind, rowId: string, e: Record<string, unknown>, t: number) {
  const cols = COLS[kind];
  return c.env.DB.prepare(`UPDATE ${TABLE[kind]} SET ${cols.map(([, col]) => `${col} = ?`).join(', ')}, match_key = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).bind(
    ...cols.map(([k]) => dbValue(k, e[k])),
    entryKey(kind, e),
    t,
    rowId,
    tid(c),
  );
}

async function listKind(c: Ctx, kind: CatalogKind) {
  const order = kind === 'products' ? 'manufacturer, model' : kind === 'defects' ? 'category, title' : kind === 'services' ? 'kind, key' : 'term';
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
    // Neue Workspaces bekommen den Nachtrag (v6 F6) gleich mit
    ...seedExtraStatements(db, tenantId, t),
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

/**
 * Nachtrag der Grundausstattung (v6 F6: typische Mängel für Feuerlöscher, Rauchwarnmelder, Brandschutzklappen) – genau
 * einmal je Workspace, Markierung tenants.catalog_extra_at wie bei der Grundausstattung. Gelöschte kommen nie zurück.
 */
export function seedExtraStatements(db: D1Database, tenantId: string, t = Date.now()) {
  const defects = CATALOG_EXTRA_DEFECTS.map((x) => ({ ...x, synonyms: JSON.stringify(x.synonyms), id: id(), key: entryKey('defects', x) }));
  const j = (k: string) => `json_extract(value, '$.${k}')`;
  return [
    db.prepare('UPDATE tenants SET catalog_extra_at = ?2 WHERE id = ?1 AND catalog_extra_at IS NULL').bind(tenantId, t),
    db
      .prepare(
        `INSERT OR IGNORE INTO catalog_defects (id, tenant_id, title, synonyms, severity, measure, category, match_key, created_at, updated_at)
         SELECT ${j('id')}, ?1, ${j('title')}, ${j('synonyms')}, ${j('severity')}, ${j('measure')}, ${j('category')}, ${j('key')}, ?2, ?2 FROM json_each(?3)
          WHERE EXISTS (SELECT 1 FROM tenants WHERE id = ?1 AND catalog_extra_at = ?2)`,
      )
      .bind(tenantId, t, JSON.stringify(defects)),
  ];
}

/** Bestehende Workspaces bekommen die Grundausstattung (und den Nachtrag) beim ersten Lesen (idempotent). */
export async function ensureCatalog(c: Ctx) {
  const seeded = await c.env.DB.prepare('SELECT catalog_seeded_at AS s, catalog_extra_at AS x FROM tenants WHERE id = ?').bind(tid(c)).first<{ s: number | null; x: number | null }>();
  if (seeded && seeded.s == null) await c.env.DB.batch(seedCatalogStatements(c.env.DB, tid(c), now()));
  else if (seeded && seeded.x == null) await c.env.DB.batch(seedExtraStatements(c.env.DB, tid(c), now()));
}

/** Feldnamen für Fehlermeldungen (v6 D3: fehlende Felder beim Namen nennen). */
const FIELD_LABEL: Record<string, string> = {
  manufacturer: 'Hersteller',
  model: 'Typ',
  title: 'Bezeichnung',
  term: 'Begriff',
  meaning: 'Bedeutung',
  severity: 'Schwere',
  category: 'Art',
  defaults: 'Vorgabewerte',
  synonyms: 'Synonyme',
  aliases: 'Aliasse',
  approvalValidUntil: 'Zulassung gültig bis',
  requirement: 'Anforderung',
  serviceKeys: 'Leistungen',
  quantity: 'Menge',
  key: 'Kürzel',
  unit: 'Einheit',
  price: 'Preis',
  condition: 'Bedingung',
  kind: 'Art der Leistung',
  note: 'Notiz',
};
/** Zod-Fehler eines Eintrags als ein deutscher Satz: alle fehlenden Felder beim Namen, sonst die erste Meldung. */
function itemError(e: z.ZodError) {
  const missing = e.issues
    .filter((i) => (i.code === 'invalid_type' && i.received === 'undefined') || (i.code === 'too_small' && i.type === 'string'))
    .map((i) => String(i.path[0] ?? ''))
    .filter((k, n, all) => k && all.indexOf(k) === n);
  if (missing.length) return `Fehlt: ${missing.map((k) => `${k} (${FIELD_LABEL[k] ?? k})`).join(', ')}`;
  const i = e.issues[0];
  return i ? `${i.path.length ? `${String(i.path[0])}: ` : ''}${i.message}` : 'Ungültig';
}

/** Katalog des Workspaces (für MCP, Vorschläge). */
export async function readCatalog(c: Ctx) {
  await ensureCatalog(c);
  const [products, defects, terms, services] = await Promise.all(KINDS.map((k) => listKind(c, k)));
  return { products: products as CatalogProduct[], defects: defects as CatalogDefect[], terms: terms as CatalogTerm[], services: services as CatalogService[] };
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
  const warnings: { index: number; warning: string }[] = [];
  const valid: Record<string, unknown>[] = [];
  /** vollständige Einträge (mit Vorgaben) zum Anlegen; geändert wird nur, was ein Eintrag nennt */
  const full = new Map<string, Record<string, unknown>>();
  const cats = new Map<string, string[] | null>();
  // Felder aller Arten (für Produkte ohne Art): bekannte Stammdaten-Schlüssel
  let anyFields: string[] | null = null;
  const fieldsOf = async (cat: string) => {
    if (!cats.has(cat)) cats.set(cat, await getCategoryDef(c, cat).then((d) => d.attributes.map((a) => a.key), () => null));
    return cats.get(cat)!;
  };
  for (const [i, item] of raw.items.entries()) {
    // unbekannte Schlüssel auf oberster Ebene (Tippfehler wie „manufactorer“) nicht still verwerfen
    const extra = Object.keys(item).filter((k) => !(k in fields[kind].shape));
    if (extra.length) {
      errors.push({ index: i, error: `Unbekannte Felder: ${extra.join(', ')}. Möglich: ${Object.keys(fields[kind].shape).join(', ')}` });
      continue;
    }
    const p = fields[kind].safeParse(item);
    if (!p.success) {
      errors.push({ index: i, error: itemError(p.error) });
      continue;
    }
    const cat = (p.data as { category?: string }).category;
    const known = cat ? await fieldsOf(cat) : null;
    if (cat && !known) {
      errors.push({ index: i, error: `Unbekannte Elementart „${cat}“` });
      continue;
    }
    // v6 D3: Vorgabewerte nur für Stammdaten, die es bei der Art (bzw. irgendeiner Art) gibt; Zulassung steht in `approval`.
    // Plan v7: dasselbe für die Bedingung einer Leistung
    if (kind === 'products' || kind === 'services') {
      const field = kind === 'products' ? 'defaults' : 'condition';
      const keys = Object.keys(((p.data as Record<string, unknown>)[field] as Record<string, unknown>) ?? {});
      const allowed = known ?? (anyFields ??= [...new Set((await listCategories(c)).flatMap((d) => d.attributes.map((a) => a.key)))]);
      const unknown = keys.filter((k) => !allowed.includes(k));
      if (unknown.length) {
        errors.push({
          index: i,
          error: `Unbekannte Stammdaten in ${field}: ${unknown.join(', ')}. Möglich${cat ? ` für diese Art` : ''}: ${allowed.join(', ') || '–'}`,
        });
        continue;
      }
    }
    const named = Object.fromEntries(Object.entries(p.data as Record<string, unknown>).filter(([k]) => k in item));
    valid.push(named);
    full.set(entryKey(kind, p.data as Record<string, unknown>), p.data as Record<string, unknown>);
  }
  // Plan v7: Katalog-Mängel mit Leistungen, die es (noch) nicht gibt – Hinweis, kein Fehler (Datei lädt Leistungen zuerst)
  if (kind === 'defects') {
    const known = new Set((await listKind(c, 'services')).map((x) => foldText((x as CatalogService).key)));
    raw.items.forEach((item, i) => {
      const keys = Array.isArray(item.serviceKeys) ? (item.serviceKeys as unknown[]).map(String) : [];
      const missing = keys.filter((k) => !known.has(foldText(k)));
      if (missing.length && !errors.some((e) => e.index === i)) warnings.push({ index: i, warning: `Leistung unbekannt: ${missing.join(', ')}` });
    });
  }
  await ensureCatalog(c);
  const existing = (await listKind(c, kind)) as unknown as (Record<string, unknown> & { id: string })[];
  const plan = planCatalogMerge(kind, existing, valid);
  plan.create = plan.create.map((e) => ({ ...(full.get(entryKey(kind, e)) ?? {}), ...e }));
  if (existing.length + plan.create.length > CATALOG_LIMITS[kind])
    throw new HTTPException(400, { message: `Höchstens ${CATALOG_LIMITS[kind]} Einträge je Liste (vorhanden: ${existing.length}, neu: ${plan.create.length})` });
  const result = {
    dryRun: raw.dryRun,
    create: plan.create.map((e) => summary(kind, e)),
    update: plan.update.map((u) => ({ entry: summary(kind, u.after), changes: u.changes })),
    unchanged: plan.unchanged,
    errors,
    warnings,
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
  await assertAttributeKeys(c, kind, b);
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
  await assertAttributeKeys(c, kind, b);
  try {
    await updateStmt(c, kind, old.id, b, now()).run();
  } catch (e) {
    if (isUnique(e)) throw new HTTPException(409, { message: `${LABEL[kind]} gibt es schon` });
    throw e;
  }
  await logActivity(c, 'update', 'catalog', old.id, `${LABEL[kind]} „${summary(kind, b)}“ geändert`);
  const row = await c.env.DB.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND tenant_id = ?`).bind(old.id, tid(c)).first<Row>();
  return c.json(fromRow(kind, row!));
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
  return kind === 'products'
    ? `${s('manufacturer')} ${s('model')}`
    : kind === 'defects'
      ? s('title')
      : kind === 'services'
        ? `${s('key')} ${s('title')}`
        : `${s('term')} = ${s('meaning')}`;
}

/** Vorgabewerte (Produkt) bzw. Bedingung (Leistung) nur mit Stammdaten der Art bzw. irgendeiner Art. */
async function assertAttributeKeys(c: Ctx, kind: CatalogKind, b: Record<string, unknown>) {
  if (kind !== 'products' && kind !== 'services') return;
  const field = kind === 'products' ? 'defaults' : 'condition';
  const keys = Object.keys((b[field] as Record<string, unknown>) ?? {});
  if (!keys.length) return;
  const cat = String(b.category ?? '');
  const allowed = cat ? (await getCategoryDef(c, cat)).attributes.map((a) => a.key) : [...new Set((await listCategories(c)).flatMap((d) => d.attributes.map((a) => a.key)))];
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length) throw new HTTPException(400, { message: `Unbekannte Stammdaten in ${field}: ${unknown.join(', ')}` });
}
