// E2E 09-bulk: Massenoperationen und Wiederholungen (Ponytail-Audit) – doppelter Abschluss, Offline-Wiederholung,
// Archivieren/Löschen von über 100 Prüfungen, großer Import, Cron ohne doppelte SLA-Meldungen. Nur lokal.
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

(async () => {
  if (process.env.PROD) throw new Error('09-bulk nicht gegen Produktion ausführen');
  check((await api('/auth/login', { body: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } })).status === 200, 'Login');
  const assets = (await api('/assets')).json;
  const cats = (await api('/categories')).json;
  const cpsOf = (cat) => cats.find((c) => c.key === cat).checkpoints;

  console.log('· Doppelter Abschluss erzeugt keine doppelten Mängel');
  const a = assets.find((x) => x.category === 'smoke_alarm');
  const iid = (await api(`/assets/${a.id}/inspections`, { body: {} })).json.id;
  const cps = cpsOf('smoke_alarm');
  const png = Buffer.from(SIG.split(',')[1], 'base64');
  const up = await fetch(BASE + '/api/files', { method: 'POST', headers: { 'x-pk': '1', cookie, 'content-type': 'image/png' }, body: png }).then((r) => r.json());
  const draft = {
    kind: 'periodic',
    answers: Object.fromEntries(cps.map((cp, i) => [cp.id, i < 2 ? 'defect' : 'ok'])),
    defects: cps.slice(0, 2).map((cp) => ({ checkpointId: cp.id, title: cp.label, note: '', measure: 'tauschen', severity: 'medium' })),
    photos: [{ key: up.key, caption: 'Übersicht' }],
    signature: SIG,
    signerName: 'Test',
  };
  await api(`/inspections/${iid}`, { method: 'PUT', body: draft });
  const both = await Promise.all([api(`/inspections/${iid}/submit`, { body: draft }), api(`/inspections/${iid}/submit`, { body: draft })]);
  const codes = both.map((r) => r.status).sort();
  check(codes[0] === 200 && codes[1] === 409, `einmal 200, einmal 409 (${codes})`);
  const defs = (await api('/defects?status=all')).json.filter((d) => d.inspectionId === iid);
  check(defs.length === 2 && defs.every((d) => d.measure === 'tauschen'), `genau 2 Mängel mit Maßnahme (${defs.length})`);
  const photos = (await api('/inspections/' + iid)).json.photos ?? [];
  const att = (await api('/assets/' + a.id)).json.attachments.filter((x) => x.fileKey === up.key || x.key === up.key);
  check(photos.length === 1 && att.length === 1, `Foto genau einmal als Anhang (${photos.length}/${att.length})`);

  console.log('· Offline-Abschluss: Wiederholung mit derselben clientId');
  const b = assets.find((x) => x.category === 'extinguisher');
  const ecps = cpsOf('extinguisher');
  const off = {
    ...draft,
    answers: Object.fromEntries(ecps.map((cp, i) => [cp.id, i === 0 ? 'defect' : 'ok'])),
    defects: [{ checkpointId: ecps[0].id, title: ecps[0].label, note: '', measure: '', severity: 'low' }],
    clientId: `e2e-${Date.now()}`,
    assetId: b.id,
    schedule: 'main',
    inspectedAt: Date.now() - 60_000,
    checkpoints: ecps,
  };
  const o1 = await api('/inspections/offline', { body: off });
  const o2 = await api('/inspections/offline', { body: off });
  check(o1.status === 200 && o2.json?.duplicate === true && o2.json.id === o1.json.id, 'zweiter Versuch erkannt');
  check((await api('/defects?status=all')).json.filter((d) => d.inspectionId === o1.json.id).length === 1, 'Mangel nicht doppelt');

  console.log('· Archivieren und Löschen von über 100 Prüfungen');
  const done = (await api('/inspections?status=submitted')).json;
  const ids = done.map((i) => i.id);
  console.log(`   ${ids.length} Prüfungen`);
  check(ids.length > 100, 'mehr als 100 Prüfungen im Demobestand');
  const arch = await api('/inspections/archive', { body: { ids, archived: true } });
  check(arch.status === 200 && arch.json.changed === ids.length, `alle archiviert (${arch.json?.changed})`);
  await api('/inspections/archive', { body: { ids, archived: false } });
  const del = await api('/inspections/batch-delete', { body: { ids } });
  check(del.status === 200 && del.json.deleted === ids.length, `alle gelöscht (${del.json?.deleted})`);
  const after = (await api('/assets')).json;
  const stale = after.filter((x) => x.lastInspectedAt != null || x.lastResult != null);
  check(stale.length === 0, `alle Elemente neu berechnet (${stale.length} mit alten Werten)`);
  check((await api('/defects?status=all')).json.every((d) => !d.inspectionId), 'Mängel der gelöschten Prüfungen entfernt');

  console.log('· Großer Import: 400 Zeilen ohne Code, eine mit Code eines gelöschten Elements');
  const victim = after.find((x) => x.category === 'damper');
  check((await api(`/assets/${victim.id}`, { method: 'DELETE' })).status === 200, 'Element gelöscht');
  const rows = Array.from({ length: 400 }, (_, i) => ({ line: i + 2, property: 'Importpark', building: `Halle ${1 + (i % 4)}`, category: 'extinguisher', location: `Platz ${i}`, floor: 'EG', manufacturer: '', model: '' }));
  rows.splice(4, 0, { line: 999, property: 'Importpark', building: 'Halle 1', category: 'damper', code: victim.code, location: 'x', floor: '', manufacturer: '', model: '' });
  rows.push({ line: 1000, property: 'Importpark', building: 'Halle 1', category: 'gibt_es_nicht', location: 'y', floor: '', manufacturer: '', model: '' });
  const dry = await api('/import/assets', { body: { rows, dryRun: true } });
  check(dry.status === 200 && dry.json.summary.created === 400 && dry.json.summary.failed === 2, `Probelauf 400 ok / 2 Fehler (${JSON.stringify(dry.json?.summary)})`);
  check(dry.json.results.some((r) => r.line === 999 && /existiert bereits/.test(r.message)), 'gelöschter Code erkannt, mit Originalzeile');
  const real = await api('/import/assets', { body: { rows, dryRun: false } });
  check(real.status === 200 && real.json.summary.created === 400, `Import 400 Elemente (${real.status})`);
  const props = (await api('/properties')).json.filter((p) => p.name === 'Importpark');
  check(props.length === 1 && props[0].assets === 400, `ein Objekt mit 400 Elementen (${props.length}, ${props[0]?.assets})`);

  console.log('· Cron: SLA-Meldungen nicht doppelt');
  const run = () => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=15+5+*+*+*`);
  const r1 = await run();
  if (r1.status === 404) console.log('   (Cron-Endpunkt nur im Dev-Server – übersprungen)');
  else {
    const n1 = (await api('/notifications')).json.items.filter((n) => n.type === 'sla_breach').length;
    await run();
    const n2 = (await api('/notifications')).json.items.filter((n) => n.type === 'sla_breach').length;
    check(n1 > 0 && n1 === n2, `SLA-Meldungen ${n1} → ${n2}`);
  }

  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
