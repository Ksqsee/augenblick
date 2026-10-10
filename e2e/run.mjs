#!/usr/bin/env node
// Führt die Browser-Tests (e2e/*.cjs) gegen die lokale App aus.
//
//   npm run e2e                 alle Reihen, Dev-Server läuft bereits auf BASE (Standard http://localhost:5173)
//   npm run e2e -- --serve      startet den Dev-Server selbst (so läuft es in CI)
//   npm run e2e -- 04 06        nur bestimmte Reihen
//   npm run e2e -- --prod 03    lesende Reihen gegen Produktion (BASE setzen, DEMO_PASSWORD = Passwort der Demo-Konten)
//
// Lokal wird vor jeder Reihe die D1-Datenbank geleert und mit Demodaten befüllt (scripts/seed.ts).
// DEMO_PASSWORD wird für lokale Läufe zufällig erzeugt, wenn es nicht gesetzt ist.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..');
const out = join(dir, '.out');
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const serve = args.includes('--serve');
const filters = args.filter((a) => !a.startsWith('--'));
const BASE = process.env.BASE || 'http://localhost:5173';
// Diese Reihen ändern nichts Dauerhaftes bzw. räumen auf; 01/02/07 nie gegen Produktion
const PROD_SAFE = ['03', '04', '05', '06'];

if (prod && !process.env.BASE) throw new Error('--prod braucht BASE=https://…');
if (prod && !process.env.DEMO_PASSWORD) throw new Error('--prod braucht DEMO_PASSWORD');
const password = process.env.DEMO_PASSWORD || `E2e-${randomBytes(9).toString('base64url')}`;
const env = { ...process.env, BASE, DEMO_PASSWORD: password, ...(prod ? { PROD: '1' } : {}) };

const tests = readdirSync(dir)
  .filter((f) => /^\d\d-.*\.cjs$/.test(f))
  .sort()
  .filter((f) => !filters.length || filters.some((x) => f.startsWith(x) || f.includes(x)))
  .filter((f) => !prod || PROD_SAFE.includes(f.slice(0, 2)));
if (!tests.length) throw new Error('Keine passenden Tests');

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env, ...opts }).toString();

async function waitFor(url, ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* noch nicht bereit */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} nicht erreichbar`);
}

let server;
if (serve) {
  server = spawn('npx', ['vite', '--port', new URL(BASE).port || '5173', '--strictPort'], { cwd: root, env, stdio: 'ignore', detached: true });
}

const results = [];
try {
  if (!prod) {
    mkdirSync(out, { recursive: true });
    console.log('▸ Migrationen (lokal) und Demodaten');
    sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local']);
    sh('npx', ['vite-node', 'scripts/seed.ts', '--', join(out, 'seed')]);
  }
  await waitFor(BASE + '/api/health');
  for (const t of tests) {
    if (!prod) {
      sh('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', join(dir, 'wipe.sql')]);
      sh('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', join(out, 'seed', 'seed.sql')]);
    }
    const start = Date.now();
    process.stdout.write(`▸ ${t} `);
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, [join(dir, t)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      p.stdout.on('data', (d) => (log += d));
      p.stderr.on('data', (d) => (log += d));
      p.on('close', (c) => {
        const secs = ((Date.now() - start) / 1000).toFixed(0);
        console.log(c === 0 ? `✓ (${secs} s)` : `✗ (${secs} s)`);
        if (c !== 0 || process.env.E2E_VERBOSE) console.log(log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => `    ${l}`).join('\n'));
        resolve(c);
      });
    });
    results.push({ t, ok: code === 0 });
  }
} finally {
  if (server) process.kill(-server.pid);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Reihen bestanden${failed.length ? ` – fehlgeschlagen: ${failed.map((r) => r.t).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
