// E2E 32-katalog-angebot (Plan v7, Paket V): Katalog-Datei laden mit Vorschau (neu/geändert/unverändert), Tür mit Typ
// aus einem Alias anlegen, Prüfpunkte je Anforderung (Bedingungen, „alles i. O.“ über MCP), Fenster und Drehtürantrieb
// anlegen und prüfen, Angebotsliste rechnen (Preis nach Bedingung, Mengen, Türen, nicht zugeordnete Mängel), Import der
// Wartungsübersicht (Ident-Nr., Türtyp über Alias, JA-Spalten, Termine, Laufreihenfolge), Leistung pflegen,
// Katalogseite 1360/390 px ohne Überlauf, MCP catalog mit Leistungen. Bilder in e2e/.out/32-katalog-angebot. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = path.join(__dirname, '.out', '32-katalog-angebot') + '/';
fs.mkdirSync(OUT, { recursive: true });
const FILE = path.join(__dirname, '..', 'docs', 'wissen', 'katalog-seehafer.json');
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
  if (process.env.PROD) throw new Error('32-katalog-angebot nicht gegen Produktion ausführen');
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  const watch = (pg) => {
    pg.on('pageerror', (e) => errors.push('pageerror ' + e.message));
    pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[1349]|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
  };
  watch(p);
  const api = async (pathname, opts = {}, pg = p) => {
    const r = await pg.request.fetch(BASE + '/api' + pathname, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
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

  step('Katalog-Datei laden: Vorschau, dann übernehmen, zweites Laden unverändert');
  const before = (await api('/catalog')).json;
  check(Array.isArray(before.services) && before.services.length === 0, `ohne Datei keine Leistungen (keine Grundausstattung, ${before.services?.length})`);
  await p.goto(`${BASE}/einstellungen?tab=catalog`);
  await p.getByRole('heading', { name: 'Katalog', level: 1 }).waitFor();
  await p.getByRole('button', { name: 'Aus Datei laden' }).click();
  const fd = p.getByRole('dialog', { name: 'Katalog aus Datei laden' });
  await fd.getByLabel('Katalog-Datei wählen').setInputFiles(FILE);
  const pv = fd.getByRole('list', { name: 'Vorschau je Liste' });
  await pv.waitFor();
  const svcLine = await pv.locator('[data-kind="services"]').innerText();
  check(svcLine.startsWith(`${doc.services.length} neu · 0 geändert`), `Vorschau Leistungen: ${svcLine}`);
  const prodLine = await pv.locator('[data-kind="products"]').innerText();
  check(new RegExp(`^${doc.products.length} neu`).test(prodLine) && /unsicher/.test(prodLine), `Vorschau Produkte mit unsicheren (${prodLine})`);
  check(/^\d+ neu/.test(await pv.locator('[data-kind="defects"]').innerText()), 'Vorschau Mängel');
  check(await fd.getByText('Unsichere Einträge').isVisible(), 'Hinweis auf unsichere Einträge');
  check((await api('/catalog/services')).json.length === 0, 'Vorschau speichert nichts');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-datei-vorschau.png' });
  await fd.getByRole('button', { name: 'Übernehmen' }).click();
  await p.getByText(/Katalog übernommen/).waitFor();
  const cat = (await api('/catalog')).json;
  check(cat.services.length === doc.services.length, `Leistungen übernommen (${cat.services.length})`);
  const sk32 = cat.products.find((x) => x.model === 'SK32');
  check(sk32?.aliases?.includes('SK32') && sk32.requirement === 'keine' && sk32.defaults.peephole === true, `Produkt SK32 mit Alias, Anforderung und Vorgaben (${JSON.stringify(sk32)})`);
  check(cat.products.some((x) => x.note?.startsWith('Unsicher:')), 'unsichere Produkte mit Notiz');
  const schallex = cat.defects.find((x) => x.title === 'Absenkdichtung defekt');
  check(schallex?.serviceKeys?.length === 3 && schallex.synonyms.includes('Schall-ex defekt'), 'Mangel mit drei Leistungen (je Anforderung)');
  check(cat.services.find((x) => x.key === 'IS-SCHALLEX-T30')?.price === 651, 'Preis aus der Vorlage (651 €)');
  // zweites Laden: nichts neu, nichts geändert
  await p.getByRole('button', { name: 'Aus Datei laden' }).click();
  await fd.getByLabel('Katalog-Datei wählen').setInputFiles(FILE);
  await pv.waitFor();
  check(/^0 neu · 0 geändert · \d+ unverändert/.test(await pv.locator('[data-kind="services"]').innerText()), 'zweites Laden: Leistungen unverändert');
  check(await fd.getByText(/Nichts zu ändern/).isVisible(), 'zweites Laden: nichts zu ändern');
  check(await fd.getByRole('button', { name: 'Übernehmen' }).isDisabled(), 'Übernehmen gesperrt');
  await fd.getByRole('button', { name: 'Abbrechen' }).click();
  // falsche Datei
  const bad = OUT + 'kein-katalog.json';
  fs.writeFileSync(bad, '{"format":"etwas","version":1}');
  await p.getByRole('button', { name: 'Aus Datei laden' }).click();
  await fd.getByLabel('Katalog-Datei wählen').setInputFiles(bad);
  await fd.getByText(/Keine Katalog-Datei/).waitFor();
  await fd.getByRole('button', { name: 'Abbrechen' }).click();

  step('Katalogseite: Leistungen, Aliasse am Produkt, Zuordnung am Mangel');
  await p.getByRole('tab', { name: /^Leistungen/ }).click();
  const sl = p.getByRole('list', { name: 'Leistungen' });
  await sl.getByRole('button', { name: /^IS-SCHALLEX-T30/ }).waitFor();
  check(/651,00/.test(await sl.getByRole('button', { name: /^IS-SCHALLEX-T30/ }).innerText()), 'Leistung mit Preis');
  await noOverflow(p, 'Katalog Leistungen 1360');
  await p.screenshot({ path: OUT + 'd-leistungen.png' });
  // neue Leistung mit Bedingung über das Formular
  await p.getByRole('button', { name: 'Neue Leistung' }).click();
  const sd = p.getByRole('dialog', { name: 'Neue Leistung' });
  await sd.getByLabel('Kürzel').fill('E2E-OTS-EINST');
  await sd.getByLabel('Bezeichnung').fill('Obentürschließer einstellen');
  await sd.getByLabel('Preis netto (€)').fill('42,50');
  await sd.getByLabel('Einheit').fill('Stk');
  await sd.getByLabel('Elementart').selectOption('fire_door');
  await sd.getByLabel('Bedingung hinzufügen').selectOption('requirement');
  await sd.getByRole('group', { name: 'Bedingung' }).getByLabel('T30', { exact: true }).check();
  await sd.getByRole('group', { name: 'Bedingung' }).getByLabel('T90', { exact: true }).check();
  await p.screenshot({ path: OUT + 'd-leistung-dialog.png' });
  await sd.getByRole('button', { name: 'Anlegen' }).click();
  await sl.getByRole('button', { name: /^E2E-OTS-EINST/ }).waitFor();
  const own = (await api('/catalog/services')).json.find((x) => x.key === 'E2E-OTS-EINST');
  check(own?.price === 42.5 && JSON.stringify(own.condition) === JSON.stringify({ requirement: ['T30', 'T90'] }) && own.kind === 'repair', `Leistung mit Bedingung gespeichert (${JSON.stringify(own)})`);
  // Mangel: Leistung zuordnen
  await p.getByRole('tab', { name: /^Mängel/ }).click();
  await p.getByRole('searchbox', { name: 'Mängel durchsuchen' }).fill('Tür schließt nicht vollständig');
  await p.getByRole('list', { name: 'Mängel' }).getByRole('button', { name: 'Tür schließt nicht vollständig' }).click();
  const dd = p.getByRole('dialog', { name: 'Mangel bearbeiten' });
  await dd.getByLabel('Leistung hinzufügen').selectOption('E2E-OTS-EINST');
  check(await dd.getByRole('group', { name: 'Leistungen' }).getByText(/E2E-OTS-EINST · Obentürschließer einstellen/).first().isVisible(), 'Leistung am Mangel angezeigt');
  await dd.getByRole('button', { name: 'Speichern' }).click();
  await dd.waitFor({ state: 'detached' });
  check((await api('/catalog/defects')).json.find((x) => x.title === 'Tür schließt nicht vollständig')?.serviceKeys?.[0] === 'E2E-OTS-EINST', 'Zuordnung gespeichert');
  // Produkt: Aliasse und Zulassung bis
  await p.getByRole('tab', { name: /^Produkte/ }).click();
  await p.getByRole('searchbox', { name: 'Produkte durchsuchen' }).fill('SK32');
  await p.getByRole('list', { name: 'Produkte' }).getByRole('button', { name: 'Westag + Getalit SK32' }).click();
  const pd = p.getByRole('dialog', { name: 'Produkt bearbeiten' });
  check((await pd.getByLabel('Aliasse').inputValue()) === 'SK32', 'Aliasse im Formular');
  await pd.getByLabel('Aliasse').fill('SK32; SK 32');
  await pd.getByLabel('Zulassung gültig bis').fill('2030-12-31');
  await pd.getByRole('button', { name: 'Speichern' }).click();
  await pd.waitFor({ state: 'detached' });
  const sk32b = (await api('/catalog/products')).json.find((x) => x.model === 'SK32');
  check(JSON.stringify(sk32b.aliases) === '["SK32","SK 32"]' && sk32b.approvalValidUntil === '2030-12-31', `Alias und Gültigkeit gespeichert (${JSON.stringify([sk32b.aliases, sk32b.approvalValidUntil])})`);
  await p.getByRole('searchbox', { name: 'Produkte durchsuchen' }).fill('');

  step('Tür mit Typ aus Alias anlegen (Elementformular)');
  const P1 = (await api('/properties', { data: { name: 'E2E Angebot Hotel' } })).json;
  const B1 = (await api(`/properties/${P1.id}/buildings`, { data: { name: 'Hauptgebäude' } })).json;
  await p.goto(`${BASE}/elemente?neu=1`);
  await p.getByRole('dialog').getByRole('button', { name: /^Fenster/ }).waitFor();
  check((await p.getByRole('dialog').getByRole('button', { name: /Fenster/ }).count()) === 1 && (await p.getByRole('dialog').getByRole('button', { name: /Drehtürantrieb/ }).count()) === 1, 'Auswahl der Art: Fenster und Drehtürantrieb');
  await p.getByRole('dialog').getByRole('button', { name: /^Tür/ }).first().click();
  await p.getByLabel('Objekt', { exact: true }).selectOption(P1.id);
  await p.getByLabel('Standort').waitFor();
  await p.waitForTimeout(600);
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Typ / Modell').fill('SK 32');
  const hint = dlg.getByRole('group', { name: 'Typen aus dem Katalog' }).getByRole('button', { name: 'Westag + Getalit SK32' });
  await hint.waitFor();
  await hint.click();
  check((await dlg.getByLabel('Anforderung').inputValue()) === 'keine', 'Anforderung „keine“ aus dem Typ');
  check((await dlg.getByLabel('Türspion').isChecked()) && (await dlg.getByLabel('Absenkdichtung').isChecked()) && (await dlg.getByLabel('Schallschutz').isChecked()), 'Spion, Absenkdichtung, Schallschutz angehakt');
  await dlg.getByLabel('Standort').fill('Zimmer 304');
  await dlg.getByRole('spinbutton', { name: /^Nummer/ }).fill('36');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-tuer-aus-alias.png' });
  await dlg.getByRole('button', { name: 'Speichern', exact: true }).click();
  await p.getByText('T-036 angelegt').waitFor();
  const assets = async () => (await api(`/assets?propertyId=${P1.id}`)).json;
  const t36 = (await assets()).find((x) => x.code === 'T-036');
  check(t36?.manufacturer === 'Westag + Getalit' && t36.model === 'SK32' && t36.attributes.requirement === 'keine' && t36.attributes.peephole === true, `Tür T-036 mit Stammdaten (${JSON.stringify(t36?.attributes)})`);

  step('Prüfpunkte je Anforderung');
  const mk = async (category, extra = {}) => (await api('/assets', { data: { buildingId: B1.id, category, floor: 'EG', location: 'Flur', ...extra } })).json;
  const base = { leaves: '1-flügelig', holdOpen: false, cardLock: false, dropSeal: false, peephole: false };
  const tT30 = await mk('fire_door', { attributes: { ...base, requirement: 'T30' } });
  const tRS = await mk('fire_door', { attributes: { ...base, requirement: 'RS', dropSeal: true } });
  const tOld = await mk('fire_door', { attributes: { ...base, rating: 'T90', smoke: true } });
  check(/^T-\d{3}$/.test(tT30.code), `neue Tür mit Präfix T (${tT30.code})`);
  check((await api(`/assets/${tOld.id}`)).json.attributes.requirement === 'T90-RS', 'alte Feldnamen (rating/smoke) → Anforderung T90-RS');
  check((await api('/assets', { data: { buildingId: B1.id, category: 'fire_door', attributes: { rating: 'T45' } } })).status === 400, 'rating T45 → 400');
  const draft = (await api(`/assets/${tT30.id}/inspections`, { data: {} })).json;
  const dT30 = (await api(`/inspections/${draft.id}`)).json;
  const groups = [...new Set(dT30.checkpoints.map((c) => c.group))];
  check(groups.length >= 9 && groups[0] === 'Kennzeichnung und Zulassung' && groups.includes('Dichtungen'), `Prüfpunkte nach Bauteil (${groups.join(', ')})`);
  const byLabel = (re) => dT30.checkpoints.find((c) => re.test(c.label));
  check(JSON.stringify(byLabel(/Dämmschichtbildner/)?.appliesIf) === JSON.stringify({ attr: 'requirement', in: ['T30', 'T30-RS', 'T90', 'T90-RS'] }), 'Brandschutz-Punkt mit Bedingung');
  check(byLabel(/^Rauchschutz:/)?.appliesIf?.in?.includes('RS'), 'Rauchschutz-Punkt mit Bedingung');
  await api(`/inspections/${draft.id}`, { method: 'DELETE' });
  // MCP: „alles in Ordnung“ setzt nach Anforderung „entfällt“
  const key = (await api('/account/api-keys', { data: { name: 'E2E Katalog v7', scope: 'write', expiresInDays: 1 } })).json.key;
  let rpc = 0;
  const tool = async (name, args) => {
    const r = await fetch(BASE + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }),
    });
    const j = await r.json().catch(() => null);
    const text = j?.result?.content?.[0]?.text ?? j?.error?.message ?? '';
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* Text */
    }
    return { isError: !!j?.result?.isError, text, data };
  };
  const answersAfterAllOk = async (asset) => {
    const r = await tool('inspect', { asset: asset.code, allOk: true });
    check(!r.isError, `inspect ${asset.code} (${r.text.slice(0, 160)})`);
    const a = (await api(`/assets/${asset.id}`)).json;
    const insp = a.inspections.find((i) => i.status === 'draft' || i.status === 'ready');
    const d = (await api(`/inspections/${insp.id}`)).json;
    return { d, ans: (re) => d.answers[d.checkpoints.find((c) => re.test(c.label)).id] };
  };
  const r30 = await answersAfterAllOk(tT30);
  check(r30.ans(/Dämmschichtbildner/) === 'ok' && r30.ans(/^Rauchschutz:/) === 'na' && r30.ans(/Kennzeichnungsschild/) === 'ok', 'T30: Brandschutz i. O., Rauchschutz entfällt');
  check(r30.ans(/Absenkdichtung senkt/) === 'na' && r30.ans(/Schließfolge/) === 'na' && r30.ans(/Feststellanlage löst/) === 'na', 'T30: Absenkdichtung, Schließfolge, FSA entfallen');
  const rRS = await answersAfterAllOk(tRS);
  check(rRS.ans(/Dämmschichtbildner/) === 'na' && rRS.ans(/^Rauchschutz:/) === 'ok' && rRS.ans(/Absenkdichtung senkt/) === 'ok', 'RS: Brandschutz entfällt, Rauchschutz und Absenkdichtung i. O.');
  const rOld = await answersAfterAllOk(tOld);
  check(rOld.ans(/Dämmschichtbildner/) === 'ok' && rOld.ans(/^Rauchschutz:/) === 'ok', 'Bestand (T90 + RS): beides gilt');
  const t36ok = await answersAfterAllOk(t36);
  check(t36ok.ans(/Kennzeichnungsschild/) === 'na' && t36ok.ans(/Türspion/) === 'ok', 'ohne Anforderung: Kennzeichnung entfällt, Spion i. O.');

  step('Fenster und Drehtürantrieb anlegen und prüfen');
  const win = await mk('window', { attributes: { leaves: '2-flügelig', size: 'bis 1 × 2 m', fanlight: false, opening: 'Dreh-Kipp' } });
  check(/^F-\d{3}$/.test(win.code), `Fenster mit Präfix F (${win.code})`);
  const wd = (await api(`/assets/${win.id}/inspections`, { data: {} })).json;
  const wdd = (await api(`/inspections/${wd.id}`)).json;
  check(wdd.checkpoints.length === 8 && wdd.checkpoints.every((c) => c.group), `Fenster: 8 Prüfpunkte mit Gruppen (${wdd.checkpoints.length})`);
  const wsub = await api(`/inspections/${wd.id}/submit`, {
    data: {
      kinds: wdd.kinds,
      answers: Object.fromEntries(wdd.checkpoints.map((c) => [c.id, c.appliesIf ? 'na' : 'ok'])),
      defects: [],
      maintenance: ['greased', 'adjusted'],
      signature: SIG,
      signerName: 'E2E',
    },
  });
  check(wsub.status === 200, `Fenster geprüft (${wsub.status} ${wsub.text.slice(0, 120)})`);
  const wa = (await api(`/assets/${win.id}`)).json;
  check(wa.lastResult === 'ok' && Math.round((wa.nextDueAt - wa.lastInspectedAt) / (30.44 * 86400000)) === 12, 'Fenster: jährlich, ohne Mängel');
  const drv = await mk('door_drive', { attributes: { leaves: '1-flügelig', fireDoor: true } });
  check(/^DA-\d{3}$/.test(drv.code), `Drehtürantrieb mit Präfix DA (${drv.code})`);
  const rDrv = await answersAfterAllOk(drv);
  check(rDrv.ans(/Brandalarm/) === 'ok' && rDrv.d.checkpoints.length === 9, 'Drehtürantrieb an Brandschutztür: Brandalarm-Punkt gilt');
  const s = (await api(`/search?q=${encodeURIComponent('Fenster ' + win.number)}&propertyId=${P1.id}`)).json;
  check(s.assets?.[0]?.code === win.code, `„Fenster ${win.number}“ in der Suche`);

  step('Angebotsliste rechnen');
  const defect = async (asset, title, severity = 'medium') => (await api('/defects', { data: { assetId: asset.id, title, severity, force: true } })).json;
  const m1 = await defect(t36, 'Schall-ex defekt');
  const m2 = await defect(tRS, 'Absenkdichtung defekt');
  const m3 = await defect(tT30, 'Bodenluft zu groß, Schwelle nötig');
  const m4 = await defect(tOld, 'Bodenluft zu groß');
  const m5 = await defect(tT30, 'Dichtung fehlt');
  const m6 = await defect(t36, 'Dichtung fehlt');
  const m7 = await defect(tT30, 'Zarge irreparabel beschädigt');
  const m8 = await defect(tT30, 'Etwas ganz Eigenes');
  check([m1, m2, m3, m4, m5, m6, m7, m8].every((x) => x?.id), 'Mängel angelegt');
  const off = await api(`/properties/${P1.id}/offer`);
  check(off.status === 200, `Angebotsliste (${off.status} ${off.text.slice(0, 160)})`);
  const o = off.json;
  const line = (k) => o.lines.find((l) => l.serviceKey === k);
  check(line('IS-SCHALLEX-0')?.total === 335 && JSON.stringify(line('IS-SCHALLEX-0').doors) === '["T-036"]', 'Schall-Ex ohne Anforderung 335 € an T-036');
  check(line('IS-SCHALLEX-T30')?.total === 651 && line('IS-SCHALLEX-T30').doors[0] === tRS.code, 'Schall-Ex RS 651 €');
  check(line('IS-SCHWELLE')?.quantity === 2 && line('IS-SCHWELLE').total === 305 && line('IS-SCHWELLE').doors.length === 2, `Schwelle zweimal summiert (${JSON.stringify(line('IS-SCHWELLE'))})`);
  check(line('IS-DICHT-0')?.quantity === 5 && line('IS-DICHT-0').unit === 'lfm' && line('IS-DICHT-0').total === 86.75, 'Dichtung ohne Brandschutz: 5 lfm × 17,35 €');
  check(line('IS-DICHT-BS')?.doors[0] === tT30.code && line('IS-DICHT-BS').defects[0] === m5.id, 'Dichtung mit Brandschutz an der T30-Tür');
  check(o.unmapped.length === 2 && o.unmapped.some((u) => u.defectId === m7.id && u.door === tT30.code) && o.unmapped.some((u) => u.defectId === m8.id), `nicht zugeordnet: Zarge (keine Leistung) und eigener Mangel (${JSON.stringify(o.unmapped)})`);
  const net = Math.round(o.lines.reduce((n, l) => n + l.total, 0) * 100) / 100;
  check(o.net === net && o.net > 0, `Summe netto (${o.net})`);
  check(JSON.stringify(Object.keys(o).sort()) === '["lines","net","unmapped"]' && JSON.stringify(Object.keys(o.lines[0]).sort()) === '["defects","doors","quantity","serviceKey","title","total","unit","unitPrice"]', 'Form wie im Plan');
  // nur bestimmte Prüfungen, Zeitraum
  const onlyNone = (await api(`/properties/${P1.id}/offer?inspectionIds=gibt-es-nicht`)).json;
  check(onlyNone.lines.length === 0 && onlyNone.unmapped.length === 0 && onlyNone.net === 0, 'inspectionIds grenzt ein');
  const today = new Date().toISOString().slice(0, 10);
  check((await api(`/properties/${P1.id}/offer?from=${today}&to=${today}`)).json.lines.length === o.lines.length, 'Zeitraum heute: alle');
  check((await api(`/properties/${P1.id}/offer?to=2020-01-01`)).json.lines.length === 0, 'Zeitraum vor den Mängeln: leer');
  check((await api(`/properties/${P1.id}/offer?from=2026-02-30`)).status === 400, 'ungültiges Datum → 400');
  // behobener Mangel zählt nicht mehr
  await api(`/defects/${m1.id}`, { method: 'PATCH', data: { status: 'resolved' } });
  check(!(await api(`/properties/${P1.id}/offer`)).json.lines.some((l) => l.serviceKey === 'IS-SCHALLEX-0'), 'behobener Mangel fällt heraus');

  step('Import der Wartungsübersicht');
  const head = ['Protokoll Nummer', 'Ident Nummer', 'Prüf-Intervall in Tagen', 'Zeitpunkt der letzten Prüfung', 'Nächste Prüfung spätestens am', 'Betreiber / Auftraggeber', 'Objektbeschreibung', 'Etage', 'Raum', 'Türtyp', 'Hersteller', 'Absenkdichtung', 'OTS', 'Spion', 'Zulassung / Prüfzeugnis', 'Bemerkung / Link'];
  const rowsCsv = [
    head,
    ['2', '1', '365', '16.04.2025', '16.04.2026', 'Kunde', '', 'EG', 'Treppenhaus-Flur', 'T30 RS', 'Westag + Getalit AG', 'JA', 'JA', '', 'Z-6.16-1211 / P-3785/7858', ''],
    ['2', '2', '365', '16.04.2025', '16.04.2026', 'Kunde', '', 'EG', 'Batterieraum', 'RS Alu-Rohr-Rahmen', '(Ferro-WICSTYLE)', 'JA', 'JA', '', '28119620', ''],
    ['2', '36', '365', '16.04.2025', '16.04.2026', 'Kunde', '', '3.OG', '304', 'SK32', 'Westag + Getalit AG', 'JA', 'JA', 'JA', '', ''],
    ['2', '37', '365', '', '', 'Kunde', '', '3.OG', '305', 'Etwas Unbekanntes T90', 'Unbekannt', '', 'JA', '', '', ''],
    ['1', '9', '365', '16.04.2025', '16.04.2026', 'Kunde', '', '1.OG', 'Flur', 'RS Alu-Rohr-Rahmen', 'Ferro-WICSTYLE', '', '', '', '', ''],
  ];
  const csvFile = OUT + 'wartungsuebersicht.csv';
  fs.writeFileSync(csvFile, '﻿' + rowsCsv.map((r) => r.join(';')).join('\r\n'));
  await p.goto(`${BASE}/einstellungen/import`);
  await p.getByLabel('Objekt für Dateien ohne Objektspalte').fill('E2E Wartungsübersicht');
  await p.locator('#import-file').setInputFiles(csvFile);
  await p.getByText('5 Zeilen bereit').waitFor();
  check(await p.getByRole('table').getByText('Typ aus dem Katalog: Westag + Getalit T30 RS').first().isVisible(), 'Vorschau zeigt den Katalog-Typ');
  await p.mouse.move(1, 1);
  await p.screenshot({ path: OUT + 'd-import.png' });
  await p.getByRole('button', { name: '5 importieren' }).click();
  await p.getByText('5 Elemente importiert').first().waitFor();
  const imp = (await api('/properties')).json.find((x) => x.name === 'E2E Wartungsübersicht');
  const ia = (await api(`/assets?propertyId=${imp.id}`)).json;
  const byNo = (n, c = 'fire_door') => ia.find((x) => x.number === n && x.category === c);
  check(ia.length === 5 && ia.every((x) => x.buildingName === 'Hauptgebäude'), `5 Elemente im Hauptgebäude (${ia.length})`);
  check(byNo(1)?.code === 'T-001' && byNo(1).model === 'T30 RS' && byNo(1).attributes.requirement === 'T30-RS' && byNo(1).attributes.approval === 'Z-6.16-1211 / P-3785/7858', `Ident 1: Typ aus Alias (${JSON.stringify(byNo(1))})`);
  check(byNo(1).attributes.dropSeal === true && byNo(1).attributes.closer === true && byNo(1).attributes.peephole === false, 'JA-Spalten als Ja/Nein');
  check(byNo(36)?.attributes.requirement === 'keine' && byNo(36).attributes.peephole === true && byNo(36).manufacturer === 'Westag + Getalit AG', 'Ident 36: SK32');
  check(byNo(2)?.attributes.requirement === 'RS' && byNo(2).manufacturer === 'Ferro-WICSTYLE', 'Ident 2: RS aus dem Freitext, Hersteller ohne Klammer');
  check(byNo(37)?.model === 'Etwas Unbekanntes T90' && byNo(37).attributes.requirement === 'T90' && byNo(37).nextDueAt === null, 'Ident 37: Freitext, nie geprüft');
  check(byNo(9, 'hold_open')?.code === 'FSA-009', 'Protokoll 1 = Feststellanlage');
  check(new Date(byNo(1).nextDueAt).toISOString().slice(0, 10) === '2026-04-16' && new Date(byNo(1).lastInspectedAt).toISOString().slice(0, 10) === '2025-04-16', 'letzte und nächste Prüfung aus der Datei');
  const order = [...ia].sort((x, y) => x.sortIndex - y.sortIndex).map((x) => x.number);
  check(JSON.stringify(order) === '[1,2,36,37,9]', `Laufreihenfolge wie in der Datei (${order})`);

  step('MCP catalog: Leistungen suchen, Leistung im Stapel (Vorschau)');
  let t = await tool('catalog', { action: 'search', list: 'services', query: 'Schwelle' });
  check(!t.isError && t.data?.services?.some((x) => x.key === 'IS-SCHWELLE' && x.price === 152.5), `search services (${t.text.slice(0, 160)})`);
  t = await tool('catalog', { action: 'search', list: 'products', query: 'SK32' });
  check(t.data?.products?.[0]?.aliases?.includes('SK32') && t.data.products[0].requirement === 'keine', 'search products mit Aliassen und Anforderung');
  t = await tool('catalog', { action: 'upsert', list: 'services', items: [{ key: 'E2E-MCP', title: 'Probe', price: 10, unit: 'Stk', category: 'Tür', condition: { requirement: ['T30'] } }] });
  check(!t.isError && t.data?.create?.length === 1 && /Vorschau/.test(t.data.preview), `upsert services Vorschau (${t.text.slice(0, 160)})`);
  t = await tool('catalog', { action: 'upsert', list: 'services', items: [{ key: 'E2E-MCP2', title: 'Probe', price: 10, category: 'Tür', condition: { farbe: 'rot' } }] });
  check(/farbe/.test(t.text) && /requirement/.test(t.text), `unbekannte Bedingung als Fehler (${t.text.slice(0, 200)})`);
  t = await tool('catalog', { action: 'upsert', list: 'defects', preview: true, items: [{ title: 'Probe-Mangel', category: 'Tür', serviceKeys: ['GIBT-ES-NICHT'] }] });
  check(/GIBT-ES-NICHT/.test(t.text), `Hinweis auf unbekannte Leistung (${t.text.slice(0, 200)})`);

  step('Prüfer: Katalog lesen ja, Leistungen ändern nein; Angebotsliste lesen');
  const ictx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const ip = await ictx.newPage();
  await login(ip, 'pruefer@example.com');
  check((await api('/catalog/services', {}, ip)).status === 200, 'Prüfer liest Leistungen');
  check((await api('/catalog/services', { data: { key: 'X1', title: 'Xx', price: 1 } }, ip)).status === 403, 'Prüfer legt keine Leistung an');
  await ip.goto(`${BASE}/einstellungen?tab=catalog`);
  await ip.getByRole('tab', { name: /^Leistungen/ }).click();
  await ip.getByRole('list', { name: 'Leistungen' }).getByRole('listitem').first().waitFor();
  check((await ip.getByRole('button', { name: 'Aus Datei laden' }).count()) === 0 && (await ip.getByRole('button', { name: 'Neue Leistung' }).count()) === 0, 'Prüfer: weder Datei laden noch anlegen');
  await ictx.close();

  step('Handy 390 px: Katalogseite, Leistungsdialog, Datei-Vorschau ohne Überlauf');
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const m = await mctx.newPage();
  watch(m);
  await login(m, 'demo@example.com');
  await m.goto(`${BASE}/einstellungen?tab=catalog`);
  await m.getByRole('list', { name: 'Mängel' }).getByRole('listitem').first().waitFor();
  await noOverflow(m, 'Katalog 390');
  await m.screenshot({ path: OUT + 'm-katalog.png' });
  await m.getByRole('tab', { name: /^Leistungen/ }).click();
  await m.getByRole('list', { name: 'Leistungen' }).getByRole('listitem').first().waitFor();
  await noOverflow(m, 'Leistungen 390');
  await m.screenshot({ path: OUT + 'm-leistungen.png' });
  await m.getByRole('list', { name: 'Leistungen' }).getByRole('button', { name: /^IS-SCHALLEX-T30/ }).click();
  await m.getByRole('dialog', { name: 'Leistung bearbeiten' }).getByRole('group', { name: 'Bedingung' }).waitFor();
  await noOverflow(m, 'Leistungsdialog 390');
  await m.screenshot({ path: OUT + 'm-leistung-dialog.png' });
  await m.keyboard.press('Escape');
  await m.getByRole('button', { name: 'Aus Datei laden' }).click();
  await m.getByRole('dialog', { name: 'Katalog aus Datei laden' }).getByLabel('Katalog-Datei wählen').setInputFiles(FILE);
  await m.getByRole('list', { name: 'Vorschau je Liste' }).waitFor();
  await noOverflow(m, 'Datei-Vorschau 390');
  await m.screenshot({ path: OUT + 'm-datei-vorschau.png' });
  await mctx.close();

  check(!errors.length, `keine Fehler in der Konsole (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  if (fail.length) {
    console.log(`\n${fail.length} Prüfungen fehlgeschlagen`);
    process.exit(1);
  }
  console.log('alles bestanden');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
