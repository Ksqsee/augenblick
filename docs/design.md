# Prüfkompass – Designsystem v3

Verbindlicher Vertrag für alle Seiten. Herleitung und Befund: `docs/plan/v3.md` (Abschnitte 1–2).
Tokens: `src/index.css` · Bausteine: `src/components/ui.tsx` · Rahmen: `src/components/Shell.tsx`.
Vorzeigeseiten: **Heute** (`src/pages/Dashboard.tsx`) und **Anmeldung** (`src/pages/Auth.tsx`).
Bilder (1360 und 390 px): `docs/design/v3/`. Ältere Bilder in `docs/design/**` zeigen v2.

> Kurz: ein Raum aus Sichtbeton mit einer Lichtfuge. Grauer Grund, **eine** weiße Fläche pro Seite,
> Tinte als Akzent, **eine** Signalfarbe (Zinnober) nur für überfällig/kritisch. Status ist ein
> Punkt und ein Wort. Ordnung wie im Shopify-Admin, Listen und Typografie wie bei Apple.

v3 ändert das **Aussehen**, nicht die Bausteine: alle Namen und Props aus v2 gelten weiter. Seiten,
die noch nicht umgebaut sind, erben Tokens und Bausteine und sehen dadurch schon ruhiger aus;
Phase 2 (`docs/plan/v3.md` Abschnitt 4) baut sie nach den Vorlagen in Abschnitt 5 um.

---

## 1. Grundsätze

1. **Ma – Leere ist Material.** Großzügige Außenabstände, enge Innenabstände. Lieber weniger
   Elemente pro Zeile als kleinere.
2. **Eine Fläche pro Seite.** Grund `canvas` (Beton), darauf **eine** `Surface` für den Hauptinhalt.
   Abschnitte darin trennt eine Haarlinie (`Section`), keine weitere Karte. Seitenspalten liegen
   als Text mit Haarlinien auf dem Grund – nicht in Karten.
3. **Schwarz ist die Akzentfarbe.** Hauptaktion = Tinte (`primary`). Zinnober (`shu`) gibt es
   **nur** für „überfällig/kritisch“ und die laufende Aufnahme. Kein Orange. „Erfassen“ ist schwarz.
4. **Status steht als Wort, nicht als Pille.** In Listen: 6-px-Punkt + Wort in `ink-2`; nur
   Zinnober färbt auch das Wort („seit 5 Monaten überfällig“). Pillen nur im Seitenkopf und in
   Tabellenspalten „Status“, dann neutral grau mit Punkt; getönt nur `shu`.
5. **Keine Symbolkacheln.** Elementart = 16-px-Liniensymbol in `ink-3`, ohne Hintergrund.
   Wo ein Symbol nichts unterscheidet (Vorschläge, Rundgänge, Einstellungen): gar keins.
6. **Typografie trägt.** Große ruhige Titel (28/34, halbfett, −0.02em), Abschnittstitel klein
   (13 px, `ink-3`), Zahlen `tabular-nums`. Keine Versalien-Labels, kein Fettdruck im Fließtext
   (Ausnahme: der Code eines Elements).
7. **Kanten statt Rundungen.** Radius 6 (Felder, Knöpfe), 10 (Fläche), 12 (Dialog). Flächen ohne
   Schatten; nur Schwebendes (Dialog, Menü, Toast) wirft **einen** weichen Schatten.
8. **Asymmetrie mit Raster.** Linksbündig auf 8-px-Raster, Zahlen rechtsbündig, Seitenspalte
   280 px. Zentriert werden nur Leerzustände und Dialogtitel auf dem Handy.
9. **Bewegung wie eine Schiebetür.** 160 ms, nur Deckkraft und 4 px; Sheets gleiten von unten.
   `prefers-reduced-motion` schaltet alles ab.
10. **Sprache knapp.** Keine Ausrufezeichen, kein „Guten Tag“. Datum und Lage in einem Satz.

---

## 2. Tokens (`src/index.css`, Tailwind 4 `@theme`)

Alle Namen sind Tailwind-Klassen (`bg-canvas`, `text-ink-3`, `border-line`, `text-meta` …).
Altnamen (`brand*`, `bad*`, `muted-soft`, `sev-*`) bleiben gültig und zeigen auf die neuen Werte.

### 2.1 Flächen und Text

| Token | Wert | Verwendung |
|---|---|---|
| `canvas` | `#f2f2f0` | Beton: Seitengrund, Seitenleiste, Seitenspalten |
| `surface` | `#ffffff` | die eine Fläche, Felder, Dialoge, Menüs |
| `sunken` | `#ebebe8` | Segmented-Grund, neutrale Pille, Platzhalter |
| `hover` | `#f6f6f4` | Zeilen-Hover auf `surface` |
| `selected` | `#e9e9e6` | aktive Navigation, gewählte Zeile, aktiver Chip |
| `line` / `line-strong` | `#e4e4e1` / `#cfcfcb` | Haarlinien / Feldrahmen im Hover |
| `ink` | `#111110` | Sumi-Tinte: Text, Hauptknopf, Fokus |
| `ink-2` | `#4a4a47` | Sekundärtext, Statuswörter |
| `ink-3` | `#6e6e6a` | Meta, Abschnittstitel, Symbole |
| `ink-4` | `#b4b4af` | Platzhalter, Chevrons, Nullwerte |
| `brand` / `brand-strong` / `brand-soft` | `#111110` / `#000000` / `#ebebe8` | Altname = Tinte |

**Abweichung vom Plan:** `ink-3` ist `#6e6e6a` statt `#858581`. Mit `#858581` hätte 13-px-Text
nur 3,3 : 1 Kontrast auf Beton; `#6e6e6a` erreicht AA (5,1 : 1 auf Weiß, 4,6 : 1 auf Beton).

### 2.2 Signal und Status

| Ton | Text/Punkt | Fläche | Kontur | Bedeutung | Darf als Fläche? |
|---|---|---|---|---|---|
| `shu` (= `bad`) | `#c8321c` | `#fbeeeb` | `#efc8c0` | überfällig, kritisch, Fehler, Aufnahme | ja – die einzige |
| `warn` | `#8a6a1f` | `#f4f1e8` | `#e2dcc6` | bald fällig, mit Mängeln (Ocker) | nur `Notice` |
| `info` | `#4a5a78` | `#eef0f4` | `#d5d9e2` | nie geprüft, Hinweis (Schiefer) | nur `Notice` |
| `ok` | `#3f6b4f` | `#edf2ee` | `#cfdcd3` | aktuell, ohne Mängel (Kiefer) | nur `Notice` |
| `muted` | `ink-3` | `sunken` | `line` | neutral, nicht prüfbar | – |

Zuordnung immer über `src/format.ts` (`DUE_META`, `RESULT_META`) und `SEVERITY_TONE` – nie neu
erfinden. Alle Status-Töne erreichen AA als Textfarbe auf Weiß und Beton.

### 2.3 Typografie

Schrift: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Geist Variable', system-ui` – auf
Apple-Geräten SF, sonst das selbst gehostete Geist. Keine externen Schriften (CSP).

| Klasse | Größe / Zeile | Gewicht | Verwendung |
|---|---|---|---|
| `text-display` | 34 / 40 | 600 | selten; großer Einzelwert |
| `text-h1` | 28 / 34 | 600, −0.02em | Seitentitel, Lage-Satz auf „Heute“ (Handy 24/30) |
| `text-h2` | 20 / 26 | 500–600 | Satz neben der Anmeldung |
| `text-h3` | 17 / 24 | 600 | Dialog-/Drawer-Titel |
| `text-title` | 15 / 22 | 600 | Kartentitel (alt), große Knöpfe |
| `text-body` | 14 / 20 | 400 | Standard, Listentitel (**400**, nicht fett) |
| `text-meta` | 13 / 18 | 400/500 | Abschnittstitel (500, `ink-3`), Untertitel, Statuswort |
| `text-caption` | 12 / 16 | 400/500 | Pillen, Tabellenköpfe, Hinweise unter Feldern |

Felder auf dem Handy 15 px (kein iOS-Zoom), ab `sm` 14 px.

### 2.4 Raster, Radien, Schatten

- **Raster 8 px** (4 px für Feinheiten). Innenabstand einer `Section`: 16 px Handy / 24 px ab `sm`
  (als Variable `--row-px`, die auch `ListRow` nutzt – Zeilen stehen bündig unter dem Titel).
- **Radien:** `rounded-sm` 4 · `rounded-md` 6 (Knöpfe, Felder, Chips, Pillen) · `rounded-lg` 8
  (Menüs, Toasts) · `rounded-xl` 10 (Surface, Card) · `rounded-2xl` 12 (Dialog, Sheet).
- **Schatten:** `shadow-card` = Haarlinie (`0 0 0 1px line`), kein Schlagschatten.
  `shadow-lift` = kräftigere Haarlinie. `shadow-pop` = `0 12px 32px -8px rgb(0 0 0/.18), 0 0 0 1px rgb(0 0 0/.06)`
  nur für Dialog, Menü, Toast, Drawer.
- **Fokus:** 2 px Tinte mit 2 px Abstand (`:focus-visible`); Felder: Rahmen + 1-px-Ring in Tinte.

### 2.5 Bewegung

| Klasse | Dauer | Wofür |
|---|---|---|
| `animate-in` | 160 ms | Seitenwechsel (macht `Shell`), neue Inhalte – Deckkraft + 4 px |
| `animate-pop` | 160 ms | nachträglich erscheinende Zeilen |
| `animate-fade` | 160 ms | Abdunklung hinter Dialogen |
| `animate-up` | 240 ms | Bottom-Sheet (Handy) |
| `animate-slide` / `animate-slide-left` | 200/220 ms | Drawer rechts / Menü links (Handy) |
| `animate-menu` | 140 ms | Aufklappmenüs, nur Deckkraft + 4 px |
| `animate-rec` | Schleife | Zinnober-Puls, nur bei laufender Aufnahme |

Knöpfe: kein Skalieren beim Klick, nur Deckkraft `.85`.

---

## 3. Rahmen (`Shell.tsx`)

### Desktop (≥ 1024 px)
- **Seitenleiste** 232 px auf `canvas`, **ohne** Trennlinie zum Inhalt. Von oben: Logo + Glocke ·
  Suche (Strg K) · **Erfassen** (schwarz, Mikrofon) + Scannen (`ghost`) · Navigation · „Mehr“
  (einklappbar) · Workspace/Konto · Rechtslinks.
- Navigation: Text 14 px, Symbol 16 px `ink-3`; aktiv = `selected` + Tinte, **kein** farbiger Balken.
  Zähler (z. B. Offline-Warteschlange) als graue Zahl.
- **Inhalt** `max-w-6xl`, `px-10 pt-8`. Die weiße Fläche beginnt mit eigenem Rand (`Surface`).

### Handy (390 px ist Referenz)
- Kopfzeile 56 px auf `canvas` (leicht durchscheinend), Logo · Glocke · Suche.
- **Untere Leiste** `aria-label="Hauptnavigation"`: Heute · Prüfen · **Erfassen** · Mängel · Mehr.
  Erfassen = schwarzer Kreis 52 px mit Mikrofon, kein Ring, ragt nicht heraus; solange das
  Erfassen-Sheet offen ist, wird er Zinnober. Aktiver Reiter nur durch Tinte statt `ink-3`.
- `Surface` läuft auf dem Handy randlos über die volle Breite (oben/unten Haarlinie).
- Kein horizontaler Überlauf: breite Inhalte scrollen in sich, Tabellen werden Zeilen (`DataTable`).

Logo: schwarzes Quadrat (Radius 6/32), dünner weißer Kreis, weiße Nadel (`LogoMark`).

---

## 4. Bausteine (`src/components/ui.tsx`)

Import immer aus `../components/ui`. Keine Rohfarben im JSX (`bg-red-500`, Hex) – fehlt etwas,
Baustein erweitern.

### 4.1 Neu in v3

| Baustein | Props | Regel |
|---|---|---|
| `Surface` | `as?: div\|section\|article\|main`, `bleed?` (Standard an), `className` | Die **eine** weiße Fläche einer Seite. Radius 10, Haarlinie, kein Schatten; Handy randlos. Setzt `--row-px` für Sections und Zeilen. `bleed={false}` außerhalb der Shell, wenn der Rand nicht `px-4` ist. |
| `Section` | `title?, count?, action?, flush?, id?, aria-label?` | Abschnitt in der Surface: Titel 13 px `ink-3` (h2), Haarlinie darüber (nicht beim ersten). `flush` lässt Listen bis an die Ränder laufen, Zeilen bleiben bündig mit dem Titel. |
| `StatusText` | `tone, strong?, children` | Punkt + Wort für Listen und Fließtext. Wort `ink-2`, bei `bad` Zinnober. |
| `ButtonLink` | `to, variant?, size?, icon?` | Link im Aussehen eines Knopfs (Navigation statt Aktion, z. B. „Rundgang starten“). |
| `buttonClass(variant, size, className)` | – | Knopf-Klassen für Sonderfälle (z. B. `<label>` als Knopf). |
| `LogoMark` (`Logo.tsx`) | `className` | Nur die Bildmarke. |
| `DueBadge` / `ResultBadge` / `SeverityBadge` `variant` | `'text'` (Standard) \| `'pill'` | `text` = Punkt (bzw. Balken) + Wort. `pill` nur im Seitenkopf und in Tabellenspalten „Status“. |
| `List plain` | – | Zeilen ohne Kasten (in `Section flush` oder Seitenspalte). |
| `StatTile divider` | Standard an | Kennzahl ohne Kasten; `divider` = senkrechte Haarlinie links. |

### 4.2 Was sich am Aussehen geändert hat

| Baustein | v3 |
|---|---|
| `Button` | `primary` = Tinte; `brand` = Alias von `primary`; `secondary` = weiß mit Haarlinie; `ghost` ohne Rahmen; `danger` Zinnober. Radius 6, Höhe 44 Handy / 36 Desktop (`md`). Kein Schatten, kein Skalieren. |
| `Badge` | Standard neutral grau mit Punkt in Tonfarbe; nur `tone="bad"` getönt; `solid` = Tinte bzw. Zinnober, nur für „Kritisch“. |
| `StatusDot` | 6 px. |
| `Card` | Haarlinie + Radius 10, kein Schatten. Für neue Seiten `Surface > Section`. |
| `SectionHeader` | Titel 13 px `ink-3`, Zähler als schlichte Zahl. |
| `ListRow` | Titel 14 px normal, Zeile 52 px Handy / 44 px Desktop, Haarlinie eingerückt bis zum Textanfang. `leading` höchstens 16-px-Symbol, Punkt oder Abhak-Kreis. |
| `RowIcon` | Keine Kachel mehr: 16-px-Symbol in `ink-3` (bei `bad` Zinnober). |
| `ListGroup` | Titel 13 px `ink-3`, kein grauer Balken, Zähler als Zahl. |
| `StatTile` | Zahl 28 px, darunter Bezeichnung 13 px mit Punkt; Nullwerte `ink-4`. |
| `Tabs` | Unterstrich 1,5 px Tinte; Zähler graue Zahl (bei `tone="bad"` und > 0 Zinnober). |
| `Segmented` | Radius 6, aktiv weiß mit Haarlinie, Zähler als Zahl. |
| `Chip` | Radius 6; aktiv = Tinte auf `selected`. |
| `PageHeader` | `meta` ist eine Textzeile (13 px `ink-3`), keine Pillen-Reihe. Genau ein `primary`, Rest `ghost` oder ⋯. |
| `Modal`/`Sheet` | Radius 12; Titel links (Desktop), zentriert mit Griff (Handy). |
| `Empty` | Kein Symbolkreis (`icon` wird ignoriert); ein Satz in Tinte, Erklärung `ink-2`, eine Aktion – am besten Textlink. |
| `Timeline` | Kreis weiß mit Haarlinie, Symbol `ink-3`; Textblock mit Linie links statt grauem Kasten. |
| `Avatar` | Gedämpfte Töne aus den Status-Flächen. |
| `ErrorBox` | Zinnober-Fläche (erlaubt: Fehler ist „kritisch“). |
| `Toast` | Tinte, Radius 8, Häkchen statt farbigem Kreis. |

### 4.3 Unverändert (nur Tokens)
`IconButton`, `Kbd`, `Field`, `Input`, `Select`, `Textarea`, `DictateInput`, `SearchField`,
`Switch`, `CardHeader`, `SectionLink`, `Breadcrumbs`, `BackLink`, `useUrlTab`, `FilterBar`/`Toolbar`,
`DataTable`, `PropertyList`, `KeyValue`, `Skeleton*`, `Spinner`, `Notice`, `SettingsSection`,
`Drawer`, `ConfirmDialog`/`useConfirm`, `Menu`, `useToast`, `toneDot`, `toneText`, `toneSoft`.

### 4.4 Do / Don't

| ✔ So | ✘ Nicht so |
|---|---|
| `<DueBadge state />` (Punkt + Wort) in der Zeile | Status-Pille + Mangel-Pille + rote Zeitangabe in einer Zeile |
| Eine Aussage pro Zeile, ein Signal | Vier Farben für dieselbe Lage (Balken, Punkt, Zahl, Pille) |
| `Surface > Section` mit Haarlinien | Karte in Karte, Liste in Karte in Karte |
| 16-px-Symbol ohne Hintergrund – oder keins | Symbol in getönter Kachel in jeder Zeile |
| Ein schwarzer Hauptknopf pro Seitenkopf | Schwarzer und farbiger Hauptknopf nebeneinander |
| Zinnober nur für überfällig/kritisch/Aufnahme | Rot für „Löschen“-Hover, Werbung, Hervorhebung |
| Abschnittstitel 13 px grau | Versalien-Labels, fette 15-px-Abschnittstitel |
| Seitenspalte als Text mit Haarlinien auf Beton | Seitenspalte aus gestapelten Karten |
| Lage als Satz („14 Prüfungen sind überfällig“) | „Guten Tag, Sabine“ und eine Kachel-Reihe |
| Nullwerte in `ink-4` | große rote Nullen |
| Leerzustand: ein Satz + Textlink | Symbolkreis, Illustration, leere weiße Karte |
| Bewegung 160 ms, Deckkraft + 4 px | Skalieren, Federn, Schatten-Hover |

Weiter verboten: Verläufe als Schmuck, Glas-Effekte auf Inhalt, Emoji, Lila, Illustrationen,
farbige Hintergründe ganzer Bereiche, Schatten auf Schatten, Orange.

---

## 5. Seitenvorlagen – immer `Surface > Section`

### 5.1 Heute (umgesetzt in `Dashboard.tsx`)
```
Grid lg:[1fr_280px]
  Surface
    Kopf     Datum (h1-Größe, Tinte)                        [Rundgang starten]  (Scannen ghost)
             Lage als Satz (h1, ink-3; Zahlen Tinte, „überfällig/kritisch“ Zinnober)
    Section  „Prüfstatus“ · rechts „74 Elemente in 4 Objekten“
             StatTile ×5 ohne Kasten, senkrechte Haarlinien (Handy 3 Spalten)
    Section  „Jetzt“ n (flush)       ○ Titel / Erklärung              [Aufgaben anlegen] | Öffnen
    Section  „Rundgänge“ (flush)     Gebäude · Objekt / n Elemente · ● seit 5 Monaten überfällig  ›
    Section  „Erledigt für dich“     09:12  3 Aufgaben … angelegt           Rückgängig
             (lädt /api/automation/log?limit=5; bei 404/leer unsichtbar; „Alle“ → Einstellungen › Automatik)
  aside (auf dem Grund)
    Objekte          Name ………… ● 7 überfällig       (Haarlinien, keine Karte)
    Offene Aufgaben  Titel ………… Datum (Zinnober wenn überfällig)
    Zuletzt geprüft: Code vor 35 Tagen
```
Leere Lage: „Alles geprüft. Nächste Fälligkeit am 03.12.“ – sonst nichts Zusätzliches.

### 5.2 Liste (Objekte, Elemente, Prüfungen, Mängel, Aufgaben, Begehungen)
```
PageHeader  title · subtitle · actions=[primary „Neues …“, Menu ⋯]
Tabs        (Bereiche, Zähler als Zahl, useUrlTab)
FilterBar   Suche + Chips (auf dem Grund)
Surface
  Section flush title="74 Elemente"
    ListGroup „Überfällig 13“
    ListRow  leading=16-px-Symbol der Art · title=Code + Art · subtitle=Ort
             meta=„seit 5 Monaten“ · trailing=<DueBadge state/> · chevron
```
Eine Zeile trägt **ein** Statussignal. Mängelzahl als Text in der Unterzeile („1 Mangel“), nicht
als zweite Pille. Laden: `SkeletonList`. Leer: `Empty` mit Textlink.

### 5.3 Detail (Objekt, Element, Mangel, Aufgabe, Prüfung)
```
PageHeader  breadcrumbs · title · meta=„● Überfällig seit 5 Monaten · Innere Prüfung“ · actions=[primary, Menu]
Grid lg:[1fr_280px]
  Surface   Section „Prüfarten“ · Section „Offene Mängel“ · Section „Verlauf“ (Timeline) · Section „Dateien“
  aside     PropertyList auf dem Grund, Gruppen durch Haarlinie getrennt (keine Karten)
Handy: aside unter den Kopf, vor die Surface.
```

### 5.4 Formular / Dialog
- Kurze Formulare im `Modal` (Handy: Sheet mit Griff, Titel zentriert, Fußknöpfe volle Breite).
- Fuß: `secondary` „Abbrechen“ · `primary` „Speichern“ (mit `loading`). Kein `window.confirm`.
- Abschnitte im Formular mit `text-meta font-medium text-ink-3`, nicht fett.

### 5.5 Einstellungen
```
PageHeader „Einstellungen“ · Tabs (…, Automatik)
Surface
  Section title + ein Satz · Felder/Switches · Speichern rechts unten
  Section „Gefahrenbereich“ zuletzt: Text + Button danger + ConfirmDialog
```
Regel-Listen (Automatik): Name · ein Satz · `Segmented` (Aus/Vorschlagen/Automatisch) · „zuletzt
ausgeführt“ rechts in `ink-3` – Front/Jira-Muster, siehe Referenzen.

### 5.6 Anmeldung / Registrierung / Einladung / Passwort (umgesetzt in `Auth.tsx`)
Beton-Grund, Logo oben links. Eine `Surface` (max. 400 px) mit Titel, Felder, schwarzem Knopf
volle Breite – **links im Raster**, nicht zentriert. Ab `lg` rechts unten ein einziger Satz mit
Haarlinie links. Darunter Wechsel-Link (Registrieren/Anmelden), ganz unten Rechtslinks.
Handy: Surface randlos.

---

## 6. Texte und Ton

- **Du-Form**, knapp, ohne Ausrufezeichen, ohne Begrüßung.
- **Lage als Satz:** „14 Prüfungen sind überfällig, 4 Mängel kritisch.“ – Zahl zuerst.
- Titel ≤ 4 Wörter, Untertitel ein Satz, Toasts ≤ 6 Wörter, Knöpfe 1–3 Wörter als Verb.
- Abschnittstitel als Hauptwort oder Zeitwort: „Jetzt“, „Rundgänge“, „Erledigt für dich“.
- Fachwörter der Branche (Feuerschutztür, Prüfart, Mangel, Maßnahme), keine IT-Wörter.
- Datum `TT.MM.JJJJ` (`fmtDate`), relativ „seit 5 Monaten“, Uhrzeit „09:12“.
- Leerzustände: was fehlt + was zu tun ist. Fehler: was passiert ist + was tun.
- Gedankenstrich „–“, typografische Anführungszeichen „…“.
- Feste PDF-/Excel-Texte zusätzlich Englisch über `shared/i18n.ts` (siehe `CLAUDE.md`).

---

## 7. Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Shopify Admin, Bestellliste | https://mobbin.com/screens/86369e83-8e35-4317-90ca-3dfd056dd317 | grauer Grund, eine weiße Fläche, dichte Tabelle, neutrale Status-Marken, schwarzer Hauptknopf |
| Shopify Admin, Mehrfachauswahl | https://mobbin.com/screens/a02d3d73-8a92-43d5-a848-6871b908b484 | Auswahl in der Tabelle, Aktionsleiste |
| Shopify Admin, Startseite | https://mobbin.com/screens/f18701c2-d09a-43a9-a3ba-f060475c638e | Seitenleiste auf Grau ohne Trennlinie, Inhaltsfläche mit eigenem Rand (`Shell`, `Surface`) |
| Apple Erinnerungen | https://mobbin.com/screens/0c4eacca-8ccc-4350-be95-3b758d61f977 | großer Titel, Abschnitte als graue Überschrift + Haarlinie, Abhak-Kreis, keine Karten (`Section`, „Jetzt“) |
| Apple Erinnerungen „Geplant“ | https://mobbin.com/screens/4fcb0751-165a-429f-a395-defd9b2d9de3 | Datum als ruhige Abschnittszeile |
| Midday | https://mobbin.com/screens/d508e201-5a04-464b-8891-98ddb426ed50 | ein Satz zur Lage statt Kacheln, Haarlinien-Raster (Kopf von „Heute“) |
| Time2book | https://mobbin.com/screens/262f1f7f-fff4-427b-a89f-728a90de0df3 | Kennzahlen ohne Karten, durch senkrechte Linien getrennt (`StatTile`) |
| Front, Regeln | https://mobbin.com/screens/5a449f27-f873-4a21-96bd-2c07e5536153 | Regel-Liste mit Schalter und „zuletzt ausgeführt“ (Automatik) |
| Jira Automation | https://mobbin.com/screens/69777439-0b6d-4087-87af-8aad12c4b44a | Reiter Regeln / Protokoll („Erledigt für dich“) |
| The New York Times, Anmeldung | https://mobbin.com/screens/cfe99e66-06b8-43b6-b8cb-33d339fbd0ac | schmale Formularspalte, schwarzer Knopf volle Breite, nichts sonst |
| Shopify, Anmeldung | https://mobbin.com/screens/4697d474-32a0-48dc-b2e1-32e382619f5a | eine weiße Fläche mit dem Formular auf ruhigem Grund, Logo darüber |

Angesehen und verworfen: Shopify-Startseite mit Illustrationskarten (zu werblich), Klaviyo- und
Base44-Anmeldung mit Bild- und Werbehälfte (widerspricht „Leere ist Material“), Canny (blauer
Akzent, zu klein).

---

## 8. Prüfliste vor dem Merge einer Seite

- [ ] Grund `canvas`, **eine** `Surface`, Abschnitte als `Section` (keine Karte in der Surface).
- [ ] Seitenspalten auf dem Grund mit Haarlinien, ohne Karten.
- [ ] Höchstens ein `primary` im Seitenkopf; kein Orange; Zinnober nur für überfällig/kritisch.
- [ ] Status in Listen als `DueBadge`/`ResultBadge`/`SeverityBadge` (`variant="text"`) oder `StatusText`; Pillen nur im Kopf/Status-Spalte.
- [ ] Keine Symbolkacheln (`CategoryIcon`-Kachel, getönte `RowIcon`); höchstens 16-px-Symbol.
- [ ] Laden = Skelett, leer = `Empty` (Satz + Textlink), Fehler = `ErrorBox onRetry`.
- [ ] 390 px: kein horizontaler Überlauf, Ziele ≥ 40 px.
- [ ] Keine Rohfarben/Hex im JSX, keine eigenen Radien/Schatten.
- [ ] Texte: Du-Form, knapp, Knöpfe als Verb, keine Ausrufezeichen.
- [ ] `npm run check` und die passende e2e-Reihe grün; Bilder 1360/390 px neu.
