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

## Offen / bewusst akzeptiert

| Befund | Bewertung |
|--------|-----------|
| Kontolöschung: Workspaces, deren einziges Mitglied man ist, bleiben mit ihren Daten bestehen; Datenexport ohne Begehungen/Berichte/Anhänge | mittel – vor produktivem Einsatz ergänzen (Workspace inkl. R2-Dateien mitlöschen, Export erweitern) |
| Sitzungs-, Reset- und Einladungs-Tokens im Klartext in D1 | niedrig – 256-Bit-Zufallswerte; bei Datenbank-Leck aber direkt nutzbar. Verbesserung: nur SHA-256 speichern |
| Sitzungen 30 Tage ohne Leerlauf-Timeout | niedrig – Sitzungen sind einsehbar und einzeln beendbar |
| PBKDF2 mit 100 000 Iterationen (OWASP empfiehlt 600 000) | niedrig – Kompromiss wegen CPU-Limit der Workers |
| Listen ohne Seitenaufteilung, Upload-Größe erst nach dem Einlesen geprüft | niedrig – Missbrauch nur durch angemeldete Nutzer des eigenen Workspaces |
| Tokens in URL-Pfaden (Links für Passwort, Einladung, Subunternehmer) | info – erscheinen in Server-Logs; übliches Vorgehen für Einmal-Links |
| `/register` und Einladungen verraten, ob eine E-Mail registriert ist | info – ohne E-Mail-Versand nicht sinnvoll vermeidbar; Registrierung ist gedrosselt |
| Admins können andere Admins herabstufen/entfernen | Designentscheidung |
| Keine Drosselung der API je Schlüssel | niedrig – ungültige Schlüssel werden gedrosselt; gültige nur durch Admins vergeben |

## Geprüft und in Ordnung

- **Mandantentrennung:** Alle Abfragen sind auf den Workspace der Sitzung beschränkt, auch Massenaktionen, Importe, Vorlagen, Grundrisse, Berichte und Dateien.
- **SQL:** durchgehend parametrisiert, dynamische Filter per Regex abgesichert.
- **Frontend:** kein `dangerouslySetInnerHTML`.
- **CSRF:** Header `x-pk` zusätzlich zu SameSite=Lax, kein CORS.
- **Cookies:** HttpOnly, Secure.
- **Rollen:** an allen schreibenden Routen geprüft.
- **API-Schlüssel:** nur als Hash gespeichert, Rolle gedeckelt, kein Zugriff auf Konto und Benachrichtigungen.
- **Service Worker:** cacht keine API-Antworten.
- **Nachweise (11.10.2026):** Berichtigungen ändern die ursprüngliche Prüfung nicht (Unterschrift, Befunde und Datum bleiben erhalten); berichtigen dürfen nur die prüfende Person oder Admins, Lesezugriff nie. Papierkorb und Wiederherstellung nur für Admins (`e2e/10-corrections.cjs`).
- **Secrets:** In Repo und Git-Historie keine Zugangsdaten gefunden.
