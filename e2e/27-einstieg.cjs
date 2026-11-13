// E2E 27-einstieg (Plan v5, Paket Q): ein neuer Nutzer am Handy kommt mit einem Namen und einem Satz vom leeren Konto
// zu angelegten Elementen. Zählt die Tipps (Ziel: höchstens 5 Tipps und zwei Eingaben), prüft „Erfassen“ im leeren Konto
// ohne Sackgasse, Objekte mit einem bzw. zwei Gebäuden, den Hauptknopf der Objektseite, „Neues Objekt“ mit Name und
// Adresse und 390 px ohne horizontalen Überlauf. Bilder für docs/design/v3/v5 entstehen in e2e/.out/27-einstieg. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '27-einstieg') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' };
const DESKTOP = { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' };

(async () => {
  if (process.env.PROD) throw new Error('27-einstieg nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
    pg.on('dialog', (d) => {
      errors.push(`window-Dialog: ${d.message()}`);
      d.dismiss();
    });
  };
  const api = async (pg, path, opts = {}) => {
    const r = await pg.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  /** Neues Konto über die Oberfläche (zählt nicht zu den Tipps) */
  const register = async (opts, company) => {
    const ctx = await b.newContext(opts);
    const pg = await ctx.newPage();
    watch(pg);
    await pg.goto(BASE + '/registrieren');
    await pg.getByLabel('Unternehmen').fill(company);
    await pg.getByLabel('Dein Name').fill('Nora Neu');
    await pg.getByLabel('E-Mail').fill(`einstieg${Date.now()}${Math.round(Math.random() * 1e4)}@example.com`);
    await pg.getByLabel('Passwort').fill('sicheres-passwort-1');
    await pg.getByRole('button', { name: 'Kostenlos starten' }).click();
    await pg.getByText('Wie heißt dein erstes Objekt?').waitFor();
    return { ctx, pg };
  };

  // Mit der Art „Feststellanlage“ (Paket P) gehört sie in den Satz, sonst zwei Feuerlöscher
  const probe = await register(DESKTOP, 'Einstieg Probe GmbH');
  const hasFsa = ((await api(probe.pg, '/categories')).json ?? []).some((c) => c.key === 'hold_open');
  await probe.ctx.close();

  step('Leeres Konto am Handy: ein Feld, ein Knopf');
  const { ctx: mctx, pg: m } = await register(MOBILE, 'Einstieg Mobil GmbH');
  const heute = m.locator('main');
  check((await heute.getByRole('textbox').count()) === 1, `genau ein Feld auf „Heute“ (${await heute.getByRole('textbox').count()})`);
  check((await heute.getByRole('button').count()) === 1, `genau ein Knopf auf „Heute“ (${await heute.getByRole('button').count()})`);
  check(!(await m.getByText('Prüfstatus').count()) && !(await m.getByRole('heading', { name: 'Jetzt' }).count()), 'keine Kennzahlen, kein „Jetzt“');
  check((await overflow(m)) <= 0, 'Leerzustand: kein Überlauf');
  await m.screenshot({ path: OUT + 'm-leer.png' });

  step('Ein Name und ein Satz: Tipps zählen');
  let taps = 0;
  let inputs = 0;
  const tap = async (loc) => {
    taps++;
    await loc.tap();
  };
  const type = async (loc, text) => {
    inputs++;
    await loc.fill(text);
  };
  const field = m.getByLabel('Name des Objekts');
  await tap(field);
  await type(field, 'Seehafer Elemente');
  await tap(m.getByRole('button', { name: 'Anlegen', exact: true }));
  const sheet = m.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Elemente', selected: true }).waitFor();
  await sheet.locator('[data-where]').getByText('Seehafer Elemente').waitFor();
  const sentence = `Im Erdgeschoss Flur drei Feuerschutztüren von Hörmann T30 und ${hasFsa ? 'eine Feststellanlage' : 'zwei Feuerlöscher'}`;
  const text = sheet.getByLabel('Erfasster Text');
  await tap(text);
  await type(text, sentence);
  const preview = sheet.getByRole('list', { name: 'Erkannt' });
  await preview.getByText('3 × Feuerschutztür').waitFor();
  check(await preview.getByText('EG · Flur · Hörmann · T30').isVisible(), 'Vorschau zeigt Etage, Standort, Hersteller, T30');
  check(await preview.getByText(hasFsa ? '1 × Feststellanlage' : '2 × Feuerlöscher').isVisible(), 'zweite Art in der Vorschau');
  const total = hasFsa ? 4 : 5;
  const create = sheet.getByRole('button', { name: `${total} Elemente anlegen` });
  check((await overflow(m)) <= 0, 'Erfassen-Vorschau: kein Überlauf');
  await m.screenshot({ path: OUT + 'm-erfassen-elemente.png' });
  await tap(create);
  await sheet.getByText(`${total} Elemente angelegt`).waitFor();
  console.log(`  Tipps bis zu angelegten Elementen: ${taps}, Eingaben: ${inputs} (Ziel: ≤ 5 Tipps, 2 Eingaben)`);
  check(taps <= 5 && inputs === 2, `höchstens 5 Tipps und zwei Eingaben (${taps} Tipps, ${inputs} Eingaben)`);
  const props = (await api(m, '/properties')).json;
  check(props.length === 1 && props[0].name === 'Seehafer Elemente', 'Objekt angelegt');
  const detail = (await api(m, `/properties/${props[0].id}`)).json;
  check(detail.buildings.length === 1 && detail.buildings[0].name === 'Hauptgebäude', 'Gebäude „Hauptgebäude“ still mitangelegt');
  const doors = detail.assets.filter((a) => a.category === 'fire_door');
  check(
    doors.length === 3 && doors.every((a) => a.floor === 'EG' && a.location === 'Flur' && a.manufacturer === 'Hörmann' && a.attributes.rating === 'T30'),
    `drei Türen mit EG, Flur, Hörmann, T30 (${JSON.stringify(doors.map((a) => [a.floor, a.location, a.manufacturer, a.attributes.rating]))})`,
  );
  const second = detail.assets.filter((a) => a.category === (hasFsa ? 'hold_open' : 'extinguisher'));
  check(second.length === (hasFsa ? 1 : 2) && second.every((a) => a.floor === 'EG' && a.location === 'Flur'), 'zweite Art erbt den Ort im selben Satz');

  step('Objektseite mit einem Gebäude: Elemente direkt, Hauptknopf „Rundgang starten“');
  await sheet.getByRole('button', { name: 'Ansehen' }).tap();
  await m.waitForURL(/\/objekte\//);
  await m.getByRole('region', { name: 'Elemente' }).waitFor();
  check(!(await m.getByRole('region', { name: 'Hauptgebäude' }).count()) && !(await m.getByText('Hauptgebäude').count()), 'ein Gebäude ist unsichtbar');
  check(await m.getByRole('link', { name: 'Rundgang starten' }).isVisible(), 'Hauptknopf „Rundgang starten“ (nie geprüfte Elemente)');
  check(!(await m.getByRole('button', { name: 'Begehung starten' }).count()), '„Begehung starten“ nicht im Kopf');
  check((await overflow(m)) <= 0, 'Objektseite: kein Überlauf');
  await m.screenshot({ path: OUT + 'm-objekt.png' });
  await m.getByRole('button', { name: 'Weitere Aktionen zum Objekt' }).tap();
  check(await m.getByRole('menuitem', { name: 'Begehung starten' }).isVisible(), '„Begehung starten“ im ⋯-Menü');
  check(await m.getByRole('menuitem', { name: 'Gebäude hinzufügen' }).isVisible(), '„Gebäude hinzufügen“ im ⋯-Menü');
  await m.keyboard.press('Escape');
  // Formular „Element“: das einzige Gebäude ist vorbelegt und unsichtbar
  await m.getByRole('region', { name: 'Elemente' }).getByRole('button', { name: 'Element', exact: true }).tap();
  await m.getByRole('dialog').getByRole('button', { name: /Rauchwarnmelder/ }).tap();
  await m.getByLabel('Standort').waitFor();
  check(!(await m.getByRole('dialog').getByLabel('Gebäude').count()), 'Elementformular: kein Gebäudefeld bei einem Gebäude');
  await m.getByLabel('Standort').fill('Teeküche');
  await m.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).tap();
  await m.getByRole('dialog').waitFor({ state: 'detached' });
  check((await api(m, `/properties/${props[0].id}`)).json.assets.some((a) => a.location === 'Teeküche' && a.buildingId === detail.buildings[0].id), 'Element im einzigen Gebäude angelegt');

  step('Zweites Gebäude: Gebäude werden sichtbar');
  await m.getByRole('button', { name: 'Weitere Aktionen zum Objekt' }).tap();
  await m.getByRole('menuitem', { name: 'Gebäude hinzufügen' }).tap();
  await m.getByRole('dialog').getByLabel('Name').fill('Haus B');
  await m.getByRole('dialog').getByRole('button', { name: 'Speichern', exact: true }).tap();
  await m.getByRole('region', { name: 'Haus B' }).waitFor();
  check(await m.getByRole('region', { name: 'Hauptgebäude' }).isVisible(), 'beide Gebäude als Abschnitte');
  await m.getByRole('region', { name: 'Haus B' }).getByRole('button', { name: 'Element', exact: true }).tap();
  await m.getByRole('dialog').getByRole('button', { name: /Feuerlöscher/ }).tap();
  check(await m.getByRole('dialog').getByLabel('Gebäude').isVisible(), 'Elementformular: Gebäudefeld ab zwei Gebäuden');
  await m.keyboard.press('Escape');
  check((await overflow(m)) <= 0, 'Objekt mit zwei Gebäuden: kein Überlauf');
  await mctx.close();

  step('Erfassen im leeren Konto ohne Sackgasse');
  const { ctx: ectx, pg: e } = await register(MOBILE, 'Einstieg Ohne Ort GmbH');
  await e.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).tap();
  const s2 = e.getByRole('dialog');
  await s2.getByRole('tab', { name: 'Elemente', selected: true }).waitFor();
  await s2.getByLabel('Erfasster Text').fill('zwei Rauchwarnmelder im 1. OG Büro');
  await s2.getByRole('list', { name: 'Erkannt' }).getByText('2 × Rauchwarnmelder').waitFor();
  check(await s2.getByText('Wie heißt das Objekt?').isVisible(), 'fehlender Ort wird erfragt');
  check(!(await s2.getByRole('button', { name: /Erst Ort wählen/ }).count()), 'keine Sackgasse „Erst Ort wählen“');
  await s2.getByLabel('Ort').fill('Lager Süd');
  await s2.getByRole('button', { name: 'Neues Objekt „Lager Süd“ anlegen' }).tap();
  await s2.locator('[data-where]').getByText('Lager Süd').waitFor();
  await s2.getByRole('button', { name: '2 Elemente anlegen' }).tap();
  await s2.getByText('2 Elemente angelegt').waitFor();
  const lager = (await api(e, '/assets')).json;
  check(lager.length === 2 && lager.every((a) => a.category === 'smoke_alarm' && a.floor === '1. OG' && a.location === 'Büro' && a.propertyName === 'Lager Süd'), 'Elemente im neuen Objekt');
  // Gemischter Satz mit Mangel und Auftrag: getrennt erkannt, Vorschau vor dem Anlegen
  await s2.getByRole('button', { name: 'Weiter erfassen' }).tap();
  await s2.getByRole('tab', { name: 'Mängel & Aufgaben' }).tap();
  await s2.getByLabel('Erfasster Text').fill('Tür zum Lager klemmt. Hausmeister informieren bis Freitag.');
  await s2.getByRole('button', { name: 'Auswerten' }).tap();
  await s2.getByText('2 Einträge erkannt').waitFor();
  await s2.getByRole('button', { name: '1 Mangel und 1 Aufgabe anlegen' }).tap();
  await s2.getByText('1 Mangel und 1 Aufgabe angelegt').waitFor();
  await ectx.close();

  step('„Neues Objekt“: Name und Adresse, danach Elemente; leere Objektseite zeigt „Elemente hinzufügen“');
  const { ctx: dctx, pg: d } = await register(DESKTOP, 'Einstieg Desktop GmbH');
  await d.screenshot({ path: OUT + 'd-leer.png' });
  await d.goto(BASE + '/objekte?neu=1');
  const form = d.getByRole('dialog');
  await form.getByLabel('Name').fill('Bürohaus Kai');
  check(await form.getByLabel('Adresse').isVisible(), 'Adresse (optional) im Formular');
  check(!(await form.getByLabel('Nutzung').count()) && !(await form.getByLabel('Ansprechperson').count()), 'keine Nutzung/Ansprechperson beim Anlegen');
  await form.getByRole('button', { name: 'Speichern', exact: true }).click();
  await d.waitForURL(/\/objekte\/[^/?]+$/);
  const capture = d.getByRole('dialog');
  await capture.getByRole('tab', { name: 'Elemente', selected: true }).waitFor();
  await capture.getByLabel('Erfasster Text').fill('Tür Raum 306 von Westag');
  await capture.getByRole('list', { name: 'Erkannt' }).getByText('Raum 306 · Westag').waitFor();
  await d.screenshot({ path: OUT + 'd-erfassen-elemente.png' });
  await d.keyboard.press('Escape');
  await capture.waitFor({ state: 'detached' });
  check(await d.getByRole('button', { name: 'Elemente hinzufügen' }).isVisible(), 'leeres Objekt: Hauptknopf „Elemente hinzufügen“');
  await d.getByRole('button', { name: 'Elemente hinzufügen' }).click();
  await d.getByRole('dialog').getByLabel('Erfasster Text').fill('Tür Raum 306 von Westag');
  await d.getByRole('dialog').getByRole('button', { name: '1 Element anlegen' }).click();
  await d.getByRole('dialog').getByText('1 Element angelegt').waitFor();
  await d.getByRole('dialog').getByRole('button', { name: 'Ansehen' }).click();
  await d.getByRole('link', { name: 'Rundgang starten' }).waitFor();
  const kai = (await api(d, '/assets')).json;
  check(kai.length === 1 && kai[0].location === 'Raum 306' && kai[0].manufacturer === 'Westag', '„Tür Raum 306 von Westag“ angelegt');
  // Bearbeiten zeigt alle Felder
  await d.getByRole('button', { name: 'Weitere Aktionen zum Objekt' }).click();
  await d.getByRole('menuitem', { name: 'Objekt bearbeiten' }).click();
  check(await d.getByRole('dialog').getByLabel('Nutzung').isVisible(), 'Bearbeiten: Nutzung und Ansprechperson später');
  await d.keyboard.press('Escape');
  await d.getByRole('dialog').waitFor({ state: 'detached' });
  await d.getByText(/angelegt$/).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await d.screenshot({ path: OUT + 'd-objekt.png' });
  await dctx.close();

  check(!errors.length, `keine Seitenfehler (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
