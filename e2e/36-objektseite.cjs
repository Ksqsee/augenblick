// E2E 36-objektseite (Plan v8, Paket Z): die Objektseite mit vier Reitern – Übersicht · Elemente · Begehung · Mängel.
// Frischer Workspace. Objekt anlegen (API) → Übersicht mit Stammdaten, Grundriss (hochgeladen in der Übersicht) und Datei
// (Objektbericht → „Abgelegte Dateien“) → Elemente (Tabelle, Filter) → Begehung starten → zwei Türen ansagen (eine mit
// Mangel) → Ergebnisliste: bestanden / mit Mangel / offen mit richtigen Zählern, Filter → Unterschreiben aus dem Objekt
// (nur dieses Objekt, eine fremde Prüfung bleibt liegen) → Sammelmappe des Tages → Angebotsliste → Reiter Mängel zeigt den
// Mangel; erledigte einklappbar. Alte Reiter-Schlüssel leiten um. Gezählt und festgehalten: API-Aufrufe beim Öffnen
// des Objekts (darf nicht mehr sein als vor v8: 1 bei Navigation in der App) und Tipps vom Öffnen bis zur ersten
// angesagten Tür. 390 px und 1360 px ohne horizontalen Überlauf. Bilder nach docs/design/v3/v8 mit SHOTS=1. Nur lokal.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, '.out', '36-objektseite') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS ? path.join(__dirname, '..', 'docs', 'design', 'v3', 'v8') + '/' : null;
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
const record = {};

(async () => {
  if (process.env.PROD) throw new Error('36-objektseite nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const dctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', acceptDownloads: true });
  const d = await dctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 409/.test(m.text()) && errors.push('console ' + m.text()));
  };
  watch(d);
  const api = async (pth, opts = {}) => {
    const r = await d.request.fetch(BASE + '/api' + pth, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const noOverflow = async (pg, what) => {
    const over = await overflow(pg);
    check(over <= 0, `kein Überlauf ${what} (${over}px)`);
  };
  const settle = async (pg) => {
    await pg.waitForLoadState('networkidle').catch(() => {});
    await pg.waitForFunction(() => !document.querySelector('[aria-live=polite] > .bg-ink'), null, { timeout: 6000 }).catch(() => {});
    await pg.waitForTimeout(200);
  };
  const shot = async (pg, name) => {
    await settle(pg);
    await pg.screenshot({ path: OUT + name + '.png', fullPage: true });
    if (SHOTS) await pg.screenshot({ path: SHOTS + name + '.png', fullPage: true });
  };

  step('Workspace, Katalog-Typ, Objekt mit Stammdaten und drei Türen, ein zweites Objekt');
  await d.goto(BASE + '/login');
  const stamp = Date.now();
  let r = await api('/auth/register', { data: { company: 'Kompass Brandschutz GmbH', name: 'Mara Ostwald', email: `mara${stamp}@example.com`, password: 'sicheres-passwort-1' } });
  check(r.status === 200, `registriert (${r.status})`);
  const me = (await api('/account/me')).json;
  if (me.pendingLegal?.length) await api('/account/legal/accept', { data: { docs: me.pendingLegal } });
  // Stammdaten so, dass keine Prüfpunkt-Bedingung offen bleibt (keine Rückfragen in der Prüfung) – wie Reihe 33
  const cats = (await api('/categories')).json;
  const doorCat = cats.find((c) => c.key === 'fire_door');
  const conds = doorCat.schedulesEffective.find((s) => s.key === 'main').checkpoints.filter((c) => c.appliesIf).map((c) => c.appliesIf);
  const otherValue = (cond) => {
    if (typeof cond.equals === 'boolean') return !cond.equals;
    const f = doorCat.attributes.find((a) => a.key === cond.attr);
    return (f?.options ?? []).find((o) => o !== cond.equals) ?? `kein ${cond.equals}`;
  };
  const defaults = {};
  for (const c of conds) if (defaults[c.attr] === undefined) defaults[c.attr] = otherValue(c);
  const prod = (await api('/catalog/products', { data: { manufacturer: 'Westag + Getalit', model: 'SK32', category: 'fire_door', defaults, approval: '' } })).json;
  check(prod?.id, 'Katalog-Typ SK32 angelegt');
  const P = 'Pflegeheim Lindenhof (Test)';
  r = await api('/properties', {
    data: { name: P, address: 'Lindenallee 4\n24103 Kiel', withBuilding: true, contactName: 'Frau Brandt', contactPhone: '0431 123456', access: 'Schlüssel an der Pforte, werktags 7–16 Uhr' },
  });
  check(r.status === 200, `Objekt angelegt (${r.status})`);
  const prop = r.json;
  let detail = (await api(`/properties/${prop.id}`)).json;
  const bid = detail.buildings[0].id;
  // Zugang/Ansprechperson notfalls nachtragen (falls POST sie nicht nimmt)
  if (!detail.access || !detail.contactName)
    await api(`/properties/${prop.id}`, { method: 'PATCH', data: { name: P, address: detail.address, contactName: 'Frau Brandt', contactPhone: '0431 123456', access: 'Schlüssel an der Pforte, werktags 7–16 Uhr' } });
  for (const [n, floor, loc] of [
    [101, 'EG', 'Flur Nord'],
    [102, 'EG', 'Speisesaal'],
    [103, '1. OG', 'Treppenhaus'],
  ]) {
    const x = await api('/assets', { data: { buildingId: bid, category: 'fire_door', number: n, floor, location: loc, manufacturer: 'Westag + Getalit', model: 'SK32', attributes: defaults } });
    check(x.status === 200, `Tür ${n} angelegt (${x.status})`);
  }
  // zweites Objekt mit einer bereiten Prüfung: darf beim Unterschreiben aus dem Lindenhof nicht auftauchen
  const other = (await api('/properties', { data: { name: 'Bürohaus Förde (Test)', address: 'Kai 1', withBuilding: true } })).json;
  const obid = (await api(`/properties/${other.id}`)).json.buildings[0].id;
  const oa = (await api('/assets', { data: { buildingId: obid, category: 'fire_door', number: 1, location: 'Eingang', attributes: {} } })).json;
  const oi = (await api(`/assets/${oa.id}/inspections`, { data: {} })).json;
  const od = (await api(`/inspections/${oi.id}`)).json;
  r = await api(`/inspections/${oi.id}`, {
    method: 'PUT',
    data: { kinds: od.kinds?.length ? od.kinds : ['maintenance'], notInspectable: false, answers: Object.fromEntries(od.checkpoints.map((c) => [c.id, 'ok'])), maintenance: [], defects: [], photos: [], notes: '', signature: null, signerName: '', resultOverride: null, resultReason: '', resolvedDefects: [], ready: true },
  });
  check(r.json?.ready === true, `fremde Prüfung bereit (${JSON.stringify(r.json).slice(0, 160)})`);

  step('API-Aufrufe beim Öffnen des Objekts (Navigation in der App und voller Seitenaufruf)');
  await d.goto(BASE + '/objekte');
  await settle(d);
  const calls = [];
  const onReq = (q) => {
    const u = new URL(q.url());
    if (u.pathname.startsWith('/api/') && ['fetch', 'xhr'].includes(q.resourceType())) calls.push(`${q.method()} ${u.pathname}${u.search}`);
  };
  d.on('request', onReq);
  await d.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/objekte/${prop.id}`);
  await d.getByRole('heading', { name: P }).waitFor();
  await settle(d);
  record.apiInApp = [...calls];
  check(calls.length <= 1 && calls.every((c) => c === `GET /api/properties/${prop.id}`), `Öffnen in der App: höchstens 1 Aufruf, nur das Objekt (${calls.join(', ')})`);
  calls.length = 0;
  await d.reload();
  await d.getByRole('heading', { name: P }).waitFor();
  await settle(d);
  record.apiFullLoad = [...calls];
  check(!calls.some((c) => /walk|reports|tasks|defects|offer|inspections/.test(c)), `voller Aufruf: keine Daten anderer Reiter (${calls.join(', ')})`);
  d.off('request', onReq);

  step('Übersicht (1360 px): Stammdaten, Prüfstatus, Grundriss hochladen, Datei ablegen');
  check((await d.getByRole('tab', { selected: true }).innerText()).startsWith('Übersicht'), 'Standard-Reiter Übersicht');
  check((await d.getByRole('tab').allInnerTexts()).map((t) => t.replace(/\s*\d+$/, '')).join('|') === 'Übersicht|Elemente|Begehung|Mängel', 'vier Reiter in fester Reihenfolge');
  const facts = d.getByRole('region', { name: 'Stammdaten' });
  check(/Lindenallee 4/.test(await facts.innerText()) && /Frau Brandt/.test(await facts.innerText()) && /Schlüssel an der Pforte/.test(await facts.innerText()), 'Stammdaten: Adresse, Ansprechperson, Zugang');
  const status = d.getByRole('region', { name: 'Prüfstatus' });
  check((await status.locator('[data-number=assets]').innerText()) === '3', 'Prüfstatus: 3 Elemente');
  check(await d.getByRole('list', { name: /^Prüfstatus: 3 Elemente/ }).isVisible(), 'Prüfstatus als Zahlenliste mit Beschriftung');
  // Grundriss: Bild erzeugen und in der Übersicht hochladen
  const pg = await dctx.newPage();
  await pg.setViewportSize({ width: 800, height: 560 });
  await pg.setContent('<div style="font-family:sans-serif;padding:30px;background:#fff"><h1>EG Lindenhof</h1><div style="border:8px solid #333;width:700px;height:420px;display:grid;grid-template-columns:1fr 1fr 1fr"><div style="border:4px solid #333">Flur</div><div style="border:4px solid #333">Speisesaal</div><div style="border:4px solid #333">Küche</div></div></div>');
  await pg.screenshot({ path: OUT + 'plan.png' });
  await pg.close();
  await d.getByRole('region', { name: 'Grundrisse' }).getByRole('button', { name: 'Grundriss hochladen' }).click();
  await d.getByRole('dialog').locator('input[type=file]').setInputFiles(OUT + 'plan.png');
  await d.getByLabel('Bezeichnung').fill('Erdgeschoss');
  await d.getByRole('button', { name: 'Hochladen', exact: true }).click();
  await d.waitForURL(/\/grundrisse\//, { timeout: 30000 });
  await d.goto(BASE + `/objekte/${prop.id}`);
  await d.getByRole('region', { name: 'Grundrisse' }).getByRole('link', { name: /Erdgeschoss/ }).waitFor();
  check(await d.getByRole('region', { name: 'Grundrisse' }).locator('img[alt="Erdgeschoss"]').isVisible(), 'Grundriss in der Übersicht');
  // Datei: Objektbericht erzeugen → im Archiv des Objekts
  const files = d.getByRole('region', { name: 'Dateien' });
  const [dl] = await Promise.all([d.waitForEvent('download', { timeout: 60000 }), files.getByRole('button', { name: 'Objektbericht' }).click()]);
  check(/^Objektbericht_/.test(dl.suggestedFilename()), `Objektbericht heruntergeladen (${dl.suggestedFilename()})`);
  await d.getByText('Im Berichtsarchiv gespeichert').waitFor();
  await files.getByRole('button', { name: 'Abgelegte Dateien' }).click();
  await files.getByRole('link', { name: /Objektbericht Pflegeheim Lindenhof.*herunterladen/ }).waitFor();
  check(true, 'Datei in der Übersicht');
  await noOverflow(d, '(Übersicht 1360)');
  await shot(d, 'd-objekt-uebersicht');

  step('Elemente (1360 px): Tabelle mit Spalten, Filter nach Stand');
  await d.getByRole('tab', { name: /^Elemente/ }).click();
  await d.waitForURL(/tab=elemente/);
  const table = d.getByRole('table', { name: 'Elemente' });
  await table.waitFor();
  check((await table.locator('thead th').allInnerTexts()).join('|') === 'Nummer|Raum|Typ|Letzte Prüfung|Ergebnis|Nächste Prüfung', 'Tabellenspalten');
  check((await table.locator('tbody tr').count()) === 3, 'drei Türen in der Tabelle');
  await d.getByRole('group', { name: 'Nach Stand filtern' }).getByRole('button', { name: /^Nie geprüft/ }).click();
  await d.waitForURL(/stand=nie/);
  check((await table.locator('tbody tr').count()) === 3, 'Filter „Nie geprüft“: drei');
  await noOverflow(d, '(Elemente 1360)');
  await shot(d, 'd-objekt-elemente');

  step('Handy 390 px: vom Öffnen des Objekts bis zur ersten angesagten Tür – Tipps zählen');
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true, storageState: await dctx.storageState() });
  const m = await mctx.newPage();
  global.__page = m;
  watch(m);
  await m.addInitScript(([k, v]) => localStorage.setItem(k, v), [`pk:signature:${me.user.id}`, SIG]);
  let taps = 0;
  let inputs = 0;
  const tap = async (loc) => {
    taps++;
    await loc.click();
  };
  await m.goto(BASE + `/objekte/${prop.id}`);
  await m.getByRole('heading', { name: P }).waitFor();
  await settle(m);
  await noOverflow(m, '(Übersicht 390)');
  await shot(m, 'm-objekt-uebersicht');
  // Weg 1: Hauptaktion im Kopf
  await tap(m.getByRole('link', { name: 'Begehung starten' }));
  await m.waitForURL(/tab=begehung/);
  const card = m.getByRole('region', { name: 'Tür ansagen' });
  const field = card.getByRole('textbox', { name: 'Ansage' });
  await field.waitFor();
  check(!(await card.getByLabel('Objekt').count()), 'keine Objektwahl im Objekt');
  await m.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ansage', null, { timeout: 4000 }).catch(() => {});
  check(await field.evaluate((e) => document.activeElement === e), 'Ansagefeld hat nach „Begehung starten“ den Fokus');
  inputs++;
  await field.fill('Tür 101, Typ SK32');
  await card.getByRole('status', { name: 'Vorschau der Ansage' }).getByText(/vorhanden/).waitFor();
  taps++;
  await field.press('Enter');
  await m.waitForURL(/\/pruefung\/[^/?]+\?ansage=1&objekt=/);
  record.tapsHeader = { taps, inputs };
  check(taps <= 2 && inputs === 1, `Öffnen → erste Tür über den Kopf: ${taps} Tipps, ${inputs} Eingabe`);
  await tap(m.getByRole('button', { name: 'Alles in Ordnung', exact: true }));
  await tap(m.getByRole('button', { name: 'Bereit · nächste Tür' }));
  await m.waitForURL((u) => u.pathname === `/objekte/${prop.id}` && u.searchParams.get('tab') === 'begehung' && u.searchParams.get('ansage') === 'weiter');
  await field.waitFor();
  check(await field.evaluate((e) => document.activeElement === e), 'zurück im Objekt, Ansagefeld hat den Fokus');

  step('Zweite Tür mit Mangel in der Ansage');
  await field.fill('Tür 102, gleicher Typ, Obentürschließer defekt');
  await card.getByRole('status', { name: 'Vorschau der Ansage' }).getByText(/Befund/).waitFor();
  await field.press('Enter');
  await m.waitForURL(/\/pruefung\/[^/?]+\?ansage=1&objekt=/);
  check((await m.getByLabel('Eingesprochener Befund').inputValue()) === 'Obentürschließer defekt', 'Befund aus der Ansage vorbelegt');
  await m.getByRole('button', { name: 'Alles andere in Ordnung' }).click();
  await m.getByRole('button', { name: 'Bereit · nächste Tür' }).click();
  await m.waitForURL(/tab=begehung.*ansage=weiter/);

  step('Ergebnisliste: bestanden 1 · mit Mangel 1 · offen 1');
  const res = m.getByRole('region', { name: 'Ergebnis der Begehung' });
  await res.getByRole('heading', { name: 'Begehung heute' }).waitFor();
  const count = async (k) => (await res.locator(`[data-count=${k}]`).innerText()).replace(/\D+/g, ' ').trim().split(' ').pop();
  await m.waitForFunction(() => document.querySelector('[data-count=defects]'), null, { timeout: 8000 });
  check((await count('ok')) === '1' && (await count('defects')) === '1' && (await count('open')) === '1' && (await count('all')) === '3', `Zähler (ok ${await count('ok')}, Mangel ${await count('defects')}, offen ${await count('open')}, alle ${await count('all')})`);
  const rows = res.getByRole('list', { name: 'Elemente der Begehung' }).getByRole('listitem');
  check((await rows.count()) === 3, 'drei Zeilen');
  const rowText = await rows.allInnerTexts();
  check(/bestanden/.test(rowText[0]) && /wartet auf Unterschrift/.test(rowText[0]), `Tür 101 bestanden, wartet auf Unterschrift (${rowText[0].replace(/\s+/g, ' ')})`);
  check(/mit Mangel/.test(rowText[1]) && /1 Mangel/.test(rowText[1]), `Tür 102 mit Mangel (${rowText[1].replace(/\s+/g, ' ')})`);
  check(/noch offen/.test(rowText[2]), `Tür 103 noch offen (${rowText[2].replace(/\s+/g, ' ')})`);
  await res.locator('[data-count=defects]').click();
  await m.waitForURL(/zeige=defects/);
  check((await rows.count()) === 1, 'Filter „Mit Mangel“: eine Zeile');
  await res.locator('[data-count=defects]').click();
  const steps = m.getByRole('navigation', { name: 'Nach der Begehung' });
  check((await steps.locator('[data-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-step')))).join('>') === 'sign>mappe>offer', 'Folgeschritte in fester Reihenfolge');
  check((await steps.locator('[data-step=sign]').innerText()).includes('Unterschreiben (2)'), 'Unterschreiben (2)');
  check((await steps.locator('[data-step=mappe]').getAttribute('data-active')) === null, 'Sammelmappe erst nach dem Unterschreiben');
  await m.getByRole('textbox', { name: 'Ansage' }).evaluate((e) => e.blur());
  await noOverflow(m, '(Begehung 390)');
  await shot(m, 'm-objekt-begehung');

  step('Unterschreiben aus dem Objekt – nur dieses Objekt');
  await steps.locator('[data-step=sign]').getByRole('link').click();
  await m.waitForURL(/\/unterschreiben\?objekt=/);
  await m.locator('[data-ready]').first().waitFor();
  check((await m.locator('[data-ready]').count()) === 2, `zwei Prüfungen aus dem Lindenhof (${await m.locator('[data-ready]').count()})`);
  check(!(await m.locator(`[data-ready="${oi.id}"]`).count()), 'Prüfung aus dem anderen Objekt nicht dabei');
  check(await m.getByText('1 weitere wartet in anderen Objekten').isVisible(), 'Hinweis auf andere Objekte');
  await noOverflow(m, '(Unterschreiben gefiltert 390)');
  await m.getByRole('button', { name: 'Alle 2 unterschreiben' }).click();
  await m.getByText('2 Prüfungen unterschrieben').waitFor();
  const ready = (await api('/inspections?status=ready')).json;
  check(ready.length === 1 && ready[0].id === oi.id, 'fremde Prüfung wartet weiter');
  await m.getByRole('region', { name: 'Nacharbeit' }).or(m.getByLabel('Nacharbeit')).first().getByRole('link', { name: 'Zur Begehung' }).click();
  await m.waitForURL(/tab=begehung/);

  step('Sammelmappe des Tages, dann Angebotsliste');
  await m.waitForFunction(() => document.querySelector('[data-step=mappe][data-active]'), null, { timeout: 8000 });
  check(!(await steps.locator('[data-step=sign]').getAttribute('data-active')), 'nichts mehr zu unterschreiben');
  check((await count('ok')) === '1' && (await count('defects')) === '1', 'Zähler nach dem Unterschreiben unverändert');
  await steps.locator('[data-step=mappe]').getByRole('button').click();
  const dlg = m.getByRole('dialog', { name: 'Sammelmappe' });
  const make = dlg.getByRole('button', { name: /Mappe mit 2 Protokollen erzeugen/ });
  await make.waitFor();
  const [mp] = await Promise.all([m.waitForEvent('download', { timeout: 90000 }), make.click()]);
  check(/\.pdf$/.test(mp.suggestedFilename()), `Sammelmappe (${mp.suggestedFilename()})`);
  await dlg.locator('[data-mappe-done]').waitFor();
  await dlg.getByRole('button', { name: 'Fertig' }).click();
  await m.waitForFunction(() => document.querySelector('[data-step=offer][data-active]'), null, { timeout: 8000 });
  await steps.locator('[data-step=offer]').getByRole('link').click();
  await m.waitForURL((u) => u.searchParams.get('tab') === 'maengel' && u.searchParams.get('ansicht') === 'angebot');
  await m.locator('[data-offer-net]').waitFor();
  await noOverflow(m, '(Angebotsliste 390)');

  step('Reiter Mängel: der Mangel der Begehung; Erledigtes einklappbar');
  const defects = (await api('/defects?status=open')).json.filter((x) => x.propertyId === prop.id);
  check(defects.length === 1, `ein offener Mangel im Objekt (${defects.length})`);
  await m.getByRole('tab', { name: /^Offen/ }).click();
  const work = m.getByRole('region', { name: 'Offene Mängel und Aufgaben des Objekts' }).or(m.getByLabel('Offene Mängel und Aufgaben des Objekts'));
  await work.first().locator(`[data-defect="${defects[0].id}"]`).waitFor();
  check((await work.first().locator('[data-defect]').count()) === 1, 'genau dieser Mangel');
  check((await m.getByRole('tab', { name: /^Mängel/ }).innerText()).includes('1'), 'Reiter Mängel zählt 1');
  await m.getByRole('button', { name: 'Erledigt' }).click();
  await m.getByText('Noch nichts erledigt.').waitFor();
  await m.getByRole('button', { name: 'Erledigt' }).click();
  await noOverflow(m, '(Mängel 390)');
  await shot(m, 'm-objekt-maengel');
  await m.getByRole('tab', { name: /^Elemente/ }).click();
  await m.getByRole('list', { name: 'Elemente' }).waitFor();
  await noOverflow(m, '(Elemente 390)');
  await shot(m, 'm-objekt-elemente');

  step('Weg 2 (Reiter → großer Knopf): Tipps zählen; der Knopf ist das Auffälligste im Reiter');
  // neues Objekt ohne Prüfung heute, damit der Knopf steht
  const p2 = (await api('/properties', { data: { name: 'Kita Sonnenschein (Test)', address: 'Am Park 2', withBuilding: true } })).json;
  const b2 = (await api(`/properties/${p2.id}`)).json.buildings[0].id;
  await api('/assets', { data: { buildingId: b2, category: 'fire_door', number: 1, location: 'Gruppenraum', manufacturer: 'Westag + Getalit', model: 'SK32', attributes: defaults } });
  await m.goto(BASE + `/objekte/${p2.id}`);
  await m.getByRole('heading', { name: 'Kita Sonnenschein (Test)' }).waitFor();
  taps = 0;
  inputs = 0;
  await tap(m.getByRole('tab', { name: /^Begehung/ }));
  const big = m.getByRole('button', { name: 'Begehung starten', exact: true });
  await big.waitFor();
  const prominent = await m.locator('[data-detail-surface]').evaluate((surface) => {
    const btns = [...surface.querySelectorAll('button, a.rounded-md')].filter((e) => e.getBoundingClientRect().height > 0);
    const solid = btns.filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' && /bg-ink/.test(e.className));
    const area = (e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
    const biggest = btns.sort((x, y) => area(y) - area(x))[0];
    return { solid: solid.map((e) => e.textContent.trim()), biggest: biggest?.textContent.trim() };
  });
  check(prominent.solid.length === 1 && prominent.solid[0] === 'Begehung starten' && prominent.biggest === 'Begehung starten', `„Begehung starten“ ist der einzige gefüllte und der größte Knopf im Reiter (${JSON.stringify(prominent)})`);
  await noOverflow(m, '(Begehung vor dem Start 390)');
  await shot(m, 'm-objekt-begehung-start');
  await tap(big);
  inputs++;
  await m.getByRole('textbox', { name: 'Ansage' }).fill('Tür 1, Typ SK32');
  await m.getByRole('status', { name: 'Vorschau der Ansage' }).getByText(/vorhanden/).waitFor();
  await tap(m.getByRole('button', { name: 'Öffnen' }));
  await m.waitForURL(/\/pruefung\/[^/?]+\?ansage=1&objekt=/);
  record.tapsTab = { taps, inputs };
  check(taps <= 3 && inputs === 1, `Öffnen → erste Tür über den Reiter: ${taps} Tipps, ${inputs} Eingabe`);

  step('Alte Reiter-Schlüssel leiten um');
  for (const [old, want] of [
    ['grundrisse', (u) => !u.searchParams.get('tab')],
    ['begehungen', (u) => u.searchParams.get('tab') === 'begehung'],
    ['angebot', (u) => u.searchParams.get('tab') === 'maengel' && u.searchParams.get('ansicht') === 'angebot'],
  ]) {
    await d.goto(BASE + `/objekte/${prop.id}?tab=${old}`);
    await d.waitForURL(want, { timeout: 5000 }).catch(() => {});
    check(want(new URL(d.url())), `?tab=${old} → ${new URL(d.url()).search || '(Übersicht)'}`);
  }
  await d.getByRole('tab', { name: /^Begehung/ }).click();
  await d.getByRole('region', { name: 'Brandschutzbegehungen' }).waitFor();
  check(true, 'Brandschutzbegehungen als eigener Abschnitt');

  step('Desktop 1360 px: Begehung und Mängel');
  await d.goto(BASE + `/objekte/${prop.id}?tab=begehung`);
  await d.getByRole('region', { name: 'Ergebnis der Begehung' }).getByRole('heading', { name: 'Begehung heute' }).waitFor();
  const days = await d.getByLabel('Tag der Begehung').count();
  check(days === 0 || (await d.getByLabel('Tag der Begehung').inputValue()) !== '', 'Tagesauswahl, falls mehrere Tage');
  await noOverflow(d, '(Begehung 1360)');
  await shot(d, 'd-objekt-begehung');
  await d.goto(BASE + `/objekte/${prop.id}?tab=maengel`);
  await d.locator('[data-defect]').first().waitFor();
  await noOverflow(d, '(Mängel 1360)');
  await shot(d, 'd-objekt-maengel');

  step('Desktop 1360 px: Leiste und Objektseite zusammen – keine doppelte „Objekte“-Angabe, aktives Objekt, Ampel aktuell');
  const side = d.getByRole('navigation', { name: 'Liegenschaften' });
  await d.goto(BASE + `/objekte/${other.id}`);
  await d.getByRole('heading', { name: 'Bürohaus Förde (Test)', level: 1 }).waitFor();
  await side.locator(`[data-property="${other.id}"]`).waitFor();
  check((await side.locator(`[data-property="${other.id}"]`).getAttribute('aria-current')) === 'page', 'aktives Objekt in der Leiste markiert');
  check((await side.locator('[aria-current=page]').count()) === 1, 'genau ein Objekt markiert');
  check(!(await d.getByRole('navigation', { name: 'Pfad' }).isVisible()), 'kein Pfad „Objekte ›“ über dem Titel (die Leiste ist die Objektliste)');
  check((await d.getByRole('heading', { name: 'Objekte' }).count()) === 0, 'keine zweite Überschrift „Objekte“');
  check((await d.getByText('Objekte', { exact: true }).filter({ visible: true }).count()) <= 1, '„Objekte“ höchstens einmal sichtbar (Kopf der Leiste)');
  const otherRow = side.locator(`[data-property="${other.id}"]`);
  check((await otherRow.locator('[data-ampel="signatures"]').count()) === 1, `Leiste: Unterschrift offen beim Bürohaus (${await otherRow.innerText()})`);
  await noOverflow(d, '(Leiste + Objekt 1360)');
  await shot(d, 'd-leiste-objekt');
  // Unterschreiben in der App (ohne Neuladen): die Ampel in der Leiste aktualisiert sich
  await d.evaluate(([k, v]) => localStorage.setItem(k, v), [`pk:signature:${me.user.id}`, SIG]);
  await d.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/unterschreiben?objekt=${other.id}`);
  await d.locator(`[data-ready="${oi.id}"]`).waitFor();
  await d.getByRole('button', { name: 'Unterschreiben', exact: true }).click();
  await d.getByText('1 Prüfung unterschrieben').waitFor();
  await otherRow.locator('[data-ampel="signatures"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  check((await otherRow.locator('[data-ampel="signatures"]').count()) === 0, `Leiste nach dem Unterschreiben ohne „zu unterschreiben“ (${await otherRow.innerText()})`);
  // Mangel über „Erfassen“ (ohne Neuladen): Mängel-Angabe erscheint in der Leiste
  check((await otherRow.locator('[data-ampel="defects"]').count()) === 0, 'Bürohaus vorher ohne Mängel');
  await d.evaluate((to) => {
    history.pushState({}, '', to);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/objekte/${other.id}?tab=maengel`);
  await d.getByRole('heading', { name: 'Bürohaus Förde (Test)', level: 1 }).waitFor();
  await d.getByRole('complementary').getByRole('button', { name: 'Erfassen' }).click();
  const cap = d.getByRole('dialog');
  await cap.getByRole('tab', { name: 'Mängel & Aufgaben' }).click();
  await cap.locator('[data-where]').getByText('Bürohaus Förde (Test)').waitFor();
  await cap.getByLabel('Erfasster Text').fill('Fluchtwegschild im Eingang fehlt');
  await cap.getByRole('button', { name: 'Auswerten' }).click();
  await cap.getByRole('button', { name: '1 Mangel anlegen' }).click();
  await cap.getByText('1 Mangel angelegt').waitFor();
  await cap.getByRole('button', { name: 'Schließen' }).click();
  await otherRow.locator('[data-ampel="defects"]').waitFor({ timeout: 8000 }).catch(() => {});
  check((await otherRow.locator('[data-ampel="defects"]').innerText().catch(() => '')).includes('1 Mangel'), `Leiste nach dem Mangel: „1 Mangel“ (${await otherRow.innerText()})`);
  check((await d.getByRole('tab', { name: /^Mängel/ }).innerText()).includes('1'), 'Reiter Mängel zählt den neuen Mangel');

  step('Handy 390 px: Zurück von der Objektseite zur Liste');
  await m.goto(BASE + `/objekte/${other.id}`);
  await m.getByRole('heading', { name: 'Bürohaus Förde (Test)', level: 1 }).waitFor();
  const crumb = m.getByRole('navigation', { name: 'Pfad' });
  check(await crumb.isVisible(), 'Handy: Pfad „Objekte › …“ als Rückweg sichtbar');
  await noOverflow(m, '(Objekt 390)');
  await crumb.getByRole('link', { name: 'Objekte' }).click();
  await m.waitForURL((u) => u.pathname === '/objekte');
  await m.getByRole('list', { name: 'Objekte' }).locator(`[data-property="${other.id}"]`).waitFor();
  await noOverflow(m, '(Objektliste 390)');

  const p3 = (await api('/properties', { data: { name: 'Sporthalle Nord (Test)', address: 'Sportweg 9', withBuilding: true } })).json;
  const b3 = (await api(`/properties/${p3.id}`)).json.buildings[0].id;
  for (const n of [1, 2, 3, 4]) await api('/assets', { data: { buildingId: b3, category: 'fire_door', number: n, location: `Halle ${n}`, attributes: defaults } });
  await d.goto(BASE + `/objekte/${p3.id}?tab=begehung`);
  await d.getByRole('button', { name: 'Begehung starten', exact: true }).waitFor();
  await shot(d, 'd-objekt-begehung-start');

  step('Ein früherer Tag ist wählbar (Begehung vom …)');
  const walk = (await api(`/properties/${prop.id}/walk`)).json;
  check(walk.days.length === 1 && walk.inspections.length === 2 && walk.pending === 0, `Endpunkt: 1 Tag, 2 Prüfungen, nichts wartet (${JSON.stringify({ d: walk.days, n: walk.inspections.length, p: walk.pending })})`);
  const past = (await api(`/properties/${prop.id}/walk?date=2020-01-01`)).json;
  check(past.date === '2020-01-01' && past.inspections.length === 0, 'früherer Tag ohne Prüfungen');
  check((await api(`/properties/${prop.id}/walk?date=2020-13-01`)).status === 400, 'ungültiger Tag → 400');
  await d.goto(BASE + `/objekte/${prop.id}?tab=begehung&tag=2020-01-01`);
  await d.getByRole('heading', { name: 'Begehung vom 01.01.2020' }).waitFor();
  check((await d.getByLabel('Tag der Begehung').inputValue()) === '2020-01-01', 'Auswahl zeigt den gewählten Tag');

  console.log('  Festgehalten:', JSON.stringify(record));
  fs.writeFileSync(OUT + 'zaehlung.json', JSON.stringify(record, null, 2));
  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch(async (e) => {
  console.log('FAIL', e.stack);
  if (global.__page) await global.__page.screenshot({ path: OUT + 'fehler.png', fullPage: true }).catch(() => {});
  process.exit(1);
});
