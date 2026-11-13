// E2E 26-katalog (v5 Paket P): Feststellanlage anlegen und prüfen, laufende Nummern je Objekt (auch gleichzeitig),
// „Tür 36“ in Suche und API, Typ aus dem Katalog füllt das Elementformular, Mangel-Vorschlag aus dem Katalog im
// Prüfablauf, Seite Einstellungen → Katalog (1360/390 px ohne Überlauf), MCP-Werkzeug catalog.
// Bilder für docs/design/v3/v5 entstehen in e2e/.out/26-katalog. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '26-katalog') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

(async () => {
  if (process.env.PROD) throw new Error('26-katalog nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[1349]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
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
  const login = async (pg, email) => {
    await pg.goto(BASE + '/login');
    await pg.getByLabel('E-Mail').fill(email);
    await pg.getByLabel('Passwort').fill(PW);
    await pg.getByRole('button', { name: 'Anmelden' }).click();
    await pg.waitForURL((u) => u.pathname !== '/login');
  };
  const noOverflow = async (pg, what) => {
    const w = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check(w[0] <= w[1], `${what}: kein horizontaler Überlauf (${w[0]} > ${w[1]})`);
  };
  await login(p, 'demo@example.com');

  step('Katalog: Grundausstattung beim ersten Lesen, idempotent');
  const c1 = (await api('/catalog')).json;
  const c2 = (await api('/catalog')).json;
  check(c1.terms.some((t) => t.term === 'OTS' && t.meaning === 'Obentürschließer') && c1.terms.some((t) => t.term === 'FSA'), 'Begriffe OTS und FSA');
  check(c1.defects.length >= 24 && c1.defects.some((d) => d.category === 'hold_open' && d.severity === 'critical'), `typische Mängel mit Schwere (${c1.defects.length})`);
  check(c2.defects.length === c1.defects.length && c2.terms.length === c1.terms.length, 'zweites Lesen legt nichts doppelt an');

  step('Elementart Feststellanlage');
  const cats = (await api('/categories')).json;
  const fsaDef = cats.find((c) => c.key === 'hold_open');
  check(fsaDef?.prefix === 'FSA' && fsaDef.checkpoints.length === 20 && fsaDef.intervalMonths === 12, `FSA mit 20 Prüfpunkten, jährlich (${fsaDef?.checkpoints.length})`);
  check(fsaDef?.schedulesEffective.some((s) => s.key === 'visual' && s.optional && s.intervalMonths === 1), 'monatliche Sichtkontrolle optional');
  const door = cats.find((c) => c.key === 'fire_door');
  check(['doorType', 'dropSeal', 'closer', 'peephole', 'smoke'].every((k) => door.attributes.some((a) => a.key === k)), 'Tür: Türtyp, Absenkdichtung, OTS, Spion, Rauchschutz');

  step('Laufende Nummern je Objekt');
  const P1 = (await api('/properties', { data: { name: 'E2E Wartung Seehafer' } })).json;
  const B1 = (await api(`/properties/${P1.id}/buildings`, { data: { name: 'Hauptgebäude' } })).json;
  const P2 = (await api('/properties', { data: { name: 'E2E Zweitobjekt' } })).json;
  const B2 = (await api(`/properties/${P2.id}/buildings`, { data: { name: 'Haus B' } })).json;
  const mk = (bid, category, extra = {}) => api('/assets', { data: { buildingId: bid, category, floor: 'EG', location: 'Flur', ...extra } });
  const a1 = (await mk(B1.id, 'fire_door')).json;
  const a2 = (await mk(B1.id, 'hold_open', { location: 'Flur, Tür 1' })).json;
  const a3 = (await mk(B1.id, 'fire_door')).json;
  check(a1.code === 'FST-001' && a2.code === 'FSA-002' && a3.code === 'FST-003', `fortlaufend über alle Arten (${a1.code}, ${a2.code}, ${a3.code})`);
  const o1 = (await mk(B2.id, 'fire_door')).json;
  check(o1.number === 1 && o1.code === 'FST-001-2', `zweites Objekt beginnt bei 1, Code bleibt eindeutig (${o1.code})`);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => mk(B1.id, i % 2 ? 'hold_open' : 'fire_door')));
  const nums = burst.map((r) => r.json?.number).sort((x, y) => x - y);
  check(burst.every((r) => r.status === 200) && JSON.stringify(nums) === '[4,5,6,7,8,9]', `gleichzeitig angelegt: Nummern 4–9 ohne Doppelte (${nums})`);
  check(new Set(burst.map((r) => r.json.code)).size === 6, 'gleichzeitig angelegt: Codes eindeutig');
  const t36 = (await mk(B1.id, 'fire_door', { number: 36, location: 'Raum 306' })).json;
  check(t36.code === 'FST-036', `Ident-Nr. 36 aus dem Papierprotokoll → FST-036 (${t36.code})`);
  check((await mk(B1.id, 'hold_open', { number: 36 })).status === 409, 'Nummer 36 im Objekt schon vergeben → 409');
  check((await mk(B1.id, 'hold_open')).json.number === 37, 'danach geht es mit 37 weiter');
  const old = (await mk(B1.id, 'fire_door', { code: 'ALT-1' })).json;
  check(old.code === 'ALT-1' && old.number === null, 'eigener Code bleibt, ohne Nummer');

  step('„Tür 36“, „Nummer 2“ in Suche und API');
  let s = (await api(`/search?q=${encodeURIComponent('Tür 36')}&propertyId=${P1.id}`)).json;
  check(s.assets[0]?.code === 'FST-036', `Suche „Tür 36“ im Objekt (${s.assets.map((x) => x.code)})`);
  s = (await api(`/search?q=${encodeURIComponent('Nummer 2')}&propertyId=${P1.id}`)).json;
  check(s.assets[0]?.code === 'FSA-002', `Suche „Nummer 2“ (${s.assets.map((x) => x.code)})`);
  s = (await api(`/search?q=${encodeURIComponent('Tür 1')}`)).json;
  check(['FST-001', 'FST-001-2'].every((c) => s.assets.some((x) => x.code === c)), 'ohne Objekt: Treffer aus allen Objekten');
  check((await api(`/assets/by-code/${encodeURIComponent('Tür 36')}?propertyId=${P1.id}`)).json?.id === t36.id, 'by-code versteht „Tür 36“ im Objekt');
  check((await api(`/assets/by-code/${encodeURIComponent('36')}?propertyId=${P1.id}`)).json?.id === t36.id, 'by-code versteht „36“ im Objekt');
  check((await api(`/assets/by-code/${encodeURIComponent('Tür 36')}`)).status === 404, 'ohne Objekt keine Nummernauflösung');
  const list = (await api(`/assets?propertyId=${P1.id}&q=${encodeURIComponent('FSA 2')}`)).json;
  check(list.some((x) => x.id === a2.id), 'Elementliste: „FSA 2“');
  // Nummer nachträglich setzen (Code bleibt)
  const a3full = (await api(`/assets/${a3.id}`)).json;
  const patched = await api(`/assets/${a3.id}`, { method: 'PATCH', data: { buildingId: a3full.buildingId, location: a3full.location, floor: a3full.floor, manufacturer: '', model: '', attributes: {}, number: 17 } });
  check(patched.json?.number === 17 && (await api(`/assets/${a3.id}`)).json.code === 'FST-003', 'Nummer geändert, Code unverändert');
  check((await api(`/assets/by-code/${encodeURIComponent('Tür 17')}?propertyId=${P1.id}`)).json?.id === a3.id, '„Tür 17“ findet das Element danach');

  step('Feststellanlage prüfen');
  const draft = (await api(`/assets/${a2.id}/inspections`, { data: {} })).json;
  const d = (await api(`/inspections/${draft.id}`)).json;
  check(d.checkpoints.length === 20, `Prüfliste der Feststellanlage (${d.checkpoints.length})`);
  const sub = await api(`/inspections/${draft.id}/submit`, {
    data: { kinds: d.kinds, answers: Object.fromEntries(d.checkpoints.map((c) => [c.id, 'ok'])), defects: [], maintenance: ['detectorCleaned', 'vendor'], signature: SIG, signerName: 'E2E' },
  });
  check(sub.status === 200, `Prüfung abgeschlossen (${sub.status} ${sub.text.slice(0, 120)})`);
  const after = (await api(`/assets/${a2.id}`)).json;
  const months = Math.round((after.nextDueAt - after.lastInspectedAt) / (30.44 * 86400000));
  check(after.lastResult === 'ok' && months === 12, `nächste Prüfung in 12 Monaten (${after.lastResult}, ${months})`);

  step('Elementformular: Typ aus dem Katalog füllt die Vorgaben');
  const prod = await api('/catalog/products', {
    data: { manufacturer: 'Hörmann', model: 'H3 OD', category: 'fire_door', defaults: { rating: 'T30', smoke: true, closer: true, doorType: 'T30-1 RS' }, approval: 'Z-6.20-1234' },
  });
  check(prod.status === 200, `Produkt angelegt (${prod.status})`);
  const openForm = async (pg, art) => {
    await pg.goto(`${BASE}/elemente?neu=1`);
    await pg.getByRole('dialog').getByRole('button', { name: new RegExp(art) }).click();
    await pg.getByLabel('Objekt', { exact: true }).selectOption(P1.id);
    await pg.getByLabel('Gebäude').locator(`option[value="${B1.id}"]`).waitFor({ state: 'attached' });
    await pg.getByLabel('Gebäude').selectOption(B1.id);
  };
  await openForm(p, 'Feuerschutztür');
  const dlg = p.getByRole('dialog');
  for (const l of ['Türtyp / Bauart', 'Absenkdichtung', 'Obentürschließer', 'Türspion', 'Rauchschutz (RS)']) check((await dlg.getByLabel(l, { exact: true }).count()) === 1, `Feld „${l}“`);
  await dlg.getByLabel('Hersteller').fill('Hör');
  const hint = dlg.getByRole('group', { name: 'Typen aus dem Katalog' }).getByRole('button', { name: 'Hörmann H3 OD' });
  await hint.waitFor();
  await hint.click();
  check((await dlg.getByLabel('Typ / Modell').inputValue()) === 'H3 OD', 'Typ übernommen');
  check((await dlg.getByLabel('Feuerwiderstand').inputValue()) === 'T30', 'Feuerwiderstand T30');
  check((await dlg.getByLabel('Rauchschutz (RS)').isChecked()) && (await dlg.getByLabel('Obentürschließer').isChecked()), 'RS und OTS angehakt');
  check((await dlg.getByLabel('Türtyp / Bauart').inputValue()) === 'T30-1 RS', 'Türtyp übernommen');
  check((await dlg.getByLabel('Zulassungsnummer').inputValue()) === 'Z-6.20-1234', 'Zulassung übernommen');
  await dlg.getByLabel('Standort').fill('Treppenhaus Nord');
  await dlg.getByRole('spinbutton', { name: /^Nummer/ }).fill('40');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-element-tuer.png' });
  await dlg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('FST-040 angelegt').waitFor();
  const t40 = (await api(`/assets?propertyId=${P1.id}`)).json.find((x) => x.code === 'FST-040');
  check(t40?.number === 40 && t40.manufacturer === 'Hörmann' && t40.attributes.rating === 'T30' && t40.attributes.closer === true, 'Tür mit Vorgaben gespeichert');

  await openForm(p, 'Feststellanlage');
  for (const l of ['Feststellvorrichtung', 'Auslösevorrichtung', 'Anzahl Melder', 'Zugehöriger Abschluss']) check((await dlg.getByLabel(l, { exact: true }).count()) === 1, `FSA-Feld „${l}“`);
  await dlg.getByLabel('Feststellvorrichtung').selectOption('Haftmagnet');
  await dlg.getByLabel('Zugehöriger Abschluss').fill('FST-040');
  await dlg.getByLabel('Standort').fill('Treppenhaus Nord');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-element-fsa.png' });
  await dlg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText(/FSA-041 angelegt/).waitFor();

  step('Mangel-Vorschlag aus dem Katalog im Prüfablauf');
  const fsa41 = (await api(`/assets?propertyId=${P1.id}`)).json.find((x) => x.code === 'FSA-041');
  const run = (await api(`/assets/${fsa41.id}/inspections`, { data: {} })).json;
  await p.goto(`${BASE}/pruefung/${run.id}`);
  const cp = p.locator('[data-cp="p10"]');
  await cp.getByRole('radio', { name: 'Mangel' }).click();
  await cp.getByLabel('Beschreibung').fill('Melder ist stark verschmutzt');
  const sug = cp.getByRole('button', { name: /^Wie „Melder verschmutzt“/ });
  await sug.waitFor();
  await sug.click();
  check((await cp.getByLabel('Maßnahme').inputValue()) === 'Melder reinigen oder tauschen', 'Maßnahme aus dem Katalog übernommen');
  check((await cp.getByRole('radio', { name: 'Mittel' }).getAttribute('aria-checked')) === 'true', 'Schwere aus dem Katalog übernommen');
  await api(`/inspections/${run.id}`, { method: 'DELETE' });

  step('Einstellungen → Katalog');
  await p.goto(`${BASE}/einstellungen?tab=catalog`);
  await p.getByRole('heading', { name: 'Katalog', level: 1 }).waitFor();
  const lists = p.getByRole('list', { name: 'Mängel' });
  await lists.getByRole('listitem').first().waitFor();
  const allRows = await lists.getByRole('listitem').count();
  await p.getByRole('searchbox', { name: 'Mängel durchsuchen' }).fill('Melder');
  const fewer = await lists.getByRole('listitem').count();
  check(fewer > 0 && fewer < allRows, `Suche grenzt ein (${allRows} → ${fewer})`);
  await p.getByRole('searchbox', { name: 'Mängel durchsuchen' }).fill('');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-katalog.png' });
  await noOverflow(p, 'Katalog 1360');
  await p.getByRole('tab', { name: /^Begriffe/ }).click();
  await p.getByRole('list', { name: 'Begriffe' }).getByText('Obentürschließer').waitFor();
  await p.getByRole('button', { name: 'Neuer Begriff' }).click();
  await p.getByRole('dialog').getByLabel('Begriff / Abkürzung').fill('PT');
  await p.getByRole('dialog').getByLabel('Bedeutung').fill('Panikbeschlag Tür');
  await p.getByRole('dialog').getByRole('button', { name: 'Anlegen' }).click();
  const row = p.getByRole('list', { name: 'Begriffe' }).getByRole('button', { name: 'PT', exact: true });
  await row.waitFor();
  await row.click();
  await p.getByRole('dialog').getByLabel('Bedeutung').fill('Panikbeschlag');
  await p.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await p.getByRole('list', { name: 'Begriffe' }).getByText('Panikbeschlag', { exact: true }).waitFor();
  check((await api('/catalog/terms')).json.some((t) => t.term === 'PT' && t.meaning === 'Panikbeschlag'), 'Begriff angelegt und geändert');
  await row.click();
  await p.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await p.getByRole('dialog', { name: 'Eintrag löschen?' }).getByRole('button', { name: 'Löschen' }).click();
  await row.waitFor({ state: 'detached' });
  check(!(await api('/catalog/terms')).json.some((t) => t.term === 'PT'), 'Begriff gelöscht');
  await p.getByRole('tab', { name: /^Produkte/ }).click();
  await p.getByRole('list', { name: 'Produkte' }).getByText('Hörmann H3 OD').waitFor();

  step('Prüfer: Katalog nur lesen');
  const ictx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const ip = await ictx.newPage();
  await login(ip, 'pruefer@example.com');
  await ip.goto(`${BASE}/einstellungen?tab=catalog`);
  await ip.getByRole('list', { name: 'Mängel' }).getByRole('listitem').first().waitFor();
  check((await ip.getByRole('button', { name: 'Neuer Mangel' }).count()) === 0, 'Prüfer: kein Anlegen');
  check(await ip.getByText('Ändern können Admins.', { exact: false }).isVisible(), 'Prüfer: Hinweis auf Admins');
  await ictx.close();

  step('Handy 390 px: Katalog und Elementformular ohne Überlauf');
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const m = await mctx.newPage();
  watch(m);
  await login(m, 'demo@example.com');
  await m.goto(`${BASE}/einstellungen?tab=catalog`);
  await m.getByRole('list', { name: 'Mängel' }).getByRole('listitem').first().waitFor();
  await noOverflow(m, 'Katalog 390');
  await m.screenshot({ path: OUT + 'm-katalog.png' });
  await m.getByRole('tab', { name: /^Mängel/ }).click();
  await m.getByRole('button', { name: 'Neuer Mangel' }).click();
  await m.getByRole('dialog').getByLabel('Bezeichnung').waitFor();
  await noOverflow(m, 'Katalog-Dialog 390');
  await m.screenshot({ path: OUT + 'm-katalog-dialog.png' });
  await m.keyboard.press('Escape');
  await openForm(m, 'Feuerschutztür');
  await m.getByRole('dialog').getByLabel('Hersteller').fill('Hör');
  await m.getByRole('dialog').getByRole('group', { name: 'Typen aus dem Katalog' }).getByRole('button', { name: 'Hörmann H3 OD' }).click();
  await noOverflow(m, 'Elementformular Tür 390');
  await m.screenshot({ path: OUT + 'm-element-tuer.png' });
  await openForm(m, 'Feststellanlage');
  await m.getByRole('dialog').getByLabel('Feststellvorrichtung').scrollIntoViewIfNeeded();
  await noOverflow(m, 'Elementformular FSA 390');
  await m.screenshot({ path: OUT + 'm-element-fsa.png' });
  await mctx.close();

  step('MCP: catalog suchen, vorschlagen, im Stapel anlegen; capture mit „Tür 36“');
  const key = (await api('/account/api-keys', { data: { name: 'E2E Katalog', scope: 'write', expiresInDays: 1 } })).json;
  const tool = async (name, args) => {
    const r = await fetch(BASE + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }).then((x) => x.json());
    const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? {});
    let data = null;
    try {
      data = r.result?.isError ? null : JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { isError: !!r.result?.isError, text, data };
  };
  let t = await tool('catalog', { action: 'suggest', text: 'OTS schließt nicht' });
  check(/Obentürschließer/.test(t.data?.understood ?? '') && t.data?.defects?.[0]?.title === 'Tür schließt nicht vollständig', `suggest: Begriff und Mangel (${t.text.slice(0, 160)})`);
  t = await tool('catalog', { action: 'search', list: 'defects', category: 'Feststellanlage', query: 'Melder' });
  check(t.data?.defects?.length >= 3 && t.data.defects.every((x) => x.art === 'Feststellanlage'), `search: Mängel der FSA (${t.data?.defects?.length})`);
  const item = { title: 'Haftmagnet brummt', severity: 'low', measure: 'Netzteil prüfen', category: 'Feststellanlage', synonyms: ['Magnet summt'] };
  t = await tool('catalog', { action: 'upsert', list: 'defects', items: [item] });
  check(t.data?.create?.[0] === 'Haftmagnet brummt' && /Vorschau/.test(t.data?.preview ?? ''), `upsert: Vorschau (${t.text.slice(0, 120)})`);
  check(!(await api('/catalog/defects')).json.some((x) => x.title === 'Haftmagnet brummt'), 'Vorschau schreibt nichts');
  t = await tool('catalog', { action: 'upsert', list: 'defects', preview: false, items: [item] });
  check(t.data?.saved === true, 'upsert: gespeichert');
  const saved = (await api('/catalog/defects')).json.find((x) => x.title === 'Haftmagnet brummt');
  check(saved?.category === 'hold_open' && saved.synonyms[0] === 'Magnet summt', 'Art als Schlüssel, Synonyme gespeichert');
  t = await tool('catalog', { action: 'upsert', list: 'defects', preview: false, items: [{ ...item, severity: 'medium' }] });
  check(t.data?.update?.[0]?.includes('severity'), `upsert: vorhandener Eintrag geändert (${t.text.slice(0, 120)})`);
  t = await tool('capture', { property: 'E2E Wartung Seehafer', items: [{ kind: 'defect', title: 'Dichtung fehlt', asset: 'Tür 36' }] });
  check(!t.isError && /FST-036|Dichtung/.test(t.text), `capture an „Tür 36“ (${t.text.slice(0, 160)})`);
  const def = (await api('/defects')).json.find((x) => x.assetId === t36.id && x.title === 'Dichtung fehlt');
  check(def?.measure === 'Dichtung nach Herstellerangabe ersetzen', `Maßnahme aus dem Katalog (${def?.measure})`);
  t = await tool('update_asset', { asset: 'Tür 36', property: 'E2E Wartung Seehafer', fields: { peephole: true } });
  check(!t.isError && t.data?.asset === 'FST-036', `update_asset mit „Tür 36“ (${t.text.slice(0, 120)})`);
  t = await tool('update_asset', { asset: 'Tür 1', fields: { peephole: true } });
  check(t.isError && /mehreren Objekten/.test(t.text), 'Nummer ohne Objekt in mehreren Objekten → Rückfrage');
  await api(`/account/api-keys/${key.id}`, { method: 'DELETE' });

  check(!errors.length, `keine Konsolenfehler (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
