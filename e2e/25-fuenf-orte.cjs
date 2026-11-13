// E2E 25-fuenf-orte: Navigation mit fünf Orten (docs/plan/v4.md 5): Heute, Objekte, Prüfen, Offen, Berichte –
// Seitenleiste und Handy-Leiste, Einstellungen als Sammelort, Umleitungen aller alten Adressen samt Query,
// Prüfen-Überblick, „Offen“ als eine Arbeitsliste mit Umschalter, „Heute“ am Handy (≤ 5 Jetzt-Zeilen, Aktion rechts),
// 390 px ohne horizontalen Überlauf. Bilder für docs/design/v3 entstehen in e2e/.out/25-fuenf-orte. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '25-fuenf-orte') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const PLACES = ['Heute', 'Objekte', 'Prüfen', 'Offen', 'Berichte'];

(async () => {
  if (process.env.PROD) throw new Error('25-fuenf-orte nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
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
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Seitenleiste: genau fünf Orte, Einstellungen über Zahnrad und Konto-Menü');
  const side = p.getByRole('navigation', { name: 'Orte' });
  const sideLinks = await side.getByRole('link').allInnerTexts();
  check(JSON.stringify(sideLinks.map((t) => t.replace(/\s*\d+$/, '').trim())) === JSON.stringify(PLACES), `fünf Orte (${sideLinks.join(', ')})`);
  for (const old of ['Mängel', 'Aufgaben', 'Elemente', 'Begehungen', 'Team', 'Subunternehmer', 'Import', 'Offline-Modus', 'Anleitung & Hilfe']) {
    check((await p.getByRole('complementary').getByRole('link', { name: old, exact: true }).count()) === 0, `kein Navigationspunkt „${old}“`);
  }
  check((await side.getByRole('link', { name: 'Heute' }).getAttribute('aria-current')) === 'page', 'Heute aktiv');
  await p.getByRole('complementary').getByRole('button', { name: /Nordlicht|Krüger/ }).first().click();
  check(await p.getByRole('menu', { name: 'Konto' }).getByRole('menuitem', { name: 'Einstellungen' }).isVisible(), 'Konto-Menü mit Einstellungen');
  await p.keyboard.press('Escape');
  await p.getByRole('complementary').getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await p.waitForURL((u) => u.pathname === '/einstellungen');
  const settingsNav = p.getByRole('navigation', { name: 'Einstellungen' });
  for (const n of ['Konto', 'Team', 'Subunternehmer', 'Prüfvorlagen', 'Automatik', 'Import', 'Offline-Modus', 'Anleitung & Hilfe']) {
    check((await settingsNav.getByRole('tab', { name: n, exact: true }).count()) === 1, `Einstellungen enthalten „${n}“`);
  }
  await settingsNav.getByRole('tab', { name: 'Team', exact: true }).click();
  await p.waitForURL((u) => u.pathname === '/einstellungen/team');
  await p.getByRole('heading', { name: 'Team', level: 1 }).waitFor();
  check((await settingsNav.getByRole('tab', { name: 'Team', exact: true }).getAttribute('aria-selected')) === 'true', 'Team in der Einstellungs-Spalte aktiv');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-einstellungen-team.png' });

  step('Alte Adressen leiten um – samt Query');
  const defects = (await api('/defects?status=open')).json;
  const tasks = (await api('/tasks')).json;
  const openTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const d0 = defects[0];
  const t0 = openTasks[0];
  const cases = [
    [`/maengel?id=${d0.id}&tab=open`, '/offen', { art: 'maengel', mangel: d0.id, tab: 'open' }, 'Offen'],
    ['/maengel?tab=resolved', '/offen', { art: 'maengel', tab: 'resolved' }, 'Offen'],
    [`/aufgaben?id=${t0.id}`, '/offen', { art: 'aufgaben', aufgabe: t0.id }, 'Offen'],
    ['/aufgaben?ansicht=stats', '/offen', { art: 'aufgaben' }, 'Offen'],
    ['/pruefungen', '/pruefen', {}, 'Prüfen'],
    ['/pruefungen?tab=done&pruefart=main', '/pruefen', { tab: 'done', pruefart: 'main' }, 'Prüfen'],
    ['/begehungen', '/pruefen/begehungen', {}, 'Prüfen'],
    ['/team', '/einstellungen/team', {}, null],
    ['/subunternehmer', '/einstellungen/subunternehmer', {}, null],
    ['/import', '/einstellungen/import', {}, null],
    ['/hilfe?q=Rundgang', '/einstellungen/hilfe', { q: 'Rundgang' }, null],
    ['/elemente?status=overdue', '/elemente', { status: 'overdue' }, 'Objekte'],
    ['/offline', '/offline', {}, 'Prüfen'],
  ];
  for (const [from, path, query, place] of cases) {
    await p.goto(BASE + from);
    await p.waitForURL((u) => u.pathname === path);
    await p.waitForLoadState('networkidle');
    const u = new URL(p.url());
    const got = Object.fromEntries(u.searchParams);
    check(JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(query).sort()) && Object.entries(query).every(([k, v]) => got[k] === v), `${from} → ${u.pathname}${u.search} (erwartet ${path} ${JSON.stringify(query)})`);
    check((await p.locator('main h1').count()) > 0, `${from}: Seite statt 404`);
    if (place) check((await side.getByRole('link', { name: place }).getAttribute('aria-current')) === 'page', `${from}: Ort „${place}“ hervorgehoben`);
  }
  // Details öffnen über die umgeleiteten Links
  await p.goto(BASE + `/maengel?id=${d0.id}`);
  await p.getByRole('dialog').getByText(d0.title).first().waitFor();
  await p.goto(BASE + `/aufgaben?id=${t0.id}`);
  await p.getByRole('dialog').getByTestId('watchers').waitFor();
  await p.keyboard.press('Escape');
  await p.waitForURL((u) => !u.searchParams.get('aufgabe'));

  step('Prüfen: ein Überblick in einer Fläche');
  await p.goto(BASE + '/pruefen');
  for (const h of ['Rundgänge', 'Fällig', 'Begehungen', 'Zuletzt abgeschlossen']) await p.getByRole('heading', { name: new RegExp(`^${h}( \\d+)?$`) }).waitFor();
  // v5: leere Abschnitte fehlen ganz – „Angefangen“ nur mit Entwürfen
  const drafts = (await api('/inspections?status=draft')).json;
  check((await p.getByRole('heading', { name: /^Angefangen( \d+)?$/ }).count()) === (drafts.length ? 1 : 0), `„Angefangen“ nur mit Entwürfen (${drafts.length})`);
  check((await p.locator('main .bg-surface.sm\\:rounded-xl').count()) === 1, 'eine weiße Fläche');
  const rounds = (await api('/smart/rounds?days=30')).json;
  check((await p.getByRole('list', { name: 'Rundgänge' }).getByRole('link').count()) === Math.min(6, rounds.filter((r) => r.overdue + r.due + r.never > 0).length), 'Rundgänge aus /smart/rounds');
  check(await p.getByRole('link', { name: 'Rundgang starten' }).isVisible(), 'Rundgang starten im Kopf');
  check(await p.getByRole('main').getByRole('link', { name: 'Scannen' }).isVisible(), 'Scannen im Kopf');
  const dash = (await api('/dashboard')).json;
  const overdueRow = p.getByRole('list', { name: 'Fällig' }).getByRole('link', { name: /Überfällig/ });
  check((await overdueRow.innerText()).includes(String(dash.counts.overdue)), 'Überfällig mit Zahl');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-pruefen.png', fullPage: true });
  await overdueRow.click();
  await p.waitForURL((u) => u.pathname === '/pruefen' && u.searchParams.get('tab') === 'overdue');
  await p.getByRole('tab', { name: /Überfällig/, selected: true }).waitFor();
  await p.getByRole('link', { name: 'Prüfen', exact: true }).first().waitFor();
  await p.getByRole('main').getByRole('link', { name: 'Prüfen' }).click();
  await p.getByRole('heading', { name: /^Rundgänge/ }).waitFor();
  await p.locator('section', { has: p.getByRole('heading', { name: 'Begehungen', exact: true }) }).getByRole('link', { name: 'Alle' }).click();
  await p.waitForURL((u) => u.pathname === '/pruefen/begehungen');
  await p.getByRole('heading', { name: 'Begehungen', level: 1 }).waitFor();

  step('Offen: eine Arbeitsliste mit Umschalter');
  await p.goto(BASE + '/offen');
  await p.getByRole('heading', { name: 'Offen', level: 1 }).waitFor();
  const free = defects.filter((d) => !d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled');
  await p.getByRole('tab', { name: /^Alle/, selected: true }).waitFor();
  const hasTab = (label, n) => p.getByRole('tab', { name: new RegExp(`^${label}\\s*${n}$`) }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(await hasTab('Alle', openTasks.length + free.length), `„Alle“ zählt Aufgaben + Mängel ohne Aufgabe (${openTasks.length}+${free.length})`);
  check(await hasTab('Mängel', defects.length), 'Mängel zählt offene Mängel');
  check(await hasTab('Aufgaben', openTasks.length), 'Aufgaben zählt offene Aufgaben');
  await p.locator('[data-task]').first().waitFor();
  check((await p.locator('[data-defect]').count()) === free.length, `Mängel ohne Aufgabe in „Alle“ (${await p.locator('[data-defect]').count()}/${free.length})`);
  check((await p.locator('[data-task]').count()) === openTasks.length, 'alle offenen Aufgaben in „Alle“');
  const withTask = defects.find((d) => !free.includes(d));
  if (withTask) check((await p.locator(`[data-defect="${withTask.id}"]`).count()) === 0, 'Mangel mit offener Aufgabe steht nur als Aufgabe da');
  const firstGroup = await p.getByRole('region').first().getAttribute('aria-label');
  check(firstGroup === 'Dringend', `oben das Dringendste (${firstGroup})`);
  check((await p.getByRole('tab', { name: 'Übersicht' }).count()) === 0, 'keine Aufgaben-Übersicht mehr');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-offen.png', fullPage: true });
  // Suche
  await p.getByPlaceholder('Mängel und Aufgaben durchsuchen …').fill(t0.title.slice(0, 18));
  await p.locator(`[data-task="${t0.id}"]`).waitFor();
  check((await p.locator('[data-task], [data-defect]').count()) < openTasks.length + free.length, 'Suche grenzt ein');
  // Detail aus „Alle“
  await p.locator(`[data-task="${t0.id}"] [data-row-main]`).click();
  await p.waitForURL((u) => u.searchParams.get('aufgabe') === t0.id);
  await p.getByRole('dialog').getByTestId('watchers').waitFor();
  await p.keyboard.press('Escape');
  // Umschalter
  await p.getByRole('tab', { name: /^Mängel/ }).click();
  await p.waitForURL((u) => u.searchParams.get('art') === 'maengel');
  await p.getByRole('tab', { name: /^Offen/, selected: true }).waitFor();
  await p.locator('[data-defect]').first().waitFor();
  check((await p.locator('[data-task]').count()) === 0 && (await p.locator('[data-defect]').count()) === defects.length, 'Mängel: nur Mängel, alle offenen');
  await p.getByRole('tab', { name: 'Behoben' }).click();
  await p.waitForURL((u) => u.searchParams.get('tab') === 'resolved');
  await p.getByRole('tab', { name: /^Aufgaben/ }).click();
  await p.waitForURL((u) => u.searchParams.get('art') === 'aufgaben');
  await p.locator('[data-task]').first().waitFor();
  check((await p.locator('[data-defect]').count()) === 0, 'Aufgaben: nur Aufgaben');
  await p.getByRole('tab', { name: 'Erledigt' }).click();
  await p.waitForURL((u) => u.searchParams.get('ansicht') === 'done');
  // Neue Aufgabe per Taste C aus jeder Ansicht
  await p.getByRole('tab', { name: /^Alle/ }).click();
  await p.keyboard.press('c');
  await p.getByRole('dialog').getByRole('heading', { name: /Neue Aufgabe/ }).waitFor();
  await p.keyboard.press('Escape');

  step('Objekte: Objekte und „Alle Elemente“ als Ansichten');
  await p.goto(BASE + '/objekte');
  await p.getByRole('tab', { name: 'Objekte', selected: true }).waitFor();
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-objekte.png', fullPage: true });
  await p.getByRole('tab', { name: 'Alle Elemente' }).click();
  await p.waitForURL((u) => u.pathname === '/elemente');
  await p.getByRole('tab', { name: 'Alle Elemente', selected: true }).waitFor();
  check((await side.getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'Elemente gehören zu Objekte');

  step('Heute (Desktop): Lage, Knöpfe, Prüfstatus, Jetzt – ohne Objekte, Aufgaben, Rundgänge');
  await p.goto(BASE + '/');
  await p.getByRole('heading', { name: 'Jetzt' }).waitFor();
  for (const h of ['Objekte', 'Offene Aufgaben', 'Rundgänge']) check((await p.getByRole('heading', { name: h, exact: true }).count()) === 0, `Heute ohne „${h}“`);
  check((await p.getByRole('link', { name: 'Mängel offen' }).getAttribute('href')) === '/offen?art=maengel', 'Kennzahl Mängel → Offen');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-heute.png', fullPage: true });

  step('Handy 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  watch(mp);
  await mp.goto(BASE + '/');
  await mp.getByText('Prüfstatus').waitFor();
  const bar = mp.getByRole('navigation', { name: 'Hauptnavigation' });
  const barLinks = (await bar.getByRole('link').allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(barLinks) === JSON.stringify(['Heute', 'Prüfen', 'Offen', 'Objekte']), `Handy-Leiste (${barLinks.join(', ')})`);
  check((await bar.getByRole('button').allInnerTexts()).length === 1 && (await bar.getByRole('button', { name: 'Erfassen' }).isVisible()), 'Erfassen mittig, kein „Mehr“');
  const barBox = await bar.boundingBox();
  const micBox = await bar.getByRole('button', { name: 'Erfassen' }).boundingBox();
  check(Math.abs(micBox.x + micBox.width / 2 - (barBox.x + barBox.width / 2)) < 2, 'Erfassen in der Mitte');
  // Konto-Menü: Berichte und Einstellungen
  await mp.getByRole('button', { name: 'Konto und Einstellungen' }).click();
  const menu = mp.getByRole('menu', { name: 'Konto' });
  check((await menu.getByRole('menuitem', { name: 'Berichte' }).isVisible()) && (await menu.getByRole('menuitem', { name: 'Einstellungen' }).isVisible()), 'Konto-Menü mit Berichte und Einstellungen');
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: OUT + 'm-konto.png' });
  await menu.getByRole('menuitem', { name: 'Berichte' }).click();
  await mp.waitForURL((u) => u.pathname === '/berichte');

  // Heute: Jetzt höchstens 5 Zeilen, Aktion rechts
  await mp.goto(BASE + '/');
  await mp.getByRole('heading', { name: 'Jetzt' }).waitFor();
  const nowApi = (await api('/now')).json;
  const nowTotal = nowApi.items.length + nowApi.more;
  const rows = mp.getByRole('list', { name: 'Jetzt' }).locator(':scope > li:visible');
  const visible = await rows.count();
  check(visible === Math.min(5, nowApi.items.length), `Handy: ${visible} Jetzt-Zeilen sichtbar (höchstens 5)`);
  for (let i = 0; i < visible; i++) {
    const row = rows.nth(i);
    const btn = row.getByRole('button');
    const label = (await btn.innerText()).trim();
    const rb = await row.boundingBox();
    const bb = await btn.boundingBox();
    const title = await row.locator('p').first().boundingBox();
    if (label.length <= 11) check(bb.x > title.x + title.width - 2 && bb.x + bb.width <= rb.x + rb.width + 1, `Jetzt-Zeile ${i + 1}: „${label}“ rechts in der Zeile`);
  }
  for (const h of ['Objekte', 'Offene Aufgaben', 'Rundgänge']) check((await mp.getByRole('heading', { name: h, exact: true }).count()) === 0, `Handy-Heute ohne „${h}“`);
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: OUT + 'm-heute.png', fullPage: true });
  if (nowTotal > 5) {
    const all = mp.getByRole('button', { name: `Alle ${nowTotal} anzeigen` });
    check(await all.isVisible(), `„Alle ${nowTotal} anzeigen“`);
    await all.click();
    await mp.waitForFunction((n) => document.querySelectorAll('[aria-label="Jetzt"] > li').length >= n && [...document.querySelectorAll('[aria-label="Jetzt"] > li')].every((li) => li.offsetParent !== null), Math.min(nowTotal, 50));
    check((await rows.count()) === Math.min(nowTotal, 50), 'danach alle Zeilen');
  }

  // Kein Überlauf auf allen Orten (und den wichtigsten Unterseiten)
  const shots = { '/pruefen': 'm-pruefen.png', '/offen': 'm-offen.png', '/objekte': 'm-objekte.png' };
  for (const path of ['/', '/objekte', '/elemente', '/pruefen', '/pruefen?tab=overdue', '/pruefen?tab=done', '/pruefen/begehungen', '/offen', '/offen?art=maengel', '/offen?art=aufgaben', '/berichte', '/einstellungen', '/einstellungen/team', '/einstellungen/hilfe']) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    await mp.locator('main h1').first().waitFor();
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${path} (${over}px)`);
    if (shots[path]) await mp.waitForTimeout(500);
    if (shots[path]) await mp.screenshot({ path: OUT + shots[path], fullPage: true });
  }
  // aktiver Reiter der Handy-Leiste
  await mp.goto(BASE + '/offen?art=maengel');
  check((await bar.getByRole('link', { name: 'Offen' }).getAttribute('aria-current')) === 'page', 'Handy: Offen aktiv');
  await mp.goto(BASE + '/elemente');
  check((await bar.getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'Handy: Elemente → Objekte aktiv');
  await m.close();

  check(!errors.length, `Browserfehler: ${errors.slice(0, 3).join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
