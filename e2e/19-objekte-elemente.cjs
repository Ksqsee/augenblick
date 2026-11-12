// E2E 19-objekte-elemente: Objekte & Elemente nach Designsystem v2 – Filter in der URL, Prüfstatus am Objekt,
// „Speichern & neu“ mit gemerktem Gebäude/Etage, Status-Erklärung und „Als Nächstes“ am Element,
// Bestätigungsdialoge statt window.confirm, 390 px ohne Überlauf. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '19-objekte-elemente') + '/';
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
  if (process.env.PROD) throw new Error('19-objekte-elemente nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => {
    errors.push(`window-Dialog: ${d.message()}`);
    d.dismiss();
  });
  const api = async (path) => (await p.request.fetch(BASE + '/api' + path, { headers: { 'x-pk': '1' } })).json();
  await p.goto(BASE + '/login');
  await p.getByLabel('E-Mail').fill('demo@example.com');
  await p.getByLabel('Passwort').fill(process.env.DEMO_PASSWORD);
  await p.getByRole('button', { name: 'Anmelden' }).click();
  await p.getByText('Prüfstatus').waitFor();

  step('Objekte: Liste mit Prüfstatus und Filter');
  const props = await api('/properties');
  const prop = props.find((x) => x.name === 'Grundschule Am Stadtpark');
  await p.goto(BASE + '/objekte');
  await p.getByRole('link', { name: 'Grundschule Am Stadtpark' }).waitFor();
  await p.getByRole('button', { name: /Mit Überfälligen/ }).click();
  const withOverdue = props.filter((x) => (x.overdue ?? 0) > 0).length;
  check((await p.locator('table tbody tr').count()) === withOverdue, `Filter „Mit Überfälligen“ (${withOverdue})`);
  await p.getByRole('searchbox').fill('gibt es nicht');
  await p.getByText('Keine Treffer').waitFor();
  await p.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  check((await p.locator('table tbody tr').count()) === props.length, 'Filter zurückgesetzt');

  step('Objekt: Prüfstatus und dringendstes Element');
  await p.goto(`${BASE}/objekte/${prop.id}`);
  await p.getByRole('heading', { name: 'Prüfstatus' }).waitFor();
  check(await p.getByRole('img', { name: /Prüfstatus: \d+ Überfällig/ }).isVisible(), 'Verteilungsbalken mit Beschriftung');
  await p.getByText('Am dringendsten').click();
  await p.waitForURL(/\/elemente\//);
  await p.getByText(/seit \d+ (Tag|Tagen|Monat|Monaten|Jahr|Jahren)/).first().waitFor();
  check(await p.getByRole('button', { name: /^(Prüfung starten|Entwurf fortsetzen)$/ }).isVisible(), 'eine Hauptaktion am Element');

  step('Element: Als Nächstes im selben Gebäude');
  const here = await api(`/assets/${new URL(p.url()).pathname.split('/').pop()}`);
  await p.getByRole('heading', { name: `Als Nächstes in ${here.buildingName}` }).waitFor();
  const next = p.getByRole('link', { name: /^Nächstes Element / }).first();
  const nextName = await next.getAttribute('aria-label');
  await next.click();
  await p.waitForURL((u) => !u.pathname.endsWith(here.id));
  const nextAsset = await api(`/assets/${new URL(p.url()).pathname.split('/').pop()}`);
  check(nextName === `Nächstes Element ${nextAsset.code}` && nextAsset.buildingId === here.buildingId, 'nächstes Element im selben Gebäude');

  step('Löschen fragt im eigenen Dialog');
  await p.getByRole('button', { name: 'Weitere Aktionen zum Element' }).click();
  await p.getByRole('menuitem', { name: 'Element löschen' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click();
  check((await api(`/assets/${nextAsset.id}`)).id === nextAsset.id, 'Abbrechen löscht nicht');

  step('Mehrere Elemente nacheinander: Speichern & neu');
  const building = (await api(`/properties/${prop.id}`)).buildings[1];
  await p.goto(`${BASE}/objekte/${prop.id}`);
  await p.getByRole('region', { name: building.name }).getByRole('button', { name: 'Element', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: /Feuerlöscher/ }).click();
  await p.getByLabel('Standort').fill('E2E Reihe 1');
  await p.getByLabel('Etage').fill('2. OG');
  await p.getByRole('button', { name: 'Speichern & neu' }).click();
  await p.getByText(/Schon angelegt: FL-/).waitFor();
  check((await p.getByLabel('Standort').inputValue()) === '', 'Standort geleert');
  check((await p.getByLabel('Etage').inputValue()) === '2. OG', 'Etage bleibt');
  check((await p.getByLabel('Gebäude').inputValue()) === building.id, 'Gebäude bleibt');
  await p.getByLabel('Standort').fill('E2E Reihe 2');
  await p.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByRole('dialog').waitFor({ state: 'detached' });
  const created = (await api('/assets')).filter((a) => /^E2E Reihe/.test(a.location));
  check(created.length === 2 && created.every((a) => a.buildingId === building.id && a.floor === '2. OG' && a.category === 'extinguisher'), `zwei Feuerlöscher angelegt (${created.length})`);
  // Gedächtnis: neues Element im selben Gebäude startet mit der zuletzt benutzten Etage
  await p.getByRole('region', { name: building.name }).getByRole('button', { name: 'Element', exact: true }).click();
  await p.getByRole('dialog').getByRole('button', { name: /Rauchwarnmelder/ }).click();
  check((await p.getByLabel('Etage').inputValue()) === '2. OG', 'Etage aus dem Gedächtnis vorbelegt');
  await p.keyboard.press('Escape');
  // … und auch auf „Elemente“ (Objekt/Gebäude vorausgewählt)
  await p.goto(`${BASE}/elemente?neu=1`);
  await p.getByRole('dialog').getByRole('button', { name: /Feuerschutztür/ }).click();
  await p.getByLabel('Gebäude').locator(`option[value="${building.id}"]`).waitFor({ state: 'attached' });
  check((await p.getByLabel('Objekt', { exact: true }).inputValue()) === prop.id && (await p.getByLabel('Gebäude').inputValue()) === building.id, 'Objekt und Gebäude gemerkt');
  await p.keyboard.press('Escape');

  step('Elemente: Filter in der URL');
  await p.goto(`${BASE}/elemente?kategorie=extinguisher&objekt=${prop.id}`);
  const list = await api(`/assets?category=extinguisher&propertyId=${prop.id}`);
  await p.getByText(`${list.length} Elemente`).waitFor();
  check((await p.getByLabel('Nach Art filtern').inputValue()) === 'extinguisher', 'Art aus der URL');
  await p.getByRole('button', { name: 'Überfällig', exact: true }).click();
  await p.waitForURL((u) => u.searchParams.get('status') === 'overdue' && u.searchParams.get('kategorie') === 'extinguisher');
  await p.getByRole('searchbox').fill('Reihe');
  await p.waitForURL((u) => u.searchParams.get('q') === 'Reihe');
  await p.getByText('Keine Treffer').waitFor();
  await p.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await p.waitForURL((u) => ![...u.searchParams.keys()].length);
  check((await p.getByRole('searchbox').inputValue()) === '', 'Suche geleert');

  step('Handy 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  const plan = (await api(`/properties/${prop.id}`)).floorPlans[0];
  for (const path of ['/objekte', `/objekte/${prop.id}`, `/objekte/${prop.id}?tab=grundrisse`, `/objekte/${prop.id}?tab=begehungen`, '/elemente', `/elemente/${here.id}`, `/grundrisse/${plan.id}`]) {
    await mp.goto(BASE + path);
    await mp.waitForLoadState('networkidle');
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `${path}: kein horizontaler Überlauf (${over})`);
  }
  await mp.goto(`${BASE}/objekte/${prop.id}`);
  const actions = await mp.getByRole('button', { name: 'Begehung starten' }).boundingBox();
  const share = await mp.getByRole('button', { name: 'Für Kunden freigeben' }).boundingBox();
  check(actions && share && Math.abs(actions.y - share.y) < 4, 'Aktionen am Objekt auf dem Handy in einer Zeile');
  await mp.screenshot({ path: OUT + 'm-objekt.png', fullPage: true });
  await m.close();

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
