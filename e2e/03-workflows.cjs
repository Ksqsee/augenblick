// E2E für die neuen Funktionen (Prüfarten, Anhänge, PDF/ZIP, Archiv, Aufgaben, Benachrichtigungen, Konto, Hilfe …)
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '03-workflows') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const PROD = !!process.env.PROD;
const check = (ok, m) => { if (!ok) { fail.push(m); console.log('  ✗', m); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => d.accept());
  const shot = async (n, full = true) => { await p.waitForTimeout(400); await p.screenshot({ path: OUT + n + '.png', fullPage: full }); };
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    if (!r.ok()) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), fn()]); const f = OUT + d.suggestedFilename(); await d.saveAs(f); return { name: d.suggestedFilename(), size: fs.statSync(f).size }; };

  step('login + Glocke');
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();
  const notes = await api('/notifications');
  check(PROD || (notes.items ?? notes).length >= 6, 'Benachrichtigungen geseedet');
  await p.getByRole('button', { name: /Benachrichtigungen/ }).first().click();
  if (!PROD) await p.getByText('Kritischer Mangel festgestellt').waitFor();
  await shot('01-bell', false);
  await p.keyboard.press('Escape');

  step('Einstellungen');
  for (const tab of ['profile', 'notifications', 'privacy', 'company', 'templates', 'tasks', 'activity']) {
    await p.goto(BASE + '/einstellungen?tab=' + tab);
    await p.waitForLoadState('networkidle');
    await shot('02-settings-' + tab);
  }
  await p.goto(BASE + '/einstellungen?tab=templates');
  await p.getByText('Rauchschutzvorhang').first().waitFor();
  await p.goto(BASE + '/einstellungen?tab=company');
  await p.waitForLoadState('networkidle');
  check(await p.locator('img[alt*="Logo" i]').count() > 0, 'Logo im Firmenprofil sichtbar');
  await p.goto(BASE + '/einstellungen?tab=profile');
  await p.getByText(/Sitzung|Geräte/).first().waitFor();

  step('Prüfarten am Feuerlöscher');
  const assets = await api('/assets');
  const ext = assets.find((a) => a.category === 'extinguisher' && a.schedules?.inner);
  check(!!ext, 'Feuerlöscher mit innerer Prüfung vorhanden');
  await p.goto(BASE + '/elemente/' + ext.id);
  await p.getByText('Innere Prüfung').first().waitFor();
  await shot('03-asset-schedules');

if (!PROD) {
  step('Anhang hochladen');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.locator('input[type=file][accept*="application/pdf"]').setInputFiles([{ name: 'typenschild.png', mimeType: 'image/png', buffer: png }]);
  await p.getByText('typenschild.png').first().waitFor({ timeout: 20000 });
  const detail = await api('/assets/' + ext.id);
  check(detail.attachments?.length === 1, 'Anhang gespeichert');

  step('Prüfung je Prüfart starten');
  const started = await api(`/assets/${ext.id}/inspections`, { data: { schedule: 'inner' } });
  const insp = await api('/inspections/' + (started.id ?? started.inspection?.id));
  check(insp.schedule === 'inner', 'Prüfung mit Prüfart „inner“');
  await p.goto(BASE + '/pruefung/' + insp.id);
  await p.getByText(/Innere Prüfung/).first().waitFor();
  await shot('04-run-inner');

}
    step('Protokoll: PDF, Archiv, wieder öffnen');
  const done = await api('/inspections?status=done');
  const list = done.items ?? done;
  const target = list.find((i) => i.status === 'submitted') ?? list[0];
  await p.goto(BASE + '/druck/protokoll/' + target.id);
  await p.getByRole('button', { name: 'PDF', exact: true }).waitFor();
  const pdf = await dl(() => p.getByRole('button', { name: 'PDF', exact: true }).click());
  console.log('  PDF', pdf.name, pdf.size);
  check(pdf.size > 3000 && pdf.name.endsWith('.pdf'), 'Protokoll-PDF');
  await p.getByRole('button', { name: 'Archivieren' }).click();
  await p.getByRole('button', { name: 'Aus Archiv holen' }).waitFor();
  await p.getByRole('button', { name: 'Aus Archiv holen' }).click();
  await p.getByRole('button', { name: 'Archivieren' }).waitFor();
  if (!PROD) {
  await p.getByRole('button', { name: 'Wieder öffnen' }).click();
  await p.waitForURL(/\/pruefung\//);
  const reopened = await api('/inspections/' + target.id);
  check(reopened.status === 'draft', 'Prüfung wieder geöffnet');
  }

  step('Prüfungen: Auswahl als ZIP');
  await p.goto(BASE + '/pruefungen');
  await p.getByRole('tab', { name: 'Durchgeführt' }).or(p.getByRole('radio', { name: 'Durchgeführt' })).or(p.getByRole('button', { name: 'Durchgeführt' })).first().click();
  const boxes = p.locator('input[type=checkbox][aria-label$="auswählen"]');
  await boxes.first().waitFor();
  for (let k = 0; k < 3; k++) await boxes.nth(k).check();
  await shot('05-inspections-bulk', false);
  const zip = await dl(() => p.getByRole('button', { name: /PDFs als ZIP/ }).click());
  console.log('  ZIP', zip.name, zip.size);
  check(zip.size > 5000 && zip.name.endsWith('.zip'), 'ZIP-Export');

  step('Berichte: Compliance-PDF + Backup');
  await p.goto(BASE + '/berichte');
  const comp = await dl(() => p.getByRole('button', { name: 'PDF', exact: true }).first().click());
  check(comp.size > 2000, 'Compliance-PDF');
  const backup = await api('/export/backup.json');
  check(Array.isArray(backup.assets) && backup.assets.length > 50, 'JSON-Backup');
  await shot('06-reports');

  step('Aufgaben: Labels, Kommentare, Statistik');
  await p.goto(BASE + '/aufgaben');
  await p.getByText('Dringend', { exact: true }).locator('visible=true').first().waitFor();
  await shot('07-tasks');
  const tasks = await api('/tasks');
  const withComments = (tasks.items ?? tasks).find((t) => (t.comments ?? t.commentCount ?? 0) > 0);
  check(!!withComments, 'Aufgabe mit Kommentaren');
  await p.goto(BASE + '/aufgaben?id=' + withComments.id);
  const cm = await api(`/tasks/${withComments.id}/comments`);
  await p.getByText(cm[0].body).first().waitFor();
  if (!PROD) {
  await p.getByPlaceholder(/Kommentar/).fill('E2E-Kommentar');
  await p.getByRole('button', { name: 'Senden' }).click();
  await p.getByText('E2E-Kommentar').waitFor();
  }
  await shot('08-task-detail', false);
  const stats = await api('/tasks/stats');
  check(stats && typeof stats === 'object', 'Aufgaben-Statistik');

  step('Objekt: Brandschutzbeauftragte');
  await p.goto(BASE + '/objekte');
  await p.getByRole('link', { name: 'Grundschule Am Stadtpark' }).click();
  await p.getByText('Sabine Kröger').first().waitFor();
  await shot('09-property-officers');

  step('Eigene Elementart');
  const rsv = assets.find((a) => a.code === 'RSV-001');
  check(!!rsv, 'RSV-Element vorhanden');
  await p.goto(BASE + '/elemente/' + rsv.id);
  await p.getByText('Rauchschutzvorhang').first().waitFor();
  await shot('10-custom-asset');

  step('Hilfe');
  await p.goto(BASE + '/hilfe');
  await p.getByPlaceholder('Hilfe durchsuchen …').fill('ZIP');
  await p.getByText(/gesammelt als ZIP/).first().waitFor();

if (!PROD) {
  step('Team: Passwort-Link');
  await p.goto(BASE + '/team');
  await p.getByRole('button', { name: 'Passwort-Link für Aylin Demir' }).click();
  const url = await p.locator('input[readonly]').first().inputValue();
  check(url.includes('/passwort/'), 'Reset-Link erzeugt');
  const p2 = await (await b.newContext({ locale: 'de-DE' })).newPage();
  await p2.goto(url);
  await p2.locator('input[type=password]').first().fill(PW);
  if (await p2.locator('input[type=password]').count() > 1) await p2.locator('input[type=password]').nth(1).fill(PW);
  await p2.getByRole('button', { name: /speichern|setzen|Passwort/i }).last().click();
  await p2.waitForURL((u) => !u.pathname.startsWith('/passwort'), { timeout: 15000 }).catch(() => {});
  await p2.screenshot({ path: OUT + '11-reset.png' });

}
    step('DSGVO-Export');
  const exp = await api('/account/export');
  check(!!exp.user || !!exp.profile, 'DSGVO-Export');

  step('Rechtstexte-Gate (Viewer ohne Zustimmung)');
  const p3 = await (await b.newContext({ locale: 'de-DE' })).newPage();
  await p3.goto(BASE + '/login');
  await p3.getByLabel('E-Mail').fill('lesen@example.com');
  await p3.getByLabel('Passwort').fill(PW);
  await p3.getByRole('button', { name: 'Anmelden' }).click();
  await p3.waitForTimeout(2500);
  await p3.screenshot({ path: OUT + '12-legal.png' });
  const gate = p3.getByRole('dialog', { name: /Rechtstexte/ });
  if (await gate.count()) {
    await gate.getByRole('checkbox').first().check().catch(() => {});
    await gate.getByRole('button', { name: /Zustimmen|Akzeptieren|bestätigen/i }).click();
    await gate.waitFor({ state: 'detached' });
    console.log('  Gate bestätigt');
  } else console.log('  (kein Gate – Viewer hat bereits zugestimmt)');

  step('mobil');
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/aufgaben', '/einstellungen?tab=company', '/elemente/' + ext.id, '/hilfe', '/pruefungen']) {
    await p.goto(BASE + path);
    await p.waitForLoadState('networkidle');
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 391, `kein Überlauf ${path} (${w})`);
  }
  await shot('13-mobile-tasks');

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length || errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.log('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
