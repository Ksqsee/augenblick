// MCP-Server (Model Context Protocol, Streamable HTTP ohne Sitzungszustand) für Claude & Co.
// Anmeldung per OAuth (Connector in Claude) oder Authorization: Bearer pk_… (API-Schlüssel). Jedes Werkzeug ruft
// intern die normale API auf – Rollen, Lese-/Schreibrechte, Zugriffsbereich und Validierung gelten unverändert.
// Der Worker ruft selbst keine KI auf: Hören, Lesen und Sehen übernimmt Claude, der MCP liefert die Werkzeuge.
import { Hono } from 'hono';
import type { AppEnv, Ctx } from './lib';
import { ApiError, type Call, type Json, runTool, TOOLS } from './mcp-tools';
import { resourceMetadataUrl } from './oauth';

export { TOOLS } from './mcp-tools';

export const MCP_PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'pruefkompass', title: 'Prüfkompass', version: '2.0.0' };

const INSTRUCTIONS = [
  'Prüfkompass hält wiederkehrende Brandschutzprüfungen im Kreislauf: Frist naht → Rundgang → Prüfung vor Ort → Mangel → Aufgabe beim Richtigen → Nachprüfung → Nachweis.',
  'Starte mit briefing („Was steht heute an?“); vor Ort führt tour Element für Element, und inspect trägt den gesprochenen Befund ein (alles i. O. außer den genannten Mängeln, bekannte Mängel als still/fixed).',
  'Du unterschreibst und schließt nie ab: inspect legt Prüfungen nur zur Unterschrift bereit, die prüfende Person unterschreibt in der App mit einem Tipp.',
  'Unterwegs Erfasstes legt capture an (Duplikate werden gemeldet, nicht doppelt angelegt), Typenschilder und Grundrisse siehst du mit get_photo und trägst sie mit update_asset bzw. setup (erst preview) ein.',
  'Elemente heißen per Code: neue laufend je Objekt (FST-001, FSA-002 …, über alle Arten), ältere z. B. FST-7K2M; „Tür 36“ oder „Nummer 36“ verstehen die Werkzeuge zusammen mit property (Objekt).',
  'Fachwissen (Hersteller/Typen mit Vorgaben, typische Mängel mit Schwere und Maßnahme, Abkürzungen) liegt im Katalog: catalog sucht, schlägt vor und legt im Stapel an (erst preview).',
  'Daten sind deutsch, und der Autopilot erledigt Planen, Zuweisen und Nachhalten selbst – du siehst und steuerst ihn mit autopilot, Stufen ändern Admins nur in der App.',
].join(' ');

interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  text: (a: Record<string, string>) => string;
}

/** Fertige Befehle, die in Claude als Vorlagen erscheinen. */
export const PROMPTS: PromptDef[] = [
  {
    name: 'tagesbriefing',
    title: 'Tagesbriefing',
    description: 'Was heute ansteht: Lage, dringendste Punkte, was der Autopilot getan hat und was auf eine Entscheidung wartet.',
    arguments: [{ name: 'seit', description: 'Autopilot-Protokoll ab (ISO-Datum), z. B. das letzte Briefing' }],
    text: (a) =>
      `Gib mir mein Tagesbriefing für Prüfkompass. Rufe briefing${a.seit ? ` mit since „${a.seit}“` : ''} auf und fasse in höchstens zehn Zeilen zusammen: 1) die Lage in einem Satz mit den wichtigsten Zahlen, 2) die drei dringendsten Punkte aus der „Jetzt“-Liste mit je einer konkreten nächsten Handlung, 3) was der Autopilot erledigt hat, 4) ob Prüfungen auf meine Unterschrift warten. Schlage am Ende den sinnvollsten Rundgang für heute vor (plan), ohne etwas anzulegen.`,
  },
  {
    name: 'diktat_erfassen',
    title: 'Diktat erfassen',
    description: 'Gesprochenen oder getippten Text in Mängel, Aufgaben, Notizen und neue Elemente zerlegen und nach Bestätigung anlegen.',
    arguments: [
      { name: 'text', description: 'Das Diktat', required: true },
      { name: 'element', description: 'Element-Code als Vorgabe-Ort, z. B. FST-7K2M' },
    ],
    text: (a) =>
      `Erfasse dieses Diktat in Prüfkompass:\n\n„${a.text ?? ''}“\n\nZerlege es in einzelne Einträge (Mangel mit Schwere und Maßnahme, Aufgabe mit Frist, Notiz oder neue Elemente mit Anzahl, Art, Etage und Standort).${a.element ? ` Vorgabe-Ort ist das Element ${a.element}.` : ' Wenn ein Ort fehlt, frage nach oder suche das Element mit search.'} Zeige mir die Liste kurz zur Bestätigung und lege sie dann mit einem einzigen capture-Aufruf an. Meldet capture übersprungene Duplikate, frage, ob sie trotzdem angelegt werden sollen (force).`,
  },
  {
    name: 'woche_planen',
    title: 'Woche planen',
    description: 'Fällige Prüfungen der nächsten Tage zu Rundgängen bündeln und die Wochenplanung auslösen.',
    arguments: [{ name: 'tage', description: 'Vorschau in Tagen (Standard 14)' }],
    text: (a) =>
      `Plane meine Woche in Prüfkompass. Rufe plan (action view, days ${a.tage || '14'}) auf und schlage eine Reihenfolge der Rundgänge vor – Überfälliges zuerst, Gebäude desselben Objekts zusammen, mit grober Dauer je Rundgang. Prüfe mit list(what: "tasks"), welche Rundgang-Aufträge es schon gibt. Frage mich, ob ich die Wochenplanung des Autopiloten jetzt auslösen soll (plan action plan_week), und tu es erst nach meinem Ja.`,
  },
  {
    name: 'typenschilder_nachtragen',
    title: 'Typenschilder nachtragen',
    description: 'Fotos von Typenschildern lesen und fehlende Stammdaten (Hersteller, Modell, Baujahr, Seriennummer) eintragen.',
    arguments: [{ name: 'objekt', description: 'nur in diesem Objekt' }],
    text: (a) =>
      `Trage fehlende Stammdaten aus Typenschild-Fotos nach${a.objekt ? ` im Objekt „${a.objekt}“` : ''}. Suche Elemente ohne Hersteller oder Modell (list what assets${a.objekt ? `, property „${a.objekt}“` : ''}), öffne sie mit get und sieh dir vorhandene Fotos mit get_photo an. Lies Hersteller, Modell/Typ, Baujahr, Seriennummer und Zulassungsnummer – nur was eindeutig lesbar ist, nichts raten. Zeige mir je Element die erkannten Werte und trage sie nach meiner Bestätigung mit update_asset ein. Elemente ohne Foto liste am Ende auf.`,
  },
  {
    name: 'monatsbericht',
    title: 'Monatsbericht schreiben',
    description: 'Einen kurzen Monatsbericht für ein Objekt schreiben – für Eigentümer, Hausverwaltung oder Brandschutzbeauftragte.',
    arguments: [
      { name: 'objekt', description: 'Objektname', required: true },
      { name: 'monat', description: 'Monat „JJJJ-MM“; Standard: letzter Monat' },
    ],
    text: (a) =>
      `Schreibe den Monatsbericht für das Objekt „${a.objekt ?? ''}“${a.monat ? ` für ${a.monat}` : ' für den letzten vollen Monat'}. Hole die Kennzahlen mit report (property, month) und Details mit get(kind: "property") sowie list(what: "defects", property). Gliederung: Zusammenfassung in zwei Sätzen, Prüfungen und Prüfquote, Mängel (neu, behoben, noch offen – kritische namentlich mit Element-Code und Maßnahme), anstehende Fälligkeiten im nächsten Monat, Empfehlungen. Sachlich, auf Deutsch, höchstens eine Seite. Erfinde keine Zahlen.`,
  },
  {
    name: 'rundgang_fuehren',
    title: 'Rundgang führen',
    description: 'Vor Ort durch einen Rundgang führen: Element für Element ansagen, Befund per Sprache eintragen, am Ende in der App unterschreiben.',
    arguments: [{ name: 'gebaeude', description: 'Gebäude oder Objekt, z. B. „Haupthaus“', required: true }],
    text: (a) =>
      `Führe mich durch den Rundgang „${a.gebaeude ?? ''}“. Starte mit tour (action start). Sag mir jeweils kurz das Element, wo es ist, die Prüfpunkte in Stichworten und bekannte offene Mängel. Wenn ich den Befund sage („in Ordnung“, „Schließer zieht nicht, mittel“), trage ihn mit inspect ein: allOk für alles nicht Genannte, Mängel mit Schwere und Maßnahme, bekannte Mängel als still oder fixed. Fehlt etwas, frage gezielt nach. Danach tour (action next). Antworte knapp – ich bin vor Ort und höre zu. Unterschreibe nie; am Ende sag mir, wie viele Prüfungen in der App zur Unterschrift bereitliegen.`,
  },
  {
    name: 'plan_einrichten',
    title: 'Plan einrichten',
    description: 'Aus einem Grundriss oder einer Liste Objekt, Gebäude und Elemente in Laufreihenfolge anlegen.',
    arguments: [{ name: 'objekt', description: 'Objektname (vorhanden oder neu)', required: true }],
    text: (a) =>
      `Richte das Objekt „${a.objekt ?? ''}“ in Prüfkompass ein. Nimm den Grundriss, den ich dir gebe – oder lade einen hinterlegten mit get(kind: "property") und get_photo („plan:…“). Erkenne Räume und Brandschutz-Symbole (Feuerlöscher, Feuerschutztüren, Rauchwarnmelder, Brandschutzklappen) und ordne sie in Laufreihenfolge je Etage. Rufe setup zuerst mit preview: true auf und zeige mir die Vorschau (Anzahl je Art und Etage, Unklarheiten). Lege erst nach meinem Ja mit preview: false an – mit Marker-Positionen (x/y), wenn der Grundriss hinterlegt ist. Schlage danach den ersten Rundgang vor.`,
  },
];

/** Browser-basierte MCP-Clients (z. B. Inspector) – nur Bearer-Token, keine Cookies. */
const MCP_CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

/**
 * MCP-Route POST /mcp (Authorization: Bearer pk_… oder OAuth-Token pko_…).
 * `dispatch` führt einen internen API-Request mit derselben Anmeldung aus.
 */
export function mcpRoutes(dispatch: (req: Request, c: Ctx) => Promise<Response>) {
  const r = new Hono<AppEnv>();
  const handle = async (c: Ctx, key: string | null) => {
    const challenge = { 'www-authenticate': `Bearer realm="pruefkompass", resource_metadata="${resourceMetadataUrl(c)}"`, ...MCP_CORS };
    if (!key?.startsWith('pk_') && !key?.startsWith('pko_')) {
      return c.json(rpcError(null, -32001, 'Anmeldung erforderlich (OAuth oder Authorization: Bearer pk_…)'), 401, challenge);
    }
    const origin = new URL(c.req.url).origin;
    const send = (method: Call['method'], path: string, body?: unknown) =>
      dispatch(
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
    const api = async ({ method, path, body }: Call) => {
      // POST ohne Körper: leeres Objekt senden (Endpunkte lesen JSON)
      const res = await send(method, path, body === undefined && method !== 'GET' ? {} : body);
      const text = await res.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* kein JSON */
      }
      if (!res.ok) throw new ApiError((json as { error?: string })?.error ?? `HTTP ${res.status}`, res.status, json);
      return json;
    };
    const raw = async (path: string) => {
      const res = await send('GET', path);
      if (!res.ok) {
        const t = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          msg = (JSON.parse(t) as { error?: string }).error ?? msg;
        } catch {
          /* kein JSON */
        }
        throw new ApiError(msg, res.status, null);
      }
      return { body: await res.arrayBuffer(), type: res.headers.get('content-type') ?? '' };
    };
    // Schlüssel einmal prüfen (liefert 401/429 wie die API)
    try {
      await api({ method: 'GET', path: '/categories' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 401;
      return c.json(rpcError(null, -32001, (e as Error).message), status === 429 ? 429 : 401, status === 429 ? MCP_CORS : challenge);
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
            capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return rpcResult(id, {});
        case 'tools/list':
          return rpcResult(id, {
            tools: TOOLS.map((t) => ({
              name: t.name,
              title: t.title,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: !!t.destructive, idempotentHint: t.readOnly, openWorldHint: false },
            })),
          });
        case 'tools/call': {
          const p = (m.params ?? {}) as { name?: string; arguments?: Json };
          const tool = TOOLS.find((t) => t.name === p.name);
          if (!tool) return rpcError(id, -32602, `Unbekanntes Werkzeug: ${p.name}. Verfügbar: ${TOOLS.map((t) => t.name).join(', ')}`);
          return rpcResult(id, await runTool(tool, p.arguments ?? {}, api, raw));
        }
        case 'prompts/list':
          return rpcResult(id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args ?? [] })) });
        case 'prompts/get': {
          const p = (m.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
          const prompt = PROMPTS.find((x) => x.name === p.name);
          if (!prompt) return rpcError(id, -32602, `Unbekannter Prompt: ${p.name}`);
          const args = Object.fromEntries(Object.entries(p.arguments ?? {}).map(([k, v]) => [k, String(v ?? '').slice(0, 4000)]));
          const missing = (prompt.arguments ?? []).filter((x) => x.required && !args[x.name]?.trim());
          if (missing.length) return rpcError(id, -32602, `Fehlendes Argument: ${missing.map((x) => x.name).join(', ')}`);
          return rpcResult(id, { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }] });
        }
        default:
          return isNotification ? null : rpcError(id, -32601, `Methode nicht unterstützt: ${String(m.method)}`);
      }
    };
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => one(m as Json)))).filter(Boolean);
      return out.length ? c.json(out, 200, MCP_CORS) : c.body(null, 202, MCP_CORS);
    }
    const out = await one(msg as Json);
    return out ? c.json(out, 200, { 'mcp-protocol-version': MCP_PROTOCOL, ...MCP_CORS }) : c.body(null, 202, MCP_CORS);
  };
  const bearer = (c: Ctx) => {
    const h = c.req.header('authorization') ?? '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };
  r.post('/mcp', (c) => handle(c, bearer(c)));
  // Kein Server-Sent-Events-Kanal: Server sendet nichts unaufgefordert
  r.get('/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  r.delete('/mcp', (c) => c.body(null, 405, { allow: 'POST' }));
  r.options('/mcp', (c) =>
    c.body(null, 204, { ...MCP_CORS, 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'POST, OPTIONS' }),
  );
  return r;
}
