// E2E 21-offene-punkte: abgelehnte Offline-Übertragungen auf dem Server (Liste, erneut versuchen, löschen),
// selbstanpassende Prüfintervalle (Vorschlagen/Automatisch, Zurücksetzen) und Partner-Zugang für Subunternehmer
// (Einladungscode, Sammelseite /partner/:code). API + Oberfläche, Handybreite 390 px. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '21-offene-punkte') + '/';
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
/** Monate addieren wie shared/logic.ts → addMonths */
const addMonths = (ts, months) => {
  const d = new Date(ts);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
};

(async () => {
  if (process.env.PROD) throw new Error('21-offene-punkte nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const errors = [];
  const session = async (email, viewport = { width: 1360, height: 860 }) => {
    const ctx = await b.newContext({ viewport, locale: 'de-DE' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${email} pageerror ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[0134]/.test(m.text()) && errors.push(`${email} console ${m.text()}`));
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
    const r = await api('/auth/login', { data: { email, password: PW } });
    if (r.status !== 200) throw new Error(`Login ${email}: ${r.status}`);
    return { ctx, p, api };
  };
  const owner = await session('demo@example.com');
  const insp = await session('pruefer@example.com');
  const insp2 = await session('pruefer2@example.com');
  const viewer = await session('lesen@example.com');
  const { api } = owner;
  const cats = (await api('/categories')).json;
  const cps = cats.find((c) => c.key === 'smoke_alarm').checkpoints;
  const smoke = (await api('/assets?category=smoke_alarm')).json;
  // Für die Intervall-Reihen: zuletzt ohne Mängel geprüft und ohne offenen Vorschlag
  const calm = [];
  for (const a of smoke) if (a.lastResult === 'ok' && !(await api(`/smart/intervals?assetId=${a.id}`)).json.suggestions.length) calm.push(a);
  check(calm.length >= 2 && smoke.length >= 4, `genug Rauchmelder im Demobestand (${calm.length}/${smoke.length})`);
  const [A1, A2] = calm;
  const [A3, A4] = smoke.filter((a) => a.id !== A1.id && a.id !== A2.id);
  const notes = async (s) => (await s.api('/notifications')).json.items;

  /** Reguläre Prüfung über die API abschließen (mit oder ohne Mangel). */
  const inspect = async (s, assetId, defect) => {
    const iid = (await s.api(`/assets/${assetId}/inspections`, { data: {} })).json.id;
    const body = {
      kinds: ['periodic'],
      answers: Object.fromEntries(cps.map((cp, i) => [cp.id, defect && i === 0 ? 'defect' : 'ok'])),
      defects: defect ? [{ checkpointId: cps[0].id, title: cps[0].label, note: '', measure: '', severity: 'medium' }] : [],
      signature: SIG,
      signerName: 'E2E',
    };
    const r = await s.api(`/inspections/${iid}/submit`, { data: body });
    if (r.status !== 200) throw new Error(`Abschluss ${r.status} ${r.text}`);
    return r.json;
  };
  const sched = async (id) => (await api(`/assets/${id}`)).json.schedules.main;

  // ---------------------------------------------------------------------------
  step('Intervalle: Standard ist „Vorschlagen“; zwei Prüfungen mit Mängeln → Vorschlag 12 → 6 Monate');
  let me = (await api('/account/me')).json;
  check(me.tenant.adaptIntervalsMode === 'suggest', `Standardstufe vorschlagen (${me.tenant.adaptIntervalsMode})`);
  await inspect(owner, A1.id, true);
  let r = await api(`/smart/intervals?assetId=${A1.id}`);
  check(r.json.suggestions.length === 0, 'eine Prüfung mit Mangel reicht nicht');
  const second = await inspect(owner, A1.id, true);
  check(Math.abs(second.nextDueAt - addMonths(Date.now(), 12)) < DAY, 'im Vorschlagsmodus bleibt der Termin bei 12 Monaten');
  r = await api(`/smart/intervals?assetId=${A1.id}`);
  const sug = r.json.suggestions[0];
  check(r.json.mode === 'suggest' && sug?.kind === 'shorten' && sug.from === 12 && sug.to === 6, `Vorschlag verkürzen (${JSON.stringify(r.json)})`);
  const sAll = (await api('/smart/suggestions')).json;
  const card = sAll.find((x) => x.kind === 'interval' && x.action?.body?.assetId === A1.id);
  check(!!card && card.action.endpoint === '/smart/intervals/apply' && card.action.body.months === 6, `Vorschlag auf „Heute“ mit Aktion (${sAll.map((x) => x.kind).join(',')})`);
  check(!(await insp.api('/smart/suggestions')).json.some((x) => x.kind === 'interval'), 'Prüfer bekommen keinen Intervall-Vorschlag (nur Admins ändern)');
  check((await insp.api('/smart/intervals/apply', { data: { assetId: A1.id, schedule: 'main', months: 6 } })).status === 403, 'Prüfer darf nicht anpassen');
  check((await api('/smart/intervals/apply', { data: { assetId: A1.id, schedule: 'main', months: 3 } })).status === 409, 'abweichender Wert → 409');
  r = await api('/smart/intervals/apply', { data: card.action.body });
  check(r.status === 200 && r.json.intervalMonths === 6, `Vorschlag übernommen (${r.text})`);
  let st = await sched(A1.id);
  check(st.intervalMonths === 6 && st.nextDueAt === addMonths(st.lastAt, 6), `Termin ab letzter Prüfung + 6 Monate (${JSON.stringify(st)})`);
  check((await api(`/smart/intervals?assetId=${A1.id}`)).json.suggestions.length === 0, 'nach Übernahme kein Vorschlag mehr');
  const acts = (await api('/account/activity')).json;
  const actList = Array.isArray(acts) ? acts : (acts.items ?? []);
  check(actList.some((x) => /6 Monate verkürzen/.test(x.summary)), 'Anpassung im Aktivitätsprotokoll');

  step('Elementseite: „Intervall angepasst“ und Zurücksetzen');
  await owner.p.goto(`${BASE}/elemente/${A1.id}`);
  await owner.p.getByText('Intervall angepasst: 6 statt 12 Monate').waitFor();
  await owner.p.screenshot({ path: OUT + '01-element-intervall.png' });
  await owner.p.locator('[data-interval="main"]').getByRole('button', { name: 'Zurücksetzen' }).click();
  await owner.p.getByText('Intervall zurückgesetzt').waitFor();
  st = await sched(A1.id);
  check(st.intervalMonths == null && st.nextDueAt === addMonths(st.lastAt, 12), `zurückgesetzt auf 12 Monate (${JSON.stringify(st)})`);
  check((await api(`/smart/intervals?assetId=${A1.id}`)).json.suggestions.length === 0, 'nach Zurücksetzen zählen die alten Mängel nicht erneut');
  check((await api('/smart/intervals/reset', { data: { assetId: A1.id, schedule: 'main' } })).status === 409, 'doppeltes Zurücksetzen → 409');

  step('Intervalle „Automatisch“: beim Abschluss angewendet, nach 4 mängelfreien zurück');
  const company = (t, extra) => ({ name: t.name, address: t.address ?? '', phone: t.phone ?? '', email: t.email ?? '', website: t.website ?? '', ...extra });
  check((await insp.api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'auto' }) })).status === 403, 'Prüfer ändert die Stufe nicht');
  r = await api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'auto' }) });
  check(r.status === 200, `Stufe automatisch (${r.status} ${r.text.slice(0, 100)})`);
  check((await api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'immer' }) })).status === 400, 'unbekannte Stufe abgelehnt');
  await inspect(owner, A2.id, true);
  const auto = await inspect(owner, A2.id, true);
  check(Math.abs(auto.nextDueAt - addMonths(Date.now(), 6)) < DAY, 'zweite Prüfung mit Mangel: Termin direkt in 6 Monaten');
  st = await sched(A2.id);
  check(st.intervalMonths === 6, `Intervall automatisch verkürzt (${JSON.stringify(st)})`);
  check((await api('/smart/suggestions')).json.every((x) => x.kind !== 'interval'), 'im Automatikmodus keine Vorschläge');
  const actAuto = (await api('/account/activity')).json;
  check((Array.isArray(actAuto) ? actAuto : actAuto.items ?? []).some((x) => /automatisch/.test(x.summary)), 'automatische Anpassung protokolliert');
  for (let i = 0; i < 3; i++) await inspect(owner, A2.id, false);
  check((await sched(A2.id)).intervalMonths === 6, 'nach 3 mängelfreien noch verkürzt');
  const back = await inspect(owner, A2.id, false);
  st = await sched(A2.id);
  check(st.intervalMonths == null && Math.abs(back.nextDueAt - addMonths(Date.now(), 12)) < DAY, `nach 4 mängelfreien zurück zum Standard (${JSON.stringify(st)})`);
  await api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'off' }) });
  await inspect(owner, A1.id, true);
  await inspect(owner, A1.id, true);
  check((await api(`/smart/intervals?assetId=${A1.id}`)).json.suggestions.length === 0 && (await sched(A1.id)).intervalMonths == null, 'Stufe „Aus“: weder Vorschlag noch Anpassung');
  await api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'suggest' }) });

  step('Einstellungen → Automatik: Stufe im Schritt „Lernen“ wählen (einzige Stelle)');
  await owner.p.goto(`${BASE}/einstellungen?tab=automation`);
  const learn = owner.p.locator('[data-automation="adapt_intervals"]');
  await learn.getByText('Lernen', { exact: true }).waitFor();
  await learn.getByRole('tab', { name: 'Automatisch' }).click();
  await owner.p.getByText('Lernen: Automatisch').first().waitFor();
  me = (await api('/account/me')).json;
  check(me.tenant.adaptIntervalsMode === 'auto', `Stufe über die Oberfläche gespeichert (${me.tenant.adaptIntervalsMode})`);
  await api('/account/company', { method: 'PATCH', data: company(me.tenant, { adaptIntervalsMode: 'suggest' }) });

  // ---------------------------------------------------------------------------
  step('Offline: abgelehnte Übertragung (Element gelöscht) wird auf dem Server aufbewahrt');
  const offBody = (assetId, extra = {}) => ({
    clientId: `e2e-${Math.random().toString(36).slice(2, 12)}`,
    assetId,
    schedule: 'main',
    inspectedAt: Date.now() - 3600_000,
    checkpoints: cps,
    kinds: ['periodic'],
    answers: Object.fromEntries(cps.map((cp) => [cp.id, 'ok'])),
    defects: [],
    photos: [],
    signature: SIG,
    signerName: 'Offline E2E',
    ...extra,
  });
  check((await api(`/assets/${A3.id}`, { method: 'DELETE' })).status === 200, 'Element gelöscht');
  const gone = offBody(A3.id);
  r = await insp.api('/inspections/offline', { data: gone });
  check(r.status === 404 && typeof r.json?.failureId === 'string', `Ablehnung mit failureId (${r.status} ${r.text})`);
  const fid = r.json.failureId;
  r = await insp.api('/inspections/offline', { data: gone });
  check(r.json?.failureId === fid, 'gleiche clientId → derselbe Eintrag');
  let mine = (await insp.api('/offline/failures')).json;
  const f1 = mine.find((x) => x.id === fid);
  check(f1 && f1.assetCode === A3.code && f1.assetAvailable === false && f1.retryable && f1.attempts === 2 && /nicht gefunden/.test(f1.reason), `Prüfer sieht eigenen Eintrag (${JSON.stringify(f1)})`);
  check(!JSON.stringify(mine).includes('base64'), 'Liste enthält keine Unterschrift');
  check(!(await insp2.api('/offline/failures')).json.some((x) => x.id === fid), 'anderer Prüfer sieht fremde Einträge nicht');
  check((await insp2.api(`/offline/failures/${fid}/retry`, { data: {} })).status === 404, 'anderer Prüfer kann nicht erneut versuchen');
  check((await insp2.api(`/offline/failures/${fid}`, { method: 'DELETE' })).status === 404, 'anderer Prüfer kann nicht löschen');
  check((await viewer.api(`/offline/failures/${fid}/retry`, { data: {} })).status === 403, 'Lesezugriff kann nicht erneut versuchen');
  check((await viewer.api('/inspections/offline', { data: offBody(A4.id) })).status === 403, 'Lesezugriff darf nicht übertragen');
  const all = (await api('/offline/failures')).json;
  check(all.some((x) => x.id === fid && x.userName === 'Jonas Weber') && all.length === 1, `Admin sieht alle Einträge (${all.length}; 403 nicht gespeichert)`);
  const ownerNotes = await notes(owner);
  check(ownerNotes.some((n) => n.type === 'offline_failure' && n.title.includes(A3.code)), 'Admin benachrichtigt');
  check((await notes(insp)).some((n) => n.type === 'offline_failure'), 'prüfende Person benachrichtigt');
  r = await api(`/offline/failures/${fid}/retry`, { data: {} });
  check(r.status === 404, `erneuter Versuch ohne Element scheitert weiter (${r.status})`);
  check((await api('/offline/failures')).json.find((x) => x.id === fid).attempts === 3, 'Versuche gezählt');
  const ext = cats.find((c) => c.key === 'extinguisher');
  const otherCat = (await api('/assets?category=extinguisher')).json[0];
  check(!ext || (await api(`/offline/failures/${fid}/retry`, { data: { assetId: otherCat.id } })).status === 400, 'Ersatz anderer Art abgelehnt');
  r = await api(`/offline/failures/${fid}/retry`, { data: { assetId: A4.id } });
  check(r.status === 200 && r.json.inspectionId, `erneut übertragen an ein anderes Element (${r.text})`);
  const done = (await api(`/inspections/${r.json.inspectionId}`)).json;
  check(done.status === 'submitted' && done.assetId === A4.id && done.signerName === 'Offline E2E' && /^data:image\/png;base64,/.test(done.signature ?? ''), 'Prüfung mit gespeicherter Unterschrift übernommen');
  const members = (await api('/account/members')).json.members;
  check(done.inspectorId === members.find((m) => m.email === 'pruefer@example.com').id, 'Prüfung bleibt der prüfenden Person zugeordnet');
  check(!(await api('/offline/failures')).json.some((x) => x.id === fid), 'erledigter Eintrag verschwindet');
  check((await api(`/offline/failures/${fid}/retry`, { data: {} })).status === 404, 'erledigter Eintrag nicht erneut versuchbar');

  step('Offline: Validierungsfehler, Größenbegrenzung, Löschen');
  const noSig = offBody(A4.id, { signature: null });
  r = await insp.api('/inspections/offline', { data: noSig });
  check(r.status === 400 && r.json.failureId && /Unterschrift/.test(r.json.error), `ohne Unterschrift abgelehnt und gemerkt (${r.text})`);
  const fid2 = r.json.failureId;
  r = await insp.api('/inspections/offline', { data: offBody(A4.id, { signature: null, junk: 'x'.repeat(300_000) }) });
  const big = (await insp.api('/offline/failures')).json.find((x) => x.id === r.json?.failureId);
  check(big && big.retryable === false, `zu große Daten nur mit Grund gemerkt (${JSON.stringify(big)})`);
  check((await insp.api(`/offline/failures/${big.id}/retry`, { data: {} })).status === 409, 'ohne Daten kein erneuter Versuch');
  check((await insp.api(`/offline/failures/${big.id}`, { method: 'DELETE' })).status === 200, 'eigenen Eintrag gelöscht');

  step('Offline-Seite: Übertragungen prüfen (Handy 390 px), Löschen mit Bestätigung');
  const mob = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true });
  const mp = await mob.newPage();
  mp.on('pageerror', (e) => errors.push(`mobil pageerror ${e.message}`));
  const lr = await mp.request.post(BASE + '/api/auth/login', { data: { email: 'pruefer@example.com', password: PW }, headers: { 'x-pk': '1' } });
  check(lr.status() === 200, 'mobil angemeldet');
  const wide = async (label) => {
    const wdt = await mp.evaluate(() => document.documentElement.scrollWidth);
    check(wdt <= 392, `${label}: kein horizontaler Überlauf (${wdt})`);
  };
  await mp.goto(`${BASE}/offline?tab=uebertragungen`);
  const row = mp.locator(`[data-failure="${fid2}"]`);
  await row.waitFor();
  check(/Unterschrift/.test(await row.innerText()), 'Grund in der Liste');
  await wide('/offline Übertragungen');
  await mp.screenshot({ path: OUT + '02-offline-uebertragungen-mobil.png' });
  await row.getByRole('button', { name: 'Löschen' }).click();
  await mp.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await mp.getByText('Übertragung gelöscht').waitFor();
  check(!(await insp.api('/offline/failures')).json.some((x) => x.id === fid2), 'über die Oberfläche gelöscht');

  // ---------------------------------------------------------------------------
  step('Partner-Zugang: Code erzeugen (nur Hash gespeichert), Sammelseite ohne interne Angaben');
  const subs = (await api('/subcontractors')).json;
  const sub = subs[0];
  check((await insp.api(`/subcontractors/${sub.id}/partner-code`, { data: {} })).status === 403, 'Prüfer erzeugt keinen Code');
  r = await api(`/subcontractors/${sub.id}/partner-code`, { data: {} });
  check(r.status === 200 && r.json.code?.length >= 40, 'Code erzeugt');
  const code = r.json.code;
  let s1 = (await api('/subcontractors')).json.find((x) => x.id === sub.id);
  check(s1.partnerAccess === true && s1.partnerUsedAt == null && !JSON.stringify(s1).includes(code), 'Liste zeigt Status, nicht den Code');
  const tk = (await api('/tasks', { data: { title: 'E2E Partner-Auftrag', description: 'Tür FST prüfen', subcontractorId: sub.id, priority: 'high', dueAt: Date.now() + 5 * DAY } })).json.id;
  await api(`/tasks/${tk}/comments`, { data: { body: 'GEHEIME-INTERNE-NOTIZ' } });
  const tk2 = (await api('/tasks', { data: { title: 'E2E Fremdfirma', subcontractorId: subs[1]?.id ?? null } })).json.id;
  let pub = await fetch(`${BASE}/api/public/partner/${code}`);
  let pj = await pub.json();
  const pt = pj.tasks.find((x) => x.title === 'E2E Partner-Auftrag');
  check(pub.status === 200 && pj.company === sub.company && !!pt?.ref, `Sammelseite liefert Aufträge (${pub.status})`);
  check(!pj.tasks.some((x) => x.title === 'E2E Fremdfirma') || !subs[1], 'Aufträge anderer Firmen fehlen');
  const raw = JSON.stringify(pj);
  check(!raw.includes('GEHEIME-INTERNE-NOTIZ') && !raw.includes(tk) && !/"(id|tenantId|assigneeId|createdBy|defectId|photoKey)"/.test(raw), 'keine internen Notizen, IDs oder Personen');
  s1 = null;
  for (let i = 0; i < 20 && !s1?.partnerUsedAt; i++) {
    s1 = (await api('/subcontractors')).json.find((x) => x.id === sub.id);
    if (!s1.partnerUsedAt) await new Promise((res) => setTimeout(res, 200));
  }
  check(!!s1.partnerUsedAt, 'zuletzt genutzt wird vermerkt');
  r = await fetch(`${BASE}/api/public/partner/${code}/tasks/${pt.ref}`);
  check(r.status === 200 && (await r.json()).title === 'E2E Partner-Auftrag', 'Auftrag einzeln abrufbar');
  check((await fetch(`${BASE}/api/public/partner/${code}/tasks/${'0'.repeat(20)}`)).status === 404, 'unbekannte Referenz → 404');
  r = await fetch(`${BASE}/api/public/partner/${code}/tasks/${pt.ref}`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'in_progress', note: 'Termin Montag' }) });
  check(r.status === 200, `Rückmeldung „in Arbeit“ (${r.status})`);
  const t1 = (await api('/tasks')).json.find((x) => x.id === tk);
  check(t1.status === 'in_progress' && t1.externalNote === 'Termin Montag', 'Status und Notiz übernommen');
  check((await api(`/tasks/${tk}/comments`)).json.some((x) => x.body === 'Termin Montag' && /extern/.test(x.authorName)), 'Notiz als externer Kommentar');
  check((await notes(owner)).some((n) => n.type === 'task_external'), 'Admins benachrichtigt');

  step('Partner-Seite im Browser (390 px): Liste, Auftrag öffnen, erledigt melden');
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errors.push(`partner pageerror ${e.message}`));
  await pp.goto(`${BASE}/partner/${code}`);
  await pp.getByRole('heading', { name: sub.company }).waitFor();
  check(!(await pp.content()).includes('GEHEIME-INTERNE-NOTIZ'), 'Seite ohne interne Notiz');
  let pw = await pp.evaluate(() => document.documentElement.scrollWidth);
  check(pw <= 392, `/partner Liste: kein horizontaler Überlauf (${pw})`);
  await pp.screenshot({ path: OUT + '03-partner-liste-mobil.png' });
  await pp.getByRole('link', { name: /E2E Partner-Auftrag/ }).click();
  await pp.getByRole('heading', { name: 'E2E Partner-Auftrag' }).waitFor();
  pw = await pp.evaluate(() => document.documentElement.scrollWidth);
  check(pw <= 392, `/partner Auftrag: kein horizontaler Überlauf (${pw})`);
  await pp.getByLabel('Rückmeldung').fill('Schließer getauscht');
  await pp.getByRole('button', { name: 'Als erledigt melden' }).click();
  await pp.getByText('Als erledigt gemeldet').waitFor();
  await pp.screenshot({ path: OUT + '04-partner-erledigt-mobil.png' });
  const t2 = (await api('/tasks')).json.find((x) => x.id === tk);
  check(t2.status === 'done' && t2.externalNote === 'Schließer getauscht', 'über die Seite erledigt gemeldet');
  pj = await (await fetch(`${BASE}/api/public/partner/${code}`)).json();
  check(!pj.tasks.some((x) => x.ref === pt.ref), 'erledigter Auftrag nicht mehr in der Liste');
  check((await fetch(`${BASE}/api/public/partner/${code}/tasks/${pt.ref}`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) })).status === 404, 'erledigter Auftrag nicht mehr beantwortbar');

  step('Verwaltung: Partner-Zugang über die Oberfläche (390 px), neu erzeugen, widerrufen');
  const actx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', hasTouch: true, isMobile: true });
  const ap = await actx.newPage();
  ap.on('pageerror', (e) => errors.push(`admin pageerror ${e.message}`));
  await ap.request.post(BASE + '/api/auth/login', { data: { email: 'demo@example.com', password: PW }, headers: { 'x-pk': '1' } });
  await ap.goto(`${BASE}/subunternehmer`);
  await ap.locator('[data-partner-status]').first().waitFor();
  check(/zuletzt genutzt/.test(await ap.locator('[data-partner-status]').first().innerText()), 'Liste zeigt „zuletzt genutzt“');
  pw = await ap.evaluate(() => document.documentElement.scrollWidth);
  check(pw <= 392, `/subunternehmer: kein horizontaler Überlauf (${pw})`);
  await ap.getByRole('button', { name: `Aktionen für ${sub.company}` }).click();
  await ap.getByRole('menuitem', { name: 'Neuen Partner-Link erzeugen' }).click();
  await ap.getByRole('dialog').getByRole('button', { name: 'Neu erzeugen' }).click();
  const linkField = ap.getByLabel('Partner-Link');
  await linkField.waitFor();
  const newLink = await linkField.inputValue();
  check(newLink.startsWith(`${BASE}/partner/`) && !newLink.endsWith(code), 'neuer Link angezeigt');
  pw = await ap.evaluate(() => document.documentElement.scrollWidth);
  check(pw <= 392, `Partner-Link-Dialog: kein horizontaler Überlauf (${pw})`);
  await ap.screenshot({ path: OUT + '05-partner-link-mobil.png' });
  await ap.getByRole('button', { name: 'Fertig' }).click();
  const newCode = newLink.split('/partner/')[1];
  check((await fetch(`${BASE}/api/public/partner/${code}`)).status === 404, 'alter Code nach Neuerzeugung ungültig');
  check((await fetch(`${BASE}/api/public/partner/${newCode}`)).status === 200, 'neuer Code gültig');
  await ap.getByRole('button', { name: `Aktionen für ${sub.company}` }).click();
  await ap.getByRole('menuitem', { name: 'Partner-Zugang widerrufen' }).click();
  await ap.getByRole('dialog').getByRole('button', { name: 'Widerrufen' }).click();
  await ap.getByText('Partner-Zugang widerrufen').first().waitFor();
  check((await fetch(`${BASE}/api/public/partner/${newCode}`)).status === 404, 'widerrufener Code → 404');
  check((await api('/subcontractors')).json.find((x) => x.id === sub.id).partnerAccess === false, 'Status widerrufen');
  await pp.goto(`${BASE}/partner/${newCode}`);
  await pp.getByText('Zugang ungültig').waitFor();
  await api(`/tasks/${tk2}`, { method: 'DELETE' });

  check(!errors.length, `Browserfehler: ${errors.join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
