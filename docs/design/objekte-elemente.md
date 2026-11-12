# Objekte & Elemente – Umsetzung Designsystem v2

Bereich: `src/pages/Properties.tsx`, `Property.tsx`, `Assets.tsx`, `Asset.tsx`, `FloorPlan.tsx`,
`src/components/AssetList.tsx`, `AssetDrawer.tsx`, `ShareProperty.tsx`, `forms.tsx` und neue Bausteine in
`src/components/objects/`. Vertrag: `docs/design.md`. Bilder: `docs/design/objekte-elemente/`
(`d-*` = 1360 px, `m-*` = 390 px). Browser-Test: `e2e/19-objekte-elemente.cjs`.

## Was sich geändert hat

| Seite | Vorher | Jetzt |
|---|---|---|
| Objekte | Handgebaute Tabelle, Suche ohne Filter, Spinner | `DataTable` (stapelt auf dem Handy), Suche + Chips „Mit Überfälligen“/„Mit Mängeln“ mit Zählern, Prüfstatus als dünner Verteilungsbalken, ein Status-Badge je Objekt, Skelett, `ErrorBox` mit „Erneut versuchen“, Leerzustand je nach Filter |
| Objekt | Segmented-Reiter, sechs Knöpfe im Kopf, Karten je Gebäude mit Symbolknöpfen, `window.confirm` | Breadcrumbs, Status-Badges unter dem Titel, **eine** Hauptaktion „Begehung starten“, Rest in `Menu` (⋯); `Tabs` in der URL; Gebäude als Abschnitte mit `SectionHeader` (Zähler, ⋯-Menü, „Element“); Suche ab 10 Elementen; rechts „Prüfstatus“ (Balken mit Legende, „Am dringendsten“), Begehung, Brandschutzbeauftragte/r, „Vor Ort“. Auf dem Handy steht der Prüfstatus direkt unter dem Titel, Bericht/Freigabe nur als Symbol, damit die Aktionen in eine Zeile passen |
| Elemente | Viele Art-Chips, Objekt-Chip mit „×“ | Nach Dringlichkeit gruppierte Liste (`ListGroup` Überfällig · Bald fällig · Nie geprüft · Aktuell · Nicht prüfbar), Art und Objekt als kompakte Auswahl im Chip-Stil (`FilterSelect`), Status-Chips; alle Filter und die Suche in der URL (`kategorie`, `status`, `objekt`, `q`, `neu`, `etikett`); Kopfzeile „N Elemente · Filter zurücksetzen“; ⋯ mit Import und Etikettendruck |
| Element | Drei Kennzahl-Kacheln, Karten untereinander, Etikett/QR/Plan verstreut | Breadcrumbs Objekt › Gebäude, Status-Badge + Erklärung („seit 5 Monaten · Innere Prüfung“) unter dem Titel; links Prüfarten, Offene Mängel, **Verlauf** als `Timeline` (Prüfungen, behobene und frei erfasste Mängel), Fotos & Dokumente; rechts Eigenschaften (`PropertyList`), Stammdaten, „Als Nächstes in …“, QR + Etikett in einer Karte, Grundriss |
| Grundriss | Eigener Kopf, Legende als Karte, Pfeil-Link | `PageHeader` mit Breadcrumbs, Ebenen als Link-Chips, Hinweis „Tippe auf die Position von …“ als schwebende Pille, Zoom unten rechts, Legende als Zeile unter dem Plan, „Nicht platziert“ als `ListRow`-Liste mit Auswahlzustand |
| Formulare | Eine Rasterfläche, orange Typenschild-Box | Abschnitte „Ort · Gerät · Stammdaten · Kennung und Erinnerung“, optionale Felder markiert, Art-Auswahl als Liste mit Norm und Intervall, Typenschild-Foto ruhig auf `sunken` (Orange bleibt Erfassen vorbehalten), Fuß „Abbrechen“ (secondary) + „Speichern“ (primary) |
| Freigabe | Checkbox, `window.confirm` | `Switch`, Bestätigungsdialog, Liste aktiver Links als Karte |
| Drawer | `KeyValue` | Status + Erklärung, `PropertyList`, leere Stammdaten ausgeblendet |

Alle `window.confirm` im Bereich sind durch `useConfirm()` ersetzt.

## Kleine, nützliche Extras

- **„Speichern & neu“** beim Anlegen: gleiche Art, gleiches Gebäude, gleiche Etage; nur Standort und
  Kennungen werden geleert, der Fokus springt in „Standort“. Die Beschreibung zeigt „Schon angelegt: …“.
- **Gedächtnis für den Ort** (`objects/memory.ts`, nur `localStorage`): zuletzt benutztes Objekt/Gebäude
  und die zuletzt benutzte Etage je Gebäude werden beim nächsten Element vorbelegt (mit Hinweis
  „Zuletzt in … benutzt“). Gelöschte oder nicht mehr sichtbare Objekte/Gebäude werden verworfen.
- **Status in Worten** (`dueInfo`): „Überfällig seit 5 Monaten“, „Fällig in 12 Tagen“, „Morgen fällig“,
  „Noch nie geprüft“ – in Zeilen, Kopf, Drawer und bei den Prüfarten.
- **„Als Nächstes in <Gebäude>“** auf der Elementseite: bis zu drei überfällige/ungeprüfte/bald fällige
  Elemente im selben Gebäude als Sprungziel – Prüfen am Stück ohne Umweg über die Liste.
- **„Am dringendsten“** im Prüfstatus des Objekts springt direkt zum Element mit dem frühesten Termin.
- **Suche im Objekt** ab mehr als zehn Elementen, über alle Gebäude.
- „Alle Elemente ›“ im Prüfstatus öffnet die Elementliste mit `objekt=` vorgefiltert.

## Neue Bausteine (`src/components/objects/`)

| Datei | Inhalt |
|---|---|
| `status.tsx` | `dueInfo`, `AssetStatusBadge`, `AssetRow` (Standardzeile für Elemente), `StatusBar` (Verteilungsbalken mit optionaler Legende), `countDue` |
| `FilterSelect.tsx` | Auswahl im Chip-Stil für die `FilterBar` (aktiv = Tinte wie `Chip`) |
| `memory.ts` | Gedächtnis für Objekt/Gebäude/Etage beim Anlegen |

`ui.tsx`, `index.css` und `Shell.tsx` sind unverändert.

## Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Deel | https://mobbin.com/screens/27f3bda0-f620-443a-b3c6-61a87141e9c5 | Inventarliste mit Gesamtzahl und einem Verteilungsbalken des Zustands über der Tabelle → `StatusBar` in Objektliste und Objekt-Panel |
| Snowflake | https://mobbin.com/screens/257e62fc-b0dd-4ea9-ae24-9a909a7656dd | Kompakte Filter-Auswahlen („Type All ⌄“) direkt neben der Suche, Anzahl daneben → `FilterSelect` für Art/Objekt, „N Elemente“ |
| Jobber | https://mobbin.com/screens/a96589e2-e854-4524-b3b9-58d4000f2562 | Objekt-Detailseite: Bearbeiten/Weitere Aktionen im Kopf, Ort/Kontakt als ruhige Karte, Bereiche als Abschnitte → Objektkopf mit ⋯, Karte „Vor Ort“ |
| Telescope | https://mobbin.com/screens/2d6a5aa4-b712-469e-bd2b-df2f51266fe1 | Rechtes Panel mit kleinen grauen Labels und Werten, Verknüpfungen darunter → `SideCard` + `PropertyList` |
| Plane | https://mobbin.com/screens/daa3c99b-2a4c-401e-b804-ab045e23ec37 | Arbeitselement: Aktivität links, gruppierte Eigenschaften rechts → Elementseite (Verlauf links, Eigenschaften/Stammdaten rechts) |
| Twenty | https://mobbin.com/screens/e1115c57-801a-4b80-a8b5-05c2969b77c8 | Felder in Gruppen („General“, „System“) und eine Zeitleiste der Änderungen → getrennte Karten „Eigenschaften“/„Stammdaten“, `Timeline` |
| Jira | https://mobbin.com/screens/4ecaec7d-b384-4747-b30e-8735992c5ecf | „Details“-Karte rechts, Verlauf mit Person und Zeit je Eintrag → Verlauf: Prüfart als Titel, „Person · Prüfart“ als Meta, Zeit rechts |
| incident.io | https://mobbin.com/screens/fe969887-afe1-41ae-991e-cda75c5a50d7 | Zeitleiste mit Zeitstempel und Statuswechseln, Eigenschaften mit Status-Badges → Ergebnis-Badges in der Zeitleiste |
| sweetgreen | https://mobbin.com/screens/8bfbcf17-787a-45e0-8180-cdb20b781a7a | Karte mit Zoom-Knöpfen unten rechts und schwebender Pille oben mittig → Grundriss: Zoom unten rechts, Platzieren-Hinweis als Pille |
| Clay | https://mobbin.com/screens/f8d4a46c-b9f7-4fb4-9d76-3fb5ece06aa7 | Karte links, schlanke Liste rechts, aktiver Eintrag markiert → „Nicht platziert“ neben dem Plan mit Auswahlzustand |
| Airwallex (iOS) | https://mobbin.com/screens/e03fc7f6-658d-44d6-9ee0-08b458f8a8ae | Auswahl im Bottom-Sheet als Liste: Titel + eine Zeile Erklärung → Art-Auswahl mit Norm und Intervall |
| Strava (iOS) | https://mobbin.com/screens/c416adea-cd34-431e-bc0e-5cc5cd718c9f | Ausrüstung anlegen: Typ mit Symbol wählen, dann kurze Felder → zweistufiges Anlegen (Art → Formular) |
| Jira Cloud (iOS) | https://mobbin.com/screens/46411b61-e667-4000-8358-ff6db87dd9b9 | Handy-Liste: Suche, darunter waagrecht scrollende Filter, „5 results“ → Elemente auf 390 px |
| Cash App (iOS) | https://mobbin.com/screens/b9fa2b60-74c0-485e-ac42-fa605ecbda24 | „66 Results · Reset Filters“ über der Ergebnisliste → „N Elemente · Filter zurücksetzen“ |
| Shopify (iOS) | https://mobbin.com/screens/b933ed27-9092-4c6e-9499-82f8b2a2bef0 | Statusbadge rechts in der Zeile, Untertitel einzeilig → `AssetRow` auf dem Handy |
| Xero | https://mobbin.com/flows/d88c3f72-a20f-4bc8-a132-42b3f9975b1f | „Save & duplicate“ neben „Save“ im Anlegen-Dialog → „Speichern & neu“ |

Gesucht, aber verworfen: Vanta/Employment-Hero-Inventare (zu tabellenlastig, viele Spalten), Zillow/Airbnb
(Karte als Hauptinhalt, Werbeflächen), PamPam/DoorDash-Karten (verspielt), Square „Create item“ (Vollbild-Editor
zu schwer für 6–10 Felder).
