// E2E: API-Schlüssel, Speicherverbrauch, Sprache/Zeitzone
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:5173';
const PROD = !!process.env.PROD;
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '06-api-locale') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => { if (!ok) { fail.push(m); console.log('  ✗', m); } };
const bearer = (key, path, opts = {}) =>
  fetch(BASE + '/api' + path, { method: opts.method ?? 'GET', headers: { authorization: `Bearer ${key}`, ...(opts.body ? { 'content-type': 'application/json' } : {}) }, body: opts.body && JSON.stringify(opts.body) });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => d.accept());
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    if (!r.ok()) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
    return (r.headers()['content-type'] ?? '').includes('json') ? r.json() : r.body();
  };
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('API-Schlüssel anlegen (Oberfläche)');
  await p.goto(BASE + '/einstellungen?tab=api');
  await p.getByRole('button', { name: 'Neuer Schlüssel' }).click();
  await p.getByLabel('Name', { exact: true }).fill('E2E Lesezugriff');
  await p.getByRole('button', { name: 'Erstellen' }).click();
  const readKey = await p.getByLabel('API-Schlüssel').inputValue();
  check(/^pk_[A-Za-z0-9_-]{40,}$/.test(readKey), 'Schlüsselformat');
  await p.screenshot({ path: OUT + '01-key-created.png' });
  await p.getByRole('button', { name: 'Fertig' }).click();
  await p.screenshot({ path: OUT + '02-api-tab.png', fullPage: true });

  step('Zugriff mit Leseschlüssel');
  let r = await bearer(readKey, '/assets?due=overdue');
  check(r.status === 200 && Array.isArray(await r.json()), `GET /assets (${r.status})`);
  r = await bearer(readKey, '/properties');
  check(r.status === 200, 'GET /properties');
  const props = await r.json();
  r = await bearer(readKey, '/assets', { method: 'POST', body: { buildingId: 'x', category: 'fire_door' } });
  check(r.status === 403, `Schreiben mit Leseschlüssel verboten (${r.status})`);
  r = await bearer(readKey, '/account/me');
  check(r.status === 403, `Konto per API gesperrt (${r.status})`);
  r = await bearer(readKey, '/notifications');
  check(r.status === 403, `Benachrichtigungen per API gesperrt (${r.status})`);
  r = await bearer('pk_falsch_' + 'x'.repeat(40), '/assets');
  check(r.status === 401, `falscher Schlüssel (${r.status})`);
  r = await fetch(BASE + '/api/assets', { headers: { authorization: 'Bearer ' } });
  check(r.status === 401, `leerer Schlüssel (${r.status})`);

  step('Schreibschlüssel');
  const { key: writeKey, id: writeId } = await api('/account/api-keys', { data: { name: 'E2E CAFM', scope: 'write', expiresInDays: 1 } });
  if (!PROD) {
    const detail = await (await bearer(writeKey, '/properties/' + props[0].id)).json();
    r = await bearer(writeKey, '/assets', { method: 'POST', body: { buildingId: detail.buildings[0].id, category: 'extinguisher', location: 'Per API angelegt', floor: 'EG' } });
    check(r.status === 200, `Element per API anlegen (${r.status})`);
    const act = await api('/account/activity').catch(() => null);
    if (act) check(JSON.stringify(act).includes('API: E2E CAFM'), 'Aktivität nennt den Schlüssel');
  }
  r = await bearer(writeKey, '/export/backup.json');
  check(r.status === 403, `Backup (nur Admin) per API gesperrt (${r.status})`);
  await api('/account/api-keys/' + writeId, { method: 'DELETE' });
  r = await bearer(writeKey, '/assets');
  check(r.status === 401, `widerrufener Schlüssel (${r.status})`);
  const keys = await api('/account/api-keys');
  check(keys.some((k) => k.id === writeId && k.revokedAt) && keys.some((k) => k.name === 'E2E Lesezugriff' && k.lastUsedAt), 'Liste mit Status und letzter Nutzung');
  // aufräumen: Leseschlüssel widerrufen
  for (const k of keys.filter((k) => !k.revokedAt && k.name.startsWith('E2E'))) await api('/account/api-keys/' + k.id, { method: 'DELETE' });

  step('Speicherverbrauch');
  await p.goto(BASE + '/einstellungen?tab=company');
  await p.getByRole('heading', { name: 'Speicher' }).or(p.getByText('Speicher', { exact: true })).first().waitFor();
  const st = await api('/account/storage');
  console.log('  ', st.totalBytes, 'Bytes,', st.files, 'Dateien', JSON.stringify(st.groups));
  check(st.files >= 1 && (PROD ? st.groups.logo.files === 1 : true) && typeof st.groups.photos.bytes === 'number', 'Speicher-Auswertung');
  await p.getByText('Fotos & Dokumente').scrollIntoViewIfNeeded();
  await p.screenshot({ path: OUT + '03-storage.png', fullPage: true });

  step('Sprache Englisch + Zeitzone New York');
  await p.getByLabel('Sprache der Dokumente').selectOption('en');
  await p.getByLabel('Zeitzone').selectOption('America/New_York');
  await p.getByRole('button', { name: 'Speichern' }).first().click();
  await p.getByText('Gespeichert').first().waitFor();
  const me = await api('/account/me');
  check(me.tenant.language === 'en' && me.tenant.timeZone === 'America/New_York', 'Sprache/Zeitzone gespeichert');
  const done = await api('/inspections?status=submitted');
  const target = (done.items ?? done)[0];
  await p.goto(BASE + '/druck/protokoll/' + target.id);
  const [d] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'PDF', exact: true }).click()]);
  await d.saveAs(OUT + 'protocol-en.pdf');
  const text = execFileSync('pdftotext', ['-layout', OUT + 'protocol-en.pdf', '-']).toString();
  check(/Inspection report/.test(text) && /Checkpoints/.test(text) && /Overall result/i.test(text) && /Page 1 of/.test(text), 'PDF auf Englisch');
  check(!/Prüfpunkte|Gesamtergebnis/.test(text), 'keine deutschen Beschriftungen im PDF');
  console.log('  ', text.split('\n').filter((l) => l.trim()).slice(1, 4).map((l) => l.trim()).join(' | '));
  const xlsx = await api('/export/assets.xlsx');
  fs.writeFileSync(OUT + 'items.xlsx', xlsx);
  const readXlsx = require('read-excel-file/node');
  const sheets = await readXlsx(fs.readFileSync(OUT + 'items.xlsx'));
  const table = Array.isArray(sheets[0]) ? sheets : sheets[0].data;
  check(table[0][0] === 'Property' && table.slice(1).some((row) => /^(Fire door|Fire extinguisher)$/.test(row[2])), 'Excel auf Englisch');
  // Zeitzone wirkt in der Oberfläche: Uhrzeit der Prüfung in New York
  await p.goto(BASE + '/pruefungen?tab=done');
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: OUT + '04-tz.png' });

  step('zurück auf Deutsch / Berlin');
  await api('/account/company', { method: 'PATCH', data: { name: me.tenant.name, address: me.tenant.address, phone: me.tenant.phone, email: me.tenant.email, website: me.tenant.website, language: 'de', timeZone: 'Europe/Berlin' } });

  step('mobil');
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/einstellungen?tab=api', '/einstellungen?tab=company']) {
    await p.goto(BASE + path);
    await p.waitForLoadState('networkidle');
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 391, `kein Überlauf ${path} (${w})`);
  }
  await p.screenshot({ path: OUT + '05-mobile-api.png', fullPage: true });

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length || errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.log('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
