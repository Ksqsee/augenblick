// KI-Funktionen über Workers AI (bleibt in Cloudflare, kein weiterer Anbieter).
// Ohne Binding (lokal, CI) bzw. bei Fehlern greift der regelbasierte Parser aus shared/smart.ts.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { SEVERITIES } from '../shared/catalog';
import { type CaptureCategory, type CaptureItem, MAX_BULK_ASSETS, parseCapture } from '../shared/smart';
import { listCategories } from './categories';
import { tid } from './data';
import { type AppEnv, type Ctx, requireRole } from './lib';
import { assertNotThrottled, recordFailure } from './throttle';

export const ai = new Hono<AppEnv>();

const TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo';
const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MAX_AUDIO = 8 * 1024 * 1024;

/** Fachwörter helfen der Spracherkennung bei Normen und Bauteilen. */
const VOCABULARY =
  'Brandschutzprüfung, Feuerschutztür, Brandschutzklappe, Feuerlöscher, Rauchwarnmelder, Feststellanlage, Obentürschließer, Dichtung, Zarge, Plombe, Prüfplakette, Rettungsweg, DIN 14677, DIN 14676, Mangel, Maßnahme.';

/** Im Dev-Server ist das Binding vorhanden, aber ohne Cloudflare-Konto nicht nutzbar. */
const hasAi = (c: Ctx) => !!c.env.AI && !(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

function b64(buf: ArrayBuffer) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Kosten begrenzen: KI-Aufrufe je Person und Stunde drosseln (gleiche Tabelle wie die Login-Sperre). */
async function meter(c: Ctx) {
  const who = c.get('user').userId;
  await assertNotThrottled(c, 'ai-user', who);
  await recordFailure(c, 'ai-user', who);
}

ai.get('/ai/status', (c) => c.json({ transcribe: hasAi(c), structure: hasAi(c) ? 'ai' : 'rules', vision: hasAi(c) }));

/** Sprachaufnahme in Text umwandeln. */
ai.post('/ai/transcribe', async (c) => {
  requireRole(c, 'inspector');
  if (!hasAi(c)) throw new HTTPException(503, { message: 'Diktat ist in dieser Umgebung nicht verfügbar' });
  const type = (c.req.header('content-type') ?? '').split(';')[0];
  if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|m4a)$/.test(type)) throw new HTTPException(415, { message: 'Nicht unterstütztes Audioformat' });
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength) throw new HTTPException(400, { message: 'Leere Aufnahme' });
  if (buf.byteLength > MAX_AUDIO) throw new HTTPException(413, { message: 'Aufnahme zu lang (max. ca. 8 Minuten)' });
  await meter(c);
  try {
    const out = (await c.env.AI!.run(TRANSCRIBE_MODEL, { audio: b64(buf), language: 'de', vad_filter: true, initial_prompt: VOCABULARY })) as { text?: string };
    return c.json({ text: (out.text ?? '').trim() });
  } catch (e) {
    console.error('ai transcribe', e);
    throw new HTTPException(503, { message: 'Spracherkennung gerade nicht erreichbar – bitte erneut versuchen' });
  }
});

const itemSchema = z.object({
  kind: z.enum(['defect', 'task', 'note', 'asset']),
  title: z.string().min(1).max(300),
  note: z.string().max(2000).default(''),
  severity: z.enum(Object.keys(SEVERITIES) as ['low', 'medium', 'high', 'critical']).default('medium'),
  measure: z.string().max(500).default(''),
  assetCode: z.string().max(40).nullable().default(null),
  checkpointId: z.string().max(40).nullable().default(null),
  dueInDays: z.number().int().min(0).max(365).nullable().default(null),
  // Sammelanlage (kind "asset")
  count: z.number().int().min(1).max(500).optional().catch(undefined),
  category: z.string().max(60).nullable().optional().catch(null),
  floor: z.string().max(60).optional().catch(undefined),
  location: z.string().max(200).optional().catch(undefined),
});

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['defect', 'task', 'note', 'asset'] },
          title: { type: 'string' },
          note: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          measure: { type: 'string' },
          assetCode: { type: ['string', 'null'] },
          checkpointId: { type: ['string', 'null'] },
          dueInDays: { type: ['integer', 'null'] },
          count: { type: 'integer' },
          category: { type: ['string', 'null'] },
          floor: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['kind', 'title', 'severity'],
      },
    },
  },
  required: ['items'],
};

/** Strukturierung per KI; liefert null, wenn nicht verfügbar oder unbrauchbar. */
export async function structureWithAi(c: Ctx, text: string, checkpoints: { id: string; label: string }[], categories: CaptureCategory[] = []): Promise<CaptureItem[] | null> {
  if (!hasAi(c)) return null;
  const system = [
    'Du strukturierst diktierte Notizen einer Brandschutzprüfung auf Deutsch.',
    'Zerlege den Text in einzelne Einträge: kind "defect" = festgestellter Mangel, "task" = zu erledigende Aufgabe, "note" = sonstiger Hinweis, "asset" = neu anzulegende Elemente (z. B. "fünf Feuerlöscher im EG Flur").',
    categories.length
      ? `Bei "asset": count = Anzahl, category = Schlüssel aus dieser Liste (Schlüssel=Bezeichnung): ${categories.map((x) => `${x.key}=${x.label}`).join('; ')}; floor = Etage kurz (EG, 1. OG, UG, DG), location = Standort ohne Etage. title = der diktierte Satz.`
      : '',
    'title: kurzer, sachlicher Satz (max. 12 Wörter), ohne Füllwörter. note: weitere Details aus dem Text, sonst leer.',
    'severity: low (optisch), medium (Funktion eingeschränkt), high (Schutzfunktion gefährdet), critical (Gefahr im Verzug, Funktion fehlt).',
    'measure: konkrete, fachlich übliche Maßnahme zur Behebung (bei defect), sonst leer.',
    'assetCode: nur wenn ein Element-Code wie "FST-7K2M" genannt wird, sonst null.',
    'checkpointId: ID aus der Prüfpunktliste, wenn der Mangel eindeutig dazu passt, sonst null.',
    'dueInDays: Frist in Tagen, wenn genannt (z. B. "bis morgen" = 1), sonst null.',
    'Erfinde nichts, was nicht im Text steht.',
    checkpoints.length ? `Prüfpunkte: ${checkpoints.map((p) => `${p.id}=${p.label}`).join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const out = (await c.env.AI!.run(TEXT_MODEL, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
      max_tokens: 1500,
      temperature: 0.1,
    } as never)) as { response?: unknown };
    const raw = typeof out.response === 'string' ? JSON.parse(out.response) : out.response;
    const parsed = z.object({ items: z.array(itemSchema).max(50) }).parse(raw);
    const ids = new Set(checkpoints.map((p) => p.id));
    const keys = new Set(categories.map((x) => x.key));
    return parsed.items.map((i) => {
      const item: CaptureItem = { ...i, checkpointId: i.checkpointId && ids.has(i.checkpointId) ? i.checkpointId : null };
      if (i.kind !== 'asset') return { ...item, count: undefined, category: undefined, floor: undefined, location: undefined };
      return { ...item, count: Math.min(Math.max(i.count ?? 1, 1), MAX_BULK_ASSETS), category: i.category && keys.has(i.category) ? i.category : null, floor: i.floor ?? '', location: i.location ?? '' };
    });
  } catch (e) {
    console.error('ai structure', e);
    return null;
  }
}

/** Diktat strukturieren: KI, sonst Regeln. */
ai.post('/ai/parse', async (c) => {
  requireRole(c, 'inspector');
  const b = z
    .object({
      text: z.string().trim().min(1).max(8000),
      checkpoints: z.array(z.object({ id: z.string().max(40), label: z.string().max(300) })).max(120).default([]),
      /** Elementarten für Sammelanlagen; ohne Angabe die des Workspaces */
      categories: z.array(z.object({ key: z.string().max(60), label: z.string().max(120), plural: z.string().max(120).optional() })).max(200).optional(),
    })
    .parse(await c.req.json());
  if (hasAi(c)) await meter(c);
  const categories = b.categories ?? (await listCategories(c)).map((x) => ({ key: x.key, label: x.label, plural: x.plural }));
  const items = await structureWithAi(c, b.text, b.checkpoints, categories);
  return c.json(items ? { items, source: 'ai' } : { items: parseCapture(b.text, { checkpoints: b.checkpoints, categories }), source: 'rules' });
});

/** Typenschild-Foto auslesen (Hersteller, Modell, Baujahr, Seriennummer, Zulassung). */
ai.post('/ai/typeplate', async (c) => {
  requireRole(c, 'inspector');
  if (!hasAi(c)) throw new HTTPException(503, { message: 'Typenschild-Erkennung ist in dieser Umgebung nicht verfügbar' });
  const { key } = z.object({ key: z.string().max(200) }).parse(await c.req.json());
  if (!key.startsWith(`${tid(c)}/`)) throw new HTTPException(400, { message: 'Ungültige Datei' });
  const obj = await c.env.FILES.get(key);
  if (!obj) throw new HTTPException(404, { message: 'Foto nicht gefunden' });
  await meter(c);
  const type = obj.httpMetadata?.contentType ?? 'image/jpeg';
  const image = `data:${type};base64,${b64(await obj.arrayBuffer())}`;
  const out = (await c.env.AI!.run(VISION_MODEL, {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Lies das Typenschild. Antworte nur mit JSON: {"manufacturer":string|null,"model":string|null,"year":number|null,"serial":string|null,"approval":string|null}. Nur, was lesbar ist.' },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    max_tokens: 300,
  } as never)) as { response?: unknown };
  try {
    const raw = typeof out.response === 'string' ? JSON.parse(String(out.response).replace(/^[^{]*/, '').replace(/[^}]*$/, '')) : out.response;
    const r = z
      .object({ manufacturer: z.string().max(120).nullable().catch(null), model: z.string().max(120).nullable().catch(null), year: z.coerce.number().int().min(1900).max(2100).nullable().catch(null), serial: z.string().max(80).nullable().catch(null), approval: z.string().max(80).nullable().catch(null) })
      .parse(raw);
    return c.json(r);
  } catch {
    throw new HTTPException(422, { message: 'Typenschild nicht lesbar' });
  }
});

/** JSON aus einer Modellantwort lösen (auch wenn Text drumherum steht). */
function looseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  return JSON.parse(v.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
}

/** Foto zuerst beim Anlegen: Art des Elements erkennen und Typenschild-Daten auslesen. */
ai.post('/ai/identify', async (c) => {
  requireRole(c, 'inspector');
  if (!hasAi(c)) throw new HTTPException(503, { message: 'Bilderkennung ist in dieser Umgebung nicht verfügbar' });
  const { key } = z.object({ key: z.string().max(200) }).parse(await c.req.json());
  if (!key.startsWith(`${tid(c)}/`)) throw new HTTPException(400, { message: 'Ungültige Datei' });
  const obj = await c.env.FILES.get(key);
  if (!obj) throw new HTTPException(404, { message: 'Foto nicht gefunden' });
  await meter(c);
  const cats = (await listCategories(c)).map((x) => ({ key: x.key, label: x.label }));
  const type = obj.httpMetadata?.contentType ?? 'image/jpeg';
  const image = `data:${type};base64,${b64(await obj.arrayBuffer())}`;
  const prompt = [
    'Auf dem Foto ist ein Bauteil des Brandschutzes (z. B. Feuerlöscher, Feuerschutztür, Rauchwarnmelder).',
    `Ordne es genau einer dieser Arten zu (Schlüssel=Bezeichnung): ${cats.map((x) => `${x.key}=${x.label}`).join('; ')}.`,
    'Lies außerdem ein sichtbares Typenschild. Antworte nur mit JSON:',
    '{"category":string|null,"manufacturer":string|null,"model":string|null,"year":number|null,"serial":string|null,"confidence":number}',
    'category ist der Schlüssel oder null, wenn unklar; confidence zwischen 0 und 1. Erfinde nichts, was nicht zu sehen ist.',
  ].join('\n');
  try {
    const out = (await c.env.AI!.run(VISION_MODEL, {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }],
      max_tokens: 300,
    } as never)) as { response?: unknown };
    const r = z
      .object({
        category: z.string().max(60).nullable().catch(null),
        manufacturer: z.string().max(120).nullable().catch(null),
        model: z.string().max(120).nullable().catch(null),
        year: z.coerce.number().int().min(1900).max(2100).nullable().catch(null),
        serial: z.string().max(80).nullable().catch(null),
        confidence: z.coerce.number().min(0).max(1).catch(0),
      })
      .parse(looseJson(out.response));
    const known = cats.some((x) => x.key === r.category);
    return c.json({ ...r, category: known ? r.category : null, confidence: known ? r.confidence : 0 });
  } catch (e) {
    console.error('ai identify', e);
    throw new HTTPException(503, { message: 'Bilderkennung gerade nicht möglich' });
  }
});
