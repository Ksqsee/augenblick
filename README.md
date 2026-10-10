# Prüfkompass

Web-App für wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente
(Feuerschutztüren, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder und eigene Elementarten),
Prüfung vor Ort mit Unterschrift, Mängel- und Aufgabenverfolgung, Berichte, QR-Etiketten und API.

Live: https://pruefkompass.ksqsebastian.workers.dev ·
Funktionsanalyse des Vorbilds und Abgleich: [`docs/analyse/`](docs/analyse/README.md) ·
API: [`docs/api.md`](docs/api.md)

## Funktionen

**Prüfen**
- Prüfung je Element mit Prüfpunkten (i. O. / Mangel / n. z.), Wartungsarbeiten, Fotos, Bemerkungen und Unterschrift
- **Prüfarten** mit eigenen Fristen je Element (z. B. Feuerlöscher: Instandhaltung, innere Prüfung, Festigkeitsprüfung)
- Mängel mit Schweregrad, Beschreibung, **Maßnahme** und Foto
- **Gesamtbewertung** automatisch oder vom Prüfer festgelegt (mit Pflicht-Begründung im Protokoll)
- Prüfung wieder öffnen, archivieren (auch automatisch), mehrere löschen
- **Offline-Modus** (PWA): Gebäude vorab laden, ohne Netz prüfen, automatische Synchronisation
- **Brandschutzbegehung** je Objekt mit Fragenkatalog nach Nutzung und Rechtsgrundlagen

**Verwalten**
- Objekte, Gebäude, **Grundrisse** (Bild/PDF) mit Element-Markern, Brandschutzbeauftragte je Objekt
- **Eigene Elementarten** und Varianten; Prüfvorlagen je Prüfart anpassbar
- Prüfungsliste mit Reitern Überfällig, Bald fällig, Nie geprüft, Nicht prüfbar, Neue Elemente, Entwürfe,
  Durchgeführt, Archiv – filterbar nach Prüfart
- **Mängel** und **Aufgaben** mit Labels, SLA-Richtlinien, Kommentaren, Statistik
- **Subunternehmer**: Aufgabe per Link teilen, Rückmeldung ohne Konto
- QR-Etiketten (auch Blanko-Etiketten, die beim ersten Scan zugeordnet werden), Suche (Strg+K)
- **Import** aus Excel/CSV mit Vorschau

**Berichte und Daten**
- PDF im Browser: Prüfprotokoll, Begehung, Mängelbericht, Compliance-Übersicht, **Objektbericht** –
  mit Firmenlogo und einstellbarem Dateinamensschema; mehrere Protokolle als ZIP
- **Berichtsarchiv**: jeder erzeugte Bericht wird gespeichert und bleibt abrufbar
- Elementliste als **Excel** (wieder importierbar) oder CSV; vollständiges JSON-Backup
- **Sprache der Dokumente** (Deutsch/Englisch) und **Zeitzone** je Workspace; die Oberfläche ist deutsch

**Team und Konto**
- Rollen (Inhaber, Admin, Prüfer, Lesezugriff), Einladungen, Inhaberschaft übertragen, Aktivitätsprotokoll
- **Benachrichtigungen** in der App und per Web Push, mit „Nicht stören“-Zeitraum; täglicher Cron für Fälligkeiten,
  Wochenübersicht, SLA, Archiv; Hinweis bei Anmeldung von einem neuen Gerät
- Passwort-Link durch Admin (kein E-Mail-Versand), Sitzungen verwalten, DSGVO-Export/-Löschung, Rechtstexte mit Zustimmung
- **API-Zugangsschlüssel** (lesen oder lesen+schreiben) für Fremdsysteme; **Speicherverbrauch** des Workspaces
- Anleitung & Hilfe in der App

Bewusst nicht enthalten: Bezahlung/Tarife und E-Mail-Versand.

## Stack

- **Frontend**: React 18, Vite, Tailwind CSS 4, TanStack Query, React Router; PDF mit pdf-lib, ZIP mit fflate
- **Backend**: Hono auf Cloudflare Workers (`worker/`), Zod-Validierung, täglicher Cron-Trigger
- **Daten**: Cloudflare D1 (SQLite, `migrations/`), Dateien in R2
- **Geteilt** (`shared/`): Prüfkataloge, Fachlogik, Import, XLSX-Writer, Übersetzungen, Ruhezeiten – mit Vitest-Tests

```
src/          Oberfläche (pages/, components/, pdf/ für die PDF-Erzeugung, offline.ts)
worker/       API: auth (Login, Konto, API-Schlüssel, Speicher), data, inspections, walkthroughs,
              plans, categories, work (Aufgaben, Subunternehmer, Import), reports, notify, push, cron
shared/       Code für Browser und Worker
migrations/   D1-Schema (0001 … 0007)
e2e/          Browser-Tests und Runner
.github/      CI
scripts/      seed.ts – Demodaten
docs/         Analyse des Vorbilds, API-Doku, Sicherheitsbewertung
```

## Entwicklung

```bash
npm install
npm run db:migrate:local   # lokale D1 anlegen bzw. aktualisieren
npm run dev                # http://localhost:5173 (Worker + Frontend)
npm run check              # Typprüfung + Unit-Tests + Build
```

## Tests

- **Unit-Tests** (`npm test`, Vitest): Fachlogik, Import/Export, Übersetzungen, Ruhezeiten, Web Push.
- **Browser-Tests** (`e2e/`, Playwright): neun Reihen von der Registrierung über Sicherheitskorrekturen bis zu Massenoperationen.
  Vor jeder Reihe wird die lokale D1 geleert und mit Demodaten befüllt.

```bash
npm run e2e                  # Dev-Server muss laufen (npm run dev)
npm run e2e -- --serve       # startet den Dev-Server selbst (wie in CI)
npm run e2e -- 04 08         # einzelne Reihen
BASE=http://localhost:4173 npm run e2e   # gegen den Produktions-Build (npx vite preview) – prüft auch die CSP
```

Lokal wird Chromium aus `PLAYWRIGHT_BROWSERS_PATH` genutzt, in CI per `npx playwright install chromium`.
Reihe 06 braucht `pdftotext` (Paket `poppler-utils`).

**CI** (`.github/workflows/ci.yml`): bei jedem Push Typprüfung, Unit-Tests und Build, danach alle Browser-Tests.
Bei Fehlern werden die Screenshots als Artefakt angehängt.

## Deploy (Cloudflare)

```bash
export CLOUDFLARE_API_TOKEN=…        # nie ins Repo
npm run deploy                       # build + D1-Migrationen (remote) + wrangler deploy
```

Ressourcen: Worker `pruefkompass`, D1 `pruefkompass`, R2 `pruefkompass-files`, Cron `15 5 * * *` (UTC).

Web Push (optional): VAPID-Schlüssel (P-256) erzeugen und als Secrets setzen –
`VAPID_PUBLIC_KEY` (raw, base64url), `VAPID_PRIVATE_KEY` (JWK `d`), `VAPID_SUBJECT` (`mailto:…`).
Ohne diese Secrets bleibt Push ausgeblendet; In-App-Benachrichtigungen funktionieren trotzdem.

## Demodaten

```bash
DEMO_PASSWORD=… npx vite-node scripts/seed.ts -- ./seed-out
npx wrangler d1 execute DB --remote --file ./seed-out/seed.sql     # nur in eine leere Datenbank
# Dateien aus ./seed-out/r2.json nach R2 hochladen (Grundrisse als image/svg+xml, Logo als image/png):
#   npx wrangler r2 object put pruefkompass-files/<key> --file <file> --content-type <typ> --remote
```

Legt den Workspace „Nordlicht Facility Services GmbH“ an: 4 Objekte, 74 Elemente (inkl. eigener
Elementart „Rauchschutzvorhang“), Prüfhistorie, Prüfarten, Mängel, Aufgaben mit Labels und
Kommentaren, Subunternehmer, Begehungen, Grundrisse, Brandschutzbeauftragte, Benachrichtigungen, Logo.
Konten: `demo@example.com` (Inhaber), `pruefer@example.com`, `pruefer2@example.com` (Prüfer),
`lesen@example.com` (Lesezugriff) – alle mit `DEMO_PASSWORD`.

## Rollen

| Rolle         | Rechte |
|---------------|--------|
| Inhaber       | alles, inkl. Inhaberschaft übertragen |
| Administrator | Objekte, Gebäude, Team, Prüfvorlagen, Einstellungen, API-Schlüssel |
| Prüfer        | Elemente anlegen/bearbeiten, prüfen, Mängel & Aufgaben |
| Lesezugriff   | nur ansehen |

## Sicherheit

Bewertung und Status aller Befunde: [`docs/security.md`](docs/security.md).

- Passwörter: PBKDF2-SHA256 (100 000 Iterationen), Sitzungen als HttpOnly-Cookie (SameSite=Lax)
- Sperre nach zu vielen Fehlversuchen (Login, Passwort, Links, API-Schlüssel), HTTP 429 mit `Retry-After`
- Content-Security-Policy, HSTS, `X-Frame-Options: DENY` (`public/_headers`, API-Middleware); Schrift selbst gehostet
- Schreibende Requests aus dem Browser brauchen den Header `x-pk: 1` (CSRF-Schutz)
- API-Schlüssel: nur SHA-256-Hash gespeichert, Rechte auf Prüfer begrenzt, Ablauf und Widerruf
- Alle Abfragen sind auf den Workspace (`tenant_id`) beschränkt; Dateien nur mit Workspace-Präfix
- Zugangsdaten und Tokens gehören nie ins Repo, in Commits oder Logs
