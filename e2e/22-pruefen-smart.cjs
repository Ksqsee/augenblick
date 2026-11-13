// E2E 22-pruefen-smart: Bekannte Mängel im Prüfablauf (weiterhin vorhanden / behoben, keine Doppel – auch offline),
// Vorbelegung der Prüfungsart (nie geprüft, wiederkehrend, aus Aufgabe), gemerkte Unterschrift (nur auf dem Gerät),
// optionales Foto beim Anlegen (ohne Bilderkennung – die gibt es nur über Claude), Sammelanlage per Diktat, Handybreite 390 px. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '22-pruefen-smart') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(SIG.split(',')[1], 'base64');
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

(async () => {
  if (process.env.PROD) throw new Error('22-pruefen-smart nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
  const api = async (path, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + path, {
      method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'),
      data: opts.data,
      headers: { 'x-pk': '1' },
    });
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
  const me = (await api('/account/me')).json;
  const userId = me.user.id;

  // Neues Element (nie geprüft) als Grundlage
  const anyAsset = (await api('/assets')).json[0];
  const buildingId = anyAsset.buildingId;
  const propertyId = anyAsset.propertyId;
  let r = await api('/assets', { data: { buildingId, category: 'fire_door', location: 'E2E Smart Tür', floor: 'EG' } });
  check(r.status === 200, `Element angelegt (${r.status})`);
  const door = r.json;

  step('Vorbelegung: nie geprüft → Erstprüfung');
  r = await api(`/assets/${door.id}/inspections`, { data: {} });
  let draft = (await api(`/inspections/${r.json.id}`)).json;
  check(JSON.stringify(draft.kinds) === '["initial"]', `Erstprüfung vorbelegt (${draft.kinds})`);
  check(Array.isArray(draft.knownDefects) && draft.knownDefects.length === 0, 'keine bekannten Mängel');
  const cps = draft.checkpoints;
  const answers = Object.fromEntries(cps.map((c) => [c.id, 'ok']));
  answers[cps[0].id] = 'defect';
  r = await api(`/inspections/${draft.id}/submit`, {
    data: {
      kinds: draft.kinds,
      answers,
      defects: [
        { checkpointId: cps[0].id, title: 'E2E Schließer schließt nicht', note: '', severity: 'medium' },
        { title: 'E2E Keil unter der Tür', note: '', severity: 'low' },
      ],
      signature: SIG,
    },
  });
  check(r.status === 200 && r.json.result === 'defects', `erste Prüfung mit 2 Mängeln (${r.status} ${r.json?.result})`);
  const firstId = draft.id;
  const firstDefects = (await api(`/assets/${door.id}`)).json.defects.filter((d) => d.status === 'open');
  check(firstDefects.length === 2, `2 offene Mängel (${firstDefects.length})`);

  step('Vorbelegung: aus Aufgabe gestartet');
  const closer = firstDefects.find((d) => d.title === 'E2E Schließer schließt nicht');
  r = await api('/tasks', { data: { title: 'E2E Schließer tauschen', kind: 'defect', defectId: closer.id, assetId: door.id } });
  check(r.status === 200, `Mängelbehebung angelegt (${r.status})`);
  r = await api(`/assets/${door.id}/inspections`, { data: { taskId: r.json.id } });
  const fu = (await api(`/inspections/${r.json.id}`)).json;
  check(fu.purpose === 'follow_up' && fu.followUpOf === firstId && JSON.stringify(fu.kinds) === '["after_repair"]', `aus Mängelbehebung → Nachprüfung (${fu.purpose} ${fu.kinds})`);
  await api(`/inspections/${fu.id}`, { method: 'DELETE' });
  r = await api('/tasks', { data: { title: 'E2E Prüfauftrag Tür', kind: 'inspection', assetId: door.id } });
  r = await api(`/assets/${door.id}/inspections`, { data: { taskId: r.json.id } });
  draft = (await api(`/inspections/${r.json.id}`)).json;
  check(draft.purpose === 'regular' && JSON.stringify(draft.kinds) === '["periodic"]', `Prüfauftrag → Regelprüfung, wiederkehrend (${draft.purpose} ${draft.kinds})`);

  step('Bekannte Mängel im Entwurf');
  check(draft.knownDefects.length === 2 && draft.knownDefects.every((k) => k.createdAt && k.title), `2 bekannte Mängel (${draft.knownDefects.length})`);
  await p.goto(BASE + '/pruefung/' + draft.id);
  const atCp = p.getByRole('group', { name: 'Bekannter Mangel: E2E Schließer schließt nicht' });
  const loose = p.getByRole('group', { name: 'Bekannter Mangel: E2E Keil unter der Tür' });
  await atCp.waitFor();
  check(await p.getByText(/Bekannter Mangel vom \d{2}\.\d{2}\.\d{4}:/).first().isVisible(), 'Text „Bekannter Mangel vom …“');
  check((await p.getByRole('heading', { name: 'Bekannte Mängel' }).count()) === 1, 'eigener Block für Mangel ohne Prüfpunkt');
  // Bekannter Mangel sitzt beim passenden Prüfpunkt
  check((await p.locator(`[data-cp="${cps[0].id}"] [data-known]`).count()) === 1, 'Mangel beim passenden Prüfpunkt');
  await atCp.getByRole('button', { name: 'Weiterhin vorhanden' }).click();
  check((await p.locator(`[data-cp="${cps[0].id}"]`).getByRole('radio', { name: 'Mangel' }).getAttribute('aria-checked')) === 'true', 'Prüfpunkt als „Mangel“ beantwortet');
  await loose.getByRole('button', { name: 'Behoben' }).click();
  check((await loose.getByRole('button', { name: 'Behoben' }).getAttribute('aria-pressed')) === 'true', '„Behoben“ gewählt');
  await p.getByRole('button', { name: 'Rest i. O.' }).click();
  await p.getByRole('button', { name: 'Alle i. O. setzen' }).click();
  await p.locator('canvas').scrollIntoViewIfNeeded();
  await p.mouse.wheel(0, 200);
  await p.waitForTimeout(300);
  const c = await p.locator('canvas').boundingBox();
  await p.mouse.move(c.x + 30, c.y + 80);
  await p.mouse.down();
  await p.mouse.move(c.x + 160, c.y + 50, { steps: 6 });
  await p.mouse.move(c.x + 260, c.y + 90, { steps: 6 });
  await p.mouse.up();
  await p.getByText('Wird nur in diesem Browser gespeichert', { exact: false }).waitFor();
  await p.getByLabel(/Unterschrift auf diesem Gerät merken/).check();
  const stored = await p.evaluate((k) => localStorage.getItem(k), `pk:signature:${userId}`);
  check(!!stored && stored.startsWith('data:image/png;base64,'), 'Unterschrift auf dem Gerät gemerkt');
  await p.waitForTimeout(1000); // Autosave
  await p.screenshot({ path: OUT + '01-known-defects.png', fullPage: true });
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await p.waitForURL(/\/druck\/protokoll\//);
  await p.getByText(/bekannt seit \d{2}\.\d{2}\.\d{4}/).first().waitFor();
  let open = (await api(`/assets/${door.id}`)).json.defects;
  const sameTitle = open.filter((d) => d.title === 'E2E Schließer schließt nicht');
  check(sameTitle.length === 1 && sameTitle[0].status === 'open', `weiterhin vorhanden: kein Doppel (${sameTitle.length})`);
  const keil = open.find((d) => d.title === 'E2E Keil unter der Tür');
  check(keil?.status === 'resolved', `behoben gemeldet → behoben (${keil?.status})`);
  const keilFull = (await api('/defects?status=resolved')).json.find((d) => d.id === keil?.id);
  check(/^Bei Prüfung vom \d{2}\.\d{2}\.\d{4} behoben$/.test(keilFull?.resolutionNote ?? ''), `Behebungsnotiz (${keilFull?.resolutionNote})`);
  const second = (await api(`/inspections/${draft.id}`)).json;
  check(second.defects.length === 1 && second.defects[0].knownId === closer.id && second.defects[0].since === closer.createdAt, 'Protokoll: verknüpfter Mangel mit ursprünglichem Datum');
  check(second.result === 'defects', `Ergebnis „mit Mängeln“ (${second.result})`);
  check(second.knownDefects.length === 0, 'abgeschlossene Prüfung liefert keine bekannten Mängel');

  step('Gleicher Titel ohne Verknüpfung (online und offline) → kein Doppel');
  r = await api(`/assets/${door.id}/inspections`, { data: {} });
  const third = (await api(`/inspections/${r.json.id}`)).json;
  check(third.knownDefects.length === 1, `ein bekannter Mangel übrig (${third.knownDefects.length})`);
  r = await api(`/inspections/${third.id}/submit`, {
    data: { kinds: ['periodic'], answers, defects: [{ checkpointId: cps[0].id, title: 'E2E Schließer schließt nicht', note: '', severity: 'medium' }], signature: SIG },
  });
  check(r.status === 200, `online abgeschlossen (${r.status})`);
  const bundle = (await api(`/offline/buildings/${buildingId}`)).json;
  check(bundle.openDefects?.some((d) => d.assetId === door.id && d.title === 'E2E Schließer schließt nicht'), 'Offline-Paket enthält offene Mängel');
  const offlineBody = {
    clientId: `e2e-smart-${Date.now()}`,
    assetId: door.id,
    schedule: 'main',
    inspectedAt: Date.now() - 60_000,
    checkpoints: cps.map((x) => ({ id: x.id, label: x.label })),
    kinds: ['periodic'],
    answers,
    defects: [{ checkpointId: cps[0].id, title: 'e2e schließer schließt nicht ', note: '', severity: 'medium' }],
    signature: SIG,
  };
  r = await api('/inspections/offline', { data: offlineBody });
  check(r.status === 200 && r.json.result === 'defects', `offline übertragen (${r.status} ${r.text.slice(0, 120)})`);
  r = await api('/inspections/offline', { data: offlineBody });
  check(r.json?.duplicate === true, 'offline erneut gesendet → idempotent');
  open = (await api(`/assets/${door.id}`)).json.defects.filter((d) => d.status === 'open');
  check(open.length === 1 && open[0].id === closer.id, `weiterhin genau ein offener Mangel (${open.map((d) => d.title)})`);
  // Behoben über die Offline-Übertragung
  r = await api('/inspections/offline', {
    data: { ...offlineBody, clientId: `e2e-smart-b-${Date.now()}`, answers: Object.fromEntries(cps.map((x) => [x.id, 'ok'])), defects: [], resolvedDefects: [closer.id] },
  });
  check(r.status === 200 && r.json.result === 'ok', `offline: behoben gemeldet (${r.status})`);
  check((await api(`/assets/${door.id}`)).json.defects.every((d) => d.status === 'resolved'), 'alle Mängel behoben');

  step('Gemerkte Unterschrift: ein Tipp zum Abschluss');
  r = await api(`/assets/${door.id}/inspections`, { data: {} });
  const quick = r.json.id;
  await p.goto(BASE + '/pruefung/' + quick);
  await p.getByRole('button', { name: 'Rest i. O.' }).click();
  await p.getByRole('button', { name: 'Alle i. O. setzen' }).click();
  const one = p.getByRole('button', { name: 'Mit gemerkter Unterschrift abschließen' });
  await one.waitFor();
  check(await p.locator('canvas').isVisible(), 'neu unterschreiben bleibt möglich');
  await one.click();
  await p.waitForURL(/\/druck\/protokoll\//);
  const q = (await api(`/inspections/${quick}`)).json;
  check(q.status === 'submitted' && q.signature === stored, 'mit gemerkter Unterschrift abgeschlossen');
  // Sicherheit: die Unterschrift liegt nicht im Konto/Profil
  check(!JSON.stringify((await api('/account/me')).json).includes(stored.slice(30, 80)), 'Unterschrift nicht im Profil');

  step('Einstellungen → Konto: Unterschrift vergessen');
  await p.goto(BASE + '/einstellungen?tab=profile');
  await p.getByRole('heading', { name: 'Unterschrift auf diesem Gerät' }).waitFor();
  await p.getByRole('button', { name: 'Vergessen' }).click();
  await p.getByText('Keine Unterschrift gemerkt', { exact: false }).waitFor();
  check((await p.evaluate((k) => localStorage.getItem(k), `pk:signature:${userId}`)) === null, 'aus dem Gerätespeicher entfernt');

  step('Optionales Foto beim Anlegen (keine Bilderkennung im Worker)');
  r = await api('/ai/identify', { data: { key: 'x/y' } });
  check(r.status === 404, `/ai/identify entfernt → 404 (${r.status})`);
  check((await api('/ai/typeplate', { data: { key: 'x/y' } })).status === 404, '/ai/typeplate entfernt → 404');
  await p.goto(BASE + '/elemente?neu=1');
  const dlg = p.getByRole('dialog');
  await dlg.getByRole('button', { name: /Foto hinzufügen/ }).waitFor();
  check((await dlg.getByText(/erkannt/i).count()) === 0, 'kein Versprechen einer Erkennung');
  await dlg.locator('input[type=file][aria-label="Foto des Elements"]').setInputFiles([{ name: 'tuer.png', mimeType: 'image/png', buffer: PNG }]);
  await dlg.getByText('Foto übernommen – bitte die Art unten wählen.').waitFor();
  await dlg.getByRole('button', { name: /Feuerlöscher/ }).click();
  await dlg.getByText('Das Foto wird mit dem Element gespeichert.').waitFor();
  await p.getByLabel('Objekt', { exact: true }).selectOption(propertyId);
  await p.getByLabel('Gebäude').locator(`option[value="${buildingId}"]`).waitFor({ state: 'attached' });
  await p.getByLabel('Gebäude').selectOption(buildingId);
  await p.getByLabel('Standort').fill('E2E Foto zuerst');
  await dlg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.waitForURL(/\/elemente\/[^?]+$/);
  let made = null;
  for (let i = 0; i < 20 && !made?.attachments?.length; i++) {
    const a = (await api('/assets')).json.find((x) => x.location === 'E2E Foto zuerst');
    made = a ? (await api(`/assets/${a.id}`)).json : null;
    if (!made?.attachments?.length) await p.waitForTimeout(250);
  }
  check(made?.category === 'extinguisher', 'Element mit gewählter Art angelegt');
  check(made?.attachments?.length === 1, `Foto als Anhang gespeichert (${made?.attachments?.length})`);

  step('Sammelanlage per Diktat');
  r = await api('/ai/parse', { data: { text: 'fünf Feuerlöscher im Erdgeschoss Flur' } });
  check(r.json?.source === 'rules' && r.json.items[0]?.kind === 'asset' && r.json.items[0].count === 5 && r.json.items[0].category === 'extinguisher' && r.json.items[0].floor === 'EG' && r.json.items[0].location === 'Flur', `Regel-Parser erkennt Sammelanlage (${JSON.stringify(r.json?.items?.[0])})`);
  const before = (await api('/assets')).json.filter((a) => a.location === 'E2E Flur').length;
  await p.goto(BASE + '/');
  await p.getByRole('button', { name: /Erfassen/ }).first().click();
  const sheet = p.getByRole('dialog');
  await sheet.getByLabel('Erfasster Text').fill('zwölf Feuerlöscher im Erdgeschoss E2E Flur');
  await sheet.getByRole('list', { name: 'Erkannt' }).getByText('12 × Feuerlöscher').waitFor();
  await sheet.getByRole('button', { name: 'Auswerten' }).click();
  const card = sheet.locator('[data-asset-item]');
  await card.waitFor();
  check((await card.getByLabel('Anzahl').inputValue()) === '12', 'Anzahl übernommen');
  check((await card.getByLabel('Art').inputValue()) === 'extinguisher', 'Art erkannt');
  check((await card.getByLabel('Etage').inputValue()) === 'EG', 'Etage erkannt');
  check((await card.getByLabel('Standort').inputValue()) === 'E2E Flur', `Standort erkannt (${await card.getByLabel('Standort').inputValue()})`);
  await card.getByLabel('Anzahl').fill('3');
  await card.getByLabel('Objekt', { exact: true }).selectOption(propertyId);
  await card.getByLabel('Gebäude').locator(`option[value="${buildingId}"]`).waitFor({ state: 'attached' });
  await card.getByLabel('Gebäude').selectOption(buildingId);
  await p.screenshot({ path: OUT + '02-sammelanlage.png' });
  await sheet.getByRole('button', { name: '3 Elemente anlegen' }).click();
  await sheet.getByText('3 Elemente angelegt').waitFor();
  const after = (await api('/assets')).json.filter((a) => a.location === 'E2E Flur');
  check(after.length - before === 3 && after.every((a) => a.floor === 'EG' && a.category === 'extinguisher' && a.buildingId === buildingId), `3 Feuerlöscher angelegt (${after.length - before})`);
  await p.keyboard.press('Escape');

  step('Handy 390 px');
  r = await api('/tasks', { data: { title: 'E2E Rückfall', kind: 'defect', defectId: closer.id, assetId: door.id } });
  // neuer offener Mangel für die Ansicht
  r = await api(`/assets/${door.id}/inspections`, { data: {} });
  const mobileDraft = r.json.id;
  await api(`/inspections/${mobileDraft}/submit`, {
    data: { kinds: ['periodic'], answers, defects: [{ checkpointId: cps[0].id, title: 'E2E Langer bekannter Mangel mit sehr ausführlicher Beschreibung am Türblatt', note: '', severity: 'high' }], signature: SIG },
  });
  r = await api(`/assets/${door.id}/inspections`, { data: {} });
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  const wide = async (label) => {
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `${label}: kein horizontaler Überlauf (${over}px)`);
  };
  await mp.goto(BASE + '/pruefung/' + r.json.id);
  await mp.locator('[data-known]').first().waitFor();
  await wide('Prüfablauf mit bekanntem Mangel');
  await mp.screenshot({ path: OUT + 'm1-run.png', fullPage: true });
  await mp.goto(BASE + '/elemente?neu=1');
  await mp.getByRole('dialog').getByRole('button', { name: /Foto hinzufügen/ }).waitFor();
  await wide('Neues Element (mit optionalem Foto)');
  await mp.goto(BASE + '/');
  await mp.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).click();
  await mp.getByRole('dialog').getByLabel('Erfasster Text').fill('fünf Feuerlöscher im 2. OG Treppenhaus Nord');
  await mp.getByRole('dialog').getByRole('button', { name: 'Auswerten' }).click();
  await mp.locator('[data-asset-item]').waitFor();
  await wide('Erfassen mit Sammelanlage');
  await mp.screenshot({ path: OUT + 'm2-sammelanlage.png' });
  await mp.keyboard.press('Escape');
  await mp.goto(BASE + '/einstellungen?tab=profile');
  await mp.getByRole('heading', { name: 'Unterschrift auf diesem Gerät' }).waitFor();
  await wide('Konto');
  await m.close();

  check(!errors.length, `keine Fehler in der Konsole (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
