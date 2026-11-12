# Aufgaben und Mängel – Design v3

Ergänzt den Vertrag in [`docs/design.md`](../design.md) (v3) für die Arbeitslisten **Aufgaben** (`src/pages/Tasks.tsx`)
und **Mängel** (`src/pages/Defects.tsx`). Bausteine liegen in `src/components/work/`, Bilder in
[`v3/aufgaben-maengel/`](v3/aufgaben-maengel/) (`d-` = 1360 px, `m-` = 390 px). Die v2-Bilder sind entfernt.

> Kurz: wie Apple-Erinnerungen auf einer weißen Fläche. Gruppen als kleiner grauer Titel mit Haarlinie, ein
> Abhak-Kreis, je Zeile Titel · eine graue Meta-Zeile · rechts **ein** Datum oder Statuswort (+ Avatar).
> Alles Weitere steht im Detailpanel – ohne Seitenwechsel und ohne „Speichern“.

## v3 (Phase 2, Paket G)

Umgesetzt nach `docs/plan/v3.md` Abschnitt 5:

- **Eine `Surface` je Seite**, Gruppen (`WorkGroup`) ohne grauen Balken: Titel 13 px `ink-3` + Zahl, Haarlinie
  zwischen Gruppen, Zeilen-Haarlinien ab dem Textanfang (`pk-list`, `--row-inset: 32px`). Der Abhak-Kreis steht
  bündig mit den Gruppentiteln; erledigt = Tinte statt Grün.
- **Aufgabenzeile:** kein Typ-Symbol, keine Label-Pillen, kein Prioritätsbalken. Meta-Zeile:
  „In Arbeit · Code · Objekt · Typ · Hoch · ● Label“ (Labelfarbe nur als 6-px-Punkt). Rechts das Datum
  (Zinnober nur überfällig), Wecker nur bei verletzter SLA-Frist und grau (`ink-4`, nur ab `sm`),
  Kommentarzahl mit Symbol in `ink-4`, Avatar. „Prüfen“ erscheint bei Prüfaufträgen erst beim Überfahren.
- **Filter:** Suche + „Meine“ (einziger sichtbarer Schalter) + **ein** Menü „Filter“ (`FilterMenu.tsx`:
  Zuständigkeit, Typ, Label; Zahl gesetzter Filter am Knopf, „Filter zurücksetzen“).
- **Mangelzeile:** rechts nur der Schweregrad als Punkt + Wort (`SeverityText`; nur „Kritisch“ Zinnober, „Hoch“
  Ocker-Punkt). Meta: Code · Ort · Objekt · Zeit · „mit Aufgabe“. Fotos, Notiz und Maßnahme nur im Detail.
- **Handlungsbedarf:** ein Lage-Satz („4 schwere Mängel ohne Aufgabe, 4 überfällige Aufgaben und …“), Zeilen mit
  16-px-Symbol der Art, Datum grau; Zinnober nur für „Kritisch ohne Aufgabe“.
- **Detailpanel:** Kopf mit Meta als Textzeile (SLA-Fristen, Schweregrad, Status), Inhalt in Abschnitten mit
  Haarlinien, Eigenschaften rechts als Bezeichnung/Wert ohne Hintergrund, Labels neutral mit Farbpunkt,
  Behebung mit Linie links statt grünem Kasten, Aktivität als ruhige `Timeline`.
- **Mehrfachauswahl:** Kästchen im linken Rand der Fläche (Desktop beim Überfahren), Leiste mit „× N ausgewählt“.
- **Übersicht:** Kennzahlen ohne Kasten (`StatTile`), Balken in Tinte/Grau.

## Bausteine (`src/components/work/`)

| Datei | Inhalt |
|---|---|
| `Panel.tsx` | `WorkPanel` – Detail rechts (54 rem), Inhalt links + Eigenschaften-Spalte (19,5 rem); Handy: Vollbild-Sheet von unten, Eigenschaften oben im 2er-Raster. `PanelSection`, `Prop` (Label links, Wert rechts), `propSelectCls` (Auswahl, die wie Text aussieht). Escape schließt nur, wenn kein Dialog darüber liegt. |
| `rows.tsx` | `StatusToggle` (Erledigt-Kreis, 40-px-Ziel, halb gefüllt = In Arbeit), `RowCheck` (Desktop beim Überfahren, Handy nur im Auswahlmodus), `WorkGroup` (Abschnitt mit `h2`, Zähler, „Alle auswählen“), `WorkList`, `TextAction`, `useSwipe` (Touch: nach rechts wischen = Hauptaktion), `listKeys` (Tastatur). |
| `TaskRow.tsx` / `DefectRow.tsx` | Listenzeilen: Titel · Meta-Zeile (`MetaLine`). Rechts: Datum + Avatar bzw. Schweregrad. |
| `FilterMenu.tsx` | „Filter“-Knopf mit aufklappenden Einfachauswahl-Gruppen. |
| `fields.tsx` | `LabelText`, `LabelPicker`, `SeverityText`, `labelDot`, `AssetCodes`. |
| `TaskPanel.tsx` | Aufgabe: Titel und Beschreibung direkt bearbeitbar, Prüfauftrag „Prüfung starten“, verknüpfter Mangel, Link für Subunternehmer, **Aktivität** (Ereignisse + Kommentare mit @-Erwähnung). Eigenschaften speichern sofort. |
| `DefectPanel.tsx` | Mangel: Vorher/Nachher, Beschreibung, Maßnahme, Behebung (grüner Kasten), Aufgaben, Verlauf (`Timeline`). Fuß: Behoben · Aufgabe anlegen · Ausblenden · PDF. |
| `TaskCreate.tsx` | `TaskForm` – nur noch **Anlegen** (Modal/Bottom-Sheet). |
| `Activity.tsx` | Aktivität + Kommentarfeld (runde Eingabe mit Senden-Pfeil, Vorschlagsliste mit Avatar). |
| `BulkBar.tsx` | Schwebende Leiste für Mehrfachbearbeitung (unten mittig, Handy über der Navigation). |
| `Photos.tsx` | `PhotoPair` (Vorher/Nachher mit Platzhalter), `PhotoPicker` (große Foto-Kachel). |
| `model.ts` | Status/Priorität, `patchTask`, `dueText` („Heute“, „seit 3 Tagen“), `taskFromDefect`. |

`src/components/DefectResolve.tsx` (Behebung dokumentieren) zeigt jetzt den Mangel als Karte, die Notiz und
das Vorher-Foto neben der Nachher-Kachel; Fuß Abbrechen · **Als behoben markieren**.

## Muster

- **Gruppen statt Karten.** Aufgaben nach Fälligkeit (Überfällig · Fällig heute · Diese Woche ·
  Später · Ohne Datum, alle Titel grau), offene Mängel nach Schweregrad (Kritisch · Hoch · Mittel · Gering). Behoben/Ausgeblendet
  als eine Gruppe, neueste zuerst. Gruppen sind `section` mit `h2` (Screenreader, Tests).
- **Farbe nur für Status.** Zinnober nur für überfälliges Datum, „Kritisch“ und verletzte SLA-Frist im Panel.
  Priorität „Hoch“ als Wort, Labelfarbe nur als Punkt, Wecker grau.
- **Erledigen inline.** Kreis links (Aufgaben: erledigt/wieder öffnen; Mängel: öffnet „Mangel beheben“).
  Mängelbehebung mit offenem Mangel fragt nach („Mangel auch als behoben markieren?“).
- **Detail ohne Seitenwechsel.** `?id=` in der URL (Direktlinks aus Benachrichtigungen bleiben gültig),
  `?ansicht=` bzw. `?tab=` für die Reiter.
- **Auswahl.** Desktop: Kästchen erscheint beim Überfahren, `X` wählt die fokussierte Zeile, `Esc` hebt auf.
  Handy: „Auswählen“ neben der Suche schaltet den Auswahlmodus ein (Erledigt-Kreis tritt zurück), Tippen wählt.
  Die Leiste sammelt Status/Zuständig/Priorität/Fälligkeit und übernimmt sie gemeinsam; verknüpfte Mängel
  werden über `useConfirm` abgefragt (kein `window.confirm`).
- **Tastatur.** `↑/↓` oder `j/k` springen zwischen Zeilen, `Enter` öffnet, `X` wählt, `C` legt an, `/` sucht.
  Fokus = Tintenlinie links in der Zeile. Hinweiszeile unter der Liste ab `lg`.
- **Handy.** Zeilen ≥ 56 px, Kreis mit 40-px-Ziel, Wischen nach rechts (Tinte mit Haken),
  Detail als Vollbild-Sheet mit Fußknöpfen volle Breite, Beobachten nur als Symbol mit Namen für Screenreader.
- **Leer/Laden/Fehler.** `SkeletonList`, `ErrorBox onRetry`, `Empty` je Fall: „Alles erledigt“ (+ Neue Aufgabe),
  „Keine Aufgabe passt …“ (+ Textlink Filter zurücksetzen), „Keine offenen Mängel“, „Nichts ausgeblendet“, „Alles im Griff“.

## Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Attio (Web) | https://mobbin.com/screens/16b2e7b2-da40-4dc2-a63b-139c3078c1d9 | Aufgaben in **einer** Tabelle mit Gruppenzeilen (Heute/Diese Woche/Später) und Zähler, Fälligkeit als farbiger Text rechts, Person rechts außen |
| Superlist (Web) | https://mobbin.com/screens/f3c55a25-0602-4a5c-bd59-f69c38d76a1d | Ruhige Gruppenköpfe „Überfällig/Heute“, Kreis vor jedem Eintrag, Meta klein unter dem Titel |
| Todoist (Web) | https://mobbin.com/screens/46dab991-e521-44bc-984a-c936e31610a8 | Leerer Kreis als Erledigt-Schalter, roter Kreis/Datum nur bei Überfälligem |
| Todoist (Web) | https://mobbin.com/screens/fa560f76-4e58-45b9-9b30-60adb32f4e4d | Aufgabendetail: Kreis + Titel oben, Kommentare unten mit Eingabe, Eigenschaften rechts gestapelt mit Trennlinien |
| Linear (Web) | https://mobbin.com/screens/2e6c00de-40a7-455d-875f-0d8cb27c8270 | Aktivität als Zeitleiste mit kleinen Systemzeilen und Kommentarblöcken; Eigenschaften-Panel rechts |
| Jira (Web) | https://mobbin.com/screens/463a7839-be99-4cf5-b2ce-42a1316c0534 | Eigenschaften „Label links – Wert rechts“ als direkt änderbare Felder (`Prop` + `propSelectCls`) |
| Plane (Web) | https://mobbin.com/screens/13debcf7-d152-48ad-b347-a529fcdfa397 | Verlauf mit Symbol je Ereignis, „angelegt von … am …“ unten im Eigenschaften-Panel |
| Linear (Web) | https://mobbin.com/screens/3f36e39e-2b9e-4145-bee2-f43a3cf21f7b | Mehrfachauswahl: kleine schwebende Leiste unten mittig mit „N ausgewählt ×“ |
| ClickUp (Web) | https://mobbin.com/screens/92ec59bc-1a30-4b2d-ab96-5ab6ef6cc292 | Leiste mit Status/Zuständige/Datum direkt nebeneinander; ausgewählte Zeilen leicht getönt, Kästchen links |
| incident.io (Web) | https://mobbin.com/screens/e38829f9-e57f-4f23-8fa9-4808eefcca77 | Mangel-Kopf: Schweregrad- und Status-Badge unter dem Titel, Zeitstempel-Gruppe rechts |
| Sentry (Web) | https://mobbin.com/screens/d63c761d-ea8b-48c3-8235-65e53c6dea13 | Hauptaktion „Beheben“ als erster, dunkler Knopf; Sekundäres leiser daneben |
| Turo (iOS) | https://mobbin.com/screens/54258d9f-cc90-4f59-b111-d7c0cdada5d2 | Vorher/Nachher-Fotos mit klarer Beschriftung (`PhotoPair`) |
| Urban Company (iOS) | https://mobbin.com/screens/cf40f67b-986a-44d4-bfee-5a81998d4b06 | Abschluss-Sheet: Notizfeld, Foto-Kachel neben Vorschau mit Entfernen, Hauptknopf volle Breite unten |
| Airwallex (iOS) | https://mobbin.com/screens/64c52224-dd85-4916-a31d-97a03c55a5c1 | Detail auf dem Handy: Zeitleiste im Inhalt, Hauptaktion unten volle Breite |
| Shopify (iOS) | https://mobbin.com/screens/cdf5ce46-7ade-4ac6-83cd-4f02a1e27457 | „Auswählen“ schaltet Kästchen ein; Leiste mit Zähler direkt über der Tab-Leiste |
| GitHub (iOS) | https://mobbin.com/screens/5edb4b50-e0ce-4571-ac92-dc6af0f05cea | Auswahlmodus mit Kreisen links, Aktionen unten erst aktiv mit Auswahl |
| Quo (iOS) | https://mobbin.com/screens/7e60ef54-bf2f-4a54-ae6f-81111337e610 | Wischen auf einer Zeile legt eine farbige Aktion frei (bei uns: nach rechts = erledigen/beheben) |

Gesucht, aber verworfen: Motion/Wrike-Listen (zu viele Spalten und Farben), ClickUp-Detail (KI-Leiste,
zu viel Werkzeug), Life Reset/Alta-Sheets (dunkel, verspielt), Letterboxd-Wischlisten (Löschen statt Erledigen).

## Tests

`e2e/14-tasks-defects.cjs` prüft die Oberfläche: Gruppen und Schnellfilter, Suche, Tastatur (`↓`, `X`, `Esc`),
Priorität und Titel im Panel (sofort gespeichert), Beobachten, @-Erwähnung, Mehrfachbearbeitung, Erledigen mit
Behebung (Notiz + Foto), Mangel-Detail/PDF/Ausblenden, Lesezugriff, auf 390 px Auswahlmodus, **Wischen zum
Erledigen** und keinen horizontalen Überlauf.
