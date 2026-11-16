// E2E 31-mcp-kreislauf (Plan v6, Paket U „Kreislauf und Sprache“): stellt die Fälle aus dem MCP-Praxistest des Inhabers
// nach – je Punkt der Aufruf aus dem Bericht und das erwartete Ergebnis über /api/mcp (wie e2e/11). Eigener, frischer
// Workspace „Garner Hotel (Test)“ (Inhaber Kerim Seehafer), damit Zahlen eindeutig sind. Dazu die App-Seiten von A2
// (Zeile unter „Jetzt“ mit Link auf /unterschreiben) und B8 (Status „ungültig“ im Mangel-Detail) bei 390 px. Nur lokal.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = path.join(__dirname, '.out', '31-mcp-kreislauf') + '/';
fs.mkdirSync(OUT, { recursive: true });
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const step = (m) => console.log('·', m);
const TZ = 'Europe/Berlin';
const ymd = (t) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(t);
const today = ymd(Date.now());

let rpcId = 0;
async function mcp(key, name, args = {}) {
  const r = await fetch(BASE + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json().catch(() => null);
  const res = j?.result;
  let data = null;
  if (res && !res.isError) {
    try {
      data = JSON.parse(res.content[0].text);
    } catch {
      data = null;
    }
  }
  return { isError: res?.isError, data, text: res?.content?.[0]?.text ?? j?.error?.message ?? '' };
}

(async () => {
  if (process.env.PROD) throw new Error('31-mcp-kreislauf nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[134]|status of 409|status of 503/.test(m.text()) && errors.push('console ' + m.text()));
  const api = async (pth, opts = {}) => {
    const r = await p.request.fetch(BASE + '/api' + pth, { method: opts.method ?? (opts.data !== undefined ? 'POST' : 'GET'), data: opts.data, headers: { 'x-pk': '1' } });
    return { status: r.status(), json: await r.json().catch(() => null) };
  };
  const noOverflow = async (what) => {
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `kein Überlauf ${what} (${over}px)`);
  };

  step('Workspace „Garner Hotel“: Inhaber, Admin, Partner, Objekt mit einem Gebäude und Elementen');
  await p.goto(BASE + '/login');
  const stamp = Date.now();
  const ownerMail = `kerim${stamp}@example.com`;
  let r = await api('/auth/register', { data: { company: 'Garner Test GmbH', name: 'Kerim Seehafer', email: ownerMail, password: 'sicheres-passwort-1' } });
  check(r.status === 200, `registriert (${r.status})`);
  const me = (await api('/account/me')).json;
  const tenantId = me.tenant.id;
  // zweite Person (Admin) und ein Partner
  const inv = await api('/account/members/invite', { data: { email: `nina${stamp}@example.com`, role: 'admin' } });
  {
    const other = await b.newContext();
    const r2 = await other.request.fetch(BASE + `/api/auth/invite/${inv.json.token}`, { method: 'POST', data: { name: 'Nina Albers', password: 'sicheres-passwort-2' }, headers: { 'x-pk': '1' } });
    check(r2.status() === 200, `Admin Nina angenommen (${r2.status()})`);
    await other.close();
  }
  await api('/subcontractors', { data: { company: 'Türtechnik Hansen KG', trade: 'Feuerschutztüren' } });
  const key = (await api('/account/api-keys', { data: { name: 'Claude', scope: 'write', expiresInDays: 1 } })).json.key;
  const prop = (await api('/properties', { data: { name: 'Garner Hotel (Test)', address: 'Am Hafen 1', withBuilding: true } })).json;
  const bid = (await api(`/properties/${prop.id}`)).json.buildings[0].id;
  const mk = async (category, floor, location) => (await api('/assets', { data: { buildingId: bid, category, floor, location, attributes: {} } })).json;
  const d1 = await mk('fire_door', 'EG', 'Flur Ost');
  const d2 = await mk('fire_door', 'EG', 'Flur West');
  const d3 = await mk('fire_door', '1. OG', 'Treppenhaus');
  const fsa = await mk('hold_open', 'EG', 'Foyer');
  check(d1.code && fsa.code, `Elemente angelegt (${d1.code}, ${fsa.code})`);
  // Autopilot deterministisch: Zuweisen und Nachprüfen automatisch
  await api('/automation', { method: 'PUT', data: { key: 'assign_defect_tasks', mode: 'auto' } });
  await api('/automation', { method: 'PUT', data: { key: 'verify_repairs', mode: 'auto' } });
  const P = 'Garner Hotel (Test)';

  step('A6: capture Aufgabe mit due „2026-02-30“ → abgelehnt (früher 02.03.)');
  let t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'task', title: 'Schließer prüfen lassen', due: '2026-02-30' }] });
  check(t.isError && /Februar 2026 hat nur 28 Tage/.test(t.text), `30.02. abgelehnt (${t.text.slice(0, 160)})`);
  check(!(await api('/tasks')).json.length, 'keine Aufgabe angelegt');
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'task', title: 'Vergangenheit', due: '2026-01-05' }] });
  check(t.isError && /Vergangenheit/.test(t.text) && /allowPast/.test(t.text), `Datum in der Vergangenheit abgelehnt (${t.text.slice(0, 120)})`);
  t = await mcp(key, 'update_tasks', { taskIds: ['x'], due: '31.04.2027' });
  check(t.isError && /April 2027 hat nur 30 Tage/.test(t.text), 'update_tasks: 31.04. abgelehnt');

  step('C1: capture due „morgen“ → Frist morgen (Zeitzone des Workspaces)');
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'task', title: 'Hausmeister informieren', due: 'morgen' }] });
  check(!t.isError && t.data?.created?.length === 1, `„morgen“ angenommen (${t.text.slice(0, 160)})`);
  let tasks = (await api('/tasks')).json;
  const tMorgen = tasks.find((x) => x.title === 'Hausmeister informieren');
  check(tMorgen && ymd(tMorgen.dueAt) === ymd(Date.now() + 86_400_000), `Frist = morgen (${tMorgen && ymd(tMorgen.dueAt)})`);
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'task', title: 'Prüfbuch klären', due: 'in 3 Tagen' }, { kind: 'task', title: 'Monatsabschluss', due: 'Ende des Monats' }] });
  check(t.data?.created?.length === 2, `„in 3 Tagen“ und „Ende des Monats“ (${t.text.slice(0, 160)})`);
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'task', title: 'Irgendwann', due: 'irgendwann' }] });
  check(t.isError && /verstehe ich nicht als Datum/.test(t.text), 'Unsinn wird mit Beispielen abgelehnt');

  step('B5: Aufgabe aus capture mit Element erbt das Objekt (list tasks property, Bericht)');
  t = await mcp(key, 'list', { what: 'tasks', property: P });
  check(t.data?.tasks?.some((x) => x.title === 'Hausmeister informieren' && x.property === P), `list(tasks, property) findet sie (${t.text.slice(0, 160)})`);
  // ältere Aufgabe nur mit Element (ohne Objekt-Spalte): per Join
  const legacy = await api('/tasks', { data: { title: 'Alt: nur Element', assetId: d2.id } });
  tasks = (await api('/tasks')).json;
  check(tasks.find((x) => x.id === legacy.json.id)?.propertyId === prop.id, 'Aufgabe ohne Objekt-Spalte: Objekt über das Element');

  step('B1: team und Zuständige per Name, „ich“, E-Mail, Partner');
  t = await mcp(key, 'team', {});
  check(
    /Kerim Seehafer/.test(t.data?.me) && t.data.members.length === 2 && t.data.partners.some((x) => x.company === 'Türtechnik Hansen KG'),
    `team (${t.text.slice(0, 200)})`,
  );
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: 'Kerim Seehafer' });
  check(!t.isError && t.data?.updated === 1 && t.data.assignee === 'Kerim Seehafer', `eigener Name ohne bisherige Zuweisung (${t.text.slice(0, 160)})`);
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: 'Nina' });
  check(!t.isError && t.data?.assignee === 'Nina Albers', `Vorname einer anderen Person (${t.text.slice(0, 120)})`);
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: 'ich' });
  check(!t.isError && t.data?.assignee === 'Kerim Seehafer', '„ich“');
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: ownerMail.toUpperCase() });
  check(!t.isError && t.data?.assignee === 'Kerim Seehafer', 'E-Mail (Groß/klein egal)');
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: 'Hansen' });
  check(!t.isError && /Partner/.test(t.data?.assignee), `Partner per Firmenteil (${t.text.slice(0, 120)})`);
  check((await api('/tasks')).json.find((x) => x.id === tMorgen.id)?.subcontractorName === 'Türtechnik Hansen KG', 'Partner gesetzt');
  t = await mcp(key, 'update_tasks', { taskIds: [tMorgen.id], assignee: 'Erika Mustermann' });
  check(t.isError && /Kerim Seehafer/.test(t.text) && /Nina Albers/.test(t.text) && /Hansen/.test(t.text), 'unbekannt → Auswahl aller Mitglieder und Partner');

  step('C2: capture asset ohne building → einziges Gebäude');
  t = await mcp(key, 'capture', { property: P, items: [{ kind: 'asset', category: 'Feuerlöscher', floor: 'EG', location: 'Küche' }] });
  check(!t.isError && /Feuerlöscher in /.test(t.data?.created?.[0] ?? ''), `einziges Gebäude automatisch (${t.text.slice(0, 160)})`);

  step('B2: Duplikate – Abkürzungen ausgeschrieben, Befunde in Entwürfen mitgeprüft');
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'defect', title: 'Obentürschließer schließt nicht', severity: 'medium' }] });
  check(t.data?.created?.length === 1, 'erster Mangel angelegt');
  t = await mcp(key, 'capture', { asset: d1.code, items: [{ kind: 'defect', title: 'OTS zieht nicht zu', severity: 'medium' }] });
  check(t.data?.skipped?.length === 1 && !t.data.created, `„OTS zieht nicht zu“ als Duplikat erkannt (${t.text.slice(0, 200)})`);
  t = await mcp(key, 'inspect', { asset: d2.code, allOk: true, fields: { holdOpen: false, leaves: '1-flügelig' }, defects: [{ title: 'Dichtung fehlt oben', severity: 'medium', checkpoint: 'Dichtung' }] });
  check(!t.isError, `inspect ${d2.code} bereit (${t.text.slice(0, 120)})`);
  t = await mcp(key, 'capture', { asset: d2.code, items: [{ kind: 'defect', title: 'Dichtung oben fehlt', severity: 'medium' }] });
  check(t.data?.skipped?.length === 1 && /Prüfung/.test(t.data.skipped[0].reason), `Befund im bereitgelegten Entwurf zählt (${t.text.slice(0, 200)})`);
  const defectsNow = (await api('/defects?status=all')).json;
  check(defectsNow.length === 1, `nur ein Mangel statt drei (${defectsNow.length})`);

  step('A2: inspect Feststellanlage „löst bei Rauch nicht aus“ (critical) → sichtbar, bevor jemand unterschreibt');
  t = await mcp(key, 'inspect', { asset: fsa.code, allOk: true, defects: [{ title: 'löst bei Rauch nicht aus', severity: 'critical', measure: 'Rauchmelder der FSA tauschen' }] });
  check(!t.isError, `inspect FSA bereit (${t.text.slice(0, 160)})`);
  t = await mcp(key, 'list', { what: 'defects', severity: 'critical' });
  check(t.data?.total === 0, 'noch kein Mangel (wie entschieden: nicht vorab anlegen)');
  t = await mcp(key, 'briefing', {});
  check(
    t.data?.counts?.criticalDefects?.open === 0 && t.data.counts.criticalDefects.waitingForSignature === 1,
    `briefing.criticalDefects getrennt (${JSON.stringify(t.data?.counts?.criticalDefects)})`,
  );
  check(
    Object.keys(t.data ?? {})[1] === 'attention' && t.data.attention.findings.some((f) => f.finding === 'löst bei Rauch nicht aus' && f.readyBy === 'Kerim Seehafer' && f.element.startsWith(fsa.code)),
    `briefing.attention ganz oben mit Element, Befund, wer bereitgelegt hat (${JSON.stringify(t.data?.attention)?.slice(0, 200)})`,
  );
  check(t.data?.now?.[0]?.kind === 'pending_findings', `„Jetzt“ beginnt mit den wartenden Befunden (${t.data?.now?.[0]?.kind})`);
  const notes = (await api('/notifications')).json;
  const nlist = Array.isArray(notes) ? notes : (notes?.items ?? []);
  check(nlist.some((n) => /Kritischer Befund wartet auf deine Unterschrift/.test(n.title)), 'prüfende Person benachrichtigt (auch wenn sie selbst bereitgelegt hat)');
  // nochmal bereitlegen: keine zweite Meldung
  await mcp(key, 'inspect', { asset: fsa.code, notes: 'Nachtrag' });
  const notes2 = (await api('/notifications')).json;
  check((Array.isArray(notes2) ? notes2 : (notes2?.items ?? [])).filter((n) => /Kritischer Befund/.test(n.title)).length === 1, 'nur eine Meldung je Prüfung');
  {
    const nina = await b.newContext();
    await nina.request.fetch(BASE + '/api/auth/login', { method: 'POST', data: { email: `nina${stamp}@example.com`, password: 'sicheres-passwort-2' }, headers: { 'x-pk': '1' } });
    const nn = await (await nina.request.fetch(BASE + '/api/notifications', { headers: { 'x-pk': '1' } })).json();
    const nl = Array.isArray(nn) ? nn : (nn?.items ?? []);
    check(nl.some((n) => /Kritischer Befund wartet auf Unterschrift/.test(n.title) && /^\/pruefung\/\w+$/.test(n.link ?? '')), `Admin benachrichtigt, Link zur Prüfung (${nl.map((n) => n.title).join(' | ').slice(0, 160)})`);
    await nina.close();
  }
  step('A2 in der App: „Heute“ → „Jetzt“ zeigt die Zeile mit Link auf /unterschreiben (390 px)');
  await p.goto(BASE + '/');
  const row = p.locator('li[data-now="pending_findings"]').first();
  await row.waitFor({ timeout: 15000 });
  check(/Ein kritischer Befund wartet auf Unterschrift/.test(await row.innerText()), `Zeile „kritische Befunde warten“ (${(await row.innerText()).slice(0, 120)})`);
  check(/löst bei Rauch nicht aus/.test(await row.innerText()), 'Zeile nennt den Befund');
  check(await p.locator('li[data-now]').first().getAttribute('data-now') === 'pending_findings', 'ganz oben unter „Jetzt“');
  await noOverflow('/ (Jetzt mit wartendem Befund)');
  await p.screenshot({ path: OUT + 'a2-jetzt.png', fullPage: true });
  await row.getByRole('button').click();
  await p.waitForURL(/\/unterschreiben/);
  check(p.url().endsWith('/unterschreiben'), 'Knopf öffnet /unterschreiben');

  step('B3: Aufgabe „done“ über MCP → Nachprüfen greift, Kommentar im Verlauf');
  t = await mcp(key, 'capture', { asset: d3.code, items: [{ kind: 'defect', title: 'Tür schleift am Boden', severity: 'high', measure: 'Tür einstellen' }] });
  check(/Autopilot/.test(t.data?.autoTasks ?? ''), `Autopilot legt Aufgabe an (${t.text.slice(0, 160)})`);
  let dDefect = (await api('/defects')).json.find((d) => d.title === 'Tür schleift am Boden');
  let repair = (await api('/tasks')).json.find((x) => x.defectId === dDefect.id && x.kind === 'defect');
  step('E5: schwerer Mangel mit Aufgabe ohne Zuständige → „Jetzt“');
  const nowE5 = (await api('/now?limit=50')).json.items;
  check(nowE5.some((i) => i.kind === 'defects_unassigned'), `„Jetzt“: schwere Mängel ohne Zuständige (${nowE5.map((i) => i.kind).join(',')})`);
  t = await mcp(key, 'update_tasks', { taskIds: [repair.id], status: 'done', comment: 'Tür neu eingestellt' });
  check(!t.isError && /Nachprüf-Auftrag/.test((t.data?.defects ?? []).join(' ')), `Antwort nennt Nachprüfung (${t.text.slice(0, 200)})`);
  dDefect = (await api(`/defects/${dDefect.id}`)).json;
  check(dDefect.status === 'open', 'Mangel bleibt offen bis zur Nachprüfung');
  tasks = (await api('/tasks')).json;
  check(tasks.some((x) => x.title === `Nachprüfung ${d3.code}` && x.status === 'open'), 'Nachprüf-Auftrag angelegt (wie in der App)');
  const comments = (await api(`/tasks/${repair.id}/comments`)).json;
  check(comments.some((c) => c.body === 'Tür neu eingestellt'), 'Kommentar steht im Verlauf der Aufgabe');
  // ohne Nachprüfen-Schritt: behoben, Kommentar = Behebungsnotiz
  await api('/automation', { method: 'PUT', data: { key: 'verify_repairs', mode: 'off' } });
  t = await mcp(key, 'capture', { asset: d2.code, items: [{ kind: 'defect', title: 'Schloss klemmt', severity: 'high', measure: 'Schloss tauschen' }] });
  let lock = (await api('/defects')).json.find((d) => d.title === 'Schloss klemmt');
  repair = (await api('/tasks')).json.find((x) => x.defectId === lock.id);
  t = await mcp(key, 'update_tasks', { taskIds: [repair.id], status: 'done', comment: 'Schloss getauscht, Fa. Hansen' });
  lock = (await api(`/defects/${lock.id}`)).json;
  check(lock.status === 'resolved' && lock.resolutionNote === 'Schloss getauscht, Fa. Hansen', `ohne Nachprüfen: behoben, Kommentar = Behebungsnotiz (${lock.status}, ${lock.resolutionNote})`);
  // wieder öffnen → zählt als „ohne Aufgabe“ und bekommt bei tasks_from_defects eine neue
  await api('/automation', { method: 'PUT', data: { key: 'assign_defect_tasks', mode: 'suggest' } });
  const withoutTask = async () => Number(((await mcp(key, 'report', { property: P })).text.match(/ohne Aufgabe: (\d+)/) ?? [])[1]);
  const before = await withoutTask();
  t = await mcp(key, 'update_defect', { defectId: lock.id, action: 'reopen' });
  check(t.data?.status === 'offen' && /ohne Aufgabe/.test(t.data.task ?? ''), `wieder geöffnet, ohne Aufgabe (${t.text.slice(0, 160)})`);
  check((await withoutTask()) === before + 1, 'report zählt ihn als „ohne Aufgabe“');
  t = await mcp(key, 'list', { what: 'defects', property: P });
  check(t.data?.defects?.find((d) => d.defectId === lock.id)?.task === 'keine Aufgabe', 'list(defects): „keine Aufgabe“ trotz erledigter alter Aufgabe');
  t = await mcp(key, 'plan', { action: 'tasks_from_defects' });
  check(t.data?.created === 1, `tasks_from_defects legt für den wieder geöffneten eine an (${t.text.slice(0, 120)})`);
  check((await withoutTask()) === before, 'report danach: wieder wie vorher (dieselbe Regel wie tasks_from_defects)');
  // mit Zuweisen „Automatisch“ entsteht die neue Aufgabe direkt beim Wiederöffnen
  await api('/automation', { method: 'PUT', data: { key: 'assign_defect_tasks', mode: 'auto' } });
  const lockTask = (await api('/tasks')).json.find((x) => x.defectId === lock.id && x.status === 'open');
  await mcp(key, 'update_tasks', { taskIds: [lockTask.id], status: 'done' });
  await mcp(key, 'update_defect', { defectId: lock.id, action: 'reopen' });
  check((await api('/tasks')).json.filter((x) => x.defectId === lock.id && x.status === 'open').length === 1, 'Wiederöffnen mit Autopilot: sofort neue Aufgabe');

  step('B4: plan_week bei nie geprüften Elementen');
  t = await mcp(key, 'plan', { action: 'plan_week' });
  check(Number(t.data?.done) === 1 && /nie geprüft/.test(t.data.text), `Rundgang-Auftrag statt „Nichts zu planen“ (${t.text.slice(0, 160)})`);

  step('B7: autopilot view – je Eintrag id und undoable');
  t = await mcp(key, 'autopilot', { action: 'view' });
  check(t.data?.log?.length > 0 && t.data.log.every((e) => typeof e.id === 'string' && typeof e.undoable === 'boolean'), `Protokoll mit id/undoable (${JSON.stringify(t.data?.log?.[0])})`);
  const undoable = t.data.log.find((e) => e.undoable);
  if (undoable) {
    const u = await mcp(key, 'autopilot', { action: 'undo', entry: undoable.id });
    check(!u.isError && u.data?.undone, `undo mit der ID aus view (${u.text.slice(0, 120)})`);
  } else check(false, 'mindestens ein Eintrag rückgängig machbar');

  step('E9: Admin-Schritte');
  t = await mcp(key, 'autopilot', { action: 'run', step: 'monthly_report' });
  check(t.isError && /Das können nur Admins in der App/.test(t.text), `Admin-Schritt: einheitlicher Hinweis (${t.text.slice(0, 120)})`);

  step('B8: Mangel ungültig (update_defect) – zählt nicht in Quote und Dauer');
  const dup = (await api('/defects')).json.find((d) => d.title === 'Obentürschließer schließt nicht');
  t = await mcp(key, 'update_defect', { defectId: dup.id, action: 'invalid' });
  check(t.isError && /reason/.test(t.text), 'ohne Grund abgelehnt');
  t = await mcp(key, 'update_defect', { defectId: dup.id, action: 'invalid', reason: 'Fehleintrag – Tür war offen gekeilt' });
  check(t.data?.status === 'ungültig' && /Fehleintrag/.test(t.data.reason), `als ungültig markiert (${t.text.slice(0, 160)})`);
  t = await mcp(key, 'list', { what: 'defects', status: 'invalid' });
  check(t.data?.total === 1 && t.data.defects[0].status === 'ungültig', 'list(defects, status invalid)');
  t = await mcp(key, 'list', { what: 'defects' });
  check(!t.data?.defects?.some((d) => d.defectId === dup.id), 'nicht mehr unter offen');
  t = await mcp(key, 'report', { property: P });
  check(/als ungültig markiert: 1/.test(t.text) && !/neu: 4/.test(t.text), `report: ungültig getrennt (${(t.text.match(/neu: .*/) ?? [''])[0]})`);

  step('B8 in der App: Mangel-Detail zeigt „Ungültig“; Markieren per Dialog (390 px)');
  await p.goto(BASE + `/offen?art=maengel&mangel=${dup.id}`);
  const panel = p.getByRole('dialog').last();
  await panel.getByText('Ungültig', { exact: true }).first().waitFor({ timeout: 15000 });
  check(await panel.getByText('Fehleintrag – Tür war offen gekeilt').first().isVisible(), 'Grund sichtbar');
  check(await panel.getByRole('button', { name: 'Wieder öffnen' }).isVisible(), '„Wieder öffnen“ angeboten');
  await noOverflow('Mangel-Detail ungültig');
  await p.screenshot({ path: OUT + 'b8-ungueltig.png', fullPage: true });
  const other = (await api('/defects')).json.find((d) => d.title === 'Tür schleift am Boden');
  await p.goto(BASE + `/offen?art=maengel&mangel=${other.id}`);
  const panel2 = p.getByRole('dialog').last();
  await panel2.getByRole('button', { name: 'Ungültig' }).click();
  const dlg = p.getByRole('dialog', { name: 'Mangel ungültig' });
  await dlg.waitFor();
  await noOverflow('Dialog ungültig');
  await dlg.getByRole('button', { name: 'Duplikat' }).click();
  await dlg.getByRole('button', { name: 'Ungültig' }).click();
  await dlg.waitFor({ state: 'detached' });
  check((await api(`/defects/${other.id}`)).json.status === 'invalid', 'App: per Dialog als ungültig markiert');
  check(
    (await api('/tasks')).json.filter((x) => x.defectId === other.id && (x.status === 'open' || x.status === 'in_progress')).length === 0,
    'offene Aufgaben zum ungültigen Mangel entfallen',
  );
  await p.goto(BASE + '/offen?art=maengel&tab=invalid');
  await p.getByText('Tür schleift am Boden').first().waitFor();
  await noOverflow('/offen Mängel „Ungültig“');

  step('C3: catalog suggest zerlegt mehrere Befunde und schreibt Begriffe aus');
  t = await mcp(key, 'catalog', { action: 'suggest', text: 'OTS schließt nicht, Dichtung fehlt und Spion verkratzt' });
  check(t.data?.findings?.length === 3 && t.data.findings[0].understood?.includes('Obentürschließer') && t.data.findings[0].defects?.length > 0, `drei Befunde, OTS ausgeschrieben (${t.text.slice(0, 260)})`);

  step('D3: catalog upsert meldet unbekannte defaults-Schlüssel und fehlende Felder beim Namen');
  t = await mcp(key, 'catalog', {
    action: 'upsert',
    list: 'products',
    preview: true,
    items: [
      { manufacturer: 'Hörmann', model: 'H3', category: 'Feuerschutztür', defaults: { rating: 'T30', farbe: 'rot' } },
      { manufacturer: 'Hörmann' },
      { manufacturer: 'Teckentrup', model: 'DZ', category: 'Feuerschutztür', defaults: { rating: 'T30', smoke: true } },
    ],
  });
  const errs = (t.data?.errors ?? []).join(' | ');
  check(/1\. .*farbe/.test(errs) && /requirement/.test(errs), `unbekannter Schlüssel „farbe“ mit erlaubten Feldern (${errs.slice(0, 200)})`);
  check(/2\. Fehlt: model \(Typ\)/.test(errs), 'fehlendes Feld beim Namen');
  check(t.data?.create?.length === 1, 'gültiger Eintrag in der Vorschau');

  step('E1: briefing since „<heute>T12:00“ gilt als Ortszeit');
  t = await mcp(key, 'briefing', { since: `${today}T12:00` });
  check(t.data?.autopilot?.since === `${today} 12:00`, `since in Ortszeit (${t.data?.autopilot?.since})`);
  t = await mcp(key, 'briefing', { since: '2026-02-30' });
  check(t.isError && /Februar/.test(t.text), 'since: ungültiges Datum abgelehnt');

  step('E2/E3: Monatsbericht „bis zum Letzten“, Entwürfe und Rückstau, Quote ohne nie geprüfte');
  const month = today.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  t = await mcp(key, 'report', { property: P, month });
  check(t.text.includes(`bis ${last}.${String(mm).padStart(2, '0')}.${yy}`), `Zeitraum bis zum Monatsletzten (${t.text.split('\n')[0]})`);
  check(/Unterschrifts-Rückstau: 2/.test(t.text), `Unterschrifts-Rückstau genannt (${(t.text.match(/in Arbeit.*/) ?? [''])[0]})`);
  check(/nie geprüft: 5 von 5 Elementen \(nicht in der Quote\)/.test(t.text) && /Prüfquote heute: – der 0 schon geprüften/.test(t.text), `Quote ohne nie geprüfte (${(t.text.match(/Prüfquote.*/) ?? [''])[0]})`);

  step('E4: Begehungen in briefing und list aus derselben Quelle');
  const br = await mcp(key, 'briefing', {});
  const lw = await mcp(key, 'list', { what: 'walkthroughs' });
  check((br.data?.counts?.walkthroughsDue ?? 0) === lw.data?.due?.total, `briefing ${br.data?.counts?.walkthroughsDue ?? 0} = list ${lw.data?.due?.total}`);

  step('F6: Katalog-Grundausstattung um Feuerlöscher, Rauchwarnmelder, Brandschutzklappen ergänzt');
  t = await mcp(key, 'catalog', { action: 'search', list: 'defects', category: 'Feuerlöscher' });
  check(t.data?.defects?.some((d) => d.title === 'Plombe fehlt oder ist beschädigt'), 'neuer Workspace hat die Feuerlöscher-Mängel');
  for (const [cat, title] of [['Rauchwarnmelder', 'Melder löst bei Prüfung nicht aus'], ['Brandschutzklappe', 'Klappe schließt nicht vollständig']]) {
    t = await mcp(key, 'catalog', { action: 'search', list: 'defects', category: cat });
    check(t.data?.defects?.some((d) => d.title === title), `${cat}: „${title}“`);
  }
  // bestehender Workspace (vor dem Nachtrag ausgestattet): einmal nachtragen, Gelöschtes nicht zurückholen
  const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', q], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  sql(`UPDATE tenants SET catalog_extra_at = NULL WHERE id = '${tenantId}'; DELETE FROM catalog_defects WHERE tenant_id = '${tenantId}' AND category IN ('extinguisher','smoke_alarm','damper');`);
  let cat = (await api('/catalog')).json;
  const ext = cat.defects.filter((d) => d.category === 'extinguisher');
  check(ext.length >= 4, `bestehender Workspace: Nachtrag beim ersten Lesen (${ext.length})`);
  await api(`/catalog/defects/${ext[0].id}`, { method: 'DELETE' });
  cat = (await api('/catalog')).json;
  check(!cat.defects.some((d) => d.id === ext[0].id || (d.category === 'extinguisher' && d.title === ext[0].title)), 'gelöschter Eintrag kommt nicht zurück');

  check(!errors.length, `keine Konsolenfehler (${errors.slice(0, 3).join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
