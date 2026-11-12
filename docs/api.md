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
| `GET /inspections?status=submitted\|draft\|ready&archived=1` | Prüfungen (ohne berichtigte); `superseded=1` liefert die durch eine Berichtigung ersetzten; `status=ready` = eigene Entwürfe, die zur Unterschrift bereitliegen (`readyAt`) |
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
| `POST /assets/:id/inspections` | Prüfungsentwurf anlegen: `{ schedule? }` oder Nachprüfung `{ purpose: "follow_up", followUpOf }`; `{ taskId }` = aus einer Aufgabe gestartet (Mängelbehebung → Nachprüfung der Ausgangsprüfung). Art vorbelegt: `initial` bei nie geprüften Elementen, sonst `periodic` |
| `PUT /inspections/:id`, `POST /inspections/:id/submit` | Entwurf speichern bzw. abschließen. `PUT` mit `ready: true` legt einen vollständigen Entwurf **zur Unterschrift bereit** (Antwort `{ ok, ready, missing }` – `missing` nennt, was fehlt); unvollständig gespeichert oder `ready: false` nimmt das zurück; Arten als `kinds: ["periodic", …]` (eingebaute Schlüssel oder eigene `k_…`). Bekannte Mängel: `GET /inspections/:id` liefert im Entwurf `knownDefects` (offene Mängel des Elements); ein Mangel mit `knownId` wird verknüpft statt neu angelegt (ebenso ein gleich benannter offener Mangel), `resolvedDefects: [id, …]` schließt bekannte Mängel beim Abschluss („Bei Prüfung vom … behoben“). Gilt auch für `POST /inspections/offline` |
| `POST /inspections/sign` | **Nur mit Browser-Sitzung** (API-Schlüssel/OAuth → `403`): mehrere eigene, bereite Entwürfe mit einer Unterschrift abschließen `{ ids: [...], signature: "data:image/png;base64,…", signerName? }` → `{ signed: [{ id, code, result, nextDueAt }], failed: [{ id, error }] }`; jede Prüfung wird wie beim normalen Abschluss geprüft, fremde, nicht bereite oder abgeschlossene IDs landen in `failed` |
| `POST /inspections/:id/correct` | Berichtigung einer abgeschlossenen Prüfung anlegen (eigene Prüfung oder Admin); liefert den Entwurf |
| `PATCH /defects/:id` | Mangel als behoben markieren / wieder öffnen: `{ status: "resolved"\|"open", note?, photoKey? }` – Notiz und Nachher-Foto (vorher über `POST /files`), wer/wann wird gespeichert; Wiederöffnen löscht die Behebung |
| `POST /defects/:id/hide`, `POST /defects/:id/unhide` | Ausblenden mit `{ reason }` (Duplikat, nicht relevant …) bzw. wieder einblenden – nur Admins, daher nicht mit API-Schlüsseln |
| `POST /tasks`, `PATCH /tasks/:id` | Aufgaben anlegen und ändern; `kind` optional (ohne Angabe: mit `defectId` Mängelbehebung, sonst Sonstiges), Prüfauftrag braucht `assetId` oder `buildingId` (Rundgang eines Gebäudes), Mängelbehebung `defectId`. `recurrence: "monthly"\|"quarterly"\|"yearly"\|null` – beim Erledigen entsteht die nächste Aufgabe (Autopilot), Antwort dann mit `nextCreated: true`; ohne Angabe bleiben `recurrence`/`buildingId` beim Ändern unverändert. `resolveDefect: false` lässt den Mangel beim Erledigen offen (Standard `true`). Anlegende und Zuständige beobachten automatisch; ein abgeschlossener Prüfungsabschluss erledigt offene Prüfaufträge des Elements |
| `POST /tasks/bulk` | Mehrfachbearbeitung: `{ ids, status?, assigneeId? (null = niemand), priority?, dueAt? (null = ohne), resolveDefects? }` → `{ updated, skipped }`; nur Aufgaben im eigenen Bereich |
| `POST /tasks/:id/watch`, `DELETE /tasks/:id/watch` | Aufgabe beobachten / nicht mehr beobachten (auch Lesezugriff) |
| `POST /tasks/:id/comments` | Interne Notiz: `{ body, mentions? }` – `mentions` sind Nutzer-IDs von Mitgliedern, die die Aufgabe sehen dürfen (sonst 400); Erwähnte werden benachrichtigt und beobachten die Aufgabe. Notizen erscheinen nie im Link für Subunternehmer |
| `POST /import/assets` | Massenimport (wie Import-Seite) |
| `POST /defects` | Mangel ohne Prüfung melden: `{ assetId? , propertyId?, title, severity, note?, measure?, photoKey? }` – Element oder Objekt ist Pflicht; bei `high`/`critical` (und Schweregraden aus Zuweisungsregeln) entsteht in Stufe „Automatisch“ der Regel `assign_defect_tasks` sofort eine Aufgabe, ggf. zugewiesen; Antwort `{ id, taskCreated }` |
| `POST /smart/tasks-from-defects` | Für offene Mängel ohne Aufgabe je eine Aufgabe (Frist und Zuständige nach Zuweisungsregeln, sonst SLA-Frist): `{ severities? }` → `{ created }`; wird protokolliert |
| `POST /inspections/offline` | Offline erfasste Prüfung übernehmen (idempotent über `clientId`): Prüfungsdaten wie beim Abschluss plus `{ clientId, assetId, schedule, inspectedAt, checkpoints }`. Inhaltliche Ablehnung (Validierung, Element gelöscht, Konflikt …) → Fehler mit `failureId`; die Übertragung bleibt dann unter `GET /offline/failures` (nicht bei 401/403/429) |
| `GET /offline/failures` | Vom Server abgelehnte Offline-Übertragungen: Admins alle des Workspaces, Prüfer nur eigene. Je Eintrag `reason`, `status`, `userName`, `assetCode`, `assetAvailable`, `retryable`, `attempts`, `inspectedAt` – ohne Prüfungsdaten |
| `POST /offline/failures/:id/retry` | Serverseitig erneut übertragen: `{ assetId? }` (Ersatz-Element derselben Art, wenn das ursprüngliche fehlt) → `{ inspectionId }`; die Prüfung bleibt der prüfenden Person zugeordnet. Scheitert er, zählt `attempts` hoch und der Fehler kommt zurück |
| `DELETE /offline/failures/:id` | Abgelehnte Übertragung endgültig verwerfen (eigene oder als Admin) |

## Autopilot

Regeln: `plan_week`, `assign_defect_tasks`, `escalate_sla`, `recurring_tasks`, `close_stale`, `monthly_report`, `adapt_intervals`; Stufen `off`, `suggest`, `auto`.
`adapt_intervals` (selbstanpassende Prüfintervalle) speichert die Stufe in `tenants.adapt_intervals_mode` – dieselbe wie `adaptIntervalsMode` im Firmenprofil;
automatisch angewendete (beim Prüfungsabschluss) und übernommene (`POST /smart/intervals/apply`) Intervalle stehen im Protokoll, Rückgängig setzt das vorherige Intervall,
sofern es nicht inzwischen geändert wurde. `POST /automation/adapt_intervals/run` → `400` (Vorschläge einzeln übernehmen).
Standard: `assign_defect_tasks` und `recurring_tasks` automatisch (bisheriges Verhalten bzw. ausdrücklich gesetzte Wiederholung), sonst vorschlagen.
`assign_defect_tasks` folgt dem Schalter `autoTasks` im Firmenprofil (beide bleiben gleich). Der tägliche Cron führt Regeln in Stufe `auto`
aus (`plan_week` nur montags in der Zeitzone des Workspaces); in Stufe `suggest` liefert `GET /smart/suggestions` Einträge mit
`kind: "automation"`, `automation: <Schlüssel>` und `action.endpoint` (einmal ausführen).
`assign_defect_tasks` wirkt auch auf Feststellungen einer abgeschlossenen Begehung (`POST /walkthroughs/:id/submit`; gleiche Regeln, Bereich und Protokoll).
Ein von `plan_week` angelegter Prüfauftrag „Rundgang <Gebäude>“ wird beim Prüfungsabschluss erledigt, sobald kein Element des Gebäudes mehr
vor Ablauf des Planungsfensters (14 Tage ab Anlage des Auftrags) fällig ist; Protokolleintrag „Rundgang … abgeschlossen“ (`plan_week`, ohne Rückgängig).

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /automation` | Regeln: `[{ key, title, description, mode, defaultMode, adminOnly, lastRunAt, config? }]` – `config` (Zuweisungsregeln) nur für Admins |
| `PUT /automation` | Nur Admins (also nicht per API-Schlüssel): `{ key, mode?, config? }`; `config` nur für `assign_defect_tasks`: `{ rules: [{ category\|null, severities[], assigneeId\|null, subcontractorId\|null, days\|null }] }` – je Regel genau eine Person (mind. Prüfer) oder ein Subunternehmer, erste passende Regel gilt |
| `GET /automation/log?limit=50&key=&before=` | Protokoll, neueste zuerst: `[{ id, key, title, at, summary, link?, actorName, undoable, undoneAt }]`; eingeschränkte Mitglieder sehen nur Einträge zu Gebäuden/Objekten im Bereich und eigene Zuweisungen |
| `POST /automation/log/:id/undo` | Rückgängig (7 Tage; Admins oder die zugewiesene Person): löscht angelegte, noch unbearbeitete Aufgaben, setzt Prioritäten zurück, löscht archivierte Monatsberichte, beendet bei Folgeaufgaben die Reihe → `{ reverted, kept }`; zweites Mal `409` |
| `POST /automation/:key/run` | Regel einmal ausführen (ab Prüfer, im eigenen Bereich; `off` → `409`) → `{ key, done, created? }` |
| `GET /automation/monthly-report` | Admins ohne Einschränkung: `{ mode, period, label, properties, due }` (Berichtsmonat = Vormonat) |
| `POST /automation/monthly-report/claim`, `POST /automation/monthly-report/:id/complete` | Monatsberichte reservieren (`409`, wenn schon erledigt oder in Arbeit; Reservierung verfällt nach 30 min) → `{ logId, period, label, properties }`; der Browser erzeugt je Objekt das PDF, legt es über `POST /reports` ab und meldet `{ reportIds }` |

## Kunden-Freigabe

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET/POST /properties/:id/shares` | Freigabe-Links eines Objekts auflisten bzw. erstellen (nur Admin-Sitzung): `{ label?, showDefects?, expiresInDays? }` → `{ id, token }` (Token nur einmal) |
| `DELETE /shares/:id` | Link widerrufen |
| `GET /public/property/:token` | Öffentliche, nur lesende Statusansicht (ohne Anmeldung); in der App unter `/kunde/:token`. `updatedAt`: letzte Prüfung oder Mangeländerung (erfasst, behoben, ausgeblendet) des Objekts, `null` ohne beides |

## Partner-Zugang für Subunternehmer

| Endpunkt | Beschreibung |
|----------|--------------|
| `POST /subcontractors/:id/partner-code` | Einladungscode erzeugen bzw. neu erzeugen (nur Admin) → `{ code }` – nur einmal sichtbar, gespeichert wird der Hash; ein vorheriger Code wird ungültig. `GET /subcontractors` zeigt `partnerAccess`, `partnerCreatedAt`, `partnerUsedAt` |
| `DELETE /subcontractors/:id/partner-code` | Code widerrufen |
| `GET /public/partner/:code` | Ohne Anmeldung: `{ company, tenantName, tasks }` – alle offenen Aufträge der Firma, je mit `ref` und denselben Feldern wie `GET /public/tasks/:token` (keine internen Notizen, IDs oder Personen); in der App unter `/partner/:code` |
| `GET /public/partner/:code/tasks/:ref`, `…/photo` | Einzelner Auftrag bzw. Foto zum Mangel |
| `POST /public/partner/:code/tasks/:ref` | Rückmeldung `{ status: "in_progress"\|"done", note? }` wie beim Einzel-Link (Kommentar „extern“, Benachrichtigung) |

Ungültige oder widerrufene Codes liefern `404` und werden je IP gedrosselt (`token-ip`).

## Kalender-Abo

`GET/POST/DELETE /account/calendar-feed` (nur mit Sitzung) verwaltet den persönlichen Link; der Kalender ruft
`GET /public/calendar/<token>.ics` ab (iCal: fällige Prüfungen je Gebäude und Tag, Begehungen, eigene Aufgaben; 180 Tage Vorschau).

## Smarte Funktionen

| Endpunkt | Beschreibung |
|----------|--------------|
| `GET /smart/suggestions` | Priorisierte Vorschläge (Rundgänge, Mängel ohne Aufgabe, fällige Begehungen, liegengebliebene Entwürfe, überfällige Aufgaben), Autopilot-Regeln in Stufe „Vorschlagen“ (`kind: "automation"`) und – für Admins im Modus „Vorschlagen“ ein Intervall-Vorschlag `kind: "interval"` mit `action` → `POST /smart/intervals/apply` |
| `GET /smart/intervals?assetId=` | Selbstanpassende Prüfintervalle: `{ mode: "off"\|"suggest"\|"auto", suggestions }` – je Vorschlag `assetId`, `schedule`, `kind` (`shorten`/`restore`), `from`, `to`, `standard`, `text`. Das angepasste Intervall steht am Element unter `schedules.<Prüfart>.intervalMonths` |
| `POST /smart/intervals/apply` | Vorschlag übernehmen (Admin): `{ assetId, schedule, months }` – `months` muss dem aktuellen Vorschlag entsprechen (sonst 409); der nächste Termin wird ab der letzten Prüfung neu berechnet; Eintrag im Autopilot-Protokoll (`adapt_intervals`, rückgängig zu machen) |
| `POST /smart/intervals/reset` | Angepasstes Intervall auf den Standard zurücksetzen (Admin): `{ assetId, schedule }` |
| `GET /smart/rounds?days=30` | Fällige Elemente je Gebäude in Laufreihenfolge (Etage, Standort) |
| `GET /ai/status` | Fester Stand `{ transcribe: false, structure: "rules", vision: false }` – der Worker ruft keine KI auf |
| `POST /ai/parse` | Text (z. B. Diktat) regelbasiert (`shared/smart.ts`) in Mängel/Aufgaben/Notizen/Sammelanlagen zerlegen: `{ text, checkpoints?, categories? }` → `{ items, source: "rules" }`. Sammelanlage: `kind: "asset"` mit `count` (max. 50), `category` (Schlüssel oder null), `floor`, `location`; `categories: []` schaltet sie ab, ohne Angabe gelten die Arten des Workspaces |

Keine KI im Worker (seit v4): Sprache erkennt der Browser, Texte zerlegt der Regel-Parser. Server-Transkription
(`/ai/transcribe`), Typenschild- und Bilderkennung (`/ai/typeplate`, `/ai/identify`) gibt es nicht mehr (`404`) –
Fotos liest Claude über den MCP-Server (`get_photo`). Damit entstehen keine KI-Kosten bei Cloudflare.

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
- **Mit Schlüssel:** Header `Authorization: Bearer pk_…`. Die frühere Adresse mit Schlüssel im Pfad (`/api/mcp/k/…`)
  gibt es nicht mehr (`404`).
- Rechte wie der Schlüssel (höchstens Prüfer, Zugriffsbereich und „darf anlegen“ der Person): mit Lese-Schlüssel liefern
  schreibende Werkzeuge `isError`. **Claude unterschreibt nie** – `inspect` legt Prüfungen nur zur Unterschrift bereit.

```bash
claude mcp add --transport http pruefkompass https://<instanz>/api/mcp          # OAuth im Browser
claude mcp add --transport http pruefkompass https://<instanz>/api/mcp --header "Authorization: Bearer pk_…"
```

**Werkzeuge** (nach Absicht; Antworten knapp, mit Element-Codes und Namen statt interner IDs – IDs nur, wo ein
Folgeaufruf sie braucht; Fehler als `isError` mit Hinweis, was stattdessen geht):

| Werkzeug | Zweck |
|---|---|
| `briefing` | Lage in einem Aufruf: Kennzahlen, „Jetzt“-Liste (max. 12), wartende Unterschriften, Autopilot-Protokoll seit `since` |
| `search` | Suche über Elemente, Objekte, Gebäude, Mängel, Aufgaben; `type: "properties"`/`"categories"` als Übersicht |
| `list` | Listen mit Filtern: `what: assets\|defects\|tasks\|inspections\|walkthroughs` |
| `get` | Ein Ding vollständig (`kind` + `ref`: Code, Name oder ID) mit Verlauf und Foto-/Grundriss-Verweisen (`foto:…`, `plan:…`) |
| `get_photo` | Foto oder Grundriss als MCP-Bildinhalt (JPEG/PNG/WebP bis 4 MB; SVG-Grundrisse als Text) |
| `capture` | Mehrere Mängel, Aufgaben, Notizen, Elemente auf einmal; ähnliche offene Mängel → `skipped`, mit `force` trotzdem |
| `update_asset` | Stammdaten nachtragen (Hersteller, Modell, Baujahr, Seriennummer, Zulassung, Standort, Etage, Etikett, weitere Felder) |
| `update_tasks` | Status, Zuständige, Frist, Priorität, Kommentar – für eine oder mehrere Aufgaben |
| `update_defect` | Mangel beheben (mit Notiz) oder wieder öffnen |
| `plan` | Rundgänge ansehen, Wochenplanung auslösen, Aufgaben aus Mängeln |
| `tour` | Rundgang führen: `start` (Gebäude) → nächstes fälliges Element mit Standort, Prüfpunkten und bekannten Mängeln; `next`; `status` |
| `inspect` | Prüfung aus dem Gesagten ausfüllen (`allOk`, Mängel mit Prüfpunkt-Zuordnung, bekannte Mängel `still`/`fixed`, Arbeiten, Bemerkung, nicht prüfbar) und **zur Unterschrift bereitlegen** – nie abschließen |
| `setup` | Objekt, Gebäude, Elemente (Etage, Standort, Art, Marker auf dem Grundriss) in einem Rutsch; zuerst `preview: true`. Neue Objekte/Gebäude nur mit Admin-Rechten, also nicht per Schlüssel |
| `autopilot` | Schritte und Protokoll ansehen, Schritt einmal ausführen, Eintrag rückgängig machen; Stufen ändern nur Admins in der App |
| `report` | Kennzahlen für Zeitraum (`month`, `year`, `from`/`to`) und Objekt als Text |

**Prompts** (`prompts/list`, `prompts/get`, erscheinen in Claude als fertige Befehle): Tagesbriefing (`seit`),
Diktat erfassen (`text`, `element`), Woche planen (`tage`), Typenschilder nachtragen (`objekt`), Monatsbericht schreiben
(`objekt`, `monat`), Rundgang führen (`gebaeude`), Plan einrichten (`objekt`).

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
