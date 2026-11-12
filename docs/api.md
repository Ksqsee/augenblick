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
- Ist die Person auf bestimmte Objekte/Gebäude eingeschränkt (Team → Zugriff), gilt das auch für den Schlüssel – auch wenn die Einschränkung erst später gesetzt wird. Einträge außerhalb des Bereichs liefern `404`.
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
| `GET /buildings` | Alle Gebäude (`id`, `name`, `propertyId`) |
| `GET /properties/:id` | Objekt mit Gebäuden, Elementen, Grundrissen, Begehungen, Brandschutzbeauftragten |
| `GET /assets` | Elemente. Filter: `due=overdue\|soon\|never\|not_inspectable\|new\|defects`, `schedule=<Prüfart>`, `propertyId`, `buildingId`, `category`, `q` |
| `GET /assets/:id` | Element mit Prüfarten, Historie, offenen Mängeln, Anhängen |
| `GET /assets/by-code/:code` | Element über Code oder QR-Etikett |
| `GET /inspections?status=submitted\|draft&archived=1` | Prüfungen (ohne berichtigte); `superseded=1` liefert die durch eine Berichtigung ersetzten |
| `GET /inspections/:id` | Prüfung mit Prüfpunkten, Befunden, Mängeln (inkl. Maßnahme), Gesamtbewertung, Arten (`kinds`, `kindLabels`), Anlass (`purpose`: `regular`, `correction`, `follow_up`) und Verweisen (`supersedesId`, `supersededBy`, `followUpOf`) |
| `GET /walkthroughs`, `GET /walkthroughs/:id` | Brandschutzbegehungen |
| `GET /defects?status=open\|resolved\|all&hidden=1` | Mängel aus Prüfungen und Begehungen, mit Behebung (`resolutionNote`, `resolutionPhotoKey`, `resolvedByName`). Ausgeblendete fehlen, außer mit `hidden=1` (dann nur sie) |
| `GET /defects/:id` | Mangel-Detail: alle Angaben, Fotos vorher/nachher, verknüpfte Aufgaben (`tasks`) und Verlauf (`history`) |
| `GET /smart/action-required` (auch `GET /defects/action-required`) | Handlungsbedarf: kritische/hohe offene Mängel ohne offene Aufgabe, überfällige Aufgaben und überfällige Elemente, nach `urgency` absteigend; je Eintrag `kind` (`defect`/`task`/`asset`), `id`, `title`, `subtitle`, `reason`, `level`, `at` |
| `GET /tasks`, `GET /tasks/:id/comments`, `GET /tasks/stats?days=30` | Aufgaben (mit `kind`: `inspection` = Prüfauftrag, `defect` = Mängelbehebung, `other`; `createdBy`, `watchers`, `watching`, `defectStatus`), Kommentare (mit `mentions`), Statistik |
| `GET /tasks/:id/watchers` | Beobachter einer Aufgabe |
| `GET /categories` | Elementarten mit Prüfarten und Prüfpunkten |
| `GET /reports`, `GET /reports/:id/file` | Archiv erstellter Berichte (PDF/ZIP) |
| `GET /reports/annual?year=2026&propertyId=` | Daten des Jahresberichts je Objekt: Prüfungen nach Ergebnis/Art, Mängel mit Behebungsquote, Begehungen (mit Qualifikation der durchführenden Person), Brandschutzbeauftragte |
| `GET /export/assets.xlsx`, `GET /export/assets.csv` | Elementliste in der Dokumentsprache des Workspaces |

## Schreiben (Schlüssel mit `write`)

| Endpunkt | Beschreibung |
|----------|--------------|
| `POST /assets` | Element anlegen: `{ buildingId, category, location, floor, manufacturer, model, attributes, code?, warnDays? }` (`warnDays`: eigene Vorwarnzeit in Tagen) |
| `PATCH /assets/:id` | Element ändern |
| `PUT /assets/:id/schedules` | Prüfart aktivieren/deaktivieren: `{ key, enabled, nextDueAt? }` |
| `POST /assets/:id/inspections` | Prüfungsentwurf anlegen: `{ schedule? }` oder Nachprüfung `{ purpose: "follow_up", followUpOf }` |
| `PUT /inspections/:id`, `POST /inspections/:id/submit` | Entwurf speichern bzw. abschließen; Arten als `kinds: ["periodic", …]` (eingebaute Schlüssel oder eigene `k_…`) |
| `POST /inspections/:id/correct` | Berichtigung einer abgeschlossenen Prüfung anlegen (eigene Prüfung oder Admin); liefert den Entwurf |
| `PATCH /defects/:id` | Mangel als behoben markieren / wieder öffnen: `{ status: "resolved"\|"open", note?, photoKey? }` – Notiz und Nachher-Foto (vorher über `POST /files`), wer/wann wird gespeichert; Wiederöffnen löscht die Behebung |
| `POST /defects/:id/hide`, `POST /defects/:id/unhide` | Ausblenden mit `{ reason }` (Duplikat, nicht relevant …) bzw. wieder einblenden – nur Admins, daher nicht mit API-Schlüsseln |
| `POST /tasks`, `PATCH /tasks/:id` | Aufgaben anlegen und ändern; `kind` optional (ohne Angabe: mit `defectId` Mängelbehebung, sonst Sonstiges), Prüfauftrag braucht `assetId`, Mängelbehebung `defectId`. `resolveDefect: false` lässt den Mangel beim Erledigen offen (Standard `true`). Anlegende und Zuständige beobachten automatisch; ein abgeschlossener Prüfungsabschluss erledigt offene Prüfaufträge des Elements |
| `POST /tasks/bulk` | Mehrfachbearbeitung: `{ ids, status?, assigneeId? (null = niemand), priority?, dueAt? (null = ohne), resolveDefects? }` → `{ updated, skipped }`; nur Aufgaben im eigenen Bereich |
| `POST /tasks/:id/watch`, `DELETE /tasks/:id/watch` | Aufgabe beobachten / nicht mehr beobachten (auch Lesezugriff) |
| `POST /tasks/:id/comments` | Interne Notiz: `{ body, mentions? }` – `mentions` sind Nutzer-IDs von Mitgliedern, die die Aufgabe sehen dürfen (sonst 400); Erwähnte werden benachrichtigt und beobachten die Aufgabe. Notizen erscheinen nie im Link für Subunternehmer |
| `POST /import/assets` | Massenimport (wie Import-Seite) |
| `POST /defects` | Mangel ohne Prüfung melden: `{ assetId? , propertyId?, title, severity, note?, measure?, photoKey? }` – Element oder Objekt ist Pflicht; bei `high`/`critical` entsteht automatisch eine Aufgabe (Workspace-Einstellung), Antwort `{ id, taskCreated }` |
| `POST /smart/tasks-from-defects` | Für offene Mängel ohne Aufgabe je eine Aufgabe mit SLA-Frist: `{ severities? }` → `{ created }` |

## Kunden-Freigabe

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET/POST /properties/:id/shares` | Freigabe-Links eines Objekts auflisten bzw. erstellen (nur Admin-Sitzung): `{ label?, showDefects?, expiresInDays? }` → `{ id, token }` (Token nur einmal) |
| `DELETE /shares/:id` | Link widerrufen |
| `GET /public/property/:token` | Öffentliche, nur lesende Statusansicht (ohne Anmeldung); in der App unter `/kunde/:token` |

## Kalender-Abo

`GET/POST/DELETE /account/calendar-feed` (nur mit Sitzung) verwaltet den persönlichen Link; der Kalender ruft
`GET /public/calendar/<token>.ics` ab (iCal: fällige Prüfungen je Gebäude und Tag, Begehungen, eigene Aufgaben; 180 Tage Vorschau).

## Smarte Funktionen und KI

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /smart/suggestions` | Priorisierte Vorschläge (Rundgänge, Mängel ohne Aufgabe, fällige Begehungen, liegengebliebene Entwürfe, überfällige Aufgaben) |
| `GET /smart/rounds?days=30` | Fällige Elemente je Gebäude in Laufreihenfolge (Etage, Standort) |
| `GET /ai/status` | Welche KI-Funktionen verfügbar sind: `{ transcribe, structure: "ai"|"rules", vision }` |
| `POST /ai/parse` | Text (z. B. Diktat) in Mängel/Aufgaben/Notizen zerlegen: `{ text, checkpoints? }` → `{ items, source }`; ohne KI regelbasiert |
| `POST /ai/transcribe` | Sprachaufnahme (`audio/webm`, `ogg`, `mp4`, `wav` …, max. 8 MB, Rohdaten im Body) → `{ text }` |
| `POST /ai/typeplate` | Typenschild-Foto auslesen: `{ key }` (vorher über `POST /files` hochgeladen) → Hersteller, Modell, Baujahr, Seriennummer, Zulassung |

KI-Aufrufe laufen über Cloudflare Workers AI (keine Daten an weitere Anbieter) und sind auf 150 je Person und Stunde begrenzt.

## MCP-Server (Claude und andere KI-Assistenten)

Prüfkompass spricht das Model Context Protocol (Streamable HTTP, zustandslos, JSON-Antworten).

- **URL:** `https://<instanz>/api/mcp`
- **Anmeldung per OAuth 2.1** (empfohlen, z. B. eigener Connector in claude.ai/Claude Desktop oder `claude mcp add` ohne Header):
  der Client findet über `401` + `WWW-Authenticate: Bearer resource_metadata=…` die Metadaten
  (`/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`), registriert sich
  dynamisch (`POST /api/oauth/register`, nur https- oder Loopback-Rücksprungadressen) und öffnet die Freigabeseite
  `/oauth/authorize` (Code-Flow mit PKCE S256). Dort gibt man entweder **einen vorhandenen API-Schlüssel** ein oder
  erstellt als Admin mit Anmeldung **eine neue Verbindung** (nur lesen / lesen und schreiben). Tokens: Access `pko_…`
  (1 Stunde), Refresh `pkr_…` (90 Tage, wird bei jeder Nutzung erneuert). Rechte = Rechte des zugehörigen Schlüssels;
  Schlüssel widerrufen trennt die Verbindung sofort. `POST /api/oauth/token`, `POST /api/oauth/revoke`.
- **Mit Schlüssel:** Header `Authorization: Bearer pk_…`
- **Ohne eigene Header** (z. B. Connector in Claude Desktop/claude.ai): `https://<instanz>/api/mcp/k/pk_…` – die Adresse wie ein Passwort behandeln.
- Rechte wie der Schlüssel: Lese-Schlüssel sehen nur lesende Werkzeuge erfolgreich, schreibende liefern `isError`.

```bash
claude mcp add --transport http pruefkompass https://<instanz>/api/mcp          # OAuth im Browser
claude mcp add --transport http pruefkompass https://<instanz>/api/mcp --header "Authorization: Bearer pk_…"
```

Werkzeuge: `dashboard`, `search`, `list_properties`, `get_property`, `list_assets`, `get_asset`, `list_inspections`,
`get_inspection`, `list_defects`, `get_defect`, `resolve_defect` (mit Behebungsnotiz `note`), `report_defect`, `list_action_required`,
`list_tasks`, `create_task`, `update_task_status`, `bulk_update_tasks`, `add_task_comment` (mit `mentions`), `list_categories`, `create_asset`, `list_walkthroughs`, `plan_rounds`, `get_suggestions`,
`create_tasks_from_defects`, `structure_dictation`.

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
