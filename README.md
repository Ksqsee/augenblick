# Prüfkompass

Web-App für wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente
(Feuerschutztüren, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder), Prüfung vor
Ort mit Unterschrift, Mängel- und Aufgabenverfolgung, Berichte und QR-Etiketten.

## Funktionen

- **Prüfungen** je Element mit Prüfpunkten (i. O. / Mangel / n. z.), Fotos, Arbeiten, Unterschrift, Protokoll (Druck/PDF)
- **Brandschutzbegehung** je Objekt mit eigenem Fragenkatalog nach Nutzung (Schule, Pflege, Lager …), Rechtsgrundlagen, Protokoll
- **Grundrisse** (Bild oder PDF) mit farbigen Element-Markern; Platzieren per Antippen
- **Mängel** aus Prüfungen und Begehungen, Aufgaben mit Status, Priorität, Fälligkeit und Zuständigkeit
- **Subunternehmer**: Aufgaben per Link teilen, Rückmeldung „erledigt“ ohne Konto
- **Offline-Modus**: Gebäude vorab laden, ohne Netz prüfen, automatische Synchronisation (PWA)
- **Import** aus Excel/CSV mit Vorschau; Export als CSV
- **QR-Etiketten** für Elemente und Blanko-Etiketten, die beim ersten Scan zugeordnet werden
- **Suche** (Strg+K), Rollen (Inhaber, Admin, Prüfer, Lesezugriff), Einladungen, Aktivitätsprotokoll
- **Prüfarten** mit eigenen Fristen je Element (z. B. Feuerlöscher: Instandhaltung, innere Prüfung, Festigkeitsprüfung)
- **Eigene Elementarten** und Varianten mit eigenen Prüfpunkten, Stammdaten und Code-Präfix
- **Fotos & Dokumente** an Elementen und Prüfungen; Prüfung wieder öffnen, archivieren (auch automatisch), Mehrfachlöschen
- **PDF** im Browser (Protokoll, Begehung, Mängel, Compliance) mit Firmenlogo und Dateinamensschema; ZIP-Export; JSON-Backup
- **Aufgaben** mit Labels, SLA-Richtlinien je Priorität, Kommentaren und Statistik
- **Benachrichtigungen** in der App und per Web Push; täglicher Cron für Fälligkeiten, Wochenübersicht, SLA, Archiv
- **Konto**: Passwort-Link durch Admin (ohne E-Mail), Sitzungen, Inhaberschaft übertragen, DSGVO-Export/-Löschung, Rechtstexte mit Zustimmung
- **Brandschutzbeauftragte** je Objekt, Anleitung & Hilfe

Live: https://pruefkompass.ksqsebastian.workers.dev

Funktionsanalyse des Vorbilds: [`docs/analyse/`](docs/analyse/README.md).

## Stack

- **Frontend**: React 18, Vite, Tailwind CSS 4, TanStack Query, React Router
- **Backend**: Hono auf Cloudflare Workers (`worker/`), Zod-Validierung
- **Daten**: Cloudflare D1 (SQLite, `migrations/`), Fotos in R2
- **Geteilt**: Prüfkataloge und Fachlogik in `shared/` (mit Vitest-Tests)

## Entwicklung

```bash
npm install
npm run db:migrate:local   # lokale D1 anlegen
npm run dev                # http://localhost:5173 (Worker + Frontend)
npm test                   # Unit-Tests
npm run typecheck
```

## Deploy (Cloudflare)

```bash
export CLOUDFLARE_API_TOKEN=…        # nie ins Repo
npm run deploy                       # build + D1-Migrationen + wrangler deploy
```

Ressourcen: Worker `pruefkompass`, D1 `pruefkompass`, R2 `pruefkompass-files`.

## Demodaten

```bash
DEMO_PASSWORD=… npx vite-node scripts/seed.ts -- ./seed-out
npx wrangler d1 execute DB --remote --file ./seed-out/seed.sql
# Grundrisse aus ./seed-out/r2.json nach R2 hochladen:
#   npx wrangler r2 object put pruefkompass-files/<key> --file <file> --content-type image/svg+xml --remote
#   (logo-demo als image/png)
```

Web Push (optional): VAPID-Schlüssel (P-256) erzeugen und als Secrets setzen –
`VAPID_PUBLIC_KEY` (raw, base64url), `VAPID_PRIVATE_KEY` (JWK `d`), `VAPID_SUBJECT` (`mailto:…`).
Ohne diese Secrets bleibt Push ausgeblendet, In-App-Benachrichtigungen funktionieren trotzdem.

Legt den Workspace „Nordlicht Facility Services GmbH“ mit 4 Objekten, 74 Elementen (inkl. eigener Elementart „Rauchschutzvorhang“),
Prüfhistorie, Prüfarten, Mängeln, Aufgaben (Labels, Kommentare), Subunternehmern, Begehungen,
Grundrissen, Brandschutzbeauftragten, Benachrichtigungen und Firmenlogo an.
Konten: `demo@example.com` (Inhaber), `pruefer@example.com`, `pruefer2@example.com` (Prüfer),
`lesen@example.com` (Lesezugriff) – alle mit `DEMO_PASSWORD`.

## Rollen

| Rolle         | Rechte |
|---------------|--------|
| Inhaber       | alles |
| Administrator | Objekte, Gebäude, Team, Prüfvorlagen |
| Prüfer        | Elemente anlegen/bearbeiten, prüfen, Mängel & Aufgaben |
| Lesezugriff   | nur ansehen |

## Sicherheit

- Passwörter: PBKDF2-SHA256 (100 000 Iterationen), Sessions als HttpOnly-Cookie
- Schreibende Requests brauchen den Header `x-pk: 1` (CSRF-Schutz zusätzlich zu SameSite=Lax)
- Alle Abfragen sind auf den Workspace (`tenant_id`) der Sitzung beschränkt
