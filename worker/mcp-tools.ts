// Werkzeuge des MCP-Servers – nach Absicht geschnitten, nicht nach Tabellen (docs/plan/v4.md, 2.1 und 8.3).
// Jedes Werkzeug ruft die normale API mit dem Schlüssel/Token des Aufrufs auf: Rollen, Lese-/Schreibrecht,
// Zugriffsbereich und „darf anlegen“ gelten dadurch unverändert. Antworten sind knapp und nennen Codes und
// Namen statt interner IDs – IDs nur dort, wo ein Folgeaufruf sie braucht.
import { SEVERITIES, type Severity } from '../shared/catalog';
import { type Answer, computeResult } from '../shared/logic';
import { matchCheckpoint, similarity, suggestMeasure, suggestSeverity } from '../shared/smart';

export type Json = Record<string, unknown>;
export type Call = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown };
/** Antwort der API als JSON; Fehler werfen ApiError. */
export type Api = (c: Call) => Promise<unknown>;
/** Rohdaten (z. B. Fotos) – Fehler werfen ApiError. */
export type ApiRaw = (path: string) => Promise<{ body: ArrayBuffer; type: string }>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Fehler, den das Modell lesen soll – mit Hinweis, was stattdessen geht. */
export class ToolError extends Error {}

/** MCP-Inhalt (Text oder Bild). */
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
/** Werkzeuge liefern ein Objekt (wird als JSON-Text und structuredContent ausgegeben), reinen Text oder fertige Inhalte. */
export type ToolResult = Json | string | { content: Content[] };

interface Ctx {
  api: Api;
  raw: ApiRaw;
  /** je Aufruf zwischengespeichert */
  categories: () => Promise<CategoryInfo[]>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  readOnly: boolean;
  destructive?: boolean;
  run: (a: Json, x: Ctx) => Promise<ToolResult>;
}

interface CategoryInfo {
  key: string;
  label: string;
  plural: string;
  norm: string;
  intervalMonths: number;
  checkpoints: { id: string; label: string }[];
  attributes: { key: string; label: string; type?: string }[];
  maintenance: { key: string; label: string }[];
  schedulesEffective?: { key: string; label: string; checkpoints: { id: string; label: string }[] }[];
}

// ---------- Schema-Bausteine ----------
const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });
const int = (description: string, minimum: number, maximum: number) => ({ type: 'integer', description, minimum, maximum });
const bool = (description: string) => ({ type: 'boolean', description });
const arr = (items: Json, description: string, maxItems = 50) => ({ type: 'array', items, description, maxItems });
const obj = (properties: Json, required: string[] = [], description?: string) => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});
const SEVERITY = str('Schwere: low = optisch/gering, medium = Funktion eingeschränkt, high = Schutzfunktion gefährdet, critical = Gefahr im Verzug', {
  enum: ['low', 'medium', 'high', 'critical'],
});

// ---------- Hilfen ----------
const enc = encodeURIComponent;
const TZ = 'Europe/Berlin';
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
/** Datum als JJJJ-MM-TT (Zeitzone Berlin) */
const day = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? dayFmt.format(ms) : null);
const dayTime = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? timeFmt.format(ms) : null);
/** ISO-Datum/-Zeit oder Zahl → Millisekunden */
function toMs(v: unknown, field: string): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new ToolError(`${field}: „${String(v)}“ ist kein Datum. Bitte ISO angeben, z. B. 2026-11-30 oder 2026-11-30T14:00.`);
  return t;
}
const sev = (s: unknown) => SEVERITIES[s as Severity] ?? String(s ?? '');
const RESULT: Record<string, string> = { ok: 'ohne Mängel', defects: 'mit Mängeln', critical: 'kritisch', not_inspectable: 'nicht prüfbar' };
const TASK_STATUS: Record<string, string> = { open: 'offen', in_progress: 'in Arbeit', done: 'erledigt', cancelled: 'abgebrochen' };
const PRIO: Record<string, string> = { low: 'niedrig', medium: 'mittel', high: 'hoch' };
const s = (v: unknown) => (v == null ? '' : String(v));
const lc = (v: unknown) => s(v).trim().toLowerCase();
/** Leere Felder weglassen – kürzere Antworten */
function compact<T extends Json>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))) as T;
}
const clamp = (v: unknown, min: number, max: number, def: number) => Math.min(max, Math.max(min, Number.isFinite(Number(v)) && v != null ? Math.round(Number(v)) : def));
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : []);

async function catLabel(x: Ctx, key: unknown) {
  return (await x.categories()).find((c) => c.key === key)?.label ?? s(key);
}

/** Elementart aus Schlüssel oder Bezeichnung („Feuerlöscher“, „feuerlöscher“, „extinguisher“). */
async function resolveCategory(x: Ctx, v: unknown) {
  const cats = await x.categories();
  const q = lc(v);
  const hit =
    cats.find((c) => c.key === q) ??
    cats.find((c) => lc(c.label) === q || lc(c.plural) === q) ??
    cats.find((c) => lc(c.label).includes(q) || q.includes(lc(c.label)) || lc(c.plural).includes(q));
  if (!hit) throw new ToolError(`Elementart „${s(v)}“ unbekannt. Möglich: ${cats.map((c) => `${c.key} (${c.label})`).join(', ')}.`);
  return hit;
}

/** Element per Code oder Etikett → ID */
async function assetId(x: Ctx, code: unknown): Promise<string> {
  const c = s(code).trim();
  if (!c) throw new ToolError('Element-Code fehlt, z. B. „FST-7K2M“. Codes liefert search oder list(what: "assets").');
  try {
    return ((await x.api({ method: 'GET', path: `/assets/by-code/${enc(c)}` })) as { id: string }).id;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new ToolError(`Kein Element mit Code „${c}“. Mit search nach Standort, Art oder Code-Teil suchen.`);
    throw e;
  }
}

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  assets: number;
  overdue: number;
  soon: number;
  never: number;
  openDefects: number;
  nextWalkAt: number | null;
}
interface BuildingRow {
  id: string;
  name: string;
  propertyId: string;
}

function pickOne<T extends { id: string; name: string }>(rows: T[], q: unknown, what: string, hint: string): T {
  const v = lc(q);
  if (!v) throw new ToolError(`${what} fehlt. ${hint}`);
  const exact = rows.filter((r) => r.id === s(q) || lc(r.name) === v);
  if (exact.length === 1) return exact[0];
  const part = exact.length ? exact : rows.filter((r) => lc(r.name).includes(v));
  if (part.length === 1) return part[0];
  if (!part.length) throw new ToolError(`${what} „${s(q)}“ nicht gefunden. ${hint}`);
  throw new ToolError(`${what} „${s(q)}“ ist mehrdeutig: ${part.slice(0, 10).map((r) => r.name).join(', ')}. Bitte genauer angeben.`);
}

const properties = (x: Ctx) => x.api({ method: 'GET', path: '/properties' }) as Promise<PropertyRow[]>;
async function resolveProperty(x: Ctx, q: unknown) {
  return pickOne(await properties(x), q, 'Objekt', 'Objekte liefert search(type: "properties").');
}

/** Gebäude per Name oder ID; ohne Treffer auch per Objektname, wenn das Objekt genau ein Gebäude hat. */
async function resolveBuilding(x: Ctx, q: unknown, propertyHint?: unknown) {
  const [bs, ps] = await Promise.all([x.api({ method: 'GET', path: '/buildings' }) as Promise<BuildingRow[]>, properties(x)]);
  const pName = new Map(ps.map((p) => [p.id, p.name]));
  if (!lc(q)) throw new ToolError('Gebäude fehlt (`building`), z. B. „Haupthaus“. Gebäude stehen in get(kind: "property").');
  let pool = bs;
  if (propertyHint) {
    const p = pickOne(ps, propertyHint, 'Objekt', 'Objekte liefert search(type: "properties").');
    pool = bs.filter((b) => b.propertyId === p.id);
  }
  const v = lc(q);
  const byName = pool.filter((b) => b.id === s(q) || lc(b.name) === v || lc(b.name).includes(v) || `${lc(pName.get(b.propertyId))} ${lc(b.name)}`.includes(v));
  if (byName.length === 1) return { ...byName[0], propertyName: pName.get(byName[0].propertyId) ?? '' };
  const exact = byName.filter((b) => lc(b.name) === v || b.id === s(q));
  if (exact.length === 1) return { ...exact[0], propertyName: pName.get(exact[0].propertyId) ?? '' };
  if (!byName.length) {
    const viaProp = ps.filter((p) => lc(p.name).includes(v));
    const only = viaProp.length === 1 ? pool.filter((b) => b.propertyId === viaProp[0].id) : [];
    if (only.length === 1) return { ...only[0], propertyName: viaProp[0].name };
    if (only.length > 1) throw new ToolError(`Objekt „${viaProp[0].name}“ hat mehrere Gebäude: ${only.map((b) => b.name).join(', ')}. Bitte eines nennen.`);
    throw new ToolError(`Gebäude „${s(q)}“ nicht gefunden. Gebäude stehen in get(kind: "property").`);
  }
  throw new ToolError(`Gebäude „${s(q)}“ ist mehrdeutig: ${byName.slice(0, 10).map((b) => `${b.name} (${pName.get(b.propertyId)})`).join(', ')}. Bitte genauer angeben.`);
}

/** Verweis auf ein Bild für get_photo */
const photoRef = (key: unknown) => (key ? `foto:${s(key)}` : null);
const planRef = (id: unknown) => (id ? `plan:${s(id)}` : null);

// ---------- „Jetzt“-Liste ----------
/** Die „Jetzt“-Warteschlange der App (GET /now): je Zeile eine Aktion, nach Dringlichkeit. */
async function nowQueue(x: Ctx, max = 12): Promise<Json[]> {
  const n = (await x.api({ method: 'GET', path: '/now' })) as { items?: Json[] };
  return (n.items ?? []).slice(0, max);
}

// ---------- Darstellung ----------
async function assetLine(x: Ctx, a: Json) {
  return compact({
    code: a.code,
    art: await catLabel(x, a.category),
    location: a.location,
    floor: a.floor,
    building: a.buildingName,
    property: a.propertyName,
    nextDue: day(a.nextDueAt) ?? 'nie geprüft',
    last: a.lastResult ? `${day(a.lastInspectedAt)} ${RESULT[s(a.lastResult)] ?? a.lastResult}` : null,
    openDefects: Number(a.openDefects) || null,
  });
}
const defectLine = (d: Json) =>
  compact({
    defectId: d.id,
    title: d.title,
    severity: sev(d.severity),
    status: d.status === 'resolved' ? 'behoben' : 'offen',
    at: d.code ? `${d.code}${d.location ? ` (${d.location})` : ''}` : 'Objekt/Begehung',
    property: d.propertyName,
    since: day(d.createdAt),
    task: d.taskStatus ? TASK_STATUS[s(d.taskStatus)] : d.status === 'open' ? 'keine Aufgabe' : null,
  });
const taskLine = (t: Json, n = Date.now()) =>
  compact({
    taskId: t.id,
    title: t.title,
    status: TASK_STATUS[s(t.status)] ?? t.status,
    priority: PRIO[s(t.priority)] ?? t.priority,
    due: day(t.dueAt),
    overdue: (t.status === 'open' || t.status === 'in_progress') && typeof t.dueAt === 'number' && t.dueAt < n ? true : null,
    assignee: t.assigneeName ?? t.subcontractorName ?? 'niemand',
    element: t.assetCode,
    property: t.propertyName ?? t.buildingName,
  });

// ---------- Prüfung ausfüllen (inspect) ----------
interface Draft {
  id: string;
  status: string;
  assetId: string;
  kinds: string[];
  kindLabels: string[];
  checkpoints: { id: string; label: string }[];
  answers: Record<string, Answer>;
  defects: Json[];
  maintenance: string[];
  notes: string;
  notInspectable: boolean;
  resultOverride: string | null;
  resultReason: string;
  resolvedDefects: string[];
  knownDefects: { id: string; checkpointId: string | null; title: string; note: string; measure: string; severity: Severity; createdAt: number }[];
  photos: Json[];
  signerName: string;
  signature: string | null;
  readyAt: number | null;
  asset: { code: string; category: string; location: string };
}

/** Prüfpunkt aus Nummer („3“), ID („p3“), Bezeichnungsteil oder – als Rückfall – aus dem Text. */
function findCheckpoint(cps: { id: string; label: string }[], ref: unknown, text = ''): string | null {
  const r = s(ref).trim();
  if (r) {
    if (/^\d+$/.test(r)) return cps[Number(r) - 1]?.id ?? null;
    const byId = cps.find((c) => c.id === r);
    if (byId) return byId.id;
    const byLabel = cps.find((c) => lc(c.label).includes(lc(r)));
    if (byLabel) return byLabel.id;
    return matchCheckpoint(r, cps);
  }
  return text ? matchCheckpoint(text, cps) : null;
}

const NEW_STRUCTURE_NOTE = 'neue Objekte und Gebäude anlegen darf dieser Zugang nicht – dafür braucht es einen Schreib-Schlüssel einer Admin- oder Inhaber-Person (oder in der App: Objekte → Neu).';
const NEW_STRUCTURE_HINT = (what: string) =>
  `${what} konnte nicht angelegt werden: Neue Objekte und Gebäude legt nur ein Schreib-Schlüssel einer Admin- oder Inhaber-Person an (oder ein Admin in der App: Objekte → Neu). Danach setup erneut aufrufen – Elemente legt es dann an.`;

/**
 * Darf dieser Zugang neue Objekte/Gebäude anlegen (Befund #33)? Prüft ohne zu schreiben: Die Route prüft das
 * Recht vor dem Inhalt – ein leerer Name ergibt mit Recht 400, ohne Recht 403.
 */
async function canCreateStructure(x: Ctx) {
  try {
    await x.api({ method: 'POST', path: '/properties', body: { name: '' } });
    return true; // nicht erreichbar (leerer Name wird abgelehnt) – zur Sicherheit trotzdem „ja“
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return false;
    if (e instanceof ApiError && e.status === 400) return true;
    throw e;
  }
}

// ---------- Werkzeuge ----------
export const TOOLS: Tool[] = [
  {
    name: 'briefing',
    title: 'Lagebild',
    description:
      'Die Lage in einem Aufruf – der beste Einstieg ins Gespräch („Was steht heute an?“). Liefert Kennzahlen (überfällig, bald fällig, nie geprüft, offene und kritische Mängel, offene Aufgaben), die „Jetzt“-Liste (höchstens 12 Dinge, die eine Entscheidung oder Handlung brauchen, dringendstes zuerst), wie viele Prüfungen in der App auf die Unterschrift warten, und was der Autopilot seit `since` getan hat (Standard: letzte 7 Tage). Nur lesend.',
    inputSchema: obj({
      since: str('Autopilot-Protokoll ab diesem Zeitpunkt (ISO), z. B. das Datum des letzten Briefings: „2026-11-10“ oder „2026-11-10T07:30“'),
    }),
    readOnly: true,
    run: async (a, x) => {
      const since = toMs(a.since, 'since') ?? Date.now() - 7 * 86_400_000;
      const [dash, now, log, ready] = await Promise.all([
        x.api({ method: 'GET', path: '/dashboard' }) as Promise<{ counts: Json; tasks: Json[] }>,
        nowQueue(x),
        x.api({ method: 'GET', path: '/automation/log?limit=200' }) as Promise<Json[]>,
        x.api({ method: 'GET', path: '/inspections?status=ready' }).catch(() => []) as Promise<Json[]>,
      ]);
      const c = dash.counts;
      const entries = log.filter((e) => Number(e.at) >= since);
      return {
        asOf: dayTime(Date.now()),
        counts: compact({
          properties: c.properties,
          elements: c.assets,
          overdue: c.overdue,
          dueWithin30Days: c.soon,
          neverInspected: c.never,
          notInspectable: c.notInspectable,
          openDefects: Number(c.openDefects ?? 0) + Number(c.openWalkDefects ?? 0),
          criticalDefects: c.criticalDefects,
          inspectionsLast30Days: c.inspections30d,
          drafts: c.drafts,
          walkthroughsDue: c.walkDue,
        }),
        readyToSign: ready.length ? `${ready.length} ${ready.length === 1 ? 'Prüfung wartet' : 'Prüfungen warten'} in der App auf die Unterschrift` : 0,
        now,
        autopilot: {
          since: dayTime(since),
          entries: entries.slice(0, 30).map((e) => compact({ at: dayTime(e.at), step: e.title, summary: e.summary, undone: e.undoneAt ? true : null, undoEntry: e.undoable ? e.id : null })),
          ...(entries.length > 30 ? { more: entries.length - 30 } : {}),
        },
      };
    },
  },
  {
    name: 'search',
    title: 'Suchen',
    description:
      'Suche über Elemente, Objekte, Gebäude, Mängel und Aufgaben (Code, Standort, Hersteller, Etikett, Titel). Ohne `query` und mit `type: "properties"` alle Objekte mit Prüfstatus; mit `type: "categories"` alle Elementarten mit Norm, Intervall und Prüfpunkten. Filter: `status` (Mängel/Aufgaben), `category` (Art, z. B. „Feuerlöscher“ oder extinguisher), `property` (Objektname). Beispiele: {query: "Treppenhaus Nord"}, {query: "Dichtung", type: "defects"}, {type: "properties"}.',
    inputSchema: obj({
      query: str('Suchbegriff (mind. 2 Zeichen), z. B. „FST-7K“, „Keller“, „Hansen“'),
      type: str('Worin suchen (Standard all)', { enum: ['all', 'assets', 'properties', 'buildings', 'defects', 'tasks', 'categories'] }),
      status: str('Mängel: open|resolved|all, Aufgaben: open|in_progress|done|cancelled|all (Standard: offen)', { enum: ['open', 'in_progress', 'resolved', 'done', 'cancelled', 'all'] }),
      category: str('Elementart (Schlüssel oder Bezeichnung)'),
      property: str('nur in diesem Objekt (Name)'),
    }),
    readOnly: true,
    run: async (a, x) => {
      const type = s(a.type) || 'all';
      const q = lc(a.query);
      if (type === 'categories') {
        const cats = await x.categories();
        return {
          categories: cats
            .filter((c) => !q || lc(c.label).includes(q) || c.key.includes(q))
            .map((c) => compact({ key: c.key, label: c.label, norm: c.norm, everyMonths: c.intervalMonths, checkpoints: c.checkpoints.length, fields: c.attributes.map((f) => f.key).join(', ') })),
        };
      }
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      const cat = a.category ? await resolveCategory(x, a.category) : null;
      if (type === 'properties' && q.length < 2) {
        return {
          properties: (await properties(x)).map((p) =>
            compact({ name: p.name, address: p.address, elements: p.assets, overdue: p.overdue, dueSoon: p.soon, neverInspected: p.never, openDefects: p.openDefects, nextWalkthrough: day(p.nextWalkAt) }),
          ),
        };
      }
      if (q.length < 2 && !cat && !prop) throw new ToolError('Suchbegriff mit mindestens 2 Zeichen angeben – oder Filter `category`/`property`, oder type "properties"/"categories" für Übersichten.');
      const out: Json = {};
      const want = (t: string) => type === 'all' || type === t;
      if (want('assets') || want('properties') || want('buildings')) {
        if (q.length >= 2 && !cat && !prop) {
          const r = (await x.api({ method: 'GET', path: `/search?q=${enc(q)}` })) as { properties: Json[]; buildings: Json[]; assets: Json[] };
          if (want('properties') && r.properties.length) out.properties = r.properties.map((p) => compact({ name: p.name, address: p.address }));
          if (want('buildings') && r.buildings.length) out.buildings = r.buildings.map((b) => ({ name: b.name, property: b.propertyName }));
          if (want('assets') && r.assets.length) out.assets = await Promise.all(r.assets.map((e) => assetLine(x, { ...e, propertyName: e.propertyName, buildingName: e.buildingName })));
        } else if (want('assets')) {
          const qs = new URLSearchParams();
          if (q.length >= 2) qs.set('q', q);
          if (cat) qs.set('category', cat.key);
          if (prop) qs.set('propertyId', prop.id);
          const rows = (await x.api({ method: 'GET', path: `/assets?${qs}` })) as Json[];
          out.assets = await Promise.all(rows.slice(0, 50).map((e) => assetLine(x, e)));
          if (rows.length > 50) out.moreAssets = rows.length - 50;
        }
      }
      if (want('defects')) {
        const st = ['resolved', 'all'].includes(s(a.status)) ? s(a.status) : 'open';
        const rows = ((await x.api({ method: 'GET', path: `/defects?status=${st}` })) as Json[]).filter(
          (d) =>
            (!q || `${lc(d.title)} ${lc(d.note)} ${lc(d.code)} ${lc(d.location)}`.includes(q)) && (!prop || d.propertyId === prop.id) && (!cat || d.category === cat.key),
        );
        if (rows.length || type === 'defects') out.defects = rows.slice(0, 30).map(defectLine);
        if (rows.length > 30) out.moreDefects = rows.length - 30;
      }
      if (want('tasks')) {
        const st = s(a.status);
        const rows = ((await x.api({ method: 'GET', path: '/tasks' })) as Json[]).filter(
          (t) =>
            (st === 'all' ? true : ['open', 'in_progress', 'done', 'cancelled'].includes(st) ? t.status === st : t.status === 'open' || t.status === 'in_progress') &&
            (!q || `${lc(t.title)} ${lc(t.description)} ${lc(t.assetCode)}`.includes(q)) &&
            (!prop || t.propertyId === prop.id),
        );
        if (rows.length || type === 'tasks') out.tasks = rows.slice(0, 30).map((t) => taskLine(t));
        if (rows.length > 30) out.moreTasks = rows.length - 30;
      }
      if (!Object.keys(out).length) return { found: 0, hint: 'Nichts gefunden. Kürzeren Begriff oder Code-Teil versuchen, oder list(what: "assets", due: "overdue").' };
      return out;
    },
  },
  {
    name: 'list',
    title: 'Auflisten',
    description:
      'Listen mit Filtern. `what`: assets (Elemente mit Fälligkeit), defects (Mängel), tasks (Aufgaben), inspections (Prüfungen; status "ready" = wartet auf Unterschrift), walkthroughs (Begehungen). Filter je nach Liste: `due` (assets: overdue|soon|never|defects|new|not_inspectable), `status`, `severity`, `category`, `property`, `building`, `from`/`to` (ISO, für inspections), `limit` (Standard 50). Beispiele: {what: "assets", due: "overdue", property: "Rathaus"}, {what: "defects", severity: "critical"}, {what: "tasks", status: "open"}.',
    inputSchema: obj(
      {
        what: str('Welche Liste', { enum: ['assets', 'defects', 'tasks', 'inspections', 'walkthroughs'] }),
        due: str('nur Elemente: overdue = überfällig, soon = in 30 Tagen fällig, never = nie geprüft, defects = mit offenen Mängeln, new = in 30 Tagen angelegt, not_inspectable = zuletzt nicht prüfbar', {
          enum: ['overdue', 'soon', 'never', 'defects', 'new', 'not_inspectable'],
        }),
        status: str('Mängel: open|resolved|all; Aufgaben: open|in_progress|done|cancelled|active|all (Standard active = offen + in Arbeit); Prüfungen: submitted|draft|ready', {
          enum: ['open', 'resolved', 'all', 'in_progress', 'done', 'cancelled', 'active', 'submitted', 'draft', 'ready'],
        }),
        severity: SEVERITY,
        category: str('Elementart (Schlüssel oder Bezeichnung)'),
        property: str('Objektname'),
        building: str('Gebäudename (nur Elemente)'),
        from: str('ab Datum (ISO), nur inspections'),
        to: str('bis Datum (ISO), nur inspections'),
        limit: int('höchstens so viele Einträge (Standard 50)', 1, 200),
      },
      ['what'],
    ),
    readOnly: true,
    run: async (a, x) => {
      const limit = clamp(a.limit, 1, 200, 50);
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      const cat = a.category ? await resolveCategory(x, a.category) : null;
      const cut = (rows: Json[], key: string) => ({ total: rows.length, [key]: rows.slice(0, limit), ...(rows.length > limit ? { hint: `${rows.length - limit} weitere – Filter oder limit nutzen` } : {}) });
      switch (a.what) {
        case 'assets': {
          const b = a.building ? await resolveBuilding(x, a.building, a.property) : null;
          const qs = new URLSearchParams();
          if (a.due) qs.set('due', s(a.due));
          if (cat) qs.set('category', cat.key);
          if (prop) qs.set('propertyId', prop.id);
          if (b) qs.set('buildingId', b.id);
          const rows = (await x.api({ method: 'GET', path: `/assets?${qs}` })) as Json[];
          return cut(await Promise.all(rows.slice(0, limit).map((r) => assetLine(x, r))).then((l) => [...l, ...rows.slice(limit)] as Json[]), 'assets');
        }
        case 'defects': {
          const st = ['resolved', 'all'].includes(s(a.status)) ? s(a.status) : 'open';
          const rows = ((await x.api({ method: 'GET', path: `/defects?status=${st}` })) as Json[]).filter(
            (d) => (!prop || d.propertyId === prop.id) && (!a.severity || d.severity === a.severity) && (!cat || d.category === cat.key),
          );
          return cut(rows.map(defectLine), 'defects');
        }
        case 'tasks': {
          const st = s(a.status) || 'active';
          const rows = ((await x.api({ method: 'GET', path: '/tasks' })) as Json[]).filter(
            (t) => (st === 'all' ? true : st === 'active' ? t.status === 'open' || t.status === 'in_progress' : t.status === st) && (!prop || t.propertyId === prop.id),
          );
          return cut(rows.map((t) => taskLine(t)), 'tasks');
        }
        case 'inspections': {
          const qs = new URLSearchParams();
          if (['submitted', 'draft', 'ready'].includes(s(a.status))) qs.set('status', s(a.status));
          if (prop) qs.set('propertyId', prop.id);
          if (cat) qs.set('category', cat.key);
          const from = toMs(a.from, 'from');
          const to = toMs(a.to, 'to');
          if (from) qs.set('from', String(from));
          if (to) qs.set('to', String(to));
          const rows = (await x.api({ method: 'GET', path: `/inspections?${qs}` })) as Json[];
          return cut(
            await Promise.all(
              rows.map(async (i) =>
                compact({
                  inspectionId: i.id,
                  element: `${s(i.code)}${i.location ? ` (${i.location})` : ''}`,
                  art: await catLabel(x, i.category),
                  property: i.propertyName,
                  date: day(i.inspectedAt ?? i.createdAt),
                  status: i.status === 'draft' ? (i.readyAt ? 'wartet auf Unterschrift' : 'Entwurf') : 'abgeschlossen',
                  result: i.result ? RESULT[s(i.result)] : null,
                  followUp: i.purpose === 'follow_up' ? true : null,
                  inspector: i.inspector,
                }),
              ),
            ),
            'inspections',
          );
        }
        case 'walkthroughs': {
          const rows = ((await x.api({ method: 'GET', path: '/walkthroughs' })) as Json[]).filter((w) => !prop || w.propertyId === prop.id);
          return cut(
            rows.map((w) =>
              compact({
                walkthroughId: w.id,
                property: w.propertyName,
                building: w.buildingName,
                date: day(w.inspectedAt ?? w.createdAt),
                status: w.status === 'draft' ? 'Entwurf' : 'abgeschlossen',
                result: w.result,
                openFindings: Number(w.openDefects) || null,
                nextDue: day(w.nextDueAt),
                inspector: w.inspector,
              }),
            ),
            'walkthroughs',
          );
        }
        default:
          throw new ToolError('`what` muss assets, defects, tasks, inspections oder walkthroughs sein.');
      }
    },
  },
  {
    name: 'get',
    title: 'Abrufen',
    description:
      'Ein Ding vollständig, mit Verlauf und Foto-Verweisen. `kind` + `ref`: asset (ref = Code oder Etikett, z. B. „FST-7K2M“), property (Objektname), defect (defectId), task (taskId), inspection (inspectionId), walkthrough (walkthroughId). Foto- und Grundriss-Verweise (`foto:…`, `plan:…`) kann get_photo als Bild laden – z. B. um ein Typenschild zu lesen.',
    inputSchema: obj(
      {
        kind: str('Art', { enum: ['asset', 'property', 'defect', 'task', 'inspection', 'walkthrough'] }),
        ref: str('Code (asset), Name (property) oder ID (aus list/search/briefing)'),
      },
      ['kind', 'ref'],
    ),
    readOnly: true,
    run: async (a, x) => {
      const ref = s(a.ref).trim();
      const notFound = (what: string, hint: string) => (e: unknown) => {
        if (e instanceof ApiError && e.status === 404) throw new ToolError(`${what} „${ref}“ nicht gefunden. ${hint}`);
        throw e;
      };
      switch (a.kind) {
        case 'asset': {
          const id = await assetId(x, ref);
          const r = (await x.api({ method: 'GET', path: `/assets/${enc(id)}` })) as Json;
          const cat = (await x.categories()).find((c) => c.key === r.category);
          const attrs = (r.attributes ?? {}) as Json;
          const files = list(r.attachments);
          return compact({
            ...(await assetLine(x, r)),
            norm: cat?.norm,
            manufacturer: r.manufacturer,
            model: r.model,
            label: r.labelCode,
            data: compact(Object.fromEntries((cat?.attributes ?? []).map((f) => [f.label, attrs[f.key] ?? null]))),
            inspections: list(r.inspections)
              .filter((i) => !i.supersededAt)
              .slice(0, 10)
              .map((i) => compact({ inspectionId: i.id, date: day(i.inspectedAt ?? i.createdAt), status: i.status === 'draft' ? 'Entwurf' : null, result: i.result ? RESULT[s(i.result)] : null, inspector: i.inspector })),
            openDefects: list(r.defects)
              .filter((d) => d.status === 'open' && !d.hiddenAt)
              .map((d) => compact({ defectId: d.id, title: d.title, severity: sev(d.severity), since: day(d.createdAt), photo: photoRef(d.photoKey) })),
            resolvedDefects: list(r.defects).filter((d) => d.status === 'resolved').length || null,
            photos: files
              .filter((f) => /^image\//.test(s(f.contentType)))
              .slice(0, 20)
              .map((f) => compact({ photo: photoRef(f.fileKey), caption: f.caption || f.name, date: day(f.createdAt) })),
            floorPlan: r.floorPlan ? compact({ name: (r.floorPlan as Json).name, plan: planRef((r.floorPlan as Json).id), marker: r.markerX != null ? `x ${r.markerX}, y ${r.markerY}` : null }) : null,
          });
        }
        case 'property': {
          const p = await resolveProperty(x, ref);
          const r = (await x.api({ method: 'GET', path: `/properties/${enc(p.id)}` })) as Json;
          const assets = list(r.assets);
          const byCat: Record<string, number> = {};
          for (const e of assets) {
            const l = await catLabel(x, e.category);
            byCat[l] = (byCat[l] ?? 0) + 1;
          }
          return compact({
            name: r.name,
            address: r.address,
            contact: [r.contactName, r.contactPhone, r.contactEmail].filter(Boolean).join(', '),
            status: compact({ elements: p.assets, overdue: p.overdue, dueSoon: p.soon, neverInspected: p.never, openDefects: p.openDefects, nextWalkthrough: day(p.nextWalkAt) }),
            buildings: list(r.buildings).map((b) => compact({ name: b.name, elements: assets.filter((e) => e.buildingId === b.id).length })),
            elementsByArt: byCat,
            floorPlans: list(r.floorPlans).map((f) => compact({ name: f.name, building: list(r.buildings).find((b) => b.id === f.buildingId)?.name, level: f.level, markers: f.markers, plan: planRef(f.id) })),
            walkthroughs: list(r.walkthroughs)
              .slice(0, 5)
              .map((w) => compact({ walkthroughId: w.id, date: day(w.inspectedAt ?? w.createdAt), status: w.status === 'draft' ? 'Entwurf' : null, result: w.result, openFindings: Number(w.openDefects) || null })),
            fireOfficers: list(r.fireOfficers)
              .filter((f) => !f.appointedTo || Number(f.appointedTo) > Date.now())
              .map((f) => compact({ name: f.name, company: f.company, since: day(f.appointedFrom) })),
          });
        }
        case 'defect': {
          const d = (await x.api({ method: 'GET', path: `/defects/${enc(ref)}` }).catch(notFound('Mangel', 'defectId aus list(what: "defects") oder search nehmen.'))) as Json;
          return compact({
            ...defectLine(d),
            note: d.note,
            measure: d.measure,
            legalBasis: d.legalBasis,
            photo: photoRef(d.photoKey),
            resolution: d.status === 'resolved' ? compact({ at: day(d.resolvedAt), by: d.resolvedByName, note: d.resolutionNote, photo: photoRef(d.resolutionPhotoKey) }) : null,
            tasks: list(d.tasks).map((t) => compact({ taskId: t.id, title: t.title, status: TASK_STATUS[s(t.status)], due: day(t.dueAt), assignee: t.assigneeName })),
            history: list(d.history).map((h) => `${day(h.createdAt)} ${s(h.userName)}: ${s(h.summary)}`),
          });
        }
        case 'task': {
          const t = ((await x.api({ method: 'GET', path: '/tasks' })) as Json[]).find((k) => k.id === ref);
          if (!t) throw new ToolError(`Aufgabe „${ref}“ nicht gefunden. taskId aus list(what: "tasks") nehmen.`);
          const comments = (await x.api({ method: 'GET', path: `/tasks/${enc(ref)}/comments` }).catch(() => [])) as Json[];
          return compact({
            ...taskLine(t),
            description: t.description,
            kind: t.kind === 'inspection' ? 'Prüfauftrag' : t.kind === 'defect' ? 'Mängelbehebung' : 'Sonstiges',
            assigneeId: t.assigneeId,
            defect: t.defectTitle ? `${t.defectTitle} (${sev(t.defectSeverity)})` : null,
            defectId: t.defectId,
            recurrence: t.recurrence,
            partnerNote: t.externalNote,
            createdBy: t.createdByName,
            created: day(t.createdAt),
            comments: (Array.isArray(comments) ? comments : list((comments as Json).items)).slice(-10).map((k) => `${dayTime(k.createdAt)} ${s(k.authorName ?? k.userName)}: ${s(k.body)}`),
          });
        }
        case 'inspection': {
          const i = (await x.api({ method: 'GET', path: `/inspections/${enc(ref)}` }).catch(notFound('Prüfung', 'inspectionId aus list(what: "inspections") oder get(kind: "asset") nehmen.'))) as Json;
          const asset = i.asset as Json;
          const answers = (i.answers ?? {}) as Record<string, string>;
          const AN: Record<string, string> = { ok: 'i. O.', defect: 'Mangel', na: 'entfällt' };
          return compact({
            inspectionId: i.id,
            element: `${s(asset.code)} ${s(asset.categoryLabel)}${asset.location ? `, ${asset.location}` : ''}`,
            property: asset.propertyName,
            status: i.status === 'draft' ? (i.readyAt ? 'wartet auf Unterschrift' : 'Entwurf') : 'abgeschlossen',
            kinds: (i.kindLabels as string[])?.join(', '),
            date: day(i.inspectedAt ?? i.createdAt),
            inspector: i.inspectorName,
            result: i.result ? RESULT[s(i.result)] : null,
            notInspectable: i.notInspectable ? true : null,
            checkpoints: list(i.checkpoints).map((c, n) => `${n + 1}. ${s(c.label)}: ${AN[answers[s(c.id)]] ?? 'offen'}`),
            defects: list(i.defects).map((d) => compact({ title: d.title, severity: sev(d.severity), measure: d.measure, photo: photoRef(d.photoKey), known: d.knownId ? true : null })),
            knownOpenDefects: list(i.knownDefects).map((d) => compact({ defectId: d.id, title: d.title, severity: sev(d.severity), since: day(d.createdAt) })),
            maintenance: (i.maintenance as string[])?.join(', '),
            notes: i.notes,
            photos: list(i.photos).map((p) => compact({ photo: photoRef(p.key), caption: p.caption })),
            signed: i.status === 'submitted' ? (i.signature ? 'ja' : 'nein') : null,
            nextDue: day(i.nextDueAt),
          });
        }
        case 'walkthrough': {
          const w = (await x.api({ method: 'GET', path: `/walkthroughs/${enc(ref)}` }).catch(notFound('Begehung', 'walkthroughId aus list(what: "walkthroughs") nehmen.'))) as Json;
          const findings = list(w.findings);
          return compact({
            walkthroughId: w.id,
            property: w.propertyName,
            building: w.buildingName,
            status: w.status === 'draft' ? 'Entwurf' : 'abgeschlossen',
            date: day(w.inspectedAt ?? w.createdAt),
            result: w.result,
            findings: findings.map((f) => compact({ title: f.title, severity: sev(f.severity), note: f.note, photo: photoRef(f.photoKey) })),
            notes: w.notes,
            nextDue: day(w.nextDueAt),
          });
        }
        default:
          throw new ToolError('`kind` muss asset, property, defect, task, inspection oder walkthrough sein.');
      }
    },
  },
  {
    name: 'get_photo',
    title: 'Foto ansehen',
    description:
      'Lädt ein Foto oder einen Grundriss als Bild, damit du es ansehen kannst – z. B. ein Typenschild lesen (danach update_asset) oder einen Grundriss auswerten (danach setup). `ref` ist ein Verweis aus get: „foto:…“ (Fotos von Elementen, Mängeln, Prüfungen) oder „plan:…“ (Grundriss eines Gebäudes; die Antwort nennt dann auch die gesetzten Marker). Bilder (JPEG, PNG, WebP) bis 4 MB kommen als Bildinhalt, Vektor-Grundrisse (SVG) als Quelltext; PDFs werden nicht geliefert. Nur lesend.',
    inputSchema: obj({ ref: str('Verweis aus get, z. B. „foto:abc123/XyZ…“ oder „plan:8f2k…“') }, ['ref']),
    readOnly: true,
    run: async (a, x) => {
      const ref = s(a.ref).trim();
      const MAX = 4 * 1024 * 1024;
      let key = ref.startsWith('foto:') ? ref.slice(5) : ref;
      let caption = 'Foto';
      let extra: Json = {};
      if (ref.startsWith('plan:')) {
        const id = ref.slice(5);
        if (!/^[a-z0-9]{1,40}$/.test(id)) throw new ToolError('Ungültiger Grundriss-Verweis. Verweise „plan:…“ liefert get(kind: "property") oder get(kind: "asset").');
        let p: Json;
        try {
          p = (await x.api({ method: 'GET', path: `/floor-plans/${id}` })) as Json;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) throw new ToolError('Grundriss nicht gefunden (oder außerhalb deines Zugriffsbereichs).');
          throw e;
        }
        key = s(p.fileKey);
        caption = `Grundriss „${s(p.name)}“, ${s(p.buildingName)} (${s(p.propertyName)})`;
        const markers = list(p.assets).filter((m) => m.floorPlanId === p.id && m.markerX != null);
        extra = { size: `${s(p.width)} × ${s(p.height)} px`, markers: markers.map((m) => `${s(m.code)} bei x ${Number(m.markerX).toFixed(2)}, y ${Number(m.markerY).toFixed(2)}`) };
      }
      // Dateischlüssel: <workspace>/<zufall> – der Server liefert nur Dateien des eigenen Workspaces
      if (!/^[a-z0-9]{1,40}\/[A-Za-z0-9]{8,64}$/.test(key)) throw new ToolError('Ungültiger Foto-Verweis. Gültige Verweise („foto:…“, „plan:…“) liefert get.');
      let f: { body: ArrayBuffer; type: string };
      try {
        f = await x.raw(`/files/${key}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) throw new ToolError('Foto nicht gefunden – der Verweis gehört nicht zu diesem Workspace oder die Datei wurde gelöscht.');
        throw e;
      }
      const type = f.type.split(';')[0].trim();
      const text = [caption, ...Object.entries(extra).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') || 'keine' : s(v)}`)].join('\n');
      if (f.body.byteLength > MAX) throw new ToolError(`Bild zu groß (${(f.body.byteLength / 1048576).toFixed(1)} MB, höchstens 4 MB). In der App verkleinert neu hochladen.`);
      // Vektor-Grundrisse (SVG) als Text: Räume und Beschriftungen sind darin lesbar
      if (type === 'image/svg+xml') return { content: [{ type: 'text', text: `${text}\nVektorgrafik (SVG), Quelltext folgt:` }, { type: 'text', text: new TextDecoder().decode(f.body) }] };
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new ToolError(`Kein Bild (${type || 'unbekannter Typ'}). PDF-Grundrisse bitte als Foto oder Bild-Export hochladen.`);
      return { content: [{ type: 'text', text }, { type: 'image', data: b64(f.body), mimeType: type }] };
    },
  },
  {
    name: 'capture',
    title: 'Erfassen',
    description:
      'Mehrere Einträge auf einmal anlegen – genau so, wie jemand sie diktiert. Je Eintrag `kind`: defect (Mangel: title, severity, measure, note), task (Aufgabe: title, note, priority, due), note (Notiz, wird als Aufgabe mit niedriger Priorität gespeichert), asset (neue Elemente: category, building, floor, location, count – z. B. „5 Feuerlöscher EG Flur“). Ort: `asset` (Element-Code) je Eintrag oder als Vorgabe für alle; sonst `property` (Objektname). Ähnliche offene Mängel werden NICHT doppelt angelegt, sondern unter `skipped` gemeldet – nach Rückfrage mit `force: true` erneut senden. Schwere Mängel bekommen je nach Autopilot automatisch eine Aufgabe. Neue Elemente brauchen das Recht „darf anlegen“. Beispiel: {asset: "FST-7K2M", items: [{kind: "defect", title: "Obentürschließer zieht nicht zu", severity: "medium", measure: "Schließer einstellen"}, {kind: "task", title: "Hausmeister informieren", due: "2026-11-20"}]}.',
    inputSchema: obj(
      {
        asset: str('Vorgabe-Element für alle Einträge (Code), z. B. „FST-7K2M“'),
        property: str('Vorgabe-Objekt (Name), wenn kein Element passt'),
        force: bool('auch anlegen, wenn ein ähnlicher Mangel schon offen ist (erst nach Rückfrage)'),
        items: arr(
          obj(
            {
              kind: str('Art des Eintrags', { enum: ['defect', 'task', 'note', 'asset'] }),
              title: str('Kurzer, sachlicher Titel (bei asset optional)'),
              note: str('Details'),
              severity: SEVERITY,
              measure: str('Maßnahme zur Behebung (Mangel), z. B. „Dichtung erneuern“'),
              priority: str('Aufgabe: Priorität', { enum: ['low', 'medium', 'high'] }),
              due: str('Aufgabe: Frist (ISO-Datum), z. B. „2026-11-20“'),
              asset: str('Element-Code für diesen Eintrag'),
              property: str('Objekt (Name) für diesen Eintrag'),
              category: str('asset: Elementart (Schlüssel oder Bezeichnung, z. B. „Feuerlöscher“)'),
              building: str('asset: Gebäude (Name)'),
              floor: str('asset: Etage, z. B. „EG“, „1. OG“'),
              location: str('asset: Standort, z. B. „Flur vor Raum 1.04“'),
              count: int('asset: Anzahl gleicher Elemente', 1, 50),
            },
            ['kind'],
          ),
          'Einträge in Diktat-Reihenfolge',
        ),
      },
      ['items'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const items = list(a.items);
      if (!items.length) throw new ToolError('`items` ist leer. Beispiel: {items: [{kind: "defect", title: "…", severity: "medium"}], asset: "FST-7K2M"}');
      if (items.length > 50) throw new ToolError('Höchstens 50 Einträge je Aufruf – bitte aufteilen.');
      const created: string[] = [];
      const skipped: Json[] = [];
      const failed: Json[] = [];
      let autoTasks = 0;
      const assetCache = new Map<string, Promise<{ id: string; propertyId: string }>>();
      const assetOf = (code: string) => {
        if (!assetCache.has(code))
          assetCache.set(
            code,
            assetId(x, code).then(async (id) => ({ id, propertyId: s(((await x.api({ method: 'GET', path: `/assets/${enc(id)}` })) as Json).propertyId) })),
          );
        return assetCache.get(code)!;
      };
      for (const [n, it] of items.entries()) {
        const label = `${n + 1}. ${s(it.title) || s(it.category) || it.kind}`;
        try {
          if (it.kind === 'asset') {
            const cat = await resolveCategory(x, it.category ?? it.title);
            const b = await resolveBuilding(x, it.building ?? '', it.property ?? a.property);
            const count = clamp(it.count, 1, 50, 1);
            const codes: string[] = [];
            for (let i = 0; i < count; i++) {
              const r = (await x.api({ method: 'POST', path: '/assets', body: { buildingId: b.id, category: cat.key, floor: s(it.floor), location: s(it.location), attributes: {} } })) as { code: string };
              codes.push(r.code);
            }
            created.push(`${count} × ${cat.label} in ${b.name}${it.floor ? `, ${s(it.floor)}` : ''}${it.location ? `, ${s(it.location)}` : ''}: ${codes.join(', ')}`);
            continue;
          }
          const title = s(it.title).trim();
          if (!title) throw new ToolError('Titel fehlt');
          const code = s(it.asset ?? (it.property ? '' : a.asset)).trim();
          const asset = code ? await assetOf(code) : null;
          const prop = asset ? null : it.property || a.property ? await resolveProperty(x, it.property ?? a.property) : null;
          if (it.kind === 'defect') {
            if (!asset && !prop) throw new ToolError('Wo? `asset` (Code) oder `property` (Objekt) angeben');
            const severity = SEVERITIES[it.severity as Severity] ? s(it.severity) : suggestSeverity(`${title} ${s(it.note)}`);
            const body = { assetId: asset?.id ?? null, propertyId: asset?.propertyId ?? prop?.id ?? null, title, note: s(it.note), measure: s(it.measure) || suggestMeasure(title), severity, force: !!a.force };
            try {
              const r = (await x.api({ method: 'POST', path: '/defects', body })) as { taskCreated?: boolean };
              if (r.taskCreated) autoTasks++;
              created.push(`Mangel „${title}“ (${sev(severity)})${code ? ` an ${code}` : prop ? ` in ${prop.name}` : ''}`);
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) {
                const dup = (e.body as { duplicate?: Json })?.duplicate;
                skipped.push(compact({ item: label, reason: 'ähnlicher Mangel schon offen', existing: dup?.title, existingDefectId: dup?.id, since: day(dup?.createdAt) }));
              } else throw e;
            }
          } else {
            const due = toMs(it.due, 'due');
            await x.api({
              method: 'POST',
              path: '/tasks',
              body: {
                title: it.kind === 'note' ? `Notiz: ${title}` : title,
                description: s(it.note),
                priority: it.kind === 'note' ? 'low' : ['low', 'medium', 'high'].includes(s(it.priority)) ? it.priority : 'medium',
                dueAt: due ?? null,
                assetId: asset?.id ?? null,
                propertyId: asset ? null : (prop?.id ?? null),
              },
            });
            created.push(`${it.kind === 'note' ? 'Notiz' : 'Aufgabe'} „${title}“${code ? ` zu ${code}` : prop ? ` in ${prop.name}` : ''}${due ? `, fällig ${day(due)}` : ''}`);
          }
        } catch (e) {
          failed.push({ item: label, error: errorText(e) });
        }
      }
      const out = compact({
        created,
        autoTasks: autoTasks ? `Für ${autoTasks} schwere ${autoTasks === 1 ? 'Mangel' : 'Mängel'} hat der Autopilot eine Aufgabe angelegt.` : null,
        skipped,
        failed,
        hint: skipped.length ? 'Übersprungene nur nach Rückfrage mit force: true erneut senden.' : null,
      });
      if (!created.length && failed.length && !skipped.length) throw new ToolError(`Nichts angelegt. ${failed.map((f) => `${s(f.item)}: ${s(f.error)}`).join(' | ')}`);
      return out;
    },
  },
  {
    name: 'update_asset',
    title: 'Stammdaten nachtragen',
    description:
      'Stammdaten eines Elements ergänzen oder korrigieren – typischerweise nach dem Lesen eines Typenschilds mit get_photo. Nur genannte Felder ändern sich. Felder: manufacturer, model, year (Baujahr), serial (Seriennummer), approval (Zulassungsnummer), location, floor, label (Etikett/QR-Code); weitere Felder der Elementart über `fields` (Schlüssel aus search(type: "categories"), z. B. {rating: "T30"}). Antwort nennt jede Änderung „vorher → nachher“. Beispiel: {asset: "FL-3MX9", manufacturer: "Gloria", model: "PD 6 GA", year: 2019, serial: "A1234567"}.',
    inputSchema: obj(
      {
        asset: str('Element-Code, z. B. „FL-3MX9“'),
        manufacturer: str('Hersteller'),
        model: str('Typ/Modell'),
        year: int('Baujahr', 1900, 2100),
        serial: str('Seriennummer'),
        approval: str('Zulassungsnummer, z. B. „Z-6.20-1234“'),
        location: str('Standort'),
        floor: str('Etage'),
        label: str('Etikett/QR-Code'),
        fields: { type: 'object', description: 'weitere Felder der Elementart als {schlüssel: wert}', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
      },
      ['asset'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const id = await assetId(x, a.asset);
      const r = (await x.api({ method: 'GET', path: `/assets/${enc(id)}` })) as Json;
      const cat = (await x.categories()).find((c) => c.key === r.category);
      const fields = new Map((cat?.attributes ?? []).map((f) => [f.key, f.label]));
      const attrs = { ...((r.attributes ?? {}) as Json) };
      const next = { location: s(r.location), floor: s(r.floor), manufacturer: s(r.manufacturer), model: s(r.model), labelCode: (r.labelCode as string | null) ?? undefined };
      const changes: string[] = [];
      const ignored: string[] = [];
      const set = (label: string, before: unknown, after: unknown) => {
        if (s(before) !== s(after)) changes.push(`${label}: ${s(before) || '–'} → ${s(after) || '–'}`);
      };
      for (const k of ['manufacturer', 'model', 'location', 'floor'] as const) {
        if (a[k] === undefined) continue;
        set({ manufacturer: 'Hersteller', model: 'Modell', location: 'Standort', floor: 'Etage' }[k], next[k], a[k]);
        next[k] = s(a[k]).trim();
      }
      if (a.label !== undefined) {
        set('Etikett', next.labelCode, s(a.label).toUpperCase());
        next.labelCode = s(a.label).trim() || undefined;
      }
      const extra: Json = { ...((a.fields ?? {}) as Json) };
      if (a.year !== undefined) extra.year = a.year;
      if (a.approval !== undefined) extra.approval = a.approval;
      if (a.serial !== undefined) {
        if (fields.has('serial')) extra.serial = a.serial;
        else if (!s(next.model).includes(s(a.serial))) {
          // Art ohne Feld „Seriennummer“: wie bisher am Modell anhängen
          const m = [next.model, `SN ${s(a.serial)}`].filter(Boolean).join(' · ');
          set('Modell', next.model, m);
          next.model = m;
        }
      }
      for (const [k, v] of Object.entries(extra)) {
        if (!fields.has(k)) {
          ignored.push(k);
          continue;
        }
        set(fields.get(k)!, attrs[k], v);
        attrs[k] = v as never;
      }
      if (!changes.length) return compact({ asset: r.code, changed: 'nichts – Werte waren schon so', ignored: ignored.length ? `${ignored.join(', ')} (gibt es bei ${cat?.label ?? 'dieser Art'} nicht)` : null });
      await x.api({ method: 'PATCH', path: `/assets/${enc(id)}`, body: { buildingId: r.buildingId, ...next, attributes: attrs, warnDays: r.warnDays ?? null } });
      return compact({ asset: r.code, changed: changes, ignored: ignored.length ? `${ignored.join(', ')} (gibt es bei ${cat?.label ?? 'dieser Art'} nicht; mögliche Felder: ${[...fields.keys()].join(', ')})` : null });
    },
  },
  {
    name: 'update_tasks',
    title: 'Aufgaben ändern',
    description:
      'Eine oder mehrere Aufgaben ändern: Status (open, in_progress, done, cancelled – „done“ schließt einen verknüpften Mangel), Zuständige (Name oder ID; null = niemand), Frist (ISO-Datum oder null), Priorität, und/oder einen internen Kommentar anhängen (für Subunternehmer unsichtbar). taskIds stammen aus list(what: "tasks"), briefing oder get. Beispiel: {taskIds: ["k3x…"], status: "done", comment: "Schließer am 12.11. getauscht"}.',
    inputSchema: obj(
      {
        taskIds: arr({ type: 'string' }, 'IDs der Aufgaben', 200),
        status: str('neuer Status', { enum: ['open', 'in_progress', 'done', 'cancelled'] }),
        assignee: { type: ['string', 'null'], description: 'zuständige Person: Name (wie in get/list angezeigt) oder Nutzer-ID; null = niemand' },
        due: { type: ['string', 'null'], description: 'neue Frist (ISO-Datum, z. B. „2026-11-30“) oder null für keine' },
        priority: str('Priorität', { enum: ['low', 'medium', 'high'] }),
        comment: str('interner Kommentar für jede genannte Aufgabe'),
      },
      ['taskIds'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const ids = (Array.isArray(a.taskIds) ? a.taskIds : []).map(String).filter(Boolean);
      if (!ids.length) throw new ToolError('taskIds fehlt. IDs liefert list(what: "tasks").');
      const body: Json = {};
      if (a.status) body.status = a.status;
      if (a.priority) body.priority = a.priority;
      if (a.due !== undefined) body.dueAt = a.due === null ? null : toMs(a.due, 'due');
      if (a.assignee !== undefined) {
        if (a.assignee === null || a.assignee === '') body.assigneeId = null;
        else {
          // Namen aus den sichtbaren Aufgaben auflösen (Mitgliederliste ist mit Schlüssel nicht abrufbar)
          const known = new Map<string, string>();
          for (const t of (await x.api({ method: 'GET', path: '/tasks' })) as Json[]) if (t.assigneeId) known.set(s(t.assigneeId), s(t.assigneeName));
          const q = lc(a.assignee);
          const hits = [...known].filter(([id, name]) => id === s(a.assignee) || lc(name) === q || lc(name).includes(q));
          if (hits.length !== 1)
            throw new ToolError(
              hits.length
                ? `„${s(a.assignee)}“ ist mehrdeutig: ${hits.map(([, n]) => n).join(', ')}.`
                : `Person „${s(a.assignee)}“ nicht gefunden. Bekannt aus Aufgaben: ${[...known.values()].join(', ') || 'niemand'}. Sonst die Nutzer-ID angeben (get(kind: "task") zeigt assigneeId).`,
            );
          body.assigneeId = hits[0][0];
        }
      }
      const out: Json = {};
      if (Object.keys(body).length) {
        const r = (await x.api({ method: 'POST', path: '/tasks/bulk', body: { ids, ...body } })) as { updated: number; skipped: number };
        out.updated = r.updated;
        if (r.skipped) out.notFound = `${r.skipped} ID(s) unbekannt oder außerhalb deines Bereichs`;
      }
      if (a.comment) {
        let n = 0;
        const fails: string[] = [];
        for (const id of ids) {
          try {
            await x.api({ method: 'POST', path: `/tasks/${enc(id)}/comments`, body: { body: s(a.comment), mentions: [] } });
            n++;
          } catch (e) {
            fails.push(`${id}: ${errorText(e)}`);
          }
        }
        out.commented = n;
        if (fails.length) out.commentErrors = fails;
      }
      if (!Object.keys(out).length) throw new ToolError('Nichts zu ändern: status, assignee, due, priority oder comment angeben.');
      return out;
    },
  },
  {
    name: 'update_defect',
    title: 'Mangel beheben oder öffnen',
    description:
      'Einen Mangel als behoben markieren (`action: "resolve"`, mit Notiz wer/was/wann) oder wieder öffnen (`action: "reopen"`). defectId aus list(what: "defects"), search oder get. Beispiel: {defectId: "d7…", action: "resolve", note: "Dichtung durch Fa. Hansen erneuert"}.',
    inputSchema: obj(
      {
        defectId: str('ID des Mangels'),
        action: str('resolve = behoben, reopen = wieder offen', { enum: ['resolve', 'reopen'] }),
        note: str('Behebungsnotiz, z. B. „Schließer getauscht durch Fa. Hansen“'),
      },
      ['defectId', 'action'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const id = s(a.defectId);
      try {
        await x.api({ method: 'PATCH', path: `/defects/${enc(id)}`, body: a.action === 'reopen' ? { status: 'open' } : { status: 'resolved', note: s(a.note) } });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) throw new ToolError(`Mangel „${id}“ nicht gefunden. defectId aus list(what: "defects") nehmen.`);
        throw e;
      }
      const d = (await x.api({ method: 'GET', path: `/defects/${enc(id)}` })) as Json;
      return compact({ defect: d.title, at: d.code, status: d.status === 'resolved' ? 'behoben' : 'offen', note: d.resolutionNote });
    },
  },
  {
    name: 'plan',
    title: 'Planen',
    description:
      'Rundgänge planen. `action: "view"` (Standard): fällige Prüfungen je Gebäude als Rundgang – überfällig, in `days` Tagen fällig, nie geprüft – mit Elementen in Laufreihenfolge (Etage, Standort). `action: "plan_week"`: die Wochenplanung des Autopiloten jetzt einmal ausführen (Rundgang-Aufträge an die Zuständigen). `action: "tasks_from_defects"`: für offene Mängel ohne Aufgabe Aufgaben mit Frist anlegen (Standard: Schwere high und critical).',
    inputSchema: obj({
      action: str('view = ansehen, plan_week = Wochenplanung auslösen, tasks_from_defects = Aufgaben aus Mängeln', { enum: ['view', 'plan_week', 'tasks_from_defects'] }),
      days: int('Vorschau in Tagen (Standard 14)', 1, 365),
      building: str('nur dieses Gebäude (Name)'),
      severities: arr({ type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, 'nur tasks_from_defects: Schweregrade (Standard high, critical)', 4),
    }),
    readOnly: false,
    run: async (a, x) => {
      const action = s(a.action) || 'view';
      if (action === 'plan_week') {
        const r = (await x.api({ method: 'POST', path: '/automation/plan_week/run' })) as Json;
        return { done: r.done, text: Number(r.done) ? `${s(r.done)} Rundgang-Auftrag/-Aufträge angelegt bzw. aktualisiert.` : 'Nichts zu planen – keine neuen Fälligkeiten im Planungsfenster.' };
      }
      if (action === 'tasks_from_defects') {
        const r = (await x.api({ method: 'POST', path: '/smart/tasks-from-defects', body: Array.isArray(a.severities) && a.severities.length ? { severities: a.severities } : {} })) as Json;
        return { created: r.created };
      }
      const days = clamp(a.days, 1, 365, 14);
      let rounds = (await x.api({ method: 'GET', path: `/smart/rounds?days=${days}` })) as Json[];
      if (a.building) {
        const b = await resolveBuilding(x, a.building);
        rounds = rounds.filter((r) => r.buildingId === b.id);
      }
      return {
        days,
        rounds: await Promise.all(
          rounds.slice(0, 20).map(async (r) => {
            const els = list(r.assets);
            return compact({
              building: r.buildingName,
              property: r.propertyName,
              overdue: r.overdue,
              due: r.due,
              neverInspected: r.never,
              earliestDue: day(r.earliest),
              walk: await Promise.all(els.slice(0, 25).map(async (e) => `${s(e.code)} ${await catLabel(x, e.category)} – ${[e.floor, e.location].filter(Boolean).join(', ') || 'ohne Standort'}`)),
              more: els.length > 25 ? els.length - 25 : null,
            });
          }),
        ),
        ...(rounds.length > 20 ? { moreRounds: rounds.length - 20 } : {}),
        ...(rounds.length ? {} : { hint: `Nichts fällig in den nächsten ${days} Tagen. Größeres days versuchen.` }),
      };
    },
  },
  {
    name: 'tour',
    title: 'Rundgang führen',
    description:
      'Führt durch einen Rundgang vor Ort, Element für Element. `action: "start"` mit `building` (Gebäude- oder Objektname): nennt das erste fällige Element in Laufreihenfolge mit Standort, den Prüfpunkten in Kurzform und bekannten offenen Mängeln. Nach jeder Prüfung (inspect) `action: "next"`; mit `after` (Code) wird ein Element übersprungen. `action: "status"`: x von y erledigt und was noch offen ist. Ein Element gilt als erledigt, sobald seine Prüfung zur Unterschrift bereitliegt oder abgeschlossen ist. Nur lesend.',
    inputSchema: obj(
      {
        action: str('start, next oder status', { enum: ['start', 'next', 'status'] }),
        building: str('Gebäude (oder Objekt mit nur einem Gebäude), z. B. „Haupthaus“'),
        after: str('nur next: Element-Code, nach dem es weitergehen soll (zum Überspringen)'),
        days: int('Vorschau in Tagen: was in so vielen Tagen fällig wird, gehört dazu (Standard 14)', 1, 365),
      },
      ['action', 'building'],
    ),
    readOnly: true,
    run: async (a, x) => {
      const b = await resolveBuilding(x, a.building);
      const days = clamp(a.days, 1, 365, 14);
      const [rounds, ready] = await Promise.all([
        x.api({ method: 'GET', path: `/smart/rounds?days=${days}` }) as Promise<Json[]>,
        x.api({ method: 'GET', path: '/inspections?status=ready' }).catch(() => []) as Promise<Json[]>,
      ]);
      const due = list(rounds.find((r) => r.buildingId === b.id)?.assets);
      const readyHere = (ready as Json[]).filter((i) => i.buildingId === b.id);
      const readyIds = new Set(readyHere.map((i) => s(i.assetId)));
      const open = due.filter((e) => !readyIds.has(s(e.id)));
      const total = open.length + readyHere.length;
      const progress = `${readyHere.length} von ${total} bereit zur Unterschrift`;
      const where = `${b.name} (${b.propertyName})`;
      if (a.action === 'status') {
        return compact({
          building: where,
          progress,
          remaining: await Promise.all(open.map(async (e) => `${s(e.code)} ${await catLabel(x, e.category)} – ${[e.floor, e.location].filter(Boolean).join(', ')}`)),
          readyToSign: readyHere.map((i) => s(i.code)),
          hint: readyHere.length ? 'Unterschreiben in der App (Heute → „Prüfungen warten auf deine Unterschrift“).' : null,
        });
      }
      let queue = open;
      if (a.action === 'next' && a.after) {
        const at = due.findIndex((e) => lc(e.code) === lc(a.after));
        if (at >= 0) queue = [...due.slice(at + 1), ...due.slice(0, at)].filter((e) => !readyIds.has(s(e.id)) && lc(e.code) !== lc(a.after));
      }
      const e = queue[0];
      if (!e)
        return compact({
          building: where,
          progress,
          done: true,
          text: total ? 'Rundgang fertig – alles geprüft. Jetzt in der App unterschreiben.' : `In ${b.name} ist in den nächsten ${days} Tagen nichts fällig.`,
        });
      const detail = (await x.api({ method: 'GET', path: `/assets/${enc(s(e.id))}` })) as Json;
      const cat = (await x.categories()).find((c) => c.key === e.category);
      const sched = (detail.schedules ?? {}) as Record<string, { enabled?: boolean; nextDueAt?: number | null }>;
      const key = Object.entries(sched)
        .filter(([, v]) => v?.enabled)
        .sort((p, q) => (p[1].nextDueAt ?? 0) - (q[1].nextDueAt ?? 0))[0]?.[0];
      const cps = cat?.schedulesEffective?.find((sc) => sc.key === key)?.checkpoints ?? cat?.checkpoints ?? [];
      const following = queue[1];
      return compact({
        building: where,
        progress,
        element: compact({
          code: e.code,
          art: cat?.label ?? e.category,
          floor: e.floor,
          location: e.location,
          due: day(e.nextDueAt) ?? 'nie geprüft',
          lastResult: detail.lastResult ? RESULT[s(detail.lastResult)] : null,
          checkpoints: cps.map((c, n) => `${n + 1}. ${c.label}`),
          knownDefects: list(detail.defects)
            .filter((d) => d.status === 'open' && !d.hiddenAt)
            .map((d) => compact({ title: d.title, severity: sev(d.severity), since: day(d.createdAt) })),
        }),
        then: following ? `${s(following.code)} – ${[following.floor, following.location].filter(Boolean).join(', ')}` : 'letztes Element',
        hint: `Befund mit inspect(asset: "${s(e.code)}", …) eintragen; bekannte Mängel als still/fixed angeben.`,
      });
    },
  },
  {
    name: 'inspect',
    title: 'Prüfung ausfüllen',
    description:
      'Füllt die Prüfung eines Elements aus dem Gesagten aus und legt sie in der App **zur Unterschrift** bereit. Schließt nie ab und unterschreibt nie – das macht die prüfende Person in der App. `allOk: true` setzt alle noch offenen Prüfpunkte auf „i. O.“; Ausnahmen als `defects` (title, severity, measure, note; Prüfpunkt per `checkpoint` = Nummer oder Stichwort, sonst automatisch zugeordnet). Bekannte offene Mängel mit `known` als still (weiterhin vorhanden) oder fixed (behoben) melden. Weitere: `answers` (einzelne Punkte ok/defect/na), `maintenance` (durchgeführte Arbeiten), `notes`, `notInspectable` mit `reason`. Mehrfach aufrufbar – ergänzt denselben Entwurf. Antwort: Kurzfassung, Ergebnis und was noch fehlt. Beispiel: {asset: "FST-7K2M", allOk: true, defects: [{title: "Obentürschließer zieht nicht ganz zu", severity: "medium", measure: "Schließer einstellen", checkpoint: "Schließer"}]}.',
    inputSchema: obj(
      {
        asset: str('Element-Code, z. B. „FST-7K2M“'),
        allOk: bool('alle noch nicht bewerteten Prüfpunkte auf „i. O.“ setzen'),
        defects: arr(
          obj(
            {
              title: str('Mangel, kurz und sachlich'),
              severity: SEVERITY,
              measure: str('Maßnahme, z. B. „Dichtung erneuern“'),
              note: str('Details'),
              checkpoint: str('Prüfpunkt: Nummer (aus tour/get) oder Stichwort; leer = automatisch'),
            },
            ['title'],
          ),
          'neue Mängel',
          30,
        ),
        known: arr(
          obj(
            {
              defect: str('bekannter Mangel: Titel(-teil) oder defectId'),
              status: str('still = weiterhin vorhanden, fixed = behoben', { enum: ['still', 'fixed'] }),
            },
            ['defect', 'status'],
          ),
          'Stand bekannter offener Mängel',
          30,
        ),
        answers: arr(
          obj({ checkpoint: str('Nummer oder Stichwort'), answer: str('ok, defect oder na (entfällt)', { enum: ['ok', 'defect', 'na'] }) }, ['checkpoint', 'answer']),
          'einzelne Prüfpunkte gezielt setzen',
          60,
        ),
        maintenance: arr({ type: 'string' }, 'durchgeführte Arbeiten (Bezeichnung oder Schlüssel der Elementart), z. B. „Batterie getauscht“', 20),
        notes: str('Bemerkung zum Protokoll'),
        notInspectable: bool('nicht prüfbar (z. B. kein Zugang) – `reason` angeben'),
        reason: str('Grund für „nicht prüfbar“'),
      },
      ['asset'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const id = await assetId(x, a.asset);
      const started = (await x.api({ method: 'POST', path: `/assets/${enc(id)}/inspections`, body: {} })) as { id: string };
      const d = (await x.api({ method: 'GET', path: `/inspections/${enc(started.id)}` })) as unknown as Draft;
      const cps = d.checkpoints;
      const answers: Record<string, Answer> = { ...d.answers };
      const defects: Json[] = [...d.defects];
      const resolved = new Set(d.resolvedDefects);
      const notes: string[] = [];
      for (const v of list(a.answers)) {
        const cp = findCheckpoint(cps, v.checkpoint);
        if (cp) answers[cp] = v.answer as Answer;
        else notes.push(`Prüfpunkt „${s(v.checkpoint)}“ nicht gefunden`);
      }
      // Bekannte Mängel: weiterhin vorhanden → als verknüpfter Mangel; behoben → wird beim Unterschreiben geschlossen
      for (const k of list(a.known)) {
        const ref = lc(k.defect);
        const hit = d.knownDefects.find((m) => m.id === s(k.defect)) ?? d.knownDefects.find((m) => lc(m.title).includes(ref) || similarity(m.title, s(k.defect)) >= 0.5);
        if (!hit) {
          notes.push(`Bekannter Mangel „${s(k.defect)}“ nicht gefunden`);
          continue;
        }
        if (k.status === 'fixed') {
          resolved.add(hit.id);
          for (let i = defects.length - 1; i >= 0; i--) if (defects[i].knownId === hit.id) defects.splice(i, 1);
        } else {
          resolved.delete(hit.id);
          if (!defects.some((x2) => x2.knownId === hit.id))
            defects.push(compact({ title: hit.title, note: hit.note, measure: hit.measure, severity: hit.severity, checkpointId: hit.checkpointId ?? undefined, knownId: hit.id, since: hit.createdAt }));
          if (hit.checkpointId && cps.some((c) => c.id === hit.checkpointId)) answers[hit.checkpointId] = 'defect';
        }
      }
      for (const m of list(a.defects)) {
        const title = s(m.title).trim();
        if (!title) continue;
        const cp = findCheckpoint(cps, m.checkpoint, `${title} ${s(m.note)}`);
        const severity = SEVERITIES[m.severity as Severity] ? (m.severity as Severity) : suggestSeverity(`${title} ${s(m.note)}`);
        const same = defects.findIndex((x2) => !x2.knownId && similarity(s(x2.title), title) >= 0.6);
        const entry = compact({ title, note: s(m.note), measure: s(m.measure) || suggestMeasure(title), severity, ...(cp ? { checkpointId: cp } : {}) });
        if (same >= 0) defects[same] = entry;
        else defects.push(entry);
        if (cp) answers[cp] = 'defect';
      }
      if (a.allOk) for (const c of cps) if (!answers[c.id]) answers[c.id] = 'ok';
      // Arbeiten: Bezeichnung oder Schlüssel der Elementart
      const cat = (await x.categories()).find((c) => c.key === d.asset.category);
      const maintenance = new Set(d.maintenance);
      for (const m of Array.isArray(a.maintenance) ? a.maintenance : []) {
        const hit = cat?.maintenance.find((o) => o.key === s(m) || lc(o.label).includes(lc(m)) || lc(m).includes(lc(o.label)));
        if (hit) maintenance.add(hit.key);
        else notes.push(`Arbeit „${s(m)}“ gibt es bei ${cat?.label ?? 'dieser Art'} nicht (möglich: ${cat?.maintenance.map((o) => o.label).join(', ') || 'keine'}) – in die Bemerkung übernommen`);
      }
      const unknownWork = (Array.isArray(a.maintenance) ? a.maintenance : []).filter((m) => !cat?.maintenance.some((o) => o.key === s(m) || lc(o.label).includes(lc(m)) || lc(m).includes(lc(o.label))));
      const noteText = [d.notes, s(a.notes), a.notInspectable && a.reason ? `Nicht prüfbar: ${s(a.reason)}` : '', unknownWork.length ? `Durchgeführt: ${unknownWork.map(String).join(', ')}` : '']
        .map((t) => t.trim())
        .filter((t, i, all) => t && all.indexOf(t) === i)
        .join('\n');
      const notInspectable = a.notInspectable === undefined ? d.notInspectable : !!a.notInspectable;
      const body = {
        kinds: d.kinds,
        notInspectable,
        answers,
        maintenance: [...maintenance],
        defects,
        photos: d.photos,
        notes: noteText.slice(0, 5000),
        signature: d.signature ?? null,
        signerName: d.signerName ?? '',
        resultOverride: d.resultOverride,
        resultReason: d.resultReason ?? '',
        resolvedDefects: [...resolved],
        ready: true,
      };
      const r = (await x.api({ method: 'PUT', path: `/inspections/${enc(d.id)}`, body })) as { ready: boolean; missing: string[] };
      const result = computeResult({ notInspectable, answers, defects: defects as never });
      const openKnown = d.knownDefects.filter((k) => !resolved.has(k.id) && !defects.some((x2) => x2.knownId === k.id));
      const AN: Record<string, string> = { ok: 'i. O.', defect: 'Mangel', na: 'entfällt' };
      return compact({
        asset: `${d.asset.code}${d.asset.location ? ` (${d.asset.location})` : ''}`,
        inspectionId: d.id,
        kinds: d.kindLabels.join(', '),
        result: RESULT[result],
        status: r.ready ? 'bereit zur Unterschrift (in der App)' : 'Entwurf – noch unvollständig',
        checkpoints: cps.filter((c) => answers[c.id] && answers[c.id] !== 'ok').map((c) => `${c.label}: ${AN[answers[c.id]]}`),
        defects: defects.map((m) => `${s(m.title)} (${sev(m.severity)})${m.knownId ? ' – bekannt, weiterhin vorhanden' : ''}`),
        fixed: d.knownDefects.filter((k) => resolved.has(k.id)).map((k) => k.title),
        missing: r.missing,
        ask: openKnown.length ? `Bekannte Mängel ohne Angabe (bleiben offen): ${openKnown.map((k) => k.title).join('; ')} – noch vorhanden oder behoben?` : null,
        notes: notes.length ? notes : null,
      });
    },
  },
  {
    name: 'setup',
    title: 'Struktur anlegen',
    description:
      'Legt Objekt, Gebäude und Elemente in einem Rutsch an – z. B. nach dem Auswerten eines Grundrisses (get_photo mit „plan:…“) oder einer Liste. Immer zuerst mit `preview: true` aufrufen: zeigt je Gebäude Anzahl je Art und Etage und was neu entsteht, ohne etwas zu schreiben. Nach Bestätigung dasselbe mit `preview: false`. Elemente in Laufreihenfolge angeben (Etage, dann Weg); `count` für gleiche Elemente am selben Standort; `x`/`y` (0–1, relativ zur Bildbreite/-höhe) setzen einen Marker auf dem Grundriss `plan` (Name oder Ebene) des Gebäudes. Vorhandene Objekte/Gebäude (gleicher Name) werden genutzt, fehlende neu angelegt – das darf nur ein Schreib-Schlüssel (bzw. die Verbindung) einer Person, die Admin oder Inhaber ist; die Vorschau zeigt „wird neu angelegt“ oder sagt, dass das Recht fehlt. Ändern, Löschen und Archivieren von Objekten/Gebäuden gehen über diesen Zugang nie. Elemente brauchen das Recht „darf anlegen“.',
    inputSchema: obj(
      {
        preview: bool('true = nur Vorschau (zuerst!), false = anlegen'),
        property: obj({ name: str('Objektname'), address: str('Adresse (nur bei neuem Objekt)') }, ['name'], 'Objekt (vorhanden oder neu)'),
        buildings: arr(
          obj(
            {
              name: str('Gebäudename, z. B. „Haupthaus“'),
              plan: str('Grundriss dieses Gebäudes für Marker: Name oder Ebene (z. B. „EG“ oder „0“)'),
              elements: arr(
                obj(
                  {
                    category: str('Elementart (Schlüssel oder Bezeichnung, z. B. „Feuerlöscher“)'),
                    floor: str('Etage, z. B. „EG“'),
                    location: str('Standort, z. B. „Flur vor Raum 0.12“'),
                    count: int('Anzahl gleicher Elemente hier (Standard 1)', 1, 50),
                    x: { type: 'number', minimum: 0, maximum: 1, description: 'Marker-Position horizontal (0 = links, 1 = rechts); nur mit count 1' },
                    y: { type: 'number', minimum: 0, maximum: 1, description: 'Marker-Position vertikal (0 = oben, 1 = unten); nur mit count 1' },
                  },
                  ['category'],
                ),
                'Elemente in Laufreihenfolge',
                300,
              ),
            },
            ['name'],
          ),
          'Gebäude mit ihren Elementen',
          20,
        ),
      },
      ['preview', 'property', 'buildings'],
    ),
    readOnly: false,
    run: async (a, x) => {
      const preview = a.preview !== false;
      const pIn = (a.property ?? {}) as Json;
      const pName = s(pIn.name).trim();
      if (!pName) throw new ToolError('property.name fehlt.');
      const bIn = list(a.buildings);
      if (!bIn.length) throw new ToolError('buildings fehlt – mindestens ein Gebäude angeben.');
      const total = bIn.reduce((n, b) => n + list(b.elements).reduce((m, e) => m + clamp(e.count, 1, 50, 1), 0), 0);
      if (total > 300) throw new ToolError(`${total} Elemente sind zu viele für einen Aufruf (höchstens 300) – bitte je Gebäude oder Etage aufteilen.`);
      const existing = (await properties(x)).find((p) => lc(p.name) === lc(pName));
      const detail = existing ? ((await x.api({ method: 'GET', path: `/properties/${enc(existing.id)}` })) as Json) : null;
      const problems: string[] = [];
      // Arten und Grundrisse vorab auflösen (auch für die Vorschau)
      const plan: { name: string; id: string | null; planId: string | null; elements: { cat: CategoryInfo; floor: string; location: string; count: number; x?: number; y?: number }[] }[] = [];
      for (const b of bIn) {
        const name = s(b.name).trim();
        const found = list(detail?.buildings).find((y) => lc(y.name) === lc(name));
        let planId: string | null = null;
        if (b.plan) {
          const plans = list(detail?.floorPlans).filter((f) => f.buildingId === found?.id);
          const hit = plans.find((f) => lc(f.name) === lc(b.plan) || s(f.level) === s(b.plan)) ?? plans.find((f) => lc(f.name).includes(lc(b.plan)));
          if (hit) planId = s(hit.id);
          else problems.push(`${name}: Grundriss „${s(b.plan)}“ nicht gefunden${found ? '' : ' (Gebäude ist neu – Grundriss zuerst in der App hochladen)'} – Marker werden ausgelassen`);
        }
        const elements = [];
        for (const e of list(b.elements)) {
          try {
            const cat = await resolveCategory(x, e.category);
            const count = clamp(e.count, 1, 50, 1);
            const hasXY = typeof e.x === 'number' && typeof e.y === 'number';
            if (hasXY && count > 1) problems.push(`${name}: Marker nur bei count 1 (${cat.label}, ${s(e.location)})`);
            elements.push({ cat, floor: s(e.floor), location: s(e.location), count, ...(hasXY && count === 1 && planId ? { x: Number(e.x), y: Number(e.y) } : {}) });
          } catch (err) {
            problems.push(`${name}: ${errorText(err)}`);
          }
        }
        plan.push({ name, id: found ? s(found.id) : null, planId, elements });
      }
      if (preview) {
        // nur die Vorschau fragt das Recht vorab ab; beim Anlegen entscheidet die API (403 → Hinweis unten)
        const structureOk = !existing || plan.some((b) => !b.id) ? await canCreateStructure(x) : true;
        const isNew = structureOk ? 'wird neu angelegt' : 'neu – fehlt';
        if (!structureOk) {
          if (!existing) problems.push(`Objekt „${pName}“ ist neu – ${NEW_STRUCTURE_NOTE}`);
          for (const b of plan) if (!b.id) problems.push(`Gebäude „${b.name}“ ist neu – ${NEW_STRUCTURE_NOTE}`);
        }
        return compact({
          preview: true,
          property: `${pName} (${existing ? 'vorhanden' : isNew})`,
          buildings: plan.map((b) => {
            const byArt: Record<string, number> = {};
            const byFloor: Record<string, number> = {};
            for (const e of b.elements) {
              byArt[e.cat.label] = (byArt[e.cat.label] ?? 0) + e.count;
              byFloor[e.floor || 'ohne Etage'] = (byFloor[e.floor || 'ohne Etage'] ?? 0) + e.count;
            }
            return compact({ building: `${b.name} (${b.id ? 'vorhanden' : isNew})`, elements: b.elements.reduce((n, e) => n + e.count, 0), byArt, byFloor, markers: b.elements.filter((e) => e.x != null).length || null });
          }),
          total,
          problems,
          next: 'Zur Bestätigung zeigen; dann mit preview: false anlegen.',
        });
      }
      let propertyId = existing?.id ?? null;
      if (!propertyId) {
        try {
          propertyId = ((await x.api({ method: 'POST', path: '/properties', body: { name: pName, address: s(pIn.address) } })) as { id: string }).id;
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) throw new ToolError(NEW_STRUCTURE_HINT(`Objekt „${pName}“`));
          throw e;
        }
      }
      const created: Json[] = [];
      const failed: string[] = [];
      for (const b of plan) {
        let bid = b.id;
        if (!bid) {
          try {
            bid = ((await x.api({ method: 'POST', path: `/properties/${enc(propertyId)}/buildings`, body: { name: b.name } })) as { id: string }).id;
          } catch (e) {
            failed.push(e instanceof ApiError && e.status === 403 ? NEW_STRUCTURE_HINT(`Gebäude „${b.name}“`) : `Gebäude ${b.name}: ${errorText(e)}`);
            continue;
          }
        }
        const codes: string[] = [];
        let markers = 0;
        for (const e of b.elements) {
          for (let i = 0; i < e.count; i++) {
            try {
              const r = (await x.api({ method: 'POST', path: '/assets', body: { buildingId: bid, category: e.cat.key, floor: e.floor, location: e.location, attributes: {} } })) as { id: string; code: string };
              codes.push(r.code);
              if (e.x != null && b.planId) {
                await x.api({ method: 'PUT', path: `/assets/${enc(r.id)}/marker`, body: { floorPlanId: b.planId, x: e.x, y: e.y } });
                markers++;
              }
            } catch (err) {
              failed.push(`${b.name}, ${e.cat.label} ${e.location}: ${errorText(err)}`);
              // Ohne Recht zum Anlegen scheitert jedes weitere Element genauso
              if (err instanceof ApiError && err.status === 403) break;
            }
          }
        }
        created.push(compact({ building: b.name, elements: codes.length, codes: codes.slice(0, 60).join(', '), more: codes.length > 60 ? codes.length - 60 : null, markers: markers || null }));
      }
      const n = created.reduce((m, c) => m + Number(c.elements ?? 0), 0);
      if (!n && failed.length) throw new ToolError(`Nichts angelegt. ${failed.slice(0, 5).join(' | ')}`);
      return compact({ property: pName, created, failed, problems, next: n ? 'Rundgang starten mit tour(action: "start", building: …).' : null });
    },
  },
  {
    name: 'autopilot',
    title: 'Autopilot',
    description:
      'Den Autopiloten (Kreislauf aus Schritten wie Planen, Zuweisen, Nachhalten) ansehen und bedienen. `action: "view"`: Schritte mit Stufe (Aus, Vorschlagen, Automatisch) und letzter Ausführung, dazu das Protokoll (neueste zuerst). `action: "run"` mit `step` (Schlüssel aus view): den Schritt jetzt einmal ausführen. `action: "undo"` mit `entry` (ID aus dem Protokoll, nur wenn undoable): einen Eintrag rückgängig machen (z. B. angelegte, noch unbearbeitete Aufgaben wieder entfernen). Stufen ändern geht nur in der App durch Admins (Einstellungen → Automatik) – über diesen Zugang nie.',
    inputSchema: obj(
      {
        action: str('view, run oder undo', { enum: ['view', 'run', 'undo'] }),
        step: str('nur run: Schlüssel des Schritts aus view, z. B. „plan_week“'),
        entry: str('nur undo: ID des Protokolleintrags'),
        limit: int('view: Anzahl Protokolleinträge (Standard 20)', 1, 100),
      },
      ['action'],
    ),
    readOnly: false,
    destructive: true,
    run: async (a, x) => {
      if (a.action === 'run') {
        const steps = (await x.api({ method: 'GET', path: '/automation' })) as Json[];
        const st = steps.find((v) => v.key === a.step || lc(v.title) === lc(a.step));
        if (!st) throw new ToolError(`Schritt „${s(a.step)}“ unbekannt. Möglich: ${steps.map((v) => `${s(v.key)} (${s(v.title)})`).join(', ')}.`);
        const r = (await x.api({ method: 'POST', path: `/automation/${enc(s(st.key))}/run` })) as Json;
        return { step: st.title, done: r.done };
      }
      if (a.action === 'undo') {
        if (!a.entry) throw new ToolError('entry fehlt – IDs rückgängig machbarer Einträge zeigt autopilot(action: "view") als undoEntry.');
        const r = (await x.api({ method: 'POST', path: `/automation/log/${enc(s(a.entry))}/undo` })) as Json;
        return compact({ undone: true, reverted: r.reverted, kept: Number(r.kept) ? `${s(r.kept)} blieb(en), weil schon jemand daran arbeitet` : null });
      }
      const MODE: Record<string, string> = { off: 'Aus', suggest: 'Vorschlagen', auto: 'Automatisch' };
      const [steps, log] = await Promise.all([
        x.api({ method: 'GET', path: '/automation' }) as Promise<Json[]>,
        x.api({ method: 'GET', path: `/automation/log?limit=${clamp(a.limit, 1, 100, 20)}` }) as Promise<Json[]>,
      ]);
      return {
        steps: steps.map((v) => compact({ step: v.key, title: v.title, mode: MODE[s(v.mode)] ?? v.mode, what: v.description, lastRun: dayTime(v.lastRunAt), adminOnly: v.adminOnly ? true : null })),
        log: log.map((e) => compact({ at: dayTime(e.at), step: e.title, summary: e.summary, by: e.actorName, undone: e.undoneAt ? true : null, undoEntry: e.undoable ? e.id : null })),
        note: 'Stufen ändern nur in der App (Einstellungen → Automatik, Admins).',
      };
    },
  },
  {
    name: 'report',
    title: 'Kennzahlen',
    description:
      'Kennzahlen als fertiger Text für einen Zeitraum und optional ein Objekt: Prüfungen (Anzahl, Ergebnisse, Nachprüfungen), Prüfquote (Anteil der Elemente, die nicht überfällig sind), neue und behobene Mängel nach Schwere, mittlere Behebungsdauer, offene Mängel und Aufgaben, Begehungen. Zeitraum: `month` („2026-10“), `year` (2026) oder `from`/`to` (ISO); Standard: die letzten 30 Tage. Gut als Grundlage für einen Monatsbericht. Nur lesend.',
    inputSchema: obj({
      property: str('Objektname; ohne Angabe alle im Zugriffsbereich'),
      month: str('Monat „JJJJ-MM“, z. B. „2026-10“'),
      year: int('Kalenderjahr', 2000, 2100),
      from: str('ab (ISO-Datum)'),
      to: str('bis einschließlich (ISO-Datum)'),
    }),
    readOnly: true,
    run: async (a, x) => {
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      let from: number;
      let to: number;
      if (a.month) {
        const m = /^(\d{4})-(\d{2})$/.exec(s(a.month));
        if (!m) throw new ToolError('month bitte als „JJJJ-MM“, z. B. „2026-10“.');
        from = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
        to = Date.UTC(Number(m[1]), Number(m[2]), 1) - 1;
      } else if (a.year) {
        from = Date.UTC(Number(a.year), 0, 1);
        to = Date.UTC(Number(a.year) + 1, 0, 1) - 1;
      } else {
        to = (toMs(a.to, 'to') ?? Date.now()) + (a.to && /^\d{4}-\d{2}-\d{2}$/.test(s(a.to)) ? 86_400_000 - 1 : 0);
        from = toMs(a.from, 'from') ?? to - 30 * 86_400_000;
      }
      if (from > to) throw new ToolError('from liegt nach to.');
      const pq = prop ? `&propertyId=${enc(prop.id)}` : '';
      const [insp, defects, tasks, props, walks] = await Promise.all([
        x.api({ method: 'GET', path: `/inspections?status=submitted&from=${from}&to=${to}${pq}` }) as Promise<Json[]>,
        x.api({ method: 'GET', path: '/defects?status=all' }) as Promise<Json[]>,
        x.api({ method: 'GET', path: '/tasks' }) as Promise<Json[]>,
        properties(x),
        x.api({ method: 'GET', path: '/walkthroughs' }) as Promise<Json[]>,
      ]);
      const inProp = (r: Json) => !prop || r.propertyId === prop.id;
      const ds = defects.filter(inProp);
      const newD = ds.filter((d) => Number(d.createdAt) >= from && Number(d.createdAt) <= to);
      const fixed = ds.filter((d) => d.status === 'resolved' && Number(d.resolvedAt) >= from && Number(d.resolvedAt) <= to);
      const durations = fixed.map((d) => (Number(d.resolvedAt) - Number(d.createdAt)) / 86_400_000).filter((v) => v >= 0);
      const openNow = ds.filter((d) => d.status === 'open');
      const ps = props.filter((p) => !prop || p.id === prop.id);
      const el = ps.reduce((n, p) => n + Number(p.assets), 0);
      const overdue = ps.reduce((n, p) => n + Number(p.overdue), 0);
      const never = ps.reduce((n, p) => n + Number(p.never), 0);
      const byResult: Record<string, number> = {};
      for (const i of insp) byResult[RESULT[s(i.result)] ?? s(i.result)] = (byResult[RESULT[s(i.result)] ?? s(i.result)] ?? 0) + 1;
      const bySev = (rows: Json[]) =>
        (['critical', 'high', 'medium', 'low'] as const)
          .map((k) => [SEVERITIES[k], rows.filter((d) => d.severity === k).length] as const)
          .filter(([, n]) => n)
          .map(([l, n]) => `${n} ${l.toLowerCase()}`)
          .join(', ') || '0';
      const ts = tasks.filter(inProp).filter((t) => t.status === 'open' || t.status === 'in_progress');
      const lateTasks = ts.filter((t) => typeof t.dueAt === 'number' && Number(t.dueAt) < Date.now());
      const wk = walks.filter(inProp).filter((w) => w.status === 'submitted' && Number(w.inspectedAt) >= from && Number(w.inspectedAt) <= to);
      const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)} %` : '–');
      return [
        `Kennzahlen ${prop ? `„${prop.name}“` : 'alle Objekte'} · ${day(from)} bis ${day(to)}`,
        '',
        'Prüfungen',
        `- durchgeführt: ${insp.length}${insp.length ? ` (${Object.entries(byResult).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}`,
        `- davon Nachprüfungen: ${insp.filter((i) => i.purpose === 'follow_up').length}`,
        `- Prüfquote heute: ${pct(el - overdue - never, el)} von ${el} Elementen nicht überfällig (${overdue} überfällig, ${never} nie geprüft)`,
        '',
        'Mängel',
        `- neu: ${newD.length} (${bySev(newD)}); davon aus Begehungen: ${newD.filter((d) => d.walkthroughId).length}`,
        `- behoben: ${fixed.length}${durations.length ? `, im Mittel nach ${(durations.reduce((m, v) => m + v, 0) / durations.length).toFixed(1).replace('.', ',')} Tagen` : ''}`,
        `- offen heute: ${openNow.length} (${bySev(openNow)}); ohne Aufgabe: ${openNow.filter((d) => !d.taskStatus || d.taskStatus === 'done' || d.taskStatus === 'cancelled').length}`,
        '',
        'Aufgaben',
        `- offen: ${ts.length}, davon überfällig: ${lateTasks.length}`,
        '',
        'Begehungen',
        `- durchgeführt: ${wk.length}${wk.length ? ` (${wk.map((w) => `${day(w.inspectedAt)} ${s(w.propertyName)}`).join('; ')})` : ''}`,
      ].join('\n');
    },
  },
];

/** Fehlertext für das Modell: was schiefging und was stattdessen geht. */
export function errorText(e: unknown): string {
  if (e instanceof ToolError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 403)
      return `Keine Berechtigung: ${e.message}. Dieser Zugang darf das nicht (z. B. Schlüssel „Nur lesen“, kein Recht zum Anlegen oder Admin-Funktion). Schreiben geht mit einem Schlüssel „Lesen und schreiben“ (Prüfkompass → Einstellungen → API); Admin-Funktionen nur in der App.`;
    if (e.status === 404) return `${e.message} – nicht vorhanden oder außerhalb deines Zugriffsbereichs. Mit search oder list nachsehen.`;
    if (e.status === 409) return `${e.message}.`;
    if (e.status === 429) return `${e.message} (zu viele Anfragen).`;
    return e.message;
  }
  console.error('mcp tool', e);
  return 'Interner Fehler – bitte später erneut versuchen.';
}

export function b64(buf: ArrayBuffer) {
  let out = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Werkzeug ausführen und als MCP-Ergebnis verpacken. */
export async function runTool(tool: Tool, args: Json, api: Api, raw: ApiRaw) {
  let cats: Promise<CategoryInfo[]> | null = null;
  const x: Ctx = { api, raw, categories: () => (cats ??= api({ method: 'GET', path: '/categories' }) as Promise<CategoryInfo[]>) };
  try {
    const out = await tool.run(args ?? {}, x);
    if (typeof out === 'string') return { content: [{ type: 'text', text: out }], isError: false };
    if ('content' in out && Array.isArray(out.content)) return { content: out.content, isError: false };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false };
  } catch (e) {
    return { content: [{ type: 'text', text: `Fehler: ${errorText(e)}` }], isError: true };
  }
}
