// Werkzeuge des MCP-Servers – nach Absicht geschnitten, nicht nach Tabellen (docs/plan/v4.md, 2.1 und 8.3).
// Jedes Werkzeug ruft die normale API mit dem Schlüssel/Token des Aufrufs auf: Rollen, Lese-/Schreibrecht,
// Zugriffsbereich und „darf anlegen“ gelten dadurch unverändert. Antworten sind knapp und nennen Codes und
// Namen statt interner IDs – IDs nur dort, wo ein Folgeaufruf sie braucht.
import { allOkAnswers, conditionOf, conditionReason } from "../shared/applies";
import { validateAttributes, withLegacyDoorFields } from "../shared/asset-fields";
import { SEVERITIES, type Severity } from "../shared/catalog";
import { parseCategory } from "../shared/importing";
import { groupCheckpoints } from "../shared/checkpoint-groups";
import {
  assignCheckpoint,
  matchMaintenance,
  workContradiction,
} from "../shared/inspect-match";
import { type Answer, computeResult } from "../shared/logic";
import {
  matchCheckpoint,
  similarity,
  suggestMeasure,
  suggestSeverity,
} from "../shared/smart";
import {
  describeByType,
  type CatalogDefect,
  type CatalogProduct,
  expandTerms,
  foldText,
  matchCatalogDefects,
  parseElementRef,
  suggestProducts,
} from "../shared/vocab";
import { dayIn, monthRange } from "../shared/dates";
import { normalizeOffer, offerText } from "../shared/offer";
import {
  announcedAssetBody,
  findAnnounced,
  matchProductType,
  productLabel,
  RAW_SOURCE_LABEL,
  type RawNote,
} from "../shared/announce";
import { expandCatalogDefects, splitFindings } from "../shared/duplicates";
import {
  dateArg,
  fmt,
  resolvePerson,
  roleLabel,
  team as teamOf,
  tzOf,
  walkthroughsDue,
} from "./mcp-help";

export type Json = Record<string, unknown>;
export type Call = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};
/** Antwort der API als JSON; Fehler werfen ApiError. */
export type Api = (c: Call) => Promise<unknown>;
/** Rohdaten (z. B. Fotos) – Fehler werfen ApiError. */
export type ApiRaw = (
  path: string,
) => Promise<{ body: ArrayBuffer; type: string }>;

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
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
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
  prefix: string;
  norm: string;
  intervalMonths: number;
  checkpoints: CheckpointInfo[];
  attributes: {
    key: string;
    label: string;
    type?: "text" | "number" | "date" | "select" | "boolean";
    options?: string[];
  }[];
  maintenance: { key: string; label: string }[];
  schedulesEffective?: {
    key: string;
    label: string;
    checkpoints: CheckpointInfo[];
  }[];
}
interface CheckpointInfo {
  id: string;
  label: string;
  group?: string;
  appliesIf?: { attr: string; equals?: string | boolean; in?: string[] };
}

// ---------- Schema-Bausteine ----------
const str = (description: string, extra: Json = {}) => ({
  type: "string",
  description,
  ...extra,
});
const int = (description: string, minimum: number, maximum: number) => ({
  type: "integer",
  description,
  minimum,
  maximum,
});
const bool = (description: string) => ({ type: "boolean", description });
const arr = (items: Json, description: string, maxItems = 50) => ({
  type: "array",
  items,
  description,
  maxItems,
});
const obj = (
  properties: Json,
  required: string[] = [],
  description?: string,
) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties,
  required,
  additionalProperties: false,
});
const SEVERITY = str(
  "Schwere: low = optisch/gering, medium = Funktion eingeschränkt, high = Schutzfunktion gefährdet, critical = Gefahr im Verzug",
  {
    enum: ["low", "medium", "high", "critical"],
  },
);

// ---------- Hilfen ----------
const enc = encodeURIComponent;
const TZ = "Europe/Berlin";
const dayFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ,
  dateStyle: "short",
  timeStyle: "short",
});
/** Datum als JJJJ-MM-TT (Zeitzone Berlin) */
const day = (ms: unknown) =>
  typeof ms === "number" && ms > 0 ? dayFmt.format(ms) : null;
const dayTime = (ms: unknown) =>
  typeof ms === "number" && ms > 0 ? timeFmt.format(ms) : null;
// Datumseingaben: dateArg (worker/mcp-help.ts, shared/dates.ts) – streng, relativ, in der Zeitzone des Workspaces
const sev = (s: unknown) => SEVERITIES[s as Severity] ?? String(s ?? "");
/** Schwere mit Schlüssel und Wort (Plan v6, E6): {severity: "medium", severityLabel: "Mittel"} */
const sevOut = (v: unknown) => ({ severity: s(v), severityLabel: sev(v) });
/** Ein Hinweistext fürs Unterschreiben (Plan v6, E8) */
const SIGN_HINT = "In der App: Prüfen → Unterschreiben";
/** Status einer Prüfung (Plan v6, E7): draft = Entwurf, ready = wartet auf Unterschrift, submitted = abgeschlossen */
const inspStatus = (i: { status?: unknown; readyAt?: unknown }) =>
  i.status === "submitted" ? "submitted" : i.readyAt ? "ready" : "draft";
const INSP_STATUS: Record<string, string> = {
  draft: "Entwurf",
  ready: "wartet auf Unterschrift",
  submitted: "abgeschlossen",
};
const RESULT: Record<string, string> = {
  ok: "ohne Mängel",
  defects: "mit Mängeln",
  critical: "kritisch",
  not_inspectable: "nicht prüfbar",
};
const TASK_STATUS: Record<string, string> = {
  open: "offen",
  in_progress: "in Arbeit",
  done: "erledigt",
  cancelled: "abgebrochen",
};
const PRIO: Record<string, string> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};
const s = (v: unknown) => (v == null ? "" : String(v));
const lc = (v: unknown) => s(v).trim().toLowerCase();
/** Leere Felder weglassen – kürzere Antworten */
function compact<T extends Json>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) =>
        v !== null &&
        v !== undefined &&
        v !== "" &&
        !(Array.isArray(v) && !v.length),
    ),
  ) as T;
}
const clamp = (v: unknown, min: number, max: number, def: number) =>
  Math.min(
    max,
    Math.max(
      min,
      Number.isFinite(Number(v)) && v != null ? Math.round(Number(v)) : def,
    ),
  );
const list = (v: unknown): Json[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as Json[])
    : [];

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
    // Plan v7: feste Synonyme („Feuerschutztür“ → Tür, „Türantrieb“ → Drehtürantrieb) vor der Teilwort-Suche
    cats.find((c) => c.key === parseCategory(s(v), cats)) ??
    cats.find(
      (c) =>
        lc(c.label).includes(q) ||
        q.includes(lc(c.label)) ||
        lc(c.plural).includes(q),
    );
  if (!hit)
    throw new ToolError(
      `Elementart „${s(v)}“ unbekannt. Möglich: ${cats.map((c) => `${c.key} (${c.label})`).join(", ")}.`,
    );
  return hit;
}

/**
 * Element per Code oder Etikett → ID. Versteht auch laufende Nummern wie „Tür 36“, „Nummer 36“ oder „36“
 * (shared/vocab.ts): mit `property` im Objekt, sonst nur, wenn die Nummer im Workspace eindeutig ist.
 */
async function assetId(x: Ctx, code: unknown, property?: unknown): Promise<string> {
  const c = s(code).trim();
  if (!c)
    throw new ToolError(
      'Element-Code fehlt, z. B. „FST-001“ oder „Tür 36“ mit property. Codes liefert search oder list(what: "assets").',
    );
  const cats = await x.categories();
  const ref = parseElementRef(
    c,
    cats.map((k) => ({ key: k.key, label: k.label, plural: k.plural, prefix: k.prefix })),
  );
  const prop = ref && lc(property) ? await resolveProperty(x, property) : null;
  try {
    return (
      (await x.api({
        method: "GET",
        path: `/assets/by-code/${enc(c)}${prop ? `?propertyId=${enc(prop.id)}` : ""}`,
      })) as { id: string }
    ).id;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    // Plan v6 A1: „Tür 4“, aber Nr. 4 ist ein Feuerlöscher – nie still das falsche Element
    if (/^Nummer \d+ ist /.test(e.message))
      throw new ToolError(
        `${e.message} – „${c}“ passt nicht. Bitte Art und Nummer prüfen oder den Code nennen.`,
      );
  }
  if (ref) {
    // ohne Objekt: Nummer im ganzen Workspace – nur eindeutig verwendbar, Art muss passen
    const r = (await x.api({
      method: "GET",
      path: `/search?q=${enc(c)}${prop ? `&propertyId=${enc(prop.id)}` : ""}`,
    })) as { assets: Json[]; refHint?: string };
    const hits = r.assets.filter(
      (a) =>
        a.number === ref.number &&
        (!ref.category || a.category === ref.category),
    );
    if (!hits.length && r.refHint)
      throw new ToolError(
        `${r.refHint} – „${c}“ passt nicht. Bitte Art und Nummer prüfen oder den Code nennen.`,
      );
    if (hits.length === 1) return s(hits[0].id);
    if (hits.length > 1)
      throw new ToolError(
        `„${c}“ gibt es in mehreren Objekten: ${hits
          .slice(0, 8)
          .map((a) => `${s(a.code)} (${s(a.propertyName)})`)
          .join(", ")}. Bitte den Code nennen oder \`property\` angeben.`,
      );
  }
  throw new ToolError(
    `Kein Element „${c}“. Mit search nach Standort, Art, Nummer oder Code-Teil suchen.`,
  );
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

function pickOne<T extends { id: string; name: string }>(
  rows: T[],
  q: unknown,
  what: string,
  hint: string,
): T {
  const v = lc(q);
  if (!v) throw new ToolError(`${what} fehlt. ${hint}`);
  const exact = rows.filter((r) => r.id === s(q) || lc(r.name) === v);
  if (exact.length === 1) return exact[0];
  const part = exact.length
    ? exact
    : rows.filter((r) => lc(r.name).includes(v));
  if (part.length === 1) return part[0];
  if (!part.length)
    throw new ToolError(`${what} „${s(q)}“ nicht gefunden. ${hint}`);
  throw new ToolError(
    `${what} „${s(q)}“ ist mehrdeutig: ${part
      .slice(0, 10)
      .map((r) => r.name)
      .join(", ")}. Bitte genauer angeben.`,
  );
}

const properties = (x: Ctx) =>
  x.api({ method: "GET", path: "/properties" }) as Promise<PropertyRow[]>;
async function resolveProperty(x: Ctx, q: unknown) {
  return pickOne(
    await properties(x),
    q,
    "Objekt",
    'Objekte liefert search(type: "properties").',
  );
}

/** Gebäude per Name oder ID; ohne Treffer auch per Objektname, wenn das Objekt genau ein Gebäude hat. */
async function resolveBuilding(x: Ctx, q: unknown, propertyHint?: unknown) {
  const [bs, ps] = await Promise.all([
    x.api({ method: "GET", path: "/buildings" }) as Promise<BuildingRow[]>,
    properties(x),
  ]);
  const pName = new Map(ps.map((p) => [p.id, p.name]));
  if (!lc(q))
    throw new ToolError(
      'Gebäude fehlt (`building`), z. B. „Haupthaus“. Gebäude stehen in get(kind: "property").',
    );
  let pool = bs;
  if (propertyHint) {
    const p = pickOne(
      ps,
      propertyHint,
      "Objekt",
      'Objekte liefert search(type: "properties").',
    );
    pool = bs.filter((b) => b.propertyId === p.id);
  }
  const v = lc(q);
  const byName = pool.filter(
    (b) =>
      b.id === s(q) ||
      lc(b.name) === v ||
      lc(b.name).includes(v) ||
      `${lc(pName.get(b.propertyId))} ${lc(b.name)}`.includes(v),
  );
  if (byName.length === 1)
    return {
      ...byName[0],
      propertyName: pName.get(byName[0].propertyId) ?? "",
    };
  const exact = byName.filter((b) => lc(b.name) === v || b.id === s(q));
  if (exact.length === 1)
    return { ...exact[0], propertyName: pName.get(exact[0].propertyId) ?? "" };
  if (!byName.length) {
    const viaProp = ps.filter((p) => lc(p.name).includes(v));
    const only =
      viaProp.length === 1
        ? pool.filter((b) => b.propertyId === viaProp[0].id)
        : [];
    if (only.length === 1) return { ...only[0], propertyName: viaProp[0].name };
    if (only.length > 1)
      throw new ToolError(
        `Objekt „${viaProp[0].name}“ hat mehrere Gebäude: ${only.map((b) => b.name).join(", ")}. Bitte eines nennen.`,
      );
    throw new ToolError(
      `Gebäude „${s(q)}“ nicht gefunden. Gebäude stehen in get(kind: "property").`,
    );
  }
  throw new ToolError(
    `Gebäude „${s(q)}“ ist mehrdeutig: ${byName
      .slice(0, 10)
      .map((b) => `${b.name} (${pName.get(b.propertyId)})`)
      .join(", ")}. Bitte genauer angeben.`,
  );
}

/**
 * Gebäude ohne Angabe (v6 C2): hat das Objekt (bzw. ohne Objekt der ganze Zugriffsbereich) genau ein Gebäude, gilt
 * dieses – sonst Fehler mit Auswahl.
 */
async function onlyBuilding(x: Ctx, propertyHint?: unknown) {
  const [bs, ps] = await Promise.all([
    x.api({ method: "GET", path: "/buildings" }) as Promise<BuildingRow[]>,
    properties(x),
  ]);
  const prop = lc(propertyHint)
    ? pickOne(ps, propertyHint, "Objekt", 'Objekte liefert search(type: "properties").')
    : null;
  const pool = prop ? bs.filter((b) => b.propertyId === prop.id) : bs;
  const pName = new Map(ps.map((p) => [p.id, p.name]));
  if (pool.length === 1)
    return { ...pool[0], propertyName: pName.get(pool[0].propertyId) ?? "" };
  if (!pool.length)
    throw new ToolError(
      prop
        ? `Objekt „${prop.name}“ hat noch kein Gebäude. Mit setup anlegen (oder in der App).`
        : "Kein Gebäude im Zugriffsbereich. Mit setup Objekt und Gebäude anlegen.",
    );
  throw new ToolError(
    `Welches Gebäude? ${prop ? `„${prop.name}“ hat` : "Es gibt"} mehrere: ${pool
      .slice(0, 10)
      .map((b) => (prop ? b.name : `${b.name} (${pName.get(b.propertyId)})`))
      .join(", ")}. Bitte \`building\` angeben.`,
  );
}

/** Verweis auf ein Bild für get_photo */
const photoRef = (key: unknown) => (key ? `foto:${s(key)}` : null);
const planRef = (id: unknown) => (id ? `plan:${s(id)}` : null);

// ---------- „Jetzt“-Liste ----------
/** Die „Jetzt“-Warteschlange der App (GET /now): je Zeile eine Aktion, nach Dringlichkeit. */
async function nowQueue(x: Ctx, max = 12): Promise<Json[]> {
  const n = (await x.api({ method: "GET", path: "/now" })) as {
    items?: Json[];
  };
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
    nextDue: day(a.nextDueAt) ?? "nie geprüft",
    last: a.lastResult
      ? `${day(a.lastInspectedAt)} ${RESULT[s(a.lastResult)] ?? a.lastResult}`
      : null,
    openDefects: Number(a.openDefects) || null,
  });
}
const defectLine = (d: Json) =>
  compact({
    defectId: d.id,
    title: d.title,
    ...sevOut(d.severity),
    status: DEFECT_STATUS[s(d.status)] ?? "offen",
    at: d.code
      ? `${d.code}${d.location ? ` (${d.location})` : ""}`
      : "Objekt/Begehung",
    property: d.propertyName,
    since: day(d.createdAt),
    // „keine Aufgabe“ nach derselben Regel wie Autopilot und Bericht (v6 B3: wieder geöffnet → neue Aufgabe nötig)
    task:
      d.status === "open" && d.withoutTask
        ? "keine Aufgabe"
        : d.taskStatus
          ? TASK_STATUS[s(d.taskStatus)]
          : d.status === "open"
            ? "keine Aufgabe"
            : null,
    invalidReason: d.status === "invalid" ? d.invalidReason : null,
  });
const DEFECT_STATUS: Record<string, string> = {
  open: "offen",
  resolved: "behoben",
  invalid: "ungültig",
};
const taskLine = (t: Json, n = Date.now()) =>
  compact({
    taskId: t.id,
    title: t.title,
    status: TASK_STATUS[s(t.status)] ?? t.status,
    priority: PRIO[s(t.priority)] ?? t.priority,
    due: day(t.dueAt),
    overdue:
      (t.status === "open" || t.status === "in_progress") &&
      typeof t.dueAt === "number" &&
      t.dueAt < n
        ? true
        : null,
    assignee: t.assigneeName ?? t.subcontractorName ?? "niemand",
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
  knownDefects: {
    id: string;
    checkpointId: string | null;
    title: string;
    note: string;
    measure: string;
    severity: Severity;
    createdAt: number;
  }[];
  photos: Json[];
  signerName: string;
  signature: string | null;
  readyAt: number | null;
  asset: { code: string; category: string; location: string };
  rawNotes?: RawNote[];
}

/**
 * Tür per Nummer und Typ (Plan v7 W): im Objekt finden (Nummer, auch alter Code mit dieser Zahl) oder anlegen –
 * feste Nummer, Standort „Raum <Nr.>“, Stammdaten aus dem Katalog-Typ. Unbekannter Typ: Tür mit Typ „unbekannt“,
 * allgemeine Checkliste, der genannte Typ wird Rohnotiz. Anlegen braucht wie capture das Recht „darf anlegen“.
 */
async function announceAsset(
  x: Ctx,
  a: Json,
): Promise<{
  id: string;
  created: string | null;
  typeNote: string | null;
  general: boolean;
  rawNote: Json | null;
}> {
  const n = Number(a.number);
  if (!Number.isInteger(n) || n < 1 || n > 99999)
    throw new ToolError("`number` muss eine ganze Zahl von 1 bis 99999 sein (die Türnummer, z. B. 354).");
  if (!lc(a.property) && !lc(a.building))
    throw new ToolError(
      "Zu `number` gehört `property` (Objekt), z. B. {number: 354, type: \"SK32\", property: \"Hotel Seeblick\"}.",
    );
  const prop = lc(a.property) ? await resolveProperty(x, a.property) : null;
  const cats = await x.categories();
  const label = (k: string) => cats.find((c) => c.key === k)?.label ?? k;
  const typeText = s(a.type).trim();
  const catalog = (await x
    .api({ method: "GET", path: "/catalog" })
    .catch(() => ({ products: [] }))) as { products?: CatalogProduct[] };
  const products = catalog.products ?? [];
  const m = typeText ? matchProductType(typeText, products, "fire_door") : null;
  if (m && !m.product && m.candidates.length > 1)
    throw new ToolError(
      `Typ „${typeText}“ ist mehrdeutig: ${m.candidates.map((p) => productLabel(p)).join("; ")}. Bitte genauer nennen (Hersteller und Typ). Nichts angelegt.`,
    );
  const product = (m?.product ?? null) as CatalogProduct | null;
  const category = product?.category || "fire_door";
  // im Objekt suchen: alle Elemente mit dieser Nummer (Art muss passen, sonst Hinweis wie Plan v6 A1)
  const building = lc(a.building)
    ? await resolveBuilding(x, a.building, a.property)
    : null;
  const propertyId = prop?.id ?? building?.propertyId ?? "";
  const rows = (await x.api({
    method: "GET",
    path: `/assets?propertyId=${enc(propertyId)}`,
  })) as { id: string; code: string; number: number | null; category: string; model?: string }[];
  const hit = findAnnounced(n, rows, category, label);
  if (hit && "conflict" in hit)
    throw new ToolError(`${hit.conflict} – „Tür ${n}“ passt nicht. Bitte Nummer prüfen. Nichts angelegt.`);
  const unknownType = !!typeText && !product;
  const rawNote = unknownType
    ? {
        id: crypto.randomUUID().replace(/-/g, "").slice(0, 20),
        text: `Typ „${typeText}“ – nicht im Katalog`,
        at: Date.now(),
        source: "mcp",
        kind: "type",
      }
    : null;
  if (hit) {
    const cur = s((hit.asset as { model?: string }).model);
    const typeNote =
      product && cur && foldText(cur) !== foldText(product.model)
        ? `Am Element steht Typ „${cur}“, genannt wurde „${productLabel(product)}“ – Stammdaten bleiben; ändern mit update_asset.`
        : null;
    return { id: hit.asset.id, created: null, typeNote, general: false, rawNote };
  }
  const b = building ?? (await onlyBuilding(x, prop?.name ?? a.property));
  const cat = cats.find((c) => c.key === category);
  const body = announcedAssetBody(
    { number: n, location: s(a.location).trim() || `Raum ${n}` },
    product,
    cat?.attributes ?? [],
    category,
  );
  let created: { id: string; code: string };
  try {
    created = (await x.api({
      method: "POST",
      path: "/assets",
      body: { buildingId: b.id, ...body, floor: s(a.floor).trim() },
    })) as { id: string; code: string };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403)
      throw new ToolError(
        "Neue Elemente anlegen darf diese Verbindung nicht (Recht „darf anlegen“ fehlt). Nichts angelegt.",
      );
    throw e;
  }
  return {
    id: created.id,
    created: `${created.code} angelegt (Nr. ${n}, ${body.location}${product ? `, ${productLabel(product)}` : ", Typ unbekannt – allgemeine Checkliste"})`,
    typeNote: unknownType
      ? `Typ „${typeText}“ steht nicht im Katalog – als Rohnotiz gespeichert; mit catalog anlegen und update_asset nachtragen.`
      : !typeText
        ? "Kein Typ genannt – Typ „unbekannt“, allgemeine Checkliste."
        : null,
    general: !product,
    rawNote,
  };
}

/** Kurzform der Stammdaten (nur gesetzte Felder) für Listen. */
function attrsShort(cat: CategoryInfo | undefined, attrs: Json): string {
  return (cat?.attributes ?? [])
    .filter((f) => attrs[f.key] != null && attrs[f.key] !== "")
    .slice(0, 10)
    .map((f) => `${f.label}: ${attrs[f.key] === true ? "ja" : attrs[f.key] === false ? "nein" : s(attrs[f.key])}`)
    .join(", ");
}

/** Prüfpunkt aus Nummer („3“), ID („p3“), Bezeichnungsteil oder – als Rückfall – aus dem Text. */
function findCheckpoint(
  cps: { id: string; label: string }[],
  ref: unknown,
  text = "",
): string | null {
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

/** Grund, warum Punkte entfallen (für die Kurzfassung) */
/** Grund, warum Punkte entfallen (Plan v7: Anforderung, Ausstattung – shared/applies.ts) */
const naReason = (cond: Parameters<typeof conditionReason>[0]) => conditionReason(cond);

/**
 * Prüfpunkte als Gruppen-Kurzfassung (Plan v6, C5) – zum Vorlesen statt 8–20 Punkten im Volltext. Dazu, was nach den
 * Stammdaten entfällt, und die Rückfragen bei fehlendem Stammdatum (A4). Mit `detail` zusätzlich der Volltext.
 */
function checkpointBrief(
  cps: CheckpointInfo[],
  category: string,
  attrs: Json,
  detail = false,
) {
  const r = allOkAnswers(cps, {}, category, attrs);
  const groups = groupCheckpoints(cps);
  const reasons = new Set(
    r.na.map((id) => {
      const c = conditionOf(cps.find((k) => k.id === id)!, category)!;
      return naReason(c);
    }),
  );
  return compact({
    checkpoints:
      groups.length === 1
        ? `${cps.length} Prüfpunkte`
        : `${cps.length} Prüfpunkte in ${groups.length} Gruppen: ${groups.map((g) => `${g.label} (${g.items.length})`).join(", ")}`,
    notApplicable: r.na.length
      ? `${r.na.length} ${r.na.length === 1 ? "Punkt entfällt" : "Punkte entfallen"} (${[...reasons].join(", ")})`
      : null,
    askFirst: [...new Set(r.unknown.map((u) => u.question))],
    checkpointList: detail
      ? cps.map(
          (c, n) =>
            `${n + 1}. ${c.label}${r.na.includes(c.id) ? " (entfällt)" : r.unknown.some((u) => u.id === c.id) ? " (nur wenn zutreffend)" : ""}`,
        )
      : null,
  });
}

/** Prüfpunkte des nächsten fälligen Prüfplans eines Elements (Hauptprüfung, sonst der früheste). */
function scheduleCheckpoints(cat: CategoryInfo | undefined, detail: Json) {
  const sched = (detail.schedules ?? {}) as Record<
    string,
    { enabled?: boolean; nextDueAt?: number | null }
  >;
  const key = Object.entries(sched)
    .filter(([, v]) => v?.enabled)
    .sort((p, q) => (p[1].nextDueAt ?? 0) - (q[1].nextDueAt ?? 0))[0]?.[0];
  return (
    cat?.schedulesEffective?.find((sc) => sc.key === key)?.checkpoints ??
    cat?.checkpoints ??
    []
  );
}

/** Stammdaten prüfen (Plan v6, D1) – Fehler als ToolError mit allen Feldern auf einmal. */
function checkedFields(cat: CategoryInfo | undefined, input: Json) {
  const r = validateAttributes(
    (cat?.attributes ?? []).map((f) => ({ ...f })),
    input,
  );
  return r;
}
/** v6 E9: ein Satz für alles, was nur Admins in der App dürfen. */
const ADMIN_ONLY = "Das können nur Admins in der App.";

const NEW_STRUCTURE_NOTE =
  "neue Objekte und Gebäude anlegen darf dieser Zugang nicht – dafür braucht es einen Schreib-Schlüssel einer Admin- oder Inhaber-Person (oder in der App: Objekte → Neu).";
const NEW_STRUCTURE_HINT = (what: string) =>
  `${what} konnte nicht angelegt werden: Neue Objekte und Gebäude legt nur ein Schreib-Schlüssel einer Admin- oder Inhaber-Person an (oder ein Admin in der App: Objekte → Neu). Danach setup erneut aufrufen – Elemente legt es dann an.`;

/**
 * Darf dieser Zugang neue Objekte/Gebäude anlegen (Befund #33)? Prüft ohne zu schreiben: Die Route prüft das
 * Recht vor dem Inhalt – ein leerer Name ergibt mit Recht 400, ohne Recht 403.
 */
async function canCreateStructure(x: Ctx) {
  try {
    await x.api({ method: "POST", path: "/properties", body: { name: "" } });
    return true; // nicht erreichbar (leerer Name wird abgelehnt) – zur Sicherheit trotzdem „ja“
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return false;
    if (e instanceof ApiError && e.status === 400) return true;
    throw e;
  }
}

/** Wirksame Stufe des Autopilot-Schritts „Nachprüfen“ (off, wenn der Autopilot aus ist). */
async function verifyMode(x: Ctx): Promise<string> {
  const steps = (await x.api({ method: "GET", path: "/automation" }).catch(() => [])) as Json[];
  return s(steps.find((v) => v.key === "verify_repairs")?.effectiveMode) || "off";
}

// ---------- Werkzeuge ----------
export const TOOLS: Tool[] = [
  {
    name: "briefing",
    title: "Lagebild",
    description:
      "Die Lage in einem Aufruf – der beste Einstieg ins Gespräch („Was steht heute an?“). Ganz oben `attention`: kritische und hohe Befunde in Prüfungen, die zur Unterschrift bereitliegen (noch kein Mangel – erst mit der Unterschrift in der App). Dann Kennzahlen (überfällig, bald fällig, nie geprüft, offene Mängel, kritische Mängel getrennt nach offen und wartend auf Unterschrift, offene Aufgaben, fällige Begehungen), die „Jetzt“-Liste (höchstens 12 Dinge, die eine Entscheidung oder Handlung brauchen, dringendstes zuerst), wie viele Prüfungen auf die Unterschrift warten, und was der Autopilot seit `since` getan hat (Standard: letzte 7 Tage). Zeiten ohne Zone gelten in der Zeitzone des Workspaces. Nur lesend.",
    inputSchema: obj({
      since: str(
        "Autopilot-Protokoll ab diesem Zeitpunkt, z. B. das letzte Briefing: „2026-11-10“, „2026-11-10T07:30“ (Ortszeit des Workspaces) oder „gestern“",
      ),
    }),
    readOnly: true,
    run: async (a, x) => {
      const f = await fmt(x);
      const since =
        (await dateArg(x, a.since, "since", { allowPast: true, time: "start" })) ??
        Date.now() - 7 * 86_400_000;
      const [dash, now, log, ready, findings, walks, dictation] = await Promise.all([
        x.api({ method: "GET", path: "/dashboard" }) as Promise<{
          counts: Json;
          tasks: Json[];
        }>,
        nowQueue(x),
        x.api({ method: "GET", path: "/automation/log?limit=200" }) as Promise<
          Json[]
        >,
        x
          .api({ method: "GET", path: "/inspections?status=ready" })
          .catch(() => []) as Promise<Json[]>,
        x
          .api({ method: "GET", path: "/inspections/pending-findings" })
          .catch(() => []) as Promise<Json[]>,
        walkthroughsDue(x),
        x
          .api({ method: "GET", path: "/inspections/raw-notes" })
          .catch(() => []) as Promise<Json[]>,
      ]);
      const c = dash.counts;
      const entries = log.filter((e) => Number(e.at) >= since);
      const critWaiting = findings.filter((d) => d.severity === "critical").length;
      const highWaiting = findings.length - critWaiting;
      return {
        asOf: f.dayTime(Date.now()),
        ...(findings.length
          ? {
              attention: {
                text: `${findings.length === 1 ? `Ein ${critWaiting ? "kritischer" : "hoher"} Befund wartet` : `${findings.length} ${critWaiting ? (highWaiting ? "kritische/hohe" : "kritische") : "hohe"} Befunde warten`} auf Unterschrift – bis dahin ist es kein Mangel und hat keine Aufgabe.`,
                criticalWaitingForSignature: critWaiting,
                highWaitingForSignature: highWaiting,
                findings: findings.slice(0, 20).map((d) =>
                  compact({
                    element: `${s(d.code)}${d.location ? ` (${s(d.location)})` : ""}`,
                    property: d.propertyName,
                    finding: d.title,
                    severity: d.severity,
                    severityLabel: sev(d.severity),
                    readyBy: d.inspector,
                    readySince: f.dayTime(d.readyAt),
                    inspectionId: d.inspectionId,
                  }),
                ),
                hint: "In der App: Prüfen → Unterschreiben (nur die prüfende Person).",
              },
            }
          : {}),
        counts: compact({
          properties: c.properties,
          elements: c.assets,
          overdue: c.overdue,
          dueWithin30Days: c.soon,
          neverInspected: c.never,
          notInspectable: c.notInspectable,
          openDefects:
            Number(c.openDefects ?? 0) + Number(c.openWalkDefects ?? 0),
          criticalDefects: {
            open: Number(c.criticalDefects ?? 0),
            waitingForSignature: critWaiting,
          },
          inspectionsLast30Days: c.inspections30d,
          drafts: c.drafts,
          walkthroughsDue: walks.length || null,
        }),
        readyToSign: ready.length
          ? `${ready.length} ${ready.length === 1 ? "Prüfung wartet" : "Prüfungen warten"} in der App auf die Unterschrift`
          : 0,
        // Plan v7 W: Rohdiktat (Tastatur-Diktat ohne Netz, Ansagen) wartet auf Auswertung durch Claude
        ...(dictation.length
          ? {
              dictation: {
                text: `${dictation.length} ${dictation.length === 1 ? "Prüfung mit unausgewertetem Diktat" : "Prüfungen mit unausgewertetem Diktat"}`,
                inspections: dictation.length,
                notes: dictation.reduce((n, r) => n + (Number(r.pending) || 0), 0),
                hint: 'Lesen mit list(what: "raw_notes"), auswerten mit inspect (inspection, Befunde, evaluated: true).',
              },
            }
          : {}),
        now,
        autopilot: {
          since: f.dayTime(since),
          entries: entries
            .slice(0, 30)
            .map((e) =>
              compact({
                id: e.id,
                at: f.dayTime(e.at),
                step: e.title,
                summary: e.summary,
                undone: e.undoneAt ? true : null,
                undoable: !!e.undoable,
              }),
            ),
          ...(entries.length > 30 ? { more: entries.length - 30 } : {}),
        },
      };
    },
  },
  {
    name: "search",
    title: "Suchen",
    description:
      'Suche über Elemente, Objekte, Gebäude, Mängel und Aufgaben (Code, Standort, Hersteller, Etikett, Titel). Ohne `query` und mit `type: "properties"` alle Objekte mit Prüfstatus; mit `type: "categories"` alle Elementarten mit Norm, Intervall und Prüfpunkten. Filter: `status` (Mängel/Aufgaben), `category` (Art, z. B. „Feuerlöscher“ oder extinguisher), `property` (Objektname). Beispiele: {query: "Treppenhaus Nord"}, {query: "Dichtung", type: "defects"}, {type: "properties"}.',
    inputSchema: obj({
      query: str(
        "Suchbegriff (mind. 2 Zeichen), z. B. „FST-7K“, „Keller“, „Hansen“",
      ),
      type: str("Worin suchen (Standard all)", {
        enum: [
          "all",
          "assets",
          "properties",
          "buildings",
          "defects",
          "tasks",
          "categories",
        ],
      }),
      status: str(
        "Mängel: open|resolved|all, Aufgaben: open|in_progress|done|cancelled|all (Standard: offen)",
        {
          enum: ["open", "in_progress", "resolved", "done", "cancelled", "all"],
        },
      ),
      category: str("Elementart (Schlüssel oder Bezeichnung)"),
      property: str("nur in diesem Objekt (Name)"),
    }),
    readOnly: true,
    run: async (a, x) => {
      const type = s(a.type) || "all";
      const q = lc(a.query);
      if (type === "categories") {
        const cats = await x.categories();
        return {
          categories: cats
            .filter((c) => !q || lc(c.label).includes(q) || c.key.includes(q))
            .map((c) =>
              compact({
                key: c.key,
                label: c.label,
                norm: c.norm,
                everyMonths: c.intervalMonths,
                checkpoints: c.checkpoints.length,
                fields: c.attributes.map((f) => f.key).join(", "),
              }),
            ),
        };
      }
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      const cat = a.category ? await resolveCategory(x, a.category) : null;
      if (type === "properties" && q.length < 2) {
        return {
          properties: (await properties(x)).map((p) =>
            compact({
              name: p.name,
              address: p.address,
              elements: p.assets,
              overdue: p.overdue,
              dueSoon: p.soon,
              neverInspected: p.never,
              openDefects: p.openDefects,
              nextWalkthrough: day(p.nextWalkAt),
            }),
          ),
        };
      }
      if (q.length < 2 && !cat && !prop)
        throw new ToolError(
          'Suchbegriff mit mindestens 2 Zeichen angeben – oder Filter `category`/`property`, oder type "properties"/"categories" für Übersichten.',
        );
      const out: Json = {};
      const want = (t: string) => type === "all" || type === t;
      // „Tür 36“ im Objekt: Nummern-Suche auch mit property (Plan v6, A1: Art muss passen)
      const isRef =
        q.length >= 1 &&
        !!parseElementRef(
          q,
          (await x.categories()).map((k) => ({
            key: k.key,
            label: k.label,
            plural: k.plural,
            prefix: k.prefix,
          })),
        );
      if (want("assets") || want("properties") || want("buildings")) {
        if (q.length >= 2 && !cat && (!prop || isRef)) {
          const r = (await x.api({
            method: "GET",
            path: `/search?q=${enc(q)}${prop ? `&propertyId=${enc(prop.id)}` : ""}`,
          })) as {
            properties: Json[];
            buildings: Json[];
            assets: Json[];
            refHint?: string;
          };
          if (prop) r.assets = r.assets.filter((e) => e.propertyName === prop.name);
          // „Tür 4“, aber Nr. 4 ist ein Feuerlöscher: Hinweis statt still eines anderen Elements
          if (r.refHint) out.hint = r.refHint;
          if (want("properties") && r.properties.length)
            out.properties = r.properties.map((p) =>
              compact({ name: p.name, address: p.address }),
            );
          if (want("buildings") && r.buildings.length)
            out.buildings = r.buildings.map((b) => ({
              name: b.name,
              property: b.propertyName,
            }));
          if (want("assets") && r.assets.length)
            out.assets = await Promise.all(
              r.assets.map((e) =>
                assetLine(x, {
                  ...e,
                  propertyName: e.propertyName,
                  buildingName: e.buildingName,
                }),
              ),
            );
        } else if (want("assets")) {
          const qs = new URLSearchParams();
          if (q.length >= 2) qs.set("q", q);
          if (cat) qs.set("category", cat.key);
          if (prop) qs.set("propertyId", prop.id);
          const rows = (await x.api({
            method: "GET",
            path: `/assets?${qs}`,
          })) as Json[];
          out.assets = await Promise.all(
            rows.slice(0, 50).map((e) => assetLine(x, e)),
          );
          if (rows.length > 50) out.moreAssets = rows.length - 50;
        }
      }
      if (want("defects")) {
        const st = ["resolved", "all"].includes(s(a.status))
          ? s(a.status)
          : "open";
        const rows = (
          (await x.api({
            method: "GET",
            path: `/defects?status=${st}`,
          })) as Json[]
        ).filter(
          (d) =>
            (!q ||
              `${lc(d.title)} ${lc(d.note)} ${lc(d.code)} ${lc(d.location)}`.includes(
                q,
              )) &&
            (!prop || d.propertyId === prop.id) &&
            (!cat || d.category === cat.key),
        );
        if (rows.length || type === "defects")
          out.defects = rows.slice(0, 30).map(defectLine);
        if (rows.length > 30) out.moreDefects = rows.length - 30;
      }
      if (want("tasks")) {
        const st = s(a.status);
        const rows = (
          (await x.api({ method: "GET", path: "/tasks" })) as Json[]
        ).filter(
          (t) =>
            (st === "all"
              ? true
              : ["open", "in_progress", "done", "cancelled"].includes(st)
                ? t.status === st
                : t.status === "open" || t.status === "in_progress") &&
            (!q ||
              `${lc(t.title)} ${lc(t.description)} ${lc(t.assetCode)}`.includes(
                q,
              )) &&
            (!prop || t.propertyId === prop.id),
        );
        if (rows.length || type === "tasks")
          out.tasks = rows.slice(0, 30).map((t) => taskLine(t));
        if (rows.length > 30) out.moreTasks = rows.length - 30;
      }
      if (!Object.keys(out).length)
        return {
          found: 0,
          hint: 'Nichts gefunden. Kürzeren Begriff oder Code-Teil versuchen, oder list(what: "assets", due: "overdue").',
        };
      return out;
    },
  },
  {
    name: "list",
    title: "Auflisten",
    description:
      'Listen mit Filtern. `what`: assets (Elemente mit Fälligkeit), defects (Mängel), tasks (Aufgaben), inspections (Prüfungen; status "ready" = wartet auf Unterschrift), walkthroughs (Begehungen), raw_notes (Prüfungen mit noch nicht ausgewertetem Rohdiktat: je Prüfung Element, Stammdaten-Kurzform, die Rohtexte mit noteId und die bisherige Zuordnung durch den Regel-Parser – auswerten mit inspect {inspection, …, evaluated: true}; `status: "all"` zeigt auch schon ausgewertete). Filter je nach Liste: `due` (assets: overdue|soon|never|defects|new|not_inspectable), `status`, `severity`, `category`, `property`, `building`, `from`/`to` (ISO, für inspections), `limit` (Standard 50). Beispiele: {what: "assets", due: "overdue", property: "Rathaus"}, {what: "defects", severity: "critical"}, {what: "tasks", status: "open"}.',
    inputSchema: obj(
      {
        what: str("Welche Liste", {
          enum: ["assets", "defects", "tasks", "inspections", "walkthroughs", "raw_notes"],
        }),
        due: str(
          "nur Elemente: overdue = überfällig, soon = in 30 Tagen fällig, never = nie geprüft, defects = mit offenen Mängeln, new = in 30 Tagen angelegt, not_inspectable = zuletzt nicht prüfbar",
          {
            enum: [
              "overdue",
              "soon",
              "never",
              "defects",
              "new",
              "not_inspectable",
            ],
          },
        ),
        status: str(
          "Mängel: open|resolved|invalid|all (invalid = ungültig: Duplikat/Fehleintrag); Aufgaben: open|in_progress|done|cancelled|active|all (Standard active = offen + in Arbeit); Prüfungen: submitted|draft|ready",
          {
            enum: [
              "open",
              "resolved",
              "invalid",
              "all",
              "in_progress",
              "done",
              "cancelled",
              "active",
              "submitted",
              "draft",
              "ready",
            ],
          },
        ),
        severity: SEVERITY,
        category: str("Elementart (Schlüssel oder Bezeichnung)"),
        property: str("Objektname"),
        building: str("Gebäudename (nur Elemente)"),
        from: str("ab Datum (nur inspections): ISO wie „2026-11-01“ (Ortszeit des Workspaces), „01.11.“ oder relativ wie „gestern“"),
        to: str("bis Datum einschließlich, nur inspections"),
        limit: int("höchstens so viele Einträge (Standard 50)", 1, 200),
      },
      ["what"],
    ),
    readOnly: true,
    run: async (a, x) => {
      const limit = clamp(a.limit, 1, 200, 50);
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      const cat = a.category ? await resolveCategory(x, a.category) : null;
      const cut = (rows: Json[], key: string) => ({
        total: rows.length,
        [key]: rows.slice(0, limit),
        ...(rows.length > limit
          ? {
              hint: `${rows.length - limit} weitere – Filter oder limit nutzen`,
            }
          : {}),
      });
      switch (a.what) {
        case "assets": {
          const b = a.building
            ? await resolveBuilding(x, a.building, a.property)
            : null;
          const qs = new URLSearchParams();
          if (a.due) qs.set("due", s(a.due));
          if (cat) qs.set("category", cat.key);
          if (prop) qs.set("propertyId", prop.id);
          if (b) qs.set("buildingId", b.id);
          const rows = (await x.api({
            method: "GET",
            path: `/assets?${qs}`,
          })) as Json[];
          return cut(
            await Promise.all(
              rows.slice(0, limit).map((r) => assetLine(x, r)),
            ).then((l) => [...l, ...rows.slice(limit)] as Json[]),
            "assets",
          );
        }
        case "defects": {
          const st = ["resolved", "invalid", "all"].includes(s(a.status))
            ? s(a.status)
            : "open";
          const rows = (
            (await x.api({
              method: "GET",
              path: `/defects?status=${st}`,
            })) as Json[]
          ).filter(
            (d) =>
              (!prop || d.propertyId === prop.id) &&
              (!a.severity || d.severity === a.severity) &&
              (!cat || d.category === cat.key),
          );
          return cut(rows.map(defectLine), "defects");
        }
        case "tasks": {
          const st = s(a.status) || "active";
          const rows = (
            (await x.api({ method: "GET", path: "/tasks" })) as Json[]
          ).filter(
            (t) =>
              (st === "all"
                ? true
                : st === "active"
                  ? t.status === "open" || t.status === "in_progress"
                  : t.status === st) &&
              (!prop || t.propertyId === prop.id),
          );
          return cut(
            rows.map((t) => taskLine(t)),
            "tasks",
          );
        }
        case "inspections": {
          const qs = new URLSearchParams();
          if (["submitted", "draft", "ready"].includes(s(a.status)))
            qs.set("status", s(a.status));
          if (prop) qs.set("propertyId", prop.id);
          if (cat) qs.set("category", cat.key);
          const from = await dateArg(x, a.from, "from", { allowPast: true, time: "start" });
          const to = await dateArg(x, a.to, "to", { allowPast: true, time: "end" });
          if (from) qs.set("from", String(from));
          if (to) qs.set("to", String(to));
          // Plan v6 E7: „draft“ nur Entwürfe, bereitgelegte haben den eigenen Status „ready“
          const rows = (
            (await x.api({
              method: "GET",
              path: `/inspections?${qs}`,
            })) as Json[]
          ).filter((i) => s(a.status) !== "draft" || !i.readyAt);
          return cut(
            await Promise.all(
              rows.map(async (i) =>
                compact({
                  inspectionId: i.id,
                  element: `${s(i.code)}${i.location ? ` (${i.location})` : ""}`,
                  art: await catLabel(x, i.category),
                  property: i.propertyName,
                  date: day(i.inspectedAt ?? i.createdAt),
                  status: inspStatus(i),
                  statusLabel: INSP_STATUS[inspStatus(i)],
                  result: i.result ? RESULT[s(i.result)] : null,
                  followUp: i.purpose === "follow_up" ? true : null,
                  inspector: i.inspector,
                }),
              ),
            ),
            "inspections",
          );
        }
        case "raw_notes": {
          const qs = new URLSearchParams();
          if (prop) qs.set("propertyId", prop.id);
          if (s(a.status) === "all") qs.set("all", "1");
          const rows = (await x.api({
            method: "GET",
            path: `/inspections/raw-notes?${qs}`,
          })) as Json[];
          const cats = await x.categories();
          const AN: Record<string, string> = { ok: "i. O.", defect: "Mangel", na: "entfällt" };
          return cut(
            rows.map((r) => {
              const cat = cats.find((c) => c.key === r.category);
              const cps = (r.checkpoints ?? []) as { id: string; label: string }[];
              const answers = (r.answers ?? {}) as Record<string, string>;
              const cpName = (id: unknown) => {
                const i = cps.findIndex((c) => c.id === id);
                return i >= 0 ? `${i + 1}. ${cps[i].label}` : null;
              };
              const counts = Object.values(answers).reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
              return compact({
                inspectionId: r.id,
                element: `${s(r.code)}${r.number != null ? ` (Nr. ${s(r.number)})` : ""}${r.location ? `, ${s(r.location)}` : ""}`,
                art: cat?.label ?? s(r.category),
                property: r.propertyName,
                type: [s(r.manufacturer), s(r.model)].filter(Boolean).join(" ") || null,
                data: attrsShort(cat, (r.attributes ?? {}) as Json) || null,
                status: r.status === "submitted" ? "submitted" : r.readyAt ? "ready" : "draft",
                statusLabel:
                  r.status === "submitted"
                    ? "abgeschlossen (unterschrieben) – nur noch als ausgewertet markieren"
                    : r.readyAt
                      ? "bereit zur Unterschrift"
                      : "Entwurf",
                date: day(r.inspectedAt ?? r.createdAt),
                inspector: r.inspector,
                rawNotes: ((r.rawNotes ?? []) as RawNote[])
                  .filter((nt) => s(a.status) === "all" || !nt.evaluated)
                  .map((nt) =>
                    compact({
                      noteId: nt.id,
                      text: nt.text,
                      at: dayTime(nt.at),
                      source: RAW_SOURCE_LABEL[nt.source] ?? nt.source,
                      kind: nt.kind === "announce" ? "Ansage" : nt.kind === "type" ? "Typ (nicht im Katalog)" : nt.kind === "finding" ? "Befund" : null,
                      parser: nt.summary ?? null,
                      critical: nt.critical ? "kritisches Wort erkannt" : null,
                      evaluated: nt.evaluated ? true : null,
                    }),
                  ),
                current: compact({
                  answers: Object.entries(counts)
                    .map(([k, v]) => `${v} ${AN[k] ?? k}`)
                    .join(", ") || "noch nichts bewertet",
                  open: cps.length - Object.keys(answers).length || null,
                  defects: ((r.defects ?? []) as Json[]).map((d) =>
                    compact({
                      title: d.title,
                      ...sevOut(d.severity),
                      checkpoint: cpName(d.checkpointId) ?? "ohne Prüfpunkt",
                      known: d.known ? "bekannter Mangel" : null,
                    }),
                  ),
                }),
              });
            }),
            "inspections",
          );
        }
        case "walkthroughs": {
          const rows = (
            (await x.api({ method: "GET", path: "/walkthroughs" })) as Json[]
          ).filter((w) => !prop || w.propertyId === prop.id);
          // v6 E4: fällige Begehungen aus derselben Quelle wie briefing.counts.walkthroughsDue
          const due = (await walkthroughsDue(x)).filter(
            (w) => !prop || w.propertyId === prop.id,
          );
          const dueList = due.map((w) =>
            compact({
              property: w.property,
              nextDue: day(w.nextDue) ?? "noch keine Begehung",
              overdue: w.overdue || null,
            }),
          );
          return {
            due: { total: due.length, properties: dueList },
            ...cut(
            rows.map((w) =>
              compact({
                walkthroughId: w.id,
                property: w.propertyName,
                building: w.buildingName,
                date: day(w.inspectedAt ?? w.createdAt),
                status: w.status === "draft" ? "Entwurf" : "abgeschlossen",
                result: w.result,
                openFindings: Number(w.openDefects) || null,
                nextDue: day(w.nextDueAt),
                inspector: w.inspector,
              }),
            ),
            "walkthroughs",
            ),
          };
        }
        default:
          throw new ToolError(
            "`what` muss assets, defects, tasks, inspections, walkthroughs oder raw_notes sein.",
          );
      }
    },
  },
  {
    name: "team",
    title: "Team",
    description:
      "Wer im Workspace Aufgaben übernehmen kann: Mitglieder mit Rolle (Inhaber, Admin, Prüfer, Lesezugriff) und E-Mail, dazu Partner (Subunternehmer, Firma und Gewerk), und wer „ich“ bin. Zuständige gibst du in capture und update_tasks per Name, E-Mail, „ich“ oder Partner-Firma an – aufgelöst über genau diese Liste. Nur lesend.",
    inputSchema: obj({
      query: str("nur Personen/Partner, deren Name, E-Mail oder Firma das enthält"),
    }),
    readOnly: true,
    run: async (a, x) => {
      const t = await teamOf(x);
      const q = lc(a.query);
      const hit = (...v: unknown[]) => !q || v.some((y) => lc(y).includes(q));
      const me = t.members.find((m) => m.id === t.me);
      return compact({
        me: me ? `${me.name} (${roleLabel(me.role)})` : null,
        members: t.members
          .filter((m) => hit(m.name, m.email))
          .map((m) =>
            compact({
              name: m.name,
              email: m.email,
              role: roleLabel(m.role),
              takesTasks: m.canTakeTasks ? null : "nein (nur Lesezugriff)",
              limitedTo: m.scoped ? "einzelne Objekte/Gebäude" : null,
            }),
          ),
        partners: t.partners
          .filter((p) => hit(p.company, p.contactName, p.trade))
          .map((p) =>
            compact({ company: p.company, contact: p.contactName, trade: p.trade }),
          ),
        hint: 'Zuweisen: update_tasks(assignee: "Name", "E-Mail", "ich" oder Partner-Firma).',
      });
    },
  },
  {
    name: "get",
    title: "Abrufen",
    description:
      "Ein Ding vollständig, mit Verlauf und Foto-Verweisen. `kind` + `ref`: asset (ref = Code, Etikett oder „Tür 36“ mit `property`; liefert Stammdaten mit fehlenden Feldern, Prüfpunkte in Kurzform – Volltext mit `detail: true` –, letzte Prüfungen, offene Mängel, Fotos), property (Objektname; mit Ansprechperson und Zugang), defect (defectId), task (taskId), inspection (inspectionId), walkthrough (walkthroughId). Foto- und Grundriss-Verweise (`foto:…`, `plan:…`) kann get_photo als Bild laden – z. B. um ein Typenschild zu lesen.",
    inputSchema: obj(
      {
        kind: str("Art", {
          enum: [
            "asset",
            "property",
            "defect",
            "task",
            "inspection",
            "walkthrough",
          ],
        }),
        ref: str(
          "Code (asset), Name (property) oder ID (aus list/search/briefing)",
        ),
        property: str("nur asset: Objekt (Name), wenn ref eine Nummer wie „Tür 36“ ist"),
        detail: bool("nur asset: Prüfpunkte im Volltext statt Kurzform"),
      },
      ["kind", "ref"],
    ),
    readOnly: true,
    run: async (a, x) => {
      const ref = s(a.ref).trim();
      const notFound = (what: string, hint: string) => (e: unknown) => {
        if (e instanceof ApiError && e.status === 404)
          throw new ToolError(`${what} „${ref}“ nicht gefunden. ${hint}`);
        throw e;
      };
      switch (a.kind) {
        case "asset": {
          // Plan v6 F1: Stammdaten, Prüfpunkte (Kurzform), letzte Prüfungen, offene Mängel, Foto-Verweise
          const id = await assetId(x, ref, a.property);
          const r = (await x.api({
            method: "GET",
            path: `/assets/${enc(id)}`,
          })) as Json;
          const cat = (await x.categories()).find((c) => c.key === r.category);
          const attrs = (r.attributes ?? {}) as Json;
          const files = list(r.attachments);
          const filled = (v: unknown) => v != null && v !== "";
          return compact({
            ...(await assetLine(x, r)),
            number: r.number,
            norm: cat?.norm,
            manufacturer: r.manufacturer,
            model: r.model,
            label: r.labelCode,
            data: compact(
              Object.fromEntries(
                (cat?.attributes ?? []).map((f) => [
                  f.label,
                  typeof attrs[f.key] === "boolean"
                    ? attrs[f.key]
                      ? "ja"
                      : "nein"
                    : (attrs[f.key] ?? null),
                ]),
              ),
            ),
            missingData: (cat?.attributes ?? [])
              .filter((f) => !filled(attrs[f.key]))
              .map((f) => `${f.label} (${f.key})`),
            ...checkpointBrief(
              scheduleCheckpoints(cat, r),
              s(r.category),
              attrs,
              !!a.detail,
            ),
            inspections: list(r.inspections)
              .filter((i) => !i.supersededAt)
              .slice(0, 10)
              .map((i) =>
                compact({
                  inspectionId: i.id,
                  date: day(i.inspectedAt ?? i.createdAt),
                  status: inspStatus(i),
                  statusLabel: INSP_STATUS[inspStatus(i)],
                  result: i.result ? RESULT[s(i.result)] : null,
                  inspector: i.inspector,
                }),
              ),
            openDefects: list(r.defects)
              .filter((d) => d.status === "open" && !d.hiddenAt)
              .map((d) =>
                compact({
                  defectId: d.id,
                  title: d.title,
                  ...sevOut(d.severity),
                  since: day(d.createdAt),
                  photo: photoRef(d.photoKey),
                }),
              ),
            resolvedDefects:
              list(r.defects).filter((d) => d.status === "resolved").length ||
              null,
            photos: files
              .filter((f) => /^image\//.test(s(f.contentType)))
              .slice(0, 20)
              .map((f) =>
                compact({
                  photo: photoRef(f.fileKey),
                  caption: f.caption || f.name,
                  date: day(f.createdAt),
                }),
              ),
            floorPlan: r.floorPlan
              ? compact({
                  name: (r.floorPlan as Json).name,
                  plan: planRef((r.floorPlan as Json).id),
                  marker:
                    r.markerX != null ? `x ${r.markerX}, y ${r.markerY}` : null,
                })
              : null,
          });
        }
        case "property": {
          const p = await resolveProperty(x, ref);
          const r = (await x.api({
            method: "GET",
            path: `/properties/${enc(p.id)}`,
          })) as Json;
          const assets = list(r.assets);
          const byCat: Record<string, number> = {};
          for (const e of assets) {
            const l = await catLabel(x, e.category);
            byCat[l] = (byCat[l] ?? 0) + 1;
          }
          return compact({
            name: r.name,
            address: r.address,
            contact: [r.contactName, r.contactPhone, r.contactEmail]
              .filter(Boolean)
              .join(", "),
            access: r.access,
            status: compact({
              elements: p.assets,
              overdue: p.overdue,
              dueSoon: p.soon,
              neverInspected: p.never,
              openDefects: p.openDefects,
              nextWalkthrough: day(p.nextWalkAt),
            }),
            buildings: list(r.buildings).map((b) =>
              compact({
                name: b.name,
                elements: assets.filter((e) => e.buildingId === b.id).length,
              }),
            ),
            elementsByArt: byCat,
            floorPlans: list(r.floorPlans).map((f) =>
              compact({
                name: f.name,
                building: list(r.buildings).find((b) => b.id === f.buildingId)
                  ?.name,
                level: f.level,
                markers: f.markers,
                plan: planRef(f.id),
              }),
            ),
            walkthroughs: list(r.walkthroughs)
              .slice(0, 5)
              .map((w) =>
                compact({
                  walkthroughId: w.id,
                  date: day(w.inspectedAt ?? w.createdAt),
                  status: w.status === "draft" ? "Entwurf" : null,
                  result: w.result,
                  openFindings: Number(w.openDefects) || null,
                }),
              ),
            fireOfficers: list(r.fireOfficers)
              .filter(
                (f) => !f.appointedTo || Number(f.appointedTo) > Date.now(),
              )
              .map((f) =>
                compact({
                  name: f.name,
                  company: f.company,
                  since: day(f.appointedFrom),
                }),
              ),
          });
        }
        case "defect": {
          const d = (await x
            .api({ method: "GET", path: `/defects/${enc(ref)}` })
            .catch(
              notFound(
                "Mangel",
                'defectId aus list(what: "defects") oder search nehmen.',
              ),
            )) as Json;
          return compact({
            ...defectLine(d),
            note: d.note,
            measure: d.measure,
            legalBasis: d.legalBasis,
            photo: photoRef(d.photoKey),
            resolution:
              d.status === "resolved"
                ? compact({
                    at: day(d.resolvedAt),
                    by: d.resolvedByName,
                    note: d.resolutionNote,
                    photo: photoRef(d.resolutionPhotoKey),
                  })
                : null,
            tasks: list(d.tasks).map((t) =>
              compact({
                taskId: t.id,
                title: t.title,
                status: TASK_STATUS[s(t.status)],
                due: day(t.dueAt),
                assignee: t.assigneeName,
              }),
            ),
            history: list(d.history).map(
              (h) => `${day(h.createdAt)} ${s(h.userName)}: ${s(h.summary)}`,
            ),
          });
        }
        case "task": {
          const t = (
            (await x.api({ method: "GET", path: "/tasks" })) as Json[]
          ).find((k) => k.id === ref);
          if (!t)
            throw new ToolError(
              `Aufgabe „${ref}“ nicht gefunden. taskId aus list(what: "tasks") nehmen.`,
            );
          const comments = (await x
            .api({ method: "GET", path: `/tasks/${enc(ref)}/comments` })
            .catch(() => [])) as Json[];
          return compact({
            ...taskLine(t),
            description: t.description,
            kind:
              t.kind === "inspection"
                ? "Prüfauftrag"
                : t.kind === "defect"
                  ? "Mängelbehebung"
                  : "Sonstiges",
            assigneeId: t.assigneeId,
            defect: t.defectTitle
              ? `${t.defectTitle} (${sev(t.defectSeverity)})`
              : null,
            defectId: t.defectId,
            recurrence: t.recurrence,
            partnerNote: t.externalNote,
            createdBy: t.createdByName,
            created: day(t.createdAt),
            comments: (Array.isArray(comments)
              ? comments
              : list((comments as Json).items)
            )
              .slice(-10)
              .map(
                (k) =>
                  `${dayTime(k.createdAt)} ${s(k.authorName ?? k.userName)}: ${s(k.body)}`,
              ),
          });
        }
        case "inspection": {
          const i = (await x
            .api({ method: "GET", path: `/inspections/${enc(ref)}` })
            .catch(
              notFound(
                "Prüfung",
                'inspectionId aus list(what: "inspections") oder get(kind: "asset") nehmen.',
              ),
            )) as Json;
          const asset = i.asset as Json;
          const answers = (i.answers ?? {}) as Record<string, string>;
          const AN: Record<string, string> = {
            ok: "i. O.",
            defect: "Mangel",
            na: "entfällt",
          };
          return compact({
            inspectionId: i.id,
            element: `${s(asset.code)} ${s(asset.categoryLabel)}${asset.location ? `, ${asset.location}` : ""}`,
            property: asset.propertyName,
            status: inspStatus(i),
            statusLabel: INSP_STATUS[inspStatus(i)],
            hint: inspStatus(i) === "ready" ? SIGN_HINT : null,
            kinds: (i.kindLabels as string[])?.join(", "),
            date: day(i.inspectedAt ?? i.createdAt),
            inspector: i.inspectorName,
            result: i.result ? RESULT[s(i.result)] : null,
            notInspectable: i.notInspectable ? true : null,
            checkpoints: list(i.checkpoints).map(
              (c, n) =>
                `${n + 1}. ${s(c.label)}: ${AN[answers[s(c.id)]] ?? "offen"}`,
            ),
            defects: list(i.defects).map((d) =>
              compact({
                title: d.title,
                ...sevOut(d.severity),
                measure: d.measure,
                photo: photoRef(d.photoKey),
                known: d.knownId ? true : null,
              }),
            ),
            knownOpenDefects: list(i.knownDefects).map((d) =>
              compact({
                defectId: d.id,
                title: d.title,
                ...sevOut(d.severity),
                since: day(d.createdAt),
              }),
            ),
            maintenance: (i.maintenance as string[])?.join(", "),
            notes: i.notes,
            photos: list(i.photos).map((p) =>
              compact({ photo: photoRef(p.key), caption: p.caption }),
            ),
            signed:
              i.status === "submitted" ? (i.signature ? "ja" : "nein") : null,
            nextDue: day(i.nextDueAt),
          });
        }
        case "walkthrough": {
          const w = (await x
            .api({ method: "GET", path: `/walkthroughs/${enc(ref)}` })
            .catch(
              notFound(
                "Begehung",
                'walkthroughId aus list(what: "walkthroughs") nehmen.',
              ),
            )) as Json;
          const findings = list(w.findings);
          return compact({
            walkthroughId: w.id,
            property: w.propertyName,
            building: w.buildingName,
            status: w.status === "draft" ? "Entwurf" : "abgeschlossen",
            date: day(w.inspectedAt ?? w.createdAt),
            result: w.result,
            findings: findings.map((f) =>
              compact({
                title: f.title,
                ...sevOut(f.severity),
                note: f.note,
                photo: photoRef(f.photoKey),
              }),
            ),
            notes: w.notes,
            nextDue: day(w.nextDueAt),
          });
        }
        default:
          throw new ToolError(
            "`kind` muss asset, property, defect, task, inspection oder walkthrough sein.",
          );
      }
    },
  },
  {
    name: "get_photo",
    title: "Foto ansehen",
    description:
      "Lädt ein Foto oder einen Grundriss als Bild, damit du es ansehen kannst – z. B. ein Typenschild lesen (danach update_asset) oder einen Grundriss auswerten (danach setup). `ref` ist ein Verweis aus get: „foto:…“ (Fotos von Elementen, Mängeln, Prüfungen) oder „plan:…“ (Grundriss eines Gebäudes; die Antwort nennt dann auch die gesetzten Marker). Bilder (JPEG, PNG, WebP) bis 4 MB kommen als Bildinhalt, Vektor-Grundrisse (SVG) als Quelltext; PDFs werden nicht geliefert. Nur lesend.",
    inputSchema: obj(
      {
        ref: str("Verweis aus get, z. B. „foto:abc123/XyZ…“ oder „plan:8f2k…“"),
      },
      ["ref"],
    ),
    readOnly: true,
    run: async (a, x) => {
      const ref = s(a.ref).trim();
      const MAX = 4 * 1024 * 1024;
      let key = ref.startsWith("foto:") ? ref.slice(5) : ref;
      let caption = "Foto";
      let extra: Json = {};
      if (ref.startsWith("plan:")) {
        const id = ref.slice(5);
        if (!/^[a-z0-9]{1,40}$/.test(id))
          throw new ToolError(
            'Ungültiger Grundriss-Verweis. Verweise „plan:…“ liefert get(kind: "property") oder get(kind: "asset").',
          );
        let p: Json;
        try {
          p = (await x.api({
            method: "GET",
            path: `/floor-plans/${id}`,
          })) as Json;
        } catch (e) {
          if (e instanceof ApiError && e.status === 404)
            throw new ToolError(
              "Grundriss nicht gefunden (oder außerhalb deines Zugriffsbereichs).",
            );
          throw e;
        }
        key = s(p.fileKey);
        caption = `Grundriss „${s(p.name)}“, ${s(p.buildingName)} (${s(p.propertyName)})`;
        const markers = list(p.assets).filter(
          (m) => m.floorPlanId === p.id && m.markerX != null,
        );
        extra = {
          size: `${s(p.width)} × ${s(p.height)} px`,
          markers: markers.map(
            (m) =>
              `${s(m.code)} bei x ${Number(m.markerX).toFixed(2)}, y ${Number(m.markerY).toFixed(2)}`,
          ),
        };
      }
      // Dateischlüssel: <workspace>/<zufall> – der Server liefert nur Dateien des eigenen Workspaces
      if (!/^[a-z0-9]{1,40}\/[A-Za-z0-9]{8,64}$/.test(key))
        throw new ToolError(
          "Ungültiger Foto-Verweis. Gültige Verweise („foto:…“, „plan:…“) liefert get.",
        );
      let f: { body: ArrayBuffer; type: string };
      try {
        f = await x.raw(`/files/${key}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404)
          throw new ToolError(
            "Foto nicht gefunden – der Verweis gehört nicht zu diesem Workspace oder die Datei wurde gelöscht.",
          );
        throw e;
      }
      const type = f.type.split(";")[0].trim();
      const text = [
        caption,
        ...Object.entries(extra).map(
          ([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join("; ") || "keine" : s(v)}`,
        ),
      ].join("\n");
      if (f.body.byteLength > MAX)
        throw new ToolError(
          `Bild zu groß (${(f.body.byteLength / 1048576).toFixed(1)} MB, höchstens 4 MB). In der App verkleinert neu hochladen.`,
        );
      // Vektor-Grundrisse (SVG) als Text: Räume und Beschriftungen sind darin lesbar
      if (type === "image/svg+xml")
        return {
          content: [
            {
              type: "text",
              text: `${text}\nVektorgrafik (SVG), Quelltext folgt:`,
            },
            { type: "text", text: new TextDecoder().decode(f.body) },
          ],
        };
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type))
        throw new ToolError(
          `Kein Bild (${type || "unbekannter Typ"}). PDF-Grundrisse bitte als Foto oder Bild-Export hochladen.`,
        );
      return {
        content: [
          { type: "text", text },
          { type: "image", data: b64(f.body), mimeType: type },
        ],
      };
    },
  },
  {
    name: "capture",
    title: "Erfassen",
    description:
      'Mehrere Einträge auf einmal anlegen – genau so, wie jemand sie diktiert. Je Eintrag `kind`: defect (Mangel: title, severity, measure, note), task (Aufgabe: title, note, priority, due), note (Notiz, wird als Aufgabe mit niedriger Priorität gespeichert), asset (neue Elemente: category, building, floor, location, count – z. B. „5 Feuerlöscher EG Flur“). Ort: `asset` (Element-Code) je Eintrag oder als Vorgabe für alle; sonst `property` (Objektname). Ähnliche offene Mängel werden NICHT doppelt angelegt, sondern unter `skipped` gemeldet – nach Rückfrage mit `force: true` erneut senden. Schwere Mängel bekommen je nach Autopilot automatisch eine Aufgabe. Neue Elemente brauchen das Recht „darf anlegen“. Beispiel: {asset: "FST-7K2M", items: [{kind: "defect", title: "Obentürschließer zieht nicht zu", severity: "medium", measure: "Schließer einstellen"}, {kind: "task", title: "Hausmeister informieren", due: "2026-11-20"}]}.',
    inputSchema: obj(
      {
        asset: str(
          "Vorgabe-Element für alle Einträge (Code), z. B. „FST-7K2M“",
        ),
        property: str("Vorgabe-Objekt (Name), wenn kein Element passt"),
        force: bool(
          "auch anlegen, wenn ein ähnlicher Mangel schon offen ist (erst nach Rückfrage)",
        ),
        items: arr(
          obj(
            {
              kind: str("Art des Eintrags", {
                enum: ["defect", "task", "note", "asset"],
              }),
              title: str("Kurzer, sachlicher Titel (bei asset optional)"),
              note: str("Details"),
              severity: SEVERITY,
              measure: str(
                "Maßnahme zur Behebung (Mangel), z. B. „Dichtung erneuern“",
              ),
              priority: str("Aufgabe: Priorität", {
                enum: ["low", "medium", "high"],
              }),
              due: str(
                "Aufgabe: Frist – ISO „2026-11-20“, „20.11.“ oder relativ: heute, morgen, übermorgen, Freitag, nächste Woche, in 3 Tagen, Ende des Monats (Zeitzone des Workspaces). Ungültige Daten (30.02.) werden abgelehnt.",
              ),
              allowPast: bool(
                "Aufgabe: Frist in der Vergangenheit ausdrücklich erlauben (sonst Fehler)",
              ),
              assignee: str(
                "Aufgabe: zuständig – Name, E-Mail, „ich“ oder Partner (Firma); siehe team",
              ),
              asset: str(
                "Element-Code für diesen Eintrag – oder Nummer wie „Tür 36“ (mit `property`)",
              ),
              property: str("Objekt (Name) für diesen Eintrag"),
              category: str(
                "asset: Elementart (Schlüssel oder Bezeichnung, z. B. „Feuerlöscher“)",
              ),
              building: str(
                "asset: Gebäude (Name) – entfällt, wenn das Objekt nur ein Gebäude hat",
              ),
              floor: str("asset: Etage, z. B. „EG“, „1. OG“"),
              location: str("asset: Standort, z. B. „Flur vor Raum 1.04“"),
              count: int("asset: Anzahl gleicher Elemente", 1, 50),
            },
            ["kind"],
          ),
          "Einträge in Diktat-Reihenfolge",
        ),
      },
      ["items"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const items = list(a.items);
      if (!items.length)
        throw new ToolError(
          '`items` ist leer. Beispiel: {items: [{kind: "defect", title: "…", severity: "medium"}], asset: "FST-7K2M"}',
        );
      if (items.length > 50)
        throw new ToolError(
          "Höchstens 50 Einträge je Aufruf – bitte aufteilen.",
        );
      const created: string[] = [];
      const skipped: Json[] = [];
      const failed: Json[] = [];
      let autoTasks = 0;
      const assetCache = new Map<
        string,
        Promise<{ id: string; propertyId: string }>
      >();
      // Katalog des Workspaces für Schwere/Maßnahme-Vorschläge (einmal je Aufruf)
      let vocab: Promise<{ defects: CatalogDefect[] }> | null = null;
      const catalogDefects = async () =>
        (
          await (vocab ??= x
            .api({ method: "GET", path: "/catalog" })
            .then((r) => r as { defects: CatalogDefect[] })
            .catch(() => ({ defects: [] })))
        ).defects;
      const assetOf = (code: string, property?: unknown) => {
        const key = `${code}|${s(property)}`;
        if (!assetCache.has(key))
          assetCache.set(
            key,
            assetId(x, code, property).then(async (id) => ({
              id,
              propertyId: s(
                (
                  (await x.api({
                    method: "GET",
                    path: `/assets/${enc(id)}`,
                  })) as Json
                ).propertyId,
              ),
            })),
          );
        return assetCache.get(key)!;
      };
      for (const [n, it] of items.entries()) {
        const label = `${n + 1}. ${s(it.title) || s(it.category) || it.kind}`;
        try {
          if (it.kind === "asset") {
            const cat = await resolveCategory(x, it.category ?? it.title);
            const b = lc(it.building)
              ? await resolveBuilding(x, it.building, it.property ?? a.property)
              : await onlyBuilding(x, it.property ?? a.property);
            const count = clamp(it.count, 1, 50, 1);
            const codes: string[] = [];
            for (let i = 0; i < count; i++) {
              const r = (await x.api({
                method: "POST",
                path: "/assets",
                body: {
                  buildingId: b.id,
                  category: cat.key,
                  floor: s(it.floor),
                  location: s(it.location),
                  attributes: {},
                },
              })) as { code: string };
              codes.push(r.code);
            }
            created.push(
              `${count} × ${cat.label} in ${b.name}${it.floor ? `, ${s(it.floor)}` : ""}${it.location ? `, ${s(it.location)}` : ""}: ${codes.join(", ")}`,
            );
            continue;
          }
          const title = s(it.title).trim();
          if (!title) throw new ToolError("Titel fehlt");
          const code = s(it.asset ?? (it.property ? "" : a.asset)).trim();
          const asset = code
            ? await assetOf(code, it.property ?? a.property)
            : null;
          const prop = asset
            ? null
            : it.property || a.property
              ? await resolveProperty(x, it.property ?? a.property)
              : null;
          if (it.kind === "defect") {
            if (!asset && !prop)
              throw new ToolError(
                "Wo? `asset` (Code) oder `property` (Objekt) angeben",
              );
            const severity = SEVERITIES[it.severity as Severity]
              ? s(it.severity)
              : suggestSeverity(
                  `${title} ${s(it.note)}`,
                  await catalogDefects(),
                );
            const body = {
              assetId: asset?.id ?? null,
              propertyId: asset?.propertyId ?? prop?.id ?? null,
              title,
              note: s(it.note),
              measure:
                s(it.measure) || suggestMeasure(title, await catalogDefects()),
              severity,
              force: !!a.force,
            };
            try {
              const r = (await x.api({
                method: "POST",
                path: "/defects",
                body,
              })) as { taskCreated?: boolean };
              if (r.taskCreated) autoTasks++;
              created.push(
                `Mangel „${title}“ (${sev(severity)})${code ? ` an ${code}` : prop ? ` in ${prop.name}` : ""}`,
              );
            } catch (e) {
              if (e instanceof ApiError && e.status === 409) {
                const dup = (e.body as { duplicate?: Json })?.duplicate;
                skipped.push(
                  compact({
                    item: label,
                    reason: dup?.inDraft
                      ? dup.ready
                        ? "steht schon als Befund in einer Prüfung, die auf die Unterschrift wartet"
                        : "steht schon als Befund in einer angefangenen Prüfung"
                      : "ähnlicher Mangel schon offen",
                    existing: dup?.title,
                    existingDefectId: dup?.id,
                    inspectionId: dup?.inspectionId,
                    sameAs: dup?.via ? `beides „${s(dup.via)}“ (Katalog)` : null,
                    since: day(dup?.createdAt),
                  }),
                );
              } else throw e;
            }
          } else {
            // v6 A6/C1: Frist streng prüfen (30.02. → Fehler), relativ in der Zeitzone des Workspaces
            const due = await dateArg(x, it.due, "due", {
              allowPast: it.allowPast === true,
            });
            const who = lc(it.assignee)
              ? await resolvePerson(x, it.assignee)
              : null;
            await x.api({
              method: "POST",
              path: "/tasks",
              body: {
                title: it.kind === "note" ? `Notiz: ${title}` : title,
                description: s(it.note),
                priority:
                  it.kind === "note"
                    ? "low"
                    : ["low", "medium", "high"].includes(s(it.priority))
                      ? it.priority
                      : "medium",
                dueAt: due ?? null,
                assetId: asset?.id ?? null,
                // v6 B5: Objekt vom Element erben (Liste, Filter und Bericht finden die Aufgabe)
                propertyId: asset?.propertyId || prop?.id || null,
                assigneeId: who?.kind === "member" ? who.id : null,
                subcontractorId: who?.kind === "partner" ? who.id : null,
              },
            });
            created.push(
              `${it.kind === "note" ? "Notiz" : "Aufgabe"} „${title}“${code ? ` zu ${code}` : prop ? ` in ${prop.name}` : ""}${due ? `, fällig ${dayIn(due, await tzOf(x))}` : ""}${who ? `, an ${who.name}` : ""}`,
            );
          }
        } catch (e) {
          failed.push({ item: label, error: errorText(e) });
        }
      }
      const out = compact({
        created,
        autoTasks: autoTasks
          ? `Für ${autoTasks} schwere ${autoTasks === 1 ? "Mangel" : "Mängel"} hat der Autopilot eine Aufgabe angelegt.`
          : null,
        skipped,
        failed,
        hint: skipped.length
          ? "Übersprungene nur nach Rückfrage mit force: true erneut senden."
          : null,
      });
      if (!created.length && failed.length && !skipped.length)
        throw new ToolError(
          `Nichts angelegt. ${failed.map((f) => `${s(f.item)}: ${s(f.error)}`).join(" | ")}`,
        );
      return out;
    },
  },
  {
    name: "update_asset",
    title: "Stammdaten nachtragen",
    description:
      'Stammdaten eines Elements ergänzen oder korrigieren – typischerweise nach dem Lesen eines Typenschilds mit get_photo. `archive: true` (allein, optional mit `reason`) archiviert das Element statt dessen – nur mit einer Admin-Verbindung (Schlüssel bzw. Anmeldung einer Admin- oder Inhaber-Person), in der App 30 Tage im Papierkorb wiederherstellbar (Einstellungen → Unternehmen → Papierkorb). Nur genannte Felder ändern sich; Werte werden geprüft (Auswahllisten nur mit erlaubten Werten, Zahlen, Baujahr 1950 bis nächstes Jahr, Ja/Nein) – bei einem Fehler wird nichts gespeichert. Felder: manufacturer, model, year (Baujahr), serial (Seriennummer), approval (Zulassungsnummer), location, floor, label (Etikett/QR-Code); weitere Felder der Elementart über `fields` (Schlüssel aus search(type: "categories"), z. B. {rating: "T30"}). Antwort nennt jede Änderung „vorher → nachher“. Beispiel: {asset: "FL-3MX9", manufacturer: "Gloria", model: "PD 6 GA", year: 2019, serial: "A1234567"}.',
    inputSchema: obj(
      {
        asset: str(
          "Element-Code, z. B. „FL-3MX9“ – oder laufende Nummer wie „Tür 36“ zusammen mit `property`",
        ),
        property: str("Objekt (Name), wenn `asset` eine Nummer wie „Tür 36“ ist"),
        manufacturer: str("Hersteller"),
        model: str("Typ/Modell"),
        year: int("Baujahr (1950 bis nächstes Jahr)", 1950, 2100),
        serial: str("Seriennummer"),
        approval: str("Zulassungsnummer, z. B. „Z-6.20-1234“"),
        location: str("Standort"),
        floor: str("Etage"),
        label: str("Etikett/QR-Code"),
        fields: {
          type: "object",
          description: "weitere Felder der Elementart als {schlüssel: wert}",
          additionalProperties: {
            type: ["string", "number", "boolean", "null"],
          },
        },
        archive: bool("Element archivieren (Papierkorb, in der App 30 Tage wiederherstellbar) – nur Admin-Verbindung, allein senden"),
        reason: str("Grund fürs Archivieren, z. B. „Tür ausgebaut“"),
      },
      ["asset"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const id = await assetId(x, a.asset, a.property);
      if (a.archive === true) {
        const other = ["manufacturer", "model", "year", "serial", "approval", "location", "floor", "label", "fields"].filter((k) => a[k] !== undefined);
        if (other.length)
          throw new ToolError(`archive allein senden (ohne ${other.join(", ")}). Nichts geändert.`);
        try {
          const r = (await x.api({
            method: "POST",
            path: `/assets/${enc(id)}/archive`,
            body: { reason: s(a.reason).trim() },
          })) as { code: string };
          return {
            asset: r.code,
            archived: true,
            restore: "In der App 30 Tage wiederherstellbar: Einstellungen → Unternehmen → Papierkorb (Admins).",
          };
        } catch (e) {
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(
              "Archivieren geht nur mit einer Admin-Verbindung (Schlüssel bzw. Anmeldung einer Admin- oder Inhaber-Person). Das können sonst nur Admins in der App. Nichts geändert.",
            );
          throw e;
        }
      }
      const r = (await x.api({
        method: "GET",
        path: `/assets/${enc(id)}`,
      })) as Json;
      const cat = (await x.categories()).find((c) => c.key === r.category);
      const fields = new Map(
        (cat?.attributes ?? []).map((f) => [f.key, f.label]),
      );
      const attrs = { ...((r.attributes ?? {}) as Json) };
      const next = {
        location: s(r.location),
        floor: s(r.floor),
        manufacturer: s(r.manufacturer),
        model: s(r.model),
        labelCode: (r.labelCode as string | null) ?? undefined,
      };
      const changes: string[] = [];
      const ignored: string[] = [];
      const set = (label: string, before: unknown, after: unknown) => {
        if (s(before) !== s(after))
          changes.push(`${label}: ${s(before) || "–"} → ${s(after) || "–"}`);
      };
      for (const k of ["manufacturer", "model", "location", "floor"] as const) {
        if (a[k] === undefined) continue;
        set(
          {
            manufacturer: "Hersteller",
            model: "Modell",
            location: "Standort",
            floor: "Etage",
          }[k],
          next[k],
          a[k],
        );
        next[k] = s(a[k]).trim();
      }
      if (a.label !== undefined) {
        set("Etikett", next.labelCode, s(a.label).toUpperCase());
        next.labelCode = s(a.label).trim() || undefined;
      }
      const extra: Json = { ...((a.fields ?? {}) as Json) };
      if (a.year !== undefined) extra.year = a.year;
      if (a.approval !== undefined) extra.approval = a.approval;
      if (a.serial !== undefined) {
        if (fields.has("serial")) extra.serial = a.serial;
        else if (!s(next.model).includes(s(a.serial))) {
          // Art ohne Feld „Seriennummer“: wie bisher am Modell anhängen
          const m = [next.model, `SN ${s(a.serial)}`]
            .filter(Boolean)
            .join(" · ");
          set("Modell", next.model, m);
          next.model = m;
        }
      }
      // Plan v7 (Paket V): alte Felder rating/smoke der Tür → Anforderung (vor dem Aussortieren unbekannter Felder)
      const legacy = withLegacyDoorFields([...fields.keys()].map((key) => ({ key })), extra);
      if (legacy.error) throw new ToolError(`Nichts gespeichert: ${legacy.error}`);
      const converted = { ...legacy.attrs } as Json;
      for (const k of Object.keys(extra)) delete extra[k];
      Object.assign(extra, converted);
      // Plan v6 D1: Auswahllisten, Zahlen, Baujahr und Ja/Nein prüfen – bei einem Fehler wird nichts gespeichert
      for (const k of Object.keys(extra)) if (!fields.has(k)) ignored.push(k);
      const checked = checkedFields(
        cat,
        Object.fromEntries(Object.entries(extra).filter(([k]) => fields.has(k))),
      );
      if (checked.errors.length)
        throw new ToolError(
          `Nichts gespeichert: ${checked.errors.map((e) => e.message).join(" ")}`,
        );
      for (const [k, v] of Object.entries(checked.values)) {
        set(fields.get(k)!, attrs[k], v);
        attrs[k] = v as never;
      }
      if (!changes.length)
        return compact({
          asset: r.code,
          changed: "nichts – Werte waren schon so",
          ignored: ignored.length
            ? `${ignored.join(", ")} (gibt es bei ${cat?.label ?? "dieser Art"} nicht)`
            : null,
        });
      await x.api({
        method: "PATCH",
        path: `/assets/${enc(id)}`,
        body: {
          buildingId: r.buildingId,
          ...next,
          attributes: attrs,
          warnDays: r.warnDays ?? null,
        },
      });
      return compact({
        asset: r.code,
        changed: changes,
        ignored: ignored.length
          ? `${ignored.join(", ")} (gibt es bei ${cat?.label ?? "dieser Art"} nicht; mögliche Felder: ${[...fields.keys()].join(", ")})`
          : null,
      });
    },
  },
  {
    name: "update_tasks",
    title: "Aufgaben ändern",
    description:
      'Eine oder mehrere Aufgaben ändern: Status (open, in_progress, done, cancelled), Zuständige (`assignee`: Name, E-Mail, „ich“ oder Partner-Firma – alle Mitglieder und Partner, siehe team; null = niemand), Frist (ISO, „30.11.“ oder relativ wie „morgen“, „Freitag“, „in 3 Tagen“; null = keine), Priorität, und/oder einen internen Kommentar (für Partner unsichtbar). „done“ an einer Mängelbehebung läuft wie in der App: Ist der Autopilot-Schritt „Nachprüfen“ an, bleibt der Mangel offen und es entsteht ein Nachprüf-Auftrag; sonst wird der Mangel behoben und der Kommentar zur Behebungsnotiz (`resolveDefect` erzwingt bzw. verhindert das). taskIds aus list(what: "tasks"), briefing oder get. Beispiel: {taskIds: ["k3x…"], status: "done", comment: "Schließer am 12.11. getauscht"}.',
    inputSchema: obj(
      {
        taskIds: arr({ type: "string" }, "IDs der Aufgaben", 200),
        status: str("neuer Status", {
          enum: ["open", "in_progress", "done", "cancelled"],
        }),
        assignee: {
          type: ["string", "null"],
          description:
            "zuständig: Name, E-Mail, „ich“ oder Partner (Firma) – über alle Mitglieder und Partner; null = niemand",
        },
        due: {
          type: ["string", "null"],
          description:
            "neue Frist: „2026-11-30“, „30.11.“, „morgen“, „Freitag“, „nächste Woche“, „in 3 Tagen“, „Ende des Monats“ (Zeitzone des Workspaces) oder null für keine",
        },
        allowPast: bool("Frist in der Vergangenheit ausdrücklich erlauben"),
        priority: str("Priorität", { enum: ["low", "medium", "high"] }),
        comment: str(
          "interner Kommentar für jede genannte Aufgabe; bei „done“ einer Mängelbehebung zugleich die Behebungsnotiz",
        ),
        resolveDefect: bool(
          "nur bei done: verknüpften Mangel sofort als behoben markieren (true) bzw. offen lassen (false). Ohne Angabe wie in der App: mit Nachprüfen-Schritt offen bis zur Nachprüfung, sonst behoben.",
        ),
      },
      ["taskIds"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const ids = (Array.isArray(a.taskIds) ? a.taskIds : [])
        .map(String)
        .filter(Boolean);
      if (!ids.length)
        throw new ToolError('taskIds fehlt. IDs liefert list(what: "tasks").');
      const body: Json = {};
      if (a.status) body.status = a.status;
      if (a.priority) body.priority = a.priority;
      if (a.due !== undefined)
        body.dueAt =
          a.due === null
            ? null
            : await dateArg(x, a.due, "due", { allowPast: a.allowPast === true });
      let who: Awaited<ReturnType<typeof resolvePerson>> | null = null;
      if (a.assignee !== undefined) {
        if (a.assignee === null || a.assignee === "") {
          body.assigneeId = null;
          body.subcontractorId = null;
        } else {
          // v6 B1: über alle Mitglieder und Partner (nicht nur Namen, die schon an Aufgaben stehen)
          who = await resolvePerson(x, a.assignee);
          if (who.kind === "member") body.assigneeId = who.id;
          else body.subcontractorId = who.id;
        }
      }
      const out: Json = {};
      // Mängelbehebungen, die jetzt erledigt werden (v6 B3: derselbe Weg wie in der App)
      const done = a.status === "done";
      const before = done
        ? ((await x.api({ method: "GET", path: "/tasks" })) as Json[]).filter(
            (t) =>
              ids.includes(s(t.id)) &&
              t.status !== "done" &&
              t.kind === "defect" &&
              t.defectId &&
              t.defectStatus === "open",
          )
        : [];
      const verify = done && before.length ? await verifyMode(x) : "off";
      const resolveNow =
        a.resolveDefect === true || (a.resolveDefect !== false && verify === "off");
      // Kommentar zuerst: er steht im Verlauf vor dem Statuswechsel
      if (a.comment) {
        let n = 0;
        const fails: string[] = [];
        for (const id of ids) {
          try {
            await x.api({
              method: "POST",
              path: `/tasks/${enc(id)}/comments`,
              body: { body: s(a.comment), mentions: [] },
            });
            n++;
          } catch (e) {
            fails.push(`${id}: ${errorText(e)}`);
          }
        }
        out.commented = n;
        if (fails.length) out.commentErrors = fails;
      }
      if (Object.keys(body).length) {
        const r = (await x.api({
          method: "POST",
          path: "/tasks/bulk",
          // Mangel nie nebenbei schließen – das entscheidet der Schritt unten (wie der Dialog in der App)
          body: { ids, ...body, ...(done ? { resolveDefects: false } : {}) },
        })) as { updated: number; skipped: number };
        out.updated = r.updated;
        if (who) out.assignee = who.kind === "partner" ? `${who.name} (Partner)` : who.name;
        if (r.skipped)
          out.notFound = `${r.skipped} ID(s) unbekannt oder außerhalb deines Bereichs`;
      }
      if (before.length) {
        const defects: string[] = [];
        for (const t of before) {
          if (resolveNow) {
            await x.api({
              method: "PATCH",
              path: `/defects/${enc(s(t.defectId))}`,
              body: { status: "resolved", note: s(a.comment) },
            });
            defects.push(
              `Mangel „${s(t.defectTitle)}“ behoben${a.comment ? " (Kommentar als Behebungsnotiz)" : ""}`,
            );
          } else
            defects.push(
              verify === "auto"
                ? `Mangel „${s(t.defectTitle)}“ bleibt offen bis zur Nachprüfung – Nachprüf-Auftrag angelegt`
                : verify === "suggest"
                  ? `Mangel „${s(t.defectTitle)}“ bleibt offen – Nachprüfung steht als Vorschlag unter „Jetzt“`
                  : `Mangel „${s(t.defectTitle)}“ bleibt offen (resolveDefect: false)`,
            );
        }
        out.defects = defects;
      }
      if (!Object.keys(out).length)
        throw new ToolError(
          "Nichts zu ändern: status, assignee, due, priority oder comment angeben.",
        );
      return out;
    },
  },
  {
    name: "update_defect",
    title: "Mangel beheben, öffnen oder als ungültig markieren",
    description:
      'Einen Mangel als behoben markieren (`action: "resolve"`, mit Notiz wer/was/wann), wieder öffnen (`action: "reopen"` – braucht danach eine neue Aufgabe, siehe plan tasks_from_defects) oder als ungültig markieren (`action: "invalid"` mit `reason`, z. B. „Duplikat von …“ oder „Fehleintrag“ – zählt dann nicht in Behebungsquote und -dauer, offene Aufgaben dazu entfallen; mit reopen rückgängig). defectId aus list(what: "defects"), search oder get. Beispiel: {defectId: "d7…", action: "resolve", note: "Dichtung durch Fa. Hansen erneuert"}.',
    inputSchema: obj(
      {
        defectId: str("ID des Mangels"),
        action: str(
          "resolve = behoben, reopen = wieder offen, invalid = ungültig (Duplikat/Fehleintrag)",
          { enum: ["resolve", "reopen", "invalid"] },
        ),
        note: str(
          "Behebungsnotiz, z. B. „Schließer getauscht durch Fa. Hansen“",
        ),
        reason: str(
          "nur invalid (Pflicht): warum ungültig, z. B. „Duplikat von FST-004 Schließer“",
        ),
      },
      ["defectId", "action"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const id = s(a.defectId);
      if (a.action === "invalid" && s(a.reason).trim().length < 3)
        throw new ToolError(
          "Für „ungültig“ bitte `reason` angeben, z. B. „Duplikat von FST-004 Schließer“ oder „Fehleintrag“.",
        );
      try {
        await x.api({
          method: "PATCH",
          path: `/defects/${enc(id)}`,
          body:
            a.action === "reopen"
              ? { status: "open" }
              : a.action === "invalid"
                ? { status: "invalid", reason: s(a.reason).trim() }
                : { status: "resolved", note: s(a.note) },
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404)
          throw new ToolError(
            `Mangel „${id}“ nicht gefunden. defectId aus list(what: "defects") nehmen.`,
          );
        throw e;
      }
      const d = (await x.api({
        method: "GET",
        path: `/defects/${enc(id)}`,
      })) as Json;
      return compact({
        defect: d.title,
        at: d.code,
        status: DEFECT_STATUS[s(d.status)] ?? s(d.status),
        note: d.resolutionNote,
        reason: d.status === "invalid" ? d.invalidReason : null,
        task:
          d.status === "open" && d.withoutTask
            ? 'ohne Aufgabe – plan(action: "tasks_from_defects") oder der Autopilot legt eine an'
            : null,
      });
    },
  },
  {
    name: "plan",
    title: "Planen",
    description:
      'Rundgänge planen. `action: "view"` (Standard): fällige Prüfungen je Gebäude als Rundgang – überfällig, in `days` Tagen fällig, nie geprüft – mit Elementen in Laufreihenfolge (Etage, Standort). `action: "plan_week"`: die Wochenplanung des Autopiloten jetzt einmal ausführen (Rundgang-Aufträge an die Zuständigen; nie geprüfte Elemente gelten als sofort fällig). `action: "tasks_from_defects"`: für offene Mängel ohne wirksame Aufgabe (auch wieder geöffnete) Aufgaben mit Frist anlegen (Standard: Schwere high und critical).',
    inputSchema: obj({
      action: str(
        "view = ansehen, plan_week = Wochenplanung auslösen, tasks_from_defects = Aufgaben aus Mängeln",
        { enum: ["view", "plan_week", "tasks_from_defects"] },
      ),
      days: int("Vorschau in Tagen (Standard 14)", 1, 365),
      building: str("nur dieses Gebäude (Name)"),
      severities: arr(
        { type: "string", enum: ["low", "medium", "high", "critical"] },
        "nur tasks_from_defects: Schweregrade (Standard high, critical)",
        4,
      ),
    }),
    readOnly: false,
    run: async (a, x) => {
      const action = s(a.action) || "view";
      if (action === "plan_week") {
        const r = (await x.api({
          method: "POST",
          path: "/automation/plan_week/run",
        })) as Json;
        return {
          done: r.done,
          // v6 B4: nie geprüfte Elemente gelten als sofort fällig und werden mit eingeplant
          text: Number(r.done)
            ? `${s(r.done)} Rundgang-Auftrag/-Aufträge angelegt (überfällig, in 14 Tagen fällig oder noch nie geprüft).`
            : "Nichts zu planen – nichts überfällig, nichts in 14 Tagen fällig, nichts nie geprüft, oder für die Gebäude gibt es schon offene Rundgang-Aufträge.",
        };
      }
      if (action === "tasks_from_defects") {
        const r = (await x.api({
          method: "POST",
          path: "/smart/tasks-from-defects",
          body:
            Array.isArray(a.severities) && a.severities.length
              ? { severities: a.severities }
              : {},
        })) as Json;
        return {
          created: r.created,
          text: Number(r.created)
            ? `${s(r.created)} Aufgabe(n) für Mängel ohne wirksame Aufgabe angelegt (auch wieder geöffnete und solche mit abgebrochener Aufgabe).`
            : "Keine offenen Mängel dieser Schwere ohne Aufgabe.",
        };
      }
      const days = clamp(a.days, 1, 365, 14);
      let rounds = (await x.api({
        method: "GET",
        path: `/smart/rounds?days=${days}`,
      })) as Json[];
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
              walk: await Promise.all(
                els
                  .slice(0, 25)
                  .map(
                    async (e) =>
                      `${s(e.code)} ${await catLabel(x, e.category)} – ${[e.floor, e.location].filter(Boolean).join(", ") || "ohne Standort"}`,
                  ),
              ),
              more: els.length > 25 ? els.length - 25 : null,
            });
          }),
        ),
        ...(rounds.length > 20 ? { moreRounds: rounds.length - 20 } : {}),
        ...(rounds.length
          ? {}
          : {
              hint: `Nichts fällig in den nächsten ${days} Tagen. Größeres days versuchen.`,
            }),
      };
    },
  },
  {
    name: "tour",
    title: "Rundgang führen",
    description:
      'Führt durch einen Rundgang vor Ort, Element für Element. Laufreihenfolge: Etagen von unten nach oben (TG/UG, EG, 1. OG … DG), innerhalb der Etage in der Reihenfolge, in der die Elemente angelegt wurden. `action: "start"` mit `building` (Gebäude- oder Objektname): nennt Zugang und Ansprechperson des Objekts und das erste fällige Element mit Standort, den Prüfpunkten als Gruppen-Kurzfassung (Volltext mit `detail: true`), was nach den Stammdaten entfällt, Rückfragen bei fehlenden Stammdaten (`askFirst`) und bekannte offene Mängel. Nach jeder Prüfung (inspect) `action: "next"`; mit `after` (Code) wird ein Element übersprungen. `action: "status"`: x von y erledigt und was noch offen ist. Ein Element gilt als erledigt, sobald seine Prüfung zur Unterschrift bereitliegt oder abgeschlossen ist. Nur lesend.',
    inputSchema: obj(
      {
        action: str("start, next oder status", {
          enum: ["start", "next", "status"],
        }),
        building: str(
          "Gebäude (oder Objekt mit nur einem Gebäude), z. B. „Haupthaus“",
        ),
        after: str(
          "nur next: Element-Code, nach dem es weitergehen soll (zum Überspringen)",
        ),
        days: int(
          "Vorschau in Tagen: was in so vielen Tagen fällig wird, gehört dazu (Standard 14)",
          1,
          365,
        ),
        detail: bool(
          "Prüfpunkte im Volltext (nummeriert) statt Gruppen-Kurzfassung",
        ),
      },
      ["action", "building"],
    ),
    readOnly: true,
    run: async (a, x) => {
      const b = await resolveBuilding(x, a.building);
      const days = clamp(a.days, 1, 365, 14);
      const [rounds, ready] = await Promise.all([
        x.api({ method: "GET", path: `/smart/rounds?days=${days}` }) as Promise<
          Json[]
        >,
        x
          .api({ method: "GET", path: "/inspections?status=ready" })
          .catch(() => []) as Promise<Json[]>,
      ]);
      const due = list(rounds.find((r) => r.buildingId === b.id)?.assets);
      const readyHere = (ready as Json[]).filter((i) => i.buildingId === b.id);
      const readyIds = new Set(readyHere.map((i) => s(i.assetId)));
      const open = due.filter((e) => !readyIds.has(s(e.id)));
      const total = open.length + readyHere.length;
      const progress = `${readyHere.length} von ${total} bereit zur Unterschrift`;
      const where = `${b.name} (${b.propertyName})`;
      if (a.action === "status") {
        return compact({
          building: where,
          progress,
          remaining: await Promise.all(
            open.map(
              async (e) =>
                `${s(e.code)} ${await catLabel(x, e.category)} – ${[e.floor, e.location].filter(Boolean).join(", ")}`,
            ),
          ),
          readyToSign: readyHere.map((i) => s(i.code)),
          hint: readyHere.length ? SIGN_HINT : null,
        });
      }
      let queue = open;
      if (a.action === "next" && a.after) {
        const at = due.findIndex((e) => lc(e.code) === lc(a.after));
        if (at >= 0)
          queue = [...due.slice(at + 1), ...due.slice(0, at)].filter(
            (e) => !readyIds.has(s(e.id)) && lc(e.code) !== lc(a.after),
          );
      }
      // Plan v6 F4: beim Start Zugang und Ansprechperson des Objekts
      const onSite =
        a.action === "start"
          ? await x
              .api({ method: "GET", path: `/properties/${enc(b.propertyId)}` })
              .then((p) => {
                const r = p as Json;
                return compact({
                  access: r.access,
                  contact: [r.contactName, r.contactPhone]
                    .filter(Boolean)
                    .join(", "),
                });
              })
              .catch(() => ({}))
          : {};
      const e = queue[0];
      if (!e)
        return compact({
          building: where,
          ...onSite,
          progress,
          done: true,
          text: total
            ? `Rundgang fertig – alles geprüft. ${SIGN_HINT}.`
            : `In ${b.name} ist in den nächsten ${days} Tagen nichts fällig.`,
        });
      const detail = (await x.api({
        method: "GET",
        path: `/assets/${enc(s(e.id))}`,
      })) as Json;
      const cat = (await x.categories()).find((c) => c.key === e.category);
      const cps = scheduleCheckpoints(cat, detail);
      const following = queue[1];
      return compact({
        building: where,
        ...onSite,
        progress,
        element: compact({
          code: e.code,
          art: cat?.label ?? e.category,
          floor: e.floor,
          location: e.location,
          due: day(e.nextDueAt) ?? "nie geprüft",
          lastResult: detail.lastResult ? RESULT[s(detail.lastResult)] : null,
          // Plan v6 C5: Gruppen-Kurzfassung statt 8–20 Punkte im Volltext
          ...checkpointBrief(
            cps,
            s(e.category),
            (detail.attributes ?? {}) as Json,
            !!a.detail,
          ),
          door: e.category === "hold_open" ? (detail.attributes as Json)?.door : null,
          knownDefects: list(detail.defects)
            .filter((d) => d.status === "open" && !d.hiddenAt)
            .map((d) =>
              compact({
                title: d.title,
                ...sevOut(d.severity),
                since: day(d.createdAt),
              }),
            ),
        }),
        then: following
          ? `${s(following.code)} – ${[following.floor, following.location].filter(Boolean).join(", ")}`
          : "letztes Element",
        hint: `Befund mit inspect(asset: "${s(e.code)}", …) eintragen; bekannte Mängel als still/fixed angeben.`,
      });
    },
  },
  {
    name: "inspect",
    title: "Prüfung ausfüllen",
    description:
      'Füllt die Prüfung eines Elements aus dem Gesagten aus und legt sie in der App **zur Unterschrift** bereit. Schließt nie ab und unterschreibt nie – das macht die prüfende Person in der App (Prüfen → Unterschreiben). Element per `asset` (Code) – oder **angesagt** per `number` + `type` + `property` („Tür 354, Typ SK32“): findet die Tür mit dieser Nummer im Objekt oder legt sie an (feste Nummer, Standort „Raum 354“, Stammdaten aus dem Katalog-Typ; Typ nicht im Katalog → Typ „unbekannt“, allgemeine Checkliste, der Typ bleibt Rohnotiz; Anlegen braucht wie capture „darf anlegen“). Rohdiktat auswerten: `inspection` (inspectionId aus list(what: "raw_notes")) mit den daraus gelesenen Befunden und `evaluated: true` (alle Rohnotizen dieser Prüfung) bzw. `rawNoteIds` – eine schon unterschriebene Prüfung lässt sich nur noch als ausgewertet markieren. `allOk: true` setzt alle noch offenen Prüfpunkte auf „i. O.“ – Punkte, die nach den Stammdaten nicht zutreffen (keine Feststellanlage, einflügelig), auf „entfällt“; fehlt das Stammdatum, bleibt der Punkt offen und `ask` fragt gezielt nach (die Antwort gleich mit `fields` mitgeben, z. B. {holdOpen: false}). Ausnahmen als `defects` (title, severity, measure, note; Prüfpunkt per `checkpoint` = Nummer oder Stichwort; ohne Angabe nur bei eindeutigem Treffer zugeordnet, sonst fragt `ask` nach). Bekannte offene Mängel mit `known` (defectId oder Titel) als still (weiterhin vorhanden) oder fixed (behoben) melden; ein neuer Mangel mit demselben Titel wie ein offener wird mit diesem zusammengeführt. Weitere: `answers` (einzelne Punkte ok/defect/na), `maintenance` (durchgeführte Arbeiten, auch mit anderen Worten wie „Batterie gewechselt“), `notes`, `notInspectable` nur mit `reason` (spätere Befunde oder allOk heben „nicht prüfbar“ auf und melden das). Widersprüche (i. O. und Mangel am selben Punkt, Arbeit „Melder gereinigt“ und Mangel „Melder verschmutzt“) stehen in `ask`; die Prüfung bleibt dann Entwurf. Mehrfach aufrufbar – ergänzt denselben Entwurf. Antwort: Kurzfassung, Ergebnis, `status` (draft = Entwurf, ready = wartet auf Unterschrift) und was noch fehlt. Beispiel: {asset: "FST-7K2M", allOk: true, defects: [{title: "Obentürschließer zieht nicht ganz zu", severity: "medium", measure: "Schließer einstellen", checkpoint: "Schließer"}]}.',
    inputSchema: obj(
      {
        asset: str(
          "Element-Code, z. B. „FST-7K2M“ – oder Nummer wie „Tür 36“ zusammen mit `property`",
        ),
        property: str("Objekt (Name), wenn `asset` eine Nummer wie „Tür 36“ ist oder `number` angesagt wird"),
        number: int("angesagte Türnummer (Ident-Nr.) – findet oder legt die Tür im Objekt an", 1, 99999),
        type: str("angesagter Typ, z. B. „SK32“, „Novoferm Premio T30-RS“ (Katalog: Hersteller, Modell, Aliasse)"),
        building: str("Gebäude für eine neue Tür (nur nötig, wenn das Objekt mehrere hat)"),
        location: str("Standort einer neuen Tür (Standard „Raum <Nummer>“)"),
        inspection: str("inspectionId (aus list raw_notes): genau diese Prüfung bearbeiten"),
        evaluated: bool("alle Rohnotizen der Prüfung als ausgewertet markieren"),
        rawNoteIds: arr({ type: "string" }, "nur diese Rohnotizen (noteId) als ausgewertet markieren", 50),
        allOk: bool(
          "alle noch nicht bewerteten Prüfpunkte auf „i. O.“ setzen (nicht Zutreffendes auf „entfällt“)",
        ),
        defects: arr(
          obj(
            {
              title: str("Mangel, kurz und sachlich"),
              severity: SEVERITY,
              measure: str("Maßnahme, z. B. „Dichtung erneuern“"),
              note: str("Details"),
              checkpoint: str(
                "Prüfpunkt: Nummer (aus tour/get mit detail) oder Stichwort; leer = nur bei eindeutigem Treffer",
              ),
            },
            ["title"],
          ),
          "neue Mängel",
          30,
        ),
        known: arr(
          obj(
            {
              defect: str("bekannter Mangel: defectId oder Titel"),
              status: str("still = weiterhin vorhanden, fixed = behoben", {
                enum: ["still", "fixed"],
              }),
            },
            ["defect", "status"],
          ),
          "Stand bekannter offener Mängel",
          30,
        ),
        answers: arr(
          obj(
            {
              checkpoint: str("Nummer oder Stichwort"),
              answer: str("ok, defect oder na (entfällt)", {
                enum: ["ok", "defect", "na"],
              }),
            },
            ["checkpoint", "answer"],
          ),
          "einzelne Prüfpunkte gezielt setzen",
          60,
        ),
        maintenance: arr(
          { type: "string" },
          "durchgeführte Arbeiten (Bezeichnung oder Schlüssel der Elementart, auch mit anderen Worten), z. B. „Batterie gewechselt“",
          20,
        ),
        fields: {
          type: "object",
          description:
            "Stammdaten gleich mitsetzen (geprüft wie in update_asset), z. B. {holdOpen: false} oder {leaves: \"1-flügelig\"} als Antwort auf eine Rückfrage",
          additionalProperties: {
            type: ["string", "number", "boolean", "null"],
          },
        },
        notes: str("Bemerkung zum Protokoll"),
        notInspectable: bool(
          "nicht prüfbar (z. B. kein Zugang) – nur zusammen mit `reason`",
        ),
        reason: str("Grund für „nicht prüfbar“ (Pflicht)"),
      },
      [],
    ),
    readOnly: false,
    run: async (a, x) => {
      if (!lc(a.asset) && a.number == null && !lc(a.inspection))
        throw new ToolError(
          "Welches Element? `asset` (Code), `number` + `type` + `property` (angesagte Tür) oder `inspection` (aus list raw_notes).",
        );
      const markIds = Array.isArray(a.rawNoteIds) ? a.rawNoteIds.map(s).filter(Boolean) : [];
      const mark = a.evaluated === true || markIds.length > 0;
      // Plan v7 W: genau diese Prüfung (Rohdiktat auswerten)
      let given: Draft | null = null;
      if (lc(a.inspection)) {
        given = (await x.api({
          method: "GET",
          path: `/inspections/${enc(s(a.inspection))}`,
        })) as unknown as Draft;
        if (given.status !== "draft") {
          const findingsToo =
            !!a.allOk || list(a.answers).length || list(a.defects).length || list(a.known).length || a.notInspectable || a.fields;
          if (findingsToo)
            throw new ToolError(
              "Diese Prüfung ist schon unterschrieben – Befunde ändern geht nur als Berichtigung in der App. Rohnotizen lassen sich mit evaluated: true als ausgewertet markieren.",
            );
          if (!mark) throw new ToolError("Prüfung ist abgeschlossen. Mit evaluated: true die Rohnotizen als ausgewertet markieren.");
          const r = (await x.api({
            method: "PATCH",
            path: `/inspections/${enc(given.id)}/raw-notes`,
            body: markIds.length ? { ids: markIds, evaluated: true } : { all: true, evaluated: true },
          })) as { changed: number };
          return compact({
            asset: given.asset.code,
            inspectionId: given.id,
            status: "submitted",
            rawNotes: `${r.changed} ${r.changed === 1 ? "Rohnotiz" : "Rohnotizen"} als ausgewertet markiert`,
          });
        }
      }
      // Plan v6 B6: „nicht prüfbar“ nur mit Grund, und nicht zugleich mit Befunden
      const hasFindings =
        !!a.allOk ||
        list(a.answers).length > 0 ||
        list(a.defects).length > 0;
      if (a.notInspectable === true && !s(a.reason).trim())
        throw new ToolError(
          "„Nicht prüfbar“ braucht einen Grund (`reason`), z. B. „kein Zugang, Raum verschlossen“. Nichts geändert.",
        );
      if (a.notInspectable === true && hasFindings)
        throw new ToolError(
          "Entweder „nicht prüfbar“ (mit reason) oder Befunde/allOk – nicht beides in einem Aufruf. Nichts geändert.",
        );
      // Plan v7 W: angesagte Tür finden oder anlegen
      const announced =
        !given && !lc(a.asset) && a.number != null ? await announceAsset(x, a) : null;
      const id = given
        ? given.assetId
        : announced
          ? announced.id
          : await assetId(x, a.asset, a.property);
      const asset = (await x.api({
        method: "GET",
        path: `/assets/${enc(id)}`,
      })) as Json;
      const cat = (await x.categories()).find((c) => c.key === asset.category);
      const category = s(asset.category);
      let attrs = { ...((asset.attributes ?? {}) as Json) };
      // Stammdaten als Antwort auf eine Rückfrage (A4) – erst prüfen, dann speichern
      const dataChanges: string[] = [];
      const fieldsIn = (a.fields ?? {}) as Json;
      if (Object.keys(fieldsIn).length) {
        const v = checkedFields(cat, fieldsIn);
        if (v.unknown.length)
          throw new ToolError(
            `${v.unknown.join(", ")} gibt es bei ${cat?.label ?? "dieser Art"} nicht (möglich: ${(cat?.attributes ?? []).map((f) => f.key).join(", ")}). Nichts geändert.`,
          );
        if (v.errors.length)
          throw new ToolError(
            `${v.errors.map((e) => e.message).join(" ")} Nichts geändert.`,
          );
        const next = { ...attrs, ...v.values };
        for (const [k, val] of Object.entries(v.values))
          if (s(attrs[k]) !== s(val))
            dataChanges.push(
              `${cat?.attributes.find((f) => f.key === k)?.label ?? k}: ${s(attrs[k]) || "–"} → ${typeof val === "boolean" ? (val ? "ja" : "nein") : s(val) || "–"}`,
            );
        if (dataChanges.length) {
          await x.api({
            method: "PATCH",
            path: `/assets/${enc(id)}`,
            body: {
              buildingId: asset.buildingId,
              location: s(asset.location),
              floor: s(asset.floor),
              manufacturer: s(asset.manufacturer),
              model: s(asset.model),
              labelCode: (asset.labelCode as string | null) ?? undefined,
              attributes: next,
              warnDays: asset.warnDays ?? null,
            },
          });
          attrs = next;
        }
      }
      const started = given
        ? { id: given.id }
        : ((await x.api({
            method: "POST",
            path: `/assets/${enc(id)}/inspections`,
            body: compact({
              general: announced?.general || undefined,
              rawNote: announced?.rawNote ?? undefined,
            }),
          })) as { id: string });
      const d = (await x.api({
        method: "GET",
        path: `/inspections/${enc(started.id)}`,
      })) as unknown as Draft;
      const cps = d.checkpoints;
      const cpLabel = (cid: unknown) => {
        const n = cps.findIndex((c) => c.id === cid);
        return n >= 0 ? `${n + 1}. ${cps[n].label}` : null;
      };
      let answers: Record<string, Answer> = { ...d.answers };
      const defects: Json[] = [...d.defects];
      const resolved = new Set(d.resolvedDefects);
      const notes: string[] = [];
      /** Rückfragen – Widersprüche halten die Prüfung als Entwurf zurück */
      const ask: string[] = [];
      const conflicts: string[] = [];
      const merged: string[] = [];
      // B6: Befunde zu einer „nicht prüfbar“ gemeldeten Prüfung heben den Zustand auf
      let notInspectable =
        a.notInspectable === undefined ? d.notInspectable : !!a.notInspectable;
      let stateChange: string | null = null;
      if (
        d.notInspectable &&
        a.notInspectable === undefined &&
        (hasFindings || list(a.known).length)
      ) {
        notInspectable = false;
        stateChange =
          "„Nicht prüfbar“ aufgehoben – die Prüfung wird mit den genannten Befunden ausgefüllt.";
      }
      const explicitOk = new Set<string>();
      for (const v of list(a.answers)) {
        const cp = findCheckpoint(cps, v.checkpoint);
        if (cp) {
          answers[cp] = v.answer as Answer;
          if (v.answer === "ok") explicitOk.add(cp);
          if (v.answer !== "defect" && v.answer !== "ok")
            for (let i = defects.length - 1; i >= 0; i--)
              if (defects[i].checkpointId === cp && !defects[i].knownId)
                defects.splice(i, 1);
        } else notes.push(`Prüfpunkt „${s(v.checkpoint)}“ nicht gefunden`);
      }
      const catalog = (
        (await x
          .api({ method: "GET", path: "/catalog" })
          .catch(() => ({ defects: [] }))) as { defects?: CatalogDefect[] }
      ).defects ?? [];
      type Known = Draft["knownDefects"][number];
      /** bekannten Mangel als „weiterhin vorhanden“ übernehmen; gleichlautende neue Befunde im Entwurf zusammenführen */
      const keepKnown = (hit: Known) => {
        resolved.delete(hit.id);
        for (let i = defects.length - 1; i >= 0; i--)
          if (
            !defects[i].knownId &&
            similarity(s(defects[i].title), hit.title) >= 0.6
          ) {
            merged.push(
              `„${s(defects[i].title)}“ mit bekanntem Mangel „${hit.title}“ zusammengeführt`,
            );
            defects.splice(i, 1);
          }
        if (!defects.some((x2) => x2.knownId === hit.id))
          defects.push(
            compact({
              title: hit.title,
              note: hit.note,
              measure: hit.measure,
              severity: hit.severity,
              checkpointId: hit.checkpointId ?? undefined,
              knownId: hit.id,
              since: hit.createdAt,
            }),
          );
        if (hit.checkpointId && cps.some((c) => c.id === hit.checkpointId))
          answers[hit.checkpointId] = "defect";
      };
      // Plan v6 C7: bekannte Mängel per ID oder Titel – mehrdeutige Titel werden nachgefragt
      for (const k of list(a.known)) {
        const ref = lc(k.defect);
        const byId = d.knownDefects.find((m) => m.id === s(k.defect));
        const exact = d.knownDefects.filter((m) => lc(m.title) === ref);
        const loose = d.knownDefects.filter(
          (m) =>
            lc(m.title).includes(ref) ||
            similarity(m.title, s(k.defect)) >= 0.5,
        );
        const pool = byId ? [byId] : exact.length ? exact : loose;
        if (!pool.length) {
          notes.push(`Bekannter Mangel „${s(k.defect)}“ nicht gefunden`);
          continue;
        }
        if (pool.length > 1) {
          ask.push(
            `Bekannter Mangel „${s(k.defect)}“ ist mehrdeutig: ${pool.map((m) => `${m.title} (defectId ${m.id}, seit ${day(m.createdAt)})`).join("; ")} – bitte per defectId angeben.`,
          );
          continue;
        }
        const hit = pool[0];
        if (k.status === "fixed") {
          resolved.add(hit.id);
          for (let i = defects.length - 1; i >= 0; i--)
            if (defects[i].knownId === hit.id) defects.splice(i, 1);
          const twin = defects.find(
            (m) => !m.knownId && similarity(s(m.title), hit.title) >= 0.6,
          );
          if (twin)
            conflicts.push(
              `„${hit.title}“ ist als behoben gemeldet, im Entwurf steht aber der Befund „${s(twin.title)}“ – noch vorhanden oder behoben?`,
            );
        } else keepKnown(hit);
      }
      for (const m of list(a.defects)) {
        const title = s(m.title).trim();
        if (!title) continue;
        // C7: derselbe Mangel ist schon offen bekannt → weiterführen statt doppelt anlegen
        const twin = d.knownDefects.find(
          (k) => !resolved.has(k.id) && similarity(k.title, title) >= 0.6,
        );
        if (twin) {
          keepKnown(twin);
          merged.push(
            `„${title}“ ist als offener Mangel bekannt („${twin.title}“) – weitergeführt statt neu angelegt`,
          );
          continue;
        }
        const text = `${title} ${s(m.note)}`;
        let cp: string | null = null;
        if (s(m.checkpoint).trim()) {
          cp = findCheckpoint(cps, m.checkpoint);
          if (!cp)
            ask.push(
              `Prüfpunkt „${s(m.checkpoint)}“ für „${title}“ nicht gefunden – Nummer aus tour/get (detail: true) nennen.`,
            );
        } else {
          // Plan v6 A5: nur eindeutige Treffer zuordnen, sonst nachfragen
          const r = assignCheckpoint(text, cps, { defects: catalog, category });
          cp = r.id;
          if (r.unsure)
            ask.push(
              `Mangel „${title}“: welcher Prüfpunkt – ${r.candidates.map((c) => cpLabel(c.id)).join(" oder ")}? Mit defects[].checkpoint angeben; bis dahin ohne Prüfpunkt eingetragen.`,
            );
        }
        const severity = SEVERITIES[m.severity as Severity]
          ? (m.severity as Severity)
          : suggestSeverity(text, catalog);
        const same = defects.findIndex(
          (x2) => !x2.knownId && similarity(s(x2.title), title) >= 0.6,
        );
        const entry = compact({
          title,
          note: s(m.note),
          measure: s(m.measure) || suggestMeasure(title, catalog),
          severity,
          ...(cp ? { checkpointId: cp } : {}),
        });
        if (same >= 0) defects[same] = entry;
        else defects.push(entry);
        if (cp) answers[cp] = "defect";
      }
      // C6: ausdrücklich „i. O.“ und zugleich ein Mangel am selben Punkt
      for (const cp of explicitOk) {
        const at = defects.filter((m) => m.checkpointId === cp);
        if (at.length) {
          answers[cp] = "defect";
          conflicts.push(
            `${cpLabel(cp)} ist als „i. O.“ gemeldet, dazu aber der Mangel „${s(at[0].title)}“ – was stimmt? Bis dahin als Mangel eingetragen.`,
          );
        }
      }
      // A4: „Alles in Ordnung“ setzt nicht Zutreffendes auf „entfällt“, Unbekanntes bleibt offen
      let notApplicable: string[] = [];
      if (a.allOk) {
        const r = allOkAnswers(cps, answers, category, attrs, (k) =>
          cat?.attributes.find((f) => f.key === k)?.label,
        );
        answers = r.answers;
        notApplicable = r.na.map((i) => cpLabel(i) ?? i);
        for (const q of new Set(r.unknown.map((u) => u.question)))
          ask.push(
            `${q} Davon hängt ab: ${r.unknown
              .filter((u) => u.question === q)
              .map((u) => cpLabel(u.id))
              .join("; ")} – Antwort mit fields (z. B. {${r.unknown.find((u) => u.question === q)!.attr}: …}) und allOk erneut senden.`,
          );
      }
      // Arbeiten: Bezeichnung, Schlüssel oder andere Worte (C4)
      const maintenance = new Set(d.maintenance);
      const unknownWork: string[] = [];
      for (const m of Array.isArray(a.maintenance) ? a.maintenance : []) {
        const hit = matchMaintenance(s(m), cat?.maintenance ?? []);
        if (hit) maintenance.add(hit.key);
        else {
          unknownWork.push(s(m));
          notes.push(
            `Arbeit „${s(m)}“ gibt es bei ${cat?.label ?? "dieser Art"} nicht (möglich: ${cat?.maintenance.map((o) => o.label).join(", ") || "keine"}) – in die Bemerkung übernommen`,
          );
        }
      }
      // C6: erledigte Arbeit widerspricht einem Mangel („Melder gereinigt“ + „Melder verschmutzt“)
      const works = [
        ...(Array.isArray(a.maintenance) ? a.maintenance.map(s) : []),
        ...[...maintenance]
          .map((k) => cat?.maintenance.find((o) => o.key === k)?.label ?? "")
          .filter(Boolean),
      ];
      for (const m of defects)
        for (const w of new Set(works)) {
          const c = workContradiction(w, s(m.title));
          if (c && !conflicts.includes(c)) {
            conflicts.push(c);
            break;
          }
        }
      const noteText = [
        // aufgehobenes „nicht prüfbar“: dessen Grund gehört nicht mehr ins Protokoll
        stateChange
          ? s(d.notes)
              .split("\n")
              .filter((l) => !l.startsWith("Nicht prüfbar:"))
              .join("\n")
          : d.notes,
        s(a.notes),
        a.notInspectable && a.reason ? `Nicht prüfbar: ${s(a.reason)}` : "",
        unknownWork.length ? `Durchgeführt: ${unknownWork.join(", ")}` : "",
      ]
        .map((t) => t.trim())
        .filter((t, i, all) => t && all.indexOf(t) === i)
        .join("\n");
      const body = {
        kinds: d.kinds,
        notInspectable,
        answers,
        maintenance: [...maintenance],
        defects,
        photos: d.photos,
        notes: noteText.slice(0, 5000),
        signature: d.signature ?? null,
        signerName: d.signerName ?? "",
        resultOverride: d.resultOverride,
        resultReason: d.resultReason ?? "",
        resolvedDefects: [...resolved],
        // mit offenem Widerspruch nicht zur Unterschrift bereitlegen
        ready: !conflicts.length,
      };
      const r = (await x.api({
        method: "PUT",
        path: `/inspections/${enc(d.id)}`,
        body,
      })) as { ready: boolean; missing: string[] };
      const result = computeResult({
        notInspectable,
        answers,
        defects: defects as never,
      });
      const openKnown = d.knownDefects.filter(
        (k) =>
          !resolved.has(k.id) && !defects.some((x2) => x2.knownId === k.id),
      );
      const AN: Record<string, string> = {
        ok: "i. O.",
        defect: "Mangel",
        na: "entfällt",
      };
      const status = r.ready && !conflicts.length ? "ready" : "draft";
      // Plan v7 W: Rohdiktat als ausgewertet markieren
      let rawInfo: string | null = null;
      const pendingRaw = (d.rawNotes ?? []).filter((nt) => !nt.evaluated);
      if (mark && pendingRaw.length) {
        const m = (await x.api({
          method: "PATCH",
          path: `/inspections/${enc(d.id)}/raw-notes`,
          body: markIds.length ? { ids: markIds, evaluated: true } : { all: true, evaluated: true },
        })) as { changed: number };
        const left = markIds.length ? pendingRaw.length - m.changed : 0;
        rawInfo = `${m.changed} ${m.changed === 1 ? "Rohnotiz" : "Rohnotizen"} als ausgewertet markiert${left > 0 ? `, ${left} noch offen` : ""}`;
      } else if (pendingRaw.length)
        rawInfo = `${pendingRaw.length} ${pendingRaw.length === 1 ? "Rohnotiz" : "Rohnotizen"} noch nicht ausgewertet (list raw_notes) – nach der Auswertung evaluated: true senden`;
      return compact({
        asset: `${d.asset.code}${d.asset.location ? ` (${d.asset.location})` : ""}`,
        created: announced?.created ?? null,
        typeNote: announced?.typeNote ?? null,
        rawNotes: rawInfo,
        inspectionId: d.id,
        kinds: d.kindLabels.join(", "),
        result: RESULT[result],
        status,
        statusLabel:
          status === "ready"
            ? "bereit zur Unterschrift (in der App)"
            : conflicts.length
              ? "Entwurf – Rückfrage offen"
              : "Entwurf – noch unvollständig",
        stateChange,
        dataChanged: dataChanges,
        checkpoints: cps
          .filter(
            (c) =>
              answers[c.id] &&
              answers[c.id] !== "ok" &&
              !(answers[c.id] === "na" && notApplicable.includes(cpLabel(c.id)!)),
          )
          .map((c) => `${c.label}: ${AN[answers[c.id]]}`),
        notApplicable: notApplicable.length
          ? `${notApplicable.length} ${notApplicable.length === 1 ? "Punkt entfällt" : "Punkte entfallen"} nach den Stammdaten: ${notApplicable.join("; ")}`
          : null,
        defects: defects.map((m) =>
          compact({
            title: m.title,
            ...sevOut(m.severity),
            checkpoint: cpLabel(m.checkpointId),
            known: m.knownId ? "bekannt, weiterhin vorhanden" : null,
          }),
        ),
        fixed: d.knownDefects
          .filter((k) => resolved.has(k.id))
          .map((k) => k.title),
        merged,
        missing: r.missing,
        ask: [
          ...conflicts,
          ...ask,
          ...(openKnown.length
            ? [
                `Bekannte Mängel ohne Angabe (bleiben offen): ${openKnown.map((k) => `${k.title} (defectId ${k.id})`).join("; ")} – noch vorhanden oder behoben?`,
              ]
            : []),
        ],
        notes: notes.length ? notes : null,
        hint: status === "ready" ? SIGN_HINT : null,
      });
    },
  },
  {
    name: "setup",
    title: "Struktur anlegen",
    description:
      "Legt Objekt, Gebäude und Elemente in einem Rutsch an – z. B. nach dem Auswerten eines Grundrisses (get_photo mit „plan:…“), einer Türliste oder eines Prüfprotokolls. Immer zuerst mit `preview: true` aufrufen: zeigt je Gebäude Anzahl je Art und Etage, was neu entsteht und wahrscheinlich schon vorhandene Elemente (gleiche Art, Etage und Standort), ohne etwas zu schreiben. Nach Bestätigung dasselbe mit `preview: false`. Elemente in Laufreihenfolge angeben (Etage, dann Weg) – der Rundgang (tour) hält genau diese Reihenfolge, Etagen von unten nach oben. Je Element optional Hersteller, Typ, Stammdaten (`fields`, Schlüssel aus search(type: \"categories\"), geprüft wie in update_asset), feste Nummer (`number`, z. B. die Ident-Nr. aus dem Protokoll) und ein Katalog-Produkt (`product`: „Hersteller Typ“, füllt leere Stammdaten aus dessen Vorgaben). `count` für gleiche Elemente am selben Standort; `x`/`y` (0–1, relativ zur Bildbreite/-höhe) setzen einen Marker auf dem Grundriss `plan` (Name oder Ebene) des Gebäudes. Objekt mit `access` (Zugang: Schlüssel, Zeiten, Hinweise). Vorhandene Objekte/Gebäude (gleicher Name) werden genutzt, fehlende neu angelegt – das darf nur ein Schreib-Schlüssel (bzw. die Verbindung) einer Person, die Admin oder Inhaber ist; die Vorschau zeigt „wird neu angelegt“ oder sagt, dass das Recht fehlt. Ändern, Löschen und Archivieren von Objekten/Gebäuden gehen über diesen Zugang nie. Elemente brauchen das Recht „darf anlegen“. Weitere Arten (Sprinkler, BMA, RWA …) legt ein Admin in der App als eigene Elementart an (Einstellungen → Prüfvorlagen).",
    inputSchema: obj(
      {
        preview: bool("true = nur Vorschau (zuerst!), false = anlegen"),
        property: obj(
          {
            name: str("Objektname"),
            address: str("Adresse (nur bei neuem Objekt)"),
            access: str(
              "Zugang: Schlüssel, Zeiten, Hinweise (bei neuem Objekt; bei vorhandenem nur mit Admin-Recht)",
            ),
          },
          ["name"],
          "Objekt (vorhanden oder neu)",
        ),
        buildings: arr(
          obj(
            {
              name: str("Gebäudename, z. B. „Haupthaus“"),
              plan: str(
                "Grundriss dieses Gebäudes für Marker: Name oder Ebene (z. B. „EG“ oder „0“)",
              ),
              elements: arr(
                obj(
                  {
                    category: str(
                      "Elementart (Schlüssel oder Bezeichnung, z. B. „Feuerlöscher“)",
                    ),
                    floor: str("Etage, z. B. „EG“"),
                    location: str("Standort, z. B. „Flur vor Raum 0.12“"),
                    count: int(
                      "Anzahl gleicher Elemente hier (Standard 1)",
                      1,
                      50,
                    ),
                    number: int(
                      "feste laufende Nummer im Objekt (bei count > 1 fortlaufend ab hier)",
                      1,
                      99999,
                    ),
                    manufacturer: str("Hersteller"),
                    model: str("Typ/Modell"),
                    product: str(
                      "Katalog-Produkt „Hersteller Typ“ – übernimmt dessen Vorgaben in leere Stammdaten",
                    ),
                    fields: {
                      type: "object",
                      description:
                        'Stammdaten der Elementart als {schlüssel: wert}, z. B. {requirement: "T30-RS", leaves: "2-flügelig", holdOpen: true}',
                      additionalProperties: {
                        type: ["string", "number", "boolean", "null"],
                      },
                    },
                    x: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description:
                        "Marker-Position horizontal (0 = links, 1 = rechts); nur mit count 1",
                    },
                    y: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                      description:
                        "Marker-Position vertikal (0 = oben, 1 = unten); nur mit count 1",
                    },
                  },
                  ["category"],
                ),
                "Elemente in Laufreihenfolge",
                300,
              ),
            },
            ["name"],
          ),
          "Gebäude mit ihren Elementen",
          20,
        ),
      },
      ["preview", "property", "buildings"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const preview = a.preview !== false;
      const pIn = (a.property ?? {}) as Json;
      const pName = s(pIn.name).trim();
      if (!pName) throw new ToolError("property.name fehlt.");
      const access = s(pIn.access).trim();
      const bIn = list(a.buildings);
      if (!bIn.length)
        throw new ToolError(
          "buildings fehlt – mindestens ein Gebäude angeben.",
        );
      const total = bIn.reduce(
        (n, b) =>
          n +
          list(b.elements).reduce((m, e) => m + clamp(e.count, 1, 50, 1), 0),
        0,
      );
      if (total > 300)
        throw new ToolError(
          `${total} Elemente sind zu viele für einen Aufruf (höchstens 300) – bitte je Gebäude oder Etage aufteilen.`,
        );
      const existing = (await properties(x)).find(
        (p) => lc(p.name) === lc(pName),
      );
      const detail = existing
        ? ((await x.api({
            method: "GET",
            path: `/properties/${enc(existing.id)}`,
          })) as Json)
        : null;
      const problems: string[] = [];
      const duplicates: string[] = [];
      // Katalog-Produkte nur laden, wenn eines genannt ist
      let products: CatalogProduct[] | null = null;
      const productOf = async (q: string, category: string) => {
        products ??= (
          (await x
            .api({ method: "GET", path: "/catalog" })
            .catch(() => ({ products: [] }))) as { products?: CatalogProduct[] }
        ).products ?? [];
        const f = foldText(q);
        const pool = products.filter(
          (p) => !p.category || p.category === category,
        );
        return (
          pool.find((p) => foldText(`${p.manufacturer} ${p.model}`) === f) ??
          pool.find((p) => foldText(p.model) === f) ??
          (() => {
            const hits = pool.filter((p) =>
              foldText(`${p.manufacturer} ${p.model}`).includes(f),
            );
            return hits.length === 1 ? hits[0] : null;
          })()
        );
      };
      // vorhandene Elemente (für wahrscheinliche Doppelte) und vergebene Nummern im Objekt
      const have = list(detail?.assets);
      const taken = new Map(
        have
          .filter((e) => e.number != null)
          .map((e) => [Number(e.number), s(e.code)]),
      );
      const wanted = new Map<number, string>();
      // Arten, Stammdaten und Grundrisse vorab auflösen (auch für die Vorschau)
      const plan: {
        name: string;
        id: string | null;
        planId: string | null;
        elements: {
          cat: CategoryInfo;
          floor: string;
          location: string;
          count: number;
          number?: number;
          manufacturer: string;
          model: string;
          attributes: Json;
          x?: number;
          y?: number;
        }[];
      }[] = [];
      for (const b of bIn) {
        const name = s(b.name).trim();
        const found = list(detail?.buildings).find(
          (y) => lc(y.name) === lc(name),
        );
        let planId: string | null = null;
        if (b.plan) {
          const plans = list(detail?.floorPlans).filter(
            (f) => f.buildingId === found?.id,
          );
          const hit =
            plans.find(
              (f) => lc(f.name) === lc(b.plan) || s(f.level) === s(b.plan),
            ) ?? plans.find((f) => lc(f.name).includes(lc(b.plan)));
          if (hit) planId = s(hit.id);
          else
            problems.push(
              `${name}: Grundriss „${s(b.plan)}“ nicht gefunden${found ? "" : " (Gebäude ist neu – Grundriss zuerst in der App hochladen)"} – Marker werden ausgelassen`,
            );
        }
        const elements = [];
        for (const e of list(b.elements)) {
          try {
            const cat = await resolveCategory(x, e.category);
            const count = clamp(e.count, 1, 50, 1);
            const where = [s(e.floor), s(e.location)].filter(Boolean).join(", ");
            const what = `${cat.label}${where ? ` (${where})` : ""}`;
            const hasXY = typeof e.x === "number" && typeof e.y === "number";
            if (hasXY && count > 1)
              problems.push(
                `${name}: Marker nur bei count 1 (${cat.label}, ${s(e.location)})`,
              );
            // Plan v6 F2: Stammdaten geprüft wie in update_asset, Produkt füllt Leeres
            const v = checkedFields(cat, (e.fields ?? {}) as Json);
            if (v.unknown.length)
              problems.push(
                `${name}, ${what}: Felder ${v.unknown.join(", ")} gibt es bei ${cat.label} nicht (möglich: ${cat.attributes.map((f) => f.key).join(", ")}) – ausgelassen`,
              );
            if (v.errors.length)
              throw new ToolError(
                `${what}: ${v.errors.map((er) => er.message).join(" ")}`,
              );
            let attributes: Json = { ...v.values };
            let manufacturer = s(e.manufacturer).trim();
            let model = s(e.model).trim();
            if (s(e.product).trim()) {
              const prod = await productOf(s(e.product), cat.key);
              if (!prod)
                problems.push(
                  `${name}, ${what}: Produkt „${s(e.product)}“ nicht im Katalog (catalog search) – ohne Vorgaben angelegt`,
                );
              else {
                // Plan v7: ein bekannter Typ beschreibt das Element vollständig
                attributes = describeByType(
                  attributes,
                  prod,
                  cat.attributes,
                  cat.key,
                );
                manufacturer ||= prod.manufacturer;
                model ||= prod.model;
              }
            }
            const number =
              e.number != null ? clamp(e.number, 1, 99999, 1) : undefined;
            if (number != null)
              for (let i = 0; i < count; i++) {
                const n = number + i;
                if (taken.has(n))
                  throw new ToolError(
                    `${what}: Nummer ${n} hat in diesem Objekt schon ${taken.get(n)}`,
                  );
                if (wanted.has(n))
                  throw new ToolError(
                    `${what}: Nummer ${n} ist in diesem Aufruf doppelt (auch ${wanted.get(n)})`,
                  );
                wanted.set(n, what);
              }
            // Plan v6 D2: gleiche Art, Etage und Standort gibt es im Gebäude schon
            if (found) {
              const same = have.filter(
                (h) =>
                  h.buildingId === found.id &&
                  h.category === cat.key &&
                  foldText(s(h.floor)) === foldText(s(e.floor)) &&
                  foldText(s(h.location)) === foldText(s(e.location)),
              );
              if (same.length)
                duplicates.push(
                  `${name}: ${count} × ${what} – vorhanden: ${same
                    .slice(0, 5)
                    .map((h) => s(h.code))
                    .join(
                      ", ",
                    )}. Wahrscheinlich doppelt – nur anlegen, wenn wirklich zusätzlich.`,
                );
            }
            elements.push({
              cat,
              floor: s(e.floor),
              location: s(e.location),
              count,
              ...(number != null ? { number } : {}),
              manufacturer,
              model,
              attributes,
              ...(hasXY && count === 1 && planId
                ? { x: Number(e.x), y: Number(e.y) }
                : {}),
            });
          } catch (err) {
            problems.push(`${name}: ${errorText(err)}`);
          }
        }
        plan.push({ name, id: found ? s(found.id) : null, planId, elements });
      }
      const newTotal = plan.reduce(
        (n, b) => n + b.elements.reduce((m, e) => m + e.count, 0),
        0,
      );
      if (preview) {
        // nur die Vorschau fragt das Recht vorab ab; beim Anlegen entscheidet die API (403 → Hinweis unten)
        const structureOk =
          !existing || plan.some((b) => !b.id)
            ? await canCreateStructure(x)
            : true;
        const isNew = structureOk ? "wird neu angelegt" : "neu – fehlt";
        if (!structureOk) {
          if (!existing)
            problems.push(`Objekt „${pName}“ ist neu – ${NEW_STRUCTURE_NOTE}`);
          for (const b of plan)
            if (!b.id)
              problems.push(
                `Gebäude „${b.name}“ ist neu – ${NEW_STRUCTURE_NOTE}`,
              );
        }
        return compact({
          preview: true,
          property: `${pName} (${existing ? "vorhanden" : isNew})`,
          access: access || null,
          buildings: plan.map((b) => {
            const byArt: Record<string, number> = {};
            const byFloor: Record<string, number> = {};
            for (const e of b.elements) {
              byArt[e.cat.label] = (byArt[e.cat.label] ?? 0) + e.count;
              byFloor[e.floor || "ohne Etage"] =
                (byFloor[e.floor || "ohne Etage"] ?? 0) + e.count;
            }
            return compact({
              building: `${b.name} (${b.id ? "vorhanden" : isNew})`,
              elements: b.elements.reduce((n, e) => n + e.count, 0),
              byArt,
              byFloor,
              withData:
                b.elements
                  .filter(
                    (e) =>
                      Object.keys(e.attributes).length ||
                      e.manufacturer ||
                      e.number != null,
                  )
                  .reduce((n, e) => n + e.count, 0) || null,
              markers: b.elements.filter((e) => e.x != null).length || null,
            });
          }),
          total: newTotal,
          possibleDuplicates: duplicates,
          problems,
          next: duplicates.length
            ? "Zur Bestätigung zeigen und die wahrscheinlich doppelten Elemente nachfragen (weglassen oder bewusst zusätzlich); dann mit preview: false anlegen."
            : "Zur Bestätigung zeigen; dann mit preview: false anlegen.",
        });
      }
      let propertyId = existing?.id ?? null;
      if (!propertyId) {
        try {
          propertyId = (
            (await x.api({
              method: "POST",
              path: "/properties",
              body: { name: pName, address: s(pIn.address), access },
            })) as { id: string }
          ).id;
        } catch (e) {
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(NEW_STRUCTURE_HINT(`Objekt „${pName}“`));
          throw e;
        }
      } else if (access && detail && s(detail.access) !== access) {
        // Zugang am vorhandenen Objekt: nur mit Admin-Recht (sonst Hinweis, Elemente trotzdem anlegen)
        try {
          await x.api({
            method: "PATCH",
            path: `/properties/${enc(propertyId)}`,
            body: {
              name: detail.name,
              address: s(detail.address),
              description: s(detail.description),
              contactName: s(detail.contactName),
              contactPhone: s(detail.contactPhone),
              contactEmail: s(detail.contactEmail),
              buildingType: detail.buildingType ?? "general",
              pdfPattern: detail.pdfPattern ?? null,
              access,
            },
          });
        } catch (e) {
          problems.push(
            e instanceof ApiError && e.status === 403
              ? "Zugang nicht gespeichert: Objekte ändern nur Admins (in der App: Objekt → Bearbeiten)."
              : `Zugang nicht gespeichert: ${errorText(e)}`,
          );
        }
      }
      const created: Json[] = [];
      const failed: string[] = [];
      for (const b of plan) {
        let bid = b.id;
        if (!bid) {
          try {
            bid = (
              (await x.api({
                method: "POST",
                path: `/properties/${enc(propertyId)}/buildings`,
                body: { name: b.name },
              })) as { id: string }
            ).id;
          } catch (e) {
            failed.push(
              e instanceof ApiError && e.status === 403
                ? NEW_STRUCTURE_HINT(`Gebäude „${b.name}“`)
                : `Gebäude ${b.name}: ${errorText(e)}`,
            );
            continue;
          }
        }
        const codes: string[] = [];
        let markers = 0;
        for (const e of b.elements) {
          for (let i = 0; i < e.count; i++) {
            try {
              // nacheinander anlegen: die Reihenfolge ist die Laufreihenfolge (sort_index)
              const r = (await x.api({
                method: "POST",
                path: "/assets",
                body: {
                  buildingId: bid,
                  category: e.cat.key,
                  floor: e.floor,
                  location: e.location,
                  manufacturer: e.manufacturer,
                  model: e.model,
                  attributes: e.attributes,
                  ...(e.number != null ? { number: e.number + i } : {}),
                },
              })) as { id: string; code: string };
              codes.push(r.code);
              if (e.x != null && b.planId) {
                await x.api({
                  method: "PUT",
                  path: `/assets/${enc(r.id)}/marker`,
                  body: { floorPlanId: b.planId, x: e.x, y: e.y },
                });
                markers++;
              }
            } catch (err) {
              failed.push(
                `${b.name}, ${e.cat.label} ${e.location}: ${errorText(err)}`,
              );
              // Ohne Recht zum Anlegen scheitert jedes weitere Element genauso
              if (err instanceof ApiError && err.status === 403) break;
            }
          }
        }
        created.push(
          compact({
            building: b.name,
            elements: codes.length,
            codes: codes.slice(0, 60).join(", "),
            more: codes.length > 60 ? codes.length - 60 : null,
            markers: markers || null,
          }),
        );
      }
      const n = created.reduce((m, c) => m + Number(c.elements ?? 0), 0);
      if (!n && failed.length)
        throw new ToolError(
          `Nichts angelegt. ${failed.slice(0, 5).join(" | ")}`,
        );
      return compact({
        property: pName,
        created,
        failed,
        problems,
        possibleDuplicates: duplicates,
        next: n
          ? 'Rundgang starten mit tour(action: "start", building: …).'
          : null,
      });
    },
  },
  {
    name: "catalog",
    title: "Katalog",
    description:
      'Fachwissen des Workspaces: Produkte (Hersteller, Typ, Art, Aliasse = so, wie der Typ in Listen und Ansagen heißt, Anforderung der Tür keine/RS/T30/T30-RS/T90/T90-RS, Vorgabewerte der Stammdaten wie {closer: true, dropSeal: true}, Zulassung und gültig bis), typische Mängel (Titel, Synonyme, Schwere, Maßnahme, Art, zugeordnete Leistungen `serviceKeys` mit Menge `quantity`), Leistungen (Kürzel `key`, Bezeichnung, Einheit, Preis netto, Art maintenance|repair|labor, Bedingung auf Stammdaten wie {requirement: ["T30-RS"], leaves: "1-flügelig"}) und Begriffe (Abkürzung → Bedeutung, z. B. OTS → Obentürschließer). Aus Mängeln und Leistungen rechnet die App die Angebotsliste eines Objekts. `action: "search"` mit `list` (products|defects|services|terms, ohne = alle) und optional `query`/`category`. `action: "suggest"` mit `text` (z. B. ein Befund „OTS zieht nicht zu“ – mehrere Befunde in einem Satz werden einzeln unter `findings` zugeordnet): passende Katalog-Mängel mit Schwere und Maßnahme und ausgeschriebene Begriffe; mit `manufacturer`/`model` passende Produkte. `action: "upsert"` mit `list` und `items` (höchstens 200): legt neu an oder ändert vorhandene Einträge mit gleichem Schlüssel (Hersteller+Typ, Art+Titel, Kürzel, Begriff); nur genannte Felder ändern sich – so baust du den Katalog aus Datenblättern, Prüfprotokollen oder Preislisten auf (Leistungen vor den Mängeln anlegen, die auf sie verweisen). Immer zuerst mit `preview: true` (Standard) aufrufen und die Vorschau zeigen, nach Bestätigung mit `preview: false`. Unbekannte Felder und unbekannte Stammdaten in `defaults` werden je Eintrag als Fehler gemeldet. Anlegen/Ändern darf nur ein Schreib-Schlüssel einer Admin- oder Inhaber-Person; Löschen: Das können nur Admins in der App (Einstellungen → Katalog). Beispiel: {action: "upsert", list: "defects", preview: true, items: [{title: "Haftmagnet brummt", severity: "low", measure: "Netzteil prüfen", category: "Feststellanlage"}]}.',
    inputSchema: obj(
      {
        action: str("search, suggest oder upsert", {
          enum: ["search", "suggest", "upsert"],
        }),
        list: str("Katalogliste", { enum: ["products", "defects", "services", "terms"] }),
        query: str("search: Suchbegriff"),
        category: str(
          "Elementart (Schlüssel oder Bezeichnung) zum Eingrenzen, z. B. „Feststellanlage“",
        ),
        text: str("suggest: Befund oder Diktat, z. B. „OTS schließt nicht“"),
        manufacturer: str("suggest: Hersteller für Produktvorschläge"),
        model: str("suggest: Typ/Modell für Produktvorschläge"),
        preview: bool(
          "upsert: true = nur Vorschau (Standard, zuerst!), false = speichern",
        ),
        items: arr(
          obj({
            manufacturer: str("products: Hersteller"),
            model: str("products: Typ/Modell"),
            defaults: {
              type: "object",
              description:
                'products: Vorgabewerte der Stammdaten als {feld: wert}; Felder der Art aus search(type: "categories")',
              additionalProperties: {
                type: ["string", "number", "boolean", "null"],
              },
            },
            approval: str(
              "products: Zulassung/Prüfzeugnis, z. B. „Z-6.20-1234“",
            ),
            approvalValidUntil: str("products: Zulassung gültig bis (JJJJ-MM-TT)"),
            requirement: str(
              "products: Anforderung der Tür: keine, RS, T30, T30-RS, T90 oder T90-RS",
            ),
            aliases: arr(
              { type: "string" },
              "products: so, wie der Typ in Listen und Ansagen genannt wird, z. B. „SK32“, „T30 RS“",
              30,
            ),
            note: str("products/defects/services: Notiz"),
            title: str("defects: Bezeichnung des Mangels; services: Bezeichnung der Leistung"),
            serviceKeys: arr(
              { type: "string" },
              "defects: Kürzel der Leistungen für die Angebotsliste (die zur Tür passende Bedingung entscheidet)",
              12,
            ),
            quantity: {
              type: "number",
              description: "defects: Menge je Mangel (Standard 1), z. B. 5 für 5 lfm",
            },
            key: str("services: Kürzel, eindeutig, z. B. „IS-SCHWELLE“ oder „4.003“"),
            unit: str("services: Einheit, z. B. Stk, lfm, h"),
            price: { type: "number", description: "services: Preis netto in Euro" },
            kind: str("services: Art der Leistung", {
              enum: ["maintenance", "repair", "labor"],
            }),
            condition: {
              type: "object",
              description:
                'services: Bedingung auf Stammdaten der Art, z. B. {requirement: ["T30-RS", "T90-RS"], leaves: "1-flügelig", closer: true}',
              additionalProperties: {
                type: ["string", "number", "boolean", "array"],
              },
            },
            synonyms: arr(
              { type: "string" },
              "defects: andere Formulierungen, wie man sie vor Ort sagt",
              20,
            ),
            severity: SEVERITY,
            measure: str("defects: übliche Maßnahme"),
            term: str("terms: Abkürzung/Begriff, z. B. „OTS“"),
            meaning: str("terms: Bedeutung, z. B. „Obentürschließer“"),
            category: str(
              "products/defects/services: Elementart (Schlüssel oder Bezeichnung) oder leer = alle",
            ),
          }),
          "upsert: Einträge der Liste `list`",
          200,
        ),
      },
      ["action"],
    ),
    readOnly: false,
    run: async (a, x) => {
      const action = s(a.action);
      const kind = s(a.list);
      const cat = lc(a.category) ? await resolveCategory(x, a.category) : null;
      const cats = await x.categories();
      const label = (k: unknown) =>
        k ? (cats.find((c) => c.key === k)?.label ?? s(k)) : null;
      if (action === "search") {
        const kinds = kind ? [kind] : ["products", "defects", "services", "terms"];
        const out: Json = {};
        for (const k of kinds) {
          const qs = new URLSearchParams();
          if (lc(a.query)) qs.set("q", s(a.query));
          if (cat) qs.set("category", cat.key);
          const rows = (await x.api({
            method: "GET",
            path: `/catalog/${k}?${qs}`,
          })) as Json[];
          out[k] = rows.slice(0, 100).map((r) =>
            k === "products"
              ? compact({
                  manufacturer: r.manufacturer,
                  model: r.model,
                  art: label(r.category),
                  requirement: r.requirement || null,
                  aliases: (r.aliases as string[])?.length
                    ? (r.aliases as string[]).join("; ")
                    : null,
                  defaults:
                    r.defaults && Object.keys(r.defaults as Json).length
                      ? r.defaults
                      : null,
                  approval: r.approval,
                  approvalValidUntil: r.approvalValidUntil ?? null,
                  note: r.note || null,
                })
              : k === "defects"
                ? compact({
                    title: r.title,
                    ...sevOut(r.severity),
                    measure: r.measure,
                    art: label(r.category),
                    synonyms: (r.synonyms as string[])?.length
                      ? (r.synonyms as string[]).join("; ")
                      : null,
                    serviceKeys: (r.serviceKeys as string[])?.length
                      ? r.serviceKeys
                      : null,
                    quantity:
                      (r.serviceKeys as string[])?.length && r.quantity !== 1
                        ? r.quantity
                        : null,
                  })
                : k === "services"
                  ? compact({
                      key: r.key,
                      title: r.title,
                      price: r.price,
                      unit: r.unit,
                      kind: r.kind,
                      art: label(r.category),
                      condition:
                        r.condition && Object.keys(r.condition as Json).length
                          ? r.condition
                          : null,
                      note: r.note || null,
                    })
                  : { term: r.term, meaning: r.meaning },
          );
          if (rows.length > 100) out[`more_${k}`] = rows.length - 100;
        }
        return out;
      }
      if (action === "suggest") {
        const c = (await x.api({ method: "GET", path: "/catalog" })) as {
          products: Parameters<typeof suggestProducts>[1];
          defects: CatalogDefect[];
          terms: { term: string; meaning: string }[];
        };
        const text = s(a.text);
        if (!text && !lc(a.manufacturer) && !lc(a.model))
          throw new ToolError(
            "suggest braucht `text` oder `manufacturer`/`model`.",
          );
        // v6 C3: mehrere Befunde in einem Satz einzeln zuordnen; Katalog-Einträge auch mit ausgeschriebenen Begriffen
        const pool = expandCatalogDefects(c.defects, c.terms);
        const parts = text ? splitFindings(text) : [];
        const expanded = expandTerms(text, c.terms);
        const perPart = parts.map((p) => {
          const e = expandTerms(p, c.terms);
          return {
            text: p,
            expanded: e,
            hits: matchCatalogDefects(e, pool, { category: cat?.key, limit: 3 }),
          };
        });
        const defects = parts.length === 1 ? perPart[0].hits : [];
        const products =
          lc(a.manufacturer) || lc(a.model)
            ? suggestProducts(
                { manufacturer: s(a.manufacturer), model: s(a.model) },
                c.products,
                cat?.key,
              )
            : [];
        const line = (m: (typeof defects)[number]) =>
          compact({
            title: m.defect.title,
            severity: m.defect.severity,
            severityLabel: sev(m.defect.severity),
            measure: m.defect.measure,
            art: label(m.defect.category),
            match: `${Math.round(m.score * 100)} %`,
          });
        return compact({
          understood: expanded !== text ? expanded : null,
          defects: defects.map(line),
          findings:
            parts.length > 1
              ? perPart.map((p) =>
                  compact({
                    text: p.text,
                    understood: p.expanded !== p.text ? p.expanded : null,
                    defects: p.hits.map(line),
                    hint: p.hits.length ? null : "kein passender Katalog-Mangel",
                  }),
                )
              : null,
          products: products.map((p) =>
            compact({
              manufacturer: p.manufacturer,
              model: p.model,
              requirement: p.requirement || null,
              aliases: p.aliases?.length ? p.aliases.join("; ") : null,
              defaults: Object.keys(p.defaults).length ? p.defaults : null,
              approval: p.approval,
            }),
          ),
          hint:
            text && !perPart.some((p) => p.hits.length)
              ? "Kein passender Katalog-Mangel – mit upsert ergänzen, wenn er öfter vorkommt."
              : null,
        });
      }
      if (action === "upsert") {
        if (!["products", "defects", "services", "terms"].includes(kind))
          throw new ToolError(
            "`list` fehlt: products, defects, services oder terms.",
          );
        const items = list(a.items);
        if (!items.length) throw new ToolError("`items` ist leer.");
        if (items.length > 200)
          throw new ToolError(
            "Höchstens 200 Einträge je Aufruf – bitte aufteilen.",
          );
        // Art als Bezeichnung („Feststellanlage“) → Schlüssel
        const prepared: Json[] = [];
        for (const it of items) {
          const e: Json = { ...it };
          if (kind === "terms") delete e.category;
          else if (lc(e.category))
            e.category = (await resolveCategory(x, e.category)).key;
          else if (cat) e.category = cat.key;
          prepared.push(e);
        }
        try {
          const r = (await x.api({
            method: "POST",
            path: "/catalog/batch",
            body: { kind, items: prepared, dryRun: a.preview !== false },
          })) as Json;
          return compact({
            preview: r.dryRun
              ? "nur Vorschau – nach Bestätigung mit preview: false speichern"
              : null,
            saved: r.dryRun ? null : true,
            create: (r.create as string[])?.length ? r.create : null,
            update: (r.update as Json[])?.length
              ? (r.update as Json[]).map(
                  (u) => `${s(u.entry)} (${(u.changes as string[]).join(", ")})`,
                )
              : null,
            unchanged: r.unchanged || null,
            errors: (r.errors as Json[])?.length
              ? (r.errors as Json[]).map(
                  (e) => `${Number(e.index) + 1}. ${s(e.error)}`,
                )
              : null,
            warnings: (r.warnings as Json[])?.length
              ? (r.warnings as Json[]).map(
                  (w) => `${Number(w.index) + 1}. ${s(w.warning)}`,
                )
              : null,
          });
        } catch (e) {
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(
              `Katalog ändern: ${ADMIN_ONLY} (Einstellungen → Katalog) – oder über einen Schreib-Schlüssel einer Admin- bzw. Inhaber-Person. Lesen und suggest gehen weiterhin.`,
            );
          throw e;
        }
      }
      throw new ToolError("`action` muss search, suggest oder upsert sein.");
    },
  },
  {
    name: "autopilot",
    title: "Autopilot",
    description:
      'Den Autopiloten (Kreislauf aus Schritten wie Planen, Zuweisen, Nachhalten) ansehen und bedienen. `action: "view"`: Schritte mit Stufe (Aus, Vorschlagen, Automatisch) und letzter Ausführung, dazu das Protokoll (neueste zuerst). `action: "run"` mit `step` (Schlüssel aus view): den Schritt jetzt einmal ausführen. `action: "undo"` mit `entry` (ID aus dem Protokoll, nur wenn undoable): einen Eintrag rückgängig machen (z. B. angelegte, noch unbearbeitete Aufgaben wieder entfernen). Je Protokolleintrag `id` und `undoable`. Stufen ändern: Das können nur Admins in der App (Einstellungen → Automatik) – über diesen Zugang nie.',
    inputSchema: obj(
      {
        action: str("view, run oder undo", { enum: ["view", "run", "undo"] }),
        step: str(
          "nur run: Schlüssel des Schritts aus view, z. B. „plan_week“",
        ),
        entry: str("nur undo: ID des Protokolleintrags"),
        limit: int("view: Anzahl Protokolleinträge (Standard 20)", 1, 100),
      },
      ["action"],
    ),
    readOnly: false,
    destructive: true,
    run: async (a, x) => {
      if (a.action === "run") {
        const steps = (await x.api({
          method: "GET",
          path: "/automation",
        })) as Json[];
        const st = steps.find(
          (v) => v.key === a.step || lc(v.title) === lc(a.step),
        );
        if (!st)
          throw new ToolError(
            `Schritt „${s(a.step)}“ unbekannt. Möglich: ${steps.map((v) => `${s(v.key)} (${s(v.title)})`).join(", ")}.`,
          );
        if (st.adminOnly)
          throw new ToolError(`„${s(st.title)}“: ${ADMIN_ONLY}`);
        try {
          const r = (await x.api({
            method: "POST",
            path: `/automation/${enc(s(st.key))}/run`,
          })) as Json;
          return { step: st.title, done: r.done };
        } catch (e) {
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(`„${s(st.title)}“ ausführen: ${ADMIN_ONLY}`);
          throw e;
        }
      }
      if (a.action === "undo") {
        if (!a.entry)
          throw new ToolError(
            'entry fehlt – autopilot(action: "view") zeigt je Eintrag `id` und `undoable`.',
          );
        let r: Json;
        try {
          r = (await x.api({
            method: "POST",
            path: `/automation/log/${enc(s(a.entry))}/undo`,
          })) as Json;
        } catch (e) {
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(
              `Diesen Eintrag rückgängig machen darf nur, wem er etwas zugewiesen hat – sonst: ${ADMIN_ONLY}`,
            );
          throw e;
        }
        return compact({
          undone: true,
          reverted: r.reverted,
          kept: Number(r.kept)
            ? `${s(r.kept)} blieb(en), weil schon jemand daran arbeitet`
            : null,
        });
      }
      const f = await fmt(x);
      const MODE: Record<string, string> = {
        off: "Aus",
        suggest: "Vorschlagen",
        auto: "Automatisch",
      };
      const [steps, log] = await Promise.all([
        x.api({ method: "GET", path: "/automation" }) as Promise<Json[]>,
        x.api({
          method: "GET",
          path: `/automation/log?limit=${clamp(a.limit, 1, 100, 20)}`,
        }) as Promise<Json[]>,
      ]);
      return {
        steps: steps.map((v) =>
          compact({
            step: v.key,
            title: v.title,
            mode: MODE[s(v.mode)] ?? v.mode,
            effective:
              v.effectiveMode && v.effectiveMode !== v.mode
                ? `${MODE[s(v.effectiveMode)] ?? v.effectiveMode} (Autopilot aus)`
                : null,
            what: v.description,
            lastRun: f.dayTime(v.lastRunAt),
            adminOnly: v.adminOnly ? true : null,
          }),
        ),
        // v6 B7: je Eintrag ID und ob er sich rückgängig machen lässt (undo mit entry: id)
        log: log.map((e) =>
          compact({
            id: e.id,
            at: f.dayTime(e.at),
            step: e.title,
            summary: e.summary,
            by: e.actorName,
            undone: e.undoneAt ? true : null,
            undoable: !!e.undoable,
          }),
        ),
        note: `Stufen ändern: ${ADMIN_ONLY} (Einstellungen → Automatik)`,
      };
    },
  },
  {
    name: "report",
    title: "Kennzahlen und Angebotsliste",
    description:
      "what: \"offer\" mit property liefert die Angebotsliste des Objekts in Kurzform (Leistung, Menge × Einzelpreis, Türnummern, Summe netto, nicht zugeordnete Mängel) – eine Liste zum Weiterverarbeiten, kein Versand. Sonst (what: \"figures\"): Kennzahlen als fertiger Text für einen Zeitraum und optional ein Objekt: Prüfungen (Anzahl, Ergebnisse, Nachprüfungen), Prüfquote (Anteil der schon einmal geprüften Elemente, die nicht überfällig sind – nie geprüfte stehen getrennt), neue und behobene Mängel nach Schwere, mittlere Behebungsdauer (ungültige Mängel zählen nicht), offene Mängel und Aufgaben, Entwürfe und Unterschrifts-Rückstau, Begehungen. Zeitraum in der Zeitzone des Workspaces: `month` („2026-10“, ganzer Monat bis zum letzten Tag), `year` (2026) oder `from`/`to` (ISO oder „30.11.“); Standard: die letzten 30 Tage. Gut als Grundlage für einen Monatsbericht. Nur lesend.",
    inputSchema: obj({
      what: str(
        "figures (Standard) = Kennzahlen; offer = Angebotsliste eines Objekts aus den offenen Mängeln (Position, Menge, Türnummern, Preis, nicht zugeordnete Mängel) – braucht property",
        { enum: ["figures", "offer"] },
      ),
      property: str("Objektname; ohne Angabe alle im Zugriffsbereich (bei offer Pflicht)"),
      month: str("Monat „JJJJ-MM“, z. B. „2026-10“"),
      year: int("Kalenderjahr", 2000, 2100),
      from: str("ab (Datum)"),
      to: str("bis einschließlich (Datum)"),
    }),
    readOnly: true,
    run: async (a, x) => {
      // Plan v7 X: Angebotsliste in Kurzform (dieselben Daten wie Objekt → Angebot in der App)
      if (a.what === "offer") {
        if (!a.property)
          throw new ToolError(
            'Für die Angebotsliste ein Objekt angeben (property). Objekte liefert search(type: "properties").',
          );
        const p = await resolveProperty(x, a.property);
        let raw: unknown;
        try {
          raw = await x.api({ method: "GET", path: `/properties/${enc(p.id)}/offer` });
        } catch (e) {
          // Preise sind intern: ab Prüfer (Schlüssel „Lesen und schreiben“), nicht mit Leseschlüssel oder Lesezugriff
          if (e instanceof ApiError && e.status === 403)
            throw new ToolError(
              "Die Angebotsliste enthält Preise und ist erst ab der Rolle Prüfer lesbar – dieser Zugang (Schlüssel „Nur lesen“ bzw. Lesezugriff) darf sie nicht abrufen. Mit einem Schlüssel „Lesen und schreiben“ einer Person ab Prüfer geht es; Kennzahlen (what: \"figures\") gehen auch so.",
            );
          throw e;
        }
        const offer = normalizeOffer(raw);
        return offerText(offer, p.name);
      }
      const prop = a.property ? await resolveProperty(x, a.property) : null;
      const tz = await tzOf(x);
      const de = (ms: number) => {
        const [y, m, d] = dayIn(ms, tz).split("-");
        return `${d}.${m}.${y}`;
      };
      let from: number;
      let to: number;
      try {
        if (a.month) {
          // v6 E2: Monatsgrenzen in der Zeitzone des Workspaces – „bis 30.11.“, nicht „bis 01.12.“
          ({ from, to } = monthRange(s(a.month), tz));
        } else if (a.year) {
          from = monthRange(`${Number(a.year)}-01`, tz).from;
          to = monthRange(`${Number(a.year)}-12`, tz).to;
        } else {
          to =
            (await dateArg(x, a.to, "to", { allowPast: true, time: "end" })) ??
            Date.now();
          from =
            (await dateArg(x, a.from, "from", { allowPast: true, time: "start" })) ??
            to - 30 * 86_400_000;
        }
      } catch (e) {
        if (e instanceof Error && !(e instanceof ApiError)) throw new ToolError(e.message);
        throw e;
      }
      if (from > to) throw new ToolError("from liegt nach to.");
      const pq = prop ? `&propertyId=${enc(prop.id)}` : "";
      const [insp, defects, tasks, props, walks, drafts] = await Promise.all([
        x.api({
          method: "GET",
          path: `/inspections?status=submitted&from=${from}&to=${to}${pq}`,
        }) as Promise<Json[]>,
        x.api({ method: "GET", path: "/defects?status=all" }) as Promise<
          Json[]
        >,
        x.api({ method: "GET", path: "/tasks" }) as Promise<Json[]>,
        properties(x),
        x.api({ method: "GET", path: "/walkthroughs" }) as Promise<Json[]>,
        x
          .api({ method: "GET", path: `/inspections?status=draft${pq}` })
          .catch(() => []) as Promise<Json[]>,
      ]);
      const inProp = (r: Json) => !prop || r.propertyId === prop.id;
      const all = defects.filter(inProp);
      // v6 B8: ungültige Mängel (Duplikat/Fehleintrag) zählen weder als neu noch in Quote und Dauer
      const ds = all.filter((d) => d.status !== "invalid");
      const inPeriod = (v: unknown) => Number(v) >= from && Number(v) <= to;
      const newD = ds.filter((d) => inPeriod(d.createdAt));
      const invalidD = all.filter((d) => d.status === "invalid" && inPeriod(d.invalidAt));
      const fixed = ds.filter((d) => d.status === "resolved" && inPeriod(d.resolvedAt));
      const durations = fixed
        .map((d) => (Number(d.resolvedAt) - Number(d.createdAt)) / 86_400_000)
        .filter((v) => v >= 0);
      const openNow = ds.filter((d) => d.status === "open");
      const ps = props.filter((p) => !prop || p.id === prop.id);
      const el = ps.reduce((n, p) => n + Number(p.assets), 0);
      const overdue = ps.reduce((n, p) => n + Number(p.overdue), 0);
      const never = ps.reduce((n, p) => n + Number(p.never), 0);
      const byResult: Record<string, number> = {};
      for (const i of insp)
        byResult[RESULT[s(i.result)] ?? s(i.result)] =
          (byResult[RESULT[s(i.result)] ?? s(i.result)] ?? 0) + 1;
      const bySev = (rows: Json[]) =>
        (["critical", "high", "medium", "low"] as const)
          .map(
            (k) =>
              [
                SEVERITIES[k],
                rows.filter((d) => d.severity === k).length,
              ] as const,
          )
          .filter(([, n]) => n)
          .map(([l, n]) => `${n} ${l.toLowerCase()}`)
          .join(", ") || "0";
      const ts = tasks
        .filter(inProp)
        .filter((t) => t.status === "open" || t.status === "in_progress");
      const lateTasks = ts.filter(
        (t) => typeof t.dueAt === "number" && Number(t.dueAt) < Date.now(),
      );
      const wk = walks
        .filter(inProp)
        .filter((w) => w.status === "submitted" && inPeriod(w.inspectedAt));
      const pct = (n: number, of: number) =>
        of ? `${Math.round((n / of) * 100)} %` : "–";
      // v6 E3: Quote nur über schon einmal geprüfte Elemente; nie geprüfte getrennt
      const checked = el - never;
      const ready = drafts.filter((d) => d.readyAt);
      const oldestReady = ready.reduce<number | null>(
        (m, d) => (m == null || Number(d.readyAt) < m ? Number(d.readyAt) : m),
        null,
      );
      return [
        `Kennzahlen ${prop ? `„${prop.name}“` : "alle Objekte"} · ${de(from)} bis ${de(to)}`,
        "",
        "Prüfungen",
        `- durchgeführt: ${insp.length}${
          insp.length
            ? ` (${Object.entries(byResult)
                .map(([k, v]) => `${v} ${k}`)
                .join(", ")})`
            : ""
        }`,
        `- davon Nachprüfungen: ${insp.filter((i) => i.purpose === "follow_up").length}`,
        `- Prüfquote heute: ${pct(checked - overdue, checked)} der ${checked} schon geprüften Elemente fristgerecht (${overdue} überfällig)`,
        `- nie geprüft: ${never} von ${el} Elementen (nicht in der Quote)`,
        `- in Arbeit: ${drafts.length - ready.length} Entwürfe; Unterschrifts-Rückstau: ${ready.length}${oldestReady ? ` (älteste bereit seit ${de(oldestReady)})` : ""}`,
        "",
        "Mängel",
        `- neu: ${newD.length} (${bySev(newD)}); davon aus Begehungen: ${newD.filter((d) => d.walkthroughId).length}`,
        `- behoben: ${fixed.length}${durations.length ? `, im Mittel nach ${(durations.reduce((m, v) => m + v, 0) / durations.length).toFixed(1).replace(".", ",")} Tagen` : ""}`,
        ...(invalidD.length
          ? [`- als ungültig markiert: ${invalidD.length} (Duplikat/Fehleintrag, zählen nicht mit)`]
          : []),
        `- offen heute: ${openNow.length} (${bySev(openNow)}); ohne Aufgabe: ${openNow.filter((d) => d.withoutTask).length}`,
        "",
        "Aufgaben",
        `- offen: ${ts.length}, davon überfällig: ${lateTasks.length}`,
        "",
        "Begehungen",
        `- durchgeführt: ${wk.length}${wk.length ? ` (${wk.map((w) => `${de(Number(w.inspectedAt))} ${s(w.propertyName)}`).join("; ")})` : ""}`,
      ].join("\n");
    },
  },
];

/** Fehlertext für das Modell: was schiefging und was stattdessen geht. */
export function errorText(e: unknown): string {
  if (e instanceof ToolError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 403)
      return `Keine Berechtigung: ${e.message}. Dieser Zugang darf das nicht (z. B. Schlüssel „Nur lesen“, kein Recht zum Anlegen oder Admin-Funktion). Schreiben geht mit einem Schlüssel „Lesen und schreiben“ (Prüfkompass → Einstellungen → API). Admin-Funktionen: Das können nur Admins in der App.`;
    if (e.status === 404)
      return `${e.message} – nicht vorhanden oder außerhalb deines Zugriffsbereichs. Mit search oder list nachsehen.`;
    if (e.status === 409) return `${e.message}.`;
    if (e.status === 429) return `${e.message} (zu viele Anfragen).`;
    return e.message;
  }
  console.error("mcp tool", e);
  return "Interner Fehler – bitte später erneut versuchen.";
}

export function b64(buf: ArrayBuffer) {
  let out = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Werkzeug ausführen und als MCP-Ergebnis verpacken. */
export async function runTool(tool: Tool, args: Json, api: Api, raw: ApiRaw) {
  let cats: Promise<CategoryInfo[]> | null = null;
  const x: Ctx = {
    api,
    raw,
    categories: () =>
      (cats ??= api({ method: "GET", path: "/categories" }) as Promise<
        CategoryInfo[]
      >),
  };
  try {
    const out = await tool.run(args ?? {}, x);
    if (typeof out === "string")
      return { content: [{ type: "text", text: out }], isError: false };
    if ("content" in out && Array.isArray(out.content))
      return { content: out.content, isError: false };
    return {
      content: [{ type: "text", text: JSON.stringify(out) }],
      structuredContent: out,
      isError: false,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Fehler: ${errorText(e)}` }],
      isError: true,
    };
  }
}
