// E2E 17-verwaltung: Verwaltungsseiten im Designsystem v2 – Einstellungen (Speichern-Leiste, Datenschutz-Sprung,
// MCP-Anleitung), Team-Dialog mit Rolle, Glocke mit Filter, Hilfe-Leerzustand, Import-Schritte, 390 px ohne Überlauf. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '17-verwaltung') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

(async () => {
  if (process.env.PROD) throw new Error('17-verwaltung nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Einstellungen: Reiter, Speichern-Leiste erscheint nur bei Änderungen');
  await p.goto(BASE + '/einstellungen?tab=company');
  await p.getByLabel('Firmenname').waitFor();
  check((await p.getByRole('button', { name: 'Speichern', exact: true }).count()) === 0, 'ohne Änderung keine Speichern-Leiste');
  const before = (await api('/account/me')).json.tenant.website;
  await p.getByLabel('Website').fill('https://e2e.example.com');
  await p.getByText('Ungespeicherte Änderungen').waitFor();
  await p.getByRole('button', { name: 'Verwerfen' }).click();
  check((await p.getByLabel('Website').inputValue()) === before, 'Verwerfen stellt den Wert wieder her');
  check((await p.getByText('Ungespeicherte Änderungen').count()) === 0, 'Leiste nach Verwerfen weg');
  await p.getByRole('switch', { name: /Aufgaben für schwere Mängel/ }).click();
  await p.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('Gespeichert').first().waitFor();
  check((await api('/account/me')).json.tenant.autoTasks === false, 'Automatisierung per Schalter gespeichert');
  await p.getByRole('switch', { name: /Aufgaben für schwere Mängel/ }).click();
  await p.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('Ungespeicherte Änderungen').waitFor({ state: 'detached' });
  check((await api('/account/me')).json.tenant.autoTasks === true, 'Automatisierung wieder an');

  step('Alter Link ?tab=privacy zeigt Konto mit Datenschutz');
  await p.goto(BASE + '/einstellungen?tab=privacy');
  await p.getByRole('heading', { name: 'Datenschutz' }).waitFor();
  check(await p.getByRole('tab', { name: 'Konto', selected: true }).isVisible(), 'Reiter Konto aktiv');

  step('API: MCP-Anleitung (OAuth zuerst) mit Beispielen');
  await p.goto(BASE + '/einstellungen?tab=api');
  const mcp = await p.getByLabel('MCP-Adresse').inputValue();
  check(mcp === BASE + '/api/mcp', `MCP-Adresse (${mcp})`);
  check((await p.getByText('Adresse in Claude eintragen').count()) === 1 && (await p.getByText('Verbinden und freigeben').count()) === 1, 'Schritte sichtbar');
  check((await p.getByRole('list', { name: 'Beispiele' }).getByRole('listitem').count()) === 3, 'drei Beispielsätze');
  check(!(await p.content()).includes('/api/mcp/k/'), 'keine Adresse mit Schlüssel im Pfad mehr');
  await p.getByText('Werkzeuge, Befehle und Claude Code').click();
  await p.getByRole('list', { name: 'MCP-Werkzeuge' }).getByText('capture', { exact: true }).waitFor();
  check((await p.getByRole('list', { name: 'MCP-Werkzeuge' }).getByRole('listitem').count()) === 15, '15 Werkzeuge gelistet');
  await p.screenshot({ path: OUT + '01-api.png', fullPage: true });

  step('Team: Rolle im Dialog ändern');
  const members = (await api('/account/members')).json.members;
  const jonas = members.find((m) => m.name === 'Jonas Weber');
  await p.goto(BASE + '/team');
  await p.getByRole('button', { name: 'Zugriff und Status von Jonas Weber' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Rolle').selectOption('viewer');
  check(await dlg.getByRole('tab', { name: 'Alle Objekte' }).isVisible(), 'Bereich auch für Lesezugriff');
  check((await dlg.getByText('Darf neue Elemente anlegen').count()) === 0, 'Anlegerecht nur für Prüfer');
  await dlg.getByRole('button', { name: 'Speichern' }).click();
  await dlg.waitFor({ state: 'detached' });
  check((await api('/account/members')).json.members.find((m) => m.id === jonas.id).role === 'viewer', 'Rolle gespeichert');
  await api(`/account/members/${jonas.id}`, { method: 'PATCH', data: { role: jonas.role } });
  await p.getByRole('button', { name: 'Weitere Aktionen für Jonas Weber' }).click();
  check(await p.getByRole('menuitem', { name: 'Aus dem Workspace entfernen' }).isVisible(), 'Entfernen im Menü');
  await p.keyboard.press('Escape');

  step('Glocke: Ungelesen-Filter und Leerzustand');
  await p.getByRole('button', { name: /^Benachrichtigungen/ }).first().click();
  const panel = p.getByRole('dialog', { name: 'Benachrichtigungen' });
  await panel.waitFor();
  const unread = (await api('/notifications')).json.unread;
  if (unread > 0) {
    await panel.getByRole('button', { name: 'Alle gelesen' }).click();
    await panel.getByRole('tab', { name: /Ungelesen/ }).click();
    await panel.getByText('Alles gelesen').waitFor();
    check((await api('/notifications')).json.unread === 0, 'alle gelesen');
  }
  await p.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });

  step('Hilfe: Leerzustand mit Aktion');
  await p.goto(BASE + '/hilfe');
  await p.getByPlaceholder('Hilfe durchsuchen …').fill('xyzgibtsnicht');
  await p.getByText('Nichts gefunden').waitFor();
  await p.getByRole('button', { name: 'Suche leeren' }).last().click();
  await p.getByRole('heading', { name: 'Anleitungen' }).waitFor();

  step('Import: Schritte');
  await p.goto(BASE + '/import');
  check((await p.locator('[aria-current="step"]').innerText()).includes('Datei wählen'), 'Schritt 1 aktiv');

  step('Handybreite 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'de-DE', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(e.message));
  const paths = ['profile', 'notifications', 'company', 'templates', 'tasks', 'api', 'activity'].map((t) => `/einstellungen?tab=${t}`);
  for (const path of [...paths, '/team', '/subunternehmer', '/import', '/berichte', '/hilfe', '/rechtliches/privacy']) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `kein Überlauf ${path} (${over}px)`);
  }
  // Berichte: Text-Knöpfe (ghost) beginnen bündig mit der Textkante der Zeile
  await mp.goto(BASE + '/berichte');
  const row = mp.locator('li', { has: mp.getByText('Compliance-Übersicht', { exact: true }) });
  const titleX = (await row.getByText('Compliance-Übersicht', { exact: true }).boundingBox()).x;
  const iconX = (await row.getByRole('link', { name: 'Ansehen' }).locator('svg').boundingBox()).x;
  check(Math.abs(iconX - titleX) <= 1, `Berichte: „Ansehen“ bündig mit dem Text (${iconX} / ${titleX})`);
  const backupRow = mp.locator('li', { has: mp.getByText('JSON-Backup', { exact: true }) });
  const bx = (await backupRow.getByRole('button', { name: 'Herunterladen' }).locator('svg').boundingBox()).x;
  check(Math.abs(bx - (await backupRow.getByText('JSON-Backup', { exact: true }).boundingBox()).x) <= 1, `Berichte: „Herunterladen“ bündig (${bx})`);
  await mp.goto(BASE + '/');
  await mp.getByRole('button', { name: /^Benachrichtigungen/ }).first().click();
  const box = await mp.getByRole('dialog', { name: 'Benachrichtigungen' }).boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390, `Glocke passt auf das Handy (${JSON.stringify(box)})`);
  await mp.screenshot({ path: OUT + 'm1-glocke.png' });
  await m.close();

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
