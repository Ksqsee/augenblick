// E2E 33-ansagen (Plan v7, Paket W „Ansagen und Rohdiktat“): der Ablauf des Inhabers am Handy (390 px) –
// Objekt gewählt → „Tür 354 Typ <Katalogtyp>“ → Tür angelegt mit Stammdaten → Abweichung als Text → Rest in Ordnung →
// bereit zur Unterschrift; „Tür 355 gleicher Typ“; Befund gleich in der Ansage; unbekannter Typ (allgemeine
// Checkliste, Rohnotiz); falsche Art („Nummer 400 ist ein Feuerlöscher“); dasselbe ohne Netz mit Warteschlange und
// späterer Übertragung; Rohnotiz in der Prüfung und beim Unterschreiben sichtbar, über MCP `list raw_notes` lesbar,
// `inspect` markiert als ausgewertet; Tür per MCP ansagen (number + type), mehrdeutiger Typ; Checkliste je Typ zeigt
// nur zutreffende Punkte (zwei Typen verglichen), PDF eine Seite, kein Überlauf; Archivieren über MCP nur mit
// Admin-Verbindung (herabgestufte Admin-Person → abgelehnt). Tipps und Eingaben je Tür werden gezählt und geprüft.
// Eigener, frischer Workspace. Bilder nach docs/design/v3/v7 mit SHOTS=1. Nur lokal.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, '.out', '33-ansagen') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS ? path.join(__dirname, '..', 'docs', 'design', 'v3', 'v7') + '/' : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const step = (m) => console.log('·', m);

let rpcId = 0;
async function mcp(key, name, args = {}) {
  const r = await fetch(BASE + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
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
  return { isError: res?.isError, data, text: res?.content?.[0]?.text ?? j?.error?.message ?? '' };
}

/** Tipps und Eingaben je Tür (Abnahme: zählen und festhalten). */
const counts = {};
let current = null;
const door = (name) => {
  current = name;
  counts[name] = { taps: 0, inputs: 0 };
};
const tap = async (loc) => {
  counts[current].taps++;
  await loc.click();
};
const input = async (loc, text) => {
  counts[current].inputs++;
  await loc.fill(text);
};
const enter = async (loc) => {
  counts[current].taps++;
  await loc.press('Enter');
};

(async () => {
  if (process.env.PROD) throw new Error('33-ansagen nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage();
  global.__page = p;
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 409|status of 503|net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text()) && errors.push('console ' + m.text()));
  const api = async (pth, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + pth, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const noOverflow = async (what) => {
    const over = await overflow();
    check(over <= 0, `kein Überlauf ${what} (${over}px)`);
  };
  const shot = async (name, at) => {
    if (at) await at.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {});
    await p.waitForFunction(() => !document.querySelector('[aria-live=polite] > .bg-ink'), null, { timeout: 6000 }).catch(() => {});
    await p.waitForTimeout(250);
    const opts = { fullPage: !at };
    await p.screenshot({ path: OUT + name + '.png', ...opts });
    if (SHOTS) await p.screenshot({ path: SHOTS + name + '.png', ...opts });
  };

  step('Workspace „Hotel Seeblick (Test)“, zwei Türtypen im Katalog, Schlüssel für Claude');
  await p.goto(BASE + '/login');
  const stamp = Date.now();
  let r = await api('/auth/register', { data: { company: 'Seeblick Wartung GmbH', name: 'Kerim Seehafer', email: `kerim${stamp}@example.com`, password: 'sicheres-passwort-1' } });
  check(r.status === 200, `registriert (${r.status})`);
  const prop = (await api('/properties', { data: { name: 'Hotel Seeblick (Test)', address: 'Am Hafen 1', withBuilding: true } })).json;
  const building = (await api(`/properties/${prop.id}`)).json.buildings[0];
  // Bedingungen der Tür-Prüfpunkte (wie sie der Katalog gerade liefert – Paket V ordnet sie neu): Typ A erfüllt keine,
  // Typ B alle. Über Schlüssel, nicht über Bezeichnungen.
  const cats = (await api('/categories')).json;
  const doorCat = cats.find((c) => c.key === 'fire_door');
  const main = doorCat.schedulesEffective.find((s) => s.key === 'main');
  const conds = main.checkpoints.filter((c) => c.appliesIf).map((c) => c.appliesIf);
  check(conds.length > 0, `Tür-Prüfpunkte mit Bedingung (${conds.length})`);
  const otherValue = (cond) => {
    if (typeof cond.equals === 'boolean') return !cond.equals;
    const f = doorCat.attributes.find((a) => a.key === cond.attr);
    return (f?.options ?? []).find((o) => o !== cond.equals) ?? `kein ${cond.equals}`;
  };
  const defaultsA = {};
  const defaultsB = {};
  for (const c of conds) {
    if (defaultsA[c.attr] === undefined) defaultsA[c.attr] = otherValue(c);
    defaultsB[c.attr] = c.equals;
  }
  const pA = (await api('/catalog/products', { data: { manufacturer: 'Westag + Getalit', model: 'SK32', category: 'fire_door', defaults: defaultsA, approval: '' } })).json;
  const pB = (await api('/catalog/products', { data: { manufacturer: 'Novoferm', model: 'Premio T30-RS', category: 'fire_door', defaults: defaultsB, approval: 'Z-6.20-2205' } })).json;
  const pC = (await api('/catalog/products', { data: { manufacturer: 'Novoferm', model: 'Premio T90-RS', category: 'fire_door', defaults: defaultsB, approval: 'Z-6.20-2221' } })).json;
  check(pA?.id && pB?.id && pC?.id, 'drei Katalog-Typen angelegt');
  const key = (await api('/account/api-keys', { data: { name: 'Claude', scope: 'write', expiresInDays: 1 } })).json.key;
  // Feuerlöscher mit Nummer 400 (für den Widerspruch „Tür 400“)
  const ext = (await api('/assets', { data: { buildingId: building.id, category: 'extinguisher', number: 400, location: 'Flur' } })).json;
  const allCps = main.checkpoints.length;
  const plainCps = main.checkpoints.filter((c) => !c.appliesIf).length;

  const assetByNumber = async (n) => (await api(`/properties/${prop.id}`)).json.assets.find((a) => a.number === n);
  const readyList = async () => (await api('/inspections?status=ready')).json;

  step('Prüfen (390 px): „Tür ansagen“ oben, Objekt ist gewählt');
  await p.goto(BASE + '/pruefen');
  const card = p.getByRole('region', { name: 'Tür ansagen' });
  await card.waitFor();
  const field = card.getByRole('textbox', { name: 'Ansage' });
  await p.waitForFunction((id) => document.querySelector('select[aria-label="Objekt"]')?.value === id, prop.id, { timeout: 8000 }).catch(() => {});
  check((await card.getByLabel('Objekt').inputValue()) === prop.id, 'einziges Objekt vorgewählt');
  await noOverflow('(Prüfen mit Ansage)');

  step('Tür 354 Typ SK32 → angelegt mit Stammdaten → Abweichung → Rest i. O. → bereit');
  door('Tür 354 (neu, mit Abweichung)');
  await input(field, 'Tür dreihundertvierundfünfzig Typ SK 32');
  const preview = card.getByRole('status', { name: 'Vorschau der Ansage' });
  await preview.getByText('Tür 354 · Raum 354 · Westag + Getalit SK32 – wird angelegt').waitFor();
  await shot('m-ansage', card);
  await enter(field);
  await p.waitForURL(/\/pruefung\/[^/?]+\?ansage=1/);
  const insp354 = p.url().split('/pruefung/')[1].split('?')[0];
  const voice = p.getByRole('region', { name: 'Befund einsprechen' });
  await voice.waitFor();
  check(await voice.getByLabel('Eingesprochener Befund').isVisible(), 'Feld für die Abweichung ist gleich offen');
  const a354 = await assetByNumber(354);
  check(a354 && a354.manufacturer === 'Westag + Getalit' && a354.model === 'SK32' && a354.location === 'Raum 354', `Tür 354 angelegt mit Typ und Standort (${JSON.stringify(a354 && { m: a354.manufacturer, t: a354.model, l: a354.location })})`);
  check(a354 && Object.entries(defaultsA).every(([k, v]) => a354.attributes[k] === v), `Stammdaten aus dem Katalog-Typ (${JSON.stringify(a354?.attributes)})`);
  await input(voice.getByLabel('Eingesprochener Befund'), 'Dichtung oben beschädigt');
  await tap(p.getByRole('button', { name: 'Alles andere in Ordnung' }));
  await p.getByRole('region', { name: 'Diktat' }).or(p.locator('#diktat')).first().waitFor();
  const diktat = p.locator('#diktat');
  await diktat.getByText('„Dichtung oben beschädigt“').waitFor();
  check(await diktat.getByText('noch nicht ausgewertet').isVisible(), 'Rohnotiz: „noch nicht ausgewertet“ in der Prüfung');
  check((await diktat.innerText()).includes('1 Mangel'), 'grobe Einordnung des Regel-Parsers an der Rohnotiz');
  const readyBtn = p.getByRole('button', { name: 'Bereit · nächste Tür' });
  await readyBtn.waitFor();
  await noOverflow('(Prüfung aus der Ansage)');
  await shot('m-pruefung-rohnotiz', diktat);
  await tap(readyBtn);
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  check((await readyList()).some((i) => i.id === insp354 && i.rawPending === 1), 'Prüfung 354 bereit zur Unterschrift, 1 Rohnotiz offen');
  const d354 = (await api(`/inspections/${insp354}`)).json;
  check(d354.defects.length === 1 && d354.rawNotes?.[0]?.text === 'Dichtung oben beschädigt' && d354.rawNotes[0].source === 'app', 'Mangel eingetragen und Text roh gespeichert');
  check(Object.values(d354.answers).filter((x) => x === 'na').length === conds.length, `nicht Zutreffendes entfällt (${conds.length} Punkte)`);

  step('Tür 355, gleicher Typ – ohne Abweichung');
  door('Tür 355 (gleicher Typ, ohne Abweichung)');
  await field.waitFor();
  check(await field.evaluate((e) => document.activeElement === e), 'Ansagefeld hat nach „nächste Tür“ den Fokus');
  check((await card.innerText()).includes('Letzter Typ: Westag + Getalit SK32'), 'letzter Typ wird angezeigt');
  await input(field, 'Tür 355, gleicher Typ');
  await preview.getByText(/Tür 355 · Raum 355 · Westag \+ Getalit SK32/).waitFor();
  await enter(field);
  await p.waitForURL(/\/pruefung\/[^/?]+\?ansage=1/);
  await tap(p.getByRole('button', { name: 'Alles in Ordnung', exact: true }));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  check((await assetByNumber(355))?.model === 'SK32', 'Tür 355 mit dem letzten Typ');

  step('Tür 356 – Befund gleich in der Ansage');
  door('Tür 356 (Befund in der Ansage)');
  await input(field, 'Tür 356, gleicher Typ, Band lose');
  await preview.getByText(/Befund: „Band lose“/).waitFor();
  await enter(field);
  await p.waitForURL(/\/pruefung\/[^/?]+\?ansage=1/);
  check((await p.getByLabel('Eingesprochener Befund').inputValue()) === 'Band lose', 'Befund aus der Ansage vorbelegt');
  await tap(p.getByRole('button', { name: 'Alles andere in Ordnung' }));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);

  step('Unbekannter Typ: Tür 360 – allgemeine Checkliste, Typ als Rohnotiz');
  door('Tür 360 (Typ unbekannt)');
  await input(field, 'Tür 360 Typ Blechtür grün');
  await preview.getByText(/Typ unbekannt – allgemeine Checkliste – wird angelegt/).waitFor();
  await noOverflow('(lange Vorschau der Ansage)');
  await enter(field);
  await p.waitForURL(/\/pruefung\/[^/?]+\?ansage=1/);
  const insp360 = p.url().split('/pruefung/')[1].split('?')[0];
  const d360 = (await api(`/inspections/${insp360}`)).json;
  check(d360.checkpoints.length === plainCps && plainCps < allCps, `allgemeine Checkliste: ${d360.checkpoints.length} von ${allCps} Punkten (ohne Bedingung)`);
  check(d360.rawNotes?.[0]?.kind === 'type' && /Blechtür grün/.test(d360.rawNotes[0].text), 'gesprochener Typ als Rohnotiz');
  await p.locator('#diktat').getByText('noch nicht ausgewertet').waitFor();
  await tap(p.getByRole('button', { name: 'Alles in Ordnung', exact: true }));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  check((await assetByNumber(360))?.model === 'unbekannt', 'Tür 360 mit Typ „unbekannt“');

  step('Falsche Art: „Tür 400“ ist ein Feuerlöscher');
  door('Tür 400 (Widerspruch)');
  await input(field, 'Tür 400 Typ SK32');
  await preview.getByText(/Nummer 400 ist ein Feuerlöscher \(/).waitFor();
  await enter(field);
  await card.getByRole('alert').getByText(/Nummer 400 ist ein Feuerlöscher/).waitFor();
  check(p.url().includes('/pruefen'), 'keine Prüfung geöffnet');
  await field.fill('');

  step('Unterschreiben: „Diktat noch nicht ausgewertet“');
  await p.goto(BASE + '/unterschreiben');
  const row354 = p.locator(`[data-ready="${insp354}"]`);
  await row354.waitFor();
  check(await row354.getByText('Diktat noch nicht ausgewertet').isVisible(), 'Hinweis in der Unterschriften-Liste');
  check((await p.locator('[data-raw-pending]').count()) >= 2, 'auch Tür 356 und 360 mit offenem Diktat');
  await noOverflow('(Unterschreiben)');
  await shot('m-unterschreiben-diktat');

  step('MCP: briefing, list raw_notes, inspect markiert als ausgewertet');
  let m = await mcp(key, 'briefing');
  check(!m.isError && m.data?.dictation?.inspections >= 3, `briefing nennt Prüfungen mit unausgewertetem Diktat (${JSON.stringify(m.data?.dictation)})`);
  m = await mcp(key, 'list', { what: 'raw_notes', property: 'Hotel Seeblick' });
  const e354 = m.data?.inspections?.find((i) => i.inspectionId === insp354);
  check(!m.isError && e354, `list raw_notes enthält Tür 354 (${m.text.slice(0, 200)})`);
  check(e354?.rawNotes?.[0]?.text === 'Dichtung oben beschädigt' && /SK32/.test(e354?.type ?? '') && e354?.current?.defects?.length === 1, `Rohtext, Typ und bisherige Zuordnung (${JSON.stringify(e354).slice(0, 300)})`);
  m = await mcp(key, 'inspect', { inspection: insp354, defects: [{ title: 'Dichtung oben beschädigt', severity: 'medium', measure: 'Dichtung ersetzen', checkpoint: 'Dichtung' }], evaluated: true });
  check(!m.isError && /1 Rohnotiz als ausgewertet markiert/.test(m.data?.rawNotes ?? ''), `inspect markiert die Rohnotiz (${m.text.slice(0, 300)})`);
  check(m.data?.status === 'ready', 'bleibt bereit zur Unterschrift');
  m = await mcp(key, 'list', { what: 'raw_notes' });
  check(!m.data?.inspections?.some((i) => i.inspectionId === insp354), 'Tür 354 nicht mehr unter raw_notes');
  check((await readyList()).find((i) => i.id === insp354)?.rawPending === 0, 'rawPending 0');
  await p.goto(BASE + `/pruefung/${insp354}`);
  await p.locator('#diktat').getByText('ausgewertet', { exact: true }).waitFor();

  step('MCP: Tür ansagen (number + type), unbekannter und mehrdeutiger Typ');
  m = await mcp(key, 'inspect', { number: 370, type: 'Novo Premio T30 RS', property: 'Hotel Seeblick', allOk: true });
  check(!m.isError && /angelegt/.test(m.data?.created ?? '') && m.data?.status === 'ready', `Tür 370 per MCP angelegt und bereit (${m.text.slice(0, 300)})`);
  const a370 = await assetByNumber(370);
  check(a370?.model === 'Premio T30-RS' && a370?.attributes?.approval === 'Z-6.20-2205', 'Stammdaten und Zulassung aus dem Katalog');
  m = await mcp(key, 'inspect', { number: 371, type: 'Hörmann Unbekannt 9', property: 'Hotel Seeblick', allOk: true });
  check(!m.isError && /Typ unbekannt/.test(m.data?.created ?? '') && /nicht im Katalog/.test(m.data?.typeNote ?? ''), `unbekannter Typ über MCP (${m.text.slice(0, 300)})`);
  m = await mcp(key, 'list', { what: 'raw_notes' });
  const e371 = m.data?.inspections?.find((i) => /Nr\. 371/.test(i.element));
  check(e371?.rawNotes?.[0]?.source === 'Claude' && /Hörmann Unbekannt 9/.test(e371.rawNotes[0].text), 'Typ als Rohnotiz mit Quelle Claude');
  m = await mcp(key, 'inspect', { number: 372, type: 'Novoferm', property: 'Hotel Seeblick', allOk: true });
  check(m.isError && /mehrdeutig/.test(m.text) && !(await assetByNumber(372)), `mehrdeutiger Typ → Rückfrage, nichts angelegt (${m.text.slice(0, 160)})`);
  m = await mcp(key, 'inspect', { number: 400, type: 'SK32', property: 'Hotel Seeblick' });
  check(m.isError && /Feuerlöscher/.test(m.text), 'MCP: Nummer 400 ist ein Feuerlöscher');
  m = await mcp(key, 'inspect', { number: 354, type: 'SK32', property: 'Hotel Seeblick', allOk: true });
  check(!m.isError && !m.data?.created && m.data?.inspectionId === insp354, 'vorhandene Tür 354 gefunden, derselbe Entwurf');

  step('Archivieren über MCP: nur mit Admin-Verbindung');
  const ninaMail = `nina${stamp}@example.com`;
  const inv = await api('/account/members/invite', { data: { email: ninaMail, role: 'admin' } });
  const other = await b.newContext();
  const op = (pth, data, method) => other.request.fetch(BASE + '/api' + pth, { method: method ?? (data !== undefined ? 'POST' : 'GET'), data, headers: { 'x-pk': '1' } });
  check((await op(`/auth/invite/${inv.json.token}`, { name: 'Nina Albers', password: 'sicheres-passwort-2' })).status() === 200, 'Admin Nina angenommen');
  const ninaKey = (await (await op('/account/api-keys', { name: 'Claude Nina', scope: 'write', expiresInDays: 1 })).json()).key;
  const nina = (await api('/account/members')).json.members.find((x) => x.email === ninaMail);
  await api(`/account/members/${nina.id}`, { method: 'PATCH', data: { role: 'inspector' } });
  const a371 = await assetByNumber(371);
  m = await mcp(ninaKey, 'update_asset', { asset: a371.code, archive: true });
  check(m.isError && /Admin-Verbindung/.test(m.text), `herabgestufte Person: Archivieren abgelehnt (${m.text.slice(0, 160)})`);
  m = await mcp(key, 'update_asset', { asset: a371.code, archive: true, model: 'X' });
  check(m.isError && /archive allein/.test(m.text), 'archive nur allein');
  m = await mcp(key, 'update_asset', { asset: a371.code, archive: true, reason: 'Tür ausgebaut' });
  check(!m.isError && m.data?.archived === true, `Inhaber-Verbindung archiviert (${m.text.slice(0, 160)})`);
  const trash = (await api('/trash/assets')).json;
  check(trash.some((t) => t.id === a371.id), 'im Papierkorb');
  check((await api(`/assets/${a371.id}/restore`, { data: {} })).status === 200 && (await assetByNumber(371)), 'in der App wiederhergestellt');
  await other.close();

  step('Ohne Netz: Gebäude laden, Türen ansagen, Warteschlange, später übertragen');
  await p.goto(BASE + '/offline');
  const prep = p.getByRole('region', { name: 'Gebäude laden' }).or(p.locator('section', { hasText: 'Gebäude laden' })).first();
  await p.getByText('Auf diesem Gerät').waitFor();
  // die Seite baut sich nach dem Laden der Pakete einmal neu auf – Auswahl wiederholen, bis das Gebäude wählbar ist
  await prep.getByRole('combobox').first().selectOption({ label: 'Hotel Seeblick (Test)' });
  await prep.getByRole('combobox').nth(1).selectOption({ label: building.name });
  await p.getByRole('button', { name: 'Laden', exact: true }).click();
  await p.getByText(/Elemente gespeichert/).waitFor();
  await p.goto(BASE + '/pruefen');
  await card.waitFor();
  await p.waitForTimeout(400);
  await ctx.setOffline(true);
  await card.getByText('ohne Netz').waitFor();
  door('Tür 380 offline (neu, mit Abweichung)');
  await input(field, 'Tür 380 Typ SK32');
  await preview.getByText('Tür 380 · Raum 380 · Westag + Getalit SK32 – wird angelegt').waitFor();
  await enter(field);
  await p.waitForURL(/\/offline\/pruefen\/local[^?]+\?ansage=1/);
  await input(p.getByLabel('Eingesprochener Befund'), 'Türschließer zieht nicht zu');
  await tap(p.getByRole('button', { name: 'Alles andere in Ordnung' }));
  await p.locator('#diktat').getByText('noch nicht ausgewertet').waitFor();
  check((await p.locator('#diktat').innerText()).includes('Offline'), 'Quelle „Offline“ an der Rohnotiz');
  await noOverflow('(Offline-Prüfung aus der Ansage)');
  await shot('m-offline-ansage-pruefung', p.locator('#diktat'));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  door('Tür 381 offline (gleicher Typ)');
  await input(field, 'Tür 381 gleicher Typ');
  await enter(field);
  await p.waitForURL(/\/offline\/pruefen\/local[^?]+\?ansage=1/);
  await tap(p.getByRole('button', { name: 'Alles in Ordnung', exact: true }));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  door('Tür 382 offline (Typ unbekannt)');
  await input(field, 'Tür 382 Typ Holztür alt');
  await preview.getByText(/Typ unbekannt/).waitFor();
  await enter(field);
  await p.waitForURL(/\/offline\/pruefen\/local[^?]+\?ansage=1/);
  const offlineRows = await p.locator('[data-cp]').count();
  await tap(p.getByRole('button', { name: 'Alles in Ordnung', exact: true }));
  await tap(p.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await p.waitForURL(/\/pruefen\?ansage=weiter/);
  door('Tür 354 offline (vorhanden)');
  await input(field, 'Tür 354 Typ SK32');
  await preview.getByText(/vorhanden/).waitFor();
  await field.fill('');
  check(!(await assetByNumber(380)), 'Tür 380 vor der Übertragung noch nicht auf dem Server');
  await shot('m-ansage-offline', card);
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  let a380 = null;
  for (let i = 0; i < 40 && !(a380 && (await assetByNumber(382))); i++) {
    await p.waitForTimeout(500);
    a380 = await assetByNumber(380);
  }
  const a381 = await assetByNumber(381);
  const a382 = await assetByNumber(382);
  check(a380?.model === 'SK32' && a381?.model === 'SK32' && a382?.model === 'unbekannt', `offline angesagte Türen übertragen (${[a380, a381, a382].map((x) => x?.code ?? '–').join(', ')})`);
  await p.waitForTimeout(1500);
  const ready = await readyList();
  const r380 = ready.find((i) => i.assetId === a380?.id);
  check(r380 && r380.rawPending === 1, `Tür 380 bereit zur Unterschrift mit offenem Diktat (${JSON.stringify(r380 && { rp: r380.rawPending })})`);
  check(ready.some((i) => i.assetId === a381?.id) && ready.some((i) => i.assetId === a382?.id), 'Türen 381 und 382 bereit');
  const d380 = r380 ? (await api(`/inspections/${r380.id}`)).json : null;
  check(d380?.rawNotes?.[0]?.source === 'offline' && d380.defects.length === 1, 'Rohnotiz mit Quelle offline und Mangel übertragen');
  const d382 = (await api(`/inspections/${ready.find((i) => i.assetId === a382?.id)?.id}`)).json;
  check(d382.checkpoints.length === plainCps && offlineRows <= plainCps, `offline: allgemeine Checkliste (${d382.checkpoints.length})`);
  check(d382.rawNotes?.some((n) => n.kind === 'type'), 'offline: gesprochener Typ als Rohnotiz');

  step('Checkliste je Typ: nur zutreffende Punkte, zwei Typen verglichen, PDF eine Seite');
  await p.goto(BASE + `/druck/checkliste?produkt=${pA.id}`);
  await p.getByRole('heading', { name: 'Checkliste Westag + Getalit SK32' }).waitFor();
  const rowsA = await p.locator('[data-checkpoint]').count();
  check(rowsA === allCps - new Set(main.checkpoints.filter((c) => c.appliesIf).map((c) => c.id)).size, `Typ A: ${rowsA} Punkte (ohne die nicht zutreffenden)`);
  check(await p.getByLabel('Entfällt nach den Stammdaten').isVisible(), 'nicht Zutreffendes ist benannt');
  await noOverflow('(Checkliste 390 px)');
  await shot('m-checkliste');
  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name: 'PDF' }).click();
  const file = OUT + 'checkliste.pdf';
  await (await dl).saveAs(file);
  const info = execFileSync('pdfinfo', [file]).toString();
  check(/Pages:\s+1\b/.test(info), `PDF hat genau eine Seite (${(info.match(/Pages:\s+\d+/) || [''])[0]})`);
  const pdfText = execFileSync('pdftotext', [file, '-']).toString();
  check(/Westag \+ Getalit SK32/.test(pdfText) && /Türen mit Abweichung/.test(pdfText), 'PDF mit Typ und Spalte für Türnummern');
  await p.goto(BASE + `/druck/checkliste?produkt=${pB.id}`);
  await p.getByRole('heading', { name: 'Checkliste Novoferm Premio T30-RS' }).waitFor();
  const rowsB = await p.locator('[data-checkpoint]').count();
  check(rowsB === allCps && rowsB > rowsA, `Typ B: alle ${rowsB} Punkte (mehr als Typ A: ${rowsA})`);
  check((await p.getByLabel('Kopf der Checkliste').innerText()).includes('Z-6.20-2205'), 'Zulassung im Kopf');
  // aus dem Element (Tür 360, Typ unbekannt → Bedingungen offen: „falls vorhanden“)
  await p.goto(BASE + `/elemente/${(await assetByNumber(360)).id}`);
  await p.getByRole('button', { name: 'Weitere Aktionen zum Element' }).click();
  await p.getByRole('menuitem', { name: 'Checkliste drucken' }).click();
  await p.waitForURL(/\/druck\/checkliste\?element=/);
  await p.getByText('falls vorhanden', { exact: false }).first().waitFor();
  await noOverflow('(Checkliste aus dem Element)');
  // Einstellungen → Katalog → Produkt: Link
  await p.goto(BASE + '/einstellungen?tab=catalog');
  await p.getByRole('radio', { name: 'Produkte' }).or(p.getByRole('tab', { name: 'Produkte' })).or(p.getByRole('button', { name: 'Produkte' })).first().click();
  await p.getByRole('button', { name: 'Westag + Getalit SK32' }).or(p.getByLabel('Westag + Getalit SK32')).first().click();
  await p.getByRole('link', { name: 'Checkliste zum Ausdrucken' }).click();
  await p.getByRole('heading', { name: 'Checkliste Westag + Getalit SK32' }).waitFor();

  step('Breite 1360 px: Ansage und Checkliste');
  const wide = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await wide.addCookies(await ctx.cookies());
  const w = await wide.newPage();
  global.__page = w;
  w.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await w.goto(BASE + '/pruefen');
  const wcard = w.getByRole('region', { name: 'Tür ansagen' });
  await wcard.waitFor();
  await wcard.getByRole('textbox', { name: 'Ansage' }).fill('Tür 390 Typ Premio T30 RS, Dichtung fehlt');
  await wcard.getByRole('status', { name: 'Vorschau der Ansage' }).getByText(/Novoferm Premio T30-RS – wird angelegt/).waitFor();
  await w.waitForTimeout(200);
  await w.screenshot({ path: OUT + 'd-ansage.png' });
  if (SHOTS) await w.screenshot({ path: SHOTS + 'd-ansage.png' });
  await w.goto(BASE + `/pruefung/${insp354}`);
  await w.locator('#diktat').waitFor();
  await w.locator('#diktat').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await w.waitForTimeout(200);
  await w.screenshot({ path: OUT + 'd-pruefung-rohnotiz.png' });
  if (SHOTS) await w.screenshot({ path: SHOTS + 'd-pruefung-rohnotiz.png' });
  await w.goto(BASE + `/druck/checkliste?produkt=${pA.id}`);
  await w.getByRole('heading', { name: 'Checkliste Westag + Getalit SK32' }).waitFor();
  await w.waitForTimeout(200);
  await w.screenshot({ path: OUT + 'd-checkliste.png', fullPage: true });
  if (SHOTS) await w.screenshot({ path: SHOTS + 'd-checkliste.png', fullPage: true });
  await wide.close();

  step('Tipps und Eingaben je Tür');
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k}: ${v.taps} Tipps, ${v.inputs} Eingaben`);
  fs.writeFileSync(OUT + 'tipps.json', JSON.stringify(counts, null, 2));
  const c354 = counts['Tür 354 (neu, mit Abweichung)'];
  check(c354.inputs === 2 && c354.taps === 3, `neue Tür mit Abweichung: 2 Eingaben, 3 Tipps (${c354.inputs}/${c354.taps})`);
  const c355 = counts['Tür 355 (gleicher Typ, ohne Abweichung)'];
  check(c355.inputs === 1 && c355.taps === 3, `Folgetür ohne Abweichung: 1 Eingabe, 3 Tipps (${c355.inputs}/${c355.taps})`);
  const c356 = counts['Tür 356 (Befund in der Ansage)'];
  check(c356.inputs === 1 && c356.taps === 3, `Befund in der Ansage: 1 Eingabe, 3 Tipps (${c356.inputs}/${c356.taps})`);
  const c380 = counts['Tür 380 offline (neu, mit Abweichung)'];
  check(c380.inputs === 2 && c380.taps === 3, `offline gleich viele: 2 Eingaben, 3 Tipps (${c380.inputs}/${c380.taps})`);

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch(async (e) => {
  await global.__page?.screenshot({ path: OUT + 'fehler.png', fullPage: true }).catch(() => {});
  console.log('FAIL', e.stack);
  process.exit(1);
});
