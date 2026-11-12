# Verwaltung und öffentliche Seiten

Umsetzung von `docs/design.md` für Einstellungen, Team, Subunternehmer, Import, Berichte, Hilfe, Suche (Strg K),
Glocke, Rechtstexte sowie die öffentlichen Seiten Kunden-Link (`/kunde/:token`), Auftrag für Subunternehmer
(`/extern/:token`), Partner-Seite (`/partner/:code`) und die OAuth-Freigabe für MCP-Clients (`/oauth/authorize`).
Bilder (1360 und 390 px, v3): `docs/design/v3/verwaltung/` (`d-…` Desktop, `m-…` Handy). Die v2-Bilder sind entfernt.

## v3 (Phase 2, Paket H)

- **Eine `Surface` je Seite bzw. Einstellungs-Reiter**, Abschnitte als `SettingsSection` (neu in `admin/`: Haarlinie
  statt Karte, links 13-px-Titel + ein Satz, rechts Felder; Aktionen rechts unten) oder `Section`. Keine Karten in Karten.
- **Automatik** ist die ruhigste Seite: Regeln als `SettingRow` (Name · ein Satz · `Segmented` · „Zuletzt ausgeführt“
  in `ink-3` darunter), Zuweisungsregeln als Editor-Zeilen, Protokoll als zeitlich geordnete Liste nach Tagen
  (Uhrzeit · Zusammenfassung · Regel · Person · „Rückgängig“ als Textknopf).
- **Listen:** Titel · eine graue Meta-Zeile · rechts ein Statuswort (`StatusText`) oder Datum. Team: Rolle rechts,
  Bereich/Anlegerecht/Brandschutzbeauftragte/r als Text in der Meta-Zeile. Subunternehmer: „3 offen“ als Statuswort,
  Partner-Zugänge als eigener Abschnitt. Berichte: Liste ohne Symbole, Gruppen als kleine graue Köpfe.
- **Keine Symbolkacheln, keine getönten Pillen** (Badges → Punkt + Wort), Label- und Artfarben nur als Punkt (`LabelDot`).
- **Zinnober** nur für überfällig/kritisch und die eigentliche Lösch-Bestätigung („Konto löschen“ öffnet erst den Dialog).
- **Öffentliche Seiten im Stil der Anmeldung** (`PublicPage`): Beton-Grund, Logo oben links, Inhalt linksbündig im
  Raster, eine Surface, Rechtslinks unten. OAuth-Freigabe als schmale Fläche wie das Anmeldeformular; Kunden-Link mit
  Lage als Satz, Prüfquote als Tintenlinie (Zinnober-Anteil = überfällig) und Kennzahlen ohne Kasten.
- Neue Bausteine in `admin/`: `SettingsSection`, `PublicPage`, `SurfaceHead`, `DayHeading`/`ListHeading`,
  `groupByDay`, `fmtTime`; `Stepper` neutral, `SaveBar` Radius 8. `PublicHeader` entfällt.
- `public/icon.svg` und Manifest-/`theme-color` auf v3 (Tinte, Beton) – kein Orange mehr.

## v2 (Stand davor)

## Neue Bausteine (`src/components/admin/index.tsx`)

Ergänzen `ui.tsx`, ohne es zu ändern.

| Baustein | Wofür |
|---|---|
| `SettingRow` | Zeile in einer `SettingsSection`: Titel + Erklärung links, Bedienelement rechts (Handy: darunter). |
| `RowDivider` | Haarlinie zwischen Zeilen in derselben Einstellungs-Karte, randlos. |
| `CopyField` | Nur-Lese-Feld + „Kopieren“ (API-Schlüssel, Kalender-Adresse, Einladungs- und Passwort-Link, MCP-Adresse). |
| `CodeBlock` | Befehl in Mono mit Kopieren-Symbol; scrollt in sich (kein Seitenüberlauf). |
| `Steps` | Nummerierte Anleitung (MCP-Verbindung in zwei Schritten). |
| `Stepper` | Fortschritt eines Ablaufs (Import: Datei wählen · Vorschau prüfen · Importiert). |
| `SaveBar` | „Ungespeicherte Änderungen“ – klebt unten, erscheint nur bei Änderungen (Unternehmen). |
| `MeterBar` | Anteilsbalken (Speicher, Prüfquote im Kunden-Link). |
| `PublicHeader` | Schlanker Kopf für öffentliche Seiten. |

## Was sich je Seite geändert hat

- **Einstellungen** (`src/pages/Settings.tsx` + `src/pages/settings/*.tsx`, vorher 1 Datei mit 1500 Zeilen):
  Unterstrich-`Tabs` in der URL, durchgehend `SettingsSection` (links Erklärung, rechts Karte).
  „Profil“ und „Datenschutz“ sind zum Reiter **Konto** zusammengelegt (alter Link `?tab=privacy` springt zum
  Abschnitt „Datenschutz“). **Unternehmen** ist ein Formular mit Speichern-Leiste statt vieler Einzelkarten,
  gegliedert in Firmenprofil · Prüfungen · Automatisierung (Schalter) · Dokumente; Speicher, Sicherung und
  Papierkorb darunter wirken sofort. **Benachrichtigungen**: Ereignis-Matrix speichert sofort, Nicht stören mit
  Schaltern, Kalender-Abo mit `CopyField`. **API**: Schlüsselliste wie in v0 (Zähler + „Neuer Schlüssel“,
  Widerrufen im ⋯-Menü mit Bestätigung, alte Schlüssel einklappbar), **„Mit Claude verbinden (MCP)“ als Anleitung in
  zwei Schritten** (Adresse eintragen → Verbinden und freigeben), Claude Code/andere Programme eingeklappt; die
  Werkzeugliste steht in einem Array (`MCP_TOOLS`). REST-Kurzreferenz als Liste. **Prüfvorlagen** als eine Liste mit
  aufklappbaren Zeilen. **Aktivität** nach Tagen gruppiert, mit Suche. `window.confirm` durch `useConfirm` ersetzt.
- **Team**: eine Mitgliederliste; die ganze Zeile öffnet den Dialog (Rolle, Zugriff, Anlegerecht,
  Brandschutzbeauftragte/r mit Verlauf). Die Rolle wird jetzt im Dialog geändert statt per Auswahl in der Zeile;
  Passwort-Link, Inhaberschaft und Entfernen liegen im ⋯-Menü. Offene Einladungen als eigene Liste, Rollen als Legende.
  Einladen-Dialog mit Rollen als Auswahlkarten.
- **Subunternehmer**: Liste statt Kartenraster (Telefon/E-Mail direkt antippbar, Zähler offen/erledigt, ⋯-Menü).
  Öffentlicher Auftrag `/extern/:token`: Kopf, Titel mit Status-Badges, `PropertyList`, Mangel mit `SeverityBadge`,
  Rückmeldung mit großen Knöpfen auf dem Handy.
- **Import**: `Stepper`, Ablagefläche (auch Ziehen und Ablegen) + Hinweis-Karte mit Vorlage, Datei-Karte,
  Fehler als `Notice`, Vorschau als `DataTable` (Handy: Zeilen), Erfolg mit „Weitere Datei“.
- **Berichte**: Generator als Karte mit Fußzeile (Anzahl je Ergebnis mit `StatusDot`), Standardberichte als eine Liste
  mit Gruppen (Als PDF · Listen und Etiketten · Weitere Nachweise) statt zehn bunter Karten, Archiv mit Filter-Chips
  (mit Zählern), Bestätigung vor dem Löschen, „weitere anzeigen“.
- **Hilfe**: Suchfeld, Anleitungen und FAQ als Akkordeon-Listen mit nummerierten Schritten, Leerzustand mit Aktion.
- **Suche (Strg K)**: Treffer nach Gruppen (Gefilterte Liste · Elemente · Objekte · Gebäude), Tastenhinweise unten,
  kein Glas-Effekt; Verhalten (Zeile „… anzeigen: …“, Enter, Pfeiltasten) unverändert.
- **Glocke**: Kopf mit Zähler und „Alle gelesen“, Umschalter Alle/Ungelesen, Gruppen Neu/Früher, Leerzustand,
  Link zu den Einstellungen; auf dem Handy als volle Breite unter der Kopfzeile.
- **Rechtstexte**: Bestätigungs-Dialog als Bottom-Sheet mit `Segmented`, öffentliche Seite mit Reitern.
- **OAuth-Freigabe**: zwei Symbole mit ⇄, Zieladresse direkt unter dem Titel, angemeldete Person + Workspace,
  Rechte als Auswahlkarten, Berechtigungen in einem Kasten, Fuß mit Abbrechen/Verbinden.
- **Kunden-Link**: Gesamtlage in einem Satz mit Statuspunkt, Prüfquote mit Verteilungsbalken, drei Kennzahlen,
  Mängel mit `SeverityBadge`, Elemente nach Gebäude gruppiert (`ListGroup`).

## Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Base44 | https://mobbin.com/screens/ae578cc2-eb74-4a7d-8fed-8aa8304cf960 | Einstellungen in Abschnitten mit Karte und Aktionen am Kartenende |
| Tally | https://mobbin.com/screens/d2224426-d2fa-4506-be22-3d9c2b22ec5a | Zeile „Bezeichnung + Erklärung links, Schalter/Auswahl rechts“ → `SettingRow` |
| Replit | https://mobbin.com/screens/f4d4cf18-a47c-486d-ad88-48acf37bbd4e | „Alle anderen abmelden“ und Konto löschen als Zeile mit Aktion rechts |
| Subframe | https://mobbin.com/screens/eff11c7f-b516-4c27-a9a8-88f72e7c7150 | Dichte Mitgliederliste, sekundäre Aktionen im ⋯-Menü je Zeile |
| Searchable | https://mobbin.com/screens/462d08d4-2fac-4787-8c60-8526e217f2c0 | Offene Einladungen getrennt von Mitgliedern |
| v0 | https://mobbin.com/screens/5d7d9fef-89b1-45f8-8939-4541ddfa4203 | API-Schlüssel: Kopf mit Anzahl + „Neuer Schlüssel“, Zeile mit Symbol, Präfix, „Noch nicht genutzt“, ⋯ |
| Buffer | https://mobbin.com/screens/9ddf17cd-86e6-47fe-8495-29f8e46cc2b7 | Codebeispiel in heller Box mit Kopieren-Symbol (`CodeBlock`) |
| Klaviyo | https://mobbin.com/screens/3d7c4bf5-dcfa-4e4f-b739-3015c2a4ab96 | Benachrichtigungs-Panel: Titel mit Zähler, „Alle gelesen“ rechts |
| Replit | https://mobbin.com/screens/c507d197-deb3-4ce2-a054-eddb06af3e27 | Umschalter Ungelesen/Alle im Panel |
| Meetup | https://mobbin.com/screens/f73ef774-f449-42d0-a86b-519cfc981700 | Benachrichtigungen nach Zeit gruppiert, Punkt für ungelesen |
| Calendly | https://mobbin.com/screens/2c3955d1-f994-4494-b0d9-4b672af38d93 | Import: Ablagefläche links, Tipps + Vorlage rechts |
| Unify | https://mobbin.com/screens/5d41e96f-6ec3-4da9-9c46-34a244032413 | Gewählte Datei als Karte mit Status und Entfernen |
| Plane | https://mobbin.com/screens/c3992c78-cd51-48d7-ba3e-7cf658ab0d5c | Schrittanzeige für den Import (`Stepper`) |
| Plane | https://mobbin.com/screens/9374340d-8182-4ae9-9677-8b9b24918dc3 | Berichte: Erzeugen oben, „frühere Exporte“ als Liste darunter |
| Customer.io | https://mobbin.com/screens/ba3f64a1-271c-49aa-82e9-762a33af7e4d | Archivzeile: Titel, wer/wann, Herunterladen rechts |
| Plane | https://mobbin.com/screens/25afc64b-cff4-43e8-a852-f0656e234b43 | OAuth-Freigabe: zwei Symbole mit ⇄, Rechte-Kasten, Hinweis auf Zieladresse |
| Meetup | https://mobbin.com/screens/5a92a391-1d08-4f34-b72e-307e7d4bb253 | Angemeldetes Konto als Zeile über den Rechten |
| Base44 | https://mobbin.com/screens/341a4e76-473b-4c74-916f-8a5a559985fb | Kurze Liste „darf danach“ mit Häkchen |
| incident.io | https://mobbin.com/screens/05816d43-88a9-4537-a444-a09ca5456e03 | Öffentliche Statusseite: schmale Spalte, Status je Bereich mit Symbol, Herkunft unten |
| Upwork | https://mobbin.com/screens/4a11dba0-b37b-4a99-91bf-a00f5d7bb103 | Gesamtlage als ein klarer Satz über den Details (Kunden-Link) |
| Base44 | https://mobbin.com/screens/37231d69-ce89-4902-9921-36ab51cf3c6a | Verbrauchsbalken mit Werten rechts (Speicher) |
| incident.io | https://mobbin.com/screens/f1b4ccbd-d6f6-4ccb-89b5-3c48d9fd2151 | Suche: Treffer nach Gruppen, Tastenhinweise ↑↓ ↵ unten |

Gesucht, aber verworfen: Toggl/Luma-Einladen (bunte Knöpfe, Werbebanner), Snowflake-Import (zu technisch),
Stripe-Health (drei leere Kacheln), Semrush-Berichtsdialog (zu viele Optionen).

## Tests

- Angepasst: `e2e/03-workflows.cjs` (Passwort-Link jetzt im ⋯-Menü), `e2e/04-reports.cjs` (Löschen bestätigen).
- Neu: `e2e/17-verwaltung.cjs` – Speichern-Leiste (erscheint/verwerfen/speichern), `?tab=privacy`, MCP-Anleitung,
  Rolle im Team-Dialog, Glocke mit Filter, Hilfe-Leerzustand, Import-Schritte, 390 px ohne Überlauf auf allen
  Verwaltungsseiten und Glocke innerhalb des Bildschirms.
