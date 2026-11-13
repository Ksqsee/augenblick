// E2E 24-unterschreiben-offline (docs/plan/v4.md 8.4/8.5): Seite „Unterschreiben“ – bereitliegende Prüfungen
// (per API wie von Claude), aufklappen, zurückstellen, erstes Mal mit Zeichenfläche (merken), abgelehnte Prüfung
// mit Grund und Link, danach ein Tipp mit gemerkter Unterschrift, Leerzustand, Hinweis auf „Prüfungen“.
// Offline (Playwright setOffline nach dem Laden eines Gebäudes): Befund einsprechen per Text → Prüfpunkt lokal
// zugeordnet, Rundgang springt nach dem Abschluss zum nächsten Element, „Erfassen“ legt in die Warteschlange,
// wieder online → übertragen (per API geprüft), Duplikat (409) bleibt auf der Offline-Seite zur Entscheidung.
// Handy 390 px ohne horizontalen Überlauf. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, '.out', '24-unterschreiben-offline') + '/';
fs.mkdirSync(OUT, { recursive: true });
// Bilder für docs/design/v3/unterschreiben (SHOTS=1)
const SHOTS = process.env.SHOTS ? path.join(__dirname, '..', 'docs', 'design', 'v3', 'unterschreiben') + '/' : null;
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

let cookie = '';
async function api(p, { method, body } = {}) {
  const r = await fetch(BASE + '/api' + p, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-pk': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.startsWith('pk_session')) cookie = sc.split(';')[0];
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: null, text };
  }
}

/** Entwurf für ein Element anlegen und vollständig (alles i. O., optional ein Mangel am ersten Punkt) bereitlegen. */
async function readyDraft(assetId, { defect, ready = true } = {}) {
  const { id } = (await api(`/assets/${assetId}/inspections`, { body: {} })).json;
  const d = (await api(`/inspections/${id}`)).json;
  const answers = Object.fromEntries(d.checkpoints.map((c) => [c.id, 'ok']));
  const defects = [];
  if (defect) {
    answers[d.checkpoints[0].id] = 'defect';
    defects.push({ checkpointId: d.checkpoints[0].id, title: defect, note: '', measure: 'Schließer einstellen', severity: 'medium' });
  }
  const r = await api(`/inspections/${id}`, { method: 'PUT', body: { kinds: d.kinds?.length ? d.kinds : ['periodic'], answers, defects, notes: 'E2E bereitgelegt', ready } });
  check(r.json?.ready === ready, `Entwurf bereit (${JSON.stringify(r.json).slice(0, 160)})`);
  return { id, code: d.asset.code, kinds: d.kinds?.length ? d.kinds : ['periodic'], answers, defects };
}

const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  if (process.env.PROD) throw new Error('24-unterschreiben-offline nicht gegen Produktion ausführen');
  check((await api('/auth/login', { body: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } })).status === 200, 'Login');
  const me = (await api('/account/me')).json;
  const userId = me.user.id;
  const rounds = (await api('/smart/rounds?days=14')).json.filter((r) => r.assets.length >= 3);
  check(rounds.length >= 2, `zwei Rundgänge mit mindestens 3 Elementen (${rounds.length})`);
  const [r1, r2] = rounds;

  step('Bereitlegen per API (wie Claude über inspect)');
  const A = await readyDraft(r1.assets[0].id, { defect: 'E2E Schließer zieht nicht zu' });
  const B = await readyDraft(r1.assets[1].id);
  const C = await readyDraft(r1.assets[2].id);
  check((await api('/inspections?status=ready')).json.length === 3, 'drei bereit');

  const browser = await chromium.launch();
  const host = new URL(BASE).hostname;
  const newCtx = async (viewport, extra = {}) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE', ...extra });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), domain: host, path: '/' }]);
    return ctx;
  };
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
  };
  const mctx = await newCtx({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  watch(m);
  // at: Ausschnitt (Bildschirm) um dieses Element statt ganzer Seite – bei festen Leisten und langen Formularen
  const shot = async (p, name, at) => {
    if (at) await at.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    // Toasts (3,5 s) nicht mit ins Bild
    await p.waitForFunction(() => !document.querySelector('[aria-live=polite] > .bg-ink'), null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(250);
    const opts = { fullPage: !at };
    await p.screenshot({ path: OUT + name + '.png', ...opts });
    if (SHOTS) await p.screenshot({ path: SHOTS + name + '.png', ...opts });
  };

  step('Prüfungen: Hinweis → Unterschreiben (390 px)');
  await m.goto(BASE + '/pruefen');
  await m.getByText('3 Prüfungen warten auf deine Unterschrift').waitFor();
  await m.getByRole('link', { name: 'Unterschreiben' }).click();
  await m.waitForURL(/\/unterschreiben$/);
  const list = m.getByRole('list', { name: 'Bereit zur Unterschrift' });
  await list.locator(`[data-ready="${A.id}"]`).waitFor();
  check((await list.locator('[data-ready]').count()) === 3, 'drei Zeilen');
  const rowA = list.locator(`[data-ready="${A.id}"]`);
  await rowA.getByText('1 Mangel').waitFor();
  check(await rowA.getByText('Mit Mängeln').isVisible(), 'Ergebnis als Wort');
  check(await list.locator(`[data-ready="${B.id}"]`).getByText('Ohne Mängel').isVisible(), 'ohne Mängel');
  check(await m.getByRole('button', { name: 'Alle 3 unterschreiben' }).isVisible(), 'ein Knopf für alle');
  check((await overflow(m)) <= 0, 'kein Überlauf (Liste)');
  await shot(m, 'm-liste');

  step('Aufklappen: Mängel, Bearbeiten, Zurückstellen');
  await rowA.getByRole('button', { expanded: false }).click();
  await rowA.getByText('E2E Schließer zieht nicht zu').waitFor();
  check(await rowA.getByText('Schließer einstellen').isVisible(), 'Maßnahme sichtbar');
  check((await rowA.getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')) === `/pruefung/${A.id}?von=unterschreiben`, 'Bearbeiten öffnet die Prüfung');
  check((await overflow(m)) <= 0, 'kein Überlauf (aufgeklappt)');
  await shot(m, 'm-aufgeklappt');
  await rowA.getByRole('link', { name: 'Bearbeiten' }).click();
  await m.waitForURL(/\/pruefung\//);
  await m.getByRole('link', { name: 'Zurück' }).click();
  await m.waitForURL(/\/unterschreiben$/);
  const rowC = list.locator(`[data-ready="${C.id}"]`);
  await rowC.getByRole('button', { expanded: false }).click();
  await rowC.getByRole('button', { name: 'Zurückstellen' }).click();
  await rowC.waitFor({ state: 'detached' });
  check((await api(`/inspections/${C.id}`)).json.readyAt === null, 'zurückgestellt (API)');

  step('Erstes Mal: Zeichenfläche, merken; unvollständige Prüfung → Fehlerzeile');
  // B nachträglich unvollständig (z. B. in einer anderen Sitzung geändert)
  const r = await api(`/inspections/${B.id}`, { method: 'PUT', body: { kinds: B.kinds, answers: {}, notes: '' } });
  check(r.json?.ready === false, 'B nicht mehr bereit');
  await m.getByRole('button', { name: 'Alle 2 unterschreiben' }).click();
  const dlg = m.getByRole('dialog');
  await dlg.locator('canvas').waitFor();
  await m.waitForTimeout(400); // Sheet gleitet noch herein
  check(await dlg.getByRole('button', { name: 'Alle 2 unterschreiben' }).isDisabled(), 'erst nach dem Zeichnen');
  const box = await dlg.locator('canvas').boundingBox();
  await m.mouse.move(box.x + 30, box.y + 80);
  await m.mouse.down();
  await m.mouse.move(box.x + 200, box.y + 50, { steps: 8 });
  await m.mouse.move(box.x + 260, box.y + 90, { steps: 4 });
  await m.mouse.up();
  check(await dlg.getByRole('checkbox').isChecked(), 'merken ist vorgewählt');
  await shot(m, 'm-zeichnen');
  await dlg.getByRole('button', { name: 'Alle 2 unterschreiben' }).click();
  await m.getByText('1 Prüfung unterschrieben').waitFor();
  const failed = m.getByRole('list', { name: 'Nicht unterschrieben' });
  await failed.getByText(B.code).waitFor();
  check(/nicht gefunden|bereit/i.test(await failed.innerText()), `Grund genannt (${(await failed.innerText()).replace(/\n/g, ' ')})`);
  check((await failed.getByRole('link', { name: 'Öffnen' }).getAttribute('href')) === `/pruefung/${B.id}?von=unterschreiben`, 'Link zur Prüfung');
  check(await m.getByText(/^Mit Mängeln\. Protokolle/).isVisible(), 'mit Mängeln genannt');
  check((await overflow(m)) <= 0, 'kein Überlauf (Bestätigung)');
  await shot(m, 'm-bestaetigung');
  const pA = (await api(`/inspections/${A.id}`)).json;
  check(pA.status === 'submitted' && pA.result === 'defects' && /^data:image\/png;base64,/.test(pA.signature ?? '') && pA.signerName === me.user.name, `A abgeschlossen (${pA.status} ${pA.result} ${pA.signerName})`);
  check((await api(`/inspections/${B.id}`)).json.status === 'draft', 'B bleibt Entwurf');
  const remembered = await m.evaluate((id) => localStorage.getItem(`pk:signature:${id}`), userId);
  check(/^data:image\/png;base64,/.test(remembered ?? ''), 'Unterschrift auf dem Gerät gemerkt');

  step('Gemerkte Unterschrift: ein Tipp (1360 px)');
  await api(`/inspections/${B.id}`, { method: 'PUT', body: { kinds: B.kinds, answers: B.answers, notes: '', ready: true } });
  await api(`/inspections/${C.id}`, { method: 'PUT', body: { kinds: C.kinds, answers: C.answers, notes: 'E2E bereitgelegt', ready: true } });
  const dctx = await newCtx({ width: 1360, height: 900 });
  await dctx.addInitScript(([id, sig]) => localStorage.setItem(`pk:signature:${id}`, sig), [userId, remembered]);
  const d = await dctx.newPage();
  watch(d);
  await d.goto(BASE + '/unterschreiben');
  await d.getByRole('img', { name: 'Gemerkte Unterschrift' }).waitFor();
  await shot(d, 'd-liste');
  await d.locator(`[data-ready="${C.id}"]`).getByRole('button', { expanded: false }).click();
  await d.getByText('Alle Prüfpunkte in Ordnung.').waitFor();
  await shot(d, 'd-aufgeklappt');
  await d.getByRole('button', { name: 'Alle 2 unterschreiben' }).click();
  await d.getByText('2 Prüfungen unterschrieben').waitFor();
  check(!(await d.getByRole('dialog').count()), 'ohne Zeichenfläche');
  await shot(d, 'd-bestaetigung');
  for (const x of [B, C]) {
    const i = (await api(`/inspections/${x.id}`)).json;
    check(i.status === 'submitted' && i.signature === remembered, `${x.code} mit gemerkter Unterschrift abgeschlossen`);
  }
  await m.goto(BASE + '/unterschreiben');
  await m.getByText('Keine Prüfung wartet auf deine Unterschrift.').waitFor();
  await shot(m, 'm-leer');
  await m.goto(BASE + '/pruefen');
  await m.getByRole('heading', { name: 'Prüfen', exact: true }).waitFor();
  await m.waitForTimeout(500);
  check(!(await m.getByText(/warten? auf deine Unterschrift/).count()), 'kein Hinweis ohne bereite Prüfungen');

  step('Offline: Gebäude laden, Rundgang, Befund einsprechen per Text');
  const prop = (await api(`/properties/${r2.propertyId}`)).json;
  const walk = r2.assets; // Server-Reihenfolge: Etage, Standort, Code
  // Duplikat vorbereiten: offener Mangel am zweiten Element, den „Erfassen“ gleich noch einmal meldet
  const dupAsset = walk[1];
  check((await api('/defects', { body: { assetId: dupAsset.id, title: 'Dichtung fehlt oben', severity: 'medium', force: true } })).status === 200, 'offener Mangel für Duplikat');
  await m.goto(BASE + '/offline');
  await m.getByRole('combobox').first().selectOption({ label: prop.name });
  await m.waitForTimeout(600);
  await m.getByRole('combobox').nth(1).selectOption({ label: r2.buildingName });
  await m.getByRole('button', { name: 'Laden', exact: true }).click();
  await m.getByText(/Elemente gespeichert/).waitFor();
  // Elementliste einmal laden wie im Alltag nicht garantiert – „Erfassen“ muss ohne sie auskommen
  await mctx.setOffline(true);
  await m.waitForTimeout(300);
  await m.getByText('Kein Netz').first().waitFor();
  await m.getByRole('link', { name: 'Rundgang starten' }).click();
  await m.waitForURL(/\/offline\/pruefen\/.+\?rundgang=/);
  const firstId = m.url().split('/offline/pruefen/')[1].split('?')[0];
  check(firstId === walk[0].id, `Rundgang beginnt mit dem ersten Element in Laufreihenfolge (${firstId} / ${walk[0].id})`);
  const banner = m.getByLabel('Offline-Rundgang');
  await banner.waitFor();
  check(/1 von \d+/.test(await banner.innerText()), `Position im Rundgang (${await banner.innerText()})`);
  // v5: „Abweichung einsprechen“ öffnet das Feld; Prüfpunkte nach Gruppen eingeklappt
  await m.getByRole('button', { name: 'Abweichung einsprechen' }).click();
  const voice = m.getByRole('region', { name: 'Befund einsprechen' });
  check(await voice.getByText(/Mikrofon der Tastatur nutzen/).isVisible(), 'Hinweis auf das Tastatur-Diktat');
  await m.locator('[data-group] > button').first().click();
  const groups = m.locator('[data-cp] [role=radiogroup]');
  const cpLabel = await groups.nth(0).getAttribute('aria-label');
  await voice.getByLabel('Eingesprochener Befund').fill(`${cpLabel} – defekt, mittel`);
  await shot(m, 'm-offline-befund', voice);
  await voice.getByRole('button', { name: 'Übernehmen' }).click();
  await voice.getByText(/1 Mangel eingetragen.*Auf dem Gerät ausgewertet/).waitFor();
  check((await groups.nth(0).getByRole('radio', { name: 'Mangel' }).getAttribute('aria-checked')) === 'true', `Mangel lokal beim Prüfpunkt „${cpLabel}“`);
  check((await overflow(m)) <= 0, 'kein Überlauf (Offline-Prüfung)');
  await shot(m, 'm-offline-befund-zugeordnet', voice);
  // „Alles andere in Ordnung“ setzt die gemerkte Unterschrift ein – ein Tipp zum Abschluss
  await m.getByRole('button', { name: 'Alles andere in Ordnung' }).click();
  await m.getByRole('button', { name: 'Abschließen, weiter' }).click();
  await m.waitForURL((u) => !u.pathname.endsWith(firstId) && u.pathname.startsWith('/offline/pruefen/'));
  const secondId = m.url().split('/offline/pruefen/')[1].split('?')[0];
  check(secondId === walk[1].id, `automatisch weiter zum nächsten Element (${secondId} / ${walk[1].id})`);
  await m.getByLabel('Offline-Rundgang').getByText(/2 von \d+/).waitFor();
  check(!(await m.locator('[data-cp] [role=radiogroup] [aria-checked="true"]').count()), 'neues Formular ohne Antworten');

  step('Offline: Erfassen → Warteschlange');
  await m.getByRole('link', { name: 'Zurück' }).click();
  await m.waitForURL(/\/offline$/);
  await m.getByText('1 Prüfung noch nicht übertragen').waitFor();
  await m.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).click();
  const sheet = m.getByRole('dialog');
  await sheet.getByText('Mikrofon der Tastatur nutzen', { exact: false }).waitFor();
  await sheet.getByLabel('Erfasster Text').fill(`Tür ${dupAsset.code} Dichtung fehlt oben. Hausmeister wegen E2E Offline Keller informieren.`);
  await shot(m, 'm-offline-erfassen', sheet);
  await sheet.getByRole('button', { name: 'Auswerten' }).click();
  await sheet.getByText('2 Einträge erkannt').waitFor();
  await sheet.getByRole('button', { name: 'Auf dem Gerät speichern' }).click();
  await sheet.getByText('Offline gespeichert – wird übertragen, sobald Netz da ist').waitFor();
  check((await overflow(m)) <= 0, 'kein Überlauf (Erfassen offline)');
  await shot(m, 'm-offline-erfasst', sheet);
  await sheet.getByRole('button', { name: 'Ansehen' }).click();
  const queue = m.getByRole('list', { name: 'Erfasst, noch nicht übertragen' });
  await queue.waitFor();
  check((await queue.getByRole('listitem').count()) === 2, 'zwei Einträge in der Warteschlange');
  check((await overflow(m)) <= 0, 'kein Überlauf (Offline-Seite)');
  await shot(m, 'm-offline-warteschlange', queue);

  step('Wieder online: übertragen, Duplikat bleibt zur Entscheidung');
  await mctx.setOffline(false);
  await m.evaluate(() => window.dispatchEvent(new Event('online')));
  await m.getByText('Alles übertragen').waitFor({ timeout: 15000 });
  await queue.getByText(/Ähnlicher Mangel ist bereits offen/).waitFor({ timeout: 15000 });
  // die Aufgabe wird nach dem Mangel gesendet – auf den Endzustand warten statt sofort zu zählen
  await m.waitForFunction(() => document.querySelectorAll('[aria-label="Erfasst, noch nicht übertragen"] li').length === 1, null, { timeout: 15000 }).catch(() => {});
  check((await queue.getByRole('listitem').count()) === 1, 'nur das Duplikat bleibt');
  const tasks = (await api('/tasks')).json;
  check(tasks.some((t) => /E2E Offline Keller/.test(t.title)), 'Aufgabe übertragen (API)');
  const insp = (await api(`/inspections?status=submitted&q=${encodeURIComponent(walk[0].code)}`)).json;
  check(insp.some((i) => i.assetId === walk[0].id && i.result === 'defects'), 'Offline-Prüfung mit Mangel übertragen (API)');
  await shot(m, 'm-offline-duplikat', queue);
  await queue.getByRole('button', { name: 'Trotzdem anlegen' }).click();
  await queue.waitFor({ state: 'detached' });
  const defects = (await api('/defects?status=open')).json.filter((x) => x.assetId === dupAsset.id && /Dichtung fehlt oben/.test(x.title));
  check(defects.length === 2, `Duplikat nach Entscheidung angelegt (${defects.length})`);

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await browser.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
