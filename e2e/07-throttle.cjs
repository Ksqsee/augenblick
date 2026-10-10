// E2E 07-throttle: Sperre nach zu vielen Fehlversuchen (Login, Passwort-Link, API-Schlüssel) – nur lokal ausführen,
// da die Sperre bis zu 15 Minuten gilt. Der Runner leert die Sperrtabelle vor jeder Reihe.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const post = (path, body, headers = {}) =>
  fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pk': '1', ...headers }, body: JSON.stringify(body) });

(async () => {
  if (process.env.PROD) throw new Error('07-throttle nicht gegen Produktion ausführen');

  console.log('· Login: Sperre je Konto');
  const email = 'pruefer2@example.com';
  for (let i = 0; i < 8; i++) {
    const r = await post('/auth/login', { email, password: 'falsch-' + i });
    check(r.status === 401, `Fehlversuch ${i + 1} → 401 (${r.status})`);
  }
  let r = await post('/auth/login', { email, password: 'noch-falscher' });
  check(r.status === 429 && Number(r.headers.get('retry-after')) > 0, `9. Versuch gesperrt (${r.status}, retry-after ${r.headers.get('retry-after')})`);
  console.log('  ', (await r.json()).error);
  r = await post('/auth/login', { email, password: PW });
  check(r.status === 429, `auch richtiges Passwort während der Sperre abgelehnt (${r.status})`);
  r = await post('/auth/login', { email: 'pruefer@example.com', password: PW });
  check(r.status === 200, `anderes Konto nicht betroffen (${r.status})`);

  console.log('· Login: unbekannte E-Mail gleich behandelt');
  const t0 = Date.now();
  r = await post('/auth/login', { email: 'gibt-es-nicht@example.com', password: 'x' });
  const unknownMs = Date.now() - t0;
  check(r.status === 401 && (await r.json()).error === 'E-Mail oder Passwort falsch', 'gleiche Meldung für unbekannte E-Mail');
  const t1 = Date.now();
  await post('/auth/login', { email: 'lesen@example.com', password: 'x' });
  const knownMs = Date.now() - t1;
  console.log(`   Antwortzeit unbekannt ${unknownMs} ms / bekannt ${knownMs} ms`);
  check(unknownMs > knownMs / 4, 'Antwortzeit verrät nicht, ob das Konto existiert');

  console.log('· Ungültige Links und API-Schlüssel je IP');
  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    const x = await fetch(`${BASE}/api/auth/reset/ungueltig-${i}-${'x'.repeat(20)}`);
    if (x.status === 429) blocked++;
    else check(x.status === 404, `ungültiger Link → 404 (${x.status})`);
  }
  check(blocked >= 5, `nach 30 ungültigen Links gesperrt (${blocked}× 429)`);
  r = await fetch(BASE + '/api/assets', { headers: { authorization: 'Bearer pk_' + 'y'.repeat(43) } });
  check(r.status === 429, `API-Schlüssel-Raten ebenfalls gesperrt (${r.status})`);

  console.log('· Oberfläche zeigt die Meldung');
  const b = await chromium.launch();
  const p = await (await b.newContext({ locale: 'de-DE' })).newPage();
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill(email);
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText(/Zu viele Versuche/).waitFor({ timeout: 10000 }).catch(() => check(false, 'Meldung „Zu viele Versuche“ sichtbar'));
  await b.close();

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.message);
  process.exit(1);
});
