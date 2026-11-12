// E2E 20-autopilot: der Kreislauf aus sechs Schritten (Planen · Zuweisen · Nachhalten · Nachprüfen · Lernen · Nachweisen)
// mit Stufen und Hauptschalter, Zuweisungsregeln, Wiederholung als Eigenschaft der Aufgabe, Planen (Cron am Montag),
// Wochenzusammenfassung, Nachhalten, der geschlossene Kreis (Partner „erledigt“ → Nachprüf-Auftrag → Nachprüfung → behoben
// bzw. Behebung wieder offen), „Jetzt“ (GET /now, eine Aktion je Zeile, Bereich), Monatsberichte im Browser, Protokoll mit
// Rückgängig (Rechte, Bereich), Einstellungen → Automatik als Ablauf, Aufgabenformular, MCP, 390 px. Nur lokal.
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
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
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

  step('Kreislauf: sechs Schritte, Standardstufen, Hauptschalter');
  let rules = (await api('/automation')).json;
  const mode = (k) => rules.find((r) => r.key === k)?.mode;
  check(rules.length === 6, `6 Schritte (${rules.length})`);
  check(
    rules.map((r) => `${r.step}:${r.key}:${r.title}`).join() ===
      '1:plan_week:Planen,2:assign_defect_tasks:Zuweisen,3:escalate_sla:Nachhalten,4:verify_repairs:Nachprüfen,5:adapt_intervals:Lernen,6:monthly_report:Nachweisen',
    `Reihenfolge und Namen (${rules.map((r) => `${r.step}:${r.title}`)})`,
  );
  check(
    mode('plan_week') === 'auto' && mode('assign_defect_tasks') === 'auto' && mode('escalate_sla') === 'auto' && mode('verify_repairs') === 'auto' && mode('adapt_intervals') === 'suggest' && mode('monthly_report') === 'suggest',
    `Standardstufen laut Plan (${rules.map((r) => `${r.key}=${r.mode}`)})`,
  );
  check(rules.every((r) => r.lastRunAt === null && r.title && r.description && r.effectiveMode === r.mode), 'Titel, Satz, noch nie, wirksam = gespeichert');
  check(Array.isArray(rules.find((r) => r.key === 'assign_defect_tasks').config.rules), 'Admin sieht Zuweisungsregeln');
  check((await api('/automation/autopilot')).json.enabled === true, 'Autopilot ist standardmäßig an');
  const vRules = (await viewer.api('/automation')).json;
  check(vRules.length === 6 && vRules.every((r) => !('config' in r)), 'Lesezugriff sieht Stufen, keine Einstellungen');
  check((await viewer.api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'auto' } })).status === 403, 'Lesezugriff ändert nichts');
  check((await insp.api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'auto' } })).status === 403, 'Prüfer ändert nichts');
  check((await api('/automation', { method: 'PUT', data: { key: 'plan_week', mode: 'immer' } })).status === 400, 'ungültige Stufe → 400');
  // Frühere Schlüssel bleiben gültig: close_stale ist in „Nachhalten“ aufgegangen, Wiederholung ist kein Schritt mehr
  check((await setMode('close_stale', 'suggest')).json?.key === 'escalate_sla' && (await api('/automation')).json.find((r) => r.key === 'escalate_sla').mode === 'suggest', 'close_stale → Nachhalten');
  check((await setMode('recurring_tasks', 'off')).status === 400, 'Wiederholung lässt sich nicht abschalten (400)');
  await setMode('escalate_sla', 'auto');

  step('Vorschläge in Stufe „Vorschlagen“');
  await setMode('plan_week', 'suggest');
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

  step('Stufe „Aus“; früherer Schalter autoTasks (API) bleibt im Gleichklang');
  check((await setMode('assign_defect_tasks', 'off')).status === 200, 'auf Aus gestellt');
  check((await api('/account/me')).json.tenant.autoTasks === false, 'Firmenprofil: Schalter aus');
  r = await api('/defects', { data: { assetId: aDoor.id, title: 'Glas gesprungen Autopilot', severity: 'high', force: true } });
  check(r.json?.taskCreated === false, 'Aus → keine Aufgabe');
  check((await api('/automation/assign_defect_tasks/run', { data: {} })).status === 409, 'Ausführen bei „Aus“ → 409');
  const tenant = (await api('/account/me')).json.tenant;
  await api('/account/company', { method: 'PATCH', data: { name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, website: tenant.website, autoTasks: true } });
  rules = (await api('/automation')).json;
  check(mode('assign_defect_tasks') === 'auto', `Schalter im Firmenprofil setzt Automatisch (${mode('assign_defect_tasks')})`);

  step('Wiederholung: Eigenschaft der Aufgabe, läuft immer');
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

  step('Wiederholung über die Mehrfachbearbeitung – auch bei ausgeschaltetem Autopiloten');
  check((await api('/automation/autopilot', { method: 'PUT', data: { enabled: false } })).status === 200, 'Autopilot aus');
  r = await api('/tasks', { data: { title: 'Rauchschutztüren Funktionstest', recurrence: 'quarterly', dueAt: due } });
  const rec2 = r.json.id;
  await api('/tasks/bulk', { data: { ids: [rec2], status: 'done' } });
  check(new Date((await tasks()).find((t) => t.recursFrom === rec2)?.dueAt).toISOString().slice(0, 10) === '2030-04-30', 'Folgeaufgabe vierteljährlich, ohne Schritt');
  check(!(await api('/smart/suggestions')).json.some((s) => s.kind === 'automation'), 'kein Vorschlag mehr für Wiederholungen');
  await api('/automation/autopilot', { method: 'PUT', data: { enabled: true } });

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
    // Montags eine Meldung „Autopilot: letzte Woche“ statt Einzelmeldungen, einmal je Tag, nur an Inhaber/Admins
    const weekly = (s) => s.api('/notifications').then((x) => x.json.items.filter((n) => n.title === 'Autopilot: letzte Woche'));
    const w1 = await weekly(owner);
    check(w1.length === 1 && /Zuweisen \d+/.test(w1[0].body) && w1[0].link === '/einstellungen?tab=automation', `Wochenzusammenfassung (${JSON.stringify(w1[0])})`);
    check((await weekly(insp)).length === 0, 'Prüfer bekommt keine Zusammenfassung');
    check((await weekly(owner)).length === 1, 'zweiter Lauf am selben Montag: keine zweite Meldung');
    await cron(tuesday + DAY);
    check((await weekly(owner)).length === 1, 'nicht an anderen Tagen');
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
  await setMode('escalate_sla', 'suggest');
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

  step('Nachhalten: Erinnerung, wenn ein Mangel nach der Behebung offen bleibt (ohne Nachprüfen, Cron in 15 Tagen)');
  await setMode('verify_repairs', 'off');
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
    check((await api('/automation/log?key=escalate_sla&limit=200')).json.some((e) => e.id === eStale.id && e.title === 'Nachhalten'), 'Erinnerung gehört zum Schritt „Nachhalten“');
  }
  await setMode('close_stale', 'suggest');
  await setMode('verify_repairs', 'auto');

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

  step('Lernen (Prüfintervalle): Schritt 5 im Autopiloten (eine Quelle mit tenants.adapt_intervals_mode), Protokoll, Rückgängig');
  const cps = (await api('/categories')).json.find((c) => c.key === 'smoke_alarm').checkpoints;
  const smoke = (await api('/assets?category=smoke_alarm')).json;
  const calm = [];
  for (const a of smoke) if (calm.length < 2 && a.lastResult === 'ok' && !(await api(`/smart/intervals?assetId=${a.id}`)).json.suggestions.length) calm.push(a);
  check(calm.length === 2, `zwei Rauchmelder ohne Vorschlag (${calm.length})`);
  const [I1, I2] = calm;
  const inspectSmoke = async (assetId, defect) => {
    const iid = (await api(`/assets/${assetId}/inspections`, { data: {} })).json.id;
    const res = await api(`/inspections/${iid}/submit`, {
      data: {
        kinds: ['periodic'],
        answers: Object.fromEntries(cps.map((cp, i) => [cp.id, defect && i === 0 ? 'defect' : 'ok'])),
        defects: defect ? [{ checkpointId: cps[0].id, title: cps[0].label, note: '', measure: '', severity: 'low' }] : [],
        signature: SIG,
        signerName: 'E2E',
      },
    });
    if (res.status !== 200) throw new Error(`Abschluss ${res.status} ${res.text}`);
  };
  const sched = async (id) => (await api(`/assets/${id}`)).json.schedules.main;
  rules = (await api('/automation')).json;
  const adapt = rules.find((x) => x.key === 'adapt_intervals');
  check(adapt?.mode === 'suggest' && adapt.adminOnly && adapt.title === 'Lernen' && adapt.step === 5, `Schritt registriert (${JSON.stringify(adapt)})`);
  check((await insp.api('/automation', { method: 'PUT', data: { key: 'adapt_intervals', mode: 'auto' } })).status === 403, 'Prüfer ändert die Stufe nicht');
  check((await setMode('adapt_intervals', 'off')).status === 200 && (await api('/account/me')).json.tenant.adaptIntervalsMode === 'off', 'Automatik schreibt tenants.adapt_intervals_mode');
  const tn = (await api('/account/me')).json.tenant;
  await api('/account/company', { method: 'PATCH', data: { name: tn.name, address: tn.address, phone: tn.phone, email: tn.email, website: tn.website, adaptIntervalsMode: 'auto' } });
  rules = (await api('/automation')).json;
  check(mode('adapt_intervals') === 'auto', `Firmenprofil und Automatik zeigen dieselbe Stufe (${mode('adapt_intervals')})`);
  check((await api('/automation/adapt_intervals/run', { data: {} })).status === 400, 'Ausführen auf Knopfdruck → 400 (Vorschläge einzeln)');
  // Automatisch: beim zweiten Abschluss mit Mangel verkürzt und protokolliert
  await inspectSmoke(I1.id, true);
  await inspectSmoke(I1.id, true);
  check((await sched(I1.id)).intervalMonths === 6, 'automatisch auf 6 Monate verkürzt');
  const eAuto = (await log()).find((e) => e.key === 'adapt_intervals' && e.summary.startsWith(I1.code));
  check(eAuto?.undoable && /automatisch/.test(eAuto.summary) && eAuto.actorName === 'Autopilot' && eAuto.link === `/elemente/${I1.id}` && eAuto.title === 'Lernen', `Protokolleintrag automatisch (${JSON.stringify(eAuto)})`);
  check(!(await log(insp)).find((e) => e.id === eAuto.id)?.undoable, 'Prüfer nimmt Intervall nicht zurück');
  r = await api(`/automation/log/${eAuto.id}/undo`, { data: {} });
  let ist = await sched(I1.id);
  check(r.status === 200 && r.json.reverted === 1 && ist.intervalMonths == null && ist.nextDueAt === addMonths(ist.lastAt, 12), `Rückgängig → wieder 12 Monate (${r.text} ${JSON.stringify(ist)})`);
  // Vorschlagen: übernommener Vorschlag steht im Protokoll
  await setMode('adapt_intervals', 'suggest');
  await inspectSmoke(I2.id, true);
  await inspectSmoke(I2.id, true);
  check((await api('/smart/suggestions')).json.some((x) => x.kind === 'interval'), 'Intervall-Vorschlag auf „Heute“');
  r = await api('/smart/intervals/apply', { data: { assetId: I2.id, schedule: 'main', months: 6 } });
  check(r.status === 200 && (await sched(I2.id)).intervalMonths === 6, `Vorschlag übernommen (${r.text})`);
  const eSug = (await log()).find((e) => e.key === 'adapt_intervals' && e.summary.startsWith(I2.code));
  check(eSug?.undoable && !/automatisch/.test(eSug.summary) && eSug.actorName === 'Sabine Krüger', `Protokolleintrag übernommen (${JSON.stringify(eSug)})`);

  step('„Heute“: Erledigt für dich (letzte 5 Protokolleinträge, Rückgängig, Link zur Automatik)');
  await p.goto(BASE + '/');
  const done = p.locator('#erledigt');
  await done.getByRole('heading', { name: 'Erledigt für dich' }).waitFor();
  // „Jetzt“ liest GET /now: dieselben Zeilen, je Zeile genau ein Knopf
  const nowRows = p.getByRole('list', { name: 'Jetzt' }).locator(':scope > li');
  const apiNow = (await api('/now')).json;
  check((await nowRows.count()) === apiNow.items.length, `„Jetzt“ zeigt /now (${await nowRows.count()}/${apiNow.items.length})`);
  for (let i = 0; i < (await nowRows.count()); i++) check((await nowRows.nth(i).getByRole('button').count()) === 1, `Jetzt-Zeile ${i + 1}: genau eine Aktion`);
  const doneItems = done.getByRole('list', { name: 'Erledigt für dich' }).locator('li');
  const latest = (await api('/automation/log?limit=5')).json;
  check((await doneItems.count()) === latest.length && latest.length > 0, `zeigt die letzten Einträge (${await doneItems.count()}/${latest.length})`);
  check((await done.getByRole('link', { name: 'Alle', exact: true }).getAttribute('href')) === '/einstellungen?tab=automation', '„Alle“ führt zu Einstellungen → Automatik');
  // Cron-Läufe mit Zeitpunkten in der Zukunft stehen oben – daher den ersten Eintrag mit „Rückgängig“ nehmen
  const undoRow = doneItems.filter({ has: p.getByRole('button', { name: 'Rückgängig' }) }).first();
  const undoId = await undoRow.getAttribute('data-log');
  check(latest.find((e) => e.id === undoId)?.undoable === true, 'Knopf nur bei rückgängig zu machenden Einträgen');
  await undoRow.getByRole('button', { name: 'Rückgängig' }).click();
  await p.getByText(/^Rückgängig gemacht/).first().waitFor();
  const rowAfter = done.locator(`li[data-log="${undoId}"]`);
  await rowAfter.locator('.line-through').waitFor();
  check((await rowAfter.getByRole('button', { name: 'Rückgängig' }).count()) === 0, 'Eintrag danach durchgestrichen, ohne Knopf');
  check((await log()).find((e) => e.id === undoId)?.undoneAt > 0, 'über „Heute“ zurückgenommen');
  r = await api(`/automation/log/${eSug.id}/undo`, { data: {} });
  check(r.status === 200 && (await sched(I2.id)).intervalMonths == null, `übernommener Vorschlag zurückgenommen (${r.text})`);
  await done.getByRole('link', { name: 'Alle', exact: true }).click();
  await p.getByRole('tab', { name: 'Automatik', selected: true }).waitFor();
  await viewer.p.goto(BASE + '/');
  await viewer.p.locator('#erledigt').getByRole('heading', { name: 'Erledigt für dich' }).waitFor();
  check((await viewer.p.locator('#erledigt').getByRole('link', { name: 'Alle', exact: true }).count()) === 0, 'Lesezugriff: kein Link zur Automatik');
  check((await viewer.p.locator('#erledigt').getByRole('button', { name: 'Rückgängig' }).count()) === 0, 'Lesezugriff: kein Rückgängig');

  step('Einstellungen → Automatik');
  await p.goto(BASE + '/einstellungen?tab=automation');
  await p.getByRole('tab', { name: 'Automatik', selected: true }).waitFor();
  const cycle = p.getByRole('list', { name: 'Kreislauf' });
  await cycle.waitFor();
  check((await cycle.locator(':scope > li').count()) === 6, 'Kreislauf mit sechs Schritten');
  check((await cycle.locator(':scope > li h3').allTextContents()).join() === 'Planen,Zuweisen,Nachhalten,Nachprüfen,Lernen,Nachweisen', 'Schritte in Reihenfolge');
  check((await cycle.locator('[data-automation="assign_defect_tasks"]').getByRole('list', { name: 'Zuweisungsregeln' }).count()) === 1, 'Zuweisungsregeln in Schritt 2');
  const row = p.locator('[data-automation="escalate_sla"]');
  await row.getByText('Nachhalten', { exact: true }).waitFor();
  check(await row.getByRole('tab', { name: 'Vorschlagen', selected: true }).isVisible(), 'Stufe als Segmented');
  await row.getByRole('tab', { name: 'Automatisch' }).click();
  await p.getByText('Nachhalten: Automatisch').first().waitFor();
  rules = (await api('/automation')).json;
  check(mode('escalate_sla') === 'auto', 'Stufe per Klick gespeichert');
  check((await p.locator('[data-automation="plan_week"]').getByText(/^zuletzt /).count()) === 1, '„zuletzt …“ sichtbar');
  // Hauptschalter: aus → Schritte ruhen, Stufen bleiben gemerkt; wieder an
  const master = p.getByRole('region', { name: 'Autopilot' }).getByRole('switch');
  await master.click();
  await p.getByText('Autopilot aus').first().waitFor();
  check((await api('/automation/autopilot')).json.enabled === false, 'Hauptschalter über die Oberfläche aus');
  await p.locator('[data-automation="plan_week"]').getByText('ruht').waitFor();
  check((await api('/automation')).json.every((x) => x.effectiveMode === 'off') && (await api('/automation')).json.find((x) => x.key === 'escalate_sla').mode === 'auto', 'Stufen gemerkt, wirksam „Aus“');
  await master.click();
  await p.getByText('Autopilot an').first().waitFor();
  check((await api('/automation/autopilot')).json.enabled === true, 'wieder an');
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

  step('Begehung: Feststellungen bekommen Aufgaben wie Prüfungsmängel (Regeln, Protokoll)');
  rules = (await api('/automation')).json;
  check(mode('assign_defect_tasks') === 'auto', 'Mängel zuweisen steht auf Automatisch');
  const wProp = (await api('/properties')).json[0];
  const wid = (await api(`/properties/${wProp.id}/walkthroughs`, { data: { purpose: 'extraordinary' } })).json.id;
  const wk = (await api(`/walkthroughs/${wid}`)).json;
  const [wq1, wq2] = wk.questions;
  r = await api(`/walkthroughs/${wid}/submit`, {
    data: {
      answers: Object.fromEntries(wk.questions.map((q) => [q.id, q === wq1 || q === wq2 ? 'defect' : 'ok'])),
      findings: [
        { questionId: wq1.id, title: 'Fluchtweg zugestellt Autopilot', note: '', measure: 'Paletten entfernen', severity: 'medium' },
        { questionId: wq2.id, title: 'Aushang veraltet Autopilot', note: '', severity: 'low' },
      ],
      signature: SIG,
      signerName: 'E2E',
    },
  });
  check(r.status === 200, `Begehung abgeschlossen (${r.status} ${r.text.slice(0, 120)})`);
  const wDefects = (await api('/defects?status=all&source=walkthrough')).json.filter((d) => d.walkthroughId === wid);
  const wMedium = wDefects.find((d) => d.title === 'Fluchtweg zugestellt Autopilot');
  const wLow = wDefects.find((d) => d.title === 'Aushang veraltet Autopilot');
  all = await tasks();
  const wTask = all.find((t) => t.defectId === wMedium?.id);
  check(wTask?.kind === 'defect' && wTask.assigneeId === P1.id && wTask.propertyId === wProp.id, `Feststellung (mittel) → Aufgabe an Prüfer nach Regel (${wTask?.title})`);
  check(wTask && Math.abs(wTask.dueAt - Date.now() - 5 * DAY) < 120_000, 'Frist aus der Regel (5 Tage)');
  check(!all.some((t) => t.defectId === wLow?.id), 'geringe Feststellung ohne Regel → keine Aufgabe');
  const eWalk = (await log()).find((e) => e.key === 'assign_defect_tasks' && e.link === `/aufgaben?id=${wTask?.id}`);
  check(eWalk?.undoable && eWalk.summary.includes('Paletten entfernen') && eWalk.summary.includes(P1.name), `Protokolleintrag zur Begehung (${eWalk?.summary})`);
  // Zugriffsbereich: eingeschränkte Prüferin außerhalb des Objekts sieht weder Aufgabe noch Eintrag
  const otherProp = (await api('/properties')).json.find((x) => x.id !== wProp.id);
  await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: { propertyIds: [otherProp.id], buildingIds: [] }, canCreate: true } });
  check(!(await tasks(insp2)).some((t) => t.id === wTask?.id), 'Aufgabe außerhalb des Bereichs unsichtbar');
  check(!(await log(insp2)).some((e) => e.id === eWalk?.id), 'Protokolleintrag außerhalb des Bereichs unsichtbar');
  await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: null, canCreate: true } });

  step('Rundgang schließt sich, wenn im Gebäude nichts mehr fällig ist');
  await api('/automation/plan_week/run', { data: {} });
  const allAssets = (await api('/assets')).json;
  const dueIn = (t) => allAssets.filter((a) => a.buildingId === t.buildingId && a.nextDueAt != null && a.nextDueAt < t.createdAt + 14 * DAY);
  const openRounds = (await tasks()).filter((t) => t.buildingId && /^Rundgang /.test(t.title) && t.status === 'open' && dueIn(t).length > 0);
  const round = openRounds.sort((x, y) => dueIn(x).length - dueIn(y).length)[0];
  check(!!round, `offener Rundgang vorhanden (${openRounds.length})`);
  if (round) {
    const queue = dueIn(round).map((a) => a.id);
    const inspectAll = async (assetId) => {
      // so oft prüfen, bis das Element nicht mehr im Planungsfenster fällig ist (mehrere Prüfpläne möglich)
      for (let k = 0; k < 4; k++) {
        const a = (await api(`/assets/${assetId}`)).json;
        if (a.nextDueAt == null || a.nextDueAt >= round.createdAt + 14 * DAY) return;
        const iid = (await api(`/assets/${assetId}/inspections`, { data: {} })).json.id;
        const draft = (await api(`/inspections/${iid}`)).json;
        const res = await api(`/inspections/${iid}/submit`, {
          data: { kinds: ['periodic'], answers: Object.fromEntries(draft.checkpoints.map((cp) => [cp.id, 'ok'])), defects: [], signature: SIG, signerName: 'E2E' },
        });
        if (res.status !== 200) throw new Error(`Abschluss ${res.status} ${res.text}`);
      }
    };
    for (const aid of queue.slice(0, -1)) await inspectAll(aid);
    let rt = (await tasks()).find((t) => t.id === round.id);
    check(queue.length === 1 || rt?.status === 'open', `Rundgang bleibt offen, solange noch etwas fällig ist (${rt?.status})`);
    await inspectAll(queue[queue.length - 1]);
    rt = (await tasks()).find((t) => t.id === round.id);
    check(rt?.status === 'done' && rt.closedAt > 0, `Rundgang nach der letzten Prüfung erledigt (${rt?.status})`);
    const eDone = (await log()).find((e) => e.key === 'plan_week' && e.summary === `${round.title} abgeschlossen`);
    check(!!eDone && eDone.link === `/aufgaben?id=${round.id}` && !eDone.undoable, `Protokoll „${round.title} abgeschlossen“ (${eDone?.summary})`);
    // nächste Woche: ein neuer Rundgang ist wieder möglich, die Regel selbst bleibt unverändert
    check((await api('/automation/plan_week/run', { data: {} })).status === 200, 'Woche planen läuft danach weiter');
    check(!(await tasks()).some((t) => t.buildingId === round.buildingId && t.id !== round.id && /^Rundgang /.test(t.title) && t.status === 'open'), 'kein neuer Rundgang ohne Fälliges');
  }

  step('Kreislauf geschlossen: Mangel → Aufgabe → Partner „erledigt“ → Nachprüf-Auftrag → Nachprüfung i. O. → Mangel behoben');
  rules = (await api('/automation')).json;
  check(mode('verify_repairs') === 'auto' && mode('assign_defect_tasks') === 'auto', 'Nachprüfen und Zuweisen automatisch');
  // Prüfer stellt an einer Feuerschutztür einen kritischen Mangel fest (Regel: Feuerschutztür kritisch → Subunternehmer)
  const doors = (await api('/assets?category=fire_door')).json.filter((a) => !(a.openDefects > 0));
  const submitAs = async (s, assetId, { taskId, defectAt = [], severity = 'critical', title = 'Türschließer schließt nicht' } = {}) => {
    const iid = (await s.api(`/assets/${assetId}/inspections`, { data: taskId ? { taskId } : {} })).json.id;
    const draft = (await s.api(`/inspections/${iid}`)).json;
    const res = await s.api(`/inspections/${iid}/submit`, {
      data: {
        kinds: [draft.kind ?? 'periodic'],
        answers: Object.fromEntries(draft.checkpoints.map((cp, i) => [cp.id, defectAt.includes(i) ? 'defect' : 'ok'])),
        defects: defectAt.map((i) => ({ checkpointId: draft.checkpoints[i].id, title, note: '', measure: '', severity })),
        signature: SIG,
        signerName: 'E2E',
      },
    });
    if (res.status !== 200) throw new Error(`Abschluss ${res.status} ${res.text}`);
    return draft;
  };
  const D1 = doors[0];
  const D2 = doors.find((a) => a.id !== D1.id && a.buildingId !== D1.buildingId) ?? doors[1];
  await submitAs(insp, D1.id, { defectAt: [0], title: 'Kreislauf: Schließer defekt' });
  const loopDefect = (await api(`/assets/${D1.id}`)).json.defects.find((d) => d.title === 'Kreislauf: Schließer defekt' && d.status === 'open');
  check(!!loopDefect, 'Mangel aus der Prüfung offen');
  let repair = (await tasks()).find((t) => t.defectId === loopDefect?.id && t.kind === 'defect');
  check(repair?.subcontractorId === sub.id && !!repair.shareToken, 'Mängelbehebung beim Partner, mit Link');
  // Partner meldet über den Einzel-Link „erledigt“
  let pr = await fetch(`${BASE}/api/public/tasks/${repair.shareToken}`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done', note: 'Schließer getauscht' }) });
  check(pr.status === 200, `Partner meldet erledigt (${pr.status})`);
  check((await api(`/defects/${loopDefect.id}`)).json.status === 'open', 'Mangel bleibt offen bis zur Nachprüfung');
  all = await tasks();
  let verify = all.filter((t) => t.defectId === loopDefect.id && t.kind === 'inspection');
  check(verify.length === 1, `genau ein Nachprüf-Auftrag (${verify.length})`);
  let V1 = verify[0];
  check(V1?.title === `Nachprüfung ${D1.code}` && V1.assetId === D1.id && V1.status === 'open' && V1.assigneeId === P1.id && V1.dueAt > Date.now(), `an die feststellende Person, mit Frist (${V1?.title}, ${V1?.assigneeName})`);
  check((await insp.api('/notifications')).json.items.some((n) => n.type === 'task_assigned' && n.title === `Neue Aufgabe: Nachprüfung ${D1.code}`), 'Prüfer benachrichtigt');
  const eV = (await log()).find((e) => e.key === 'verify_repairs' && e.link === `/aufgaben?id=${V1?.id}`);
  check(eV?.undoable && eV.title === 'Nachprüfen' && eV.step === 4 && eV.summary.includes(P1.name), `Protokoll „Nachprüfen“ (${eV?.summary})`);
  // Keine Dopplung: Knopf, Cron, erneutes Erledigen
  check((await api('/automation/verify_repairs/run', { data: {} })).status === 200 && (await tasks()).filter((t) => t.defectId === loopDefect.id && t.kind === 'inspection').length === 1, 'Ausführen legt nichts doppelt an');
  if (cronOk) await cron(Date.now());
  check((await tasks()).filter((t) => t.defectId === loopDefect.id && t.kind === 'inspection').length === 1, 'Cron legt nichts doppelt an');
  // Starten öffnet die Nachprüfung, nur mit dem betroffenen Prüfpunkt
  const vStart = (await insp.api(`/assets/${D1.id}/inspections`, { data: { taskId: V1.id } })).json.id;
  const vDraft = (await insp.api(`/inspections/${vStart}`)).json;
  check(vDraft.purpose === 'follow_up' && vDraft.checkpoints.length === 1, `Nachprüfung mit einem Prüfpunkt (${vDraft.purpose}, ${vDraft.checkpoints.length})`);
  await submitAs(insp, D1.id, { taskId: V1.id });
  check((await api(`/defects/${loopDefect.id}`)).json.status === 'resolved', 'Nachprüfung i. O. → Mangel behoben');
  V1 = (await tasks()).find((t) => t.id === V1.id);
  check(V1?.status === 'done', 'Nachprüf-Auftrag schließt sich');
  check((await log()).some((e) => e.key === 'verify_repairs' && e.summary === `Nachprüfung ${D1.code}: Mangel „Kreislauf: Schließer defekt“ behoben, Auftrag geschlossen`), 'Protokoll: behoben, geschlossen');

  step('Mangel besteht weiter: Partner-Seite → Nachprüfung → Behebung wieder offen, Zuständige benachrichtigt');
  await submitAs(insp, D2.id, { defectAt: [0], title: 'Kreislauf: Dichtung fehlt' });
  const keepDefect = (await api(`/assets/${D2.id}`)).json.defects.find((d) => d.title === 'Kreislauf: Dichtung fehlt' && d.status === 'open');
  repair = (await tasks()).find((t) => t.defectId === keepDefect?.id && t.kind === 'defect');
  const pcode = (await api(`/subcontractors/${sub.id}/partner-code`, { data: {} })).json.code;
  const plist = await (await fetch(`${BASE}/api/public/partner/${pcode}`)).json();
  const pref = plist.tasks.find((x) => x.title === repair?.title)?.ref;
  pr = await fetch(`${BASE}/api/public/partner/${pcode}/tasks/${pref}`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
  check(pr.status === 200, `Partner-Seite meldet erledigt (${pr.status})`);
  const V2 = (await tasks()).find((t) => t.defectId === keepDefect.id && t.kind === 'inspection' && t.status === 'open');
  check(V2?.assigneeId === P1.id, 'Nachprüf-Auftrag auch über die Partner-Seite');
  await submitAs(insp, D2.id, { taskId: V2.id, defectAt: [0], title: 'Kreislauf: Dichtung fehlt' });
  check((await api(`/defects/${keepDefect.id}`)).json.status === 'open', 'Mangel bleibt offen (kein Duplikat)');
  check((await api(`/assets/${D2.id}`)).json.defects.filter((d) => d.title === 'Kreislauf: Dichtung fehlt' && d.status === 'open').length === 1, 'kein zweiter Mangel');
  all = await tasks();
  check(all.find((t) => t.id === V2.id)?.status === 'done', 'Nachprüf-Auftrag ist erledigt');
  const reopened = all.find((t) => t.id === repair.id);
  check(reopened?.status === 'open' && !reopened.externalDoneAt && !reopened.closedAt, `Mängelbehebung wieder offen (${reopened?.status})`);
  check((await api(`/tasks/${repair.id}/comments`)).json.some((x) => x.authorName === 'Autopilot' && /besteht weiter/.test(x.body)), 'Kommentar des Autopiloten');
  // Behebung liegt beim Partner: Admins erfahren es (die nachprüfende Person selbst nicht)
  check((await api('/notifications')).json.items.some((n) => n.title === `Wieder offen: ${repair.title}` && /besteht weiter/.test(n.body)), 'Admins benachrichtigt');
  check((await (await fetch(`${BASE}/api/public/partner/${pcode}`)).json()).tasks.some((x) => x.ref === pref), 'Auftrag steht wieder auf der Partner-Seite');
  check((await log()).some((e) => e.key === 'verify_repairs' && /besteht weiter, Behebung wieder geöffnet/.test(e.summary)), 'Protokoll: besteht weiter');

  step('Mehrfachbearbeitung erledigt → Nachprüf-Auftrag; Mangel anders behoben → Auftrag entfällt');
  r = await api('/tasks/bulk', { data: { ids: [repair.id], status: 'done', resolveDefects: false } });
  const V3 = (await tasks()).find((t) => t.defectId === keepDefect.id && t.kind === 'inspection' && t.status === 'open');
  check(r.status === 200 && !!V3, 'neue Erledigung → neuer Nachprüf-Auftrag');
  await api(`/defects/${keepDefect.id}`, { method: 'PATCH', data: { status: 'resolved', note: 'vor Ort bestätigt' } });
  check((await tasks()).find((t) => t.id === V3?.id)?.status === 'done', 'Mangel behoben → Nachprüf-Auftrag schließt sich');

  step('Nachprüfen in Stufe „Vorschlagen“: eine Zeile in „Jetzt“, eine Aktion, Rückgängig ohne Neuanlage');
  await setMode('verify_repairs', 'suggest');
  r = await api('/defects', { data: { assetId: aExt.id, title: 'Kreislauf: Plombe gebrochen', severity: 'high', force: true } });
  const sugDefect = r.json.id;
  const sugRepair = (await tasks()).find((t) => t.defectId === sugDefect && t.kind === 'defect');
  await api(`/tasks/${sugRepair.id}`, { method: 'PATCH', data: { ...sugRepair, status: 'done', resolveDefect: false } });
  check(!(await tasks()).some((t) => t.defectId === sugDefect && t.kind === 'inspection'), 'Vorschlagen: kein Auftrag von selbst');
  let nowQ = (await api('/now?limit=50')).json;
  const vRow = nowQ.items.find((x) => x.automation === 'verify_repairs');
  check(vRow?.kind === 'automation' && vRow.action.endpoint === '/automation/verify_repairs/run' && !vRow.action.link && vRow.count >= 1, `Zeile mit genau einer Aktion (${JSON.stringify(vRow?.action)})`);
  r = await api(vRow.action.endpoint, { data: vRow.action.body ?? {} });
  const sugV = (await tasks()).find((t) => t.defectId === sugDefect && t.kind === 'inspection');
  check(r.status === 200 && r.json.created >= 1 && sugV?.assigneeId === byMail('demo@example.com').id, `Aktion legt an, an die meldende Person (${r.text})`);
  const eSugV = (await log()).find((e) => e.key === 'verify_repairs' && e.link === `/aufgaben?id=${sugV?.id}`);
  check((await api(`/automation/log/${eSugV.id}/undo`, { data: {} })).json.reverted === 1, 'Rückgängig entfernt den Auftrag');
  check((await api('/automation/verify_repairs/run', { data: {} })).json.created === 0, 'nach Rückgängig keine Neuanlage für dieselbe Erledigung');
  await setMode('verify_repairs', 'auto');

  step('„Jetzt“ (GET /now): eine Aktion je Zeile, nach Dringlichkeit, höchstens 12, Bereich');
  nowQ = (await api('/now')).json;
  check(nowQ.items.length > 0 && nowQ.items.length <= 12 && typeof nowQ.more === 'number' && nowQ.total === nowQ.items.length + nowQ.more, `Länge und Rest (${nowQ.items.length} + ${nowQ.more})`);
  check(nowQ.items.every((x) => x.action && x.action.label && !!x.action.link !== !!x.action.endpoint), 'jede Zeile genau eine Aktion');
  check(nowQ.items.every((x, i) => i === 0 || nowQ.items[i - 1].urgency >= x.urgency), 'nach Dringlichkeit sortiert');
  check(['start', 'run', 'create', 'open', 'continue', 'apply', 'sign'].includes(nowQ.items[0].action.verb), 'Aktion mit Verb');
  check(!nowQ.items.some((x) => x.kind === 'sign'), 'ohne bereitstehende Prüfungen keine Unterschriften-Zeile');
  const legacy = (await api('/smart/suggestions')).json;
  check(legacy.length === nowQ.total && legacy.every((x) => !!x.link !== !!x.action), `Alt-Pfad /smart/suggestions = dieselbe Quelle (${legacy.length}/${nowQ.total})`);
  check(Array.isArray((await api('/smart/action-required')).json), 'Alt-Pfad /smart/action-required');
  check((await viewer.api('/now')).json.items.length === 0, 'Lesezugriff: nichts zu tun');
  // Bereich: eingeschränkte Prüferin sieht nur Ziele in ihrem Objekt
  await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: { propertyIds: [S.id], buildingIds: [] }, canCreate: true } });
  const allBuildings = (await api('/buildings')).json;
  const foreign = [...allBuildings.filter((x) => x.propertyId !== S.id).map((x) => x.id), ...props.filter((x) => x.id !== S.id).map((x) => x.id)];
  const scopedNow = (await insp2.api('/now?limit=50')).json.items;
  check(scopedNow.every((x) => !foreign.some((fid) => (x.action.link ?? '').includes(fid) || JSON.stringify(x.action.body ?? {}).includes(fid))), `nur Ziele im Bereich (${scopedNow.map((x) => x.action.link ?? x.action.endpoint)})`);
  await api(`/account/members/${P2.id}/access`, { method: 'PUT', data: { scope: null, canCreate: true } });

  step('Hauptschalter aus: kein Schritt läuft oder schlägt vor, Stufen bleiben');
  check((await insp.api('/automation/autopilot', { method: 'PUT', data: { enabled: false } })).status === 403, 'Prüfer schaltet nicht');
  check((await api('/automation/autopilot', { method: 'PUT', data: { enabled: false } })).json.enabled === false, 'aus');
  await setMode('plan_week', 'suggest');
  check(!(await api('/now?limit=50')).json.items.some((x) => x.kind === 'automation' || x.kind === 'interval'), 'keine Autopilot-Vorschläge');
  check((await api('/automation/plan_week/run', { data: {} })).status === 409, 'Ausführen → 409');
  r = await api('/defects', { data: { assetId: aDoor.id, title: 'Kreislauf: aus', severity: 'critical', force: true } });
  check(r.json?.taskCreated === false, 'kein Zuweisen');
  // Ohne Nachprüfen gilt die Rückmeldung des Partners wieder als Behebung
  await api('/tasks', { data: { title: 'Kreislauf aus: Behebung', defectId: r.json.id, assetId: aDoor.id, subcontractorId: sub.id } });
  const offTask = (await tasks()).find((t) => t.title === 'Kreislauf aus: Behebung');
  const offTok = (await api(`/tasks/${offTask.id}/share`, { method: 'POST' })).json.token;
  await fetch(`${BASE}/api/public/tasks/${offTok}`, { method: 'POST', headers: { 'x-pk': '1', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'done' }) });
  check((await api(`/defects/${r.json.id}`)).json.status === 'resolved' && !(await tasks()).some((t) => t.defectId === r.json.id && t.kind === 'inspection'), 'Partner „erledigt“ behebt, kein Nachprüf-Auftrag');
  rules = (await api('/automation')).json;
  check(mode('verify_repairs') === 'auto' && rules.every((x) => x.effectiveMode === 'off'), 'Stufen gemerkt');
  if (cronOk) {
    const before = (await tasks()).length;
    await cron(monday.getTime() + 7 * DAY);
    check((await tasks()).length === before, 'Cron am Montag plant nichts');
  }
  await api('/automation/autopilot', { method: 'PUT', data: { enabled: true } });
  check((await api('/automation')).json.find((x) => x.key === 'verify_repairs').effectiveMode === 'auto', 'wieder an, Stufen wie vorher');

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
  await mp.goto(BASE + '/');
  await mp.locator('#erledigt').getByRole('heading', { name: 'Erledigt für dich' }).waitFor();
  await wide('Heute mit „Erledigt für dich“');
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
