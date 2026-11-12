# Prüfkompass

Web-App für wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente
(Feuerschutztüren, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder und eigene Elementarten),
Prüfung vor Ort mit Unterschrift, Mängel- und Aufgabenverfolgung, Berichte, QR-Etiketten und API.

Live: https://pruefkompass.ksqsebastian.workers.dev ·
Funktionsanalyse des Vorbilds und Abgleich: [`docs/analyse/`](docs/analyse/README.md) ·
API: [`docs/api.md`](docs/api.md)

## Funktionen

**Einfach und smart**
- **Fünf Orte** statt Menü-Wust: **Heute** · **Objekte** · **Prüfen** · **Offen** · **Berichte**. Alles Weitere (Team,
  Subunternehmer, Import, Prüfvorlagen, Automatik, API, Offline-Modus, Hilfe) liegt unter **Einstellungen** (Zahnrad bzw.
  Konto-Menü). Handy-Leiste: Heute · Prüfen · Erfassen · Offen · Objekte; Berichte und Einstellungen im Konto-Menü oben rechts.
  Alte Adressen leiten samt Query um (`src/moved.tsx`): `/maengel?id=…` → `/offen?art=maengel&mangel=…`,
  `/aufgaben?id=…` → `/offen?art=aufgaben&aufgabe=…`, `/pruefungen?tab=…` → `/pruefen?tab=…`, `/begehungen` →
  `/pruefen/begehungen`, `/team`, `/subunternehmer`, `/import`, `/hilfe` → `/einstellungen/…`; `/elemente` bleibt als Ansicht
  „Alle Elemente“ unter Objekte, `/offline` als Unterseite von Prüfen
- Startseite **Heute**: Datum und Lage in einem Satz, zwei Knöpfe (Rundgang starten, Scannen), Prüfstatus-Zahlen,
  „Jetzt“ (am Handy höchstens 5 Zeilen, Aktion rechts in der Zeile) und „Erledigt für dich“
- **Prüfen**: Überblick in einer Fläche – fällige Rundgänge je Gebäude, Fälliges (Überfällig, Bald fällig, Nie geprüft,
  Nicht prüfbar), angefangene Prüfungen, Begehungen, zuletzt abgeschlossene Prüfungen; Scannen, Offline und Begehung im Kopf
- **Offen**: eine Arbeitsliste aus Mängeln und Aufgaben, Umschalter **Alle · Mängel · Aufgaben**; „Alle“ zeigt zuerst
  Dringendes (schwere Mängel ohne Aufgabe, überfällige Aufgaben), dann übrige Mängel ohne Aufgabe, dann Aufgaben nach
  Fälligkeit – ein Mangel mit offener Aufgabe steht nur einmal da
- **Erfassen per Sprache** (zentraler Mikrofon-Knopf): einsprechen oder tippen, Prüfkompass zerlegt den Text in
  Mängel (Schwere, Maßnahme), Aufgaben (Frist) und Notizen; Element-Codes werden erkannt, die aktuelle Seite gibt den Ort vor
- **Diktat in jedem Textfeld** und „Befund einsprechen“ im Prüfablauf (Mängel landen beim passenden Prüfpunkt);
  Vorschläge für Maßnahme und Schweregrad; Spracherkennung des Browsers und Regel-Parser (`shared/smart.ts`) – der Worker
  ruft **keine KI** auf (keine KI-Kosten bei Cloudflare); Hören, Lesen und Sehen übernimmt Claude über den MCP-Server
- **Suche in normaler Sprache** (Strg+K): „überfällige Feuerlöscher Grundschule“ öffnet die passend gefilterte Liste
- **Rundgang**: fällige Elemente eines Gebäudes in Laufreihenfolge, nach jeder Prüfung direkt weiter zum nächsten
- **Autopilot** (Einstellungen → Automatik): **ein Kreislauf aus sechs Schritten**, je Schritt eine Stufe *Aus* ·
  *Vorschlagen* (eine Zeile unter „Jetzt“ mit einem Knopf) · *Automatisch* (ausgeführt, protokolliert, sieben Tage rückgängig zu
  machen); oben ein Hauptschalter **Autopilot an/aus** (aus = alle Schritte ruhen, Stufen bleiben gemerkt):
  1. **Planen** (Standard automatisch) – montags je Gebäude mit Fälligkeiten in 14 Tagen ein Rundgang-Auftrag an die Person, die
     dort zuletzt geprüft hat; er erledigt sich, sobald im Gebäude nichts mehr im Planungsfenster fällig ist.
  2. **Zuweisen** (automatisch) – schwerer Mangel aus Prüfung, Begehung oder Erfassen → Aufgabe nach Zuweisungsregel
     (Elementart + Schwere → Person oder Partner mit Link, Frist in Tagen).
  3. **Nachhalten** (automatisch) – Frist überschritten → Priorität hoch und Hinweis an die Admins (bei Partner-Aufträgen mit
     „hat sich noch nicht gemeldet“); Mangel 14 Tage nach erledigter Behebung noch offen und keine Nachprüfung → Erinnerung.
  4. **Nachprüfen** (automatisch, schließt den Kreis) – Mängelbehebung erledigt (Person, Mehrfachbearbeitung, Partner-Link oder
     Partner-Seite), Mangel noch offen → Prüfauftrag „Nachprüfung <Code>“ an die Person, die den Mangel festgestellt hat
     (sonst ohne Zuständige), Frist laut SLA. Starten öffnet die Nachprüfung nur mit den betroffenen Prüfpunkten; i. O. → Mangel
     behoben, Auftrag zu; besteht weiter → Behebung wieder offen (Kommentar, Benachrichtigung). Solange der Schritt wirkt, gilt
     „erledigt“ eines Partners nicht mehr als Behebung – das bestätigt erst die Nachprüfung.
  5. **Lernen** (vorschlagen) – wiederholt Mängel → Intervall kürzer, lange mängelfrei → zurück zum Standard.
  6. **Nachweisen** (vorschlagen) – Monatsanfang → Objektberichte des Vormonats im Archiv (erzeugt im Browser einer Admin-Person).

  Wiederholung (monatlich, vierteljährlich, jährlich) ist eine Eigenschaft der Aufgabe und läuft immer. Montags kommt eine
  Meldung **„Autopilot: letzte Woche“** (Einträge je Schritt) an Inhaber und Admins statt Einzelmeldungen für Routine; Zuweisungen
  und Wieder-Öffnungen melden sich weiter einzeln. Protokoll mit „Rückgängig“ im Zugriffsbereich.
- **Jetzt** (auf „Heute“, `GET /now`): eine Warteschlange für alles, was eine Entscheidung oder Handlung der angemeldeten Person
  braucht – Unterschriften, abgelehnte Offline-Übertragungen, schwere Mängel ohne Aufgabe, eigene überfällige Aufgaben,
  Rundgänge, Begehungen, Autopilot-Vorschläge, angefangene Prüfungen, Intervall-Vorschläge; je Zeile eine Aktion, nach
  Dringlichkeit, höchstens 12 (Rest hinter „Alle … anzeigen“)
- **Foto beim Anlegen** (optional, z. B. vom Typenschild): wird am Element gespeichert; Claude liest es über `get_photo`
  und trägt Stammdaten mit `update_asset` nach
- **Sammelanlage per Diktat** unter „Erfassen“: „fünf Feuerlöscher im Erdgeschoss Flur“ → Anzahl, Art, Etage, Standort prüfen,
  Gebäude wählen, anlegen (Zahlwörter eins–zwanzig und Ziffern; Regel-Parser als Rückfall)
- **MCP-Server** im Worker (`/api/mcp`) mit **OAuth-Anmeldung** (Freigabe mit API-Schlüssel oder neuer Verbindung): 15 Werkzeuge
  nach Absicht (`briefing`, `tour`, `inspect`, `capture`, `get_photo` …) und sieben fertige Befehle – Claude ist die Oberfläche
  für Sprache: Rundgang führen, Befund eintragen, Typenschilder lesen, Plan einrichten – siehe `docs/api.md`
- **Bereit zur Unterschrift**: von Claude ausgefüllte Prüfungen warten als Entwurf; die prüfende Person unterschreibt alle
  mit einer Unterschrift (`POST /api/inspections/sign`, nur mit Browser-Sitzung) – Claude schließt nie selbst ab.
  Seite **Unterschreiben** (`/unterschreiben`, Hinweis auf „Prüfungen“): Liste mit Ergebnis und Mängeln (aufklappbar,
  *Bearbeiten* öffnet die Prüfung, *Zurückstellen* nimmt sie aus der Liste), unten „Alle n unterschreiben“ mit der
  gemerkten Unterschrift – beim ersten Mal einmal zeichnen (merken vorgewählt); nicht mehr bereite Prüfungen werden je
  Element mit Grund und Link gemeldet

**Prüfen**
- Prüfung je Element mit Prüfpunkten (i. O. / Mangel / n. z.), Wartungsarbeiten, Fotos, Bemerkungen und Unterschrift
- **Prüfarten** mit eigenen Fristen je Element (z. B. Feuerlöscher: Instandhaltung, innere Prüfung, Festigkeitsprüfung)
- Mängel mit Schweregrad, Beschreibung, **Maßnahme** und Foto
- **Bekannte Mängel im Prüfablauf**: offene Mängel des Elements stehen beim passenden Prüfpunkt („Bekannter Mangel vom …“)
  mit *Weiterhin vorhanden* (Punkt = Mangel, kein Doppel) oder *Behoben* (Punkt = i. O., Mangel wird beim Abschluss
  geschlossen); gleich benannte Mängel werden auch offline nicht doppelt angelegt
- **Art der Prüfung vorbelegt**: Erstprüfung bei nie geprüften Elementen, sonst wiederkehrend; aus einer Mängelbehebung
  gestartet wird es eine Nachprüfung
- **Unterschrift merken** (freiwillig, nur auf dem Gerät): „Mit gemerkter Unterschrift abschließen“ mit einem Tipp,
  vergessen unter Einstellungen → Konto
- **Gesamtbewertung** automatisch oder vom Prüfer festgelegt (mit Pflicht-Begründung im Protokoll)
- **Mehrere Arten der Prüfung** je Prüfung, auch eigene Arten des Workspaces
- **Berichtigung** abgeschlossener Prüfungen: neue Fassung ersetzt die alte, die als Nachweis erhalten bleibt
- **Nachprüfung** nach Mängelbehebung: nur beanstandete Punkte, behobene Mängel werden geschlossen, Turnus bleibt
- Prüfung wieder öffnen, archivieren (auch automatisch), mehrere löschen
- **Offline-Modus** (PWA): Gebäude vorab laden, ohne Netz prüfen, automatische Synchronisation; vom Server abgelehnte
  Übertragungen bleiben dort unter **„Übertragungen prüfen“** (Grund, Person, Element; *Erneut versuchen* – auch an einem
  anderen Element derselben Art – oder *Löschen*), mit Benachrichtigung an die prüfende Person und Admins.
  **Sprache ohne Netz**: „Befund einsprechen“ (auch in der Offline-Prüfung) und „Erfassen“ zeigen immer ein Textfeld für
  das Diktat der Handy-Tastatur und werten ohne Netz (oder bei Netzfehler) lokal mit `shared/smart.ts` aus. Erfasstes
  (Mängel, Aufgaben, Elemente) liegt in einer eigenen Warteschlange (`src/offline.ts`, IndexedDB) und geht bei Verbindung an
  die bestehenden Endpunkte; als ähnlich gemeldete Mängel (409) bleiben auf der Offline-Seite zur Entscheidung.
  **Rundgang offline**: je geladenem Gebäude „Rundgang starten“ – fällige Elemente nach Etage, Standort, Code (wie `tour`),
  nach dem lokalen Abschluss automatisch weiter. Der Service Worker (`public/sw.js`) legt beim Installieren Startseite,
  Haupt-Skript (mit Regel-Parser), Stile und Schriften ab, damit die App schon nach dem ersten Aufruf ohne Netz startet
- **Selbstanpassende Prüfintervalle**: nach zwei Prüfungen in Folge mit Mängeln halbiertes Intervall (mind. 1 Monat), nach
  vier mängelfreien zurück zum Standard, nie länger; Stufe je Workspace *Aus / Vorschlagen / Automatisch*
  (Einstellungen → Unternehmen), Anzeige und *Zurücksetzen* auf der Elementseite
- **Brandschutzbegehung** je Objekt mit Fragenkatalog nach Nutzung und Rechtsgrundlagen; Anlass
  (regelmäßig, außerordentlich, nach Änderung) und **Nachbegehung** zu einer früheren Begehung

**Verwalten**
- Objekte, Gebäude, **Grundrisse** (Bild/PDF) mit Element-Markern, Brandschutzbeauftragte je Objekt
- **Eigene Elementarten** und Varianten; Prüfvorlagen je Prüfart anpassbar
- Ausführliche Prüfungsliste (unter Prüfen) mit Reitern Überfällig, Bald fällig, Nie geprüft, Nicht prüfbar, Neue Elemente, Entwürfe,
  Durchgeführt, Archiv, Berichtigt – filterbar nach Prüfart
- **Mängel** und **Aufgaben** mit Labels, SLA-Richtlinien, Kommentaren (Kennzahlen in Berichte; die frühere Aufgaben-„Übersicht“ entfällt)
- **Aufgabentypen** Prüfauftrag (Element, „Prüfung starten“, wird mit der Prüfung erledigt), Mängelbehebung (Mangel; beim
  Erledigen Rückfrage, ob der Mangel behoben ist) und Sonstiges; Liste gruppiert nach **Überfällig / Fällig heute / Diese Woche /
  Später / Ohne Datum**, Schnellfilter Meine, Ohne Zuständige, Von mir erstellt, Beobachtet; **Mehrfachbearbeitung**
  (Status, Zuständige, Priorität, Fälligkeit)
- **Beobachter** und **@-Erwähnungen** in internen Notizen (mit Vorschlägen aus dem Team) – Benachrichtigung bei Statuswechsel
  und Kommentaren; Notizen bleiben im Subunternehmer-Link unsichtbar
- **Behebung dokumentieren** mit Notiz und Nachher-Foto (wer/wann), im Mangel-Detail, Mängelbericht und Prüfprotokoll;
  **Mangel-Detail** mit Fotos vorher/nachher, Aufgaben und Verlauf; **Ausblenden** (Admins, mit Grund, zählt nicht mit)
- **Mängel nach Dringlichkeit**: offene Mängel nach Schwere, darin zuerst die ohne (offene) Aufgabe, dann die ältesten
- **Subunternehmer**: Aufgabe per Link teilen, Rückmeldung ohne Konto; **Partner-Zugang** je Firma mit widerrufbarem
  Einladungscode → Sammelseite `/partner/:code` mit allen offenen Aufträgen der Firma und Rückmeldung je Auftrag
- **Kunden-Freigabe**: Link je Objekt für Auftraggeber – Prüfquote, Fälligkeiten, letzte Prüfungen, offene Mängel, „Zuletzt aktualisiert“; ohne Konto, widerrufbar
- **Papierkorb**: gelöschte Elemente 30 Tage lang mit Historie wiederherstellbar
- QR-Etiketten (auch Blanko-Etiketten, die beim ersten Scan zugeordnet werden), Suche (Strg+K)
- **Import** aus Excel/CSV mit Vorschau

**Berichte und Daten**
- PDF im Browser: Prüfprotokoll, Begehung, Mängelbericht, Compliance-Übersicht, **Objektbericht** –
  mit Firmenlogo und einstellbarem Dateinamensschema; mehrere Protokolle als ZIP
- **Berichtsgenerator**: Prüfungen nach Zeitraum, Objekt/Gebäude, Elementart, Ergebnis, Prüfer und Art filtern –
  als Prüfbericht (PDF) oder alle Protokolle (ZIP); **Jahresbericht** je Objekt mit Behebungsquote und Begehungen
- **Berichtsarchiv**: jeder erzeugte Bericht wird gespeichert und bleibt abrufbar
- Elementliste als **Excel** (wieder importierbar) oder CSV; vollständiges JSON-Backup
- **Sprache der Dokumente** (Deutsch/Englisch) und **Zeitzone** je Workspace; die Oberfläche ist deutsch

**Team und Konto**
- Rollen (Inhaber, Admin, Prüfer, Lesezugriff), Einladungen, Inhaberschaft übertragen, Aktivitätsprotokoll
- **Kalender-Abo** (iCal) für Outlook, Google, Apple: fällige Prüfungen je Gebäude und Tag, Begehungen, eigene Aufgaben
- **Zugriff je Mitglied**: Prüfer/Lesezugriff auf ausgewählte Objekte oder Gebäude beschränken, Recht zum Anlegen
  neuer Elemente; **Brandschutzbeauftragte/r** (DGUV 205-003) mit Qualifikation und fälschungssicherem Verlauf –
  der Status wird bei jeder Begehung festgehalten
- **Benachrichtigungen** in der App und per Web Push, mit „Nicht stören“-Zeitraum; täglicher Cron für Fälligkeiten
  (einstellbare Vorab-Erinnerung), Wochenübersicht, SLA, Archiv; Hinweis bei Anmeldung von einem neuen Gerät
- Passwort-Link durch Admin (kein E-Mail-Versand), Sitzungen verwalten, **Anmeldeverlauf**, DSGVO-Export/-Löschung, Rechtstexte mit Zustimmung
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
              plans, categories, work (Aufgaben, Subunternehmer, Import), reports, notify, push, cron,
              offline (Offline-Übertragung, abgelehnte Übertragungen), intervals (selbstanpassende Intervalle),
              partners (Partner-Zugang für Subunternehmer)
shared/       Code für Browser und Worker
migrations/   D1-Schema (0001 … 0022)
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

- **Unit-Tests** (`npm test`, Vitest): Fachlogik, Autopilot-Kreislauf, Rangfolge „Jetzt“, Import/Export, Übersetzungen, Ruhezeiten, Web Push.
- **Browser-Tests** (`e2e/`, Playwright): Reihen von der Registrierung über Sicherheitskorrekturen und Massenoperationen bis zu Berichtigung, Nachprüfung sowie Aufgaben und Mängeln (`14-tasks-defects`), dem Autopiloten (`20-autopilot`) und den offenen Punkten aus der Analyse (`21-offene-punkte`: Offline-Fehlliste, Intervalle, Partner-Zugang), dem MCP-Server (`11-ai-mcp`) und „Sprache zuerst“ (`23-sprache`: Rundgang über Claude, Unterschrift mit einem Tipp; `24-unterschreiben-offline`: Seite „Unterschreiben“, Befund einsprechen, Erfassen und Rundgang ohne Netz) sowie der Navigation mit fünf Orten (`25-fuenf-orte`: Leisten, Umleitungen, Prüfen, Offen, Heute am Handy, 390 px).
  Vor jeder Reihe wird die lokale D1 geleert und mit Demodaten befüllt.

```bash
npm run e2e                  # Dev-Server muss laufen (npm run dev)
npm run e2e -- --serve       # startet den Dev-Server selbst (wie in CI)
npm run e2e -- 04 08         # einzelne Reihen
BASE=http://localhost:4173 npm run e2e   # gegen den Produktions-Build (npx vite preview) – prüft auch die CSP
```

Lokal wird Chromium aus `PLAYWRIGHT_BROWSERS_PATH` genutzt, in CI per `npx playwright install chromium`.
Reihe 06 braucht `pdftotext` (Paket `poppler-utils`).

**Sporadische 500er in vollen Läufen** (leere/HTML-Antwort, danach `vite-error-overlay` in einer *späteren* Reihe) kamen nicht vom
Neuladen durch Vite: Antwortete der Worker auf einen POST, ohne den Körper zu lesen (401/403 vor `c.req.json()`), setzte workerd lokal
die Keep-Alive-Verbindung zurück; Miniflares nächste Anfrage darauf endete mit `ECONNRESET`, Vite meldete 500 „fetch failed“ und hob den
Fehler für den nächsten verbundenen Browser auf. Der Worker liest kleine ungelesene Körper deshalb zu Ende (`worker/index.ts`).
Zur Fehlersuche schreibt `E2E_SERVER_LOG=datei npm run e2e -- --serve` die Ausgabe des Dev-Servers mit.

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
