// E2E 30-mcp-element: Plan v6, Paket T – die Befunde aus dem MCP-Praxistest (Element und Prüfung), je Punkt der Aufruf
// aus dem Bericht mit dem erwarteten Ergebnis über /api/mcp: A1 „Tür 4“ trifft nie FL-004, A3 Laufreihenfolge UG → EG →
// 1. OG → 2. OG, A4 „Alles i. O.“ mit Bedingungen, A5 unsichere Prüfpunkt-Zuordnung, B6 „nicht prüfbar“ nur mit Grund,
// C4 Arbeiten mit anderen Worten, C5 Kurzfassung im Rundgang, C6 Widersprüche, C7 bekannte Mängel zusammenführen,
// D1 Stammdaten prüfen, D2 Doppelte in der setup-Vorschau, E6 Schwere mit Wort, E7 Status ready, E8 ein Hinweistext,
// F1 get(asset), F2 setup mit Stammdaten/Nummer/Produkt, F4 Zugang. Nur lokal.
if (!process.env.DEMO_PASSWORD) throw new Error("DEMO_PASSWORD fehlt");
const BASE = process.env.BASE || "http://localhost:5173";
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log("  ✗", m);
  }
};
const step = (m) => console.log("·", m);

let cookie = "";
async function api(path, { method, body } = {}) {
  const r = await fetch(BASE + "/api" + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { "x-pk": "1", cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc && sc.startsWith("pk_session")) cookie = sc.split(";")[0];
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: null, text };
  }
}
let rpcId = 0;
let KEY = "";
async function tool(name, args = {}) {
  const r = await fetch(BASE + "/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const j = await r.json().catch(() => null);
  const res = j?.result;
  let data = null;
  if (res && !res.isError) {
    try {
      data = JSON.parse(res.content[0].text);
    } catch {
      data = null;
    }
  }
  const text = res?.content?.[0]?.text ?? j?.error?.message ?? "";
  // E2E_SHOW=1 zeigt die Antworten (zum Nachlesen, wie sie für die Sprache klingen)
  if (process.env.E2E_SHOW) console.log(`  → ${name} ${JSON.stringify(args).slice(0, 160)}\n    ${text.slice(0, 1600)}`);
  return { isError: !!res?.isError, data, text };
}
const P = "Garner Hotel (Test)";
const B = "Garner Testhaus";

(async () => {
  if (process.env.PROD) throw new Error("30-mcp-element nicht gegen Produktion ausführen");
  check((await api("/auth/login", { body: { email: "demo@example.com", password: process.env.DEMO_PASSWORD } })).status === 200, "Login");
  KEY = (await api("/account/api-keys", { body: { name: "MCP Element", scope: "write", expiresInDays: 1 } })).json.key;

  step("F2/F4: Katalog-Produkt und setup mit Zugang, Stammdaten, fester Nummer und Produkt");
  let t = await tool("catalog", {
    action: "upsert",
    list: "products",
    preview: false,
    items: [{ manufacturer: "Garnerwerk", model: "GT 30", category: "fire_door", defaults: { rating: "T30", smoke: true } }],
  });
  check(!t.isError, `Produkt angelegt (${t.text.slice(0, 160)})`);
  const elements = [
    // bewusst UG → EG → 1. OG → 2. OG (alphabetisch wäre 1. OG, 2. OG, EG, UG)
    { category: "Feuerschutztür", floor: "UG", location: "Kellerflur", manufacturer: "Hörmann", fields: { holdOpen: false, leaves: "1-flügelig", rating: "T30", cardLock: false, dropSeal: false, peephole: false } },
    { category: "Feuerschutztür", floor: "EG", location: "Lobby → Treppenhaus" },
    { category: "Feuerschutztür", floor: "1. OG", location: "Flur Zimmer 101", product: "Garnerwerk GT 30" },
    { category: "Feststellanlage", floor: "1. OG", location: "Flur Zimmer 101", number: 5 },
    { category: "Feuerlöscher", floor: "2. OG", location: "Flur Zimmer 201", number: 4 },
  ];
  const setupArgs = { property: { name: P, address: "Teststraße 1", access: "Schlüssel an der Rezeption, werktags 7–16 Uhr" }, buildings: [{ name: B, elements }] };
  t = await tool("setup", { ...setupArgs, preview: true });
  check(!t.isError && t.data?.total === 5 && !t.data?.possibleDuplicates, `setup-Vorschau: 5 neu, keine Doppelten (${t.text.slice(0, 200)})`);
  check(/Rezeption/.test(t.data?.access ?? ""), "setup-Vorschau nennt den Zugang");
  t = await tool("setup", { ...setupArgs, preview: false });
  check(!t.isError && /T-001, T-002, T-003, FSA-005, FL-004/.test(t.data?.created?.[0]?.codes ?? ""), `setup angelegt mit fester Nummer (${t.data?.created?.[0]?.codes})`);
  const props = (await api("/properties")).json;
  const pid = props.find((p) => p.name === P)?.id;
  const detail = (await api(`/properties/${pid}`)).json;
  const byCode = Object.fromEntries(detail.assets.map((a) => [a.code, a]));
  check(detail.access === "Schlüssel an der Rezeption, werktags 7–16 Uhr", `F4: Zugang am Objekt (${detail.access})`);
  check(byCode["T-001"]?.manufacturer === "Hörmann" && byCode["T-001"]?.attributes?.holdOpen === false && byCode["T-001"]?.attributes?.requirement === "T30", `F2: Stammdaten T-001 (${JSON.stringify(byCode["T-001"]?.attributes)})`);
  check(byCode["T-003"]?.manufacturer === "Garnerwerk" && byCode["T-003"]?.model === "GT 30" && byCode["T-003"]?.attributes?.requirement === "T30-RS", `F2: Produkt übernommen (${JSON.stringify([byCode["T-003"]?.manufacturer, byCode["T-003"]?.attributes])})`);

  step("D2: dieselben Elemente noch einmal → wahrscheinlich doppelt");
  t = await tool("setup", { property: { name: P }, buildings: [{ name: B, elements: [{ category: "Feuerschutztür", floor: "EG", location: "Lobby → Treppenhaus" }] }], preview: true });
  check(/T-002/.test((t.data?.possibleDuplicates ?? []).join(" ")) && /doppelt/.test(t.data?.next ?? ""), `D2: Vorschau meldet T-002 als wahrscheinlich doppelt (${t.text.slice(0, 220)})`);
  t = await tool("setup", { property: { name: P }, buildings: [{ name: B, elements: [{ category: "Feuerlöscher", floor: "EG", number: 4 }] }], preview: true });
  check(/Nummer 4 hat in diesem Objekt schon FL-004/.test((t.data?.problems ?? []).join(" ")), `setup: vergebene Nummer gemeldet (${t.text.slice(0, 200)})`);

  step("A3: Laufreihenfolge in tour und plan: UG → EG → 1. OG → 2. OG");
  t = await tool("tour", { action: "status", building: B });
  const order = (t.data?.remaining ?? []).map((r) => r.split(" ")[0]);
  check(order.join(",") === "T-001,T-002,T-003,FSA-005,FL-004", `tour status in Laufreihenfolge (${order.join(",")})`);
  t = await tool("plan", { action: "view", building: B, days: 30 });
  const walk = (t.data?.rounds?.[0]?.walk ?? []).map((r) => r.split(" ")[0]);
  check(walk.join(",") === "T-001,T-002,T-003,FSA-005,FL-004", `plan in Laufreihenfolge (${walk.join(",")})`);
  const rounds = (await api("/smart/rounds?days=30")).json;
  const r = rounds.find((x) => x.buildingName === B);
  check(r?.assets.map((a) => a.code).join(",") === "T-001,T-002,T-003,FSA-005,FL-004", "Rundgang-API in Laufreihenfolge");

  step("C5/F4/E8: tour start – Zugang, Kurzfassung, Volltext nur mit detail");
  t = await tool("tour", { action: "start", building: B });
  check(/Rezeption/.test(t.data?.access ?? ""), `tour start nennt den Zugang (${t.data?.access})`);
  check(t.data?.element?.code === "T-001" && typeof t.data?.element?.checkpoints === "string" && !t.data?.element?.checkpointList, `C5: Prüfpunkte als Kurzfassung (${t.data?.element?.checkpoints})`);
  check(/7 Punkte entfallen/.test(t.data?.element?.notApplicable ?? ""), `A4: tour nennt, was entfällt (${t.data?.element?.notApplicable})`);
  check(JSON.stringify(t.data).length < 1400, `C5: Antwort kurz genug zum Vorlesen (${JSON.stringify(t.data).length} Zeichen)`);
  t = await tool("tour", { action: "start", building: B, detail: true });
  check((t.data?.element?.checkpointList ?? []).length === 26, `C5: Volltext mit detail (${(t.data?.element?.checkpointList ?? []).length})`);
  t = await tool("tour", { action: "next", building: B, after: "T-001" });
  check(t.data?.element?.code === "T-002" && (t.data?.element?.askFirst ?? []).includes("Hat die Tür eine Feststellanlage?"), `tour fragt bei fehlendem Stammdatum (${JSON.stringify(t.data?.element?.askFirst)})`);

  step("A1: „Tür 4“ ist der Feuerlöscher FL-004 – überall Fehler statt falsches Element");
  t = await tool("update_asset", { asset: "Tür 4", property: P, model: "Falsch" });
  check(t.isError && /Nummer 4 ist ein Feuerlöscher \(FL-004\)/.test(t.text), `update_asset: Fehler (${t.text})`);
  check((await api(`/assets/${byCode["FL-004"].id}`)).json.model === "", "FL-004 unverändert");
  t = await tool("inspect", { asset: "Tür 4", property: P, allOk: true });
  check(t.isError && /Nummer 4 ist ein Feuerlöscher \(FL-004\)/.test(t.text), `inspect: Fehler (${t.text})`);
  t = await tool("get", { kind: "asset", ref: "Tür 4", property: P });
  check(t.isError && /Feuerlöscher \(FL-004\)/.test(t.text), `get: Fehler (${t.text})`);
  t = await tool("search", { query: "Tür 4", property: P });
  check(/Nummer 4 ist ein Feuerlöscher \(FL-004\)/.test(t.data?.hint ?? "") && !(t.data?.assets ?? []).length, `search: Hinweis statt Treffer (${t.text.slice(0, 160)})`);
  t = await tool("get", { kind: "asset", ref: "Löscher 4", property: P });
  check(!t.isError && t.data?.code === "FL-004", "„Löscher 4“ trifft FL-004");
  t = await tool("get", { kind: "asset", ref: "Nummer 4", property: P });
  check(!t.isError && t.data?.code === "FL-004", "„Nummer 4“ (ohne Art) wie bisher");
  const sr = (await api(`/search?q=${encodeURIComponent("Tür 4")}&propertyId=${pid}`)).json;
  check(/Feuerlöscher \(FL-004\)/.test(sr.refHint ?? "") && !sr.assets.some((a) => a.code === "FL-004"), "App-Suche: Hinweis statt FL-004");

  step("F1/E6/E7: get(asset) vollständig");
  t = await tool("get", { kind: "asset", ref: "T-001" });
  check(t.data?.data?.Anforderung === "T30" && t.data?.data?.Feststellanlage === "nein" && (t.data?.missingData ?? []).some((m) => /Baujahr/.test(m)), `F1: Stammdaten mit fehlenden Feldern (${JSON.stringify([t.data?.data, t.data?.missingData])})`);
  check(/26 Prüfpunkte/.test(t.data?.checkpoints ?? "") && /entfallen/.test(t.data?.notApplicable ?? ""), `F1: Prüfpunkte in Kurzform (${t.data?.checkpoints})`);

  step("D1: update_asset prüft Auswahl, Zahl, Baujahr");
  t = await tool("update_asset", { asset: "T-003", fields: { rating: "T45" } });
  check(t.isError && /T45/.test(t.text) && /T30/.test(t.text), `rating T45 abgelehnt (${t.text})`);
  t = await tool("update_asset", { asset: "T-003", year: 1890 });
  check(t.isError && /1950/.test(t.text), `Baujahr 1890 abgelehnt (${t.text})`);
  t = await tool("update_asset", { asset: "T-003", fields: { leaves: "drei" } });
  check(t.isError && /2-flügelig/.test(t.text), `leaves „drei“ abgelehnt (${t.text})`);
  t = await tool("update_asset", { asset: "T-003", fields: { leaves: "zwei", holdOpen: "ja" }, year: 2019 });
  check(!t.isError && /2-flügelig/.test((t.data?.changed ?? []).join(" ")), `leaves „zwei“ → „2-flügelig“ (${t.text.slice(0, 200)})`);
  const a3 = (await api(`/assets/${byCode["T-003"].id}`)).json;
  check(a3.attributes.leaves === "2-flügelig" && a3.attributes.holdOpen === true && a3.attributes.year === 2019 && a3.attributes.requirement === "T30-RS", `T-003 gespeichert (${JSON.stringify(a3.attributes)})`);

  step("A4: „Alles in Ordnung“ mit Bedingungen");
  t = await tool("inspect", { asset: "T-001", allOk: true });
  const insp1 = t.data?.inspectionId;
  check(t.data?.status === "ready" && /7 Punkte entfallen/.test(t.data?.notApplicable ?? ""), `T-001 ohne FSA, einflügelig, T30 ohne Ausstattung: 7 entfallen, bereit (${t.text.slice(0, 260)})`);
  const i1 = (await api(`/inspections/${insp1}`)).json;
  const ans = (re) => i1.answers[i1.checkpoints.find((c) => re.test(c.label)).id];
  check(ans(/Feststellanlage löst/) === "na" && ans(/Rauchmelder der Feststellanlage/) === "na" && ans(/Schließfolge/) === "na" && ans(/Obentürschließer/) === "ok", "Antworten: na für FSA und Schließfolge, Rest i. O.");
  check(t.data?.hint === "In der App: Objekt → Begehung → Unterschreiben", `E8: ein Hinweistext (${t.data?.hint})`);
  t = await tool("inspect", { asset: "T-002", allOk: true });
  check(t.data?.status === "draft" && (t.data?.ask ?? []).some((q) => /Hat die Tür eine Feststellanlage\?/.test(q)) && (t.data?.ask ?? []).some((q) => /ein- oder zweiflügelig/.test(q)), `T-002 unbekannt: offen mit Rückfrage (${JSON.stringify(t.data?.ask)})`);
  t = await tool("inspect", { asset: "T-002", allOk: true, fields: { holdOpen: false, leaves: "einflügelig", requirement: "T30", cardLock: false, dropSeal: false, peephole: false } });
  // v7: auch Anforderung und Ausstattung (Kartenschloss, Absenkdichtung, Spion) werden erfragt und mitgesetzt
  check(!t.isError && t.data?.status === "ready" && (t.data?.dataChanged ?? []).length === 6, `Antwort setzt das Stammdatum mit (${t.text.slice(0, 260)})`);
  check((await api(`/assets/${byCode["T-002"].id}`)).json.attributes.holdOpen === false, "holdOpen am Element gespeichert");

  step("E7: list draft ohne bereitgelegte, ready eigener Status");
  t = await tool("list", { what: "inspections", status: "draft", property: P });
  check(!(t.data?.inspections ?? []).some((i) => i.inspectionId === insp1), "draft listet keine bereitgelegten");
  t = await tool("list", { what: "inspections", status: "ready", property: P });
  check((t.data?.inspections ?? []).some((i) => i.inspectionId === insp1 && i.status === "ready"), "ready: status ready");
  t = await tool("get", { kind: "inspection", ref: insp1 });
  check(t.data?.status === "ready" && t.data?.statusLabel === "wartet auf Unterschrift", `get(inspection): status ready (${t.data?.status})`);

  step("A5: Mangel ohne Prüfpunkt – klar → zugeordnet, unklar → nachfragen");
  t = await tool("inspect", { asset: "T-003", defects: [{ title: "Dichtung beschädigt oder fehlend" }] });
  const dich = (t.data?.defects ?? []).find((d) => d.title === "Dichtung beschädigt oder fehlend");
  check(/^16\. Dichtungen/.test(dich?.checkpoint ?? ""), `„Dichtung beschädigt oder fehlend“ → Dichtungen (${dich?.checkpoint})`);
  check(dich?.severity && dich?.severityLabel, `E6: Schwere mit Schlüssel und Wort (${JSON.stringify(dich)})`);
  t = await tool("inspect", { asset: "T-003", defects: [{ title: "Verglasung und Zarge beschädigt" }] });
  const vz = (t.data?.defects ?? []).find((d) => d.title === "Verglasung und Zarge beschädigt");
  check(vz && !vz.checkpoint && (t.data?.ask ?? []).some((q) => /welcher Prüfpunkt/.test(q)), `unklar: ohne Prüfpunkt, Rückfrage (${JSON.stringify(t.data?.ask)})`);

  step("C4: Arbeiten mit anderen Worten");
  t = await tool("inspect", { asset: "T-003", maintenance: ["Schließer eingestellt", "Bänder geölt"] });
  const i3 = (await api(`/inspections/${t.data?.inspectionId}`)).json;
  check(i3.maintenance.includes("closer") && i3.maintenance.includes("hinges") && !(t.data?.notes ?? []).length, `Schließer eingestellt → closer, Bänder geölt → hinges (${JSON.stringify(i3.maintenance)})`);

  step("C6: Widersprüche werden nachgefragt");
  t = await tool("inspect", { asset: "T-003", answers: [{ checkpoint: "Verglasung", answer: "ok" }], defects: [{ title: "Glasleiste lose", checkpoint: "Verglasung" }] });
  check(t.data?.status === "draft" && (t.data?.ask ?? []).some((q) => /i\. O\.“ gemeldet.*Glasleiste lose.*was stimmt/.test(q)), `ok + Mangel am selben Punkt (${JSON.stringify(t.data?.ask)})`);
  t = await tool("inspect", { asset: "FSA-005", maintenance: ["Melder gereinigt"], defects: [{ title: "Melder verschmutzt", severity: "medium" }] });
  check(t.data?.status === "draft" && (t.data?.ask ?? []).some((q) => /Melder gereinigt.*Melder verschmutzt.*widersprechen/.test(q)), `Arbeit „Melder gereinigt“ + Mangel „Melder verschmutzt“ (${JSON.stringify(t.data?.ask)})`);

  step("C7: bekannter Mangel und gleichlautender Befund werden zusammengeführt");
  t = await tool("capture", { asset: "T-002", items: [{ kind: "defect", title: "Dichtung überstrichen", severity: "medium" }] });
  check(!t.isError, `offener Mangel an T-002 (${t.text.slice(0, 120)})`);
  t = await tool("inspect", { asset: "T-002", defects: [{ title: "Dichtung überstrichen" }] });
  let same = (t.data?.defects ?? []).filter((d) => /Dichtung überstrichen/.test(d.title));
  check(same.length === 1 && same[0].known && (t.data?.merged ?? []).length === 1, `neuer Befund = bekannter Mangel, einmal (${JSON.stringify(t.data?.defects)})`);
  t = await tool("inspect", { asset: "T-002", known: [{ defect: "Dichtung überstrichen", status: "still" }] });
  same = (t.data?.defects ?? []).filter((d) => /Dichtung überstrichen/.test(d.title));
  check(same.length === 1 && !(t.data?.ask ?? []).some((q) => /mehrdeutig/.test(q)), `known per Titel eindeutig (${JSON.stringify(t.data)})`);

  step("B6: „nicht prüfbar“ nur mit Grund; Befunde heben es auf");
  t = await tool("inspect", { asset: "FL-004", notInspectable: true });
  check(t.isError && /Grund/.test(t.text), `ohne reason abgelehnt (${t.text})`);
  t = await tool("inspect", { asset: "FL-004", notInspectable: true, reason: "Raum verschlossen" });
  check(!t.isError && t.data?.result === "nicht prüfbar", `mit reason angenommen (${t.data?.result})`);
  t = await tool("inspect", { asset: "FL-004", allOk: true });
  check(!t.isError && /aufgehoben/.test(t.data?.stateChange ?? "") && t.data?.result === "ohne Mängel", `allOk hebt „nicht prüfbar“ auf und meldet es (${t.text.slice(0, 200)})`);
  const i4 = (await api(`/inspections/${t.data?.inspectionId}`)).json;
  check(!i4.notInspectable && !/Nicht prüfbar/.test(i4.notes), "Entwurf wieder prüfbar, Grund aus der Bemerkung entfernt");

  console.log(fail.length ? `\n${fail.length} Fehler` : "\nalles grün");
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
