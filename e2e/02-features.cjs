// E2E 02-features: Suche, Grundrisse (PDF), Begehung, Mängel, Subunternehmer-Link, Import, Blanko-Etikett, Offline-Modus
// Start über `npm run e2e` (lokale D1 mit Demodaten, Dev-Server auf BASE). Passwort aus DEMO_PASSWORD.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '02-features') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console ' + m.text()));
  const shot = async (n, full = true) => { await p.waitForTimeout(400); await p.screenshot({ path: OUT + n + '.png', fullPage: full }); };

  step('login');
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();
  await shot('01-dashboard');

  step('search');
  await p.keyboard.press('Control+k');
  await p.getByPlaceholder('Element-Code, Standort, Objekt, Gebäude …').fill('Küche');
  await p.getByRole('dialog', { name: 'Suche' }).locator('button').first().waitFor();
  await shot('02-search', false);
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/(elemente|objekte)\//);

  step('property + plan');
  await p.goto(BASE + '/objekte');
  await p.getByRole('link', { name: 'Grundschule Am Stadtpark' }).click();
  await p.getByRole('tab', { name: /Grundrisse/ }).click();
  await shot('03-property-plans');
  await p.getByRole('link', { name: /Erdgeschoss/ }).first().click();
  await p.waitForURL(/\/grundrisse\//);
  await p.locator('img[alt="Erdgeschoss"]').waitFor();
  await shot('04-floorplan');
  // Marker entfernen und neu platzieren
  const marker = p.locator('button[title*="Technikraum, Zuluft"]').first();
  await marker.click();
  await p.getByRole('button', { name: 'Vom Plan entfernen' }).click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /Technikraum, Zuluft/ }).click();
  const box = await p.locator('img[alt="Erdgeschoss"]').boundingBox();
  await p.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.64);
  await p.waitForTimeout(800);
  if (!(await p.locator('button[title*="Technikraum, Zuluft"]').count())) throw new Error('Marker nicht neu platziert');

  step('floor plan upload (PDF)');
  const pdfPage = await ctx.newPage();
  await pdfPage.setContent('<div style="font-family:sans-serif;padding:40px"><h1>Testplan OG</h1><div style="border:8px solid #333;width:600px;height:380px;display:grid;grid-template-columns:1fr 1fr"><div style="border:4px solid #333">Raum 1</div><div style="border:4px solid #333">Raum 2</div></div></div>');
  await pdfPage.pdf({ path: OUT + 'plan.pdf', format: 'A4', landscape: true });
  await pdfPage.close();
  await p.goto(BASE + '/objekte');
  await p.getByRole('link', { name: 'Verwaltungsgebäude Hafenstraße' }).click();
  await p.getByRole('tab', { name: /Grundrisse/ }).click();
  await p.getByRole('button', { name: 'Grundriss hochladen' }).click();
  await p.locator('input[type=file]').setInputFiles(OUT + 'plan.pdf');
  await p.getByLabel('Bezeichnung').fill('2. Obergeschoss');
  await p.getByRole('button', { name: 'Hochladen', exact: true }).click();
  await p.waitForURL(/\/grundrisse\//, { timeout: 30000 });
  await p.locator('img[alt="2. Obergeschoss"]').waitFor();
  await p.getByRole('button', { name: /Serverraum/ }).first().click();
  const b2 = await p.locator('img[alt="2. Obergeschoss"]').boundingBox();
  await p.mouse.click(b2.x + b2.width * 0.4, b2.y + b2.height * 0.4);
  await p.waitForTimeout(800);
  await shot('05-pdf-plan');

  step('walkthrough');
  await p.goto(BASE + '/begehungen');
  await p.getByRole('button', { name: 'Begehung starten' }).click();
  await p.getByLabel('Objekt').selectOption({ label: 'Logistikzentrum Nord' });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Starten', exact: true }).click();
  await p.waitForURL(/\/begehung\//);
  await p.getByLabel('Teilnehmende').fill('Frau Schulte');
  // erste Frage Mangel, dann alle Abschnitte "Rest i. O."
  await p.getByRole('radio', { name: 'Mangel' }).first().click();
  await p.getByPlaceholder('Beschreibung (optional)').first().fill('Palette im Fluchtweg Achse 7');
  const sections = await p.locator('button[aria-expanded]').count();
  for (let i = 0; i < sections; i++) {
    const sec = p.locator('button[aria-expanded]').nth(i);
    if ((await sec.getAttribute('aria-expanded')) === 'false') await sec.click();
    const rest = p.getByRole('button', { name: 'Rest des Abschnitts i. O.' });
    if (await rest.count()) await rest.first().click();
  }
  await p.locator('canvas').scrollIntoViewIfNeeded();
  await p.mouse.wheel(0, 200); await p.waitForTimeout(300);
  const c = await p.locator('canvas').boundingBox();
  await p.mouse.move(c.x + 30, c.y + 80); await p.mouse.down(); await p.mouse.move(c.x + 160, c.y + 50, { steps: 6 }); await p.mouse.move(c.x + 260, c.y + 90, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(1200);
  await shot('06-walk-run');
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await p.waitForURL(/\/druck\/begehung\//);
  await p.getByText('Feststellungen (1)').waitFor();
  await shot('07-walk-protocol');

  step('defects filter');
  await p.goto(BASE + '/maengel');
  await p.getByRole('tab', { name: 'Begehungen' }).click();
  await p.getByText('Palette im Fluchtweg Achse 7').waitFor();
  await shot('08-defects-walk');

  step('task share + external');
  await p.goto(BASE + '/aufgaben');
  await p.getByText(/Mangel beheben/).first().click();
  const link = await p.locator('input[readonly]').inputValue();
  await shot('09-task-share', false);
  await p.keyboard.press('Escape');
  const ext = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const ep = await ext.newPage();
  await ep.goto(link);
  await ep.getByText('Als erledigt melden').waitFor();
  await ep.getByLabel('Rückmeldung').fill('Dichtung getauscht, Tür schließt sauber.');
  await ep.screenshot({ path: OUT + '10-external.png', fullPage: true });
  await ep.getByRole('button', { name: 'Als erledigt melden' }).click();
  await ep.getByText('Als erledigt gemeldet').waitFor();
  await ext.close();

  step('import');
  fs.writeFileSync(OUT + 'import.csv', '﻿Objekt;Gebäude;Art;Standort;Etage;Hersteller;Letzte Prüfung\nKita Sonnenschein;Hauptgebäude;Feuerschutztür;Flur EG;EG;Hörmann;12.03.2026\nKita Sonnenschein;Hauptgebäude;Rauchmelder;Schlafraum;EG;Hekatron;\nKita Sonnenschein;Hauptgebäude;Aufzug;Flur;EG;;\n');
  await p.goto(BASE + '/import');
  await p.locator('input[type=file]').setInputFiles(OUT + 'import.csv');
  await p.getByText('2 Zeilen bereit').waitFor();
  await shot('11-import-preview');
  await p.getByRole('button', { name: '2 importieren' }).click();
  await p.getByText('2 Elemente importiert').first().waitFor();

  step('blank label');
  await p.goto(BASE + '/druck/etiketten');
  await p.getByRole('tab', { name: 'Blanko-Etiketten' }).click();
  await p.waitForTimeout(800);
  await shot('12-blank-labels');
  const blank = (await p.locator('p.font-mono').first().textContent()).trim();
  await p.goto(BASE + '/e/' + blank);
  await p.getByText('noch keinem Element zugeordnet').waitFor();
  await shot('13-unknown-label');
  await p.locator('ul button').first().click();
  await p.waitForURL(/\/elemente\//);
  await p.getByText(blank).waitFor();
  await shot('14-asset-label');

  step('offline');
  await p.goto(BASE + '/offline');
  await p.getByRole('combobox').first().selectOption({ label: 'Seniorenresidenz Elbblick' });
  await p.waitForTimeout(600);
  await p.getByRole('combobox').nth(1).selectOption({ label: 'Haus B' });
  await p.getByRole('button', { name: 'Laden', exact: true }).click();
  await p.getByText(/Elemente gespeichert/).waitFor();
  await ctx.setOffline(true);
  await p.waitForTimeout(300);
  await p.getByText('Treppenhaus B').first().click();
  await p.waitForURL(/\/offline\/pruefen\//);
  await p.getByRole('button', { name: 'Rest i. O.' }).click();
  await p.locator('canvas').scrollIntoViewIfNeeded(); await p.mouse.wheel(0, 200); await p.waitForTimeout(300);
  const c2 = await p.locator('canvas').boundingBox();
  await p.mouse.move(c2.x + 30, c2.y + 80); await p.mouse.down(); await p.mouse.move(c2.x + 200, c2.y + 60, { steps: 6 }); await p.mouse.up();
  await p.waitForTimeout(1000);
  await shot('15-offline-run');
  await p.getByRole('button', { name: 'Abschließen (offline)' }).click();
  await p.waitForURL(/\/offline$/);
  await p.getByText('1 Prüfungen noch nicht übertragen').waitFor();
  await shot('16-offline-queue');
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.getByText('Alles übertragen').waitFor({ timeout: 15000 });

  step('subcontractors + dashboard');
  await p.goto(BASE + '/subunternehmer'); await p.waitForTimeout(600); await shot('17-subs');
  await p.goto(BASE + '/'); await p.getByText('Prüfstatus').waitFor(); await shot('18-dashboard-after');

  step('mobile');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  for (const [n, r] of [['m1-dashboard', '/'], ['m2-walks', '/begehungen'], ['m3-offline', '/offline'], ['m4-subs', '/subunternehmer'], ['m5-import', '/import']]) {
    await mp.goto(BASE + r); await mp.waitForTimeout(900);
    const w = await mp.evaluate(() => document.documentElement.scrollWidth);
    if (w > 391) errors.push(`overflow ${r} ${w}`);
    await mp.screenshot({ path: OUT + n + '.png', fullPage: true });
  }
  await mp.goto(BASE + '/objekte'); await mp.getByRole('link', { name: 'Seniorenresidenz Elbblick' }).click();
  await mp.getByRole('tab', { name: /Grundrisse/ }).click(); await mp.getByRole('link', { name: /Erdgeschoss Haus A/ }).click();
  await mp.waitForTimeout(1200); await mp.screenshot({ path: OUT + 'm6-plan.png', fullPage: true });

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'OK no errors');
  if (errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
