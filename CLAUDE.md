# augenblick → Prüfkompass

## Ziel

Eigene Web-App **Prüfkompass**, die die **Funktionen** von „Augenblick Control“ abdeckt
(Brandschutzprüfungen). Stand: Funktionsumfang laut Analyse vollständig umgesetzt, live unter
https://pruefkompass.ksqsebastian.workers.dev. Bewusst ausgenommen: Bezahlung/Tarife, E-Mail-Versand.

- Analyse des Vorbilds und Abgleich: `docs/analyse/README.md`
- Architektur, Entwicklung, Deploy, Demodaten: `README.md`
- API für Fremdsysteme: `docs/api.md`

## Regeln

- **Eigener Code, eigenes Design, eigene Texte.** Keinen Code, keine Texte, Logos oder Grafiken von
  Augenblick Control kopieren.
- **Zugangsdaten und Tokens nie** ins Repo, in Commits oder Logs schreiben (Augenblick-Login,
  Cloudflare-Token, Demo-Passwort, VAPID-Schlüssel). Der Nutzer gibt sie im Chat; nur als
  Umgebungsvariable inline verwenden. Für eine erneute Analyse: eigenen Test-User mit wenig Rechten empfehlen.
- **Produktion** (D1 remote, R2, Secrets) nur ändern, wenn der Nutzer es ausdrücklich will;
  Produktionsdaten nie löschen. Neue Demo-Inhalte additiv über die App-API anlegen.
- Schemaänderungen nur als neue Migration in `migrations/` (fortlaufend nummeriert), nie alte ändern.
- Vor Commit/Deploy: `npm run typecheck`, `npm test`, `npm run build`; Oberfläche mit Playwright
  prüfen (auch Handybreite 390 px ohne horizontalen Überlauf).
- Oberfläche und Texte auf Deutsch; Dokumente (PDF/Excel) zusätzlich Englisch über `shared/i18n.ts` –
  neue feste PDF-Texte dort ergänzen (ein Test prüft die Abdeckung).

## Tech-Stack

Vite/React + Tailwind 4 (Frontend, `src/`), Hono auf Cloudflare Workers (`worker/`), D1, R2,
Cron-Trigger; geteilte Fachlogik in `shared/` mit Vitest. Deploy über `npm run deploy`
(braucht `CLOUDFLARE_API_TOKEN`).

## Tools

- Browser: Chromium unter `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (nicht `playwright install`).
- **REA** (`rea-agents@6.3.0`, MCP-Server `rea` über `.mcp.json`) und der Skill
  `reverse-engineer-anything` (`.claude/skills/`) sind eingerichtet. REA analysiert lokale Artefakte
  (JS/Electron-Ordner, `.asar`, Binaries), nicht direkt eine Web-App. Nur für Software einsetzen,
  an der der Nutzer die Rechte hat.
- Native Analyse (Ghidra/IDA/Hopper) ist **nicht** eingerichtet und nicht nötig.

## Sprache

Mit dem Nutzer Deutsch sprechen.
