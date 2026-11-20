# Prüfkompass

Web-App für wiederkehrende Brandschutzprüfungen: Objekte → Gebäude → Elemente
(Türen mit Brand-/Rauchschutz, Feststellanlagen, Fenster, Drehtürantriebe, Brandschutzklappen, Feuerlöscher, Rauchwarnmelder und eigene Elementarten),
Prüfung vor Ort mit Unterschrift, Mängel- und Aufgabenverfolgung, Berichte, QR-Etiketten und API.

Live: https://pruefkompass.ksqsebastian.workers.dev ·
Funktionsanalyse des Vorbilds und Abgleich: [`docs/analyse/`](docs/analyse/README.md) ·
API: [`docs/api.md`](docs/api.md)

## Funktionen

**Einfach und smart**
- **Zwei Orte: Objekte und Kalender** (Plan v8, `docs/plan/v8.md`). Am Desktop ist die linke Leiste die **Objektliste**
  (Suchfeld, Erfassen, „Neues Objekt“, Scannen, je Objekt eine Zeile mit Name, Ort und **Ampel**), unten Kalender,
  Einstellungen, Konto; rechts das gewählte Objekt – ohne Wahl das zuletzt geöffnete (je Workspace im Browser gemerkt), sonst
  das dringendste. Am Handy ist die Objektliste die Startseite; untere Leiste **Objekte · Erfassen · Kalender**, Einstellungen
  und die Seiten ohne eigenen Ort (Alle Elemente, Mängel und Aufgaben, Code scannen, Offline-Modus) im Konto-Menü.
  **Ampel** (`shared/ampel.ts`, Zahlen aus `GET /properties` in einer Abfrage): nächste Fälligkeit bzw. „überfällig seit“,
  offene Mängel (kritische in Zinnober), Prüfungen, die auf die eigene Unterschrift warten – nur, was ungleich null ist;
  dringendstes zuerst, Filter **Alle · Fällig · Mit Mängeln · Unterschrift offen** (gilt für Leiste und Seite)
- **Kalender** (`/kalender`, `GET /calendar/events`, Bündelung in `shared/calendar.ts`): Monat (Desktop) bzw. Liste (Handy, am
  Desktop umschaltbar); fällige Prüfungen **je Objekt und Tag gebündelt** („Hotel X: 72 Türen fällig“), Brandschutzbegehungen
  und Prüfaufträge, Fristen von Aufgaben und Mängeln, ablaufende Zulassungen der Katalog-Typen und Befähigungsnachweise.
  Überfälliges steht oben in einem eigenen Block, unter dem Kalender „Jetzt“ und „Erledigt für dich“; ein Tipp öffnet das
  Objekt im passenden Reiter (`?tab=begehung|maengel`). Aufgaben ohne Objekt stehen nur hier. Das ICS-Abo bleibt
  („Abonnieren“ → Einstellungen → Benachrichtigungen)
- **Alte Adressen** leiten samt Query um (`src/moved.tsx`): `/` → `/objekte`; `/pruefen` → zuletzt geöffnetes Objekt, Reiter
  Begehung (`?ansage=weiter` geht mit), `/pruefen?tab=…` → `/pruefungen?tab=…`, `/pruefen/begehungen` → `/begehungen`;
  `/offen` → Objektliste mit Filter „Mit Mängeln“, `/offen?…` (Detail-Links) → `/maengel?…`; `/maengel?id=…` →
  `/maengel?art=maengel&mangel=…`, `/aufgaben?id=…` → `/maengel?art=aufgaben&aufgabe=…`; `/berichte` →
  `/einstellungen/berichte`; `/team`, `/subunternehmer`, `/import`, `/hilfe` → `/einstellungen/…`. Seiten ohne
  Navigationspunkt: `/elemente`, `/maengel` (Mängel und Aufgaben aller Objekte), `/pruefungen` (ausführliche Prüfungslisten),
  `/begehungen`, `/unterschreiben`, `/offline`
- Bausteine der früheren Orte bleiben als Komponenten: `src/pages/Dashboard.tsx` (`FirstProperty`, `NowSection`/`NowRow`,
  `DoneForYou`, `Situation`, `useRounds`), `src/pages/Pruefen.tsx` (`PruefenOverview`, `WalkListRow`, `roundStatus`),
  `src/pages/Offen.tsx` (Arbeitsliste, jetzt `/maengel`), `src/pages/Reports.tsx` (unter Einstellungen → Berichte)
- **Tür ansagen** (Plan v7; seit v8 im Objekt unter Begehung, `src/components/inspect/Announce.tsx`): Objekt gewählt bzw. gemerkt,
  ein Feld mit Mikrofon – „Tür 354, Typ SK32“. Die Tür wird im Objekt gefunden (Nummer) oder angelegt (feste Nummer,
  Standort „Raum 354“ bzw. „Zimmer 810“, Hersteller, Typ und Stammdaten aus dem Katalog-Typ) und die Prüfung öffnet mit
  offenem Feld für die Abweichung; „Alles andere in Ordnung“, dann **„Bereit · nächste Tür“** – unterschrieben wird
  gesammelt unter „Unterschreiben“. „Tür 355, gleicher Typ“ / „nochmal so eine“ übernimmt den letzten Typ, „…, Band lose“
  in der Ansage ist schon der Befund. Erkennung nach Regeln (`shared/announce.ts`: Zahlwörter bis 99 999, „Zimmer 810“,
  „T dreißig RS“, Hersteller-Kurzformen wie Novo → Novoferm, Aliasse der Katalog-Produkte; mehrdeutig → Auswahl;
  derselbe Schreibweisen-Abgleich erkennt beim Import den Türtyp, dort nur für die ganze Zelle).
  **Ein bekannter Typ beschreibt die Tür vollständig** (`describeByType` in `shared/vocab.ts`, genutzt von Ansage
  online/offline, MCP `inspect`/`setup`, Import und Elementformular beim Anlegen sowie der Checkliste je Typ):
  Anforderung aus `requirement` des Typs (sonst aus alten `rating`/`smoke`-Vorgaben oder dem Typnamen wie
  „Premio T30-RS“), Ja/Nein-Ausstattung, die der Typ nicht setzt, = nein, Flügel ohne Vorgabe = 1-flügelig, übrige
  Auswahlfelder bleiben offen – so gibt es bei bekannter Tür keine Rückfragen. Vorhandene Türen bleiben unverändert.
  Unbekannter Typ bricht nicht ab: Tür mit Typ „unbekannt“, allgemeine Checkliste (nur Punkte ohne Bedingung), der
  gesprochene Typ bleibt Rohnotiz. Falsche Art („Tür 400“, Nr. 400 ist ein Feuerlöscher) wird gemeldet. **Ohne Netz** mit
  den geladenen Gebäuden und dem gemerkten Katalog: neue Türen entstehen auf dem Gerät und gehen mit der Warteschlange an
  den Server (erst `POST /assets`, dann die Prüfung als Entwurf „bereit zur Unterschrift“). Gemessen (`e2e/33`): neue Tür
  mit Abweichung 2 Eingaben + 3 Tipps, Folgetür ohne Abweichung 1 Eingabe + 3 Tipps – online wie offline
- **Rohdiktat** (Migration 0027, `inspections.raw_notes`): was bei „Abweichung einsprechen“ (oder offline über das
  Tastatur-Diktat) gesagt wurde, bleibt zusätzlich roh an der Prüfung – mit der groben Einordnung des Regel-Parsers und
  sofortiger Warnung bei kritischen Wörtern. In der Prüfung („Diktat“) und unter „Unterschreiben“ steht „Diktat noch nicht
  ausgewertet“. Claude liest es über `list(what: "raw_notes")` (`briefing` nennt die Zahl), trägt Fehlendes mit `inspect`
  nach und markiert es mit `evaluated: true`; in der App lässt es sich auch von Hand als ausgewertet markieren
- **Checkliste je Typ** (`/druck/checkliste?produkt=…|element=…`, `shared/checklist.ts`, PDF `src/pdf/checklist.ts`): eine
  A4-Seite zum Mitführen – Kopf mit Typ, Anforderung, Zulassung; Prüfpunkte nach Bauteil-Gruppen, nur die für die
  Stammdaten zutreffenden (Unbekanntes „falls vorhanden“, Entfallendes benannt), Kästchen und Spalte für Türnummern.
  Erreichbar aus Einstellungen → Katalog → Produkt, aus dem Element (⋯ → Checkliste drucken) und unter „Tür ansagen“
- **Mängel und Aufgaben aller Objekte** (`/maengel`, bis v8 der Ort „Offen“): eine Arbeitsliste, Umschalter **Alle · Mängel ·
  Aufgaben**; „Alle“ zeigt zuerst Dringendes (schwere Mängel ohne Aufgabe, überfällige Aufgaben), dann übrige Mängel ohne
  Aufgabe, dann Aufgaben nach Fälligkeit – ein Mangel mit offener Aufgabe steht nur einmal da
- **Einstieg mit einem Namen und einem Satz** (Plan v5 Q): im leeren Konto zeigt die Objektliste nur „Wie heißt dein erstes Objekt?“;
  Anlegen erzeugt das Objekt samt Gebäude „Hauptgebäude“ (`POST /properties` mit `withBuilding`), öffnet es und darüber
  „Erfassen“ im Modus Elemente. „Neues Objekt“ fragt überall nur Name und Adresse, der Rest steht unter Bearbeiten. Gebäude erscheinen erst
  ab zwei Gebäuden (Objektseite, Formulare). Hauptknopf der Objektseite: „Rundgang starten“ bzw. „Elemente hinzufügen“;
  „Begehung starten“ und „Gebäude hinzufügen“ im ⋯-Menü
- **Erfassen per Sprache** (zentraler Mikrofon-Knopf): einsprechen oder tippen, Prüfkompass erkennt die Absicht und zerlegt
  den Text in Elemente („Im EG Flur drei Feuerschutztüren von Hörmann T30 und eine Feststellanlage“ → Anzahl, Art, Etage,
  Standort, Hersteller, Feuerwiderstand), Mängel (Schwere, Maßnahme), Aufgaben (Frist, auch „bis Freitag“) und Notizen;
  gemischte Sätze werden getrennt. Modus „Elemente“ ist Vorgabe, solange der Ort keine Elemente hat; reine Elemente legt ein
  Knopf „n Elemente anlegen“ unter der Vorschau direkt an. Fehlt der Ort, bietet das Sheet die Objekte an oder legt ein
  neues an. Element-Codes werden erkannt, die aktuelle Seite gibt den Ort vor. Arten über die Katalog-Definitionen
  (Bezeichnung, Mehrzahl, `synonyms`) und `CATEGORY_SYNONYMS` in `shared/smart.ts` (Werkstattsprache: Tür, Löscher, RWM, BSK, FSA …)
  - **Zerlegung**: jedes Artwort ist ein Anker, davor Ort und Anzahl, dahinter Nummer, Hersteller, Stammdaten; „und im
    ersten OG …“ beginnt einen neuen Ort, der für alle folgenden Elemente gilt. Artwörter mit Bedeutung (`TYPE_WORDS`:
    Rauchschutztür, RS-Tür, Stahltür, Alu-Rohrrahmentür, Doppeltür, Haftmagnet-Anlage, CO2-Löscher …) setzen Stammdaten;
    „mit Feststellanlage/OTS/Absenkdichtung/Spion“ sind Türfelder, „und eine Feststellanlage“ ein eigenes Element.
    Spracherkennung wird geglättet („T 30“, „t dreißig“, „O G“, „Erd Geschoss“, Zahlwörter bis hundert).
  - **Nummern**: „Tür 36“, „Türen 12 bis 15“, „Nummer 36 bis 40“ legen feste Nummern an (`POST /assets` mit `number`);
    im Modus Mängel hängt „Tür 36 schließt nicht“ am Element Nr. 36 des gewählten Objekts (`matchElementRef`). Artwort
    und Nummer müssen zusammenpassen: Ist Nr. 4 ein Feuerlöscher, zeigt „Tür 4“ „Nummer 4 ist ein Feuerlöscher (FL-004)“
    statt den Löscher zu treffen – ebenso in der Suche und im MCP (`elementRefConflict`).
  - **Unsicher**: Reste, die keinem Feld zuzuordnen sind, stehen in der Vorschau als Punkt + „bitte prüfen“, nie im Standort.
  - **Korpus**: `shared/corpus.test.ts` (über 160 gesprochene Sätze mit Erwartung, mit und ohne Katalog-Begriffe;
    Ungelöstes als `todo` mit Grund). Neue Regeln dort zuerst als Satz ergänzen.
- **Rundgang in Laufreihenfolge** (`shared/walk-order.ts`): Etagen von unten nach oben (TG/UG, EG, ZG, 1. OG … DG),
  innerhalb der Etage in der Reihenfolge der Anlage (`assets.sort_index`) – gleich in Rundgang-API, App, Offline-Rundgang
  und MCP (`tour`, `plan`).
- **Prüfpunkte mit Bedingung** (`appliesIf` in `shared/catalog.ts`, `shared/applies.ts`): „Feststellanlage löst aus“
  nur mit Feststellanlage, „Schließfolge“ nur zweiflügelig. „Alles in Ordnung“ setzt nicht Zutreffendes auf „entfällt“;
  fehlt das Stammdatum, bleibt der Punkt offen und die App fragt („Hat die Tür eine Feststellanlage?“) – die Antwort wird
  am Element gespeichert (offline nur für diese Prüfung).
- **Diktat in jedem Textfeld** und „Befund einsprechen“ im Prüfablauf (Mängel landen beim passenden Prüfpunkt – nur bei
  eindeutigem Treffer, `shared/inspect-match.ts`);
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
- **Jetzt** (im Kalender, `GET /now`): eine Warteschlange für alles, was eine Entscheidung oder Handlung der angemeldeten Person
  braucht – Unterschriften, abgelehnte Offline-Übertragungen, schwere Mängel ohne Aufgabe, eigene überfällige Aufgaben,
  Rundgänge, Begehungen, Autopilot-Vorschläge, angefangene Prüfungen, Intervall-Vorschläge; je Zeile eine Aktion, nach
  Dringlichkeit, höchstens 12 (Rest hinter „Alle … anzeigen“)
- **Feststellanlage** als eingebaute Elementart (`hold_open`, Präfix FSA, jährlich, monatliche Sichtkontrolle optional)
  mit 20 Prüfpunkten (Dokumentation/Zulassung, Abschluss und Schließmittel, Feststellvorrichtung, Auslösevorrichtung,
  Funktionsprüfung Simulation/Handauslösung/Energieausfall, Komponenten, Herstellerwartung), Stammdaten und Wartungsarbeiten.
  Türen haben zusätzlich Türtyp/Bauart, Absenkdichtung, Obentürschließer und Türspion
- **Laufende Nummern je Objekt**: neue Elemente heißen `<Präfix>-<Nr.>` (FST-001, FSA-002 …), fortlaufend je Objekt über
  alle Arten; vergeben über einen atomaren Zähler (`asset_counters`), auch bei gleichzeitigem Anlegen ohne Doppelte. Eine
  feste Nummer (Ident-Nr. aus dem Papierprotokoll) lässt sich beim Anlegen, Ändern und im Import (Spalte „Nummer“) setzen.
  Codes sind im Workspace eindeutig: ist „FST-001“ schon in einem anderen Objekt vergeben, heißt das Element „FST-001-2“.
  Vorhandene Codes bleiben. Suche, Element-API und MCP verstehen „Tür 36“, „Nummer 36“, „FSA 2“ und – im Objekt – „36“
  (`shared/vocab.ts`)
- **Katalog** (Einstellungen → Katalog): je Workspace Produkte (Hersteller/Typ mit Vorgabewerten und Zulassung), typische
  Mängel (Schwere, Maßnahme, Synonyme) und Begriffe (OTS → Obentürschließer). Neue Workspaces bekommen eine Grundausstattung
  (15 Begriffe, 25 Tür-/FSA-Mängel), bestehende beim ersten Lesen. Im Elementformular füllt ein Typ aus dem Katalog Hersteller,
  Typ und Stammdaten; Diktat und Prüfablauf schlagen Schwere und Maßnahme aus dem Katalog vor; Abkürzungen werden beim Auswerten
  ausgeschrieben. Lesen ab Prüfer, ändern Admins (bzw. Claude mit dem Schreib-Schlüssel einer Admin-Person, MCP `catalog`)
- **Tür, Fenster, Drehtürantrieb (Plan v7, Paket V)**: Die Elementart heißt „Tür“ (Schlüssel `fire_door`, neue Codes
  `T-001`, Bestand behält `FST-…`; „Tür 36“ und „Feuerschutztür 36“ gehen weiter). Feld **Anforderung** (keine · RS · T30 ·
  T30-RS · T90 · T90-RS, `shared/catalog-door.ts`) ersetzt Feuerwiderstand + Rauchschutz; Migration 0026 rechnet den Bestand
  um, alte Feldnamen nehmen API, MCP, Import und Diktat weiter an. Dazu Ja/Nein bzw. Auswahl für Schallschutz, Feucht-/Nassraum,
  Flügel, Zargenart, OTS, Freilauf, Feststellanlage, Absenkdichtung, Spion, Türstopper, Sockelblech, Kartenschloss, Antrieb.
  Prüfpunkte **nach Bauteil** (Kennzeichnung/Zulassung, Zarge, Türblatt, Bänder, Schließmittel/OTS, Drücker und Schloss,
  Dichtungen, Zusatzausstattung, Feststellanlage, Funktion) mit `appliesIf`: Brandschutz-Punkte nur bei T30/T90,
  Rauchschutz nur mit RS, Schließfolge nur zweiflügelig, FSA nur mit Feststellanlage, Spion/Absenkdichtung/Kartenschloss nur
  wenn vorhanden. Neue Arten **Fenster** (`window`, `F`) und **Drehtürantrieb** (`door_drive`, `DA`) mit kurzer Checkliste
- **Leistungen und Angebotsliste (Plan v7)**: Katalog-Produkte mit **Aliassen** (so, wie der Typ in Listen heißt),
  Anforderung und „Zulassung gültig bis“; vierte Liste **Leistungen** (Kürzel, Einheit, Preis netto, Art, Bedingung auf
  Stammdaten); Katalog-Mängel verweisen auf Leistungen (mit Menge). `GET /api/properties/:id/offer` rechnet aus den offenen
  Mängeln die Positionen (Preis nach Bedingung, z. B. Dichtung mit/ohne Brandschutz; Mengen summiert, Türen je Zeile, nicht
  Zugeordnetes unter `unmapped`; `shared/catalog-offer.ts`). **Katalog-Datei** `docs/wissen/katalog-seehafer.json` (24 Türtypen
  und 7 FSA/Antriebe mit Aliassen, 16 Mängel-Bausteine + 2 FSA-Mängel, 111 Leistungen aus den Vorlagen, Unsicheres markiert)
  lädt „Aus Datei laden“ auf der Katalogseite mit Vorschau (neu/geändert/unverändert) – nur auf Wunsch, keine Grundausstattung.
  **Import der Wartungsübersicht** (Ident-Nr., Türtyp über Aliasse, Hersteller, JA-Spalten, Zulassung, Intervall,
  letzte/nächste Prüfung, Etage, Raum; Laufreihenfolge der Datei)
- **Foto beim Anlegen** (optional, z. B. vom Typenschild): wird am Element gespeichert; Claude liest es über `get_photo`
  und trägt Stammdaten mit `update_asset` nach
- **Sammelanlage per Diktat** unter „Erfassen“ (siehe oben): „fünf Feuerlöscher im Erdgeschoss Flur“ → Anzahl, Art, Etage,
  Standort, Hersteller; mit „Anpassen“ einzeln prüfen (Zahlwörter eins–zwanzig, Ziffern, „3x“; höchstens 50 je Zeile)
- **MCP-Server** im Worker (`/api/mcp`) mit **OAuth-Anmeldung** (Freigabe mit API-Schlüssel oder neuer Verbindung): 17 Werkzeuge
  nach Absicht (`briefing`, `tour`, `inspect` – auch „Tür ansagen“ per Nummer und Typ und Auswerten des Rohdiktats –, `capture`, `get_photo`, `team` …) und sieben fertige Befehle – Claude ist die Oberfläche
  für Sprache: Rundgang führen, Befund eintragen, Typenschilder lesen, Plan einrichten – siehe `docs/api.md`
  - **Kreislauf (Plan v6, Paket U)**: Datumsangaben streng und relativ in der Zeitzone des Workspaces (`shared/dates.ts`,
    auch im Regel-Parser); Zuständige per Name, E-Mail, „ich“ oder Partner (`team`); Duplikat-Abgleich mit ausgeschriebenen
    Abkürzungen, Katalog-Synonymen und Befunden in Entwürfen (`shared/duplicates.ts`); „erledigt“ über MCP läuft wie in der
    App durch den Nachprüfen-Schritt; wieder geöffnete Mängel zählen als „ohne Aufgabe“ (eine Regel für Jetzt, Autopilot,
    Bericht); kritische/hohe Befunde in bereitgelegten Prüfungen stehen ganz oben unter „Jetzt“ und im `briefing` und melden
    sich beim Bereitlegen sofort; Mangel-Status **„ungültig“** (Duplikat/Fehleintrag, mit Grund, Mangel-Detail und
    `update_defect`, Migration 0025); Katalog-Grundausstattung um Feuerlöscher, Rauchwarnmelder und Brandschutzklappen ergänzt
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
- **Prüfen in zwei Tipps** (v5): oben „Alles in Ordnung“ und „Abweichung einsprechen“, die Prüfpunkte darunter nach
  Gruppen eingeklappt („6 von 6 i. O.“), selten Gebrauchtes unter „Weitere Angaben“. „Alles in Ordnung“ setzt alle
  offenen Punkte ohne Rückfrage, fünf Sekunden „Rückgängig“, weiter zur Unterschrift – mit gemerkter Unterschrift reicht
  dann „Abschließen“; mit Mangel: einsprechen, „Alles andere in Ordnung“, „Abschließen“ (`docs/design.md` 5.1c)
- **Unterschrift merken** (freiwillig, nur auf dem Gerät): wird bei „Alles in Ordnung“ eingesetzt, sonst „Mit gemerkter
  Unterschrift abschließen“ mit einem Tipp; vergessen unter Einstellungen → Konto
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
- Ausführliche Prüfungsliste (`/pruefungen`) mit Reitern Überfällig, Bald fällig, Nie geprüft, Nicht prüfbar, Neue Elemente, Entwürfe,
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
- **Sammelmappe** (Plan v7 X): ein PDF aus allen abgeschlossenen Protokollen eines Objekts für einen Rundgang-Tag oder
  Zeitraum (optional je Elementart) – Deckblatt (Objekt, Zeitraum, geprüft/ohne Mangel/mit Mangel/nicht prüfbar, Prüfer/innen
  mit Befähigungsnachweis und Status), Inhaltsliste (Nummer, Raum, Typ, Ergebnis, Seite), erst die Protokolle ohne Mangel,
  dann nach gleichem Mangel gruppiert (gleiche Mängel unabhängig von Reihenfolge/Schreibweise, Zwischenblatt je Gruppe mit
  den betroffenen Elementen), am Ende „nicht prüfbar“; in Laufreihenfolge, durchgehend nummeriert. Die Protokollseiten sind
  dieselben wie beim Einzel-Download. Erzeugt Protokoll für Protokoll mit Fortschritt (Abbrechen möglich), landet im
  Archiv. Erreichbar unter Objekt → ⋯ → Sammelmappe, Einstellungen → Berichte → Sammelmappe und nach „Alle unterschreiben“ (aus genau
  diesen Prüfungen). Logik: `shared/mappe.ts`, PDF: `src/pdf/nacharbeit.ts`
- **Dateinamen der Protokolle**: Standard `<Ident>_<Datum>_<Art>.pdf` (z. B. `FST-036_2026-11-16_Tür.pdf`), auch im ZIP –
  Tür- und FSA-Protokoll derselben Öffnung überschreiben sich nicht; die frühere Vorgabe `{datum}_{code}_{art}` wird
  umgestellt (Migration 0028), selbst gewählte Muster bleiben
- **Angebotsliste** (Objekt → Angebot): aus den offenen Mängeln Leistung, Menge, Elementnummern, Einzel- und Gesamtpreis
  (`GET /properties/:id/offer`, Paket V); deutlicher Hinweis auf Mängel ohne zugeordnete Leistung; Vorschlag einer
  Sammelposition, wenn dieselbe Leistung viele Elemente eines Objekts oder einer Etage betrifft (`shared/offer.ts`);
  Regie-/Anfahrtspositionen aus dem Katalog (oder frei) zum Hinzufügen – nur auf diesem Gerät gemerkt; Export als Excel und PDF.
  Kein Versand, keine Rechnung. MCP `report(what: "offer", property)` liefert dieselbe Liste in Kurzform
- **Prüfprotokoll**: Stammdaten-Block mit allen gesetzten Stammdaten aus der Katalog-Definition der Elementart (generisch,
  leere werden weggelassen), **Befähigungsnachweis** der prüfenden Person passend zur Elementart (Hinweis, wenn er fehlt oder am
  Prüfdatum abgelaufen war) und leere Zeile „Abnahme durch den Auftraggeber“ (Name, Datum, Unterschrift)
- **Berichtsarchiv**: jeder erzeugte Bericht wird gespeichert und bleibt abrufbar
- Elementliste als **Excel** (wieder importierbar) oder CSV; vollständiges JSON-Backup
- **Sprache der Dokumente** (Deutsch/Englisch) und **Zeitzone** je Workspace; die Oberfläche ist deutsch

**Team und Konto**
- Rollen (Inhaber, Admin, Prüfer, Lesezugriff), Einladungen, Inhaberschaft übertragen, Aktivitätsprotokoll
- **Befähigungsnachweise** je Mitglied (Migration 0028): Art (Sachkunde, Hersteller-Zertifikat, sonstiges), Bezeichnung,
  Aussteller, Nummer, gültig bis, gilt für Elementarten. Eigene unter Einstellungen → Konto, für alle als Admin unter Team
  (Mitglied öffnen). Auswahl je Protokoll in `shared/credentials.ts` (Feststellanlage/Antrieb: Hersteller-Zertifikat, sonst
  Sachkunde; gültige vor abgelaufenen). Fehlt ein gültiger Nachweis, zeigt „Unterschreiben“ einen Hinweis (kein Blocker;
  Komponente `CredentialHint` in `src/components/Credentials.tsx`, auch für den Prüfablauf gedacht). Die Angabe
  „Qualifikation“ bei Brandschutzbeauftragten bleibt unverändert davon getrennt
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
migrations/   D1-Schema (0001 … 0028)
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
- **Browser-Tests** (`e2e/`, Playwright): Reihen von der Registrierung über Sicherheitskorrekturen und Massenoperationen bis zu Berichtigung, Nachprüfung sowie Aufgaben und Mängeln (`14-tasks-defects`), dem Autopiloten (`20-autopilot`) und den offenen Punkten aus der Analyse (`21-offene-punkte`: Offline-Fehlliste, Intervalle, Partner-Zugang), dem MCP-Server (`11-ai-mcp`) und „Sprache zuerst“ (`23-sprache`: Rundgang über Claude, Unterschrift mit einem Tipp; `24-unterschreiben-offline`: Seite „Unterschreiben“, Befund einsprechen, Erfassen und Rundgang ohne Netz) sowie der Navigation mit zwei Orten (`35-zwei-orte`, Plan v8: Objektliste mit Ampel, Filter und Sortierung, Weiterleitungen aller alten Adressen, Kalender mit Monat, Liste, Bündelung, Überfällig und Sprung ins Objekt, leerer Workspace, API-Aufrufe beim Start, 390 px; Arbeitsliste und „Jetzt“ am neuen Ort in `25-fuenf-orte`) und dem Fachwissen (`26-katalog`: Feststellanlage, laufende Nummern, Typ- und Mangel-Vorschläge, Katalogseite, MCP `catalog`) sowie dem Einstieg (`27-einstieg`: leeres Konto → Objektname → ein Satz → Elemente angelegt in 4 Tipps und 2 Eingaben, Erfassen ohne Ort, ein/zwei Gebäude, Hauptknopf der Objektseite, 390 px) sowie dem Prüfen in zwei Tipps (`28-zwei-tipps`: Tipps zählen, Rückgängig, Mangel eingesprochen, Gruppen, Meldungen über keiner Leiste, „Jetzt“ im neuen Konto, leere Seiten Prüfen/Offen) und dem Durchgang bis zur ersten unterschriebenen Prüfung (`29-erste-pruefung`: Objektname → ein Satz mit drei Orten/Arten/Herstellern → Rundgang → Unterschrift zeichnen und merken; 8 Tipps + 1 Satz + Unterschrift, feste Nummern, Mangel per Nummer, „bitte prüfen“) und „Tür ansagen“ (`33-ansagen`: Ansage → Tür angelegt mit Stammdaten → Abweichung → bereit, gleicher Typ, Befund in der Ansage, unbekannter Typ, falsche Art, dasselbe ohne Netz mit Warteschlange, Rohdiktat in App und MCP, Checkliste zweier Typen samt PDF, Archivieren über MCP; Tipps und Eingaben je Tür in `e2e/.out/33-ansagen/tipps.json`) und Katalog/Angebot aus Plan v7 (`32-katalog-angebot`: Katalog-Datei mit Vorschau laden, Tür mit Typ aus Alias, Prüfpunkte je Anforderung, Fenster und Drehtürantrieb, Angebotsliste, Import der Wartungsübersicht, Katalogseite 1360/390 px) und den Befunden aus dem MCP-Praxistest (`30-mcp-element`: je Punkt aus Plan v6, Paket T, der Aufruf aus dem Bericht – „Tür 4“ trifft nie FL-004, Laufreihenfolge, „Alles i. O.“ mit Bedingungen, Prüfpunkt-Zuordnung, Widersprüche, Stammdaten-Prüfung, setup mit Stammdaten und Zugang; die App-Seite von A3/A4 bei 390 px in `28-zwei-tipps`) sowie der Nacharbeit (`34-nacharbeit`: Nachweise und Rechte, Hinweis bei abgelaufenem Nachweis, Sammelmappe nach dem Unterschreiben samt Prüfung des PDFs – Deckblatt, Inhaltsliste mit Seiten, Reihenfolge, Zwischenblätter –, Protokoll mit Abnahme-Zeile und Nachweis, ZIP-Dateinamen, Angebotsliste mit Excel/PDF und Regie, MCP `report(what: "offer")`, 390 px).
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
- API-Schlüssel: nur SHA-256-Hash gespeichert, Rechte auf Prüfer begrenzt (einzige Ausnahme: Schreib-Schlüssel einer
  Admin-/Inhaber-Person dürfen neue Objekte und Gebäude anlegen, `docs/security.md` #33), Ablauf und Widerruf
- Alle Abfragen sind auf den Workspace (`tenant_id`) beschränkt; Dateien nur mit Workspace-Präfix
- Zugangsdaten und Tokens gehören nie ins Repo, in Commits oder Logs
