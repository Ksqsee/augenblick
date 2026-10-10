# augenblick

## Ziel

Eigene Web-App, die die **Funktionen** von "Augenblick Control" abdeckt.
Vorgehen:

1. **Analyse** – Augenblick Control im Browser (headless Chromium/Playwright,
   `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) durchklicken. Funktionen,
   Abläufe und Datenmodell in `docs/analyse/` dokumentieren, Screenshots nur
   als interne Referenz.
2. **Eigene Umsetzung** – eigener Code, eigenes Design, eigene Texte.
   Keinen Code, keine Texte, Logos oder Grafiken von Augenblick Control kopieren.

## Offene Punkte (beim Nutzer erfragen)

- Login-URL von Augenblick Control
- Zugangsdaten **nie** ins Repo, in Commits oder Logs schreiben; der Nutzer gibt
  sie im Chat. Empfehlung an den Nutzer: eigenen Test-User mit wenig Rechten.
- Tech-Stack (Vorschlag: Next.js + TypeScript)

## Tools

- **REA** (`rea-agents@6.3.0`, MCP-Server `rea` über `.mcp.json`) und der Skill
  `reverse-engineer-anything` (`.claude/skills/`) sind eingerichtet. REA analysiert
  lokale Artefakte (JS/Electron-Ordner, `.asar`, Binaries), nicht direkt eine
  Web-App. Nur für Software einsetzen, an der der Nutzer die Rechte hat.
- Native Analyse (Ghidra/IDA/Hopper) ist **nicht** eingerichtet und aktuell nicht nötig.

## Sprache

Mit dem Nutzer Deutsch sprechen.
