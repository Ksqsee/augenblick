// E2E 23-sprache: Sprache zuerst über Claude (docs/plan/v4.md, Abschnitt 8). Ablauf wie vor Ort:
// tour → inspect ×2 über MCP → Liste „bereit zur Unterschrift“ → eine Unterschrift in der App für alle →
// Protokolle, Termine, Autopilot-Aufgaben. Dazu: unvollständig gespeichert → nicht mehr bereit, API-Schlüssel
// unterschreibt nie, fremde/abgeschlossene IDs werden je ID abgelehnt; Einstellungen → API auf 390 px. Nur lokal.
const { chromium } = require('playwright');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '23-sprache') + '/';
fs.mkdirSync(OUT, { recursive: true });
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
async function api(path, { method, body, headers = {} } = {}) {
  const r = await fetch(BASE + '/api' + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-pk': '1', cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
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
let key = '';
async function tool(name, args) {
  const r = await fetch(BASE + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }).then((x) => x.json());
  const res = r.result;
  return { isError: res?.isError, text: res?.content?.[0]?.text ?? r.error?.message, data: res && !res.isError ? JSON.parse(res.content[0].text) : null };
}

(async () => {
  if (process.env.PROD) throw new Error('23-sprache nicht gegen Produktion ausführen');
  check((await api('/auth/login', { body: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } })).status === 200, 'Login');
  key = (await api('/account/api-keys', { body: { name: 'Claude Handy', scope: 'write', expiresInDays: 1 } })).json.key;

  step('briefing → Rundgang wählen');
  let t = await tool('briefing', {});
  check(t.data?.counts && Array.isArray(t.data.now), 'briefing');
  const round = (await api('/smart/rounds?days=14')).json.find((r) => r.assets.length >= 3);
  check(!!round, 'Rundgang mit mindestens 3 Elementen');
  const building = `${round.propertyName} ${round.buildingName}`;

  step('tour → inspect ×2 (+ eines unvollständig)');
  t = await tool('tour', { action: 'start', building });
  const e1 = t.data?.element;
  check(e1?.code && e1.checkpoints.length > 0 && e1.location !== undefined, `tour start (${t.text?.slice(0, 160)})`);
  t = await tool('inspect', { asset: e1.code, allOk: true, defects: [{ title: 'Sprache: Feststellanlage löst nicht aus', severity: 'high', measure: 'Feststellanlage instand setzen' }] });
  check(t.data?.status?.startsWith('bereit'), `inspect 1 bereit (${t.text?.slice(0, 160)})`);
  const i1 = t.data?.inspectionId;
  t = await tool('tour', { action: 'next', building });
  const e2 = t.data?.element;
  check(e2?.code && e2.code !== e1.code, `tour next (${e2?.code})`);
  // bekannter Mangel am zweiten Element, der bei der Prüfung als behoben gemeldet wird
  const e2id = (await api(`/assets/by-code/${e2.code}`)).json.id;
  const old = (await api('/defects', { body: { assetId: e2id, title: 'Sprache Altmangel Beschilderung', severity: 'low', force: true } })).json.id;
  t = await tool('inspect', { asset: e2.code, allOk: true, known: [{ defect: 'Altmangel', status: 'fixed' }], notes: 'Per Sprache geprüft' });
  check(t.data?.status?.startsWith('bereit') && t.data.fixed?.includes('Sprache Altmangel Beschilderung'), `inspect 2 bereit, Altmangel behoben gemeldet (${t.text?.slice(0, 200)})`);
  const i2 = t.data?.inspectionId;
  t = await tool('tour', { action: 'next', building });
  const e3 = t.data?.element;
  check(e3?.code && ![e1.code, e2.code].includes(e3.code), `tour überspringt Erledigtes (${e3?.code})`);
  t = await tool('inspect', { asset: e3.code, allOk: true });
  const i3 = t.data?.inspectionId;
  check(t.data?.status?.startsWith('bereit'), 'inspect 3 bereit');
  t = await tool('tour', { action: 'status', building });
  check([e1, e2, e3].every((e) => t.data?.readyToSign?.includes(e.code)) && /^3 von/.test(t.data.progress), `tour status (${t.data?.progress})`);

  step('bereit zur Unterschrift: Liste, unvollständig → nicht mehr bereit');
  let ready = (await api('/inspections?status=ready')).json;
  check([i1, i2, i3].every((id) => ready.some((x) => x.id === id)), `alle drei bereit (${ready.length})`);
  const d3 = (await api(`/inspections/${i3}`)).json;
  let r = await api(`/inspections/${i3}`, { method: 'PUT', body: { kinds: d3.kinds, answers: {}, notes: '' } });
  check(r.status === 200 && r.json.ready === false && r.json.missing.length > 0, `unvollständig gespeichert → nicht bereit (${JSON.stringify(r.json)})`);
  ready = (await api('/inspections?status=ready')).json;
  check(!ready.some((x) => x.id === i3) && (await api(`/inspections/${i3}`)).json.readyAt === null, 'aus der Liste genommen');
  r = await api(`/inspections/${i3}`, { method: 'PUT', body: { kinds: d3.kinds, answers: d3.answers, notes: '', ready: true } });
  check(r.json?.ready === true, 'mit ready: true wieder bereit');
  r = await api(`/inspections/${i3}`, { method: 'PUT', body: { kinds: d3.kinds, answers: d3.answers, notes: '', ready: false } });
  check(r.json?.ready === false, 'ready: false nimmt zurück');

  step('Unterschrift: nie per Schlüssel, eine für alle in der App');
  r = await fetch(BASE + '/api/inspections/sign', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ids: [i1, i2], signature: SIG }) });
  check(r.status === 403, `API-Schlüssel → 403 (${r.status})`);
  check((await api(`/inspections/${i1}`)).json.status === 'draft', 'noch nicht abgeschlossen');
  r = await api('/inspections/sign', { body: { ids: [i1, i2, i3, 'zzzzzzzzzzzzzzzz'], signature: SIG, signerName: 'Sabine Krüger' } });
  check(r.status === 200 && r.json.signed.length === 2 && r.json.failed.length === 2, `2 unterschrieben, 2 abgelehnt (${JSON.stringify(r.json).slice(0, 200)})`);
  check(r.json.failed.some((f) => f.id === i3) && r.json.failed.some((f) => f.id === 'zzzzzzzzzzzzzzzz'), 'nicht bereite und unbekannte IDs je ID gemeldet');
  const p1 = (await api(`/inspections/${i1}`)).json;
  const p2 = (await api(`/inspections/${i2}`)).json;
  check(p1.status === 'submitted' && p1.signature === SIG && p1.signerName === 'Sabine Krüger' && p1.result === 'defects', `Protokoll 1 (${p1.status} ${p1.result})`);
  check(p2.status === 'submitted' && p2.result === 'ok' && /Per Sprache geprüft/.test(p2.notes), `Protokoll 2 (${p2.status} ${p2.result})`);
  check(p1.nextDueAt > Date.now() && p2.nextDueAt > Date.now(), 'nächste Termine gesetzt');
  check((await api('/defects?status=resolved')).json.some((d) => d.id === old), 'bekannter Mangel beim Unterschreiben behoben');
  const auto = (await api('/tasks')).json.filter((x) => x.defectTitle === 'Sprache: Feststellanlage löst nicht aus');
  check(auto.length === 1 && auto[0].priority === 'high', `Autopilot: Aufgabe für den schweren Mangel (${auto.length})`);
  r = await api('/inspections/sign', { body: { ids: [i1], signature: SIG } });
  check(r.json.signed.length === 0 && r.json.failed[0].id === i1, 'zweite Unterschrift abgelehnt');
  r = await api('/inspections/sign', { body: { ids: [], signature: SIG } });
  check(r.status === 400, 'leere Liste → 400');
  t = await tool('tour', { action: 'status', building });
  // (Elemente mit weiterer fälliger Prüfart – z. B. Feuerlöscher – bleiben für diese im Rundgang)
  check(!t.data?.readyToSign?.length && /^0 von/.test(t.data?.progress ?? ''), `danach nichts mehr bereit (${t.text?.slice(0, 200)})`);
  const e2Due = (await api(`/assets/${e2id}`)).json;
  check(!t.data?.remaining?.some((x) => x.startsWith(e2.code + ' ')) || (e2Due.nextDueAt ?? 0) < Date.now() + 14 * 86_400_000, 'geprüftes Element nur noch mit weiterer Fälligkeit im Rundgang');
  await api(`/inspections/${i3}`, { method: 'DELETE' });

  step('Einstellungen → API auf 390 px');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), domain: host, path: '/' }]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(BASE + '/einstellungen?tab=api');
  await p.getByRole('list', { name: 'Beispiele' }).waitFor();
  await p.getByText('Werkzeuge, Befehle und Claude Code').click();
  await p.getByRole('list', { name: 'MCP-Werkzeuge' }).getByText('inspect', { exact: true }).waitFor();
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `kein horizontaler Überlauf (${over}px)`);
  await p.screenshot({ path: OUT + 'm1-api.png', fullPage: true });
  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
