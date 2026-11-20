// E2E 25-fuenf-orte: was von den fünf Orten (docs/plan/v4.md 5) bleibt, an seinem neuen Ort (Plan v8, zwei Orte):
// die Arbeitsliste „Offen“ als Seite „Mängel und Aufgaben“ (/maengel, Umschalter Alle · Mängel · Aufgaben, Dringendes
// zuerst, Suche, Detail, Taste C), Einstellungen als Sammelort, „Alle Elemente“ unter Objekte und „Jetzt“ im Kalender am
// Handy (≤ 5 Zeilen, Aktion rechts). Navigation, Weiterleitungen und Kalender prüft e2e/35-zwei-orte. Nur lokal.
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
  await p.waitForURL((u) => u.pathname.startsWith('/objekte'));

  step('Einstellungen als Sammelort');
  await p.getByRole('navigation', { name: 'Orte' }).getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await p.waitForURL((u) => u.pathname === '/einstellungen');
  const settingsNav = p.getByRole('navigation', { name: 'Einstellungen' });
  for (const n of ['Konto', 'Team', 'Subunternehmer', 'Berichte', 'Prüfvorlagen', 'Automatik', 'Import', 'Offline-Modus', 'Anleitung & Hilfe']) {
    check((await settingsNav.getByRole('tab', { name: n, exact: true }).count()) === 1, `Einstellungen enthalten „${n}“`);
  }
  await settingsNav.getByRole('tab', { name: 'Team', exact: true }).click();
  await p.waitForURL((u) => u.pathname === '/einstellungen/team');
  await p.getByRole('heading', { name: 'Team', level: 1 }).waitFor();
  check((await settingsNav.getByRole('tab', { name: 'Team', exact: true }).getAttribute('aria-selected')) === 'true', 'Team in der Einstellungs-Spalte aktiv');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-einstellungen-team.png' });
  const defects = (await api('/defects?status=open')).json;
  const tasks = (await api('/tasks')).json;
  const openTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const t0 = openTasks[0];

  step('Mängel und Aufgaben (früher „Offen“): eine Arbeitsliste mit Umschalter');
  await p.goto(BASE + '/maengel?art=alle');
  await p.getByRole('heading', { name: 'Mängel und Aufgaben', level: 1 }).waitFor();
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
  // am Desktop öffnet /objekte ein Objekt (die Liste ist die Leiste) – die Ansichten stehen auf der Handy-Startseite
  await p.setViewportSize({ width: 900, height: 900 });
  await p.goto(BASE + '/objekte');
  await p.getByRole('tab', { name: 'Objekte', selected: true }).waitFor();
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-objekte.png', fullPage: true });
  await p.getByRole('tab', { name: 'Alle Elemente' }).click();
  await p.waitForURL((u) => u.pathname === '/elemente');
  await p.getByRole('tab', { name: 'Alle Elemente', selected: true }).waitFor();
  check((await p.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'Elemente gehören zu Objekte');
  await p.setViewportSize({ width: 1360, height: 900 });

  step('Handy 390 px: „Jetzt“ im Kalender');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', storageState: await ctx.storageState() });
  const mp = await m.newPage();
  watch(mp);
  // Kalender: Jetzt höchstens 5 Zeilen, Aktion rechts
  await mp.goto(BASE + '/kalender');
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
  for (const h of ['Offene Aufgaben', 'Rundgänge']) check((await mp.getByRole('heading', { name: h, exact: true }).count()) === 0, `Kalender ohne „${h}“`);
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: OUT + 'm-jetzt.png', fullPage: true });
  if (nowTotal > 5) {
    const all = mp.getByRole('button', { name: `Alle ${nowTotal} anzeigen` });
    check(await all.isVisible(), `„Alle ${nowTotal} anzeigen“`);
    await all.click();
    await mp.waitForFunction((n) => document.querySelectorAll('[aria-label="Jetzt"] > li').length >= n && [...document.querySelectorAll('[aria-label="Jetzt"] > li')].every((li) => li.offsetParent !== null), Math.min(nowTotal, 50));
    check((await rows.count()) === Math.min(nowTotal, 50), 'danach alle Zeilen');
  }

  // Kein Überlauf auf den Seiten der früheren Orte
  for (const path of ['/maengel?art=alle', '/maengel?art=maengel', '/maengel?art=aufgaben', '/pruefungen?tab=overdue', '/pruefungen?tab=done', '/begehungen', '/einstellungen/berichte', '/einstellungen', '/einstellungen/team', '/einstellungen/hilfe']) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    await mp.locator('main h1').first().waitFor();
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${path} (${over}px)`);
    if (path === '/maengel?art=alle') {
      await mp.waitForTimeout(500);
      await mp.screenshot({ path: OUT + 'm-offen.png', fullPage: true });
    }
  }
  await mp.goto(BASE + '/maengel?art=maengel');
  check((await mp.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'Handy: Mängel und Aufgaben → Objekte aktiv');
  await m.close();

  check(!errors.length, `Browserfehler: ${errors.slice(0, 3).join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
