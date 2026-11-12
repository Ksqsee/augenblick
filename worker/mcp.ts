// MCP-Server (Model Context Protocol, Streamable HTTP ohne Sitzungszustand) für Claude & Co.
// Authentifizierung über API-Schlüssel des Workspaces. Jedes Werkzeug ruft intern die normale API auf –
// Rollen, Lese-/Schreibrechte des Schlüssels und Validierung gelten dadurch unverändert.
import { Hono } from 'hono';
import type { AppEnv, Ctx } from './lib';

export const MCP_PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'pruefkompass', title: 'Prüfkompass', version: '1.0.0' };

type Json = Record<string, unknown>;
type Call = { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown };

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  readOnly: boolean;
  /** Übersetzt die Argumente in einen oder mehrere API-Aufrufe (Ergebnis des letzten wird zurückgegeben). */
  run: (a: Json, api: (c: Call) => Promise<unknown>) => Promise<unknown>;
}

const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });
const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const qs = (a: Json, keys: string[]) => {
  const p = new URLSearchParams();
  for (const k of keys) if (a[k] != null && a[k] !== '') p.set(k, String(a[k]));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;
const toMs = (v: unknown) => (typeof v === 'string' && v ? Date.parse(v) : typeof v === 'number' ? v : undefined);

export const TOOLS: Tool[] = [
  {
    name: 'dashboard',
    title: 'Übersicht',
    description: 'Kennzahlen des Workspaces: überfällige, bald fällige und nie geprüfte Elemente, offene/kritische Mängel, Entwürfe, Objektstatus, letzte Prüfungen, offene Aufgaben.',
    inputSchema: obj({}),
    readOnly: true,
    run: (_a, api) => api({ method: 'GET', path: '/dashboard' }),
  },
  {
    name: 'search',
    title: 'Suchen',
    description: 'Volltextsuche über Objekte, Gebäude und Elemente (Code, Standort, Hersteller, Etikett).',
    inputSchema: obj({ query: str('Suchbegriff, mindestens 2 Zeichen') }, ['query']),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/search?q=${enc(String(a.query))}` }),
  },
  {
    name: 'list_properties',
    title: 'Objekte auflisten',
    description: 'Alle Objekte (Liegenschaften) mit Anzahl Elementen, überfällig, bald fällig, ungeprüft, offenen Mängeln und nächster Begehung.',
    inputSchema: obj({}),
    readOnly: true,
    run: (_a, api) => api({ method: 'GET', path: '/properties' }),
  },
  {
    name: 'get_property',
    title: 'Objekt abrufen',
    description: 'Ein Objekt mit Gebäuden, Grundrissen, Elementen, Begehungen und Brandschutzbeauftragten.',
    inputSchema: obj({ propertyId: str('ID des Objekts') }, ['propertyId']),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/properties/${enc(String(a.propertyId))}` }),
  },
  {
    name: 'list_assets',
    title: 'Elemente auflisten',
    description: 'Prüfpflichtige Elemente (Feuerschutztüren, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder, eigene Arten) mit Fälligkeit. Filterbar.',
    inputSchema: obj({
      due: str('Fälligkeitsfilter', { enum: ['overdue', 'soon', 'never', 'not_inspectable', 'new', 'defects'] }),
      category: str('Elementart-Schlüssel, z. B. fire_door, damper, extinguisher, smoke_alarm'),
      propertyId: str('nur dieses Objekt'),
      buildingId: str('nur dieses Gebäude'),
      query: str('Freitext (Code, Standort, Hersteller, Gebäude, Objekt)'),
    }),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/assets${qs({ ...a, q: a.query }, ['due', 'category', 'propertyId', 'buildingId', 'q'])}` }),
  },
  {
    name: 'get_asset',
    title: 'Element abrufen',
    description: 'Ein Element mit Prüfarten, Prüfhistorie, Mängeln und Anhängen – per ID oder per Code/Etikett.',
    inputSchema: obj({ assetId: str('ID des Elements'), code: str('Code oder QR-Etikett, z. B. FST-7K2M') }),
    readOnly: true,
    run: async (a, api) => {
      const id = a.assetId ? String(a.assetId) : ((await api({ method: 'GET', path: `/assets/by-code/${enc(String(a.code ?? ''))}` })) as { id: string }).id;
      return api({ method: 'GET', path: `/assets/${enc(id)}` });
    },
  },
  {
    name: 'list_inspections',
    title: 'Prüfungen auflisten',
    description: 'Prüfungen (ohne berichtigte), optional gefiltert nach Status, Objekt und Zeitraum.',
    inputSchema: obj({
      status: str('Status', { enum: ['submitted', 'draft'] }),
      propertyId: str('nur dieses Objekt'),
      from: str('ab Datum (ISO, z. B. 2026-01-01)'),
      to: str('bis Datum (ISO)'),
    }),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/inspections${qs({ ...a, from: toMs(a.from), to: toMs(a.to) }, ['status', 'propertyId', 'from', 'to'])}` }),
  },
  {
    name: 'get_inspection',
    title: 'Prüfprotokoll abrufen',
    description: 'Ein Prüfprotokoll mit Prüfpunkten, Befunden, Mängeln, Maßnahmen, Gesamtbewertung und Unterschriftsstatus.',
    inputSchema: obj({ inspectionId: str('ID der Prüfung') }, ['inspectionId']),
    readOnly: true,
    run: async (a, api) => {
      const r = (await api({ method: 'GET', path: `/inspections/${enc(String(a.inspectionId))}` })) as Json;
      return { ...r, signature: r.signature ? '(vorhanden)' : null };
    },
  },
  {
    name: 'list_defects',
    title: 'Mängel auflisten',
    description: 'Mängel aus Prüfungen und Begehungen mit Schwere, Maßnahme, Element und Objekt.',
    inputSchema: obj({ status: str('Status', { enum: ['open', 'resolved', 'all'] }), source: str('Herkunft', { enum: ['asset', 'walkthrough'] }) }),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/defects${qs({ status: a.status ?? 'open', source: a.source }, ['status', 'source'])}` }),
  },
  {
    name: 'resolve_defect',
    title: 'Mangel als behoben markieren',
    description: 'Setzt einen Mangel auf behoben (oder mit reopen=true wieder auf offen).',
    inputSchema: obj({ defectId: str('ID des Mangels'), reopen: { type: 'boolean', description: 'wieder öffnen statt beheben' } }, ['defectId']),
    readOnly: false,
    run: (a, api) => api({ method: 'PATCH', path: `/defects/${enc(String(a.defectId))}`, body: { status: a.reopen ? 'open' : 'resolved' } }),
  },
  {
    name: 'list_tasks',
    title: 'Aufgaben auflisten',
    description: 'Aufgaben mit Status, Priorität, Fälligkeit, Zuständigen, Subunternehmer und SLA-Status.',
    inputSchema: obj({ status: str('nur diesen Status', { enum: ['open', 'in_progress', 'done', 'cancelled'] }) }),
    readOnly: true,
    run: async (a, api) => {
      const rows = (await api({ method: 'GET', path: '/tasks' })) as Json[];
      return (a.status ? rows.filter((t) => t.status === a.status) : rows).map(({ shareToken: _s, ...t }) => t);
    },
  },
  {
    name: 'create_task',
    title: 'Aufgabe anlegen',
    description: 'Legt eine Aufgabe an, optional zu einem Element (per Code) oder Objekt.',
    inputSchema: obj(
      {
        title: str('Titel'),
        description: str('Beschreibung'),
        priority: str('Priorität', { enum: ['low', 'medium', 'high'] }),
        dueDate: str('Fälligkeit (ISO-Datum); ohne Angabe gilt die SLA-Frist'),
        assetCode: str('Code des betroffenen Elements'),
        propertyId: str('ID des Objekts'),
      },
      ['title'],
    ),
    readOnly: false,
    run: async (a, api) => {
      const assetId = a.assetCode ? ((await api({ method: 'GET', path: `/assets/by-code/${enc(String(a.assetCode))}` })) as { id: string }).id : null;
      return api({
        method: 'POST',
        path: '/tasks',
        body: { title: a.title, description: a.description ?? '', priority: a.priority ?? 'medium', dueAt: toMs(a.dueDate) ?? null, assetId, propertyId: a.propertyId ?? null },
      });
    },
  },
  {
    name: 'update_task_status',
    title: 'Aufgabenstatus ändern',
    description: 'Ändert den Status einer Aufgabe. „done“ markiert einen verknüpften Mangel als behoben.',
    inputSchema: obj({ taskId: str('ID der Aufgabe'), status: str('neuer Status', { enum: ['open', 'in_progress', 'done', 'cancelled'] }) }, ['taskId', 'status']),
    readOnly: false,
    run: async (a, api) => {
      const all = (await api({ method: 'GET', path: '/tasks' })) as Json[];
      const t = all.find((x) => x.id === a.taskId);
      if (!t) throw new Error('Aufgabe nicht gefunden');
      const body = {
        title: t.title,
        description: t.description,
        status: a.status,
        priority: t.priority,
        dueAt: t.dueAt,
        assigneeId: t.assigneeId,
        subcontractorId: t.subcontractorId,
        assetId: t.assetId,
        defectId: t.defectId,
        propertyId: t.propertyId,
        labels: t.labels,
      };
      return api({ method: 'PATCH', path: `/tasks/${enc(String(a.taskId))}`, body });
    },
  },
  {
    name: 'add_task_comment',
    title: 'Kommentar zu Aufgabe',
    description: 'Fügt einer Aufgabe einen Kommentar hinzu.',
    inputSchema: obj({ taskId: str('ID der Aufgabe'), comment: str('Text') }, ['taskId', 'comment']),
    readOnly: false,
    run: (a, api) => api({ method: 'POST', path: `/tasks/${enc(String(a.taskId))}/comments`, body: { body: a.comment } }),
  },
  {
    name: 'list_categories',
    title: 'Elementarten und Prüfpunkte',
    description: 'Elementarten mit Normen, Prüfintervallen, Prüfarten und Prüfpunkten.',
    inputSchema: obj({}),
    readOnly: true,
    run: (_a, api) => api({ method: 'GET', path: '/categories' }),
  },
  {
    name: 'create_asset',
    title: 'Element anlegen',
    description: 'Legt ein prüfpflichtiges Element in einem Gebäude an. Der Code wird automatisch vergeben, wenn keiner angegeben ist.',
    inputSchema: obj(
      {
        buildingId: str('ID des Gebäudes'),
        category: str('Elementart-Schlüssel (siehe list_categories)'),
        location: str('Standort, z. B. „Treppenhaus Nord, EG“'),
        floor: str('Etage'),
        manufacturer: str('Hersteller'),
        model: str('Modell/Typ'),
        code: str('eigener Code (optional)'),
      },
      ['buildingId', 'category'],
    ),
    readOnly: false,
    run: (a, api) => api({ method: 'POST', path: '/assets', body: { ...a, attributes: {} } }),
  },
  {
    name: 'list_walkthroughs',
    title: 'Begehungen auflisten',
    description: 'Brandschutzbegehungen mit Anlass, Ergebnis, offenen Feststellungen und nächster Fälligkeit.',
    inputSchema: obj({}),
    readOnly: true,
    run: (_a, api) => api({ method: 'GET', path: '/walkthroughs' }),
  },
  {
    name: 'plan_rounds',
    title: 'Rundgänge planen',
    description: 'Fasst fällige Prüfungen (überfällig und in den nächsten Tagen) je Gebäude zu Rundgängen zusammen, sortiert nach Dringlichkeit.',
    inputSchema: obj({ days: { type: 'integer', description: 'Vorschau in Tagen (Standard 30)', minimum: 1, maximum: 365 } }),
    readOnly: true,
    run: (a, api) => api({ method: 'GET', path: `/smart/rounds${qs(a, ['days'])}` }),
  },
  {
    name: 'structure_dictation',
    title: 'Diktat strukturieren',
    description: 'Zerlegt diktierten Text einer Prüfung in Mängel (mit Schwere und Maßnahme), Aufgaben und Notizen.',
    inputSchema: obj({ text: str('Diktierter Text') }, ['text']),
    readOnly: true,
    run: (a, api) => api({ method: 'POST', path: '/ai/parse', body: { text: a.text } }),
  },
];

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

/**
 * MCP-Routen. `dispatch` führt einen internen API-Request mit derselben Authentifizierung aus.
 * POST /mcp (Authorization: Bearer pk_…) oder POST /mcp/k/<schlüssel> für Clients ohne eigene Header.
 */
export function mcpRoutes(dispatch: (req: Request, c: Ctx) => Promise<Response>) {
  const r = new Hono<AppEnv>();
  const handle = async (c: Ctx, key: string | null) => {
    if (!key?.startsWith('pk_')) {
      return c.json(rpcError(null, -32001, 'API-Schlüssel fehlt (Authorization: Bearer pk_…)'), 401, { 'www-authenticate': 'Bearer realm="pruefkompass"' });
    }
    const origin = new URL(c.req.url).origin;
    const api = async ({ method, path, body }: Call) => {
      const res = await dispatch(
        new Request(`${origin}/api${path}`, {
          method,
          headers: {
            authorization: `Bearer ${key}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            'cf-connecting-ip': c.req.header('cf-connecting-ip') ?? '',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        c,
      );
      const text = await res.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* kein JSON */
      }
      if (!res.ok) throw Object.assign(new Error((json as { error?: string })?.error ?? `HTTP ${res.status}`), { status: res.status });
      return json;
    };
    // Schlüssel einmal prüfen (liefert 401/429 wie die API)
    try {
      await api({ method: 'GET', path: '/categories' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 401;
      return c.json(rpcError(null, -32001, (e as Error).message), status === 429 ? 429 : 401);
    }
    let msg: unknown;
    try {
      msg = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Ungültiges JSON'), 400);
    }
    const one = async (m: Json) => {
      const id = m.id;
      const isNotification = id === undefined;
      switch (m.method) {
        case 'initialize':
          return rpcResult(id, {
            protocolVersion: MCP_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              'Prüfkompass verwaltet wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente, Prüfungen, Mängel, Aufgaben und Begehungen. Beginne mit dashboard oder list_assets(due="overdue"). Daten sind auf Deutsch.',
          });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return rpcResult(id, {});
        case 'tools/list':
          return rpcResult(id, {
            tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } })),
          });
        case 'tools/call': {
          const p = (m.params ?? {}) as { name?: string; arguments?: Json };
          const tool = TOOLS.find((t) => t.name === p.name);
          if (!tool) return rpcError(id, -32602, `Unbekanntes Werkzeug: ${p.name}`);
          try {
            const out = await tool.run(p.arguments ?? {}, api);
            return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out, isError: false });
          } catch (e) {
            return rpcResult(id, { content: [{ type: 'text', text: `Fehler: ${(e as Error).message}` }], isError: true });
          }
        }
        default:
          return isNotification ? null : rpcError(id, -32601, `Methode nicht unterstützt: ${String(m.method)}`);
      }
    };
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => one(m as Json)))).filter(Boolean);
      return out.length ? c.json(out) : c.body(null, 202);
    }
    const out = await one(msg as Json);
    return out ? c.json(out, 200, { 'mcp-protocol-version': MCP_PROTOCOL }) : c.body(null, 202);
  };
  const bearer = (c: Ctx) => {
    const h = c.req.header('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };
  r.post('/mcp', (c) => handle(c, bearer(c)));
  r.post('/mcp/k/:key', (c) => handle(c, c.req.param('key')));
  // Kein Server-Sent-Events-Kanal: Server sendet nichts unaufgefordert
  r.get('/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  r.get('/mcp/k/:key', (c) => c.body(null, 405, { allow: 'POST' }));
  r.delete('/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  return r;
}
