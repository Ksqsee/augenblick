// E2E 29-erste-pruefung (Plan v5, Härtung des Regel-Parsers): Durchgang eines neuen Kontos am Handy (390 px) bis zur
// ersten unterschriebenen Prüfung – Objektname → ein Satz mit drei Orten/Arten/Herstellern → Elemente mit fortlaufenden
// Codes → „Heute“ → Rundgang → „Alles in Ordnung“ → Unterschrift zeichnen und merken → Abschließen → nächstes Element →
// „Alles in Ordnung“ → „Abschließen“. Tipps und Eingaben werden gezählt und ausgegeben (Ziel des Plans: höchstens 8 Tipps
// und ein Satz nach dem Objektnamen – gemessen wird ehrlich, der Test hält die Zahl fest). Danach: feste Nummern
// („Türen 12 bis 13“) und ein Mangel per Nummer („Tür 3 schließt nicht“) im Erfassen-Sheet. Kein Überlauf. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '29-erste-pruefung') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const SENTENCE = 'Im dritten OG Raum 306 eine Feuerschutztür von Westag und im ersten OG Treppenhaus eine Feststellanlage und zwei Rauchschutztüren von Schüco';

(async () => {
  if (process.env.PROD) throw new Error('29-erste-pruefung nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => {
    errors.push(`window-Dialog: ${d.message()}`);
    d.dismiss();
  });
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const noOverflow = async (what) => {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${what} (${over}px)`);
  };

  step('Neues Konto (zählt nicht mit)');
  await p.goto(BASE + '/registrieren');
  await p.getByLabel('Unternehmen').fill('Erste Prüfung GmbH');
  await p.getByLabel('Dein Name').fill('Paul Prüfer');
  await p.getByLabel('E-Mail').fill(`erste${Date.now()}${Math.round(Math.random() * 1e4)}@example.com`);
  await p.getByLabel('Passwort').fill('sicheres-passwort-1');
  await p.getByRole('button', { name: 'Kostenlos starten' }).click();
  await p.getByText('Wie heißt dein erstes Objekt?').waitFor();

  // Zählung: jeder Tipp (auch ins Textfeld), jede Eingabe, das Zeichnen der Unterschrift als eigene Geste
  const log = [];
  let phase = 'name';
  const count = { name: { taps: 0, inputs: 0 }, rest: { taps: 0, inputs: 0, draws: 0 } };
  const tap = async (loc, what) => {
    count[phase].taps++;
    log.push(`Tipp: ${what}`);
    await loc.tap();
  };
  const type = async (loc, text, what) => {
    count[phase].inputs++;
    log.push(`Eingabe: ${what}`);
    await loc.fill(text);
  };

  step('Objektname');
  const field = p.getByLabel('Name des Objekts');
  await tap(field, 'Feld Objektname');
  await type(field, 'Seehafer Elemente', 'Objektname');
  await tap(p.getByRole('button', { name: 'Anlegen', exact: true }), 'Anlegen');
  phase = 'rest';

  step('Ein Satz: drei Zeilen in der Vorschau');
  const sheet = p.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Elemente', selected: true }).waitFor();
  await sheet.locator('[data-where]').getByText('Seehafer Elemente').waitFor();
  const text = sheet.getByLabel('Erfasster Text');
  await tap(text, 'Textfeld (bzw. Mikrofon)');
  await type(text, SENTENCE, 'der Satz');
  const preview = sheet.getByRole('list', { name: 'Erkannt' });
  await preview.locator('li').nth(2).waitFor();
  const rows = await preview.locator('li').allInnerTexts();
  console.log('  Vorschau:', JSON.stringify(rows.map((r) => r.replace(/\s+/g, ' '))));
  check(rows.length === 3, `drei Zeilen (${rows.length})`);
  const flat = rows.map((r) => r.replace(/\s+/g, ' '));
  check(/1 × Feuerschutztür/.test(flat[0] ?? '') && /3\. OG · Raum 306 · Westag/.test(flat[0] ?? ''), `Zeile 1: 1 × Feuerschutztür, 3. OG, Raum 306, Westag (${flat[0]})`);
  check(/1 × Feststellanlage/.test(flat[1] ?? '') && /1\. OG · Treppenhaus/.test(flat[1] ?? '') && !/Westag|Schüco/.test(flat[1] ?? ''), `Zeile 2: 1 × Feststellanlage, 1. OG, Treppenhaus (${flat[1]})`);
  check(/2 × Feuerschutztür/.test(flat[2] ?? '') && /1\. OG · Treppenhaus · Schüco · Rauchschutz/.test(flat[2] ?? ''), `Zeile 3: 2 × Feuerschutztür mit Rauchschutz, Schüco (${flat[2]})`);
  check(!(await preview.locator('[data-unsure]').count()), 'nichts „bitte prüfen“');
  await noOverflow('Erfassen-Vorschau');
  await p.screenshot({ path: OUT + 'm-erfassen.png' });
  await tap(sheet.getByRole('button', { name: '4 Elemente anlegen' }), '4 Elemente anlegen');
  await sheet.getByText('4 Elemente angelegt').waitFor();

  const props = (await api('/properties')).json;
  const detail = (await api(`/properties/${props[0].id}`)).json;
  const byCode = Object.fromEntries(detail.assets.map((a) => [a.code, a]));
  console.log('  Codes:', Object.keys(byCode).sort().join(', '));
  const a1 = byCode['FST-001'];
  const a2 = byCode['FSA-002'];
  check(a1 && a1.floor === '3. OG' && a1.location === 'Raum 306' && a1.manufacturer === 'Westag', `FST-001: 3. OG, Raum 306, Westag (${JSON.stringify(a1 && [a1.floor, a1.location, a1.manufacturer])})`);
  check(a2 && a2.category === 'hold_open' && a2.floor === '1. OG' && a2.location === 'Treppenhaus' && !a2.manufacturer, `FSA-002: 1. OG, Treppenhaus (${JSON.stringify(a2 && [a2.floor, a2.location, a2.manufacturer])})`);
  for (const c of ['FST-003', 'FST-004']) {
    const a = byCode[c];
    check(a && a.floor === '1. OG' && a.location === 'Treppenhaus' && a.manufacturer === 'Schüco' && a.attributes.smoke === true, `${c}: 1. OG, Treppenhaus, Schüco, Rauchschutz (${JSON.stringify(a && [a.floor, a.location, a.manufacturer, a.attributes])})`);
  }

  step('„Heute“ → Rundgang → erste Prüfung mit gezeichneter Unterschrift');
  await tap(sheet.getByRole('button', { name: 'Schließen' }), 'Meldung schließen (zurück zu „Heute“)');
  await sheet.waitFor({ state: 'detached' });
  const start = p.getByRole('link', { name: 'Rundgang starten' }).first();
  await start.waitFor();
  await noOverflow('Heute mit Elementen');
  await tap(start, 'Rundgang starten');
  await p.waitForURL(/\/rundgang\//);
  await tap(p.getByRole('button', { name: 'Prüfung starten' }), 'Prüfung starten');
  await p.waitForURL(/\/pruefung\//);
  const id1 = p.url().split('/pruefung/')[1].split('?')[0];
  await tap(p.getByRole('button', { name: 'Alles in Ordnung' }), 'Alles in Ordnung');
  await p.getByRole('heading', { name: 'Unterschrift' }).waitFor();
  const pad = p.getByLabel('Unterschrift zeichnen');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  count.rest.draws++;
  log.push('Geste: Unterschrift zeichnen');
  await p.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(box.x + 30 + i * 22, box.y + box.height * (i % 2 ? 0.35 : 0.65), { steps: 3 });
  await p.mouse.up();
  await tap(p.getByLabel(/Unterschrift auf diesem Gerät merken/), 'Unterschrift merken');
  await noOverflow('Prüfung mit Unterschrift');
  await p.screenshot({ path: OUT + 'm-unterschrift.png' });
  await tap(p.getByRole('button', { name: 'Abschließen', exact: true }), 'Abschließen');
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  const first = { ...count.rest };
  const i1 = (await api(`/inspections/${id1}`)).json;
  check(i1.status === 'submitted' && i1.result === 'ok' && !!i1.signature, `erste Prüfung abgeschlossen und unterschrieben (${i1.status} ${i1.result})`);

  step('Nächstes Element: „Alles in Ordnung“ → „Abschließen“');
  await tap(p.getByRole('button', { name: 'Prüfung starten' }), 'Prüfung starten (nächstes Element)');
  await p.waitForURL(/\/pruefung\//);
  const id2 = p.url().split('/pruefung/')[1].split('?')[0];
  await tap(p.getByRole('button', { name: 'Alles in Ordnung' }), 'Alles in Ordnung');
  await tap(p.getByRole('button', { name: 'Abschließen', exact: true }), 'Abschließen');
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  const i2 = (await api(`/inspections/${id2}`)).json;
  check(i2.status === 'submitted' && i2.result === 'ok' && i2.signature === i1.signature, 'zweite Prüfung mit gemerkter Unterschrift');
  await noOverflow('Rundgang danach');

  const target = 8;
  console.log(`  Objektname: ${count.name.taps} Tipps, ${count.name.inputs} Eingabe`);
  console.log(`  Danach bis zur ersten unterschriebenen Prüfung: ${first.taps} Tipps + ${first.draws} Unterschrift (gezeichnet) + ${first.inputs} Satz (Ziel: ≤ ${target} Tipps und ein Satz)`);
  console.log(`  Zweites Element: ${count.rest.taps - first.taps} Tipps`);
  console.log(`  Ablauf: ${log.join(' → ')}`);
  // festgehaltene Messung (Stand dieses Commits): 8 Tipps + 1 Satz + das Zeichnen der Unterschrift (eine Geste, kein Tipp).
  // Zählt man das Zeichnen als Tipp, sind es 9 – das Ziel wird dann um einen verfehlt.
  check(first.inputs === 1 && first.draws === 1, `ein Satz und eine Unterschrift (${first.inputs} Eingaben, ${first.draws} Gesten)`);
  check(first.taps <= target, `höchstens ${target} Tipps bis zur ersten unterschriebenen Prüfung (gemessen ${first.taps})`);
  check(count.rest.taps - first.taps === 3, `nächstes Element in drei Tipps (${count.rest.taps - first.taps})`);

  step('Feste Nummern beim Anlegen: „Türen 12 bis 13 im Keller“');
  await p.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).tap();
  const s2 = p.getByRole('dialog');
  await s2.getByRole('tab', { name: 'Elemente' }).tap();
  await s2.getByLabel('Erfasster Text').fill('Türen 12 bis 13 im Keller');
  await s2.getByRole('list', { name: 'Erkannt' }).getByText('Nr. 12–13 · UG').waitFor();
  await s2.getByRole('button', { name: '2 Elemente anlegen' }).tap();
  await s2.getByText('2 Elemente angelegt').waitFor();
  const all = (await api(`/properties/${props[0].id}`)).json.assets;
  check(['FST-012', 'FST-013'].every((c) => all.some((a) => a.code === c && a.floor === 'UG')), `FST-012 und FST-013 angelegt (${all.map((a) => a.code).join(', ')})`);

  step('Mangel per Nummer: „Tür 3 schließt nicht“');
  await s2.getByRole('button', { name: 'Weiter erfassen' }).tap();
  await s2.getByRole('tab', { name: 'Mängel & Aufgaben' }).tap();
  await s2.getByLabel('Erfasster Text').fill('Tür 3 schließt nicht');
  await s2.getByRole('button', { name: 'Auswerten' }).tap();
  await s2.locator('[data-target]').getByText('Element FST-003').waitFor();
  await noOverflow('Mangel mit Element-Nummer');
  await p.screenshot({ path: OUT + 'm-mangel-nummer.png' });
  await s2.getByRole('button', { name: '1 Mangel anlegen' }).tap();
  await s2.getByText('1 Mangel angelegt').waitFor();
  const defects = (await api('/defects?status=all')).json;
  const d3 = defects.find((d) => d.title === 'Tür 3 schließt nicht');
  check(d3 && d3.assetId === byCode['FST-003'].id, `Mangel hängt an FST-003 (${d3 && d3.assetId})`);

  step('Unsicher: Rest wird „bitte prüfen“, nicht Standort');
  await s2.getByRole('button', { name: 'Weiter erfassen' }).tap();
  await s2.getByRole('tab', { name: 'Elemente' }).tap();
  await s2.getByLabel('Erfasster Text').fill('neun Feuerschutztüren im Treppenhaus, jeweils eine pro Etage');
  const unsure = s2.getByRole('list', { name: 'Erkannt' }).locator('[data-unsure]');
  await unsure.waitFor();
  check((await unsure.innerText()).includes('jeweils eine pro Etage'), 'Rest steht bei „bitte prüfen“');
  check(await s2.getByRole('list', { name: 'Erkannt' }).getByText('Treppenhaus', { exact: true }).isVisible(), 'Standort bleibt „Treppenhaus“');
  await noOverflow('bitte prüfen');
  await p.screenshot({ path: OUT + 'm-bitte-pruefen.png' });

  check(!errors.length, `keine Seitenfehler (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
