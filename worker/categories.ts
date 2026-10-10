import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { CATEGORIES, CATEGORY_COLORS, type CategoryDef, type Checkpoint, isBuiltin, schedulesOf } from '../shared/catalog';
import { type AppEnv, type Ctx, logActivity, notFound, now, parseJson, requireRole } from './lib';

const tid = (c: Ctx) => c.get('user').tenantId;
const str = (max = 500) => z.string().trim().max(max);

interface CustomRow {
  key: string;
  label: string;
  plural: string;
  prefix: string;
  norm: string;
  interval_months: number;
  checkpoints: string;
  attributes: string;
  maintenance: string;
  color: string;
  base: string | null;
}

const fromRow = (r: CustomRow): CategoryDef => ({
  key: r.key,
  label: r.label,
  plural: r.plural,
  prefix: r.prefix,
  norm: r.norm,
  intervalMonths: r.interval_months,
  checkpoints: parseJson(r.checkpoints, []),
  attributes: parseJson(r.attributes, []),
  maintenance: parseJson(r.maintenance, []),
  schedules: [{ key: 'main', label: 'Prüfung', intervalMonths: r.interval_months, optional: false }],
  color: r.color,
  custom: true,
  base: r.base,
});

/** Kategorie inkl. eigener Typen, aber ohne Vorlagen-Anpassungen. */
export async function getCategoryDef(c: Ctx, key: string): Promise<CategoryDef> {
  if (isBuiltin(key)) return CATEGORIES[key];
  const r = await c.env.DB.prepare('SELECT * FROM custom_categories WHERE tenant_id = ? AND key = ? AND deleted_at IS NULL')
    .bind(tid(c), key)
    .first<CustomRow>();
  if (!r) throw new HTTPException(400, { message: `Unbekannte Elementart „${key}“` });
  return fromRow(r);
}

export interface EffectiveSchedule {
  key: string;
  label: string;
  intervalMonths: number;
  optional: boolean;
  checkpoints: Checkpoint[];
  customized: boolean;
}
export interface EffectiveCategory extends CategoryDef {
  customized: boolean;
  schedulesEffective: EffectiveSchedule[];
}

const overrideKey = (category: string, schedule: string) => (schedule === 'main' ? category : `${category}:${schedule}`);

/** Alle Kategorien des Workspaces mit angepassten Prüfpunkten/Intervallen je Prüfart. */
export async function listCategories(c: Ctx): Promise<EffectiveCategory[]> {
  const [custom, overrides] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM custom_categories WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY label').bind(tid(c)),
    c.env.DB.prepare('SELECT category, checkpoints, interval_months FROM template_overrides WHERE tenant_id = ?').bind(tid(c)),
  ]);
  const ov = new Map((overrides.results as { category: string; checkpoints: string; interval_months: number }[]).map((o) => [o.category, o]));
  const defs = [...Object.values(CATEGORIES), ...(custom.results as unknown as CustomRow[]).map(fromRow)];
  return defs.map((d) => {
    const scheds = schedulesOf(d).map((s) => {
      const o = ov.get(overrideKey(d.key, s.key));
      return {
        key: s.key,
        label: s.label,
        optional: s.optional,
        intervalMonths: o?.interval_months ?? s.intervalMonths,
        checkpoints: o ? parseJson<Checkpoint[]>(o.checkpoints, s.checkpoints ?? []) : (s.checkpoints ?? []),
        customized: !!o,
      };
    });
    const main = scheds.find((s) => s.key === 'main')!;
    return { ...d, intervalMonths: main.intervalMonths, checkpoints: main.checkpoints, customized: scheds.some((s) => s.customized), schedulesEffective: scheds };
  });
}

/** Effektive Prüfart (Prüfpunkte + Intervall) einer Kategorie. */
export async function getSchedule(c: Ctx, category: string, schedule = 'main'): Promise<EffectiveSchedule & { category: CategoryDef }> {
  const def = await getCategoryDef(c, category);
  const base = schedulesOf(def).find((s) => s.key === schedule);
  if (!base) throw new HTTPException(400, { message: `Prüfart „${schedule}“ gibt es für ${def.label} nicht` });
  const o = await c.env.DB.prepare('SELECT checkpoints, interval_months FROM template_overrides WHERE tenant_id = ? AND category = ?')
    .bind(tid(c), overrideKey(category, schedule))
    .first<{ checkpoints: string; interval_months: number }>();
  return {
    key: base.key,
    label: base.label,
    optional: base.optional,
    intervalMonths: o?.interval_months ?? base.intervalMonths,
    checkpoints: o ? parseJson<Checkpoint[]>(o.checkpoints, base.checkpoints ?? []) : (base.checkpoints ?? []),
    customized: !!o,
    category: def,
  };
}

export const categories = new Hono<AppEnv>();

categories.get('/categories', async (c) => c.json(await listCategories(c)));

const checkpointList = z.array(z.object({ id: str(40).min(1), label: str(300).min(2), hint: str(300).optional() })).min(1).max(100);

categories.put('/templates/:category', async (c) => {
  requireRole(c, 'admin');
  const category = c.req.param('category');
  const schedule = c.req.query('schedule') ?? 'main';
  const sched = await getSchedule(c, category, schedule);
  const body = z.object({ intervalMonths: z.number().int().min(1).max(240), checkpoints: checkpointList }).parse(await c.req.json());
  if (sched.category.custom && schedule === 'main') {
    // Eigene Typen: Vorlage direkt am Typ speichern
    await c.env.DB.prepare('UPDATE custom_categories SET checkpoints = ?, interval_months = ? WHERE tenant_id = ? AND key = ?')
      .bind(JSON.stringify(body.checkpoints), body.intervalMonths, tid(c), category)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO template_overrides (tenant_id, category, checkpoints, interval_months, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT (tenant_id, category) DO UPDATE SET checkpoints = excluded.checkpoints, interval_months = excluded.interval_months, updated_at = excluded.updated_at`,
    )
      .bind(tid(c), overrideKey(category, schedule), JSON.stringify(body.checkpoints), body.intervalMonths, now())
      .run();
  }
  await logActivity(c, 'update', 'template', category, `Prüfvorlage „${sched.category.label} – ${sched.label}“ angepasst`);
  return c.json({ ok: true });
});

categories.delete('/templates/:category', async (c) => {
  requireRole(c, 'admin');
  const schedule = c.req.query('schedule') ?? 'main';
  await c.env.DB.prepare('DELETE FROM template_overrides WHERE tenant_id = ? AND category = ?')
    .bind(tid(c), overrideKey(c.req.param('category'), schedule))
    .run();
  return c.json({ ok: true });
});

const customBody = z.object({
  label: str(80).min(2, 'Bezeichnung fehlt'),
  plural: str(80).min(2, 'Mehrzahl fehlt'),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,5}$/, 'Präfix: 2–5 Buchstaben/Ziffern'),
  norm: str(120).default(''),
  intervalMonths: z.number().int().min(1).max(240),
  checkpoints: checkpointList,
  attributes: z
    .array(
      z.object({
        key: z.string().regex(/^[a-zA-Z0-9_]{1,40}$/),
        label: str(80).min(1),
        type: z.enum(['text', 'number', 'date', 'select', 'boolean']).default('text'),
        options: z.array(str(80)).max(30).optional(),
      }),
    )
    .max(30)
    .default([]),
  maintenance: z.array(z.object({ key: z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), label: str(80).min(1) })).max(30).default([]),
  color: z.enum(CATEGORY_COLORS).default('slate'),
  base: z.string().max(40).nullable().default(null),
});

async function assertPrefixFree(c: Ctx, prefix: string, exceptKey?: string) {
  const builtin = Object.values(CATEGORIES).some((d) => d.prefix === prefix);
  const custom = await c.env.DB.prepare('SELECT 1 FROM custom_categories WHERE tenant_id = ? AND prefix = ? AND key != ? AND deleted_at IS NULL')
    .bind(tid(c), prefix, exceptKey ?? '')
    .first();
  if (builtin || custom) throw new HTTPException(409, { message: `Präfix ${prefix} ist schon vergeben` });
}

categories.post('/categories', async (c) => {
  requireRole(c, 'admin');
  const b = customBody.parse(await c.req.json());
  await assertPrefixFree(c, b.prefix);
  const key = `c_${b.prefix.toLowerCase()}_${Math.random().toString(36).slice(2, 6)}`;
  await c.env.DB.prepare(
    `INSERT INTO custom_categories (tenant_id, key, label, plural, prefix, norm, interval_months, checkpoints, attributes, maintenance, color, base, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(tid(c), key, b.label, b.plural, b.prefix, b.norm, b.intervalMonths, JSON.stringify(b.checkpoints), JSON.stringify(b.attributes), JSON.stringify(b.maintenance), b.color, b.base, now())
    .run();
  await logActivity(c, 'create', 'category', key, `Elementart „${b.label}“ angelegt`);
  return c.json({ key });
});

categories.patch('/categories/:key', async (c) => {
  requireRole(c, 'admin');
  const key = c.req.param('key');
  if (isBuiltin(key)) throw new HTTPException(400, { message: 'Eingebaute Arten werden über die Prüfvorlagen angepasst' });
  const b = customBody.parse(await c.req.json());
  await assertPrefixFree(c, b.prefix, key);
  const r = await c.env.DB.prepare(
    `UPDATE custom_categories SET label=?, plural=?, prefix=?, norm=?, interval_months=?, checkpoints=?, attributes=?, maintenance=?, color=?
      WHERE tenant_id = ? AND key = ? AND deleted_at IS NULL`,
  )
    .bind(b.label, b.plural, b.prefix, b.norm, b.intervalMonths, JSON.stringify(b.checkpoints), JSON.stringify(b.attributes), JSON.stringify(b.maintenance), b.color, tid(c), key)
    .run();
  if (!r.meta.changes) notFound('Elementart');
  return c.json({ ok: true });
});

categories.delete('/categories/:key', async (c) => {
  requireRole(c, 'admin');
  const key = c.req.param('key');
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM assets WHERE tenant_id = ? AND category = ? AND deleted_at IS NULL')
    .bind(tid(c), key)
    .first<number>('n');
  if (used) throw new HTTPException(409, { message: `Noch ${used} Elemente dieser Art vorhanden` });
  await c.env.DB.prepare('UPDATE custom_categories SET deleted_at = ? WHERE tenant_id = ? AND key = ?').bind(now(), tid(c), key).run();
  return c.json({ ok: true });
});
