// E2E 11-ai-mcp: MCP-Server (API-Schlüssel, Werkzeuge, Rechte), Diktat-Strukturierung, smarte Vorschläge,
// Rundgänge und automatische Aufgaben. Lokal ohne Workers AI → Regel-Parser. Nur lokal.
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const BASE = process.env.BASE || 'http://localhost:5173';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const step = (m) => console.log('·', m);

let cookie = '';
async function api(path, { method, body } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-pk': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.startsWith('pk_session')) cookie = sc.split(';')[0];
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: null, text };
  }
}
let rpcId = 0;
async function mcp(key, method, params, { path } = {}) {
  const r = await fetch(BASE + (path ?? '/api/mcp'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(path ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const call = async (key, name, args = {}, opts) => {
  const r = await mcp(key, 'tools/call', { name, arguments: args }, opts);
  const res = r.json?.result;
  return { ...r, isError: res?.isError, data: res && !res.isError ? JSON.parse(res.content[0].text) : null, text: res?.content?.[0]?.text };
};

(async () => {
  if (process.env.PROD) throw new Error('11-ai-mcp nicht gegen Produktion ausführen');
  check((await api('/auth/login', { body: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } })).status === 200, 'Login');
  const write = (await api('/account/api-keys', { body: { name: 'MCP Test', scope: 'write', expiresInDays: 1 } })).json.key;
  const read = (await api('/account/api-keys', { body: { name: 'MCP Lesen', scope: 'read', expiresInDays: 1 } })).json.key;

  step('MCP: Handshake und Werkzeugliste');
  let r = await mcp(write, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  check(r.status === 200 && r.json.result.serverInfo.name === 'pruefkompass' && r.json.result.capabilities.tools, `initialize (${r.status})`);
  r = await fetch(BASE + '/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${write}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  check(r.status === 202, `Notification → 202 (${r.status})`);
  r = await mcp(write, 'tools/list');
  const tools = r.json.result.tools.map((t) => t.name);
  check(tools.length >= 21 && tools.includes('create_task') && tools.includes('plan_rounds'), `Werkzeuge (${tools.length})`);
  check(r.json.result.tools.every((t) => t.inputSchema?.type === 'object' && t.description), 'Schemas und Beschreibungen vollständig');
  check((await mcp('pk_falsch_' + 'x'.repeat(40), 'tools/list')).status === 401, 'falscher Schlüssel → 401');
  check((await fetch(BASE + '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401, 'ohne Schlüssel → 401');
  check((await mcp(write, 'gibt/es/nicht')).json.error?.code === -32601, 'unbekannte Methode → -32601');

  step('MCP: Werkzeuge');
  let t = await call(write, 'dashboard');
  check(t.data?.counts && typeof t.data.counts.overdue === 'number', 'dashboard');
  t = await call(write, 'list_assets', { due: 'overdue' });
  check(Array.isArray(t.data) && t.data.length > 0, `list_assets overdue (${t.data?.length})`);
  const asset = t.data[0];
  t = await call(write, 'get_asset', { code: asset.code });
  check(t.data?.id === asset.id && Array.isArray(t.data.inspections), 'get_asset per Code');
  t = await call(write, 'search', { query: asset.code.slice(0, 4) });
  check(t.data?.assets?.length > 0, 'search');
  t = await call(write, 'plan_rounds', { days: 30 });
  check(Array.isArray(t.data) && t.data[0]?.assets?.length > 0 && t.data[0].buildingName, 'plan_rounds');
  t = await call(write, 'create_task', { title: 'MCP: Schließer prüfen', priority: 'high', dueDate: '2030-01-15', assetCode: asset.code });
  check(t.data?.id, `create_task (${t.text?.slice(0, 80)})`);
  const taskId = t.data?.id;
  t = await call(write, 'update_task_status', { taskId, status: 'in_progress' });
  check(!t.isError, `update_task_status (${t.text?.slice(0, 80)})`);
  t = await call(write, 'add_task_comment', { taskId, comment: 'Über Claude angelegt' });
  check(!t.isError, 'add_task_comment');
  const tasks = (await api('/tasks')).json;
  const mine = tasks.find((x) => x.id === taskId);
  check(mine?.status === 'in_progress' && mine.assetId === asset.id && mine.priority === 'high', 'Aufgabe korrekt in der App');
  t = await call(write, 'structure_dictation', { text: 'Tür schließt nicht. Dichtung fehlt, gering.' });
  check(t.data?.items?.length === 2 && t.data.source === 'rules', `structure_dictation (${t.data?.source})`);
  t = await call(write, 'report_defect', { title: 'MCP: Feuerlöscher fehlt', severity: 'high', assetCode: asset.code, measure: 'Ersetzen' });
  check(t.data?.id && t.data.taskCreated === true, `report_defect mit Auto-Aufgabe (${t.text?.slice(0, 80)})`);
  t = await call(write, 'get_suggestions');
  check(Array.isArray(t.data), 'get_suggestions');
  t = await call(read, 'list_action_required', { limit: 10 });
  check(Array.isArray(t.data) && t.data.length > 0 && t.data.length <= 10 && t.data[0].urgency >= t.data.at(-1).urgency, `list_action_required (${t.data?.length})`);
  const newDefect = (await call(write, 'list_defects', {})).data.find((d) => d.title === 'MCP: Feuerlöscher fehlt');
  t = await call(write, 'resolve_defect', { defectId: newDefect.id, note: 'Neuer Löscher montiert' });
  check(!t.isError, 'resolve_defect mit Notiz');
  t = await call(read, 'get_defect', { defectId: newDefect.id });
  check(t.data?.status === 'resolved' && t.data.resolutionNote === 'Neuer Löscher montiert' && Array.isArray(t.data.history), 'get_defect zeigt Behebung');
  t = await call(read, 'resolve_defect', { defectId: newDefect.id, reopen: true });
  check(t.isError === true, 'Leseschlüssel darf nicht beheben');
  t = await call(write, 'bulk_update_tasks', { taskIds: [taskId], priority: 'medium' });
  check(t.data?.updated === 1, `bulk_update_tasks (${t.text?.slice(0, 60)})`);
  t = await call(read, 'report_defect', { title: 'darf nicht', severity: 'low', assetCode: asset.code });
  check(t.isError === true, 'Leseschlüssel darf keinen Mangel melden');
  t = await call(read, 'create_task', { title: 'darf nicht' });
  check(t.isError === true && /Berechtigung/.test(t.text), `Leseschlüssel darf nicht schreiben (${t.text?.slice(0, 60)})`);
  t = await call(read, 'list_defects', {});
  check(Array.isArray(t.data), 'Leseschlüssel darf lesen');
  t = await call(write, 'list_tasks', {});
  check(t.data.every((x) => !('shareToken' in x)), 'keine Freigabe-Tokens über MCP');
  t = await call(write, 'get_asset', { code: 'GIBT-NIX' });
  check(t.isError === true, 'Fehler als isError statt Abbruch');

  step('MCP: Schlüssel im Pfad');
  r = await mcp(null, 'tools/list', undefined, { path: `/api/mcp/k/${write}` });
  check(r.status === 200 && r.json.result.tools.length === tools.length, `Pfad-Variante (${r.status})`);
  check((await mcp(null, 'tools/list', undefined, { path: '/api/mcp/k/pk_falsch' })).status === 401, 'Pfad-Variante falscher Schlüssel');
  await api(`/account/api-keys/${(await api('/account/api-keys')).json.find((k) => k.name === 'MCP Test').id}`, { method: 'DELETE' });
  check((await mcp(write, 'tools/list')).status === 401, 'widerrufener Schlüssel → 401');

  step('Diktat-Endpunkte (ohne Workers AI)');
  check((await api('/ai/status')).json.structure === 'rules', 'Status: Regel-Parser');
  r = await api('/ai/parse', { body: { text: 'Fluchtweg versperrt, Gefahr im Verzug. Hausmeister anrufen bis morgen.', checkpoints: [] } });
  check(r.json.items[0].severity === 'critical' && r.json.items[1].kind === 'task' && r.json.items[1].dueInDays === 1, 'parse: Schwere und Aufgabe');
  r = await fetch(BASE + '/api/ai/transcribe', { method: 'POST', headers: { 'x-pk': '1', cookie, 'content-type': 'audio/webm' }, body: new Uint8Array(10) });
  check(r.status === 503, `transcribe ohne KI → 503 (${r.status})`);

  step('Vorschläge und automatische Aufgaben');
  r = await api('/smart/suggestions');
  check(Array.isArray(r.json) && r.json.some((s) => s.kind === 'round'), `Vorschläge mit Rundgang (${r.json?.map((s) => s.kind)})`);
  const a2 = (await api('/assets')).json.find((x) => x.category === 'smoke_alarm');
  const iid = (await api(`/assets/${a2.id}/inspections`, { body: {} })).json.id;
  const cps = (await api('/categories')).json.find((c) => c.key === 'smoke_alarm').checkpoints;
  r = await api(`/inspections/${iid}/submit`, {
    body: {
      kinds: ['periodic'],
      answers: Object.fromEntries(cps.map((cp, i) => [cp.id, i === 0 ? 'defect' : 'ok'])),
      defects: [{ checkpointId: cps[0].id, title: 'Melder fehlt', note: '', measure: 'Neu montieren', severity: 'critical' }],
      signature: SIG,
      signerName: 'E2E',
    },
  });
  check(r.status === 200, `Prüfung mit kritischem Mangel (${r.status})`);
  const auto = (await api('/tasks')).json.filter((x) => x.assetId === a2.id && /Neu montieren/.test(x.title));
  check(auto.length === 1 && auto[0].priority === 'high' && auto[0].defectId, `Aufgabe automatisch angelegt (${auto.length})`);
  r = await api('/smart/tasks-from-defects', { body: { severities: ['high', 'critical'] } });
  check(r.status === 200 && typeof r.json.created === 'number', `Aufgaben aus Mängeln (${r.json?.created})`);
  const again = await api('/smart/tasks-from-defects', { body: { severities: ['high', 'critical'] } });
  check(again.json.created === 0, 'keine doppelten Aufgaben');

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
