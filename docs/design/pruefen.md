# Prüfen – Bereich auf Designsystem v2

Gilt für Prüfungsliste, Prüfablauf (online/offline), Rundgang, Code scannen, Offline-Modus, Begehungen,
Protokoll-Ansicht und das Erfassen-Sheet. Grundlage ist `docs/design.md`; neue Bausteine liegen unter
`src/components/inspect/`. Bilder (390 px = `m-…`, 1360 px = `d-…`): `docs/design/pruefen/`.

## Leitidee

Eine Hand, ein Blick, ein nächster Schritt. Im Prüfablauf sagt die feste Leiste unten immer, **was noch
fehlt**, und „Weiter“ springt genau dorthin. Erst wenn alles da ist, wird daraus „Abschließen“.

## Bausteine (`src/components/inspect/`)

| Datei | Inhalt |
|---|---|
| `RunFrame.tsx` | Rahmen für Prüfung und Begehung: Kopf (Zurück, Element, Speicherstand, „3/16“, Fortschrittslinie), Inhalt, Abschlussleiste mit Status + „Weiter“/„Abschließen“. `ReadyList` = „Vor dem Abschluss“. `RunStep` beschreibt einen Schritt (`todo`, `done`, `go`). |
| `Checkpoint.tsx` | `CheckpointRow` (Nummer bzw. Ergebnis-Symbol, Frage, Hinweis, Antwortfelder, darunter Mangel), `AnswerSegment` (i. O. · Mangel · n. z., 48 px hoch auf dem Handy), `revealNextOpen` (rollt nach i. O./n. z. zum nächsten offenen Punkt, nur wenn nötig), `reveal`. |
| `Choice.tsx` | `ToggleChip` (Mehrfachauswahl mit Haken) und `RadioChips` (Einfachauswahl; `fill` = gleich breite Felder in einer Zeile auf dem Handy). |
| `VoicePanel.tsx` | „Befund einsprechen“: Mikrofon, Wellenform + Zeit während der Aufnahme, Text prüfen, „Übernehmen“. |
| `Signature.tsx` | `SignatureSection` (Name + Zeichenfläche mit Grundlinie, Name und Datum unter der Linie) und `SignaturePad`. |

Farben: Antwort „i. O.“ grün, „Mangel“ Bernstein (wie das Ergebnis „Mit Mängeln“), „n. z.“ neutral – jeweils
weiche Fläche mit farbiger Kontur, keine Vollflächen. Orange nur für den Mikrofonknopf und die Markierung des
aktuellen Prüfpunkts (dünner Strich links).

## Kleine kluge Abkürzungen

- **„Rest i. O.“ nur mit Bestätigung** (Dialog „N offene Punkte auf „In Ordnung“ setzen?“ → „Alle i. O. setzen“).
- **Weiter zum Nächsten:** Nach „i. O.“/„n. z.“ rollt die Seite zum nächsten offenen Punkt, wenn er sonst unter
  der Leiste verschwände. Bei „Mangel“ bleibt der Blick beim Mangel.
- **Leiste weiß, was fehlt:** Art der Prüfung → Prüfpunkte → Mangel ohne Bezeichnung → Begründung →
  Unterschrift. Ein Tipp springt hin (bei Begehungen klappt der Abschnitt mit der ersten offenen Frage auf).
- **Name der Unterschrift wird gemerkt** (pro angemeldeter Person auf dem Gerät) und beim nächsten Entwurf
  vorgeschlagen.
- **Art der Prüfung eingeklappt**, sobald eine gewählt ist („Ändern“ klappt auf) – die Prüfpunkte rücken nach oben.
- **Rundgang:** Nach „Abschließen“ landet man auf dem Rundgang mit „FST-… gespeichert“, das nächste Element
  steht als „Weiter mit“ oben, der Startknopf hat den Fokus.
- **Entwurf verwerfen** und Massenlöschen fragen über `useConfirm` statt `window.confirm`.

## Seiten

- **Prüfungen** (`Inspections.tsx`): `Tabs` mit Zählern im Ton, Prüfart-Chips waagrecht scrollend, Liste mit
  `ListRow` (Code · Art, Ort, rechts Fälligkeit in Worten mit Status-Punkt, offene Mängel). Durchgeführt:
  Filter auf dem Handy hinter „Filter“, Auswahlleiste im Kartenkopf.
- **Prüfablauf** (`InspectionRun.tsx`, `run.tsx`): siehe oben; Skelett beim Laden, eigene Seite für
  „Bereits abgeschlossen“.
- **Rundgang** (`Round.tsx`): Fortschritt in Segmenten, Bestätigung, große „Weiter mit“-Karte, „Danach“ als Liste.
- **Code scannen** (`Scan.tsx`): dunkler Sucher mit vier Ecken, Hinweis darunter, manuelle Eingabe mit Label.
- **Offline-Modus** (`Offline.tsx`): „Gebäude laden“, „Auf diesem Gerät“ (je Gebäude eine `List`),
  „Warteschlange“ rechts bzw. darunter.
- **Begehungen** (`Walkthroughs.tsx`): „Weitermachen“ / „Abgeschlossen“; Ablauf mit aufklappbaren Abschnitten
  und denselben Prüfpunkt-Zeilen.
- **Protokoll** (`Protocol.tsx`): feste Werkzeugleiste oben, Papier bleibt druckfertig (A4, `print:`-Regeln unverändert).
- **Erfassen** (`CaptureSheet.tsx`, `Dictate.tsx`): großer Mikrofonknopf mit Wellenform, Textfeld,
  „Wird erkannt“ als Live-Liste, Ort, Schnellzugriffe; danach Karten je Eintrag (Art umschalten, Schwere in
  einer Zeile, Maßnahme); Bestätigung mit Hinweis auf Doppelte („Trotzdem anlegen“).

## Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Google Maps (iOS) | https://mobbin.com/screens/f5b45e75-5d1c-483d-bed7-8c4d69ae133f | Je Frage drei gleich große Antwortfelder (Ja/Nein/Unsicher) in einer Zeile → `AnswerSegment` |
| Tripadvisor (iOS) | https://mobbin.com/screens/ba2b182f-3073-4585-963f-48315a20f910 | Lange Frageliste, Antworten direkt unter der Frage, Hauptknopf fest unten |
| Fresha (iOS) | https://mobbin.com/screens/d6becd9c-f79e-4e33-8fa9-0f4921b1777b | Unterschrift: Name-Feld darüber, Zeichenfläche mit Löschen, ein Abschlussknopf |
| Apple Notes (iOS) | https://mobbin.com/screens/2081c297-9589-4290-838c-31721f84336b | Grundlinie mit „×“ und Hinweis „mit dem Finger“ in der Zeichenfläche |
| Lemonade (iOS) | https://mobbin.com/screens/5d53bff1-db4a-4600-a2a7-2202266fbc9b | Name und Datum unter der Unterschriftslinie |
| Todoist (iOS) | https://mobbin.com/screens/a3bcf07b-20f0-4cc1-8938-16f1b5035a14 | Beim Sprechen erscheinen erkannte Einträge sofort als Liste („Wird erkannt“) |
| Fabric (iOS) | https://mobbin.com/screens/325b348f-5710-41f7-a879-dd9e18c494b3 | Kompakte Aufnahmezeile: Wellenform + Zeit + Stopp statt Vollbild (`VoicePanel`) |
| Uber (iOS) | https://mobbin.com/screens/c9df75d3-ad98-407a-b196-516df6283491 | Sucher aus vier Ecken statt Rahmen, Alternative „Code eingeben“ darunter |
| PlayStation App (iOS) | https://mobbin.com/screens/509036f5-04c0-4611-a5ac-469c6d89ab0c | Kamera oben, kurzer Hinweis + manuelle Eingabe unten auf hellem Grund |
| Brick (iOS) | https://mobbin.com/screens/eb2562e9-5f2c-4e6a-87da-8ca18fdc29eb | Ruhige Bestätigung: Symbol, ein Satz, eine Weiter-Aktion (Rundgang, Erfassen „Gespeichert“) |
| Mindvalley (iOS, Ablauf) | https://mobbin.com/flows/fbdc633d-5f95-40f8-8c94-64f38c2f7543 | „0/2 erledigt“ als Kopfzähler, Leiste unten wechselt von Aktion zu „erledigt“ |
| Zillow (Web) | https://mobbin.com/screens/8743e2d5-d864-47c4-b7ec-43bd57df810d | Vor dem Absenden: Abschnitte mit „unvollständig“-Markierung, die direkt zur Stelle führen (`ReadyList`) |
| Deputy (Web) | https://mobbin.com/screens/15b36d84-f23d-443b-9309-06b0226780fa | Abschlussblock „alles ausgefüllt“ direkt vor dem Absenden |

Gesucht, aber verworfen: pillowtalk/Google-Vollbild-Aufnahme (zu verspielt für die Baustelle),
Satispay-Laserlinie (Effekt ohne Nutzen), Lern-App-Erfolgsseiten mit Abzeichen und Punkten (Uxcel, Brilliant, Mimo).
