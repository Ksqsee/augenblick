// E2E 01-onboarding: Registrierung, erstes Objekt (ein Feld auf „Heute“, Gebäude still mit), Element per Satz und per
// Formular, Objekt nachträglich bearbeiten, Prüfung mit Mangel, Protokoll, mobile Ansicht
// Start über `npm run e2e` (lokale D1 mit Demodaten, Dev-Server auf BASE). Passwort aus DEMO_PASSWORD.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '01-onboarding') + '/';
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror ' + e.message));
  p.on('console', m => m.type() === 'error' && errors.push('console ' + m.text()));
  const shot = n => p.screenshot({ path: OUT + n + '.png', fullPage: true });
  const email = `test${Date.now()}@example.com`;

  await p.goto(BASE + '/registrieren');
  await p.getByLabel('Unternehmen').fill('Muster Brandschutz GmbH');
  await p.getByLabel('Dein Name').fill('Erika Prüfer');
  await p.getByLabel('E-Mail').fill(email);
  await p.getByLabel('Passwort').fill('sicheres-passwort-1');
  await shot('01-register');
  await p.getByRole('button', { name: 'Kostenlos starten' }).click();
  await p.getByText('Wie heißt dein erstes Objekt?').waitFor();
  await shot('02-dashboard-empty');

  // Objekt: ein Feld auf „Heute“; danach öffnet „Erfassen“ im Modus Elemente mit dem Objekt als Ort
  await p.getByLabel('Name des Objekts').fill('Grundschule Am Park');
  await p.getByRole('button', { name: 'Anlegen', exact: true }).click();
  const sheet = p.getByRole('dialog');
  await sheet.getByRole('tab', { name: 'Elemente', selected: true }).waitFor();
  await sheet.getByLabel('Erfasster Text').fill('Feuerschutztür Treppenhaus Nord von Hörmann T30');
  await sheet.getByRole('button', { name: '1 Element anlegen' }).click();
  await sheet.getByText('1 Element angelegt').waitFor();
  await sheet.getByRole('button', { name: 'Ansehen' }).click();
  await p.waitForURL(/\/objekte\//);
  // Adresse und Ansprechperson später unter Bearbeiten
  await p.getByRole('button', { name: 'Weitere Aktionen zum Objekt' }).click();
  await p.getByRole('menuitem', { name: 'Objekt bearbeiten' }).click();
  await p.getByLabel('Adresse').fill('Parkweg 3\n22041 Hamburg');
  await p.getByLabel('Ansprechperson').fill('Hausmeister Meier');
  await p.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('Hausmeister Meier').waitFor();

  // Weitere Elemente per Formular (ein Gebäude: kein Gebäudefeld)
  const addAsset = async (cat, loc, extra) => {
    await p.getByRole('button', { name: 'Element', exact: true }).click();
    await p.getByRole('button', { name: new RegExp(cat) }).click();
    await p.getByLabel('Standort').fill(loc);
    if (extra) await extra();
    await p.getByRole('button', { name: 'Speichern', exact: true }).click();
    await p.waitForTimeout(600);
  };
  await addAsset('Feuerlöscher', 'Flur EG');
  await addAsset('Rauchwarnmelder', 'Klassenraum 1.04');
  await shot('03-property');

  // Prüfung
  await p.getByText('Treppenhaus Nord').first().click();
  await shot('04-drawer');
  await p.getByRole('button', { name: 'Prüfen' }).click();
  await p.waitForURL(/\/pruefung\//);
  // Prüfpunkte nach Gruppen eingeklappt: Gruppe öffnen, Mangel setzen, Rest mit einem Tipp
  await p.getByRole('button', { name: /Bauteil und Einbau/ }).click();
  await p.locator('[data-cp="p9"]').getByRole('radio', { name: 'Mangel' }).click();
  await p.getByRole('button', { name: 'Alles andere in Ordnung' }).click();
  await p.getByRole('radio', { name: 'Hoch' }).click();
  await p.getByPlaceholder('Beschreibung (optional)').fill('Dichtung oben 20 cm abgerissen');
  await p.getByRole('button', { name: /Weitere Angaben/ }).click();
  await p.getByRole('button', { name: 'Bänder geschmiert' }).click();
  await p.locator('canvas').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 200); await p.waitForTimeout(300); const c = await p.locator('canvas').boundingBox();
  await p.mouse.move(c.x + 30, c.y + 90); await p.mouse.down();
  await p.mouse.move(c.x + 120, c.y + 60, { steps: 8 }); await p.mouse.move(c.x + 220, c.y + 100, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  await shot('05-inspection');
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await p.waitForURL(/\/druck\/protokoll\//);
  await p.getByText('Festgestellte Mängel').waitFor();
  await shot('06-protocol');

  await p.goto(BASE + '/');
  await p.getByText('Prüfstatus').waitFor();
  await shot('07-dashboard');
  await p.goto(BASE + '/maengel');
  await p.getByText('Dichtungen (Rauch-').first().waitFor();
  // schwerer Mangel (Hoch) → Aufgabe wurde automatisch angelegt
  await p.getByText('mit Aufgabe', { exact: true }).first().waitFor();
  await shot('08-defects');
  await p.goto(BASE + '/elemente'); await p.waitForTimeout(800); await shot('09-assets');
  await p.goto(BASE + '/pruefungen?tab=never'); await p.waitForTimeout(800); await shot('10-inspections');
  await p.goto(BASE + '/aufgaben'); await p.waitForTimeout(800); await shot('11-tasks');
  await p.goto(BASE + '/berichte'); await p.waitForTimeout(500); await shot('12-reports');
  await p.goto(BASE + '/druck/etiketten'); await p.waitForTimeout(1200); await shot('13-labels');
  await p.goto(BASE + '/druck/compliance'); await p.waitForTimeout(800); await shot('14-compliance');
  await p.goto(BASE + '/team'); await p.getByRole('button', { name: 'Einladen' }).click();
  await p.getByLabel('E-Mail').fill('kollege@example.com');
  await p.getByRole('button', { name: 'Einladung erstellen' }).click();
  await p.getByText('Er kann einmal verwendet werden').waitFor();
  await shot('15-invite');
  await p.goto(BASE + '/einstellungen'); await p.getByRole('tab', { name: 'Prüfvorlagen' }).click(); await p.getByText('Feuerschutztür').first().click(); await p.waitForTimeout(300); await shot('16-templates');

  // Mobile
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(BASE + '/'); await mp.getByText('Prüfstatus').waitFor(); await mp.screenshot({ path: OUT + 'm1-dashboard.png', fullPage: true });
  await mp.goto(BASE + '/elemente'); await mp.waitForTimeout(800);
  await mp.getByText('Flur EG').first().click(); await mp.getByRole('button', { name: 'Prüfen' }).click(); await mp.waitForURL(/\/pruefung\//);
  await mp.locator('[data-group] > button').first().click();
  await mp.getByRole('radio', { name: 'In Ordnung' }).nth(0).click(); await mp.getByRole('radio', { name: 'In Ordnung' }).nth(1).click();
  await mp.waitForTimeout(500); await mp.screenshot({ path: OUT + 'm2-inspection.png' });
  await mp.goto(BASE + '/scan'); await mp.waitForTimeout(500); await mp.screenshot({ path: OUT + 'm3-scan.png' });

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'OK no errors');
  if (errors.length) process.exitCode = 1;
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
