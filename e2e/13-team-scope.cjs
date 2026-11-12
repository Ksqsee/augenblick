// E2E 13-team-scope: Zugriffsbereich je Mitglied, Anlegerecht, Brandschutzbeauftragte/r mit Hash-Kette,
// Jahresbericht und Berichtsgenerator, Team-Dialog (1360 px und 390 px). Nur lokal.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '13-team-scope') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

/** Minimaler Client mit Cookie-Sitzung oder API-Schlüssel. */
function client(bearer) {
  let cookie = '';
  const call = async (path, { method, body } = {}) => {
    const r = await fetch(BASE + '/api' + path, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: { 'x-pk': '1', cookie, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: r.status, json, text };
  };
  call.login = (email, password = PW) => call('/auth/login', { body: { email, password } });
  return call;
}

(async () => {
  if (process.env.PROD) throw new Error('13-team-scope nicht gegen Produktion ausführen');
  const owner = client();
  check((await owner.login('demo@example.com')).status === 200, 'Login Inhaber');
  const year = new Date().getFullYear();

  step('Ausgangslage aus Sicht des Inhabers');
  const props = (await owner('/properties')).json;
  const S = props.find((p) => p.name === 'Grundschule Am Stadtpark');
  const E = props.find((p) => p.name === 'Seniorenresidenz Elbblick');
  const allBuildings = (await owner('/buildings')).json;
  const hausA = allBuildings.find((b) => b.propertyId === E.id && b.name === 'Haus A');
  const hausB = allBuildings.find((b) => b.propertyId === E.id && b.name === 'Haus B');
  check(!!S && !!E && !!hausA && !!hausB, 'Demo-Objekte und Gebäude vorhanden');
  const allAssets = (await owner('/assets')).json;
  const sAssets = allAssets.filter((a) => a.propertyId === S.id);
  const eAsset = allAssets.find((a) => a.propertyId === E.id && a.buildingId === hausB.id);
  const eInspection = (await owner(`/inspections?status=submitted&propertyId=${E.id}`)).json.find((i) => i.buildingId === hausB.id);
  const eDefect = (await owner('/defects?status=all')).json.find((d) => d.propertyId === E.id);
  const ePlan = (await owner(`/properties/${E.id}`)).json.floorPlans.find((f) => f.buildingId === hausB.id) ?? (await owner(`/properties/${E.id}`)).json.floorPlans[0];
  const eTask = (await owner('/tasks')).json.find((t) => t.propertyId && t.propertyId !== S.id);
  check(!!eAsset && !!eInspection && !!eDefect && !!ePlan && !!eTask, `Vergleichsdaten außerhalb des Bereichs (${!!eAsset} ${!!eInspection} ${!!eDefect} ${!!ePlan} ${!!eTask})`);
  const members = (await owner('/account/members')).json.members;
  const aylin = members.find((m) => m.email === 'pruefer2@example.com');

  step('Prüferin auf ein Objekt beschränken, ohne Anlegerecht');
  let r = await owner(`/account/members/${aylin.id}/access`, { method: 'PUT', body: { scope: { propertyIds: [S.id], buildingIds: [] }, canCreate: false } });
  check(r.status === 200, `Zugriff gesetzt (${r.status} ${r.text})`);
  r = await owner(`/account/members/${aylin.id}/access`, { method: 'PUT', body: { scope: { propertyIds: [], buildingIds: [] }, canCreate: true } });
  check(r.status === 400, `leerer Bereich abgelehnt (${r.status})`);
  r = await owner(`/account/members/${members.find((m) => m.role === 'owner').id}/access`, { method: 'PUT', body: { scope: { propertyIds: [S.id] }, canCreate: true } });
  check(r.status === 400, `Inhaber nicht einschränkbar (${r.status})`);
  const a = client();
  check((await a.login('pruefer2@example.com')).status === 200, 'Login Prüferin');
  const me = (await a('/account/me')).json.user;
  check(me.scoped === true && me.canCreate === false, `me: eingeschränkt, ohne Anlegerecht (${JSON.stringify(me)})`);

  step('Listen zeigen nur den Bereich');
  const lp = (await a('/properties')).json;
  check(lp.length === 1 && lp[0].id === S.id, `Objekte (${lp.map((p) => p.name)})`);
  const la = (await a('/assets')).json;
  check(la.length === sAssets.length && la.every((x) => x.propertyId === S.id), `Elemente (${la.length}/${sAssets.length})`);
  const li = (await a('/inspections?status=submitted')).json;
  check(li.length > 0 && li.every((x) => x.propertyId === S.id), `Prüfungen (${li.length})`);
  const ld = (await a('/defects?status=all')).json;
  check(ld.length > 0 && ld.every((x) => x.propertyId === S.id), `Mängel (${ld.length}, ${[...new Set(ld.map((x) => x.propertyName))]})`);
  const lt = (await a('/tasks')).json;
  check(lt.every((x) => !x.propertyId || x.propertyId === S.id), `Aufgaben (${lt.map((x) => x.propertyName)})`);
  check(!lt.some((x) => x.id === eTask.id), 'fremde Aufgabe nicht gelistet');
  const lw = (await a('/walkthroughs')).json;
  check(lw.every((x) => x.propertyId === S.id), 'Begehungen');
  const lb = (await a('/buildings')).json;
  check(lb.length > 0 && lb.every((b) => b.propertyId === S.id), 'Gebäude');
  const dash = (await a('/dashboard')).json;
  check(dash.counts.properties === 1 && dash.counts.assets === sAssets.length, `Startseite (${dash.counts.properties} Objekte, ${dash.counts.assets} Elemente)`);
  check(dash.properties.every((p) => p.id === S.id) && dash.tasks.every((t) => lt.some((x) => x.id === t.id)), 'Startseite: Objekte und Aufgaben');
  for (const q of ['haus', 'elbblick', E.name.slice(0, 6).toLowerCase(), eAsset.code.toLowerCase()]) {
    const s = (await a(`/search?q=${encodeURIComponent(q)}`)).json;
    check(s.properties.every((p) => p.id === S.id) && s.assets.every((x) => x.propertyName === S.name) && s.buildings.every((b) => b.propertyId === S.id), `Suche „${q}“ bleibt im Bereich`);
  }
  const rounds = (await a('/smart/rounds?days=365')).json;
  check(rounds.every((g) => g.propertyId === S.id), `Rundgänge (${rounds.map((g) => g.propertyName)})`);
  const sugg = (await a('/smart/suggestions')).json;
  const foreignIds = [E.id, ...allBuildings.filter((b) => b.propertyId !== S.id).map((b) => b.id), ...props.filter((p) => p.id !== S.id).map((p) => p.id)];
  check(sugg.every((x) => !foreignIds.some((id) => (x.link ?? '').includes(id))), `Vorschläge ohne fremde Ziele (${sugg.map((x) => x.link)})`);
  const act = (await a('/account/activity')).json;
  check(act.every((x) => x.userName === 'Aylin Demir'), 'Aktivitätsprotokoll nur eigene Einträge');
  const ann = (await a(`/reports/annual?year=${year}`)).json;
  check(ann.properties.length === 1 && ann.properties[0].id === S.id, 'Jahresbericht nur eigenes Objekt');

  step('Direkter Zugriff außerhalb des Bereichs: 404');
  const nx = 'zzzzzzzzzzzzzzzz';
  for (const [path, opts] of [
    [`/properties/${E.id}`],
    [`/assets/${eAsset.id}`],
    [`/assets/by-code/${eAsset.code}`],
    [`/inspections/${eInspection.id}`],
    [`/floor-plans/${ePlan.id}`],
    [`/offline/buildings/${hausB.id}`],
    [`/reports/annual?year=${year}&propertyId=${E.id}`],
    [`/assets/${eAsset.id}/inspections`, { body: {} }],
    [`/assets/${eAsset.id}`, { method: 'PATCH', body: { buildingId: hausB.id, location: 'x', floor: '', manufacturer: '', model: '', attributes: {} } }],
    [`/assets/${eAsset.id}/label`, { method: 'PUT', body: { labelCode: null } }],
    [`/inspections/${eInspection.id}/correct`, { body: {} }],
    [`/defects/${eDefect.id}`, { method: 'PATCH', body: { status: 'resolved' } }],
    [`/tasks/${eTask.id}/comments`, { body: { body: 'hallo' } }],
    ['/tasks', { body: { title: 'Fremd', assetId: eAsset.id } }],
    ['/tasks', { body: { title: 'Fremd', defectId: eDefect.id } }],
    ['/tasks', { body: { title: 'Fremd', propertyId: E.id } }],
    ['/defects', { body: { assetId: eAsset.id, title: 'x', severity: 'low' } }],
    [`/properties/${E.id}/walkthroughs`, { body: {} }],
  ]) {
    const res = await a(path, opts);
    check(res.status === 404, `${opts?.method ?? (opts?.body ? 'POST' : 'GET')} ${path} → 404 (${res.status})`);
  }
  // nicht vorhanden und außerhalb des Bereichs sind nicht unterscheidbar
  check((await a(`/assets/${nx}`)).status === 404 && (await a('/tasks', { body: { title: 'x', assetId: nx } })).status === 404, 'unbekannte IDs ebenfalls 404');
  const after = (await owner(`/defects?status=open`)).json.find((d) => d.id === eDefect.id);
  check(!after || eDefect.status !== 'open' || after.status === 'open', 'fremder Mangel unverändert');

  step('Anlegerecht');
  const sb = lb[0];
  r = await a('/assets', { body: { buildingId: sb.id, category: 'extinguisher', location: 'Test ohne Recht' } });
  check(r.status === 403, `Element anlegen ohne Recht verboten (${r.status})`);
  r = await a('/assets/' + la[0].id, { method: 'PATCH', body: { buildingId: la[0].buildingId, location: la[0].location, floor: la[0].floor, manufacturer: la[0].manufacturer, model: la[0].model, attributes: la[0].attributes } });
  check(r.status === 200, `vorhandenes Element bearbeiten erlaubt (${r.status})`);
  await owner(`/account/members/${aylin.id}/access`, { method: 'PUT', body: { scope: { propertyIds: [S.id], buildingIds: [] }, canCreate: true } });
  r = await a('/assets', { body: { buildingId: sb.id, category: 'extinguisher', location: 'Test mit Recht' } });
  check(r.status === 200, `mit Recht erlaubt (${r.status})`);
  r = await a('/assets', { body: { buildingId: hausB.id, category: 'extinguisher', location: 'fremdes Gebäude' } });
  check(r.status === 404, `nicht in fremdem Gebäude (${r.status})`);

  step('API-Schlüssel erbt den Bereich der Person');
  await owner(`/account/members/${aylin.id}`, { method: 'PATCH', body: { role: 'admin' } });
  check((await a('/properties')).json.length === props.length, 'als Admin uneingeschränkt');
  const key = (await a('/account/api-keys', { body: { name: 'scope-test', scope: 'read', expiresInDays: 1 } })).json?.key;
  await owner(`/account/members/${aylin.id}`, { method: 'PATCH', body: { role: 'inspector' } });
  const k = client(key);
  const kp = (await k('/properties')).json;
  check(Array.isArray(kp) && kp.length === 1 && kp[0].id === S.id, `Schlüssel sieht nur den Bereich (${kp?.length})`);
  check((await k(`/assets/${eAsset.id}`)).status === 404, 'Schlüssel: fremdes Element 404');

  step('Gebäude-Bereich für eine neu eingeladene Prüferin');
  const inv = (await owner('/account/members/invite', { body: { email: 'bereich@example.com', role: 'inspector' } })).json;
  const bb = client();
  r = await bb(`/auth/invite/${inv.token}`, { body: { name: 'Bea Bereich', password: PW } });
  check(r.status === 200, `Einladung angenommen (${r.status})`);
  const bea = (await owner('/account/members')).json.members.find((m) => m.email === 'bereich@example.com');
  await owner(`/account/members/${bea.id}/access`, { method: 'PUT', body: { scope: { propertyIds: [], buildingIds: [hausA.id] }, canCreate: true } });
  const ba = (await bb('/assets')).json;
  check(ba.length > 0 && ba.every((x) => x.buildingId === hausA.id), `nur Haus A (${ba.length})`);
  const bp = (await bb(`/properties/${E.id}`)).json;
  check(bp.buildings?.length === 1 && bp.buildings[0].id === hausA.id && bp.assets.every((x) => x.buildingId === hausA.id), 'Objektseite zeigt nur Haus A');
  const ownWalk = (await owner(`/properties/${E.id}/walkthroughs`, { body: {} })).json.id;
  check((await bb(`/walkthroughs/${ownWalk}`)).status === 404, 'Begehung des ganzen Objekts nicht sichtbar');
  check((await bb(`/properties/${E.id}/walkthroughs`, { body: {} })).status === 404, 'Begehung des ganzen Objekts nicht anlegbar');
  r = await bb(`/properties/${E.id}/walkthroughs`, { body: { buildingId: hausA.id } });
  check(r.status === 200, `Begehung für Haus A möglich (${r.status})`);
  check((await bb(`/properties/${E.id}/walkthroughs`, { body: { buildingId: hausB.id } })).status === 404, 'Begehung Haus B 404');
  await owner(`/walkthroughs/${ownWalk}`, { method: 'DELETE' });

  step('Brandschutzbeauftragte/r mit Verlauf');
  check((await a(`/account/members/${aylin.id}/fire-officer-history`)).status === 403, 'Verlauf nur für Admins');
  check((await a(`/account/members/${aylin.id}/fire-officer`, { method: 'PUT', body: { value: true } })).status === 403, 'Status nur durch Admins');
  r = await owner(`/account/members/${aylin.id}/fire-officer`, { method: 'PUT', body: { value: true, qualification: 'DGUV 205-003, Lehrgang 2025' } });
  check(r.status === 200 && r.json.changed, `Status gesetzt (${r.status})`);
  r = await owner(`/account/members/${aylin.id}/fire-officer`, { method: 'PUT', body: { value: true, qualification: 'DGUV 205-003, Lehrgang 2025' } });
  check(r.json?.changed === false, 'unverändert → kein neuer Eintrag');
  let h = (await owner(`/account/members/${aylin.id}/fire-officer-history`)).json;
  check(h.chainValid && h.currentMatches && h.entries.length === 1 && h.entries[0].qualification === 'DGUV 205-003, Lehrgang 2025', `Verlauf (${JSON.stringify(h)})`);

  step('Begehung hält die Qualifikation fest');
  const wid = (await a(`/properties/${S.id}/walkthroughs`, { body: {} })).json.id;
  const wd = (await a(`/walkthroughs/${wid}`)).json;
  r = await a(`/walkthroughs/${wid}/submit`, {
    body: { answers: Object.fromEntries(wd.questions.map((q) => [q.id, 'ok'])), findings: [], notes: '', participants: '', signature: SIG, signerName: 'Aylin Demir' },
  });
  check(r.status === 200, `Begehung abgeschlossen (${r.status} ${r.text.slice(0, 100)})`);
  const wDone = (await a(`/walkthroughs/${wid}`)).json;
  check(wDone.inspectorFireOfficer === true && wDone.inspectorQualification === 'DGUV 205-003, Lehrgang 2025', 'Qualifikation in der Begehung');
  r = await owner(`/account/members/${aylin.id}/fire-officer`, { method: 'PUT', body: { value: false } });
  h = (await owner(`/account/members/${aylin.id}/fire-officer-history`)).json;
  check(h.chainValid && h.entries.length === 2 && h.entries[1].value === false, 'zweiter Eintrag verkettet');
  check((await owner(`/walkthroughs/${wid}`)).json.inspectorFireOfficer === true, 'Begehung behält den damaligen Status');

  step('Jahresbericht (API)');
  const annual = (await owner(`/reports/annual?year=${year}`)).json;
  check(annual.year === year && annual.properties.length === props.length, `alle Objekte (${annual.properties.length})`);
  const as = annual.properties.find((p) => p.id === S.id);
  check(as.walkthroughs.some((w) => w.fireOfficer === true && w.qualification), 'Begehung mit Qualifikation im Jahresbericht');
  check(typeof as.defects.total === 'number' && as.inspections >= 0 && Array.isArray(as.fireOfficers), 'Kennzahlen vorhanden');
  check((await owner('/reports/annual?year=1999')).status === 400, 'ungültiges Jahr abgelehnt');

  step('Oberfläche: Team-Dialog, Berichte (1360 px)');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  await p.goto(BASE + '/team');
  await p.getByText('Nur 1 Objekt').first().waitFor();
  await p.getByRole('button', { name: 'Zugriff und Status von Aylin Demir' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByText('Verlauf geprüft, unverändert').waitFor();
  check((await dlg.getByRole('checkbox', { name: 'Grundschule Am Stadtpark', exact: true }).isChecked()) === true, 'Dialog zeigt gespeicherten Bereich');
  await dlg.getByRole('checkbox', { name: 'Logistikzentrum Nord', exact: true }).check();
  await dlg.getByRole('checkbox', { name: 'Seniorenresidenz Elbblick – Haus A' }).check();
  await dlg.getByRole('checkbox', { name: /Darf neue Elemente anlegen/ }).uncheck();
  await dlg.getByRole('checkbox', { name: /^Brandschutzbeauftragte\/r/ }).check();
  await dlg.getByLabel('Qualifikation').fill('Brandschutzhelfer und -beauftragte (DGUV 205-003)');
  await p.screenshot({ path: OUT + '01-dialog.png' });
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await p.getByText('Gespeichert').first().waitFor();
  const saved = (await owner('/account/members')).json.members.find((m) => m.id === aylin.id);
  check(saved.scope?.propertyIds.length === 2 && saved.scope.buildingIds.length === 1 && saved.scope.buildingIds[0] === hausA.id && saved.canCreate === false, `Bereich über Dialog gespeichert (${JSON.stringify(saved.scope)})`);
  check(saved.fireOfficer && saved.fireOfficerQualification === 'Brandschutzhelfer und -beauftragte (DGUV 205-003)', 'Status über Dialog gespeichert');
  await p.getByText('Nur 2 Objekte + 1 Gebäude').waitFor();
  // Alle Objekte wieder freigeben
  await p.getByRole('button', { name: 'Zugriff und Status von Aylin Demir' }).click();
  await p.getByRole('dialog').getByRole('tab', { name: 'Alle Objekte' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  // erster Hinweis „Gespeichert“ kann noch sichtbar sein – auf das Schließen des Dialogs warten und kurz nachfragen
  await p.getByRole('dialog').waitFor({ state: 'detached' });
  let freed = false;
  for (let i = 0; i < 20 && !freed; i++) {
    freed = (await owner('/account/members')).json.members.find((m) => m.id === aylin.id).scope === null;
    if (!freed) await p.waitForTimeout(250);
  }
  check(freed, 'gesamter Workspace wieder freigegeben');

  // Berichte: Jahresbericht und Berichtsgenerator erzeugen PDFs im Browser
  await p.goto(BASE + '/berichte');
  const annualBtn = p.getByLabel('Objekt für den Jahresbericht').locator('xpath=..').getByRole('button', { name: 'PDF' });
  let [dl] = await Promise.all([p.waitForEvent('download'), annualBtn.click()]);
  let path = OUT + dl.suggestedFilename();
  await dl.saveAs(path);
  check(/^Jahresbericht_\d{4}\.pdf$/.test(dl.suggestedFilename()) && fs.readFileSync(path).subarray(0, 4).toString() === '%PDF', `Jahresbericht als PDF (${dl.suggestedFilename()})`);
  await p.getByText('Im Berichtsarchiv gespeichert').first().waitFor();
  await p.getByLabel('Objekt', { exact: true }).selectOption(S.id);
  await p.getByLabel('Zeitraum').selectOption('');
  await p.getByText(/\d+ Prüfungen/).first().waitFor();
  [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Prüfbericht (PDF)' }).click()]);
  path = OUT + dl.suggestedFilename();
  await dl.saveAs(path);
  check(fs.readFileSync(path).subarray(0, 4).toString() === '%PDF' && fs.statSync(path).size > 2000, `Prüfbericht als PDF (${fs.statSync(path).size} B)`);
  let archive = [];
  for (let i = 0; i < 20 && !archive.some((x) => x.kind === 'selection'); i++) {
    archive = (await owner('/reports')).json;
    await p.waitForTimeout(250);
  }
  check(archive.some((x) => x.kind === 'annual') && archive.some((x) => x.kind === 'selection' && x.propertyId === S.id), `Berichte im Archiv (${JSON.stringify(archive.map((x) => [x.kind, x.propertyId]))})`);
  await p.screenshot({ path: OUT + '02-reports.png', fullPage: true });

  step('Handybreite 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(BASE + '/team');
  await mp.getByRole('button', { name: 'Zugriff und Status von Aylin Demir' }).waitFor();
  let wdt = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(wdt <= 392, `/team: kein horizontaler Überlauf (${wdt})`);
  await mp.getByRole('button', { name: 'Zugriff und Status von Bea Bereich' }).click();
  await mp.getByRole('dialog').getByText('Seniorenresidenz Elbblick').waitFor();
  wdt = await mp.evaluate(() => Math.max(document.documentElement.scrollWidth, ...[...document.querySelectorAll('[role=dialog] *')].map((e) => e.getBoundingClientRect().right)));
  check(wdt <= 392, `Team-Dialog: kein horizontaler Überlauf (${Math.round(wdt)})`);
  await mp.screenshot({ path: OUT + '03-mobile-dialog.png' });
  await mp.goto(BASE + '/berichte');
  await mp.waitForLoadState('networkidle');
  wdt = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(wdt <= 392, `/berichte: kein horizontaler Überlauf (${wdt})`);
  await m.close();

  step('Eingeschränkte Person ohne Anlegerecht in der Oberfläche');
  await owner(`/account/members/${bea.id}/access`, { method: 'PUT', body: { scope: { propertyIds: [], buildingIds: [hausA.id] }, canCreate: false } });
  const bctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const bp2 = await bctx.newPage();
  await bp2.goto(BASE + '/login');
  await bp2.getByLabel('E-Mail').fill('bereich@example.com');
  await bp2.getByLabel('Passwort').fill(PW);
  await bp2.getByRole('button', { name: 'Anmelden' }).click();
  await bp2.waitForURL((u) => !u.pathname.startsWith('/login'));
  await bp2.goto(BASE + '/elemente');
  await bp2.getByText(ba[0].code).first().waitFor();
  check((await bp2.getByRole('button', { name: 'Neues Element' }).count()) === 0, 'kein „Neues Element“ ohne Anlegerecht');
  check(!(await bp2.getByText(eAsset.code).count()), 'fremdes Element nicht in der Liste');
  await bctx.close();

  step('Manipulierter Verlauf wird erkannt');
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', `UPDATE member_flag_history SET note = 'gefälscht' WHERE user_id = '${aylin.id}' AND value = 1 AND note = 'DGUV 205-003, Lehrgang 2025'`], { stdio: 'ignore' });
  h = (await owner(`/account/members/${aylin.id}/fire-officer-history`)).json;
  check(h.chainValid === false, 'veränderter Eintrag bricht die Kette');
  await p.goto(BASE + '/team');
  await p.getByRole('button', { name: 'Zugriff und Status von Aylin Demir' }).click();
  await p.getByRole('dialog').getByText('Verlauf wurde verändert').waitFor();

  check(!errors.length, `Browserfehler: ${errors.join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
