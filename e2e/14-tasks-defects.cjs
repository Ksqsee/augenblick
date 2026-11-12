// E2E 14-tasks-defects: Aufgabentypen, Beobachter, @-Erwähnungen, Mehrfachbearbeitung, Gruppierung/Schnellfilter,
// Behebung mit Notiz und Nachher-Foto (auch im PDF), Ausblenden, Mangel-Detail, Sortierung nach Dringlichkeit, /smart/action-required, MCP. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:5173';
const PW = process.env.DEMO_PASSWORD;
const OUT = require('path').join(__dirname, '.out', '14-tasks-defects') + '/';
fs.mkdirSync(OUT, { recursive: true });
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(SIG.split(',')[1], 'base64');
const DAY = 86_400_000;
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};

(async () => {
  if (process.env.PROD) throw new Error('14-tasks-defects nicht gegen Produktion ausführen');
  const b = await chromium.launch();
  const errors = [];
  /** Angemeldeter Browser-Kontext mit API-Helfer. */
  const session = async (email, viewport = { width: 1360, height: 860 }) => {
    const ctx = await b.newContext({ viewport, locale: 'de-DE' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${email} pageerror ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of 40[0134]/.test(m.text()) && errors.push(`${email} console ${m.text()}`));
    p.on('dialog', (d) => d.accept());
    const api = async (path, opts = {}) => {
      const r = await p.request.fetch(BASE + '/api' + path, {
        method: opts.method ?? (opts.data !== undefined || opts.raw ? 'POST' : 'GET'),
        data: opts.raw ?? opts.data,
        headers: { 'x-pk': '1', ...(opts.raw ? { 'content-type': 'image/png' } : {}) },
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
  const me = byMail('demo@example.com');
  const P1 = byMail('pruefer@example.com');
  const P2 = byMail('pruefer2@example.com');
  const notes = async (s) => (await s.api('/notifications')).json.items;

  step('Aufgabentypen und Standardwerte');
  let tasks = (await api('/tasks')).json;
  check(tasks.filter((t) => t.defectId).every((t) => t.kind === 'defect'), 'Aufgaben mit Mangel sind Mängelbehebungen');
  const seededOrder = tasks.find((t) => t.kind === 'inspection');
  check(!!seededOrder?.assetId && seededOrder.assetCode, `Demodaten enthalten einen Prüfauftrag (${seededOrder?.title})`);
  const assets = (await api('/assets')).json;
  const asset = assets.find((a) => a.category === 'smoke_alarm');
  let r = await api('/tasks', { data: { title: 'E2E Sonstiges' } });
  check(r.status === 200 && r.json.kind === 'other', `ohne Typ → Sonstiges (${r.json?.kind})`);
  const otherId = r.json.id;
  check((await api('/tasks', { data: { title: 'x', kind: 'inspection' } })).status === 400, 'Prüfauftrag ohne Element abgelehnt');
  check((await api('/tasks', { data: { title: 'x', kind: 'defect', assetId: asset.id } })).status === 400, 'Mängelbehebung ohne Mangel abgelehnt');
  r = await api('/tasks', { data: { title: 'E2E Prüfauftrag', kind: 'inspection', assetId: asset.id, assigneeId: P1.id, dueAt: Date.now() - 2 * DAY } });
  check(r.status === 200 && r.json.kind === 'inspection', 'Prüfauftrag mit Element');
  const orderId = r.json.id;
  const openDefects = (await api('/defects')).json;
  const freeDefect = openDefects.find((d) => !d.taskId && d.assetId);
  r = await api('/tasks', { data: { title: 'E2E Behebung', defectId: freeDefect.id, assetId: freeDefect.assetId } });
  check(r.json.kind === 'defect', 'mit Mangel automatisch Mängelbehebung');
  const fixId = r.json.id;

  step('Beobachter: Anlegende und Zuständige automatisch, Benachrichtigung bei Statuswechsel');
  let w = (await api(`/tasks/${orderId}/watchers`)).json.map((x) => x.userId).sort();
  check(JSON.stringify(w) === JSON.stringify([me.id, P1.id].sort()), `Beobachter ${JSON.stringify(w)}`);
  const before = (await notes(insp)).length;
  const order = (await api('/tasks')).json.find((t) => t.id === orderId);
  check(order.watching === true && order.watchers === 2 && order.createdBy === me.id, 'Liste zeigt Beobachtung und Ersteller');
  r = await api(`/tasks/${orderId}`, { method: 'PATCH', data: { ...order, status: 'in_progress' } });
  check(r.status === 200, 'Status geändert');
  let n1 = await notes(insp);
  check(n1.length === before + 1 && n1[0].type === 'task_watch' && /In Arbeit/.test(n1[0].title), `Beobachter benachrichtigt (${n1[0]?.title})`);
  check((await insp.api(`/tasks/${orderId}/watch`, { method: 'DELETE' })).json?.watching === false, 'nicht mehr beobachten');
  await api(`/tasks/${orderId}`, { method: 'PATCH', data: { ...order, status: 'open' } });
  check((await notes(insp)).length === n1.length, 'ohne Beobachtung keine Meldung');
  check((await viewer.api(`/tasks/${orderId}/watch`, { method: 'POST' })).status === 200, 'Lesezugriff darf beobachten');
  check((await insp.api(`/tasks/${orderId}/watch`, { method: 'POST' })).json?.watching === true, 'wieder beobachten');

  step('Kommentare mit @-Erwähnungen');
  const n2before = (await notes(insp2)).length;
  r = await api(`/tasks/${orderId}/comments`, { data: { body: `Bitte übernehmen @${P2.name}`, mentions: [P2.id] } });
  check(r.status === 200 && r.json.mentions[0] === P2.id, `Kommentar mit Erwähnung (${r.status})`);
  const n2 = await notes(insp2);
  check(n2.length === n2before + 1 && n2[0].type === 'task_mention' && /erwähnt/.test(n2[0].title), `Erwähnte Person benachrichtigt (${n2[0]?.title})`);
  w = (await api(`/tasks/${orderId}/watchers`)).json.map((x) => x.userId);
  check(w.includes(P2.id), 'Erwähnte Person beobachtet jetzt');
  n1 = await notes(insp);
  check(n1[0].type === 'task_comment', `Beobachter bekommt Kommentar-Meldung (${n1[0]?.type})`);
  check((await api(`/tasks/${orderId}/comments`, { data: { body: 'x', mentions: ['gibtsnicht123'] } })).status === 400, 'Erwähnung von Nicht-Mitglied abgelehnt');
  const cm = (await api(`/tasks/${orderId}/comments`)).json;
  check(cm.at(-1).mentions?.[0] === P2.id, 'Erwähnungen gespeichert');
  check((await viewer.api(`/tasks/${orderId}/comments`, { data: { body: 'x' } })).status === 403, 'Lesezugriff kommentiert nicht');

  step('Externe Ansicht ohne interne Notizen');
  const subs = (await api('/subcontractors')).json;
  const fix = (await api('/tasks')).json.find((t) => t.id === fixId);
  await api(`/tasks/${fixId}`, { method: 'PATCH', data: { ...fix, subcontractorId: subs[0].id } });
  await api(`/tasks/${fixId}/comments`, { data: { body: 'GEHEIME-INTERNE-NOTIZ' } });
  const tok = (await api(`/tasks/${fixId}/share`, { method: 'POST' })).json.token;
  const pub = await fetch(`${BASE}/api/public/tasks/${tok}`).then((x) => x.text());
  check(pub.includes('E2E Behebung') && !pub.includes('GEHEIME-INTERNE-NOTIZ'), 'Link zeigt Aufgabe ohne Notizen');
  const ext = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ep = await ext.newPage();
  await ep.goto(`${BASE}/extern/${tok}`);
  await ep.getByText('E2E Behebung').first().waitFor();
  check(!(await ep.content()).includes('GEHEIME-INTERNE-NOTIZ'), 'Externe Seite ohne Notizen');
  await ext.close();

  step('Mehrfachbearbeitung');
  r = await api('/tasks/bulk', { data: { ids: [otherId, orderId, fixId], priority: 'high', assigneeId: P2.id, dueAt: Date.now() + 3 * DAY } });
  check(r.status === 200 && r.json.updated === 3, `3 Aufgaben geändert (${r.text.slice(0, 80)})`);
  tasks = (await api('/tasks')).json;
  check([otherId, orderId, fixId].every((x) => { const t = tasks.find((y) => y.id === x); return t.priority === 'high' && t.assigneeId === P2.id; }), 'Priorität und Zuständige übernommen');
  check((await notes(insp2))[0].title === '3 Aufgaben zugewiesen' || (await notes(insp2)).some((x) => /Aufgaben zugewiesen/.test(x.title)), 'Sammelmeldung an neue Zuständige');
  check((await api('/tasks/bulk', { data: { ids: [otherId] } })).status === 400, 'ohne Änderung abgelehnt');
  check((await api('/tasks/bulk', { data: { ids: [otherId], assigneeId: 'gibtsnicht123' } })).status === 400, 'fremde Zuständige abgelehnt');
  check((await viewer.api('/tasks/bulk', { data: { ids: [otherId], priority: 'low' } })).status === 403, 'Lesezugriff ohne Mehrfachbearbeitung');
  r = await api('/tasks/bulk', { data: { ids: [fixId], status: 'done', resolveDefects: false } });
  check(r.json.updated === 1 && (await api(`/defects/${freeDefect.id}`)).json.status === 'open', 'erledigt, Mangel bleibt auf Wunsch offen');
  await api('/tasks/bulk', { data: { ids: [fixId], status: 'open' } });

  step('Prüfauftrag: Prüfung starten erledigt den Auftrag');
  const iid = (await api(`/assets/${asset.id}/inspections`, { data: {} })).json.id;
  const draft = (await api(`/inspections/${iid}`)).json;
  r = await api(`/inspections/${iid}/submit`, {
    data: { kinds: ['periodic'], answers: Object.fromEntries(draft.checkpoints.map((c) => [c.id, 'ok'])), defects: [], notes: '', signature: SIG, signerName: 'E2E' },
  });
  check(r.status === 200, `Prüfung abgeschlossen (${r.status} ${r.text.slice(0, 100)})`);
  const doneOrder = (await api('/tasks')).json.find((t) => t.id === orderId);
  check(doneOrder.status === 'done' && doneOrder.closedAt, `Prüfauftrag automatisch erledigt (${doneOrder.status})`);

  step('Behebung dokumentieren (Notiz + Nachher-Foto), Detail und Verlauf');
  const photoKey = (await api('/files', { raw: PNG })).json.key;
  const target = openDefects.find((d) => d.id !== freeDefect.id && d.assetId && d.inspectionId);
  check((await viewer.api(`/defects/${target.id}`, { method: 'PATCH', data: { status: 'resolved' } })).status === 403, 'Lesezugriff kann nicht beheben');
  check((await api(`/defects/${target.id}`, { method: 'PATCH', data: { status: 'resolved', note: 'x', photoKey: 'fremd/123' } })).status === 400, 'fremder Dateischlüssel abgelehnt');
  r = await api(`/defects/${target.id}`, { method: 'PATCH', data: { status: 'resolved', note: 'Schließer getauscht (E2E)', photoKey } });
  check(r.status === 200, 'als behoben markiert');
  let det = (await api(`/defects/${target.id}`)).json;
  check(det.status === 'resolved' && det.resolutionNote === 'Schließer getauscht (E2E)' && det.resolutionPhotoKey === photoKey && det.resolvedByName === me.name, 'Behebung mit wer/wann gespeichert');
  check(Array.isArray(det.tasks) && det.history.some((h) => /behoben/.test(h.summary)) && det.history[0].action === 'create', `Detail mit Aufgaben und Verlauf (${det.history.length})`);
  const prot = (await api(`/inspections/${target.inspectionId}`)).json;
  check(prot.resolutions?.some((x) => x.note === 'Schließer getauscht (E2E)'), 'Protokoll kennt die Behebung');
  check((await viewer.api(`/defects/${target.id}`)).status === 200, 'Lesezugriff sieht Detail');

  step('Ausblenden: nur Admins, zählt nicht mehr mit');
  const dashBefore = (await api('/dashboard')).json;
  const hideMe = (await api('/defects')).json.find((d) => d.assetId && d.id !== freeDefect.id);
  check((await insp.api(`/defects/${hideMe.id}/hide`, { data: { reason: 'Duplikat' } })).status === 403, 'Prüfer darf nicht ausblenden');
  check((await viewer.api(`/defects/${hideMe.id}/hide`, { data: { reason: 'Duplikat' } })).status === 403, 'Lesezugriff darf nicht ausblenden');
  check((await api(`/defects/${hideMe.id}/hide`, { data: { reason: '' } })).status === 400, 'Grund ist Pflicht');
  check((await api(`/defects/${hideMe.id}/hide`, { data: { reason: 'Doppelt erfasst' } })).status === 200, 'Admin blendet aus');
  const dashAfter = (await api('/dashboard')).json;
  check(dashAfter.counts.openDefects === dashBefore.counts.openDefects - 1, `Zähler ohne ausgeblendete (${dashBefore.counts.openDefects} → ${dashAfter.counts.openDefects})`);
  check(!(await api('/defects')).json.some((d) => d.id === hideMe.id), 'nicht mehr in „Offen“');
  const hiddenList = (await api('/defects?hidden=1')).json;
  check(hiddenList.length === 1 && hiddenList[0].hiddenReason === 'Doppelt erfasst' && hiddenList[0].hiddenByName === me.name, 'unter „Ausgeblendet“ sichtbar');
  check((await api(`/defects/${hideMe.id}/unhide`, { method: 'POST' })).status === 200 && (await api('/defects')).json.some((d) => d.id === hideMe.id), 'wieder eingeblendet');
  await api(`/defects/${hideMe.id}/hide`, { data: { reason: 'Nicht relevant' } });

  step('Handlungsbedarf');
  const act = (await api('/smart/action-required')).json;
  check(act.length > 0 && ['defect', 'task', 'asset'].every((k) => act.some((x) => x.kind === k)), `alle drei Arten (${[...new Set(act.map((x) => x.kind))]})`);
  check(act.every((x, i) => i === 0 || act[i - 1].urgency >= x.urgency), 'nach Dringlichkeit sortiert');
  check(!act.some((x) => x.id === hideMe.id), 'ausgeblendete Mängel nicht enthalten');
  check((await api('/defects/action-required')).json.length === act.length, 'auch unter /defects/action-required');
  const vAct = (await viewer.api('/smart/action-required')).json;
  check(Array.isArray(vAct), 'Lesezugriff sieht Handlungsbedarf');

  step('MCP: briefing, update_defect mit Notiz, get, update_tasks');
  const key = (await api('/account/api-keys', { data: { name: 'E2E 14', scope: 'write', expiresInDays: 1 } })).json.key;
  let rpc = 0;
  const tool = async (name, args = {}) => {
    const res = await fetch(BASE + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }),
    }).then((x) => x.json());
    return res.result?.isError ? { error: res.result.content[0].text } : JSON.parse(res.result.content[0].text);
  };
  const brief = await tool('briefing');
  check(Array.isArray(brief.now) && brief.now.length > 0 && brief.now.length <= 12, 'briefing: „Jetzt“-Liste');
  const mDefect = (await api('/defects')).json.find((d) => d.id !== freeDefect.id);
  await tool('update_defect', { defectId: mDefect.id, action: 'resolve', note: 'per MCP behoben' });
  const mDet = await tool('get', { kind: 'defect', ref: mDefect.id });
  check(mDet.status === 'behoben' && mDet.resolution?.note === 'per MCP behoben', `update_defect mit Notiz (${mDet.status})`);
  const bulk = await tool('update_tasks', { taskIds: [otherId], priority: 'low' });
  check(bulk.updated === 1, `update_tasks (${JSON.stringify(bulk).slice(0, 80)})`);

  step('Oberfläche: Gruppen, „Meine“ und Filter-Menü');
  await api('/tasks', { data: { title: 'E2E heute fällig', dueAt: new Date(new Date().setHours(18, 0, 0, 0)).getTime(), assigneeId: me.id } });
  await p.goto(BASE + '/aufgaben');
  await p.getByRole('region', { name: 'Überfällig' }).or(p.locator('section[aria-label="Überfällig"]')).first().waitFor();
  check(await p.locator('section[aria-label="Fällig heute"]').getByText('E2E heute fällig').isVisible(), 'Gruppe „Fällig heute“');
  check((await p.locator('section h2').allTextContents()).join('|').startsWith('Überfällig'), 'Überfällig steht oben');
  // v3: kein SLA-Symbol in den Zeilen (das Datum trägt es), Label-Punkte immer neutral grau (ink-4)
  check((await p.locator('[data-task] [aria-label="SLA-Lösungsfrist überschritten"]').count()) === 0, 'kein SLA-Symbol in den Zeilen');
  const dots = await p.locator('[data-task] [data-label-dot]').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  check(dots.length > 0 && dots.every((c) => c === 'rgb(180, 180, 175)'), `Label-Punkte in Zeilen neutral (${[...new Set(dots)].join(', ')})`);
  // v3: nur „Meine“ ist sichtbar, alles andere im Filter-Menü
  check((await p.getByRole('button', { name: 'Ohne Zuständige', exact: true }).count()) === 0, 'Filter liegen im Menü, nicht als Knopfreihe');
  const filterBtn = p.getByRole('button', { name: /^Filter( \d+)?$/ });
  await filterBtn.click();
  const menu = p.getByRole('group', { name: 'Filter', exact: true });
  await menu.getByRole('button', { name: 'Ohne Zuständige', exact: true }).click();
  const unassigned = await p.locator('[data-task]').count();
  const expectUnassigned = (await api('/tasks')).json.filter((t) => ['open', 'in_progress'].includes(t.status) && !t.assigneeId && !t.subcontractorId).length;
  check(unassigned === expectUnassigned, `Filter „Ohne Zuständige“ (${unassigned}/${expectUnassigned})`);
  check((await filterBtn.textContent()).includes('1'), 'Filter-Knopf zeigt die Zahl gesetzter Filter');
  await menu.getByRole('button', { name: 'Ohne Zuständige', exact: true }).click();
  await p.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await p.getByRole('button', { name: 'Meine', exact: true }).click();
  const mineCount = await p.locator('[data-task]').count();
  const expectMine = (await api('/tasks')).json.filter((t) => ['open', 'in_progress'].includes(t.status) && t.assigneeId === me.id).length;
  check(mineCount === expectMine, `Schnellfilter „Meine“ (${mineCount}/${expectMine})`);
  await p.getByRole('button', { name: 'Meine', exact: true }).click();
  await filterBtn.click();
  await menu.getByRole('button', { name: 'Von mir erstellt', exact: true }).click();
  check((await p.locator('[data-task]').count()) > 0, 'Filter „Von mir erstellt“');
  await menu.getByRole('button', { name: 'Von mir erstellt', exact: true }).click();
  await menu.getByRole('group', { name: 'Nach Typ filtern' }).getByRole('button', { name: 'Prüfauftrag', exact: true }).click();
  check(await p.getByText(seededOrder.title).isVisible(), 'Typfilter Prüfauftrag');
  check((await p.locator('[data-task]').count()) === (await api('/tasks')).json.filter((t) => ['open', 'in_progress'].includes(t.status) && t.kind === 'inspection').length, 'Typfilter zeigt nur Prüfaufträge');
  await menu.getByRole('button', { name: 'Alle Typen', exact: true }).click();
  await p.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await p.screenshot({ path: OUT + '01-tasks.png', fullPage: true });

  step('Oberfläche: Prüfauftrag starten');
  await p.locator(`[data-task]`, { hasText: seededOrder.title }).getByRole('button', { name: seededOrder.title }).click();
  await p.getByRole('button', { name: 'Prüfung starten' }).click();
  await p.waitForURL(/\/pruefung\//);
  check(/\/pruefung\//.test(p.url()), 'Prüfung aus Prüfauftrag geöffnet');

  step('Oberfläche: Beobachten und @-Erwähnung mit Vorschlägen');
  await p.goto(BASE + '/aufgaben?id=' + otherId);
  const dlg = p.getByRole('dialog');
  await dlg.getByTestId('watchers').waitFor();
  await dlg.getByText(/Beobachtet von/).waitFor();
  await dlg.getByRole('button', { name: 'Nicht mehr beobachten' }).click();
  await dlg.getByRole('button', { name: 'Beobachten', exact: true }).waitFor();
  const box = dlg.getByLabel('Kommentar');
  await box.fill('Kannst du das prüfen @' + P1.name.slice(0, 3));
  await dlg.getByRole('listbox', { name: 'Teammitglied erwähnen' }).getByRole('option', { name: new RegExp(P1.name) }).click();
  check((await box.inputValue()).endsWith(`@${P1.name} `), `Name eingesetzt (${await box.inputValue()})`);
  await box.press('End');
  await box.type('bitte');
  await dlg.getByRole('button', { name: 'Senden' }).click();
  await dlg.locator('span', { hasText: `@${P1.name}` }).first().waitFor();
  const last = (await api(`/tasks/${otherId}/comments`)).json.at(-1);
  check(last.mentions.includes(P1.id), 'Erwähnung über die Oberfläche gespeichert');
  check((await notes(insp))[0].type === 'task_mention', 'Erwähnte Person benachrichtigt (UI)');
  await p.screenshot({ path: OUT + '02-task-mention.png' });
  await p.keyboard.press('Escape');

  step('Oberfläche: Suche, Tastatur und Eigenschaften direkt im Panel');
  await p.goto(BASE + '/aufgaben');
  await p.locator('[data-task]').first().waitFor();
  await p.getByRole('searchbox', { name: 'Suchen' }).fill('E2E heute');
  await p.locator('[data-task]', { hasText: 'E2E heute fällig' }).waitFor();
  check((await p.locator('[data-task]').count()) === 1, `Suche filtert die Liste (${await p.locator('[data-task]').count()})`);
  await p.getByRole('searchbox', { name: 'Suchen' }).fill('');
  await p.locator('[data-task] [data-row-main]').first().focus();
  await p.keyboard.press('ArrowDown');
  const focusedId = await p.evaluate(() => document.activeElement?.closest('[data-task]')?.getAttribute('data-task'));
  check(focusedId === (await p.locator('[data-task]').nth(1).getAttribute('data-task')), 'Pfeiltaste springt zur nächsten Zeile');
  await p.keyboard.press('x');
  await p.getByRole('region', { name: 'Mehrfachbearbeitung' }).getByText('1 ausgewählt').waitFor();
  await p.keyboard.press('Escape');
  await p.getByRole('region', { name: 'Mehrfachbearbeitung' }).waitFor({ state: 'detached' });
  await p.locator('[data-task]', { hasText: 'E2E heute fällig' }).locator('[data-row-main]').click();
  const pd = p.getByRole('dialog');
  await pd.getByLabel('Priorität').selectOption('low');
  let prioSaved = false;
  for (let i = 0; i < 20 && !prioSaved; i++) {
    prioSaved = (await api('/tasks')).json.find((t) => t.title === 'E2E heute fällig')?.priority === 'low';
    if (!prioSaved) await p.waitForTimeout(250);
  }
  check(prioSaved, 'Priorität im Panel sofort gespeichert');
  await pd.getByLabel('Titel').fill('E2E heute fällig (umbenannt)');
  await pd.getByLabel('Titel').press('Enter');
  await p.locator('[data-task]', { hasText: 'E2E heute fällig (umbenannt)' }).waitFor();
  await p.keyboard.press('Escape');
  await pd.waitFor({ state: 'detached' });

  step('Oberfläche: Mehrfachbearbeitung');
  await p.goto(BASE + '/aufgaben');
  const rows = p.locator('[data-task]');
  await rows.first().waitFor();
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  const bar = p.getByRole('region', { name: 'Mehrfachbearbeitung' });
  await bar.getByText('2 ausgewählt').waitFor();
  const ids2 = [await rows.nth(0).getAttribute('data-task'), await rows.nth(1).getAttribute('data-task')];
  await bar.getByLabel('Priorität für Auswahl').selectOption('low');
  await bar.getByRole('button', { name: 'Übernehmen' }).click();
  await p.getByText('2 Aufgaben geändert').waitFor();
  tasks = (await api('/tasks')).json;
  check(ids2.every((x) => tasks.find((t) => t.id === x)?.priority === 'low'), 'Priorität für Auswahl gesetzt');

  step('Oberfläche: Mängelbehebung erledigen → Mangel mit Notiz beheben');
  await p.locator('[data-task]', { hasText: 'E2E Behebung' }).getByRole('button', { name: 'Erledigen' }).click();
  const rd = p.getByRole('dialog');
  await rd.getByText('Mangel auch als behoben markieren?').waitFor();
  await rd.getByLabel('Behebungsnotiz').fill('Erledigt über die Aufgabe');
  await rd.getByLabel('Nachher-Foto').setInputFiles({ name: 'nachher.png', mimeType: 'image/png', buffer: PNG });
  await rd.getByRole('button', { name: 'Als behoben markieren' }).click();
  await p.getByText('Mangel als behoben markiert').waitFor();
  det = (await api(`/defects/${freeDefect.id}`)).json;
  check(det.status === 'resolved' && det.resolutionNote === 'Erledigt über die Aufgabe' && !!det.resolutionPhotoKey, 'Mangel mit Notiz und Foto behoben');
  check((await api('/tasks')).json.find((t) => t.id === fixId).status === 'done', 'Aufgabe erledigt');

  step('Oberfläche: Mängel – nach Dringlichkeit, Detail, Behebung, Ausblenden, PDF');
  // Der frühere Reiter „Handlungsbedarf“ ist in „Jetzt“ (Heute) aufgegangen; ein alter Link landet bei „Offen“
  await p.goto(BASE + '/maengel?tab=action');
  await p.getByRole('tab', { name: 'Offen', selected: true }).waitFor();
  check((await p.getByRole('tab', { name: 'Handlungsbedarf' }).count()) === 0, 'kein Reiter „Handlungsbedarf“');
  await p.locator('[data-defect]').first().waitFor();
  {
    // innerhalb einer Schwere: Mängel ohne offene Aufgabe vor denen mit Aufgabe
    const first = await p.locator('[data-defect]').first().innerText();
    const openList = (await api('/defects?status=open')).json;
    const topSev = ['critical', 'high', 'medium', 'low'].find((sv) => openList.some((d) => d.severity === sv));
    const sameSev = openList.filter((d) => d.severity === topSev);
    const free = sameSev.filter((d) => !d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled').sort((a, b) => a.createdAt - b.createdAt);
    const expected = (free[0] ?? sameSev.sort((a, b) => a.createdAt - b.createdAt)[0]).title;
    check(first.includes(expected), `nach Dringlichkeit sortiert (${expected})`);
  }
  await p.screenshot({ path: OUT + '03-action.png', fullPage: true });
  const card = p.locator('[data-defect]').filter({ has: p.getByRole('button', { name: 'Als behoben markieren' }) }).first();
  const title = (await card.locator('[data-title]').textContent()).trim();
  await card.locator('[data-row-main]').click();
  const drawer = p.locator('aside');
  await drawer.getByText('Verlauf').waitFor();
  await drawer.getByText('Bei der Prüfung erfasst').or(drawer.getByText('Erfasst', { exact: true })).first().waitFor();
  await drawer.getByRole('button', { name: 'Behoben' }).click();
  const rd2 = p.getByRole('dialog');
  await rd2.getByLabel('Behebungsnotiz').fill('Über Detail behoben');
  await rd2.getByLabel('Nachher-Foto').setInputFiles({ name: 'nachher.png', mimeType: 'image/png', buffer: PNG });
  await rd2.getByRole('button', { name: 'Als behoben markieren' }).click();
  await drawer.getByText('Über Detail behoben').first().waitFor();
  await drawer.getByRole('img', { name: 'Nachher' }).waitFor();
  const [dl] = await Promise.all([p.waitForEvent('download'), drawer.getByRole('button', { name: 'PDF' }).click()]);
  await dl.saveAs(OUT + 'mangel.pdf');
  const txt = execFileSync('pdftotext', [OUT + 'mangel.pdf', '-']).toString();
  check(/Behoben am/.test(txt) && /Über Detail behoben/.test(txt) && /Foto nach Behebung/.test(txt), `PDF enthält die Behebung (${txt.slice(0, 120).replace(/\s+/g, ' ')})`);
  await drawer.getByRole('button', { name: 'Ausblenden' }).click();
  const hd = p.getByRole('dialog').last();
  await hd.getByRole('button', { name: 'Doppelt erfasst' }).click();
  await hd.getByRole('button', { name: 'Ausblenden' }).click();
  await p.getByText('Mangel ausgeblendet', { exact: true }).first().waitFor();
  await drawer.getByText('Ausgeblendet', { exact: true }).first().waitFor();
  await p.screenshot({ path: OUT + '04-defect-drawer.png' });
  await p.keyboard.press('Escape');
  await p.getByRole('tab', { name: 'Ausgeblendet' }).click();
  await p.getByText(title).first().waitFor();

  step('Lesezugriff: Oberfläche ohne Bearbeiten');
  await viewer.p.goto(BASE + '/maengel');
  await viewer.p.getByRole('tab', { name: 'Offen' }).waitFor();
  check((await viewer.p.getByRole('button', { name: 'Behoben' }).count()) === 0, 'kein „Behoben“ für Lesezugriff');
  await viewer.p.goto(BASE + '/aufgaben?id=' + otherId);
  await viewer.p.getByRole('dialog').getByRole('button', { name: /Beobachten/ }).waitFor();
  check((await viewer.p.getByRole('dialog').getByRole('button', { name: 'Speichern' }).count()) === 0, 'kein Speichern für Lesezugriff');

  step('Handybreite 390 px');
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await owner.ctx.storageState() });
  const mp = await m.newPage();
  const wide = async (label) => {
    const wdt = await mp.evaluate(() => document.documentElement.scrollWidth);
    check(wdt <= 392, `${label}: kein horizontaler Überlauf (${wdt})`);
  };
  await mp.goto(BASE + '/aufgaben');
  await mp.locator('[data-task]').first().waitFor();
  await wide('/aufgaben');
  check((await mp.locator('[data-task]').nth(0).getByRole('checkbox').count()) === 0 || !(await mp.locator('[data-task]').nth(0).getByRole('checkbox').isVisible()), 'Handy: Auswahl erst im Auswahlmodus');
  await mp.getByRole('button', { name: 'Auswählen' }).click();
  await mp.locator('[data-task]').nth(0).getByRole('checkbox').check();
  await mp.getByRole('region', { name: 'Mehrfachbearbeitung' }).waitFor();
  await wide('/aufgaben mit Auswahl');
  await mp.screenshot({ path: OUT + '05-mobile-tasks.png', fullPage: true });
  // Wischen nach rechts erledigt eine Aufgabe (Touch)
  await mp.goto(BASE + '/aufgaben');
  const swipeRow = mp.locator('[data-task]', { hasText: 'E2E Sonstiges' }).locator('[data-row-main]');
  await swipeRow.waitFor();
  const bb = await swipeRow.boundingBox();
  const y = bb.y + bb.height / 2;
  const fire = (type, x) => swipeRow.dispatchEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: x, clientY: y, bubbles: true });
  await fire('pointerdown', 40);
  for (const x of [60, 90, 130, 170, 200]) {
    await fire('pointermove', x);
    await mp.waitForTimeout(30);
  }
  await fire('pointerup', 200);
  await mp.getByText('Erledigt', { exact: true }).first().waitFor();
  let swiped = false;
  for (let i = 0; i < 20 && !swiped; i++) {
    swiped = (await api('/tasks')).json.find((t) => t.id === otherId)?.status === 'done';
    if (!swiped) await mp.waitForTimeout(250);
  }
  check(swiped, 'Handy: Wischen nach rechts erledigt die Aufgabe');
  await api('/tasks/bulk', { data: { ids: [otherId], status: 'open' } });
  await mp.goto(BASE + '/aufgaben?id=' + otherId);
  await mp.getByRole('dialog').getByTestId('watchers').waitFor();
  await wide('Aufgabe geöffnet');
  for (const tab of ['Offen', 'Behoben', 'Ausgeblendet']) {
    await mp.goto(BASE + '/maengel');
    await mp.getByRole('tab', { name: tab }).click();
    await mp.waitForLoadState('networkidle');
    await wide(`/maengel ${tab}`);
  }
  await mp.goto(BASE + '/maengel?id=' + target.id);
  await mp.locator('aside').getByText('Verlauf').waitFor();
  await mp.waitForTimeout(800); // Einblend-Animation abwarten
  await wide('Mangel-Detail');
  await mp.screenshot({ path: OUT + '06-mobile-defect.png' });
  await m.close();

  check(!errors.length, `Browserfehler: ${errors.join(' | ')}`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
