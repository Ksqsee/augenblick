// E2E 16-customer-share: Kunden-Freigabe je Objekt – Link erstellen (UI), öffentliche Ansicht ohne Konto (1360/390 px),
// keine internen Daten, Mängel ausblendbar, Widerruf, Rechte. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '16-customer-share') + '/';
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
  if (process.env.PROD) throw new Error('16-customer-share nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    let json = null;
    try {
      json = JSON.parse(await r.text());
    } catch {
      /* kein JSON */
    }
    return { status: r.status(), json };
  };
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(process.env.DEMO_PASSWORD);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Link in der Objektansicht erstellen');
  const props = (await api('/properties')).json;
  const prop = props.find((x) => x.assets > 0) ?? props[0];
  await p.goto(`${BASE}/objekte/${prop.id}`);
  await p.getByRole('button', { name: 'Für Kunden freigeben' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel(/Für wen/).fill('Hausverwaltung Test');
  await dlg.getByRole('button', { name: 'Link erstellen' }).click();
  const link = await dlg.getByLabel('Kunden-Link').inputValue();
  check(/\/kunde\/[A-Za-z0-9_-]{30,}$/.test(link), `Link (${link})`);
  await dlg.getByText('Hausverwaltung Test').waitFor();
  await p.screenshot({ path: OUT + '01-dialog.png' });

  step('Öffentliche Ansicht ohne Anmeldung');
  const tok = link.split('/kunde/')[1];
  const pub = await (await fetch(`${BASE}/api/public/property/${tok}`)).json();
  check(pub.property.name === prop.name && typeof pub.counts.assets === 'number', 'Daten der Ansicht');
  const raw = JSON.stringify(pub);
  check(!/tenant_?id|"id"|photo|inspector|signature|email":"demo@/i.test(raw.replace(/"email":"[^"]*"/, '')), 'keine internen IDs, Fotos oder Personen');
  check(Array.isArray(pub.defects), 'Mängel enthalten (Standard)');
  const anon = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const ap = await anon.newPage();
  ap.on('pageerror', (e) => errors.push(e.message));
  await ap.goto(link);
  await ap.getByRole('heading', { name: prop.name }).waitFor();
  check(await ap.getByText('Fristgerecht geprüft').isVisible(), 'Prüfquote sichtbar');
  check(await ap.getByRole('progressbar', { name: 'Prüfquote' }).isVisible(), 'Fortschrittsbalken');
  await ap.screenshot({ path: OUT + '02-kunde.png', fullPage: true });
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const mp = await m.newPage();
  await mp.goto(link);
  await mp.getByRole('heading', { name: prop.name }).waitFor();
  check((await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'Kunden-Ansicht 390 px ohne Überlauf');
  await mp.screenshot({ path: OUT + 'm1-kunde.png', fullPage: true });

  step('Mängel ausblenden, Widerruf, ungültige Links');
  const noDef = (await api(`/properties/${prop.id}/shares`, { data: { label: 'ohne Mängel', showDefects: false } })).json.token;
  check((await (await fetch(`${BASE}/api/public/property/${noDef}`)).json()).defects === null, 'Mängel ausgeblendet');
  const list = (await api(`/properties/${prop.id}/shares`)).json;
  check(list.length === 2 && list.some((s) => s.views >= 1), `Liste mit Aufrufzähler (${list.map((s) => s.views)})`);
  check(!JSON.stringify(list).includes(tok), 'Token nicht erneut abrufbar');
  const first = list.find((s) => s.label === 'Hausverwaltung Test');
  check((await api(`/shares/${first.id}`, { method: 'DELETE' })).status === 200, 'Widerruf');
  check((await fetch(`${BASE}/api/public/property/${tok}`)).status === 404, 'widerrufener Link → 404');
  check((await fetch(`${BASE}/api/public/property/${'x'.repeat(43)}`)).status === 404, 'erfundener Link → 404');
  await ap.reload();
  await ap.getByText(/ungültig, abgelaufen oder wurde zurückgezogen/).waitFor();

  step('Rechte');
  const key = (await api('/account/api-keys', { data: { name: 'Teilen', scope: 'write', expiresInDays: 1 } })).json.key;
  const r = await fetch(`${BASE}/api/properties/${prop.id}/shares`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
  check(r.status === 403, `API-Schlüssel (max. Prüfer) darf nicht freigeben (${r.status})`);
  check((await api('/properties/gibtsnicht/shares', { data: {} })).status === 404, 'fremdes Objekt → 404');

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
