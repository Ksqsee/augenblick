// E2E 15-oauth: OAuth 2.1 für den MCP-Server – Metadaten, dynamische Registrierung, Freigabe mit API-Schlüssel
// und mit Anmeldung (neue Verbindung), PKCE, Token, Refresh-Rotation, Widerruf, Angriffsfälle, Freigabeseite (1360/390 px). Nur lokal.
const { chromium } = require('playwright');
const crypto = require('crypto');
if (!process.env.DEMO_PASSWORD) throw new Error('DEMO_PASSWORD fehlt');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = require('path').join(__dirname, '.out', '15-oauth') + '/';
fs.mkdirSync(OUT, { recursive: true });
const step = (m) => console.log('·', m);
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log('  ✗', m);
  }
};
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
};
const form = (o) => new URLSearchParams(o).toString();
const REDIRECT = 'http://127.0.0.1:33418/callback';

let cookie = '';
async function api(path, { method, body, headers } = {}) {
  const r = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'x-pk': '1', cookie, ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.startsWith('pk_session')) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { status: r.status, json, headers: r.headers };
}
const token = (o) => fetch(BASE + '/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(o) }).then(async (r) => ({ status: r.status, json: await r.json() }));
const mcp = (bearer, method = 'tools/list') =>
  fetch(BASE + '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) }).then(async (r) => ({
    status: r.status,
    www: r.headers.get('www-authenticate'),
    json: await r.json().catch(() => null),
  }));

(async () => {
  if (process.env.PROD) throw new Error('15-oauth nicht gegen Produktion ausführen');

  step('Metadaten und 401 mit Hinweis');
  let r = await mcp(null);
  check(r.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/.test(r.www ?? ''), `401 mit resource_metadata (${r.www})`);
  const prm = await api('/.well-known/oauth-protected-resource/api/mcp');
  check(prm.status === 200 && prm.json.resource.endsWith('/api/mcp') && prm.json.authorization_servers.length === 1, 'Protected Resource Metadata');
  const asm = await api('/.well-known/oauth-authorization-server');
  check(asm.status === 200 && asm.json.code_challenge_methods_supported.includes('S256') && asm.json.registration_endpoint.endsWith('/api/oauth/register'), 'Authorization Server Metadata');

  step('Dynamische Registrierung');
  r = await api('/api/oauth/register', { body: { client_name: 'Claude', redirect_uris: [REDIRECT] }, headers: { 'x-pk': '' } });
  check(r.status === 201 && r.json.client_id?.startsWith('pkc_'), `Registrierung (${r.status})`);
  const clientId = r.json.client_id;
  check((await api('/api/oauth/register', { body: { redirect_uris: ['http://evil.example.com/cb'] } })).status === 400, 'http-Fremdadresse abgelehnt');
  check((await api('/api/oauth/register', { body: { redirect_uris: ['javascript:alert(1)'] } })).status === 400, 'javascript:-Adresse abgelehnt');

  check((await api('/api/auth/login', { body: { email: 'demo@example.com', password: process.env.DEMO_PASSWORD } })).status === 200, 'Login');
  const write = (await api('/api/account/api-keys', { body: { name: 'OAuth Test', scope: 'write', expiresInDays: 1 } })).json.key;
  const read = (await api('/api/account/api-keys', { body: { name: 'OAuth Lesen', scope: 'read', expiresInDays: 1 } })).json.key;

  step('Freigabe mit vorhandenem Schlüssel → Code → Token');
  let pk = pkce();
  const base = { clientId, redirectUri: REDIRECT, codeChallenge: pk.challenge, codeChallengeMethod: 'S256', state: 'xyz' };
  const saved = cookie;
  cookie = ''; // ohne Sitzung
  r = await api('/api/oauth/authorize/key', { body: { ...base, apiKey: 'pk_falsch' } });
  check(r.status === 400, 'falscher Schlüssel abgelehnt');
  r = await api('/api/oauth/authorize/key', { body: { ...base, redirectUri: 'http://127.0.0.1:1/andere' , apiKey: write } });
  check(r.status === 400, 'nicht registrierte Rücksprungadresse abgelehnt');
  r = await api('/api/oauth/authorize/key', { body: { ...base, apiKey: write } });
  check(r.status === 200 && r.json.redirectTo.startsWith(REDIRECT), `Code ausgestellt (${r.status})`);
  let u = new URL(r.json.redirectTo);
  check(u.searchParams.get('state') === 'xyz', 'state zurückgegeben');
  let code = u.searchParams.get('code');
  r = await token({ grant_type: 'authorization_code', code, code_verifier: 'falsch'.repeat(8), client_id: clientId, redirect_uri: REDIRECT });
  check(r.status === 400 && r.json.error === 'invalid_grant', 'falscher PKCE-Verifier abgelehnt');
  r = await token({ grant_type: 'authorization_code', code, code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT });
  check(r.status === 400, 'Code nach Fehlversuch verbraucht (einmalig)');
  // neuer Code, korrekt
  pk = pkce();
  r = await api('/api/oauth/authorize/key', { body: { ...base, codeChallenge: pk.challenge, apiKey: write } });
  code = new URL(r.json.redirectTo).searchParams.get('code');
  r = await token({ grant_type: 'authorization_code', code, code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT });
  check(r.status === 200 && r.json.access_token?.startsWith('pko_') && r.json.refresh_token?.startsWith('pkr_') && r.json.token_type === 'Bearer', `Token (${r.status})`);
  let tok = r.json;
  check((await token({ grant_type: 'authorization_code', code, code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT })).status === 400, 'Code nicht wiederverwendbar');

  step('MCP mit Access-Token');
  r = await mcp(tok.access_token);
  check(r.status === 200 && r.json.result.tools.length > 10, `tools/list mit OAuth (${r.status})`);
  r = await fetch(BASE + '/api/tasks', { headers: { authorization: `Bearer ${tok.access_token}` } });
  check(r.status === 200, 'REST-API mit Access-Token');
  check((await mcp('pko_falsch')).status === 401, 'falsches Token → 401');

  step('Refresh mit Rotation');
  r = await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId });
  check(r.status === 200 && r.json.access_token !== tok.access_token, 'Refresh liefert neues Token');
  const old = tok;
  tok = r.json;
  check((await token({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: clientId })).status === 400, 'altes Refresh-Token ungültig (Rotation)');
  check((await mcp(tok.access_token)).status === 200, 'neues Access-Token gültig');

  step('Lesender Schlüssel bleibt lesend');
  pk = pkce();
  r = await api('/api/oauth/authorize/key', { body: { ...base, codeChallenge: pk.challenge, apiKey: read } });
  r = await token({ grant_type: 'authorization_code', code: new URL(r.json.redirectTo).searchParams.get('code'), code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT });
  check(r.json.scope === 'read', 'scope read');
  const readTok = r.json.access_token;
  r = await fetch(BASE + '/api/tasks', { method: 'POST', headers: { authorization: `Bearer ${readTok}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'darf nicht' }) });
  check(r.status === 403, `Schreiben mit Lese-Token verboten (${r.status})`);

  step('Neue Verbindung mit Anmeldung (Admin)');
  cookie = saved;
  pk = pkce();
  check((await api('/api/oauth/authorize/session', { body: { ...base, codeChallenge: pk.challenge, scope: 'write' }, headers: { 'x-pk': '' } })).status === 403, 'ohne CSRF-Header abgelehnt');
  r = await api('/api/oauth/authorize/session', { body: { ...base, codeChallenge: pk.challenge, scope: 'write' } });
  check(r.status === 200, `Freigabe mit Sitzung (${r.status})`);
  r = await token({ grant_type: 'authorization_code', code: new URL(r.json.redirectTo).searchParams.get('code'), code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT });
  check(r.status === 200, 'Token für neue Verbindung');
  const sessTok = r.json;
  const keys = (await api('/api/account/api-keys')).json;
  const conn = keys.find((k) => k.name.startsWith('Claude (verbunden'));
  check(!!conn, 'Verbindung erscheint als Schlüssel');

  step('Trennen: Schlüssel widerrufen → Token und Refresh ungültig');
  await api(`/api/account/api-keys/${conn.id}`, { method: 'DELETE' });
  check((await mcp(sessTok.access_token)).status === 401, 'Access-Token nach Widerruf ungültig');
  check((await token({ grant_type: 'refresh_token', refresh_token: sessTok.refresh_token, client_id: clientId })).status === 400, 'Refresh nach Widerruf ungültig');
  check((await token({ grant_type: 'password', username: 'x', password: 'y' })).json.error === 'unsupported_grant_type', 'andere Grant-Typen abgelehnt');

  step('Freigabeseite im Browser');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'de-DE' });
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: BASE }]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  pk = pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pk.challenge, code_challenge_method: 'S256', state: 'ui', scope: 'read write' });
  let landed = null;
  await p.route('http://127.0.0.1:33418/**', (route) => {
    landed = route.request().url();
    route.fulfill({ status: 200, body: 'ok' });
  });
  await p.goto(`${BASE}/oauth/authorize?${q}`);
  await p.getByRole('heading', { name: /möchte sich mit Prüfkompass verbinden/ }).waitFor();
  await p.screenshot({ path: OUT + '01-freigabe.png' });
  await p.getByRole('radio', { name: /Nur lesen/ }).click();
  await p.getByRole('button', { name: 'Verbinden' }).click();
  await p.waitForURL((x) => x.toString().startsWith(REDIRECT));
  const lu = new URL(landed);
  check(lu.searchParams.get('state') === 'ui' && lu.searchParams.get('code'), 'Weiterleitung mit Code');
  r = await token({ grant_type: 'authorization_code', code: lu.searchParams.get('code'), code_verifier: pk.verifier, client_id: clientId, redirect_uri: REDIRECT });
  check(r.status === 200 && r.json.scope === 'read', 'Token aus UI-Freigabe (nur lesen)');

  // ohne Anmeldung, Handybreite: Schlüssel einfügen
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const mp = await m.newPage();
  await mp.route('http://127.0.0.1:33418/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
  pk = pkce();
  await mp.goto(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pk.challenge, code_challenge_method: 'S256' })}`);
  await mp.getByLabel('API-Schlüssel').waitFor();
  check((await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, 'Freigabeseite 390 px ohne Überlauf');
  check(await mp.getByRole('link', { name: 'Anmelden' }).isVisible(), 'Hinweis auf Anmeldung');
  await mp.screenshot({ path: OUT + 'm1-freigabe.png' });
  await mp.getByLabel('API-Schlüssel').fill(write);
  await mp.getByRole('button', { name: 'Verbinden' }).click();
  await mp.waitForURL((x) => x.toString().startsWith(REDIRECT));
  check(true, 'Freigabe mit Schlüssel im Browser');
  // ungültige Anfrage
  await mp.goto(`${BASE}/oauth/authorize?client_id=${clientId}`);
  await mp.getByText('Ungültige Anfrage').waitFor();

  check(!errors.length, `keine Seitenfehler (${errors.join(' | ')})`);
  await b.close();
  console.log(fail.length ? `FAILED ${fail.length}: ${fail.join('; ')}` : 'ALL CHECKS OK');
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log('FAIL', e.stack);
  process.exit(1);
});
