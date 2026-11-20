// E2E 35-zwei-orte (docs/plan/v8.md, Paket Y): zwei Orte – Objekte und Kalender. Desktop (1360 px): die linke Leiste ist
// die Objektliste mit Ampel (Fälligkeit, Mängel, Unterschriften), Filter und Sortierung „dringendstes zuerst“, rechts das
// zuletzt geöffnete bzw. dringendste Objekt. Handy (390 px): Objektliste als Startseite, untere Leiste Objekte · Erfassen ·
// Kalender, kein horizontaler Überlauf. Weiterleitungen aller alten Adressen samt Query. Kalender: Monat, Liste,
// Bündelung je Objekt und Tag, Sprung ins Objekt, Überfällig-Block, Aufgabe ohne Objekt, Zulassung und Nachweis.
// Leerer Workspace → Ein-Feld-Einstieg. Zählt die API-Aufrufe beim Start von Objektliste und Kalender.
// Die Reiter der Objektseite (?tab=begehung|maengel) baut Paket Z – hier wird nur die Ziel-Adresse geprüft.
// Bilder für docs/design/v3/v8 entstehen in e2e/.out/35-zwei-orte. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '35-zwei-orte') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const DAY = 86_400_000;
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' };
const DESKTOP = { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' };
// Höchstzahl API-Aufrufe beim Start. Vorher „Heute“ (Desktop wie Handy): account/me, categories, catalog, notifications,
// automation/monthly-report (je Sitzung) + dashboard, now, smart/rounds, automation/log = 9. Objektliste und Kalender
// dürfen nicht mehr brauchen – lieber weniger (Desktop-Kalender lädt zusätzlich die Objektliste der Leiste).
const MAX_CALLS = { objekteHandy: 6, kalenderHandy: 8, kalenderDesktop: 9 };

(async () => {
  if (process.env.PROD) throw new Error('35-zwei-orte nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
  };
  const ctx = await b.newContext(DESKTOP);
  const p = await ctx.newPage();
  watch(p);
  const api = async (path, opts = {}, pg = p) => {
    const r = await pg.request.fetch(BASE + '/api' + path, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  /** Zählt API-Aufrufe (ohne Push/Health), bis das Netz ruhig ist. */
  const countCalls = async (pg, path, ready) => {
    const calls = [];
    const h = (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/') && r.resourceType() !== 'document') calls.push(u.pathname + u.search);
    };
    pg.on('request', h);
    await pg.goto(BASE + path);
    await ready();
    await pg.waitForLoadState('networkidle');
    await pg.waitForTimeout(400);
    pg.off('request', h);
    return calls;
  };
  const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const urlIs = (pg, path, query = {}) => {
    const u = new URL(pg.url());
    const got = Object.fromEntries(u.searchParams);
    return u.pathname === path && JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(query).sort()) && Object.entries(query).every(([k, v]) => got[k] === v);
  };

  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(PW);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.waitForURL((u) => /^\/objekte\/[a-z0-9]+$/.test(u.pathname));

  step('Desktop: nach der Anmeldung das dringendste Objekt, links die Objektliste mit Ampel');
  const props = (await api('/properties')).json;
  check(props.length >= 4, `Demodaten mit mehreren Objekten (${props.length})`);
  for (const k of ['nextDue', 'overdue', 'openDefects', 'criticalDefects', 'pendingSignatures']) check(props.every((x) => k in x), `GET /properties liefert ${k}`);
  const side = p.getByRole('navigation', { name: 'Objekte' });
  await side.locator('[data-property]').first().waitFor();
  const ids = await side.locator('[data-property]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-property'), Number(e.getAttribute('data-tier'))]));
  check(ids.length === props.length, `alle Objekte in der Leiste (${ids.length}/${props.length})`);
  check(ids.every((x, i) => i === 0 || ids[i - 1][1] <= x[1]), `dringendstes zuerst (Stufen ${ids.map((x) => x[1]).join(',')})`);
  const first = ids[0][0];
  check(p.url().endsWith(`/objekte/${first}`), `ohne Wahl öffnet das dringendste Objekt (${p.url()})`);
  check((await side.locator(`[data-property="${first}"]`).getAttribute('aria-current')) === 'page', 'gewähltes Objekt hervorgehoben');
  // Ampel je Zeile: nur, was ungleich null ist
  for (const x of props) {
    const row = side.locator(`[data-property="${x.id}"]`);
    const text = await row.innerText();
    const has = async (k) => (await row.locator(`[data-ampel="${k}"]`).count()) > 0;
    check((await has('defects')) === x.openDefects > 0, `${x.name}: Mängel-Angabe nur mit offenen Mängeln (${x.openDefects})`);
    if (x.openDefects) check(text.includes(`${x.openDefects} ${x.openDefects === 1 ? 'Mangel' : 'Mängel'}`), `${x.name}: Zahl der Mängel (${text})`);
    if (x.criticalDefects) check(text.includes(`${x.criticalDefects} kritisch`) && (await row.locator('[data-ampel="defects"].text-shu').count()) === 1, `${x.name}: kritische Mängel in Zinnober`);
    if (x.overdue) check(/überfällig seit/.test(text) && (await row.locator('[data-ampel="due"].text-shu').count()) === 1, `${x.name}: „überfällig seit“ in Zinnober (${text})`);
    else if (x.nextDue) check(/fällig \d\d\.\d\d\./.test(text), `${x.name}: nächste Fälligkeit (${text})`);
    check((await has('signatures')) === x.pendingSignatures > 0, `${x.name}: Unterschriften nur, wenn welche warten`);
    check((await row.locator('[data-ampel]').count()) <= 3, `${x.name}: höchstens drei Angaben`);
  }
  check((await p.getByRole('navigation', { name: 'Orte' }).getByRole('link').allInnerTexts()).map((t) => t.trim()).join(',') === 'Kalender,Einstellungen', 'unten in der Leiste: Kalender, Einstellungen');
  for (const old of ['Heute', 'Prüfen', 'Offen', 'Berichte']) check((await p.getByRole('complementary').getByRole('link', { name: old, exact: true }).count()) === 0, `kein Ort „${old}“`);

  step('Unterschrift offen: zwei bereitgelegte Prüfungen erscheinen als Ampel und Filter');
  const target = props.find((x) => x.id !== first && x.assets > 0) ?? props[1];
  const detail = (await api(`/properties/${target.id}`)).json;
  for (const a of detail.assets.slice(0, 2)) {
    const { id } = (await api(`/assets/${a.id}/inspections`, { data: {} })).json;
    const d = (await api(`/inspections/${id}`)).json;
    const answers = Object.fromEntries(d.checkpoints.map((c) => [c.id, 'ok']));
    const r = await api(`/inspections/${id}`, { method: 'PUT', data: { kinds: d.kinds?.length ? d.kinds : ['periodic'], answers, defects: [], notes: 'E2E 35', ready: true } });
    check(r.json?.ready === true, `Prüfung bereit (${JSON.stringify(r.json).slice(0, 120)})`);
  }
  const props2 = (await api('/properties')).json;
  check(props2.find((x) => x.id === target.id).pendingSignatures === 2, 'pendingSignatures zählt die eigenen bereiten Prüfungen');
  await p.reload();
  const sigRow = side.locator(`[data-property="${target.id}"]`);
  await sigRow.locator('[data-ampel="signatures"]').waitFor();
  check((await sigRow.locator('[data-ampel="signatures"]').innerText()).includes('2 zu unterschreiben'), '„2 zu unterschreiben“');

  step('Filter in der Leiste: Alle · Fällig · Mit Mängeln · Unterschrift offen');
  const filters = p.getByRole('complementary').getByRole('group', { name: 'Filter' });
  const now = Date.now();
  const expected = {
    Fällig: props2.filter((x) => (x.overdue ?? 0) > 0 || (x.nextDue && x.nextDue <= now + 30 * DAY)).length,
    'Mit Mängeln': props2.filter((x) => x.openDefects > 0).length,
    'Unterschrift offen': props2.filter((x) => x.pendingSignatures > 0).length,
  };
  for (const [label, n] of Object.entries(expected)) {
    await filters.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await p.waitForTimeout(150);
    const shown = await side.locator('[data-property]').count();
    check(shown === n, `Filter „${label}“: ${shown} von erwartet ${n}`);
    check((await filters.getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-pressed')) === 'true', `„${label}“ gedrückt`);
  }
  await filters.getByRole('button', { name: /^Alle/ }).click();
  check((await side.locator('[data-property]').count()) === props2.length, 'Alle: wieder alle');
  // Suche in der Leiste
  await p.getByRole('searchbox', { name: 'Objekte durchsuchen' }).fill(target.name.slice(0, 8));
  await p.waitForTimeout(150);
  check((await side.locator('[data-property]').count()) >= 1 && (await side.locator(`[data-property="${target.id}"]`).count()) === 1, 'Suche findet das Objekt');
  await p.getByRole('searchbox', { name: 'Objekte durchsuchen' }).fill('');

  step('Zuletzt geöffnetes Objekt merkt sich der Browser');
  await side.locator(`[data-property="${target.id}"]`).click();
  await p.waitForURL((u) => u.pathname === `/objekte/${target.id}`);
  await p.goto(BASE + '/objekte');
  await p.waitForURL((u) => u.pathname === `/objekte/${target.id}`);
  check(true, 'zuletzt geöffnet');
  await p.mouse.move(1, 1);
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'd-objekte.png' });

  step('Alte Adressen leiten um – samt Query');
  const defects = (await api('/defects?status=open')).json;
  const tasks = (await api('/tasks')).json.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const d0 = defects[0];
  const t0 = tasks[0];
  const withDefects = props2.filter((x) => x.openDefects > 0);
  const cases = [
    ['/', `/objekte/${target.id}`, {}],
    ['/pruefen', `/objekte/${target.id}`, { tab: 'begehung' }],
    ['/pruefen?ansage=weiter', `/objekte/${target.id}`, { tab: 'begehung', ansage: 'weiter' }],
    ['/pruefen?tab=done&pruefart=main', '/pruefungen', { tab: 'done', pruefart: 'main' }, 'Prüfungen'],
    ['/pruefungen?tab=overdue', '/pruefungen', { tab: 'overdue' }, 'Prüfungen'],
    ['/pruefen/begehungen', '/begehungen', {}, 'Begehungen'],
    ['/offen?art=maengel', '/maengel', { art: 'maengel' }, 'Mängel und Aufgaben'],
    [`/offen?aufgabe=${t0.id}`, '/maengel', { art: 'alle', aufgabe: t0.id }, 'Mängel und Aufgaben'],
    [`/offen?art=maengel&mangel=${d0.id}`, '/maengel', { art: 'maengel', mangel: d0.id }, 'Mängel und Aufgaben'],
    [`/maengel?id=${d0.id}&tab=open`, '/maengel', { art: 'maengel', mangel: d0.id, tab: 'open' }, 'Mängel und Aufgaben'],
    ['/maengel?tab=resolved', '/maengel', { art: 'maengel', tab: 'resolved' }, 'Mängel und Aufgaben'],
    [`/aufgaben?id=${t0.id}`, '/maengel', { art: 'aufgaben', aufgabe: t0.id }, 'Mängel und Aufgaben'],
    ['/aufgaben?ansicht=stats', '/maengel', { art: 'aufgaben' }, 'Mängel und Aufgaben'],
    ['/berichte', '/einstellungen/berichte', {}, 'Berichte'],
    ['/berichte?jahr=2026', '/einstellungen/berichte', { jahr: '2026' }, 'Berichte'],
    ['/team', '/einstellungen/team', {}, 'Team'],
    ['/subunternehmer', '/einstellungen/subunternehmer', {}],
    ['/import', '/einstellungen/import', {}],
    ['/hilfe?q=Rundgang', '/einstellungen/hilfe', { q: 'Rundgang' }],
    ['/elemente?status=overdue', '/elemente', { status: 'overdue' }],
    ['/unterschreiben', '/unterschreiben', {}],
    ['/kalender', '/kalender', {}, 'Kalender'],
    ['/gibt-es-nicht', `/objekte/${target.id}`, {}],
  ];
  for (const [from, path, query, h1] of cases) {
    await p.goto(BASE + from);
    const ok = await p.waitForURL((u) => urlIs(p, path, query), { timeout: 8000 }).then(
      () => true,
      () => false,
    );
    check(ok, `${from} → ${new URL(p.url()).pathname}${new URL(p.url()).search} (erwartet ${path} ${JSON.stringify(query)})`);
    if (h1) check(await p.getByRole('heading', { level: 1, name: h1 }).first().waitFor({ timeout: 8000 }).then(() => true, () => false), `${from}: Seite „${h1}“`);
  }
  // /offen ohne Parameter: Objektliste mit Filter „Mit Mängeln“ (Desktop: erstes passendes Objekt rechts)
  await p.goto(BASE + '/offen');
  await p.waitForURL((u) => /^\/objekte\/[a-z0-9]+$/.test(u.pathname));
  const landed = new URL(p.url()).pathname.split('/').pop();
  check(withDefects.some((x) => x.id === landed), `/offen → Objekt mit Mängeln (${landed})`);
  check((await filters.getByRole('button', { name: /^Mit Mängeln/ }).getAttribute('aria-pressed')) === 'true', '/offen: Filter „Mit Mängeln“ aktiv');
  check((await side.locator('[data-property]').count()) === withDefects.length, '/offen: nur Objekte mit Mängeln');
  await filters.getByRole('button', { name: /^Alle/ }).click();
  // Details öffnen über die umgeleiteten Links
  await p.goto(BASE + `/maengel?id=${d0.id}`);
  await p.getByRole('dialog').getByText(d0.title).first().waitFor();
  await p.goto(BASE + `/aufgaben?id=${t0.id}`);
  await p.getByRole('dialog').getByTestId('watchers').waitFor();
  await p.keyboard.press('Escape');

  step('Einstellungen: Berichte im Rahmen, Konto-Menü mit den Seiten ohne Ort');
  await p.goto(BASE + '/einstellungen/berichte');
  const settingsNav = p.getByRole('navigation', { name: 'Einstellungen' });
  check((await settingsNav.getByRole('tab', { name: 'Berichte', exact: true }).getAttribute('aria-selected')) === 'true', 'Berichte in der Einstellungs-Spalte aktiv');
  check((await p.getByRole('navigation', { name: 'Orte' }).getByRole('link', { name: 'Einstellungen' }).getAttribute('aria-current')) === 'page', 'Einstellungen hervorgehoben');
  await p.getByRole('complementary').getByRole('button', { name: /Nordlicht|Krüger/ }).first().click();
  const menu = p.getByRole('menu', { name: 'Konto' });
  for (const n of ['Alle Elemente', 'Mängel und Aufgaben', 'Offline-Modus', 'Einstellungen', 'Abmelden']) check(await menu.getByRole('menuitem', { name: n }).isVisible(), `Konto-Menü: ${n}`);
  await menu.getByRole('menuitem', { name: 'Mängel und Aufgaben' }).click();
  await p.waitForURL((u) => urlIs(p, '/maengel', { art: 'alle' }));
  await p.getByRole('tab', { name: /^Alle/, selected: true }).waitFor();

  step('Kalender (Desktop): Monat, Bündelung, Überfällig, Sprung ins Objekt');
  // Testdaten: Aufgabe ohne Objekt, Nachweis und Zulassung, die in diesem Zeitraum enden
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(Date.now());
  const plusDays = (n) => new Date(Date.parse(`${today}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
  const loose = (await api('/tasks', { data: { title: 'E2E Feuerwehrplan abstimmen', priority: 'medium', dueAt: Date.parse(`${plusDays(3)}T10:00:00Z`) } })).json;
  check(!!loose?.id, `Aufgabe ohne Objekt angelegt (${JSON.stringify(loose).slice(0, 100)})`);
  const me = (await api('/account/me')).json;
  const cred = await api('/credentials', { data: { kind: 'expertise', title: 'E2E Sachkunde', validUntil: Date.parse(`${plusDays(4)}T21:59:59Z`) } });
  check(cred.status === 200, `Nachweis angelegt (${cred.status})`);
  const prod = await api('/catalog/products', { data: { manufacturer: 'E2E Hersteller', model: 'Z-Tür 90', category: 'fire_door', approvalValidUntil: plusDays(5) } });
  check(prod.status === 200, `Katalog-Typ mit Zulassung angelegt (${prod.status} ${JSON.stringify(prod.json).slice(0, 120)})`);

  const calCalls = await countCalls(p, '/kalender', () => p.getByRole('grid', { name: 'Monat' }).waitFor());
  const calApi = calCalls.filter((c) => c.startsWith('/api/calendar/events'));
  check(calApi.length === 1, `eine Kalender-Abfrage (${calApi.join(' ')})`);
  check(calCalls.length <= MAX_CALLS.kalenderDesktop, `Kalender Desktop: ${calCalls.length} API-Aufrufe (höchstens ${MAX_CALLS.kalenderDesktop}): ${calCalls.join(' ')}`);
  console.log(`  API-Aufrufe Kalender Desktop: ${calCalls.length} (${calCalls.map((c) => c.split('?')[0].replace('/api', '')).join(', ')})`);
  const qs = new URL(BASE + calApi[0]).searchParams;
  const cal = (await api(`/calendar/events?from=${qs.get('from')}&to=${qs.get('to')}`)).json;
  check(cal.today === today, `heute in der Zeitzone des Workspaces (${cal.today})`);
  const evs = cal.events;
  // Bündelung: je Objekt und Tag höchstens ein Eintrag „fällig“, Überfälliges je Objekt einer
  const dueKeys = evs.filter((e) => e.kind === 'due').map((e) => `${e.propertyId}|${e.overdue ? 'ü' : e.date}`);
  check(new Set(dueKeys).size === dueKeys.length, `fällige Prüfungen je Objekt und Tag gebündelt (${dueKeys.length})`);
  const badDue = evs.filter((e) => e.kind === 'due').filter((e) => !(e.count >= 1 && /: \d+ (Tür|Türen|Prüfung|Prüfungen) (fällig|überfällig)$/.test(e.title) && e.link === `/objekte/${e.propertyId}?tab=begehung`));
  check(!badDue.length, `Titel „Objekt: n Türen fällig“, Link auf Begehung (${JSON.stringify(badDue[0])})`);
  const dash = (await api('/dashboard')).json;
  const overdueSum = evs.filter((e) => e.kind === 'due' && e.overdue).reduce((s, e) => s + e.count, 0);
  check(overdueSum === dash.counts.overdue, `Überfällig zusammen ${overdueSum} = überfällige Elemente ${dash.counts.overdue}`);
  check(evs.every((e, i) => i === 0 || evs[i - 1].date <= e.date), 'Einträge nach Tag sortiert');
  const kinds = new Set(evs.map((e) => e.kind));
  for (const k of ['due', 'task', 'approval', 'credential']) check(kinds.has(k), `Art „${k}“ im Kalender`);
  const looseEv = evs.find((e) => e.kind === 'task' && e.link.includes(loose.id));
  check(!!looseEv && !looseEv.propertyId && looseEv.link === `/maengel?art=aufgaben&aufgabe=${loose.id}`, `Aufgabe ohne Objekt: nur im Kalender, Link auf die Liste (${looseEv?.link})`);
  check(evs.some((e) => e.kind === 'credential' && e.title.includes('E2E Sachkunde') && e.title.includes(me.user.name) && e.date === plusDays(4)), 'Nachweis endet am richtigen Tag');
  check(evs.some((e) => e.kind === 'approval' && e.title.includes('Z-Tür 90') && e.date === plusDays(5)), 'Zulassung endet am richtigen Tag');
  const withProp = evs.filter((e) => e.propertyId && (e.kind === 'task' || e.kind === 'defect'));
  check(withProp.every((e) => e.link.startsWith(`/objekte/${e.propertyId}?tab=maengel&`)), 'Fristen mit Objekt öffnen den Reiter Mängel');
  // Überfällig-Block oben
  const overdueEvs = evs.filter((e) => e.overdue);
  check(overdueEvs.length > 0, `Demodaten haben Überfälliges (${overdueEvs.length})`);
  const block = p.getByRole('list', { name: 'Überfällig' });
  check((await block.locator('[data-event]').count()) === overdueEvs.length, `Überfällig-Block mit ${overdueEvs.length} Einträgen`);
  const sections = await p.locator('main section').evaluateAll((els) => els.map((e) => e.querySelector('h2')?.textContent?.trim() ?? ''));
  check(/^Überfällig/.test(sections[0] ?? ''), `Überfällig steht oben (${sections.join(' | ')})`);
  // Monat: heute markiert, Einträge am richtigen Tag, höchstens drei je Tag
  const grid = p.getByRole('grid', { name: 'Monat' });
  check((await grid.locator(`[data-day="${today}"]`).getAttribute('aria-current')) === 'date', 'heute markiert');
  const cell = grid.locator(`[data-day="${plusDays(3)}"]`);
  const cellText = await cell.innerText();
  const sameDay = evs.filter((e) => e.date === plusDays(3));
  check(sameDay.length > 3 ? /\+\d+ weitere/.test(cellText) : cellText.includes('E2E Feuerwehrplan'), `Eintrag am Tag (${plusDays(3)}: ${cellText.replace(/\n/g, ' ')})`);
  for (const d of new Set(evs.filter((e) => e.date >= qs.get('from') && e.date <= qs.get('to')).map((e) => e.date))) {
    check((await grid.locator(`[data-day="${d}"] [data-event]`).count()) <= 3, `höchstens drei Einträge am ${d}`);
  }
  await p.mouse.move(1, 1);
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + 'd-kalender-monat.png', fullPage: true });
  // Sprung ins Objekt: erster überfälliger Eintrag mit Objekt
  const jump = overdueEvs.find((e) => e.propertyId);
  await block.locator(`a[href="${jump.link}"]`).first().click();
  await p.waitForURL((u) => u.pathname === `/objekte/${jump.propertyId}` && u.searchParams.get('tab') === jump.link.split('tab=')[1].split('&')[0]);
  check(true, 'Sprung ins Objekt im passenden Reiter');
  // Liste am Desktop umschaltbar, Monat blättern lädt den nächsten Zeitraum
  await p.goto(BASE + '/kalender');
  await p.getByRole('tab', { name: 'Liste' }).click();
  await p.waitForURL((u) => u.searchParams.get('ansicht') === 'liste');
  await p.locator(`[data-event="task"][href*="${loose.id}"]`).waitFor();
  await p.mouse.move(1, 1);
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + 'd-kalender-liste.png', fullPage: true });
  await p.locator(`[data-event="task"][href*="${loose.id}"]`).click();
  await p.waitForURL((u) => urlIs(p, '/maengel', { art: 'aufgaben', aufgabe: loose.id }));
  await p.getByRole('dialog').getByText('E2E Feuerwehrplan abstimmen').first().waitFor();
  await p.keyboard.press('Escape');
  await p.goto(BASE + '/kalender');
  await p.getByRole('grid', { name: 'Monat' }).waitFor();
  const [nextReq] = await Promise.all([
    p.waitForRequest((r) => r.url().includes('/api/calendar/events') && new URL(r.url()).searchParams.get('from') > qs.get('from')),
    p.getByRole('button', { name: 'Nächster Monat' }).click(),
  ]);
  const nextMonth = new URL(nextReq.url()).searchParams.get('from');
  await p.waitForURL((u) => /^\d{4}-\d{2}$/.test(u.searchParams.get('monat') ?? ''));
  check(nextMonth > qs.get('from'), `nächster Monat lädt neu (${nextMonth})`);
  // Abfrage-Grenzen
  check((await api('/calendar/events?from=2026-01-01&to=2028-01-01')).status === 400, 'Zeitraum über 400 Tage abgelehnt');
  check((await api('/calendar/events?from=2026-02-30&to=2026-03-01')).status === 400, 'ungültiges Datum abgelehnt');
  check((await api('/calendar/events?from=2026-03-10&to=2026-03-01')).status === 400, 'to vor from abgelehnt');

  step('Handy 390 px: Objektliste als Startseite, Objekte · Erfassen · Kalender');
  const m = await b.newContext({ ...MOBILE, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  watch(mp);
  const listCalls = await countCalls(mp, '/', () => mp.getByRole('list', { name: 'Objekte' }).locator('[data-property]').first().waitFor());
  check(urlIs(mp, '/objekte'), `/ → /objekte am Handy (${mp.url()})`);
  check(listCalls.length <= MAX_CALLS.objekteHandy, `Objektliste Handy: ${listCalls.length} API-Aufrufe (höchstens ${MAX_CALLS.objekteHandy}): ${listCalls.join(' ')}`);
  console.log(`  API-Aufrufe Objektliste Handy: ${listCalls.length} (${listCalls.map((c) => c.split('?')[0].replace('/api', '')).join(', ')})`);
  check(listCalls.filter((c) => c.startsWith('/api/properties')).length === 1, 'eine Abfrage für alle Objekte samt Ampel');
  await mp.getByRole('heading', { name: 'Objekte', level: 1 }).waitFor();
  const mrows = mp.getByRole('list', { name: 'Objekte' }).locator('[data-property]');
  check((await mrows.count()) === props2.length, 'alle Objekte als Zeilen');
  const mtiers = await mrows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-tier'))));
  check(mtiers.every((x, i) => i === 0 || mtiers[i - 1] <= x), 'Handy: dringendstes zuerst');
  const bar = mp.getByRole('navigation', { name: 'Hauptnavigation' });
  const barLinks = (await bar.getByRole('link').allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(barLinks) === JSON.stringify(['Objekte', 'Kalender']), `Handy-Leiste (${barLinks.join(', ')})`);
  const barBox = await bar.boundingBox();
  const micBox = await bar.getByRole('button', { name: 'Erfassen' }).boundingBox();
  check(Math.abs(micBox.x + micBox.width / 2 - (barBox.x + barBox.width / 2)) < 2, 'Erfassen in der Mitte');
  check((await bar.getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'Objekte aktiv');
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + 'm-objekte.png', fullPage: true });
  // Filter am Handy (gleiche Regel), Tipp öffnet das Objekt
  await mp.getByRole('group', { name: 'Filter' }).getByRole('button', { name: /^Mit Mängeln/ }).click();
  check((await mrows.count()) === expected['Mit Mängeln'], 'Handy: Filter Mit Mängeln');
  await mp.getByRole('group', { name: 'Filter' }).getByRole('button', { name: /^Alle/ }).click();
  await mrows.first().click();
  await mp.waitForURL((u) => /^\/objekte\/[a-z0-9]+$/.test(u.pathname));
  check((await bar.getByRole('link', { name: 'Objekte' }).getAttribute('aria-current')) === 'page', 'im Objekt: Objekte aktiv');
  // Konto-Menü: Einstellungen und Seiten ohne Ort
  await mp.getByRole('button', { name: 'Konto und Einstellungen' }).click();
  const mmenu = mp.getByRole('menu', { name: 'Konto' });
  for (const n of ['Einstellungen', 'Mängel und Aufgaben', 'Alle Elemente', 'Code scannen', 'Offline-Modus']) check(await mmenu.getByRole('menuitem', { name: n }).isVisible(), `Handy-Konto-Menü: ${n}`);
  await mp.waitForTimeout(300);
  await mp.screenshot({ path: OUT + 'm-konto.png' });
  await mmenu.getByRole('menuitem', { name: 'Einstellungen' }).click();
  await mp.waitForURL((u) => u.pathname === '/einstellungen');

  step('Kalender am Handy: Liste, Überfällig oben');
  const mCalCalls = await countCalls(mp, '/kalender', () => mp.getByRole('list', { name: 'Überfällig' }).waitFor());
  check(mCalCalls.length <= MAX_CALLS.kalenderHandy, `Kalender Handy: ${mCalCalls.length} API-Aufrufe (höchstens ${MAX_CALLS.kalenderHandy}): ${mCalCalls.join(' ')}`);
  console.log(`  API-Aufrufe Kalender Handy: ${mCalCalls.length} (${mCalCalls.map((c) => c.split('?')[0].replace('/api', '')).join(', ')})`);
  check((await bar.getByRole('link', { name: 'Kalender' }).getAttribute('aria-current')) === 'page', 'Kalender aktiv');
  check((await mp.getByRole('grid', { name: 'Monat' }).count()) === 0 && (await mp.getByRole('tab', { name: 'Monat' }).count()) === 0, 'Handy: nur Liste, kein Umschalter');
  check((await mp.locator(`[data-event="task"][href*="${loose.id}"]`).count()) === 1, 'Aufgabe ohne Objekt in der Liste');
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: OUT + 'm-kalender-liste.png', fullPage: true });

  // Kein Überlauf
  for (const path of ['/objekte', '/objekte?filter=faellig', '/kalender', `/kalender?monat=${plusDays(40).slice(0, 7)}`, '/maengel?art=alle', '/maengel?art=aufgaben', '/pruefungen?tab=overdue', '/pruefungen?tab=done', '/begehungen', '/elemente', '/unterschreiben', '/einstellungen', '/einstellungen/berichte', '/einstellungen/hilfe']) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    await mp.locator('main h1').first().waitFor();
    const over = await overflow(mp);
    check(over <= 0, `kein Überlauf ${path} (${over}px)`);
  }
  await m.close();

  step('Leerer Workspace: Ein-Feld-Einstieg statt Liste, Kalender ohne Einträge');
  const e = await b.newContext(DESKTOP);
  const ep = await e.newPage();
  watch(ep);
  const reg = await ep.request.fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'x-pk': '1' },
    data: { company: 'Leer GmbH', name: 'Lea Leer', email: `leer${Date.now()}@example.com`, password: 'sicheres-passwort-1' },
  });
  check(reg.status() === 200, `Registrierung (${reg.status()})`);
  await ep.goto(BASE + '/');
  await ep.getByRole('heading', { name: 'Wie heißt dein erstes Objekt?' }).waitFor();
  check(urlIs(ep, '/objekte'), `leer: bleibt auf /objekte (${ep.url()})`);
  check((await ep.getByRole('main').getByRole('textbox').count()) === 1, 'genau ein Feld');
  check(await ep.getByRole('complementary').getByText('Noch keine Objekte.').isVisible(), 'Leiste: noch keine Objekte');
  await ep.goto(BASE + '/pruefen');
  await ep.waitForURL((u) => u.pathname === '/objekte');
  await ep.getByRole('heading', { name: 'Wie heißt dein erstes Objekt?' }).waitFor();
  check(true, '/pruefen ohne Objekte → Einstieg');
  await ep.goto(BASE + '/kalender?ansicht=liste');
  await ep.getByText('Bis Monatsende steht nichts an.').waitFor();
  await ep.goto(BASE + '/kalender');
  await ep.getByRole('grid', { name: 'Monat' }).waitFor();
  await ep.waitForLoadState('networkidle');
  check((await ep.locator('[data-event]').count()) === 0, 'leer: keine Einträge im Monat');
  check((await ep.getByRole('list', { name: 'Überfällig' }).count()) === 0, 'leer: kein Überfällig-Block');
  await ep.goto(BASE + '/objekte');
  await ep.getByLabel('Name des Objekts').fill('Erstes Haus');
  await ep.getByRole('button', { name: 'Anlegen' }).click();
  await ep.waitForURL((u) => /^\/objekte\/[a-z0-9]+$/.test(u.pathname));
  await ep.getByRole('dialog').first().waitFor();
  check((await ep.getByRole('complementary').locator('[data-property]').count()) === 1, 'neues Objekt in der Leiste');
  await e.close();

  check(!errors.length, `Browserfehler: ${errors.slice(0, 3).join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((err) => {
  console.log('FAIL', err.stack);
  process.exit(1);
});
