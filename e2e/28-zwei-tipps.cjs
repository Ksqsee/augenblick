// E2E 28-zwei-tipps (docs/plan/v5.md 3 „R“): Prüfen in zwei Tipps am Handy (390 px) – „Alles in Ordnung“ + „Abschließen“
// mit gemerkter Unterschrift (Tipps werden gezählt), Rückgängig, Abweichung einsprechen (getippt) + „Alles andere in
// Ordnung“, Gruppen ein-/ausgeklappt, „Weitere Angaben“, Rundgang springt weiter, Meldung überdeckt keine Knöpfe,
// GET /now im neuen Konto (keine Monatsberichte/Begehung, dafür „nie geprüft“ mit Rundgang), „Rundgang starten“ unter
// „Jetzt“ im Kalender, leere Seiten (Einstieg, Kalender, Mängel und Aufgaben), Ampel „nie geprüft“, kein Überlauf; Plan v6: Rundgang in Laufreihenfolge (UG → EG → 2. OG, A3) und „Alles in
// Ordnung“ mit Prüfpunkten, die nach den Stammdaten entfallen bzw. nachgefragt werden (A4). Bilder in e2e/.out/28-zwei-tipps (für docs/design/v3/v5). Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '28-zwei-tipps') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

(async () => {
  if (process.env.PROD) throw new Error('28-zwei-tipps nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const p = await m.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (x) => x.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(x.text()) && errors.push('console ' + x.text()));
  };
  watch(p);
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
  const noOverflow = async (what) => {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${what} (${over}px)`);
  };
  /** Meldung darf keinen Knopf der festen Leisten (Abschlussleiste, Handy-Navigation) überdecken */
  const toastClear = async (what) => {
    const toast = p.locator('[data-toast]');
    await toast.waitFor();
    const tb = await toast.boundingBox();
    const bars = p.locator('[data-toast-avoid] button:visible, [data-toast-avoid] a:visible, nav[aria-label="Hauptnavigation"] a:visible, nav[aria-label="Hauptnavigation"] button:visible');
    const n = await bars.count();
    let hit = 0;
    for (let i = 0; i < n; i++) if (overlap(tb, await bars.nth(i).boundingBox())) hit++;
    check(n > 0 && hit === 0, `${what}: Meldung über keinem Knopf der Leiste (${hit} von ${n} überdeckt)`);
    check(tb.x >= 0 && tb.x + tb.width <= 390, `${what}: Meldung in der Breite`);
    check((await p.locator('[data-toast]').count()) === 1, `${what}: nur eine Meldung`);
    return tb;
  };

  // Plan v8: „Prüfen“ und „Offen“ gibt es nicht mehr als Orte – leer sind Objektliste (Einstieg), Kalender und
  // „Mängel und Aufgaben“ je ein Satz
  step('Neues Konto ohne Elemente: Einstieg, Kalender und Mängel sind ein Satz');
  await p.goto(BASE + '/login');
  const stamp = Date.now();
  let r = await api('/auth/register', { data: { company: 'Zwei Tipps GmbH', name: 'Tara Tipp', email: `zwei${stamp}@example.com`, password: 'sicheres-passwort-1' } });
  check(r.status === 200, `registriert (${r.status})`);
  await p.goto(BASE + '/pruefen');
  await p.waitForURL((u) => u.pathname === '/objekte');
  await p.getByText('Wie heißt dein erstes Objekt?').waitFor();
  await noOverflow('/pruefen → /objekte (leer)');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-pruefen-leer.png', fullPage: true });
  await p.goto(BASE + '/kalender');
  await p.getByText('Bis Monatsende steht nichts an.').waitFor();
  for (const t of ['Überfällig', 'Jetzt', 'Erledigt für dich'])
    check(!(await p.getByRole('heading', { name: t, exact: true }).count()), `Kalender leer: kein Abschnitt „${t}“`);
  await noOverflow('/kalender (leer)');
  await p.goto(BASE + '/maengel?art=alle');
  await p.getByText('Nichts offen.').waitFor();
  check(!(await p.getByPlaceholder('Mängel und Aufgaben durchsuchen …').isVisible()), 'Offen leer: kein Suchfeld');
  check(!/\d/.test(await p.getByRole('tablist').innerText()), 'Offen leer: keine Nullen an den Reitern');
  check(await p.getByRole('link', { name: 'Zu den Objekten' }).isVisible(), 'Offen leer: nächster Schritt');
  await noOverflow('/maengel (leer)');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-offen-leer.png', fullPage: true });

  step('Ein Objekt, ein Gebäude, drei nie geprüfte Türen: GET /now');
  const me = (await api('/account/me')).json;
  const prop = (await api('/properties', { data: { name: 'Seehafer Elemente' } })).json;
  const bld = (await api(`/properties/${prop.id}/buildings`, { data: { name: 'Hauptgebäude' } })).json;
  const doors = [];
  // Stammdaten bekannt (zweiflügelig mit Feststellanlage): alle Punkte treffen zu, „Alles in Ordnung“ beantwortet alle
  for (const loc of ['Flur EG', 'Flur OG', 'Treppenhaus'])
    doors.push((await api('/assets', { data: { buildingId: bld.id, category: 'fire_door', location: loc, floor: 'EG', attributes: { holdOpen: true, leaves: '2-flügelig', requirement: 'T30-RS', cardLock: true, dropSeal: true, peephole: true } } })).json);
  check(doors.every((d) => d?.id), 'drei Türen angelegt');
  const now = (await api('/now?limit=50')).json;
  check(!now.items.some((i) => i.automation === 'monthly_report'), 'keine Monatsberichte ohne Prüfungen im Vormonat');
  check(!now.items.some((i) => i.kind === 'walkthrough_due'), 'keine Begehungs-Zeile ohne je begonnene Begehung');
  const never = now.items.filter((i) => i.kind === 'never');
  check(never.length === 1 && never[0].title === '3 Elemente noch nie geprüft' && never[0].action.label === 'Rundgang starten' && never[0].action.link === `/rundgang/${bld.id}`, `„nie geprüft“ mit Rundgang (${JSON.stringify(never)})`);
  check(!now.items.some((i) => i.id === `round-${bld.id}`), 'keine doppelte Rundgang-Zeile');
  check(now.items[0]?.kind === 'never', `„nie geprüft“ steht oben (${now.items.map((i) => i.kind)})`);

  step('Kalender: „Rundgang starten“ unter Jetzt, ohne Lärm');
  await p.goto(BASE + '/kalender');
  await p.getByRole('heading', { name: 'Jetzt' }).waitFor();
  const jetzt = p.getByRole('list', { name: 'Jetzt' });
  check(await jetzt.getByRole('button', { name: /Rundgang starten/ }).first().isVisible(), 'Rundgang starten unter Jetzt');
  check((await jetzt.innerText()).includes('3 Elemente noch nie geprüft'), 'Jetzt: nie geprüft');
  check(!/Monatsbericht|Begehung/.test(await jetzt.innerText()), 'Jetzt: keine Monatsberichte, keine Begehung');
  check(!(await p.getByRole('heading', { name: 'Überfällig', exact: true }).count()), 'Kalender: kein leerer Überfällig-Block');
  await noOverflow('/kalender (neues Konto)');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-heute-neu.png', fullPage: true });

  step('Objektliste mit Elementen: nur, was ungleich null ist');
  await p.goto(BASE + '/objekte');
  const row = p.getByRole('list', { name: 'Objekte' }).locator(`[data-property="${prop.id}"]`);
  await row.waitFor();
  check((await row.locator('[data-ampel]').count()) === 1 && (await row.locator('[data-ampel="due"]').innerText()).includes('3 nie geprüft'), `Ampel: nur „3 nie geprüft“ (${await row.innerText()})`);
  await noOverflow('/objekte');

  step('Rundgang: erste Tür in zwei Tipps (gemerkte Unterschrift)');
  // gemerkte Unterschrift (nur auf dem Gerät, wie im echten Ablauf): ein Namenszug, im Browser gezeichnet
  const SIG = await p.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 120;
    const x = c.getContext('2d');
    x.strokeStyle = '#1a1714';
    x.lineWidth = 3;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(20, 80);
    x.bezierCurveTo(60, 10, 90, 110, 130, 60);
    x.bezierCurveTo(160, 20, 190, 100, 230, 50);
    x.bezierCurveTo(260, 20, 300, 90, 340, 40);
    x.stroke();
    return c.toDataURL('image/png');
  });
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`pk:signature:${me.user.id}`, SIG]);
  await p.getByRole('link', { name: 'Rundgang starten' }).first().click();
  await p.waitForURL(/\/rundgang\//);
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL(/\/pruefung\//);
  const id1 = p.url().split('/pruefung/')[1].split('?')[0];
  await p.getByRole('button', { name: 'Alles in Ordnung' }).waitFor();
  // Start: alle Gruppen eingeklappt, keine Antwortknöpfe sichtbar
  const groups = p.locator('[data-group] > button[aria-expanded]');
  // Tür (Plan v7): zehn Gruppen nach Bauteil
  check((await groups.count()) === 10, `zehn Gruppen (${await groups.count()})`);
  check((await p.locator('[data-group] > button[aria-expanded="true"]').count()) === 0, 'am Anfang alles eingeklappt');
  check((await p.getByRole('radio', { name: 'Mangel' }).count()) === 0, 'keine 16 × 3 Knöpfe');
  check((await p.locator('[data-group]').first().innerText()).includes('0 von 2 i. O.'), 'Gruppenzähler');
  const okBox = await p.getByRole('button', { name: 'Alles in Ordnung' }).boundingBox();
  check(okBox.height >= 56 && okBox.y < 200, `„Alles in Ordnung“ groß und oben (${Math.round(okBox.height)} px bei y=${Math.round(okBox.y)})`);
  await noOverflow('Prüfung Start');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-pruefung-start.png' });
  let taps = 0;
  await p.getByRole('button', { name: 'Alles in Ordnung' }).click();
  taps++;
  await toastClear('nach „Alles in Ordnung“');
  check((await p.locator('[data-toast]').innerText()).includes('Rückgängig'), 'Meldung mit „Rückgängig“');
  check((await p.locator('[data-group] > button[aria-expanded="true"]').count()) === 0, 'alles i. O.: Gruppen bleiben zu');
  check((await p.locator('[data-group]').nth(2).innerText()).includes('3 von 3 i. O.'), '„3 von 3 i. O.“');
  check(await p.getByRole('heading', { name: 'Unterschrift' }).isVisible(), 'springt zur Unterschrift');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-pruefung-alles-ok.png' });
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  taps++;
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  check(taps === 2, `mängelfreie Prüfung in ${taps} Tipps`);
  console.log(`  Tipps (mängelfrei, gemerkte Unterschrift): ${taps}`);
  const i1 = (await api(`/inspections/${id1}`)).json;
  check(i1.status === 'submitted' && i1.result === 'ok' && i1.signature === SIG && Object.values(i1.answers).every((a) => a === 'ok'), `abgeschlossen, ohne Mängel, gemerkte Unterschrift (${i1.status} ${i1.result})`);
  step('Rundgang springt weiter, Meldung über der Handy-Leiste');
  await toastClear('Rundgang nach Abschluss');
  await p.getByText('Weiter mit').waitFor();
  check((await p.getByText('1 von 3 geprüft').count()) === 1, 'Rundgang: 1 von 3');

  step('Zweite Tür: Rückgängig, Gruppen, Weitere Angaben');
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL(/\/pruefung\//);
  const id2 = p.url().split('/pruefung/')[1].split('?')[0];
  await p.getByRole('button', { name: 'Alles in Ordnung' }).click();
  await p.locator('[data-toast]').getByRole('button', { name: 'Rückgängig' }).click();
  await p.waitForTimeout(200);
  check((await p.locator('[data-group]').nth(2).innerText()).includes('0 von 3 i. O.'), 'Rückgängig: Punkte wieder offen');
  check(await p.getByRole('button', { name: 'Alles in Ordnung' }).isVisible(), 'Rückgängig: „Alles in Ordnung“ wieder da');
  await new Promise((res) => setTimeout(res, 900));
  check(!(await api(`/inspections/${id2}`)).json.signature, 'Rückgängig: gemerkte Unterschrift wieder entfernt');
  // Gruppe von Hand aufklappen, einzelner Punkt bleibt voll bedienbar
  await p.getByRole('button', { name: /Schließmittel und OTS/ }).click();
  const mech = p.locator('[data-group="g:Schließmittel und OTS"]');
  check((await mech.getByRole('radiogroup').count()) === 3, 'aufgeklappt: drei Punkte');
  await mech.locator('[data-cp="p11"]').getByRole('radio', { name: 'Nicht zutreffend' }).click();
  check((await mech.locator('> button').innerText()).includes('1 n. z.'), 'einzelner Punkt beantwortet');
  await mech.locator('> button').click();
  check((await mech.getByRole('radiogroup').count()) === 0, 'Gruppe wieder eingeklappt');
  // Weitere Angaben: eingeklappt, enthält Art, nicht prüfbar, Arbeiten, Bemerkung
  check(!(await p.getByRole('switch', { name: 'Nicht prüfbar' }).count()), '„Nicht prüfbar“ eingeklappt');
  await p.getByRole('button', { name: /Weitere Angaben/ }).click();
  await p.getByRole('switch', { name: 'Nicht prüfbar' }).waitFor();
  check(await p.getByRole('button', { name: 'Schließer nachjustiert' }).isVisible(), 'Wartungsarbeiten');
  check(await p.getByLabel('Bemerkungen').isVisible(), 'Bemerkung');
  check(await p.getByText('Art der Prüfung').first().isVisible(), 'Art der Prüfung');
  await p.getByRole('button', { name: 'Schließer nachjustiert' }).click();
  await p.getByRole('button', { name: /Weitere Angaben/ }).click();
  check(!(await p.getByRole('switch', { name: 'Nicht prüfbar' }).count()), 'Weitere Angaben wieder zu');
  check((await p.getByRole('button', { name: /Weitere Angaben/ }).innerText()).includes('1 Arbeit'), 'Zusammenfassung zeigt die Arbeit');

  step('Abweichung einsprechen (getippt) + „Alles andere in Ordnung“ + „Abschließen“');
  let dtaps = 0;
  await p.getByRole('button', { name: 'Abweichung einsprechen' }).click();
  dtaps++;
  const voice = p.getByRole('region', { name: 'Befund einsprechen' });
  await voice.getByLabel('Eingesprochener Befund').fill('Obentürschließer schließt nicht, mittel');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-pruefung-abweichung.png' });
  await p.getByRole('button', { name: 'Alles andere in Ordnung' }).click();
  dtaps++;
  await toastClear('nach „Alles andere in Ordnung“');
  check(/1 Mangel eingetragen/.test(await p.locator('[data-toast]').innerText()), 'Meldung nennt den Mangel');
  const open = await p.locator('[data-group] > button[aria-expanded="true"]').count();
  check(open === 1 && (await mech.locator('> button').getAttribute('aria-expanded')) === 'true', `nur die Gruppe mit Mangel offen (${open})`);
  check((await mech.locator('[data-cp="p10"]').getByRole('radio', { name: 'Mangel' }).getAttribute('aria-checked')) === 'true', 'Mangel beim Obentürschließer');
  check((await mech.locator('> button').innerText()).includes('1 Mangel'), 'Gruppenzähler mit Mangel');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'm-pruefung-mangel.png' });
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  dtaps++;
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  console.log(`  Tipps (ein Mangel): ${dtaps} + ein getippter Satz`);
  check(dtaps === 3, `mit Mangel: drei Tipps und ein Satz (${dtaps})`);
  const i2 = (await api(`/inspections/${id2}`)).json;
  const d2 = (await api('/defects?status=all')).json.filter((d) => d.inspectionId === id2);
  check(i2.status === 'submitted' && i2.result === 'defects' && i2.answers.p10 === 'defect' && i2.answers.p11 === 'na', `Ergebnis mit Mangel (${i2.result}, p11=${i2.answers.p11})`);
  check(d2.length === 1 && d2[0].checkpointId === 'p10' && d2[0].severity === 'medium', `ein Mangel am Punkt (${JSON.stringify(d2.map((d) => [d.checkpointId, d.severity]))})`);
  check(i2.maintenance.includes('closer'), 'Wartungsarbeit gespeichert');

  step('Desktop 1360 px: Prüfung Start und nach „Alles in Ordnung“, Kalender');
  const dctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', storageState: await m.storageState() });
  const dp = await dctx.newPage();
  watch(dp);
  const i3 = (await api(`/assets/${doors[2].id}/inspections`, { data: {} })).json;
  await dp.goto(BASE + '/pruefung/' + i3.id);
  await dp.getByRole('button', { name: 'Alles in Ordnung' }).waitFor();
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: OUT + 'd-pruefung-start.png' });
  await dp.getByRole('button', { name: 'Alles in Ordnung' }).click();
  await dp.locator('[data-toast]').waitFor();
  const dtb = await dp.locator('[data-toast]').boundingBox();
  const dbar = await dp.locator('[data-toast-avoid]').boundingBox();
  check(dtb.y + dtb.height <= dbar.y, 'Desktop: Meldung über der Abschlussleiste');
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: OUT + 'd-pruefung-alles-ok.png' });
  await dp.goto(BASE + '/kalender');
  await dp.getByRole('heading', { name: 'Jetzt' }).waitFor();
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: OUT + 'd-heute.png', fullPage: true });
  await dctx.close();

  step('Plan v6 A3/A4 (390 px): Laufreihenfolge im Rundgang, „entfällt“ und Rückfrage nach Stammdaten');
  const bld2 = (await api(`/properties/${prop.id}/buildings`, { data: { name: 'Nebenhaus' } })).json;
  // angelegt 2. OG → EG → UG → EG; gelaufen wird von unten nach oben, in der Etage in Anlage-Reihenfolge
  // v7: Anforderung und Ausstattung bekannt, damit nur Schließfolge und Feststellanlage entfallen
  const V7 = { requirement: 'T30-RS', cardLock: true, dropSeal: true, peephole: true };
  const made = [];
  for (const [floor, loc, attributes] of [
    ['2. OG', 'Dachflur', { holdOpen: false, leaves: '1-flügelig', ...V7 }],
    ['EG', 'Eingang', {}],
    ['UG', 'Heizraum', { holdOpen: false, leaves: '1-flügelig', ...V7 }],
    ['EG', 'Küche', { holdOpen: false, leaves: '1-flügelig', ...V7 }],
  ])
    made.push((await api('/assets', { data: { buildingId: bld2.id, category: 'fire_door', location: loc, floor, attributes } })).json);
  await p.goto(BASE + `/rundgang/${bld2.id}`);
  await p.getByRole('button', { name: 'Prüfung starten' }).waitFor();
  const firstCode = (await p.locator('.text-h2').first().innerText()).trim();
  const after = await p.getByRole('list', { name: 'Danach' }).locator('li').allInnerTexts();
  const walkOrder = [firstCode, ...after.map((t) => t.replace(/^\d+\s*/, '').split(' ')[0])];
  const codeOf = (i) => made[i].code;
  check(walkOrder.join(',') === [codeOf(2), codeOf(1), codeOf(3), codeOf(0)].join(','), `Rundgang UG → EG (Eingang, Küche) → 2. OG (${walkOrder.join(',')})`);
  await noOverflow('Rundgang Laufreihenfolge');
  await p.screenshot({ path: OUT + 'm-rundgang-reihenfolge.png' });
  // einflügelig ohne Feststellanlage: drei Punkte „entfällt“, keine Rückfrage
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL(/\/pruefung\//);
  const id4 = p.url().split('/pruefung/')[1].split('?')[0];
  await p.getByRole('button', { name: 'Alles in Ordnung' }).click();
  check(/3 entfällt/.test(await p.locator('[data-toast]').innerText()), `Meldung nennt „3 entfällt“ (${await p.locator('[data-toast]').innerText()})`);
  check(!(await p.locator('[data-question]').count()), 'keine Rückfrage bei bekannten Stammdaten');
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  const i4 = (await api(`/inspections/${id4}`)).json;
  check(i4.status === 'submitted' && i4.answers.p12 === 'na' && i4.answers.p22 === 'na' && i4.answers.p23 === 'na' && i4.answers.p10 === 'ok', `einflügelig ohne FSA: p12/p22/p23 entfällt (${JSON.stringify([i4.answers.p12, i4.answers.p22, i4.answers.p23])})`);
  // Stammdaten unbekannt: Punkte bleiben offen, gezielte Rückfrage; die Antwort wird am Element gespeichert
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL(/\/pruefung\//);
  const id5 = p.url().split('/pruefung/')[1].split('?')[0];
  await p.getByRole('button', { name: 'Alles in Ordnung' }).click();
  const qFsa = p.getByRole('group', { name: 'Hat die Tür eine Feststellanlage?' });
  const qLeaves = p.getByRole('group', { name: 'Ist die Tür ein- oder zweiflügelig?' });
  await qFsa.waitFor();
  check(await qLeaves.isVisible(), 'Rückfrage ein-/zweiflügelig');
  check(/offen – bitte Rückfrage beantworten/.test(await p.locator('[data-toast]').innerText()), 'Meldung nennt die offenen Punkte');
  await noOverflow('Prüfung mit Rückfrage');
  await p.screenshot({ path: OUT + 'm-pruefung-rueckfrage.png' });
  await qFsa.getByRole('button', { name: 'Nein' }).click();
  await qLeaves.getByRole('button', { name: '2-flügelig' }).click();
  // v7: Anforderung und Ausstattung (Kartenschloss, Absenkdichtung, Spion) ebenfalls unbekannt
  await p.getByRole('group', { name: /Welche Anforderung hat die Tür/ }).getByRole('button', { name: 'T30-RS' }).click();
  for (const q of ['Hat die Tür ein Kartenschloss bzw. einen elektronischen Beschlag?', 'Hat die Tür eine Absenkdichtung?', 'Hat die Tür einen Türspion?'])
    await p.getByRole('group', { name: q }).getByRole('button', { name: 'Nein' }).click();
  check(!(await p.locator('[data-question]').count()), 'Rückfragen beantwortet');
  await p.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await p.waitForURL(/\/rundgang\/.*fertig=/);
  const i5 = (await api(`/inspections/${id5}`)).json;
  check(i5.status === 'submitted' && i5.answers.p12 === 'ok' && i5.answers.p22 === 'na' && i5.answers.p23 === 'na', `Antworten: zweiflügelig → Schließfolge i. O., ohne FSA → entfällt (${JSON.stringify([i5.answers.p12, i5.answers.p22])})`);
  const a5 = (await api(`/assets/${made[1].id}`)).json;
  check(a5.attributes.holdOpen === false && a5.attributes.leaves === '2-flügelig', `Stammdaten am Element gespeichert (${JSON.stringify(a5.attributes)})`);

  check(!errors.length, `Browserfehler: ${errors.slice(0, 3).join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
