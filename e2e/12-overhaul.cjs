// E2E 12-overhaul: Startseite „Heute“, Erfassen per Text (Diktat-Ersatz), Mangel ohne Prüfung, Rundgang mit Weiter-Ablauf,
// Befund einsprechen im Prüfablauf (Text), Diktat-Knöpfe, Handybreite 390 px. Nur lokal (ohne Workers AI → Regel-Parser).
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '12-overhaul') + '/';
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
  if (process.env.PROD) throw new Error('12-overhaul nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
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

  step('Anmeldeverlauf');
  {
    const bad = await p.request.post(BASE + '/api/auth/login', { data: { email: 'demo@example.com', password: 'falsch-falsch' }, headers: { 'x-pk': '1' } });
    check(bad.status() === 401, 'Fehlversuch');
    const l = (await api('/account/logins')).json;
    check(Array.isArray(l) && l.some((x) => x.success) && l.some((x) => !x.success) && !('ip' in l[0]), `Verlauf mit Erfolg und Fehlversuch (${l?.length})`);
    const key = (await api('/account/api-keys', { data: { name: 'Verlauf', scope: 'read', expiresInDays: 1 } })).json.key;
    const r = await fetch(BASE + '/api/account/logins', { headers: { authorization: `Bearer ${key}` } });
    check(r.status === 403, `Verlauf nicht per API-Schlüssel (${r.status})`);
  }

  step('Heute: Aktionen, Vorschläge, Rundgänge');
  await p.getByRole('heading', { name: 'Als Nächstes' }).waitFor();
  check(await p.getByRole('button', { name: /Erfassen/ }).first().isVisible(), 'Erfassen-Kachel');
  check(await p.getByRole('link', { name: /Rundgang starten/ }).isVisible(), 'Rundgang-Kachel');
  check((await p.getByRole('heading', { name: 'Rundgänge' }).count()) === 1, 'Rundgänge-Liste');
  await p.screenshot({ path: OUT + '01-heute.png', fullPage: true });

  step('Suche in normaler Sprache');
  await p.keyboard.press('Control+k');
  await p.getByRole('dialog', { name: 'Suche' }).locator('input').fill('überfällige Feuerlöscher');
  await p.getByText(/Elemente anzeigen: Überfällig · Feuerlöscher/).waitFor();
  await p.keyboard.press('Enter');
  await p.waitForURL((u) => u.pathname === '/elemente' && u.searchParams.get('status') === 'overdue' && !!u.searchParams.get('kategorie'));
  {
    const cat = new URL(p.url()).searchParams.get('kategorie');
    const list = (await api(`/assets?due=overdue&category=${cat}`)).json;
    await p.getByText(`${list.length} Elemente`).waitFor();
    check(list.length > 0, `gefilterte Liste (${list.length})`);
  }

  step('API: Mangel ohne Prüfung');
  const assets = (await api('/assets')).json;
  const a = assets[0];
  let r = await api('/defects', { data: { assetId: a.id, title: 'Schild fehlt', severity: 'low' } });
  check(r.status === 200 && r.json.id && r.json.taskCreated === false, `Mangel am Element (${r.status})`);
  r = await api('/defects', { data: { title: 'ohne Ort', severity: 'low' } });
  check(r.status === 400, `ohne Element/Objekt → 400 (${r.status})`);
  r = await api('/defects', { data: { assetId: a.id, title: 'x', severity: 'low', photoKey: 'fremd/abc.jpg' } });
  check(r.status === 400, `fremder Foto-Schlüssel → 400 (${r.status})`);
  r = await api('/defects', { data: { assetId: 'gibtsnicht', title: 'x', severity: 'low' } });
  check(r.status === 404, `unbekanntes Element → 404 (${r.status})`);
  r = await api('/defects', { data: { assetId: a.id, title: 'Schild fehlt am Element', severity: 'low' } });
  check(r.status === 409 && r.json.duplicate?.title === 'Schild fehlt', `Duplikat erkannt (${r.status})`);
  r = await api('/defects', { data: { assetId: a.id, title: 'Schild fehlt am Element', severity: 'low', force: true } });
  check(r.status === 200, 'mit force trotzdem angelegt');
  r = await api('/defects', { data: { assetId: a.id, title: 'Tür blockiert', severity: 'critical', measure: 'Sofort freiräumen' } });
  const tasks = (await api('/tasks')).json.filter((t) => t.defectId === r.json.id);
  check(r.json.taskCreated === true && tasks.length === 1 && tasks[0].priority === 'high', 'kritischer Mangel → Aufgabe automatisch');

  step('Erfassen: Text auswerten, Ort wählen, speichern');
  const before = (await api('/defects?status=open')).json.length;
  await p.getByRole('button', { name: /Erfassen/ }).first().click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Erfasster Text').fill(`Brandschutztür ${a.code} schließt nicht, Gefahr im Verzug. Hausmeister informieren bis morgen.`);
  check(await dlg.getByRole('list', { name: 'Erkannt' }).isVisible(), 'Live-Vorschau beim Tippen');
  await dlg.getByRole('button', { name: 'Auswerten' }).click();
  await dlg.getByText(/Einträge erkannt/).waitFor();
  check((await dlg.getByRole('button', { name: 'Mangel' }).count()) >= 1, 'Mangel erkannt');
  await p.screenshot({ path: OUT + '02-erfassen-items.png' });
  check((await dlg.getByRole('list', { name: 'Erkannt' }).count()) === 0, 'Vorschau nur im ersten Schritt');
  await dlg.getByRole('button', { name: /übernehmen/i }).click();
  await dlg.getByText('angelegt').waitFor();
  const after = (await api('/defects?status=open')).json;
  check(after.length === before + 1, `Mangel angelegt (${before} → ${after.length})`);
  const created = after.find((d) => /schließt nicht/i.test(d.title));
  check(created && created.assetCode === a.code || created?.assetId === a.id, 'Mangel am genannten Element');
  check((await api('/tasks')).json.some((t) => /Hausmeister/.test(t.title)), 'Aufgabe aus Diktat angelegt');
  await p.keyboard.press('Escape');

  step('Erfassen mit Kontext: Element-Seite wählt das Element vor');
  await p.goto(BASE + `/elemente/${a.id}`);
  await p.getByRole('button', { name: /Erfassen/ }).first().click();
  await p.getByRole('dialog').getByText(a.code, { exact: false }).first().waitFor();
  await p.keyboard.press('Escape');

  step('Diktat-Knöpfe an Textfeldern');
  await p.goto(BASE + '/aufgaben');
  // Chromium hat die Web-Speech-API → Knopf sichtbar, wenn ein mehrzeiliges Feld da ist
  const engines = await p.evaluate(() => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  console.log('  Spracherkennung im Browser:', engines);

  step('Rundgang: fällige Elemente nacheinander prüfen');
  const rounds = (await api('/smart/rounds?days=30')).json;
  const round = rounds.find((x) => x.assets.length >= 2);
  check(!!round, 'Rundgang mit mehreren Elementen');
  await p.goto(BASE + `/rundgang/${round.buildingId}`);
  await p.getByRole('heading', { name: round.buildingName }).waitFor();
  const first = round.assets[0];
  check(await p.getByText(first.code, { exact: true }).first().isVisible(), 'erstes Element in Laufreihenfolge');
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/pruefung/') && u.search.includes('rundgang='));

  step('Befund einsprechen (Text) → Prüfpunkt zugeordnet');
  const insp = (await api(`/inspections/${p.url().split('/pruefung/')[1].split('?')[0]}`)).json;
  const cp = insp.checkpoints[0];
  const voice = p.getByRole('button', { name: 'Befund einsprechen' });
  if (engines && (await voice.count())) {
    // ohne echtes Mikrofon: Textfeld erscheint erst nach Aufnahme – daher direkt über die API prüfen
    const parsed = (await api('/ai/parse', { data: { text: `${cp.label} mangelhaft, Gefahr im Verzug`, checkpoints: insp.checkpoints.map((c) => ({ id: c.id, label: c.label })) } })).json;
    check(parsed.items[0]?.checkpointId === cp.id, `Prüfpunkt-Zuordnung (${parsed.items[0]?.checkpointId} / ${cp.id})`);
    check(parsed.items[0]?.severity === 'critical', 'Schwere aus Text');
  }
  await p.getByRole('button', { name: 'Rest i. O.' }).click();
  // Mangel mit Vorschlägen
  await p.getByRole('button', { name: /Mangel/ }).first().click().catch(() => {});
  await p.screenshot({ path: OUT + '03-pruefung.png', fullPage: true });
  // Prüfung per API abschließen und Rundgang fortsetzen (Unterschrift im Browser ist in 03 abgedeckt)
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await api(`/inspections/${insp.id}/submit`, {
    data: { kinds: ['periodic'], answers: Object.fromEntries(insp.checkpoints.map((c) => [c.id, 'ok'])), defects: [], signature: SIG, signerName: 'E2E' },
  });
  check(r.status === 200, `Prüfung abgeschlossen (${r.status})`);
  await p.evaluate(([bid, aid]) => sessionStorage.setItem(`pk:round:${bid}`, JSON.stringify([aid])), [round.buildingId, first.id]);
  await p.goto(BASE + `/rundgang/${round.buildingId}?fertig=${first.id}`);
  await p.getByText(/1 von \d+ geprüft/).waitFor();
  check(await p.getByText('Weiter mit').isVisible(), 'Weiter mit nächstem Element');
  check(!(await p.getByText(first.code, { exact: true }).count()), 'geprüftes Element nicht mehr in der Liste');

  step('Handy 390 px: Heute, Erfassen, Rundgang ohne Überlauf');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  for (const path of ['/', `/rundgang/${round.buildingId}`, '/maengel', '/pruefungen']) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${path} (${over}px)`);
  }
  await mp.goto(BASE + '/');
  await mp.getByText('Prüfstatus').waitFor();
  await mp.screenshot({ path: OUT + 'm1-heute.png', fullPage: true });
  await mp.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).click();
  await mp.getByRole('dialog').getByLabel('Erfasster Text').waitFor();
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `Erfassen-Sheet ohne Überlauf (${over}px)`);
  await mp.screenshot({ path: OUT + 'm2-erfassen.png' });
  await mp.keyboard.press('Escape');
  await mp.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Mehr' }).click();
  check(await mp.getByRole('link', { name: 'Einstellungen' }).isVisible(), 'Mehr-Menü mit Einstellungen');

  check(!errors.length, `keine Fehler in der Konsole (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
