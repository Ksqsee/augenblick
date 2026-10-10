# Prüfkompass-API

REST-API mit JSON für Fremdsysteme (CAFM, ERP, BI). Sie liefert dieselben Daten wie die App.

- **Basis-URL:** `https://<instanz>/api`, z. B. `https://pruefkompass.ksqsebastian.workers.dev/api`
- **Format:** JSON (UTF-8); Zeitangaben als Unix-Zeit in **Millisekunden** (UTC)
- **Fehler:** HTTP-Status und `{ "error": "Meldung" }`

## Zugang

Ein Admin legt unter **Einstellungen → API** einen Schlüssel an. Der Schlüssel wird nur einmal
angezeigt; gespeichert wird lediglich sein SHA-256-Hash.

```bash
curl -H "Authorization: Bearer pk_…" https://<instanz>/api/assets?due=overdue
```

| Rechte                 | entspricht Rolle | erlaubt |
|------------------------|------------------|---------|
| Nur lesen (`read`)     | Lesezugriff      | alle `GET`-Endpunkte unten |
| Lesen und schreiben (`write`) | Prüfer    | zusätzlich Elemente, Prüfungen, Mängel, Aufgaben anlegen/ändern |

Für API-Schlüssel gelten diese Regeln:

- Ein Schlüssel handelt im Namen der Person, die ihn erstellt hat. Er hat nie mehr Rechte als diese Person.
- Entfernt man die Person aus dem Workspace, wird der Schlüssel ungültig.
- Admin-Funktionen sind per API nicht erreichbar, auch nicht mit Schreibrechten. Dazu gehören Objekte anlegen, Team, Vorlagen und das JSON-Backup.
- Konto, Benachrichtigungen und Push sind ebenfalls nicht erreichbar. Anfragen darauf liefern `403`.
- Änderungen per API erscheinen im Aktivitätsprotokoll mit dem Namen des Schlüssels.
- Schlüssel können ablaufen und jederzeit widerrufen werden. Danach liefern Anfragen `401`.
- Mit Bearer-Token ist kein CSRF-Header nötig.

## Lesen

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /dashboard` | Kennzahlen (überfällig, bald fällig, nie geprüft, nicht prüfbar, neue Elemente, Mängel …) |
| `GET /search?q=` | Suche über Objekte, Gebäude, Elemente |
| `GET /properties` | Objekte mit Status (überfällig, bald fällig, Mängel, nächste Begehung) |
| `GET /properties/:id` | Objekt mit Gebäuden, Elementen, Grundrissen, Begehungen, Brandschutzbeauftragten |
| `GET /assets` | Elemente. Filter: `due=overdue\|soon\|never\|not_inspectable\|new\|defects`, `schedule=<Prüfart>`, `propertyId`, `buildingId`, `category`, `q` |
| `GET /assets/:id` | Element mit Prüfarten, Historie, offenen Mängeln, Anhängen |
| `GET /assets/by-code/:code` | Element über Code oder QR-Etikett |
| `GET /inspections?status=submitted\|draft&archived=1` | Prüfungen |
| `GET /inspections/:id` | Prüfung mit Prüfpunkten, Befunden, Mängeln (inkl. Maßnahme), Gesamtbewertung |
| `GET /walkthroughs`, `GET /walkthroughs/:id` | Brandschutzbegehungen |
| `GET /defects?status=open\|resolved\|all` | Mängel aus Prüfungen und Begehungen |
| `GET /tasks`, `GET /tasks/:id/comments`, `GET /tasks/stats?days=30` | Aufgaben, Kommentare, Statistik |
| `GET /categories` | Elementarten mit Prüfarten und Prüfpunkten |
| `GET /reports`, `GET /reports/:id/file` | Archiv erstellter Berichte (PDF/ZIP) |
| `GET /export/assets.xlsx`, `GET /export/assets.csv` | Elementliste in der Dokumentsprache des Workspaces |

## Schreiben (Schlüssel mit `write`)

| Endpunkt | Beschreibung |
|----------|--------------|
| `POST /assets` | Element anlegen: `{ buildingId, category, location, floor, manufacturer, model, attributes, code? }` |
| `PATCH /assets/:id` | Element ändern |
| `PUT /assets/:id/schedules` | Prüfart aktivieren/deaktivieren: `{ key, enabled, nextDueAt? }` |
| `PATCH /defects/:id` | Mangel als behoben markieren / wieder öffnen |
| `POST /tasks`, `PATCH /tasks/:id` | Aufgaben anlegen und ändern |
| `POST /tasks/:id/comments` | Kommentar: `{ body }` |
| `POST /import/assets` | Massenimport (wie Import-Seite) |

### Beispiel: Element anlegen

```bash
curl -X POST https://<instanz>/api/assets \
  -H "Authorization: Bearer pk_…" -H "content-type: application/json" \
  -d '{"buildingId":"…","category":"extinguisher","location":"Flur Nord","floor":"EG","manufacturer":"Gloria","attributes":{"year":2024}}'
```

### Beispiel: Überfällige innere Prüfungen

```bash
curl -H "Authorization: Bearer pk_…" "https://<instanz>/api/assets?due=overdue&schedule=inner"
```

## Hinweise

- Die API ist für Integrationen gedacht und nicht drosselnd abgesichert; Abfragen bitte maßvoll
  (z. B. stündlich statt minütlich) ausführen.
- Felder können ergänzt werden; Clients sollten unbekannte Felder ignorieren.
