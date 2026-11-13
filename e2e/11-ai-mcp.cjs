// E2E 11-ai-mcp: MCP-Server v2 – 15 Werkzeuge nach Absicht, Prompts, Rechte (Lese-/Schreibschlüssel, fremder
// Workspace), get_photo als Bildinhalt, capture mit Duplikaten, tour/inspect (nur zur Unterschrift bereit),
// setup (Vorschau, Marker), keine KI im Worker (/ai/transcribe weg, /ai/parse nach Regeln). Nur lokal.
if (!process.env.DEMO_PASSWORD) throw new Error("DEMO_PASSWORD fehlt");
const BASE = process.env.BASE || "http://localhost:5173";
const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG = Buffer.from(SIG.split(",")[1], "base64");
const TOOLS = [
  "briefing",
  "search",
  "list",
  "get",
  "get_photo",
  "capture",
  "update_asset",
  "update_tasks",
  "update_defect",
  "plan",
  "tour",
  "inspect",
  "setup",
  "autopilot",
  "report",
];
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log("  ✗", m);
  }
};
const step = (m) => console.log("·", m);

function client() {
  let cookie = "";
  const call = async (path, { method, body, raw, type } = {}) => {
    const r = await fetch(BASE + "/api" + path, {
      method: method ?? (body !== undefined || raw ? "POST" : "GET"),
      headers: {
        "x-pk": "1",
        cookie,
        ...(body !== undefined
          ? { "content-type": "application/json" }
          : raw
            ? { "content-type": type }
            : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const sc = r.headers.get("set-cookie");
    if (sc && sc.startsWith("pk_session")) cookie = sc.split(";")[0];
    const text = await r.text();
    try {
      return { status: r.status, json: JSON.parse(text) };
    } catch {
      return { status: r.status, json: null, text };
    }
  };
  return call;
}
const api = client();
let rpcId = 0;
async function mcp(key, method, params, { path } = {}) {
  const r = await fetch(BASE + (path ?? "/api/mcp"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const call = async (key, name, args = {}) => {
  const r = await mcp(key, "tools/call", { name, arguments: args });
  const res = r.json?.result;
  let data = null;
  if (res && !res.isError) {
    try {
      data = JSON.parse(res.content[0].text);
    } catch {
      data = null;
    }
  }
  return {
    ...r,
    res,
    isError: res?.isError,
    data,
    text: res?.content?.[0]?.text ?? r.json?.error?.message,
  };
};

(async () => {
  if (process.env.PROD)
    throw new Error("11-ai-mcp nicht gegen Produktion ausführen");
  check(
    (
      await api("/auth/login", {
        body: {
          email: "demo@example.com",
          password: process.env.DEMO_PASSWORD,
        },
      })
    ).status === 200,
    "Login",
  );
  const write = (
    await api("/account/api-keys", {
      body: { name: "MCP Test", scope: "write", expiresInDays: 1 },
    })
  ).json.key;
  const read = (
    await api("/account/api-keys", {
      body: { name: "MCP Lesen", scope: "read", expiresInDays: 1 },
    })
  ).json.key;
  // Fremder Workspace mit eigenem Schlüssel
  const other = client();
  check(
    (
      await other("/auth/register", {
        body: {
          company: "Fremd GmbH",
          name: "Fremd",
          email: `fremd${Date.now()}@example.com`,
          password: "fremd-passwort-1",
        },
      })
    ).status === 200,
    "zweiter Workspace",
  );
  const foreign = (
    await other("/account/api-keys", {
      body: { name: "fremd", scope: "write", expiresInDays: 1 },
    })
  ).json.key;

  step("Handshake, Werkzeuge, Prompts");
  let r = await mcp(write, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  const init = r.json?.result;
  check(
    r.status === 200 &&
      init.serverInfo.name === "pruefkompass" &&
      init.serverInfo.version.startsWith("2.") &&
      init.capabilities.tools &&
      init.capabilities.prompts,
    `initialize (${r.status})`,
  );
  check(
    /Kreislauf/.test(init.instructions) &&
      /unterschreibst und schließt nie ab/.test(init.instructions) &&
      init.instructions.length < 1300,
    "instructions: knapper Kreislauf, Claude unterschreibt nie",
  );
  r = await fetch(BASE + "/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${write}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  check(r.status === 202, `Notification → 202 (${r.status})`);
  r = await mcp(write, "tools/list");
  const tools = r.json.result.tools;
  check(
    JSON.stringify(tools.map((t) => t.name)) === JSON.stringify(TOOLS),
    `15 Werkzeuge (${tools.map((t) => t.name)})`,
  );
  check(
    tools.every(
      (t) =>
        t.inputSchema?.type === "object" &&
        t.description.length > 120 &&
        t.annotations,
    ),
    "Schemas, Beschreibungen, Annotationen",
  );
  check(
    tools
      .filter((t) => t.annotations.readOnlyHint)
      .map((t) => t.name)
      .join() === "briefing,search,list,get,get_photo,tour,report",
    "Nur-Lese-Annotationen",
  );
  r = await mcp(write, "prompts/list");
  const prompts = r.json.result.prompts;
  check(
    prompts.length === 7 &&
      prompts.some((p) => p.name === "rundgang_fuehren") &&
      prompts.some((p) => p.title === "Monatsbericht schreiben"),
    `7 Prompts (${prompts.map((p) => p.name)})`,
  );
  r = await mcp(write, "prompts/get", {
    name: "rundgang_fuehren",
    arguments: { gebaeude: "Haupthaus" },
  });
  check(
    /Haupthaus/.test(r.json.result.messages[0].content.text) &&
      r.json.result.messages[0].role === "user",
    "prompts/get mit Argument",
  );
  r = await mcp(write, "prompts/get", { name: "monatsbericht", arguments: {} });
  check(r.json.error?.code === -32602, "Pflichtargument fehlt → -32602");
  check(
    (await mcp("pk_falsch_" + "x".repeat(40), "tools/list")).status === 401,
    "falscher Schlüssel → 401",
  );
  r = await fetch(BASE + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check(r.status === 401, `ohne Schlüssel → 401 (${r.status})`);
  check(
    (await mcp(write, "gibt/es/nicht")).json.error?.code === -32601,
    "unbekannte Methode → -32601",
  );
  check(
    (await call(write, "dashboard")).json.error?.code === -32602,
    "altes Werkzeug „dashboard“ entfernt",
  );
  r = await fetch(`${BASE}/api/mcp/k/${write}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check(r.status === 404, `Schlüssel im Pfad entfernt → 404 (${r.status})`);

  step("Lesen: briefing, search, list, get, report");
  let t = await call(write, "briefing", { since: "2020-01-01" });
  check(
    typeof t.data?.counts?.overdue === "number" &&
      Array.isArray(t.data.now) &&
      t.data.now.length <= 12 &&
      Array.isArray(t.data.autopilot?.entries),
    `briefing (${t.text?.slice(0, 120)})`,
  );
  t = await call(read, "list", { what: "assets", due: "overdue" });
  check(
    t.data?.total > 0 && t.data.assets[0].code && !("id" in t.data.assets[0]),
    `list assets overdue ohne interne IDs (${t.data?.total})`,
  );
  const asset = t.data.assets[0];
  t = await call(read, "search", { query: asset.code.slice(0, 5) });
  check(
    t.data?.assets?.some((a) => a.code === asset.code),
    "search findet per Code-Teil",
  );
  t = await call(read, "search", { type: "properties" });
  check(
    t.data?.properties?.length >= 3 &&
      typeof t.data.properties[0].overdue === "number",
    "search: alle Objekte mit Status",
  );
  const propName = t.data.properties[0].name;
  t = await call(read, "search", { type: "categories" });
  check(
    t.data?.categories?.some(
      (c) => c.key === "extinguisher" && c.label === "Feuerlöscher",
    ),
    "search: Elementarten",
  );
  t = await call(read, "get", { kind: "asset", ref: asset.code });
  check(
    t.data?.code === asset.code &&
      t.data.art &&
      Array.isArray(t.data.inspections ?? []),
    `get asset (${t.text?.slice(0, 100)})`,
  );
  t = await call(read, "get", { kind: "property", ref: propName });
  check(
    t.data?.name === propName && t.data.buildings?.length > 0,
    "get property per Name",
  );
  t = await call(read, "get", { kind: "asset", ref: "GIBT-NIX" });
  check(
    t.isError === true && /search/.test(t.text),
    "unbekannter Code → isError mit Hinweis",
  );
  t = await call(read, "list", { what: "defects" });
  check(Array.isArray(t.data?.defects), "list defects");
  t = await call(read, "list", {
    what: "inspections",
    status: "submitted",
    limit: 5,
  });
  check(
    t.data?.inspections?.length === 5 && t.data.inspections[0].result,
    "list inspections",
  );
  t = await call(read, "report", { property: propName });
  check(
    !t.isError && /Kennzahlen/.test(t.text) && /Prüfquote/.test(t.text),
    `report als Text (${t.text?.slice(0, 80)})`,
  );
  t = await call(read, "plan", {});
  check(
    Array.isArray(t.data?.rounds) && t.data.rounds[0]?.walk?.length > 0,
    "plan view",
  );

  step("capture: Stapel mit Duplikat");
  const cap = {
    asset: asset.code,
    items: [
      {
        kind: "defect",
        title: "MCP: Feuerlöscher Plombe fehlt",
        severity: "high",
        measure: "Plombe erneuern",
      },
      {
        kind: "task",
        title: "MCP: Hausmeister informieren",
        due: "2030-01-15",
      },
      { kind: "note", title: "MCP: Zugang über Hof" },
    ],
  };
  t = await call(write, "capture", cap);
  check(
    t.data?.created?.length === 3 && !t.data.skipped,
    `capture legt 3 an (${t.text?.slice(0, 160)})`,
  );
  t = await call(write, "capture", {
    asset: asset.code,
    items: [cap.items[0], { kind: "task", title: "MCP: Zweite Aufgabe" }],
  });
  check(
    t.data?.created?.length === 1 &&
      t.data.skipped?.length === 1 &&
      t.data.skipped[0].existing === "MCP: Feuerlöscher Plombe fehlt",
    `Duplikat übersprungen und gemeldet (${t.text?.slice(0, 200)})`,
  );
  t = await call(write, "capture", {
    asset: asset.code,
    force: true,
    items: [cap.items[0]],
  });
  check(t.data?.created?.length === 1, "mit force trotzdem angelegt");
  const defects = (await api("/defects")).json.filter(
    (d) => d.title === "MCP: Feuerlöscher Plombe fehlt",
  );
  check(
    defects.length === 2 && defects.every((d) => d.code === asset.code),
    `2 Mängel am Element (${defects.length})`,
  );
  const capTask = (await api("/tasks")).json.find(
    (x) => x.title === "MCP: Hausmeister informieren",
  );
  check(
    capTask?.assetId && new Date(capTask.dueAt).getUTCFullYear() === 2030,
    "Aufgabe mit Element und Frist",
  );
  const someBuilding = (await api("/buildings")).json[0];
  t = await call(write, "capture", {
    items: [
      {
        kind: "asset",
        category: "Feuerlöscher",
        building: someBuilding.name,
        floor: "EG",
        location: "MCP Flur",
        count: 2,
      },
    ],
  });
  check(
    t.data?.created?.[0]?.startsWith("2 × Feuerlöscher"),
    `Sammelanlage über capture (${t.text?.slice(0, 120)})`,
  );
  check(
    (await api("/assets")).json.filter((a) => a.location === "MCP Flur")
      .length === 2,
    "2 Elemente angelegt",
  );
  t = await call(read, "capture", {
    asset: asset.code,
    items: [{ kind: "task", title: "darf nicht" }],
  });
  check(
    t.isError === true && /Berechtigung/.test(t.text),
    `Leseschlüssel legt nichts an (${t.text?.slice(0, 80)})`,
  );

  step("update_tasks, update_defect, update_asset");
  t = await call(write, "update_tasks", {
    taskIds: [capTask.id],
    status: "in_progress",
    priority: "high",
    comment: "Über Claude",
  });
  check(
    t.data?.updated === 1 && t.data.commented === 1,
    `update_tasks (${t.text?.slice(0, 80)})`,
  );
  const tk = (await api("/tasks")).json.find((x) => x.id === capTask.id);
  check(
    tk.status === "in_progress" && tk.priority === "high" && tk.comments === 1,
    "Aufgabe geändert und kommentiert",
  );
  t = await call(write, "update_defect", {
    defectId: defects[0].id,
    action: "resolve",
    note: "Plombe erneuert",
  });
  check(t.data?.status === "behoben", "update_defect resolve");
  t = await call(read, "get", { kind: "defect", ref: defects[0].id });
  check(
    t.data?.status === "behoben" &&
      t.data.resolution?.note === "Plombe erneuert",
    "Behebung mit Notiz",
  );
  t = await call(read, "update_defect", {
    defectId: defects[0].id,
    action: "reopen",
  });
  check(t.isError === true, "Leseschlüssel öffnet nicht wieder");
  const ext = (await api("/assets")).json.find(
    (a) => a.category === "extinguisher" && a.location === "MCP Flur",
  );
  t = await call(write, "update_asset", {
    asset: ext.code,
    manufacturer: "Gloria",
    model: "PD 6 GA",
    year: 2019,
    serial: "A123",
    fields: { gibtsnicht: 1 },
  });
  check(
    t.data?.changed?.length === 4 && /gibtsnicht/.test(t.data.ignored ?? ""),
    `update_asset vorher → nachher (${t.text?.slice(0, 200)})`,
  );
  const extD = (await api(`/assets/${ext.id}`)).json;
  check(
    extD.manufacturer === "Gloria" &&
      extD.attributes.year === 2019 &&
      extD.attributes.serial === "A123" &&
      extD.location === "MCP Flur",
    "Stammdaten gespeichert, Rest unverändert",
  );
  t = await call(read, "update_asset", { asset: ext.code, manufacturer: "X" });
  check(t.isError === true, "Leseschlüssel ändert keine Stammdaten");
  t = await call(foreign, "update_asset", {
    asset: ext.code,
    manufacturer: "X",
  });
  check(
    t.isError === true && /Kein Element/.test(t.text),
    "fremder Workspace findet das Element nicht",
  );

  step("get_photo: Foto und Grundriss als Bildinhalt");
  const key = (await api("/files", { raw: PNG, type: "image/png" })).json.key;
  check(
    (
      await api(`/assets/${ext.id}/attachments`, {
        body: {
          key,
          name: "Typenschild",
          contentType: "image/png",
          size: PNG.length,
          caption: "Typenschild",
        },
      })
    ).status === 200,
    "Foto angehängt",
  );
  t = await call(read, "get", { kind: "asset", ref: ext.code });
  const ref = t.data?.photos?.[0]?.photo;
  check(ref === `foto:${key}`, `get nennt Foto-Verweis (${ref})`);
  t = await call(read, "get_photo", { ref });
  const img = t.res?.content?.find((x) => x.type === "image");
  check(
    !t.isError &&
      img?.mimeType === "image/png" &&
      img.data === PNG.toString("base64"),
    "get_photo liefert Bildinhalt",
  );
  t = await call(foreign, "get_photo", { ref });
  check(
    t.isError === true && !t.res.content.some((x) => x.type === "image"),
    "fremder Workspace bekommt das Foto nicht",
  );
  t = await call(read, "get_photo", { ref: "foto:../../etc/passwd" });
  check(t.isError === true, "ungültiger Verweis abgelehnt");
  const pdfKey = (
    await api("/files", {
      raw: Buffer.from("%PDF-1.4 x"),
      type: "application/pdf",
    })
  ).json.key;
  t = await call(read, "get_photo", { ref: `foto:${pdfKey}` });
  check(
    t.isError === true && /Kein Bild/.test(t.text),
    "PDF wird nicht als Bild geliefert",
  );
  // Grundriss als Bild hinterlegen (Admin-Sitzung) und mit setup Marker setzen
  const props = (await api("/properties")).json;
  const pd = (await api(`/properties/${props[0].id}`)).json;
  const b0 = pd.buildings[0];
  const planKey = (await api("/files", { raw: PNG, type: "image/png" })).json
    .key;
  const planId = (
    await api(`/buildings/${b0.id}/floor-plans`, {
      body: {
        name: "MCP Plan",
        level: 7,
        fileKey: planKey,
        width: 800,
        height: 600,
      },
    })
  ).json.id;
  t = await call(read, "get_photo", { ref: `plan:${planId}` });
  check(
    !t.isError &&
      t.res.content[1]?.type === "image" &&
      /MCP Plan/.test(t.res.content[0].text),
    "Grundriss als Bild",
  );

  step("setup: Vorschau, Anlegen mit Marker, Rechte");
  const setupArgs = {
    property: { name: pd.name },
    buildings: [
      {
        name: b0.name,
        plan: "MCP Plan",
        elements: [
          {
            category: "Rauchwarnmelder",
            floor: "7. OG",
            location: "MCP Raum 701",
            x: 0.25,
            y: 0.5,
          },
          {
            category: "extinguisher",
            floor: "7. OG",
            location: "MCP Flur 7",
            count: 2,
          },
        ],
      },
      {
        name: "MCP Neubau",
        elements: [{ category: "Feuerschutztür", floor: "EG" }],
      },
    ],
  };
  const before = (await api("/assets")).json.length;
  t = await call(write, "setup", { ...setupArgs, preview: true });
  check(
    t.data?.preview === true &&
      t.data.total === 4 &&
      t.data.buildings[0].byArt.Feuerlöscher === 2 &&
      t.data.buildings[1].building === "MCP Neubau (wird neu angelegt)" &&
      !t.data.problems?.some((p) => /MCP Neubau/.test(p)),
    `setup Vorschau (${t.text?.slice(0, 240)})`,
  );
  check(
    (await api("/assets")).json.length === before,
    "Vorschau schreibt nichts",
  );
  t = await call(write, "setup", { ...setupArgs, preview: false });
  check(
    t.data?.created?.[0]?.elements === 3 &&
      t.data.created[0].markers === 1 &&
      t.data.created[1]?.building === "MCP Neubau" &&
      t.data.created[1].elements === 1 &&
      !t.data.failed?.length,
    `setup legt Elemente und neues Gebäude an (Schlüssel der Inhaberin) (${t.text?.slice(0, 240)})`,
  );
  check(
    (await api(`/properties/${pd.id}`)).json.buildings.some(
      (b) => b.name === "MCP Neubau",
    ),
    "neues Gebäude im vorhandenen Objekt",
  );
  const plan = (await api(`/floor-plans/${planId}`)).json;
  const marked = plan.assets.find((a) => a.location === "MCP Raum 701");
  check(
    marked?.floorPlanId === planId && marked.markerX === 0.25,
    "Marker gesetzt",
  );
  t = await call(read, "setup", { ...setupArgs, preview: false });
  check(t.isError === true, "Leseschlüssel richtet nichts ein");
  // „Plan hochladen, fertig“: ganz neues Objekt mit zwei Gebäuden und Elementen
  const newArgs = {
    property: { name: "MCP Neues Objekt", address: "Planweg 1" },
    buildings: [
      {
        name: "Nord",
        elements: [
          {
            category: "Feuerlöscher",
            floor: "EG",
            location: "Eingang",
            count: 2,
          },
        ],
      },
      {
        name: "Süd",
        elements: [{ category: "Rauchwarnmelder", floor: "1. OG" }],
      },
    ],
  };
  const propsBefore = (await api("/properties")).json.length;
  t = await call(write, "setup", { ...newArgs, preview: true });
  check(
    t.data?.property === "MCP Neues Objekt (wird neu angelegt)" &&
      t.data.buildings.every((b) => /wird neu angelegt/.test(b.building)) &&
      !t.data.problems?.length,
    `setup Vorschau neues Objekt (${t.text?.slice(0, 240)})`,
  );
  check(
    (await api("/properties")).json.length === propsBefore,
    "Vorschau legt kein Objekt an",
  );
  t = await call(write, "setup", { ...newArgs, preview: false });
  check(
    t.data?.created?.length === 2 &&
      t.data.created[0].elements === 2 &&
      t.data.created[1].elements === 1 &&
      !t.data.failed?.length,
    `setup legt Objekt, Gebäude und Elemente an (${t.text?.slice(0, 240)})`,
  );
  const np = (await api("/properties")).json.find(
    (p) => p.name === "MCP Neues Objekt",
  );
  const npd = np && (await api(`/properties/${np.id}`)).json;
  check(
    npd?.address === "Planweg 1" &&
      npd.buildings
        .map((b) => b.name)
        .sort()
        .join() === "Nord,Süd",
    "neues Objekt mit zwei Gebäuden",
  );
  check(
    (await api("/account/activity")).json.some(
      (e) => /MCP Neues Objekt/.test(e.summary) && /MCP Test/.test(e.summary),
    ),
    "Protokoll nennt den Schlüssel",
  );

  step("tour + inspect: Rundgang führen, zur Unterschrift bereitlegen");
  const rounds = (await api("/smart/rounds?days=14")).json;
  const round = rounds.find((x) => x.assets.length >= 2);
  t = await call(write, "tour", {
    action: "start",
    building: round.buildingName,
  });
  if (t.isError && /mehrdeutig/.test(t.text))
    t = await call(write, "tour", {
      action: "start",
      building: `${round.propertyName} ${round.buildingName}`,
    });
  const first = t.data?.element;
  check(
    first?.code && first.checkpoints?.length > 0 && /von/.test(t.data.progress),
    `tour start (${t.text?.slice(0, 200)})`,
  );
  const bName = `${round.propertyName} ${round.buildingName}`;
  t = await call(write, "inspect", {
    asset: first.code,
    allOk: true,
    defects: [
      {
        title: "MCP Kennzeichnung unleserlich",
        severity: "low",
        checkpoint: "1",
      },
    ],
  });
  check(
    t.data?.status?.startsWith("bereit zur Unterschrift") &&
      t.data.result === "mit Mängeln" &&
      !t.data.missing,
    `inspect bereit (${t.text?.slice(0, 200)})`,
  );
  const firstInsp = t.data?.inspectionId;
  const insp = (await api(`/inspections/${firstInsp}`)).json;
  check(
    insp.status === "draft" &&
      insp.readyAt &&
      !insp.signature &&
      insp.answers[insp.checkpoints[0].id] === "defect",
    "Entwurf: bereit, nicht unterschrieben, Mangel am Prüfpunkt 1",
  );
  t = await call(write, "tour", { action: "next", building: bName });
  const second = t.data?.element;
  check(
    second?.code && second.code !== first.code,
    `tour next nennt das nächste Element (${second?.code})`,
  );
  t = await call(write, "inspect", {
    asset: second.code,
    answers: [{ checkpoint: "1", answer: "ok" }],
  });
  check(
    t.data?.status === "Entwurf – noch unvollständig" &&
      t.data.missing?.length === 1,
    `unvollständig → nicht bereit, fehlt (${t.text?.slice(0, 160)})`,
  );
  t = await call(write, "inspect", { asset: second.code, allOk: true });
  check(t.data?.status?.startsWith("bereit"), "ergänzt → bereit");
  t = await call(write, "tour", { action: "status", building: bName });
  check(
    t.data?.readyToSign?.includes(first.code) &&
      t.data.readyToSign.includes(second.code),
    `tour status (${t.text?.slice(0, 160)})`,
  );
  const ready = (await api("/inspections?status=ready")).json;
  check(
    ready.some((i) => i.id === firstInsp) &&
      ready.every((i) => i.status === "draft" && i.readyAt),
    `Liste „bereit zur Unterschrift“ (${ready.length})`,
  );
  t = await call(write, "list", { what: "inspections", status: "ready" });
  check(
    t.data?.inspections?.every((i) => i.status === "wartet auf Unterschrift"),
    "list inspections ready",
  );
  t = await call(write, "briefing", {});
  check(
    /warte/.test(String(t.data?.readyToSign)),
    "briefing nennt wartende Unterschriften",
  );
  t = await call(read, "inspect", { asset: first.code, allOk: true });
  check(t.isError === true, "Leseschlüssel füllt keine Prüfung aus");
  // Claude unterschreibt nie: Sammel-Unterschrift mit Schlüssel verboten
  r = await fetch(BASE + "/api/inspections/sign", {
    method: "POST",
    headers: {
      authorization: `Bearer ${write}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ids: [firstInsp], signature: SIG }),
  });
  check(
    r.status === 403,
    `Unterschreiben mit API-Schlüssel → 403 (${r.status})`,
  );

  step("autopilot");
  t = await call(write, "autopilot", { action: "view" });
  check(
    t.data?.steps?.length > 0 &&
      Array.isArray(t.data.log) &&
      /App/.test(t.data.note),
    "autopilot view",
  );
  t = await call(write, "autopilot", { action: "run", step: "gibt_es_nicht" });
  check(
    t.isError === true && /Möglich/.test(t.text),
    "unbekannter Schritt → Hinweis",
  );
  t = await call(write, "autopilot", {
    action: "undo",
    entry: "zzzzzzzzzzzzzzzz",
  });
  check(t.isError === true, "unbekannter Eintrag → isError");
  t = await call(read, "autopilot", {
    action: "run",
    step: t.data?.steps?.[0]?.step ?? "plan_week",
  });
  check(t.isError === true, "Leseschlüssel führt keinen Schritt aus");

  step("Widerruf");
  await api(
    `/account/api-keys/${(await api("/account/api-keys")).json.find((k) => k.name === "MCP Test").id}`,
    { method: "DELETE" },
  );
  check(
    (await mcp(write, "tools/list")).status === 401,
    "widerrufener Schlüssel → 401",
  );

  step("Keine KI im Worker");
  r = await api("/ai/status");
  check(
    r.json.transcribe === false &&
      r.json.structure === "rules" &&
      r.json.vision === false,
    `Status: keine Server-KI (${JSON.stringify(r.json)})`,
  );
  r = await api("/ai/parse", {
    body: {
      text: "Fluchtweg versperrt, Gefahr im Verzug. Hausmeister anrufen bis morgen.",
      checkpoints: [],
    },
  });
  check(
    r.json.source === "rules" &&
      r.json.items[0].severity === "critical" &&
      r.json.items[1].kind === "task" &&
      r.json.items[1].dueInDays === 1,
    "parse: Regeln, Schwere und Aufgabe",
  );
  for (const p of ["/ai/transcribe", "/ai/typeplate", "/ai/identify"]) {
    r = await api(p, { body: { key: "x/y" } });
    check(r.status === 404, `${p} entfernt → 404 (${r.status})`);
  }

  step("Vorschläge und automatische Aufgaben");
  r = await api("/smart/suggestions");
  check(
    Array.isArray(r.json) && r.json.some((s) => s.kind === "round"),
    `Vorschläge mit Rundgang (${r.json?.map((s) => s.kind)})`,
  );
  const a2 = (await api("/assets")).json.find(
    (x) => x.category === "smoke_alarm",
  );
  const iid = (await api(`/assets/${a2.id}/inspections`, { body: {} })).json.id;
  const cps = (await api("/categories")).json.find(
    (c) => c.key === "smoke_alarm",
  ).checkpoints;
  r = await api(`/inspections/${iid}/submit`, {
    body: {
      kinds: ["periodic"],
      answers: Object.fromEntries(
        cps.map((cp, i) => [cp.id, i === 0 ? "defect" : "ok"]),
      ),
      defects: [
        {
          checkpointId: cps[0].id,
          title: "Melder fehlt",
          note: "",
          measure: "Neu montieren",
          severity: "critical",
        },
      ],
      signature: SIG,
      signerName: "E2E",
    },
  });
  check(r.status === 200, `Prüfung mit kritischem Mangel (${r.status})`);
  const auto = (await api("/tasks")).json.filter(
    (x) => x.assetId === a2.id && /Neu montieren/.test(x.title),
  );
  check(
    auto.length === 1 && auto[0].priority === "high" && auto[0].defectId,
    `Aufgabe automatisch angelegt (${auto.length})`,
  );
  r = await api("/smart/tasks-from-defects", {
    body: { severities: ["high", "critical"] },
  });
  check(
    r.status === 200 && typeof r.json.created === "number",
    `Aufgaben aus Mängeln (${r.json?.created})`,
  );
  const again = await api("/smart/tasks-from-defects", {
    body: { severities: ["high", "critical"] },
  });
  check(again.json.created === 0, "keine doppelten Aufgaben");

  console.log(
    fail.length ? `FAILED ${fail.length}: ${fail.join("; ")}` : "ALL CHECKS OK",
  );
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log("FAIL", e.stack);
  process.exit(1);
});
