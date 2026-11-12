# Sicherheitsbewertung Prüfkompass

Stand: 10.10.2026. Methode: Code-Review des gesamten Repos (Worker, Frontend, Migrationen,
Git-Historie) durch einen separaten, nur lesenden Prüf-Agenten. Jeder Befund wurde danach im Code
nachvollzogen und – soweit behoben – mit einem automatisierten Angriffstest in
`e2e/08-security.cjs` bzw. `e2e/07-throttle.cjs` abgesichert.

## Behobene Befunde

| # | Schwere | Befund | Korrektur |
|---|---------|--------|-----------|
| 0 | hoch | Kein Schutz gegen Durchprobieren von Passwörtern, Links und API-Schlüsseln | Sperre nach Fehlversuchen (`worker/throttle.ts`): 8 je Konto / 25 je IP in 15 min beim Login, 30 ungültige Links/Schlüssel je IP, 10 Registrierungen je IP/Stunde; HTTP 429 mit `Retry-After`; IP/E-Mail nur gehasht gespeichert, Löschung nach 1 Tag |
| 1 | hoch | Konto-Übernahme über Workspace-Grenzen: Wer einen fremden Nutzer einlud, konnte für ihn einen Passwort-Link erzeugen | Passwort-Link nur für Mitglieder mit niedrigerer Rolle **und** nur, wenn das Konto ausschließlich zu diesem Workspace gehört; weitere offene Links werden beim Zurücksetzen ungültig |
| 2 | mittel | Fremde Dateien über Begehungsfoto + öffentlichen Aufgaben-Link lesbar | Foto-Schlüssel der Begehung auf den eigenen Workspace geprüft; öffentlicher Foto-Abruf prüft das Präfix |
| 3 | mittel | Lesezugriff / Lese-API-Schlüssel erhielten den Freigabe-Token und konnten Aufgaben schließen | Token nur für Rollen ab Prüfer |
| 4 | mittel | Keine Security-Header | CSP, `X-Frame-Options: DENY`, HSTS, Permissions-Policy für die Seiten (`public/_headers`); API-Antworten mit `sandbox`-CSP |
| 5 | mittel | Google Fonts übertragen IP-Adressen an Google (DSGVO) | Schrift selbst gehostet (`@fontsource-variable/geist`) |
| 7 | niedrig | CSV-Formel-Injection | Zellen, die mit `= + - @` beginnen, werden entschärft (XLSX war nicht betroffen) |
| 8 | niedrig | Lese-API-Schlüssel konnte eigene Berichte löschen | Löschen erfordert Prüfer-Rolle |
| 9 | niedrig | Freigabe-Link blieb beim Wechsel des Subunternehmers gültig | Token wird beim Wechsel ungültig |
| 10 | niedrig | Prüfer konnten fremde Entwürfe verwerfen und Fotos abgeschlossener Prüfungen löschen | nur eigene Entwürfe; Nachweisfotos nur durch Admins |
| 11 | niedrig | Push-Abos mit beliebiger URL (Worker sendet Anfragen dorthin) | nur bekannte Push-Dienste, höchstens 10 Geräte je Person |
| 12 | niedrig | Unterschrift als beliebige URL (Tracking-Pixel) | nur `data:image/png|jpeg;base64` |
| 13 | niedrig | Einladungen ohne Ablauf | Einladungen gelten 14 Tage |
| 14 | niedrig | Antwortzeit verriet registrierte E-Mails | Login prüft auch bei unbekannter E-Mail einen Hash |
| 15 | niedrig | Doppelte Push-Nachrichten für bereits gemeldete Ereignisse | Push nur, wenn die Benachrichtigung neu ist |
| 16 | niedrig | API-Schlüssel entfernter Mitglieder wurden bei erneuter Einladung wieder gültig | Schlüssel werden beim Entfernen und bei Kontolöschung widerrufen |
| 6 (Teil) | mittel | Kontolöschung unvollständig | bekannte Geräte und User-Agent der Zustimmungen werden gelöscht, API-Schlüssel widerrufen |
| 17 | info | Klick auf Push-Nachricht öffnete beliebige URL | nur Ziele innerhalb der App |
| 18 | mittel | KI-Funktionen (Diktat, Strukturierung, Typenschild) verursachen Kosten je Aufruf | Drossel 150 Aufrufe je Person/Stunde (`ai-user`), Audio max. 8 MB, nur Prüfer-Rolle; Typenschild nur mit Dateien des eigenen Workspaces |
| 19 | mittel | MCP-Endpunkt ohne CSRF-Header (Clients sind keine Browser) | `/api/mcp*` nimmt ausschließlich API-Schlüssel an (keine Sitzungs-Cookies), alle Werkzeuge laufen über die normale API mit Rolle und Scope des Schlüssels; Freigabe-Tokens und Unterschriften werden nicht ausgegeben (`e2e/11-ai-mcp.cjs`) |
| 21 | hoch | OAuth für MCP (neue Angriffsfläche) | Nur Code-Flow mit PKCE S256 und öffentlichen Clients; Rücksprungadressen bei Registrierung auf https/Loopback beschränkt und bei Freigabe exakt geprüft; Codes einmalig (atomar verbraucht, auch nach falschem Verifier), 10 min gültig; Refresh-Rotation, Wiederverwendung abgelehnt; nur SHA-256-Hashes gespeichert; Tokens an API-Schlüssel gebunden (Widerruf trennt sofort, Rechte nie höher als der Schlüssel); neue Verbindung ohne Schlüssel nur für Admins mit Sitzung + CSRF-Header; Fehlversuche gedrosselt (`token-ip`), Registrierungen je IP begrenzt; CORS nur auf Bearer-Endpunkten ohne Cookies (`e2e/15-oauth.cjs`) |
| 22 | info | Kein Überblick über Anmeldeversuche | Anmeldeverlauf je Konto (Erfolg/Fehlversuch, Gerät, Land – keine IP), 90 Tage, nur mit eigener Sitzung abrufbar, im Datenexport enthalten, bei Kontolöschung gelöscht |
| 23 | mittel | Kunden-Freigabe (öffentlicher Link je Objekt) | Nur Admins; Link = 256-Bit-Token, gespeichert nur als SHA-256; Ablauf 1 Jahr, widerrufbar; Ansicht ohne interne IDs, Fotos, Personen, Notizen; Mängel abschaltbar; ungültige Links gedrosselt (`token-ip`); Aufrufzähler zur Kontrolle (`e2e/16-customer-share.cjs`) |
| 24 | niedrig | Kalender-Abo (ICS-Link) | Persönlicher 256-Bit-Link, nur Hash gespeichert, neu erzeugen macht den alten ungültig, beendbar; Inhalt im Zugriffsbereich der Person; nur Codes/Standorte, keine Mängeltexte oder Personen; Verwaltung nur mit Sitzung; ungültige Links gedrosselt |
| 20 | niedrig | Mangel ohne Prüfung (`POST /defects`) mit fremdem Element/Foto | Element und Objekt werden auf den Workspace geprüft, Foto-Schlüssel nur mit eigenem Präfix (`e2e/12-overhaul.cjs`) |
| 25 | hoch | Zugriffsbereich je Mitglied (Paket B) ließ sich umgehen: Aufgabe mit fremdem Mangel verknüpfen und auf „erledigt“ setzen (schloss den Mangel), Aufgaben/Mängel/Begehungen fremder Gebäude über das Objekt sichtbar, Existenz-Orakel (400 vs. 404) beim Verknüpfen, workspace-weite Berichte und das Aktivitätsprotokoll für Eingeschränkte lesbar, Etikett-Konflikt nannte fremde Codes, gleichzeitige Statusänderungen konnten die Hash-Kette verzweigen | Bereich zentral in `worker/lib.ts`/`worker/data.ts` (`scopeSql`, `walkScope`, `defectScope`, `taskScope`, `defectInScope`); Bezüge außerhalb des Bereichs und unbekannte IDs liefern einheitlich `404`; Begehungen des ganzen Objekts nur bei voller Freigabe; Berichte nur zu voll freigegebenen Objekten oder selbst erstellte; Aktivität nur eigene Einträge; Verlaufseintrag wird nur geschrieben, wenn der Vorgänger unverändert ist (sonst `409`), Abweichung zwischen Status und Verlauf wird angezeigt (`e2e/08-security.cjs` #25, `e2e/13-team-scope.cjs`) |
| 26 | mittel | Aufgaben/Mängel (12.11.2026): Ausblenden, Behebung, Mehrfachbearbeitung, Beobachter und @-Erwähnungen | Ausblenden nur Admins; Beheben/Mehrfachbearbeitung/Kommentare ab Prüfer; alle Abfragen mit Workspace und Zugriffsbereich (`defectScope`/`taskScope`), fremde IDs → 404, Mehrfachbearbeitung ändert nur gefundene Aufgaben im Bereich; Nachher-Foto nur mit eigenem Präfix; Erwähnungen nur für Mitglieder, die die Aufgabe sehen dürfen (sonst 400, keine Meldung); Beobachter nur Mitglieder, Benachrichtigungen nur an aktuelle Mitglieder; interne Notizen nie im Subunternehmer-Link; verknüpfter Mangel einer Aufgabe muss im Bereich liegen (`e2e/08-security.cjs` #26, `e2e/14-tasks-defects.cjs`) |
| 27 | mittel | Offene Punkte (12.11.2026): abgelehnte Offline-Übertragungen auf dem Server, selbstanpassende Intervalle, Partner-Zugang für Subunternehmer | **Offline-Fehlliste**: gespeichert nur bei inhaltlicher Ablehnung (nicht 401/403/429), je Person und `clientId` einmal, höchstens 200 offene je Person; Daten ohne Unterschrift und höchstens 256 KB (sonst nur der Grund), Unterschrift als Datei mit Workspace-Präfix, Fotos nur als Schlüssel; Liste/erneut versuchen/löschen nur eigene Einträge bzw. als Admin, Lesezugriff nie; erneuter Versuch prüft Zugriffsbereich und Workspace des (Ersatz-)Elements und alle Foto-Schlüssel wie beim ersten Mal; der Elementcode wird nur gemerkt, wenn die Person das Element sehen darf. **Intervalle**: Anpassen/Zurücksetzen nur Admins, Element im Workspace und Bereich (sonst 404), nie länger als der Standard, nie unter 1 Monat; jede Änderung im Aktivitätsprotokoll. **Partner-Zugang**: nur Admins; Code = 256-Bit-Zufallswert, gespeichert nur als SHA-256, einmal angezeigt, neu erzeugen macht den alten ungültig, widerrufbar, beim Entfernen der Firma gelöscht; Sammelseite zeigt nur offene Aufträge dieser Firma mit denselben Feldern wie der Einzel-Link (keine internen Notizen, IDs, Personen); Aufträge über eine aus Code-Hash und Aufgabe abgeleitete Referenz statt der ID; ungültige Codes/Referenzen → 404 und gedrosselt (`token-ip`) (`e2e/08-security.cjs` #27, `e2e/21-offene-punkte.cjs`) |
| 28 | niedrig | Prüfen smart (12.11.2026): bekannte Mängel, gemerkte Unterschrift, Bilderkennung | Bekannte Mängel nur des geprüften Elements (Zugriffsbereich über das Element), `knownId`/`resolvedDefects` wirken nur auf offene Mängel genau dieses Elements im eigenen Workspace – fremde IDs werden ignoriert; Abschluss bleibt atomar und idempotent (offline über `clientId`). Gemerkte Unterschrift liegt nur im `localStorage` des Geräts je Person (freiwillig, mit Hinweis, „Vergessen“ unter Konto) und geht nur als Teil einer abgeschlossenen Prüfung an den Server. `POST /ai/identify` nur Prüfer-Rolle, nur Dateien mit eigenem Präfix, gleiche Drossel `ai-user`; die erkannte Art muss eine Art des Workspaces sein (`e2e/08-security.cjs` #28, `e2e/22-pruefen-smart.cjs`) |

## Offen / bewusst akzeptiert

| Befund | Bewertung |
|--------|-----------|
| Kontolöschung: Workspaces, deren einziges Mitglied man ist, bleiben mit ihren Daten bestehen; Datenexport ohne Begehungen/Berichte/Anhänge | mittel – vor produktivem Einsatz ergänzen (Workspace inkl. R2-Dateien mitlöschen, Export erweitern) |
| Sitzungs-, Reset- und Einladungs-Tokens im Klartext in D1 | niedrig – 256-Bit-Zufallswerte; bei Datenbank-Leck aber direkt nutzbar. Verbesserung: nur SHA-256 speichern |
| Sitzungen 30 Tage ohne Leerlauf-Timeout | niedrig – Sitzungen sind einsehbar und einzeln beendbar |
| PBKDF2 mit 100 000 Iterationen (OWASP empfiehlt 600 000) | niedrig – Kompromiss wegen CPU-Limit der Workers |
| Listen ohne Seitenaufteilung, Upload-Größe erst nach dem Einlesen geprüft | niedrig – Missbrauch nur durch angemeldete Nutzer des eigenen Workspaces |
| Tokens in URL-Pfaden (Links für Passwort, Einladung, Subunternehmer, Partner-Zugang) | info – erscheinen in Server-Logs; übliches Vorgehen für Einmal-Links |
| `/register` und Einladungen verraten, ob eine E-Mail registriert ist | info – ohne E-Mail-Versand nicht sinnvoll vermeidbar; Registrierung ist gedrosselt |
| Admins können andere Admins herabstufen/entfernen | Designentscheidung |
| MCP-Variante mit Schlüssel im Pfad (`/api/mcp/k/pk_…`) | niedrig – nötig für Connectoren ohne eigene Header; der Schlüssel kann in Logs von Proxys landen. Empfehlung in der App: eigenen, widerrufbaren Schlüssel nur dafür anlegen |
| Mikrofon-Freigabe (`Permissions-Policy: microphone=(self)`) | info – nur für das Diktat; Aufnahmen werden nicht gespeichert, nur zur Umwandlung an Workers AI geschickt |
| OAuth-Clients registrieren sich ohne Freigabe (dynamische Registrierung) | info – Registrierung allein gewährt nichts; erst die Freigabe durch eine Person mit Schlüssel bzw. Admin-Sitzung. Der Anwendungsname auf der Freigabeseite ist vom Client gewählt – deshalb wird die Rücksprung-Domain deutlich angezeigt |
| Tägliche Erinnerungen (Cron) nennen workspace-weite Anzahlen fälliger Prüfungen auch für eingeschränkte Prüfer | niedrig – nur Zahlen, keine Namen oder Codes; Liste hinter dem Link ist eingeschränkt |
| Admin weist einer eingeschränkten Person eine Aufgabe außerhalb ihres Bereichs zu | info – die Person erhält die Benachrichtigung, sieht die Aufgabe aber nicht; Bereich geht vor |
| Dateien (`/api/files/…`) prüfen nur den Workspace, nicht den Bereich | niedrig – Schlüssel sind 24 Zeichen zufällig und nur über Daten im eigenen Bereich erfahrbar |
| Keine Drosselung der API je Schlüssel | niedrig – ungültige Schlüssel werden gedrosselt; gültige nur durch Admins vergeben |

## Geprüft und in Ordnung

- **Mandantentrennung:** Alle Abfragen sind auf den Workspace der Sitzung beschränkt, auch Massenaktionen, Importe, Vorlagen, Grundrisse, Berichte und Dateien.
- **SQL:** durchgehend parametrisiert, dynamische Filter per Regex abgesichert.
- **Frontend:** kein `dangerouslySetInnerHTML`.
- **CSRF:** Header `x-pk` zusätzlich zu SameSite=Lax, kein CORS.
- **Cookies:** HttpOnly, Secure.
- **Rollen:** an allen schreibenden Routen geprüft.
- **Zugriffsbereich (12.11.2026):** Prüfer/Lesezugriff können auf Objekte bzw. einzelne Gebäude beschränkt werden; alle Listen, Details, Suche, Startseite, Rundgänge, Vorschläge, Exporte, Jahresbericht und Schreibrouten beachten ihn, Admins und Inhaber sind nie eingeschränkt, API-Schlüssel erben den Bereich der erstellenden Person. Anlegerecht für neue Elemente separat (`403`). Status „Brandschutzbeauftragte/r“ nur durch Admins, Verlauf als SHA-256-Hash-Kette.
- **API-Schlüssel:** nur als Hash gespeichert, Rolle gedeckelt, kein Zugriff auf Konto und Benachrichtigungen.
- **Service Worker:** cacht keine API-Antworten.
- **Nachweise (11.10.2026):** Berichtigungen ändern die ursprüngliche Prüfung nicht (Unterschrift, Befunde und Datum bleiben erhalten); berichtigen dürfen nur die prüfende Person oder Admins, Lesezugriff nie. Papierkorb und Wiederherstellung nur für Admins (`e2e/10-corrections.cjs`).
- **Secrets:** In Repo und Git-Historie keine Zugangsdaten gefunden.
