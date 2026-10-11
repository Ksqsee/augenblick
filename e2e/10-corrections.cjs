// E2E 10-corrections: Berichtigung, Nachprüfung, Nachbegehung, mehrere/eigene Prüfungsarten, Erinnerung vor Fälligkeit, Papierkorb. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '10-corrections') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DAY = 86_400_000;
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

(async () => {
  if (process.env.PROD) throw new Error('10-corrections nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text()) && errors.push('console ' + m.text()));
  p.on('dialog', (d) => d.accept());
  /** API-Aufruf mit der Sitzung des Browsers; liefert { status, json }. */
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: r.status(), json, text };
  };
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Eigene Prüfungsart und Erinnerung in den Einstellungen');
  await p.goto(BASE + '/einstellungen?tab=company');
  await p.getByLabel('Neue Prüfungsart').fill('Abnahmeprüfung');
  await p.getByRole('button', { name: 'Hinzufügen' }).click();
  await p.getByLabel('Erinnerung vor Fälligkeit').selectOption('14');
  await p.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('Gespeichert').first().waitFor();
  const me = (await api('/account/me')).json;
  const custom = me.tenant.inspectionKinds.find((k) => k.label === 'Abnahmeprüfung');
  check(!!custom && /^k_/.test(custom.key), `eigene Art gespeichert (${JSON.stringify(me.tenant.inspectionKinds)})`);
  check(me.tenant.reminderDays === 14, `Erinnerung 14 Tage (${me.tenant.reminderDays})`);

  step('Prüfung mit mehreren Arten und Mangel abschließen');
  const assets = (await api('/assets')).json;
  const asset = assets.find((a) => a.category === 'smoke_alarm' && a.nextDueAt && a.nextDueAt > Date.now() + 60 * DAY) ?? assets.find((a) => a.category === 'smoke_alarm');
  const cats = (await api('/categories')).json;
  const cps = cats.find((c) => c.key === 'smoke_alarm').checkpoints;
  const iid = (await api(`/assets/${asset.id}/inspections`, { data: {} })).json.id;
  const body = {
    kinds: ['periodic', custom?.key ?? 'periodic'],
    answers: Object.fromEntries(cps.map((cp, i) => [cp.id, i === 0 ? 'defect' : 'ok'])),
    defects: [{ checkpointId: cps[0].id, title: cps[0].label, note: 'verschmutzt', measure: 'reinigen', severity: 'medium' }],
    notes: 'Erstfassung',
    signature: SIG,
    signerName: 'E2E',
  };
  let r = await api(`/inspections/${iid}`, { method: 'PUT', data: { ...body, kinds: ['gibt_es_nicht'] } });
  check(r.status === 400, `unbekannte Art abgelehnt (${r.status})`);
  r = await api(`/inspections/${iid}/submit`, { data: { ...body, kinds: [] } });
  check(r.status === 400, `ohne Art kein Abschluss (${r.status})`);
  r = await api(`/inspections/${iid}/submit`, { data: body });
  check(r.status === 200, `Abschluss (${r.status} ${r.text.slice(0, 120)})`);
  let orig = (await api(`/inspections/${iid}`)).json;
  check(orig.kindLabels.join('|') === 'Wiederkehrende Prüfung|Abnahmeprüfung', `Bezeichnungen der Arten (${orig.kindLabels})`);
  const dueAfterOrig = (await api(`/assets/${asset.id}`)).json.nextDueAt;

  step('Nachprüfung aus dem Protokoll starten');
  await p.goto(`${BASE}/druck/protokoll/${iid}`);
  await p.getByText('Abnahmeprüfung').first().waitFor();
  await p.getByRole('button', { name: 'Nachprüfung' }).click();
  await p.waitForURL(/\/pruefung\//);
  const fid = p.url().split('/pruefung/')[1];
  await p.getByText(/Nachprüfung zur Prüfung vom/).waitFor();
  await p.screenshot({ path: OUT + '01-follow-up.png', fullPage: true });
  const fu = (await api(`/inspections/${fid}`)).json;
  check(fu.purpose === 'follow_up' && fu.followUpOf === iid, 'Nachprüfung verknüpft');
  check(fu.checkpoints.length === 1 && fu.checkpoints[0].id === cps[0].id, `nur beanstandete Prüfpunkte (${fu.checkpoints.length})`);
  r = await api(`/inspections/${fid}/submit`, { data: { kinds: ['after_repair'], answers: { [cps[0].id]: 'ok' }, signature: SIG, signerName: 'E2E' } });
  check(r.status === 200 && r.json.result === 'ok', `Nachprüfung abgeschlossen (${r.status} ${r.json?.result})`);
  let defs = (await api('/defects?status=all')).json.filter((d) => d.inspectionId === iid);
  check(defs.length === 1 && defs[0].status === 'resolved', `Mangel durch Nachprüfung behoben (${defs.map((d) => d.status)})`);
  let a2 = (await api(`/assets/${asset.id}`)).json;
  check(a2.nextDueAt === dueAfterOrig, `Prüfturnus unverändert (${a2.nextDueAt} vs ${dueAfterOrig})`);
  check(a2.lastResult === 'ok', `letztes Ergebnis aus der Nachprüfung (${a2.lastResult})`);

  step('Berichtigung');
  await p.goto(`${BASE}/druck/protokoll/${iid}`);
  await p.getByRole('button', { name: 'Berichtigen' }).click();
  await p.waitForURL(/\/pruefung\//);
  const cid = p.url().split('/pruefung/')[1];
  await p.getByText(/Berichtigung der Prüfung vom/).waitFor();
  await p.screenshot({ path: OUT + '02-correction.png', fullPage: true });
  const corr = (await api(`/inspections/${cid}`)).json;
  check(corr.purpose === 'correction' && corr.supersedesId === iid && corr.notes === 'Erstfassung' && corr.defects.length === 1, 'Berichtigung übernimmt die Angaben');
  check(corr.kinds.join('|') === body.kinds.join('|'), 'Arten übernommen');
  check((await api(`/inspections/${iid}/correct`, { method: 'POST' })).json?.id === cid, 'zweiter Aufruf liefert denselben Entwurf');
  r = await api(`/inspections/${cid}/submit`, { data: { ...body, notes: 'Berichtigte Fassung: Ort präzisiert' } });
  check(r.status === 200, `Berichtigung abgeschlossen (${r.status} ${r.text.slice(0, 120)})`);
  orig = (await api(`/inspections/${iid}`)).json;
  const done = (await api(`/inspections/${cid}`)).json;
  check(!!orig.supersededAt && orig.supersededBy === cid, 'Original als berichtigt markiert');
  check(orig.notes === 'Erstfassung' && orig.signature, 'Original unverändert erhalten');
  check(done.inspectedAt === orig.inspectedAt, 'Prüfdatum des Originals übernommen');
  check((await api(`/inspections/${iid}/correct`, { method: 'POST' })).status === 409, 'berichtigte Prüfung nicht erneut berichtigbar');
  check((await api(`/inspections/${iid}/reopen`, { method: 'POST' })).status === 409, 'berichtigte Prüfung nicht wieder zu öffnen');
  const listed = (await api('/inspections?status=submitted')).json.map((i) => i.id);
  check(!listed.includes(iid) && listed.includes(cid), 'Liste zeigt nur die gültige Fassung');
  check((await api('/inspections?superseded=1')).json.some((i) => i.id === iid), 'Reiter „Berichtigt“ enthält das Original');
  defs = (await api('/defects?status=all')).json;
  check(!defs.some((d) => d.inspectionId === iid), 'Mängel des Originals entfernt');
  const cd = defs.filter((d) => d.inspectionId === cid);
  check(cd.length === 1 && cd[0].status === 'resolved', `Status „behoben“ übernommen (${cd.map((d) => d.status)})`);
  await p.goto(`${BASE}/druck/protokoll/${iid}`);
  await p.getByText('Diese Prüfung wurde berichtigt und ist nicht mehr gültig.').waitFor();
  check((await p.getByRole('button', { name: 'Berichtigen' }).count()) === 0, 'kein Berichtigen-Knopf am Original');
  await p.goto(`${BASE}/pruefungen?tab=corrected`);
  await p.getByText(asset.code).first().waitFor();
  await p.screenshot({ path: OUT + '03-corrected-tab.png', fullPage: true });

  step('PDF der berichtigten Prüfung');
  await p.goto(`${BASE}/druck/protokoll/${cid}`);
  await p.getByText(/ersetzt Prüfung vom/).waitFor();
  const dl = p.waitForEvent('download');
  await p.getByRole('button', { name: 'PDF' }).click();
  const pdf = await dl;
  check((await pdf.path()) && fs.statSync(await pdf.path()).size > 2000, 'PDF der Berichtigung erzeugt');

  step('Löschen der Berichtigung stellt das Original wieder her');
  r = await api('/inspections/batch-delete', { data: { ids: [cid] } });
  check(r.status === 200, 'Berichtigung gelöscht');
  orig = (await api(`/inspections/${iid}`)).json;
  check(!orig.supersededAt && !orig.supersededBy, 'Original wieder gültig');

  step('Nachbegehung');
  const props = (await api('/properties')).json;
  const pid = props[0].id;
  const wid = (await api(`/properties/${pid}/walkthroughs`, { data: { purpose: 'extraordinary' } })).json.id;
  const w = (await api(`/walkthroughs/${wid}`)).json;
  check(w.purpose === 'extraordinary', `Anlass gespeichert (${w.purpose})`);
  const q0 = w.questions[0];
  r = await api(`/walkthroughs/${wid}/submit`, {
    data: { answers: Object.fromEntries(w.questions.map((q) => [q.id, q === q0 ? 'defect' : 'ok'])), findings: [{ questionId: q0.id, title: 'Fluchtweg verstellt', note: '', severity: 'high' }], signature: SIG, signerName: 'E2E' },
  });
  check(r.status === 200, `Begehung abgeschlossen (${r.status})`);
  await p.goto(`${BASE}/druck/begehung/${wid}`);
  await p.getByText('Außerordentliche Begehung').first().waitFor();
  await p.getByRole('button', { name: 'Nachbegehung' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Starten' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/begehung/'));
  const fwid = p.url().split('/begehung/')[1];
  const fw = (await api(`/walkthroughs/${fwid}`)).json;
  check(fw.purpose === 'follow_up' && fw.followUpOf === wid && fw.questions.length === 1, `Nachbegehung nur mit beanstandeter Frage (${fw.questions.length})`);
  r = await api(`/walkthroughs/${fwid}/submit`, { data: { answers: { [q0.id]: 'ok' }, findings: [], signature: SIG, signerName: 'E2E' } });
  check(r.status === 200 && r.json.nextDueAt === null, `Nachbegehung ändert den Turnus nicht (${r.json?.nextDueAt})`);
  const wd = (await api('/defects?status=all&source=walkthrough')).json.filter((d) => d.walkthroughId === wid);
  check(wd.length === 1 && wd[0].status === 'resolved', 'Feststellung durch Nachbegehung behoben');

  step('Papierkorb');
  const victim = assets.find((a) => a.category === 'fire_door' && a.id !== asset.id && a.lastInspectedAt);
  check((await api(`/assets/${victim.id}/label`, { method: 'PUT', data: { labelCode: 'E2E-PAPIERKORB' } })).status === 200, 'Etikett gesetzt');
  check((await api(`/assets/${victim.id}`, { method: 'DELETE' })).status === 200, 'Element gelöscht');
  check((await api(`/assets/${victim.id}`)).status === 404, 'gelöschtes Element nicht abrufbar');
  await p.goto(`${BASE}/einstellungen?tab=company`);
  await p.getByText(victim.code).waitFor();
  await p.screenshot({ path: OUT + '04-trash.png', fullPage: true });
  await p.getByRole('button', { name: 'Wiederherstellen' }).first().click();
  await p.getByText('Element wiederhergestellt').waitFor();
  const back = (await api(`/assets/${victim.id}`)).json;
  check(back?.labelCode === 'E2E-PAPIERKORB' && back.inspections.length > 0, 'Element mit Etikett und Historie zurück');
  check((await api(`/assets/${victim.id}/restore`, { method: 'POST' })).status === 404, 'zweite Wiederherstellung → 404');

  step('Lesezugriff: kein Papierkorb, keine Berichtigung');
  const viewer = await b.newContext();
  const vp = await viewer.newPage();
  await vp.request.post(BASE + '/api/auth/login', { data: { email: 'lesen@example.com', password: PW }, headers: { 'x-pk': '1' } });
  check((await vp.request.get(BASE + '/api/trash/assets')).status() === 403, 'Papierkorb nur für Admins');
  check((await vp.request.post(`${BASE}/api/inspections/${iid}/correct`, { headers: { 'x-pk': '1' } })).status() === 403, 'Lesezugriff darf nicht berichtigen');
  const insp2 = await b.newContext();
  const ip = await insp2.newPage();
  await ip.request.post(BASE + '/api/auth/login', { data: { email: 'pruefer2@example.com', password: PW }, headers: { 'x-pk': '1' } });
  check((await ip.request.post(`${BASE}/api/inspections/${iid}/correct`, { headers: { 'x-pk': '1' } })).status() === 403, 'fremde Prüfung nur durch Admin berichtigen');
  await viewer.close();
  await insp2.close();

  step('Erinnerung vor Fälligkeit (Cron)');
  const target = (await api('/assets')).json.find((a) => a.category === 'fire_door' && a.nextDueAt && a.nextDueAt > Date.now() + 30 * DAY);
  if (!target) check(false, 'kein Element mit späterem Termin gefunden');
  else {
    r = await api(`/assets/${target.id}/schedules`, { method: 'PUT', data: { key: 'visual', enabled: true, nextDueAt: Date.now() + 14 * DAY - 3_600_000 } });
    check(r.status === 200, 'Termin in 14 Tagen gesetzt');
    const cron = await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=15+5+*+*+*`);
    if (cron.status === 404) console.log('   (Cron-Endpunkt nur im Dev-Server – übersprungen)');
    else {
      const n = (await api('/notifications')).json.items.filter((x) => /in 14 Tagen fällig/.test(x.title));
      check(n.length === 1, `Vorab-Erinnerung erzeugt (${n.length})`);
    }
  }

  step('Handybreite 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  for (const path of [`/druck/protokoll/${iid}`, `/pruefung/${fid}`, '/pruefungen?tab=corrected', '/einstellungen?tab=company', `/druck/begehung/${fwid}`]) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    const wdt = await mp.evaluate(() => document.documentElement.scrollWidth);
    check(wdt <= 392, `${path}: kein horizontaler Überlauf (${wdt})`);
  }
  await mp.goto(`${BASE}/einstellungen?tab=company`);
  await mp.screenshot({ path: OUT + '05-mobile-settings.png', fullPage: true });
  await m.close();

  check(!errors.length, `Browserfehler: ${errors.join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
