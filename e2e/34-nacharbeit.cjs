// E2E 34-nacharbeit (Plan v7, Paket X): was nach der Wartung kommt.
// Frischer Workspace mit Inhaberin, Prüfer und Lesezugriff; ein Objekt mit sieben Türen und einer Feststellanlage.
// - Nachweise: Inhaberin (Sachkunde Tür gültig, Hersteller-Zertifikat FSA abgelaufen), Admin pflegt für den Prüfer,
//   Prüfer pflegt nur eigene (Konto, 390 px), Rechte per API, abgelaufener Nachweis → Hinweis beim Unterschreiben.
// - Unterschreiben → „Sammelmappe erzeugen“ → PDF: Deckblatt (Zahlen, Nachweis-Hinweis), Inhaltsliste mit richtigen
//   Seiten, erst ohne Mangel, dann Gruppen gleicher Mängel mit Zwischenblatt, nicht prüfbar am Ende, Dateiname.
// - Protokoll: Abnahme-Zeile, Befähigungsnachweis je Elementart, gesetzte Stammdaten.
// - ZIP: Dateinamen Ident_Datum_Art.pdf.
// - Angebot am Objekt (Endpunkt aus Paket V per Route-Interception gemockt, solange er fehlt): Positionen, Hinweis auf
//   nicht zugeordnete Mängel, Serien-Vorschlag, Regie hinzufügen, Excel und PDF; MCP report(what: "offer").
// - 390 px ohne horizontalen Überlauf. Bilder für docs/design/v3/v7 mit SHOTS=1. Nur lokal.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { unzipSync, strFromU8 } = require('fflate');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, '.out', '34-nacharbeit') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS ? path.join(__dirname, '..', 'docs', 'design', 'v3', 'v7') + '/' : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const step = (m) => console.log('·', m);
const pdfPages = (file) => execFileSync('pdftotext', ['-layout', file, '-']).toString().split('\f').slice(0, -1);
const pdfText = (file) => execFileSync('pdftotext', ['-layout', file, '-']).toString();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let rpcId = 0;
async function mcp(key, name, args = {}) {
  const r = await fetch(BASE + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json().catch(() => null);
  return { isError: j?.result?.isError, text: j?.result?.content?.[0]?.text ?? j?.error?.message ?? '' };
}

(async () => {
  if (process.env.PROD) throw new Error('34-nacharbeit nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 409/.test(m.text()) && errors.push('console ' + m.text()));
  };
  watch(p);
  const req = (pg) => async (pth, opts = {}) => {
    const r = await pg.request.fetch(BASE + '/api' + pth, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const api = req(p);
  const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = async (pg, name, opts = {}) => {
    await pg.waitForTimeout(250);
    await pg.screenshot({ path: OUT + name + '.png', ...opts });
    if (SHOTS) await pg.screenshot({ path: SHOTS + name + '.png', ...opts });
  };
  const download = async (pg, fn) => {
    const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 90_000 }), fn()]);
    const file = OUT + d.suggestedFilename();
    await d.saveAs(file);
    return { name: d.suggestedFilename(), file };
  };
  /** PDF-Seiten als PNG für die Doku (nur mit SHOTS). */
  const pdfPng = (file, page, name) => {
    execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-r', '80', '-png', '-singlefile', file, OUT + name]);
    if (SHOTS) fs.copyFileSync(OUT + name + '.png', SHOTS + name + '.png');
  };

  step('Workspace, Team, Objekt mit sieben Türen und einer Feststellanlage');
  await p.goto(BASE + '/login');
  const stamp = Date.now();
  let r = await api('/auth/register', { data: { company: 'Nacharbeit Test GmbH', name: 'Hanna Seefeld', email: `hanna${stamp}@example.com`, password: 'sicheres-passwort-1' } });
  check(r.status === 200, `registriert (${r.status})`);
  const me = (await api('/account/me')).json;
  const ownerId = me.user.id;
  const invP = (await api('/account/members/invite', { data: { email: `piet${stamp}@example.com`, role: 'inspector' } })).json;
  const invL = (await api('/account/members/invite', { data: { email: `lena${stamp}@example.com`, role: 'viewer' } })).json;
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true });
  const m = await mctx.newPage();
  watch(m);
  r = { status: (await m.request.fetch(BASE + `/api/auth/invite/${invP.token}`, { method: 'POST', data: { name: 'Piet Prüfer', password: 'sicheres-passwort-2' }, headers: { 'x-pk': '1' } })).status() };
  check(r.status === 200, `Prüfer angenommen (${r.status})`);
  const papi = req(m);
  const pme = (await papi('/account/me')).json;
  const pietId = pme.user.id;
  // Rechtstexte zustimmen (sonst legt sich der Zustimmungsdialog über die Seite)
  if (pme.pendingLegal?.length) check((await papi('/account/legal/accept', { data: { docs: pme.pendingLegal } })).status === 200, 'Prüfer stimmt Rechtstexten zu');
  const lctx = await b.newContext();
  check((await lctx.request.fetch(BASE + `/api/auth/invite/${invL.token}`, { method: 'POST', data: { name: 'Lena Lesend', password: 'sicheres-passwort-3' }, headers: { 'x-pk': '1' } })).status() === 200, 'Lesezugriff angenommen');
  const lapi = async (pth, opts = {}) => {
    const x = await lctx.request.fetch(BASE + '/api' + pth, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: x.status() };
  };

  const P = 'Hotel Seeblick (Test)';
  const prop = (await api('/properties', { data: { name: P, address: 'Uferweg 3\n23570 Lübeck', withBuilding: true } })).json;
  const bid = (await api(`/properties/${prop.id}`)).json.buildings[0].id;
  // erstes Auswahl-Stammdatum der Tür (aus der Katalog-Definition, nichts fest verdrahten)
  const cats = (await api('/categories')).json;
  const doorDef = cats.find((c) => c.key === 'fire_door');
  const selAttr = doorDef.attributes.find((a) => a.type === 'select' && a.options?.length);
  const mk = async (category, number, floor, location, extra = {}) => {
    const x = await api('/assets', { data: { buildingId: bid, category, number, floor, location, attributes: {}, ...extra } });
    check(x.status === 200, `Element ${number} (${x.status} ${JSON.stringify(x.json).slice(0, 120)})`);
    return x.json;
  };
  const D = {};
  D[101] = await mk('fire_door', 101, 'EG', 'Flur Ost', { manufacturer: 'Hörmann', model: 'H3', attributes: selAttr ? { [selAttr.key]: selAttr.options[0] } : {} });
  D[102] = await mk('fire_door', 102, 'EG', 'Zimmer 2');
  D[103] = await mk('fire_door', 103, 'EG', 'Zimmer 3');
  D[104] = await mk('fire_door', 104, 'EG', 'Zimmer 4');
  D[105] = await mk('fire_door', 105, '1. OG', 'Zimmer 105');
  D[106] = await mk('fire_door', 106, '1. OG', 'Zimmer 106');
  D[107] = await mk('fire_door', 107, '1. OG', 'Technik');
  const FSA = await mk('hold_open', 9, 'EG', 'Foyer', { manufacturer: 'ECO' });
  const code = (n) => (n === 'fsa' ? FSA.code : D[n].code);

  step('Nachweise der Inhaberin: Tür gültig, Feststellanlage abgelaufen');
  r = await api('/credentials', { data: { kind: 'expertise', title: 'Befähigte Person für Brandschutztüren', issuer: 'DGWZ', number: 'DGWZ-4711', validUntil: Date.UTC(2030, 11, 31, 23, 59), categories: ['fire_door'] } });
  check(r.status === 200, `Sachkunde angelegt (${r.status})`);
  r = await api('/credentials', { data: { kind: 'manufacturer', title: 'Feststellanlagen', issuer: 'ECO', number: 'ECO-2022-17', validUntil: Date.UTC(2024, 5, 30, 23, 59), categories: ['hold_open'] } });
  check(r.status === 200, `Hersteller-Zertifikat (abgelaufen) angelegt (${r.status})`);

  step('Acht Prüfungen bereitlegen: drei ohne Mangel, Gruppen gleicher Mängel, FSA, nicht prüfbar');
  const ready = async (assetId, { defects = [], notInspectable = false } = {}, call = api) => {
    const { id } = (await call(`/assets/${assetId}/inspections`, { data: {} })).json;
    const d = (await call(`/inspections/${id}`)).json;
    const answers = notInspectable ? {} : Object.fromEntries(d.checkpoints.map((c) => [c.id, 'ok']));
    const list = defects.map((title, i) => {
      answers[d.checkpoints[i].id] = 'defect';
      return { checkpointId: d.checkpoints[i].id, title, note: '', measure: '', severity: 'medium' };
    });
    const x = await call(`/inspections/${id}`, { method: 'PUT', data: { kinds: d.kinds?.length ? d.kinds : ['periodic'], answers, defects: list, notInspectable, notes: notInspectable ? 'Raum verschlossen' : '', ready: true } });
    check(x.json?.ready === true, `bereit ${d.asset.code} (${JSON.stringify(x.json).slice(0, 140)})`);
    return id;
  };
  await ready(D[101].id);
  await ready(D[105].id);
  await ready(D[106].id);
  await ready(D[102].id, { defects: ['Türstopper fehlt'] });
  await ready(D[103].id, { defects: ['Hinweis: Türstopper fehlt'] });
  await ready(D[104].id, { defects: ['Band defekt/lose', 'Türstopper fehlt'] });
  await ready(FSA.id, { defects: ['Prüfbuch fehlt'] });
  await ready(D[107].id, { notInspectable: true });

  step('Unterschreiben: Hinweis auf abgelaufenen Nachweis, dann „Sammelmappe erzeugen“');
  await p.goto(BASE + '/');
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`pk:signature:${ownerId}`, SIG]);
  await p.goto(BASE + '/unterschreiben');
  const hint = p.locator('[data-credential-hint]');
  await hint.waitFor();
  const hintText = await hint.innerText();
  check(/abgelaufen/.test(hintText) && /Feststellanlage/.test(hintText) && !/Tür[^:]*: /.test(hintText.replace(/Feststellanlage: \w+/, '')), `Hinweis nur für die Feststellanlage (${hintText})`);
  await p.getByRole('button', { name: 'Alle 8 unterschreiben' }).click();
  await p.getByText('8 Prüfungen unterschrieben').waitFor({ timeout: 20000 });
  const after = p.getByRole('list', { name: 'Nacharbeit' });
  await after.getByText(P).waitFor();
  check(await after.getByRole('link', { name: 'Angebotsliste' }).isVisible(), 'nach dem Unterschreiben: Weg zur Angebotsliste (Mängel dabei)');
  await after.getByRole('button', { name: 'Sammelmappe erzeugen' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByText('8 gerade unterschriebene Prüfungen').waitFor();
  const mappe = await download(p, () => dlg.getByRole('button', { name: 'Mappe mit 8 Protokollen erzeugen' }).click());
  await dlg.locator('[data-mappe-done]').waitFor();
  check(/^Sammelmappe_Hotel-Seeblick-Test_\d{4}-\d{2}-\d{2}\.pdf$/.test(mappe.name), `Dateiname der Mappe (${mappe.name})`);
  check(/8 Protokolle auf \d+ Seiten: 3 ohne Mangel, 4 mit Mangel, 1 nicht prüfbar/.test(await dlg.locator('[data-mappe-done]').innerText()), 'Ergebnis im Dialog');
  check(/1 Protokoll ohne gültigen Befähigungsnachweis/.test(await dlg.innerText()), 'Dialog nennt fehlenden Nachweis');
  await dlg.getByRole('button', { name: 'Fertig' }).click();

  step('Sammelmappe prüfen: Deckblatt, Inhaltsliste, Reihenfolge, Zwischenblätter, Seiten');
  const pages = pdfPages(mappe.file);
  const { PDFDocument } = require('pdf-lib');
  const pdfDoc = await PDFDocument.load(fs.readFileSync(mappe.file));
  check(pdfDoc.getPageCount() === pages.length, `Seitenzahl (${pdfDoc.getPageCount()} / ${pages.length})`);
  const cover = pages[0];
  check(/Sammelmappe Prüfprotokolle/.test(cover) && cover.includes(P), 'Deckblatt mit Objekt');
  for (const [k, v] of [['Geprüft', 8], ['Ohne Mangel', 3], ['Mit Mangel', 4], ['Nicht prüfbar', 1], ['Mangelgruppen', 3]])
    check(new RegExp(`${k}\\s+${v}\\b`).test(cover), `Deckblatt: ${k} ${v}`);
  check(/Hanna Seefeld/.test(cover) && /DGWZ-4711/.test(cover) && /ECO-2022-17/.test(cover) && /abgelaufen/.test(cover) && /31\.12\.2030/.test(cover), 'Deckblatt: Prüferin mit Nachweisen, gültig bis und Status');
  check(/Hinweis: 1 Protokoll ohne gültigen Befähigungsnachweis/.test(cover), 'Deckblatt: Hinweis fehlender Nachweis');
  check(/^\s*Inhalt\b/m.test(pages[1]), 'Seite 2: Inhaltsliste');
  // Erste Seite je Protokoll finden (Prüfpunkte bzw. „nicht prüfbar“ auf der ersten Seite)
  const all = [101, 102, 103, 104, 105, 106, 107, 'fsa'];
  const startOf = {};
  pages.forEach((txt, i) => {
    if (!/Prüfprotokoll /.test(txt) || !/Prüfpunkte|nicht prüfbar\./.test(txt)) return;
    const hit = all.filter((n) => new RegExp(`\\b${esc(code(n))}\\b`).test(txt));
    if (hit.length === 1 && startOf[hit[0]] == null) startOf[hit[0]] = i + 1;
  });
  check(all.every((n) => startOf[n]), `jede Prüfung als Protokoll enthalten (${JSON.stringify(startOf)})`);
  const order = [...all].sort((a, b) => startOf[a] - startOf[b]);
  const expected = [101, 105, 106, 102, 103, 104, 'fsa', 107];
  check(JSON.stringify(order) === JSON.stringify(expected), `Reihenfolge: ohne Mangel → Gruppen → nicht prüfbar (${order.join(',')})`);
  // Zwischenblätter direkt vor der ersten Prüfung jeder Gruppe
  const sheet = (n) => pages[startOf[n] - 2];
  check(/Mangelgruppe 1 \/ 3/.test(sheet(102)) && /Türstopper fehlt/.test(sheet(102)) && sheet(102).includes(code(103)), 'Zwischenblatt Gruppe 1 (Türstopper) mit beiden Türen');
  check(/Mangelgruppe 2 \/ 3/.test(sheet(104)) && /Band defekt\/lose/.test(sheet(104)), 'Zwischenblatt Gruppe 2 (Band + Türstopper)');
  check(/Mangelgruppe 3 \/ 3/.test(sheet('fsa')) && /Prüfbuch fehlt/.test(sheet('fsa')), 'Zwischenblatt Gruppe 3 (Prüfbuch)');
  check(/Nicht prüfbar/.test(sheet(107)) && sheet(107).includes(code(107)), 'Zwischenblatt „nicht prüfbar“');
  check(!/Mangelgruppe/.test(pages[startOf[101] - 2] ?? ''), 'kein Zwischenblatt vor „ohne Mangel“');
  // Inhaltsliste: Seitenzahlen stimmen
  const toc = pages.slice(1, startOf[101] - 1).join('\n');
  for (const n of all) {
    const line = toc.split('\n').find((l) => new RegExp(`^\\s*${esc(code(n))}\\s`).test(l));
    const pg = line && Number(line.trim().split(/\s+/).pop());
    check(pg === startOf[n], `Inhaltsliste: ${code(n)} auf Seite ${startOf[n]} (${line?.trim()})`);
  }
  check(/Ohne Mangel \(3\)/.test(toc) && /Türstopper fehlt \(2\)/.test(toc) && /Nicht prüfbar \(1\)/.test(toc), 'Inhaltsliste mit Abschnitten');
  check(new RegExp(`Sammelmappe · Seite ${startOf[102]} von ${pages.length}`).test(pages[startOf[102] - 1]), 'durchgehende Seitenzahl auf Protokollseiten');
  check(/Seite 1 von \d+/.test(cover), 'Deckblatt mit Seitenzahl');

  step('Protokoll: Abnahme-Zeile, Nachweis je Elementart, Stammdaten');
  const protoOf = (n) => {
    const i = startOf[n] - 1;
    const next = Math.min(...Object.values(startOf).filter((x) => x > startOf[n]), pages.length + 1) - 1;
    // Zwischenblatt vor der nächsten Gruppe gehört nicht dazu
    return pages.slice(i, next).filter((t) => !/Mangelgruppe|^\s*Nicht prüfbar\s*$/m.test(t)).join('\n');
  };
  const p102 = protoOf(102);
  check(/Abnahme durch den Auftraggeber/.test(p102) && /Name\s+Datum\s+Unterschrift/.test(p102), 'Abnahme durch den Auftraggeber (Name, Datum, Unterschrift)');
  check(/Befähigungsnachweis/.test(p102) && /DGWZ-4711/.test(p102) && !/ECO-2022-17/.test(p102), 'Tür: Sachkunde (DGWZ)');
  const pf = protoOf('fsa');
  check(/ECO-2022-17/.test(pf) && /am Prüfdatum abgelaufen/.test(pf), 'Feststellanlage: Hersteller-Zertifikat, abgelaufen vermerkt');
  const p101 = protoOf(101);
  if (selAttr) check(/Stammdaten/.test(p101) && p101.includes(selAttr.options[0]), `Stammdaten generisch (${selAttr.label}: ${selAttr.options[0]})`);
  check(!/Stammdaten/.test(protoOf(102)), 'ohne gesetzte Stammdaten kein leerer Block');
  pdfPng(mappe.file, 1, 'mappe-deckblatt');
  pdfPng(mappe.file, 2, 'mappe-inhalt');
  const abn = pages.findIndex((t, i) => i >= startOf[102] - 1 && /Abnahme durch den Auftraggeber/.test(t));
  pdfPng(mappe.file, startOf[102], 'protokoll-neu');
  if (abn + 1 !== startOf[102]) pdfPng(mappe.file, abn + 1, 'protokoll-neu-abnahme');
  pdfPng(mappe.file, startOf[102] - 1, 'mappe-zwischenblatt');

  step('Berichte: ZIP mit Ident_Datum_Art.pdf, Sammelmappe im Archiv');
  await p.goto(BASE + '/berichte');
  await p.getByText('8 Prüfungen').first().waitFor();
  const zip = await download(p, () => p.getByRole('button', { name: 'Protokolle (ZIP)' }).click());
  const names = Object.keys(unzipSync(fs.readFileSync(zip.file)));
  check(names.length === 8, `ZIP mit 8 Protokollen (${names.length})`);
  for (const n of all) check(names.some((x) => new RegExp(`^${esc(code(n))}_\\d{4}-\\d{2}-\\d{2}_[^_]+\\.pdf$`).test(x)), `ZIP: ${code(n)}_Datum_Art.pdf (${names.join(' ')})`);
  check(names.find((x) => x.startsWith(code('fsa'))) !== names.find((x) => x.startsWith(code(101))), 'Tür und FSA mit eigenem Namen');
  const arch = (await api('/reports')).json;
  check(arch.some((x) => x.kind === 'mappe' && x.propertyId === prop.id), 'Sammelmappe im Berichtsarchiv');
  await p.getByRole('button', { name: 'Sammelmappe erzeugen' }).click();
  const dlg2 = p.getByRole('dialog');
  await dlg2.getByRole('combobox', { name: 'Objekt' }).waitFor();
  await dlg2.getByText('8 Protokolle im gewählten Zeitraum').waitFor();
  await dlg2.getByRole('tab', { name: 'Zeitraum' }).click();
  await dlg2.getByText('8 Protokolle im gewählten Zeitraum').waitFor();
  await dlg2.getByRole('combobox', { name: 'Elementart' }).selectOption('hold_open');
  await dlg2.getByText('1 Protokoll im gewählten Zeitraum').waitFor();
  const one = await download(p, () => dlg2.getByRole('button', { name: 'Mappe mit 1 Protokoll erzeugen' }).click());
  check(/^Sammelmappe_Hotel-Seeblick-Test_\d{4}-\d{2}-\d{2}_Feststellanlage\.pdf$/.test(one.name), `Dateiname mit Elementart (${one.name})`);
  const onePages = pdfPages(one.file);
  check(onePages.length >= 4 && /Mangelgruppe 1 \/ 1/.test(onePages.join('\n')), `Mappe nach Elementart und Zeitraum (${onePages.length} Seiten)`);
  await dlg2.getByRole('button', { name: 'Fertig' }).click();

  step('Angebot am Objekt (Endpunkt gemockt, falls Paket V fehlt), Regie, Excel, PDF');
  const real = await api(`/properties/${prop.id}/offer`);
  console.log(`  Endpunkt /properties/:id/offer: ${real.status === 200 ? 'vorhanden' : `fehlt (${real.status}) – Mock`}`);
  if (real.status === 200) check(Array.isArray(real.json?.lines) && Array.isArray(real.json?.unmapped) && typeof real.json?.net === 'number', 'echte Antwort hat die vereinbarte Form');
  const offer = {
    lines: [
      { serviceKey: 'S-STOP', title: 'Türstopper liefern und montieren', unit: 'Stk', unitPrice: 17.5, quantity: 3, total: 52.5, doors: [code(102), code(103), code(104)], defects: ['d1', 'd2', 'd3'] },
      { serviceKey: 'S-BAND', title: 'Band nachstellen', unit: 'Stk', unitPrice: 24, quantity: 1, total: 24, doors: [code(104)], defects: ['d4'] },
    ],
    unmapped: [{ defectId: 'd5', title: 'Prüfbuch fehlt', door: code('fsa') }],
    net: 76.5,
  };
  const SERVICES = [
    { key: '1.007', title: 'An- und Abfahrt Zone 1', unit: 'Termin', price: 85, kind: 'regie' },
    { key: '1.006', title: 'Wartezeit Servicetechniker', unit: 'h', price: 85, kind: 'regie' },
  ];
  const mock = async (pg) => {
    await pg.route(`**/api/properties/${prop.id}/offer*`, (route) => route.fulfill({ json: offer }));
    await pg.route('**/api/catalog', async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      route.fulfill({ response: res, json: { ...j, services: Array.isArray(j.services) && j.services.length ? j.services : SERVICES } });
    });
  };
  await mock(p);
  await p.goto(BASE + `/objekte/${prop.id}?tab=angebot`);
  await p.locator('[data-offer-line]').first().waitFor();
  check((await p.locator('[data-offer-line]').count()) === 2, 'zwei Positionen');
  check((await p.locator('[data-offer-line="S-STOP"]').innerText()).includes(code(103)), 'Türnummern an der Position');
  check(/Prüfbuch fehlt/.test(await p.getByText('ohne Leistung').locator('..').innerText()) && (await p.locator('[data-offer-unmapped]').isVisible()), 'Hinweis auf nicht zugeordnete Mängel');
  check(/der Etage EG/.test(await p.locator('[data-offer-series]').innerText()), `Serien-Vorschlag (${await p.locator('[data-offer-series]').innerText()})`);
  check(/76,50\s€/.test(await p.locator('[data-offer-net]').innerText()), 'Summe netto 76,50 €');
  await p.getByRole('button', { name: 'Regie / Anfahrt hinzufügen' }).click();
  const add = p.getByRole('form', { name: 'Position hinzufügen' });
  await add.getByRole('combobox').first().selectOption('1.007');
  await add.getByRole('button', { name: 'Hinzufügen' }).click();
  await p.locator('[data-offer-line="1.007"]').waitFor();
  check(/161,50\s€/.test(await p.locator('[data-offer-net]').innerText()), 'mit Anfahrt 161,50 €');
  await p.reload();
  await p.locator('[data-offer-line="1.007"]').waitFor();
  check(/161,50\s€/.test(await p.locator('[data-offer-net]').innerText()), 'Regie bleibt auf diesem Gerät gemerkt');
  await shot(p, 'angebot', { fullPage: true });
  const xl = await download(p, () => p.getByRole('button', { name: 'Excel' }).click());
  check(/^Angebotsliste_Hotel-Seeblick-Test_\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name), `Excel-Dateiname (${xl.name})`);
  const xz = unzipSync(fs.readFileSync(xl.file));
  const strings = strFromU8(xz['xl/sharedStrings.xml'] ?? new Uint8Array());
  const sheetXml = strFromU8(xz['xl/worksheets/sheet1.xml']);
  check(strings.includes('An- und Abfahrt Zone 1') && strings.includes('Türstopper liefern und montieren') && strings.includes(code(103)) && strings.includes('Nicht zugeordnete Mängel'), 'Excel: Positionen, Türen, nicht Zugeordnetes');
  check(/<v>161\.5<\/v>/.test(sheetXml), 'Excel: Summe als Zahl');
  const op = await download(p, () => p.getByRole('button', { name: 'PDF' }).click());
  const ot = pdfText(op.file);
  check(/Angebotsliste/.test(ot) && /Summe netto\s+161,50/.test(ot) && /Nicht zugeordnete Mängel/.test(ot) && /Prüfbuch fehlt/.test(ot) && /Sammelposition/.test(ot), 'Angebots-PDF mit Summe, Hinweis und Vorschlag');
  pdfPng(op.file, 1, 'angebot-pdf');
  await p.locator('[data-offer-line="1.007"]').getByRole('button', { name: /entfernen/ }).click();
  check(/76,50\s€/.test(await p.locator('[data-offer-net]').innerText()), 'Regie wieder entfernt');

  step('MCP report(what: "offer")');
  const key = (await api('/account/api-keys', { data: { name: 'Claude', scope: 'read', expiresInDays: 1 } })).json.key;
  const t = await mcp(key, 'report', { what: 'offer', property: P });
  if (real.status === 200) check(!t.isError && /Angebotsliste „Hotel Seeblick \(Test\)“/.test(t.text) && /Summe netto/.test(t.text), `MCP-Angebotsliste (${t.text.slice(0, 160)})`);
  else check(t.isError && !/Interner Fehler/.test(t.text), `MCP ohne Endpunkt: saubere Meldung (${t.text.slice(0, 120)})`);
  const t2 = await mcp(key, 'report', { what: 'offer' });
  check(t2.isError && /Objekt angeben/.test(t2.text), 'MCP-Angebotsliste ohne Objekt → Hinweis');
  check(!(await mcp(key, 'report', {})).isError, 'MCP-Kennzahlen unverändert');

  step('Nachweise: Admin pflegt für den Prüfer (Team)');
  await p.goto(BASE + '/einstellungen/team');
  await p.getByRole('button', { name: 'Zugriff und Status von Piet Prüfer' }).click();
  const md = p.getByRole('dialog');
  await md.getByText('Befähigungsnachweise').waitFor();
  await md.getByText('Für Piet Prüfer ist noch kein Nachweis hinterlegt.').waitFor();
  await md.getByRole('button', { name: 'Nachweis hinzufügen' }).click();
  const nf = md.getByRole('form', { name: 'Neuer Nachweis' });
  await nf.getByLabel('Bezeichnung').fill('Befähigte Person für Brandschutztüren');
  await nf.getByLabel('Aussteller').fill('DGWZ');
  await nf.getByLabel('Nummer').fill('DGWZ-0815');
  await nf.getByRole('checkbox', { name: doorDef.label }).check();
  await nf.getByRole('button', { name: 'Hinzufügen' }).click();
  await md.getByText('DGWZ-0815', { exact: false }).waitFor();
  await shot(p, 'nachweise-team');
  await md.getByRole('button', { name: 'Abbrechen' }).click();
  const pc = (await papi('/credentials?userId=' + pietId)).json;
  check(pc.length === 1 && pc[0].number === 'DGWZ-0815' && pc[0].categories.join() === 'fire_door', 'Nachweis des Prüfers gespeichert');

  step('Prüfer: eigene Nachweise im Konto (390 px), fremde nicht änderbar');
  await m.goto(BASE + '/einstellungen?tab=profile#nachweise');
  const own = m.locator('[data-credentials]');
  await own.getByText('DGWZ-0815', { exact: false }).waitFor();
  await own.getByRole('button', { name: 'Nachweis hinzufügen' }).click();
  const of = own.getByRole('form', { name: 'Neuer Nachweis' });
  await of.getByLabel('Art').selectOption('manufacturer');
  await of.getByLabel('Aussteller').fill('GEZE');
  await of.getByLabel('Nummer').fill('GZ-1');
  await of.getByLabel('Gültig bis').fill('2025-01-31');
  await of.getByRole('checkbox', { name: 'Feststellanlage' }).check();
  await of.getByRole('button', { name: 'Hinzufügen' }).click();
  await own.getByText('abgelaufen am 31.01.2025').waitFor();
  check((await overflow(m)) <= 0, `kein Überlauf: Konto mit Nachweisen (${await overflow(m)})`);
  await m.waitForFunction(() => !document.querySelector('[aria-live=polite] > .bg-ink'), null, { timeout: 6000 }).catch(() => {});
  await m.locator('#nachweise').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await m.evaluate(() => window.scrollBy(0, -70));
  await shot(m, 'nachweise-konto', { fullPage: false });
  const ownerCred = (await api('/credentials?userId=' + ownerId)).json[0];
  check((await papi(`/credentials/${ownerCred.id}`, { method: 'PUT', data: { kind: 'other' } })).status === 403, 'Prüfer ändert keinen Nachweis der Inhaberin');
  check((await papi('/credentials', { data: { kind: 'other', userId: ownerId } })).status === 403, 'Prüfer legt keinen Nachweis für andere an');
  check((await lapi('/credentials', { data: { kind: 'other' } })).status === 403, 'Lesezugriff legt keinen Nachweis an');

  step('Abgelaufener Nachweis → Hinweis beim Unterschreiben (Prüfer, 390 px)');
  await ready(FSA.id, {}, papi);
  await m.goto(BASE + '/unterschreiben');
  await m.locator('[data-credential-hint]').waitFor();
  check(/Feststellanlage: abgelaufen/.test(await m.locator('[data-credential-hint]').innerText()), 'Hinweis „Feststellanlage: abgelaufen“');
  check(await m.getByRole('button', { name: 'Unterschreiben' }).isEnabled(), 'kein Blocker: Unterschreiben bleibt möglich');
  check((await overflow(m)) <= 0, 'kein Überlauf: Unterschreiben mit Hinweis');

  step('390 px: Angebot und Sammelmappe-Dialog');
  await mock(m);
  await m.goto(BASE + `/objekte/${prop.id}?tab=angebot`);
  await m.locator('[data-offer-line]').first().waitFor();
  check((await overflow(m)) <= 0, `kein Überlauf: Angebot (${await overflow(m)})`);
  await shot(m, 'm-angebot', { fullPage: true });
  await m.getByRole('button', { name: 'Weitere Aktionen zum Objekt' }).click();
  await m.getByRole('menuitem', { name: 'Sammelmappe' }).click();
  await m.getByRole('dialog').getByText(/Protokolle im gewählten Zeitraum/).waitFor();
  check((await overflow(m)) <= 0, 'kein Überlauf: Sammelmappe-Dialog');
  await shot(m, 'm-sammelmappe-dialog');

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ').slice(0, 400)})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
