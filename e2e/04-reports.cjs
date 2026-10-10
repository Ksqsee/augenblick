// E2E: Objektbericht, Excel-Export/-Import, Prüfungs-Reiter + Prüfart-Filter, Berichtsarchiv, Nicht stören
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const readXlsx = require('read-excel-file/node');
const BASE = process.env.BASE || 'http://localhost:5173';
const PROD = !!process.env.PROD;
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '04-reports') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => { if (!ok) { fail.push(m); console.log('  ✗', m); } };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => d.accept());
  const shot = async (n, full = true) => { await p.waitForTimeout(400); await p.screenshot({ path: OUT + n + '.png', fullPage: full }); };
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    if (!r.ok()) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
    return (r.headers()['content-type'] ?? '').includes('json') ? r.json() : r.body();
  };
  const dl = async (fn) => { const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), fn()]); const f = OUT + d.suggestedFilename(); await d.saveAs(f); return { name: d.suggestedFilename(), size: fs.statSync(f).size, file: f }; };

  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Prüfungen: Nicht prüfbar, Neue Elemente, Prüfart-Filter');
  await p.goto(BASE + '/pruefungen?tab=not_inspectable');
  await p.waitForLoadState('networkidle');
  const ni = await api('/assets?due=not_inspectable');
  check(ni.every((a) => a.lastResult === 'not_inspectable'), 'Filter nicht prüfbar');
  await shot('01-not-inspectable');
  const newA = await api('/assets?due=new');
  console.log('  neue Elemente', newA.length, '· nicht prüfbar', ni.length);
  await p.goto(BASE + '/pruefungen?tab=new');
  await p.waitForLoadState('networkidle');
  await shot('02-new');
  await p.goto(BASE + '/pruefungen?tab=overdue');
  await p.getByRole('group', { name: 'Nach Prüfart filtern' }).getByRole('button', { name: 'Innere Prüfung' }).click();
  await p.waitForURL(/pruefart=inner/);
  await p.waitForLoadState('networkidle');
  const inner = await api('/assets?due=overdue&schedule=inner');
  check(inner.every((a) => a.category === 'extinguisher'), 'Prüfart-Filter nur Feuerlöscher');
  const allOverdue = await api('/assets?due=overdue');
  check(inner.length <= allOverdue.length, 'Prüfart-Filter schränkt ein');
  console.log('  überfällig gesamt', allOverdue.length, '· innere Prüfung', inner.length);
  await shot('03-filter-inner');

  step('Excel-Export');
  await p.goto(BASE + '/berichte');
  const x = await dl(() => p.getByRole('button', { name: 'Excel', exact: true }).click());
  console.log('  ', x.name, x.size);
  const sheets = await readXlsx(fs.readFileSync(x.file));
  const table = Array.isArray(sheets[0]) ? sheets : sheets[0].data;
  check(table[0][0] === 'Objekt' && table[0][2] === 'Art', 'Excel-Kopfzeile');
  check(table.length - 1 === (await api('/assets')).length, 'Excel enthält alle Elemente');
  check(table.slice(1).some((r) => r[10] instanceof Date), 'Datumszellen als Datum');

  step('Excel wieder importieren (Vorschau)');
  await p.goto(BASE + '/import');
  await p.locator('input[type=file]').first().setInputFiles(x.file);
  await p.waitForTimeout(1500);
  await shot('04-import-preview');
  const body = await p.locator('main').innerText();
  check(!/Spalte fehlt|Unbekannte Art/.test(body), 'Import erkennt Excel-Export');

  step('Objektbericht');
  await p.goto(BASE + '/objekte');
  await p.getByRole('link', { name: 'Grundschule Am Stadtpark' }).click();
  const pr = await dl(() => p.getByRole('button', { name: 'Objektbericht' }).click());
  console.log('  ', pr.name, pr.size);
  check(pr.size > 5000 && pr.name.startsWith('Objektbericht_Grundschule'), 'Objektbericht-PDF');
  await p.getByText('Im Berichtsarchiv gespeichert').waitFor();

  step('Berichtsarchiv');
  await p.goto(BASE + '/berichte');
  const comp = await dl(() => p.getByRole('button', { name: 'PDF', exact: true }).first().click());
  check(comp.size > 2000, 'Compliance-PDF');
  await p.getByText('Im Berichtsarchiv gespeichert').waitFor();
  const archive = await api('/reports');
  check(archive.some((r) => r.kind === 'property') && archive.some((r) => r.kind === 'compliance'), 'Archiv enthält Berichte');
  await p.getByRole('heading', { name: 'Erstellte Berichte' }).scrollIntoViewIfNeeded();
  await shot('05-archive');
  const again = await dl(() => p.getByRole('link', { name: /Objektbericht Grundschule Am Stadtpark herunterladen/ }).first().click());
  check(again.size === pr.size, 'Archiv-Download identisch');
  if (!PROD) {
    const before = archive.length;
    await p.getByRole('button', { name: /Compliance-Übersicht .* löschen/ }).first().click();
    await p.getByText('Bericht gelöscht').waitFor();
    check((await api('/reports')).length === before - 1, 'Bericht gelöscht');
  }

  step('ZIP landet im Archiv');
  await p.goto(BASE + '/pruefungen?tab=done');
  const boxes = p.locator('input[type=checkbox][aria-label$="auswählen"]');
  await boxes.first().waitFor();
  for (let k = 0; k < 2; k++) await boxes.nth(k).check();
  await dl(() => p.getByRole('button', { name: /PDFs als ZIP/ }).click());
  await p.waitForTimeout(1500);
  check((await api('/reports')).some((r) => r.kind === 'protocols'), 'ZIP im Archiv');

  step('Nicht stören');
  await p.goto(BASE + '/einstellungen?tab=notifications');
  await p.getByText('Ruhezeit verwenden').click();
  await p.getByLabel('Von', { exact: true }).fill('21:30');
  await p.getByLabel('Bis', { exact: true }).fill('06:45');
  await p.getByText('Am Wochenende ganztägig ruhig').click();
  await p.getByRole('button', { name: 'Speichern' }).last().click();
  await p.getByText('Gespeichert').first().waitFor();
  const st = await api('/notifications/settings');
  check(st.quiet.enabled && st.quiet.from === '21:30' && st.quiet.to === '06:45' && st.quiet.weekends, 'Ruhezeit gespeichert');
  await shot('06-quiet');
  if (PROD) await api('/notifications/quiet', { method: 'PUT', data: { ...st.quiet, enabled: false, weekends: false, from: '22:00', to: '07:00' } });

  step('mobil');
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/berichte', '/pruefungen?tab=overdue', '/einstellungen?tab=notifications']) {
    await p.goto(BASE + path);
    await p.waitForLoadState('networkidle');
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 391, `kein Überlauf ${path} (${w})`);
  }
  await shot('07-mobile-reports');

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length || errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.log('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
