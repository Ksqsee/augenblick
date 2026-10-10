// E2E: Gesamtbewertung festlegen, Maßnahme je Mangel, Hinweis bei neuem Gerät
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PROD = !!process.env.PROD;
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '05-results-security') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => { if (!ok) { fail.push(m); console.log('  ✗', m); } };
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function login(b, email) {
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE', acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill(email);
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    if (!r.ok() && !opts.allowFail) throw new Error(`${path} → ${r.status()} ${await r.text()}`);
    return opts.allowFail ? { status: r.status(), body: await r.json().catch(() => null) } : r.json();
  };
  return { ctx, p, api };
}

(async () => {
  const b = await chromium.launch();
  const errors = [];

  step('Hinweis bei neuem Gerät');
  const email = PROD ? 'pruefer2@example.com' : 'pruefer@example.com';
  const s1 = await login(b, email); // erstes/bekanntes Gerät
  const before = (await s1.api('/notifications')).items.filter((n) => n.type === 'account_security').length;
  const s2 = await login(b, email); // neues Gerät (neuer Browser-Kontext ohne Cookie)
  await s2.p.waitForTimeout(800);
  const after = (await s2.api('/notifications')).items.filter((n) => n.type === 'account_security');
  check(after.length === before + 1, `Hinweis bei neuem Gerät (${before} → ${after.length})`);
  console.log('  ', after[0]?.title, '|', after[0]?.body);
  // dasselbe Gerät erneut: kein weiterer Hinweis
  await s2.p.request.fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { 'x-pk': '1' } });
  await s2.p.goto(BASE + '/login');
  await s2.p.getByLabel('E-Mail').fill(email);
  await s2.p.getByLabel('Passwort').fill(PW);
  await s2.p.getByRole('button', { name: 'Anmelden' }).click();
  await s2.p.getByText('Prüfstatus').waitFor();
  const again = (await s2.api('/notifications')).items.filter((n) => n.type === 'account_security').length;
  check(again === after.length, 'kein Hinweis beim bekannten Gerät');
  await s2.p.getByRole('button', { name: /Benachrichtigungen/ }).first().click();
  await s2.p.getByText('Anmeldung von einem neuen Gerät').first().waitFor();
  await s2.p.screenshot({ path: OUT + '01-device.png' });
  await s1.ctx.close();
  await s2.ctx.close();

  if (!PROD) {
    const { p, api } = await login(b, 'demo@example.com');
    p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    step('Prüfung mit Maßnahme und festgelegter Gesamtbewertung');
    const assets = await api('/assets');
    const a = assets.find((x) => x.category === 'fire_door');
    const started = await api(`/assets/${a.id}/inspections`, { data: {} });
    const iid = started.id ?? started.inspection?.id;
    const insp = await api('/inspections/' + iid);
    const answers = Object.fromEntries(insp.checkpoints.map((cp, i) => [cp.id, i === 0 ? 'defect' : 'ok']));
    const cp0 = insp.checkpoints[0];
    const defects = [{ checkpointId: cp0.id, title: cp0.label, note: 'Schließer schleift', measure: 'Obentürschließer tauschen (Fachfirma)', severity: 'medium' }];
    const draft = { kind: 'periodic', notInspectable: false, answers, maintenance: [], defects, photos: [], notes: '', signature: SIG, signerName: 'Sabine Krüger', resultOverride: null, resultReason: '' };
    await api('/inspections/' + iid, { method: 'PUT', data: draft });

    // UI: Gesamtbewertung festlegen
    await p.goto(BASE + '/pruefung/' + iid);
    const group = p.getByRole('radiogroup', { name: 'Gesamtbewertung' });
    await group.waitFor();
    check(await group.getByRole('radio', { name: 'Ohne Mängel' }).isDisabled(), '„Ohne Mängel“ gesperrt bei Mängeln');
    await group.getByRole('radio', { name: 'Kritisch', exact: true }).click();
    await p.getByText('Begründung zur Gesamtbewertung fehlt').first().waitFor();
    check(await p.getByLabel('Maßnahme').first().inputValue() === 'Obentürschließer tauschen (Fachfirma)', 'Maßnahme im Editor');
    await p.getByLabel('Begründung der Gesamtbewertung').fill('Tür schließt nicht selbsttätig – Schutzfunktion nicht gegeben');
    await p.waitForTimeout(1500);
    await p.screenshot({ path: OUT + '02-run.png', fullPage: true });

    // Server-Validierung
    const bad = await api(`/inspections/${iid}/submit`, { data: { ...draft, resultOverride: 'ok' }, allowFail: true });
    check(bad.status === 400, '„Ohne Mängel“ mit Mängeln abgelehnt');
    const noReason = await api(`/inspections/${iid}/submit`, { data: { ...draft, resultOverride: 'critical', resultReason: '' }, allowFail: true });
    check(noReason.status === 400, 'Abweichung ohne Begründung abgelehnt');

    await p.getByRole('button', { name: 'Abschließen' }).click();
    await p.waitForURL(/\/druck\/protokoll\/|\/elemente\//, { timeout: 20000 });
    const done = await api('/inspections/' + iid);
    check(done.result === 'critical' && done.resultOverride === 'critical', 'Ergebnis festgelegt: kritisch');
    const defs = await api('/defects?status=open');
    check(defs.some((d) => d.measure === 'Obentürschließer tauschen (Fachfirma)'), 'Maßnahme am Mangel gespeichert');

    step('Protokoll zeigt Begründung und Maßnahme');
    await p.goto(BASE + '/druck/protokoll/' + iid);
    await p.getByText('Gesamtergebnis (festgelegt)').waitFor();
    await p.getByText(/Begründung: Tür schließt nicht selbsttätig/).waitFor();
    await p.getByText('Maßnahme: Obentürschließer tauschen (Fachfirma)').waitFor();
    await p.screenshot({ path: OUT + '03-protocol.png', fullPage: true });
    const [d] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'PDF', exact: true }).click()]);
    await d.saveAs(OUT + 'protokoll.pdf');
    check(fs.statSync(OUT + 'protokoll.pdf').size > 3000, 'Protokoll-PDF');

    step('Mängelliste zeigt Maßnahme');
    await p.goto(BASE + '/maengel');
    await p.getByText('Obentürschließer tauschen (Fachfirma)').first().waitFor();
  }

  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length || errors.length) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.log('FAIL', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
