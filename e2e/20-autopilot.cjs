// E2E 20-autopilot: Regeln mit Stufen (aus/vorschlagen/automatisch), Zuweisungsregeln für Mängel, wiederkehrende Aufgaben,
// Woche planen (Cron am Montag und auf Knopfdruck), Fristen eskalieren, offene Mängel nachhalten, Monatsberichte im Browser,
// Protokoll mit Rückgängig (Rechte, Bereich), Einstellungen → Automatik, Aufgabenformular, MCP, 390 px. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '20-autopilot') + '/';
fs.mkdirSync(OUT, { recursive: true });
const DAY = 86_400_000;
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

(async () => {
  if (process.env.PROD) throw new Error('20-autopilot nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const errors = [];
  const session = async (email, viewport = { width: 1360, height: 860 }) => {
    const ctx = await b.newContext({ viewport, locale: 'de-DE' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${email} pageerror ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[0134,9]/.test(m.text()) && errors.push(`${email} console ${m.text()}`));
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
  const { p, api } = owner;
  const members = (await api('/account/members')).json.members;
  const byMail = (m) => members.find((x) => x.email === m);
  const P1 = byMail('pruefer@example.com');
  const P2 = byMail('pruefer2@example.com');
  const V = byMail('lesen@example.com');
  const setMode = (key, mode) => api('/automation', { method: 'PUT', data: { key, mode } });
  const log = async (s = owner) => (await s.api('/automation/log?limit=200')).json;
  const tasks = async (s = owner) => (await s.api('/tasks')).json;
  let cronOk = true;
  const cron = async (time) => {
    const r = await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=15+5+*+*+*&time=${time}`);
    if (r.status === 404) cronOk = false;
    return r.status;
  };

  step('Regeln und Standardstufen');
  let rules = (await api('/automation')).json;
  const mode = (k) => rules.find((r) => r.key === k)?.mode;
  check(rules.length === 6, `6 Regeln (${rules.length})`);
  check(
    mode('plan_week') === 'suggest' && mode('assign_defect_tasks') === 'auto' && mode('escalate_sla') === 'suggest' && mode('recurring_tasks') === 'auto' && mode('close_stale') === 'suggest' && mode('monthly_report') === 'suggest',
    `Standardstufen (${rules.map((r) => `${r.key}=${r.mode}`)})`,
  );
  check(rules.every((r) => r.lastRunAt === null && r.title && r.description), 'Titel, Beschreibung, noch nicht ausgeführt');
  check(Array.isArray(rules.find((r) => r.key === 'assign_defect_tasks').config.rules), 'Admin sieht Zuweisungsregeln');
  const vRules = (await viewer.api('/automation')).json;
  check(vRules.length === 6 && vRules.every((r) => !('config' in r)), 'Lesezugriff sieht Stufen, keine Einstellungen');
  check((await viewer.api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'auto' } })).status === 403, 'Lesezugriff ändert nichts');
  check((await insp.api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'auto' } })).status === 403, 'Prüfer ändert nichts');
  check((await api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'immer' } })).status === 400, 'ungültige Stufe → 400');

  step('Vorschläge in Stufe „Vorschlagen“');
  let sugg = (await api('/smart/suggestions')).json;
  const planS = sugg.find((s) => s.automation === 'plan_week');
  check(planS?.kind === 'automation' && planS.action?.endpoint === '/automation/plan_week/run', `Vorschlag „Woche planen“ mit Aktion (${sugg.map((s) => s.id)})`);
  const monthS = sugg.find((s) => s.automation === 'monthly_report');
  const berlin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).format(Date.now()).split('-').map(Number);
  const prevM = berlin[1] === 1 ? 12 : berlin[1] - 1;
  const label = `${MONTHS[prevM - 1]} ${berlin[1] === 1 ? berlin[0] - 1 : berlin[0]}`;
  check(monthS?.title === `Monatsberichte ${label} bereit` && monthS.link === '/berichte?monatsbericht=1', `Vorschlag Monatsberichte (${monthS?.title})`);
  check(!(await insp.api('/smart/suggestions')).json.some((s) => s.automation === 'monthly_report'), 'Monatsberichte nur für Admins');
  check(!(await viewer.api('/smart/suggestions')).json.some((s) => s.kind === 'automation'), 'Lesezugriff ohne Autopilot-Aktionen');

  step('Mängel zuweisen: Regeln für Elementart und Schwere');
  const subs = (await api('/subcontractors')).json;
  const sub = subs[0];
  const assets = (await api('/assets')).json;
  const aDoor = assets.find((a) => a.category === 'fire_door');
  const aExt = assets.find((a) => a.category === 'extinguisher');
  check(!!sub && !!aDoor && !!aExt, 'Subunternehmer und Elemente vorhanden');
  let r = await api('/automation', { method: 'PUT', data: { key: 'assign_defect_tasks', config: { rules: [{ severities: ['high'], assigneeId: P1.id, subcontractorId: sub.id }] } } });
  check(r.status === 400, `Person und Firma zugleich abgelehnt (${r.status})`);
  r = await api('/automation', { method: 'PUT', data: { key: 'assign_defect_tasks', config: { rules: [{ severities: ['high'], assigneeId: V.id }] } } });
  check(r.status === 400, `Lesezugriff als Zuständige abgelehnt (${r.status})`);
  r = await api('/automation', { method: 'PUT', data: { key: 'plan_week', config: { rules: [] } } });
  check(r.status === 400, 'Einstellungen nur für Regeln mit Einstellungen');
  r = await api('/automation', {
    method: 'PUT',
    data: {
      key: 'assign_defect_tasks',
      config: {
        rules: [
          { category: 'fire_door', severities: ['critical'], subcontractorId: sub.id, days: 3 },
          { category: null, severities: ['medium'], assigneeId: P1.id, days: 5 },
        ],
      },
    },
  });
  check(r.status === 200 && r.json.config.rules.length === 2 && r.json.config.rules.every((x) => x.id), `Regeln gespeichert (${r.status} ${r.text.slice(0, 120)})`);
  const t0 = Date.now();
  r = await api('/defects', { data: { assetId: aDoor.id, title: 'Schließer defekt Autopilot', severity: 'critical', force: true } });
  check(r.json?.taskCreated === true, 'kritischer Mangel → Aufgabe');
  let all = await tasks();
  const subTask = all.find((t) => t.defectId === r.json.id);
  check(subTask?.subcontractorId === sub.id && !!subTask.shareToken && !subTask.assigneeId, `an Subunternehmer mit Link (${subTask?.subcontractorName})`);
  check(Math.abs(subTask.dueAt - (t0 + 3 * DAY)) < 60_000, 'Frist aus der Regel (3 Tage)');
  check(subTask.createdByName === 'Sabine Krüger', 'Anlegende Person bleibt erhalten');
  r = await api('/defects', { data: { assetId: aExt.id, title: 'Plombe fehlt Autopilot', severity: 'medium', force: true } });
  check(r.json?.taskCreated === true, 'mittlerer Mangel mit passender Regel → Aufgabe');
  all = await tasks();
  const p1Task = all.find((t) => t.defectId === r.json.id);
  check(p1Task?.assigneeId === P1.id && Math.abs(p1Task.dueAt - (t0 + 5 * DAY)) < 60_000, `an Prüfer mit 5 Tagen (${p1Task?.assigneeName})`);
  check((await insp.api('/notifications')).json.items.some((n) => n.type === 'task_assigned' && n.body === 'Vom Autopiloten zugewiesen'), 'Zuständiger benachrichtigt');
  r = await api('/defects', { data: { assetId: aExt.id, title: 'Etikett verblasst Autopilot', severity: 'low', force: true } });
  check(r.json?.taskCreated === false, 'geringer Mangel ohne Regel → keine Aufgabe');
  let entries = await log();
  const eSub = entries.find((e) => e.key === 'assign_defect_tasks' && e.summary.includes('Schließer defekt Autopilot'));
  const eP1 = entries.find((e) => e.key === 'assign_defect_tasks' && e.summary.includes('Plombe fehlt Autopilot'));
  check(eSub?.undoable && eSub.summary.includes(sub.company) && eSub.link === `/aufgaben?id=${subTask.id}`, `Protokoll mit Firma und Link (${eSub?.summary})`);
  check(eP1?.undoable && eP1.summary.includes(P1.name) && eP1.actorName === 'Sabine Krüger', `Protokoll mit Person (${eP1?.summary})`);
  const p1Log = await log(insp);
  check(p1Log.find((e) => e.id === eP1.id)?.undoable === true && p1Log.find((e) => e.id === eSub.id)?.undoable === false, 'Zuständiger darf nur eigene Zuweisung zurücknehmen');
  check((await insp.api(`/automation/log/${eSub.id}/undo`, { data: {} })).status === 403, 'fremde Zuweisung nicht rückgängig');
  r = await insp.api(`/automation/log/${eP1.id}/undo`, { data: {} });
  check(r.status === 200 && r.json.reverted === 1, `Zuständiger nimmt zurück (${r.status})`);
  check(!(await tasks()).some((t) => t.id === p1Task.id), 'Aufgabe entfernt');
  check((await insp.api(`/automation/log/${eP1.id}/undo`, { data: {} })).status === 409, 'zweimal rückgängig → 409');
  check((await log()).find((e) => e.id === eP1.id)?.undoneAt > 0, 'Eintrag als rückgängig markiert');

  step('Stufe „Aus“ und Schalter im Firmenprofil bleiben gleich');
  check((await setMode('assign_defect_tasks', 'off')).status === 200, 'auf Aus gestellt');
  check((await api('/account/me')).json.tenant.autoTasks === false, 'Firmenprofil: Schalter aus');
  r = await api('/defects', { data: { assetId: aDoor.id, title: 'Glas gesprungen Autopilot', severity: 'high', force: true } });
  check(r.json?.taskCreated === false, 'Aus → keine Aufgabe');
  check((await api('/automation/assign_defect_tasks/run', { data: {} })).status === 409, 'Ausführen bei „Aus“ → 409');
  const tenant = (await api('/account/me')).json.tenant;
  await api('/account/company', { method: 'PATCH', data: { name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, website: tenant.website, autoTasks: true } });
  rules = (await api('/automation')).json;
  check(mode('assign_defect_tasks') === 'auto', `Schalter im Firmenprofil setzt Automatisch (${mode('assign_defect_tasks')})`);

  step('Wiederkehrende Aufgaben (Automatisch)');
  const due = Date.UTC(2030, 0, 31, 9);
  r = await api('/tasks', { data: { title: 'Notbeleuchtung Sichtprüfung', recurrence: 'monthly', dueAt: due, assigneeId: P2.id } });
  check(r.status === 200, 'Aufgabe mit Wiederholung angelegt');
  const recId = r.json.id;
  let rec = (await tasks()).find((t) => t.id === recId);
  check(rec.recurrence === 'monthly', 'Wiederholung gespeichert');
  r = await api(`/tasks/${recId}`, { method: 'PATCH', data: { ...rec, status: 'done' } });
  check(r.json?.nextCreated === true, 'Erledigen meldet Folgeaufgabe');
  all = await tasks();
  const next = all.find((t) => t.recursFrom === recId);
  check(next?.status === 'open' && next.recurrence === 'monthly' && next.assigneeId === P2.id, 'Folgeaufgabe offen, gleiche Zuständige');
  check(new Date(next.dueAt).toISOString().slice(0, 10) === '2030-02-28', `Termin einen Monat später (${new Date(next?.dueAt).toISOString()})`);
  check((await insp2.api('/notifications')).json.items.some((n) => n.type === 'task_assigned'), 'Zuständige über Folgeaufgabe benachrichtigt');
  r = await api(`/tasks/${next.id}`, { method: 'PATCH', data: { ...next, status: 'in_progress' } });
  check(!(await tasks()).some((t) => t.recursFrom === next.id), 'nur beim Erledigen');
  const eRec = (await log()).find((e) => e.key === 'recurring_tasks');
  check(eRec?.summary.includes('Notbeleuchtung') && eRec.undoable, 'Protokolleintrag Folgeaufgabe');
  // Folgeaufgabe ist schon in Arbeit → Rückgängig behält sie, beendet aber die Reihe
  r = await api(`/automation/log/${eRec.id}/undo`, { data: {} });
  check(r.status === 200 && r.json.kept === 1, `in Arbeit befindliche Folgeaufgabe bleibt (${r.text})`);
  check((await tasks()).find((t) => t.id === recId).recurrence === null, 'Reihe endet nach Rückgängig');

  step('Wiederkehrende Aufgaben (Vorschlagen) und Mehrfachbearbeitung');
  await setMode('recurring_tasks', 'suggest');
  r = await api('/tasks', { data: { title: 'Rauchschutztüren Funktionstest', recurrence: 'quarterly', dueAt: due } });
  const rec2 = r.json.id;
  await api('/tasks/bulk', { data: { ids: [rec2], status: 'done' } });
  check(!(await tasks()).some((t) => t.recursFrom === rec2), 'Vorschlagen: keine Folgeaufgabe von selbst');
  sugg = (await api('/smart/suggestions')).json;
  const recS = sugg.find((s) => s.automation === 'recurring_tasks');
  check(recS?.count === 1 && recS.action?.label, 'Vorschlag „wiederkehrende Aufgaben erledigt“');
  r = await api(recS.action.endpoint, { data: recS.action.body ?? {} });
  check(r.status === 200 && r.json.created === 1, `Aktion legt Folgeaufgabe an (${r.text})`);
  check(new Date((await tasks()).find((t) => t.recursFrom === rec2)?.dueAt).toISOString().slice(0, 10) === '2030-04-30', 'vierteljährlich');
  await setMode('recurring_tasks', 'auto');

  step('Woche planen: Cron am Montag (Automatisch)');
  await setMode('plan_week', 'auto');
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  monday.setUTCHours(5, 15, 0, 0);
  const tuesday = monday.getTime() + DAY;
  await cron(tuesday);
  check(!(await tasks()).some((t) => t.buildingId && /^Rundgang /.test(t.title)), 'dienstags plant der Cron nicht');
  await cron(monday.getTime());
  let rounds = [];
  if (!cronOk) console.log('   (Cron-Endpunkt nur im Dev-Server – übersprungen)');
  else {
    rounds = (await tasks()).filter((t) => t.buildingId && /^Rundgang /.test(t.title));
    check(rounds.length > 0 && rounds.every((t) => t.kind === 'inspection' && t.status === 'open' && t.buildingName && t.propertyId), `Prüfaufträge je Gebäude (${rounds.length})`);
    check(rounds.every((t) => t.createdByName === 'Autopilot'), 'vom Autopiloten angelegt');
    check(rounds.some((t) => t.assigneeId), 'Zuständige = wer dort zuletzt geprüft hat');
    const ePlan = (await log()).filter((e) => e.key === 'plan_week');
    check(ePlan.length === rounds.length && ePlan.every((e) => e.actorName === 'Autopilot' && e.undoable), 'Protokoll je Gebäude');
    await cron(monday.getTime());
    check((await tasks()).filter((t) => t.buildingId && /^Rundgang /.test(t.title)).length === rounds.length, 'keine Dopplung bei offenem Auftrag');
    rules = (await api('/automation')).json;
    check(rules.find((x) => x.key === 'plan_week').lastRunAt > 0, '„Zuletzt ausgeführt“ gesetzt');
  }
  await setMode('plan_week', 'suggest');
  r = await api('/automation/plan_week/run', { data: {} });
  check(r.status === 200, `Ausführen auf Knopfdruck (${r.text})`);

  step('Zugriffsbereich: Prüferin auf ein Objekt beschränkt');
  const props = (await api('/properties')).json;
  const S = props.find((x) => x.name === 'Grundschule Am Stadtpark') ?? props[0];
  check((await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: { propertyIds: [S.id], buildingIds: [] }, canCreate: true } })).status === 200, 'Bereich gesetzt');
  const scopedLog = await log(insp2);
  const allLog = await log();
  check(scopedLog.length < allLog.length, `eingeschränkt sieht weniger (${scopedLog.length}/${allLog.length})`);
  const ownerTasks = await tasks();
  const linked = scopedLog.filter((e) => /^\/aufgaben\?id=/.test(e.link ?? '')).map((e) => ownerTasks.find((t) => t.id === e.link.split('=')[1])).filter(Boolean);
  check(linked.every((t) => t.propertyId === S.id || t.assigneeId === P2.id), 'nur Einträge im Bereich oder eigene Zuweisungen');
  const foreignPlan = allLog.find((e) => e.key === 'plan_week' && !scopedLog.some((x) => x.id === e.id));
  if (foreignPlan) check((await insp2.api(`/automation/log/${foreignPlan.id}/undo`, { data: {} })).status === 404, 'Rückgängig außerhalb des Bereichs → 404');
  if (rounds.length) {
    const r1 = rounds[0];
    const e1 = allLog.find((e) => e.link === `/aufgaben?id=${r1.id}`);
    r = await api(`/automation/log/${e1.id}/undo`, { data: {} });
    check(r.status === 200 && !(await tasks()).some((t) => t.id === r1.id), 'Admin nimmt geplanten Auftrag zurück');
  }
  await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: null, canCreate: true } });

  step('Fristen eskalieren (Cron, Automatisch)');
  r = await api('/tasks', { data: { title: 'Wartungsprotokoll anfordern', priority: 'low', dueAt: Date.now() - 2 * DAY, assigneeId: P1.id } });
  const lateId = r.json.id;
  sugg = (await api('/smart/suggestions')).json;
  check(sugg.some((s) => s.automation === 'escalate_sla' && s.tone === 'warn'), 'Vorschlag „über der Frist“');
  await setMode('escalate_sla', 'auto');
  await cron(Date.now());
  if (cronOk) {
    check((await tasks()).find((t) => t.id === lateId)?.priority === 'high', 'Priorität auf Hoch');
    check((await api('/notifications')).json.items.some((n) => n.title === 'Frist überschritten: Wartungsprotokoll anfordern'), 'Admins benachrichtigt');
    const eEsc = (await log()).find((e) => e.key === 'escalate_sla' && e.summary.includes('Wartungsprotokoll'));
    r = await api(`/automation/log/${eEsc.id}/undo`, { data: {} });
    check(r.status === 200 && (await tasks()).find((t) => t.id === lateId)?.priority === 'low', 'Rückgängig stellt Priorität wieder her');
    await cron(Date.now());
    check((await tasks()).find((t) => t.id === lateId)?.priority === 'low', 'nach Rückgängig keine erneute Eskalation');
  }
  await setMode('escalate_sla', 'suggest');

  step('Offene Mängel nachhalten (Cron in 15 Tagen)');
  r = await api('/defects', { data: { assetId: aExt.id, title: 'Halterung lose Autopilot', severity: 'high', force: true } });
  const stale = (await tasks()).find((t) => t.defectId === r.json.id);
  await api(`/tasks/${stale.id}`, { method: 'PATCH', data: { ...stale, assigneeId: P1.id, status: 'done', resolveDefect: false } });
  await setMode('close_stale', 'auto');
  await cron(Date.now() + 15 * DAY);
  if (cronOk) {
    check((await insp.api('/notifications')).json.items.some((n) => n.type === 'automation' && n.title.includes('Halterung lose Autopilot')), 'Zuständiger erinnert');
    const eStale = (await log()).find((e) => e.key === 'close_stale');
    check(eStale && !eStale.undoable, 'Erinnerung im Protokoll, nicht rückgängig');
    await cron(Date.now() + 16 * DAY);
    check((await log()).filter((e) => e.key === 'close_stale' && e.summary.includes('Halterung')).length === 1, 'nur einmal erinnert');
  }
  await setMode('close_stale', 'suggest');

  step('Monatsberichte (Vorschlagen): ein Klick erzeugt und archiviert alle');
  let ms = (await api('/automation/monthly-report')).json;
  check(ms.due === true && ms.label === label && ms.properties === props.length, `Status bereit (${JSON.stringify(ms)})`);
  check((await insp.api('/automation/monthly-report')).status === 403, 'Status nur für Admins');
  await p.goto(BASE + '/berichte?monatsbericht=1');
  await p.getByText(new RegExp(`Monatsberichte ${label} im Archiv`)).first().waitFor({ timeout: 60_000 });
  let reps = (await api('/reports')).json.filter((x) => x.title.startsWith('Monatsbericht '));
  check(reps.length === props.length && reps.every((x) => x.title.endsWith(label) && x.propertyId), `je Objekt ein Bericht (${reps.length}/${props.length})`);
  const pdf = await p.request.get(`${BASE}/api/reports/${reps[0].id}/file`);
  check(pdf.status() === 200 && (await pdf.body()).subarray(0, 4).toString() === '%PDF', 'PDF im Archiv');
  ms = (await api('/automation/monthly-report')).json;
  check(ms.due === false, 'danach nicht mehr fällig');
  check((await api('/automation/monthly-report/claim', { data: {} })).status === 409, 'zweite Reservierung → 409');
  check(!(await api('/smart/suggestions')).json.some((s) => s.automation === 'monthly_report'), 'Vorschlag verschwindet');
  const eMonth = (await log()).find((e) => e.key === 'monthly_report');
  check(eMonth?.summary === `${props.length === 1 ? 'Ein Monatsbericht' : `${props.length} Monatsberichte`} ${label} archiviert` && eMonth.undoable, `Protokoll (${eMonth?.summary})`);
  r = await api(`/automation/log/${eMonth.id}/undo`, { data: {} });
  check(r.status === 200 && !(await api('/reports')).json.some((x) => x.title.startsWith('Monatsbericht ')), 'Rückgängig löscht die Berichte');
  check((await api('/automation/monthly-report')).json.due === true, 'danach wieder fällig');

  step('Monatsberichte (Automatisch): beim Öffnen der App im Hintergrund');
  await setMode('monthly_report', 'auto');
  const p2 = await owner.ctx.newPage();
  await p2.goto(BASE + '/');
  let bg = 0;
  for (let i = 0; i < 60 && bg < props.length; i++) {
    bg = (await api('/reports')).json.filter((x) => x.title.startsWith('Monatsbericht ')).length;
    if (bg < props.length) await p2.waitForTimeout(500);
  }
  check(bg === props.length, `im Hintergrund erzeugt (${bg})`);
  await p2.close();
  await setMode('monthly_report', 'suggest');

  step('Einstellungen → Automatik');
  await p.goto(BASE + '/einstellungen?tab=automation');
  await p.getByRole('tab', { name: 'Automatik', selected: true }).waitFor();
  const row = p.locator('[data-automation="close_stale"]');
  await row.getByText('Offene Mängel nachhalten').waitFor();
  check(await row.getByRole('tab', { name: 'Vorschlagen', selected: true }).isVisible(), 'Stufe als Segmented');
  await row.getByRole('tab', { name: 'Automatisch' }).click();
  await p.getByText('Offene Mängel nachhalten: Automatisch').first().waitFor();
  rules = (await api('/automation')).json;
  check(mode('close_stale') === 'auto', 'Stufe per Klick gespeichert');
  check((await p.locator('[data-automation="plan_week"]').getByText(/Zuletzt ausgeführt/).count()) === 1, '„Zuletzt ausgeführt“ sichtbar');
  // Zuweisungsregeln bearbeiten
  const ruleList = p.getByRole('list', { name: 'Zuweisungsregeln' });
  await ruleList.waitFor();
  check((await ruleList.locator('[data-rule]').count()) === 2, 'gespeicherte Regeln angezeigt');
  await p.getByRole('button', { name: 'Regel hinzufügen' }).click();
  check(await p.getByRole('button', { name: 'Regeln speichern' }).isDisabled(), 'ohne Zuständige nicht speicherbar');
  await p.getByLabel('Elementart Regel 3').selectOption('damper');
  await p.getByLabel('Schwere Regel 3').selectOption('critical');
  await p.getByLabel('Zuständig Regel 3').selectOption(`u:${P2.id}`);
  await p.getByLabel('Frist in Tagen Regel 3').fill('2');
  await p.getByRole('button', { name: 'Regeln speichern' }).click();
  await p.getByText('Zuweisungsregeln gespeichert').first().waitFor();
  const saved = (await api('/automation')).json.find((x) => x.key === 'assign_defect_tasks').config.rules;
  check(saved.length === 3 && saved[2].category === 'damper' && saved[2].assigneeId === P2.id && saved[2].days === 2 && saved[2].severities.join() === 'critical', `neue Regel gespeichert (${JSON.stringify(saved[2])})`);
  // Protokoll mit Rückgängig
  const logList = p.getByRole('list', { name: 'Autopilot-Protokoll' });
  await logList.waitFor();
  check((await logList.getByText('rückgängig gemacht', { exact: false }).count()) > 0, 'zurückgenommene Einträge markiert');
  const undoBtn = logList.locator('li', { hasText: 'Schließer defekt Autopilot' }).getByRole('button', { name: 'Rückgängig' });
  await undoBtn.click();
  await p.getByText(/^Rückgängig gemacht/).first().waitFor();
  check(!(await tasks()).some((t) => t.id === subTask.id), 'Rückgängig über die Oberfläche');
  await p.screenshot({ path: OUT + '01-automatik.png', fullPage: true });
  check((await viewer.api('/automation/log')).status === 200, 'Protokoll für alle Rollen lesbar');
  await viewer.p.goto(BASE + '/einstellungen?tab=automation');
  await viewer.p.getByRole('tab', { name: 'Konto', selected: true }).waitFor();
  check((await viewer.p.getByRole('tab', { name: 'Automatik' }).count()) === 0, 'Reiter nur für Admins');

  step('Aufgabenformular: Wiederholung');
  await p.goto(BASE + '/aufgaben');
  await p.getByRole('button', { name: 'Neue Aufgabe' }).first().click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Titel').fill('Feuerlöscher Sichtkontrolle UI');
  await dlg.getByLabel('Wiederholen').selectOption('yearly');
  await dlg.getByRole('button', { name: 'Aufgabe anlegen' }).click();
  await p.getByText('Aufgabe angelegt').first().waitFor();
  check((await tasks()).find((t) => t.title === 'Feuerlöscher Sichtkontrolle UI')?.recurrence === 'yearly', 'Wiederholung aus dem Formular');
  const panelRec = p.getByRole('dialog').last().getByLabel('Wiederholen');
  await panelRec.waitFor();
  check((await panelRec.inputValue()) === 'yearly', 'Detail zeigt Wiederholung');
  await p.keyboard.press('Escape');

  step('MCP-Werkzeuge');
  const key = (await api('/account/api-keys', { data: { name: 'Autopilot MCP', scope: 'write', expiresInDays: 1 } })).json.key;
  const mcp = async (name, args = {}) => {
    const res = await fetch(BASE + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const j = await res.json();
    const out = j.result;
    return { isError: out?.isError, data: out && !out.isError ? JSON.parse(out.content[0].text) : null, text: out?.content?.[0]?.text };
  };
  let t = await mcp('list_automations');
  check(Array.isArray(t.data) && t.data.length === 6, 'list_automations');
  t = await mcp('list_automation_log', { key: 'plan_week', limit: 5 });
  check(Array.isArray(t.data) && t.data.length <= 5 && t.data.every((e) => e.key === 'plan_week'), `list_automation_log (${t.text?.slice(0, 80)})`);
  t = await mcp('set_automation', { key: 'plan_week', mode: 'auto' });
  check(t.isError === true && /Berechtigung/.test(t.text), `set_automation mit Schlüssel → keine Berechtigung (${t.text})`);

  step('Handybreite 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await owner.ctx.storageState() });
  const mp = await m.newPage();
  const wide = async (lbl) => {
    const w = await mp.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 392, `${lbl}: kein horizontaler Überlauf (${w})`);
  };
  await mp.goto(BASE + '/einstellungen?tab=automation');
  await mp.getByRole('list', { name: 'Autopilot-Protokoll' }).waitFor();
  await wide('Einstellungen → Automatik');
  await mp.screenshot({ path: OUT + '02-mobile-automatik.png', fullPage: true });
  await mp.goto(BASE + '/aufgaben');
  await mp.getByRole('button', { name: 'Neue Aufgabe' }).first().click();
  await mp.getByRole('dialog').getByLabel('Wiederholen').waitFor();
  await wide('Aufgabenformular');
  await mp.goto(BASE + '/berichte');
  await mp.getByText('Monatsberichte').first().waitFor();
  await wide('/berichte mit Monatsberichten');
  await m.close();

  check(!errors.length, `Browserfehler: ${errors.join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
