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
```

Legt den Workspace „Nordlicht Facility Services GmbH“ mit 4 Objekten, 71 Elementen,
Prüfhistorie, Mängeln, Aufgaben, Subunternehmern, Begehungen und Grundrissen an.
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
