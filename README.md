# Prüfkompass

Web-App für wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente
(Feuerschutztüren, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder), Prüfung vor
Ort mit Unterschrift, Mängel- und Aufgabenverfolgung, Berichte und QR-Etiketten.

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
