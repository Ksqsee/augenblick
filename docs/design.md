# Prüfkompass – Designsystem v2

Verbindlicher Vertrag für alle Seiten. Tokens stehen in `src/index.css`, Bausteine in
`src/components/ui.tsx`, der Rahmen in `src/components/Shell.tsx`. Vorzeigeseiten: **Heute**
(`src/pages/Dashboard.tsx`) und **Anmeldung** (`src/pages/Auth.tsx`). Bilder: `docs/design/`.

> Kurz: warmes Papier, tiefe Tinte, **ein** Signalorange. Farbe bedeutet Status – sonst nichts.
> Dichte am Schreibtisch, große Ziele auf dem Handy. Jede Seite hat einen leeren, ladenden und
> fehlerhaften Zustand.

---

## 1. Grundsätze

1. **Werkzeug, kein Prospekt.** Prüfkompass wird im Treppenhaus mit Handschuhen und im Büro mit
   Maus benutzt. Inhalte vor Dekoration: keine Verläufe als Schmuck, kein Glas-/Blur-Effekt, keine
   Emoji, kein Lila, keine Illustrationen mit Figuren.
2. **Farbe hat eine Bedeutung.** Rot = überfällig/kritisch, Bernstein = bald fällig/Mangel,
   Blau = nie geprüft/Hinweis, Grün = aktuell/in Ordnung. Orange (`brand`) markiert nur die
   Hauptaktion **Erfassen**, die aktive Navigation und den Fokus. Alles andere ist Tinte auf Papier.
3. **Eine Hauptaktion pro Bereich.** Pro Seitenkopf höchstens ein `primary`-Knopf, weitere
   Aktionen `secondary`/`ghost` oder im `Menu` (⋯).
4. **Hierarchie über Typografie, nicht über Kästen.** Titel `text-h1`, Abschnitte `text-title`
   halbfett, Inhalt `text-body`, Nebeninfo `text-meta` in `ink-3`. Karten nur, wo Inhalte
   zusammengehören – keine Karte in der Karte.
5. **Dicht, aber ruhig.** Listenzeilen 48 px (Desktop) / 56 px (Handy), 4-px-Raster, gleiche
   Abstände zwischen gleichen Dingen.
6. **Daumenfreundlich.** Auf dem Handy ist jedes Ziel ≥ 40 px hoch (Knöpfe `md` = 44 px), die
   wichtigste Aktion liegt unten (Mikrofon in der Leiste, Sheet-Knöpfe volle Breite).
7. **Ehrliche Zustände.** Laden = Skelett in der Form des Inhalts, leer = ein Satz + eine Aktion,
   Fehler = Klartext + „Erneut versuchen“.
8. **Bewegung erklärt, sie unterhält nicht.** ≤ 240 ms, nur Deckkraft und wenige Pixel Versatz;
   `prefers-reduced-motion` schaltet alles ab.

---

## 2. Tokens (`src/index.css`, Tailwind 4 `@theme`)

Alle Namen sind Tailwind-Klassen (`bg-canvas`, `text-ink-3`, `border-line`, `text-meta` …).
Bestehende Namen aus v1 bleiben gültig.

### 2.1 Farben – Flächen und Text

| Token | Wert | Verwendung |
|---|---|---|
| `canvas` | `#f7f6f3` | Seitenhintergrund, Seitenleiste |
| `surface` | `#ffffff` | Karten, Listen, Felder, Dialoge |
| `sunken` | `#f0eee9` | Segmented-Hintergrund, Symbolfelder, Platzhalter |
| `hover` | `#f4f2ee` | Hover von Zeilen/Knöpfen auf `surface` |
| `selected` | `#ebe8e1` | aktiver Navigationspunkt |
| `line` / `line-strong` | `#e7e4dd` / `#d6d1c7` | Trennlinien, Feldrahmen / Hover-Rahmen |
| `ink` | `#1a1714` | Text, `primary`-Knopf |
| `ink-2` | `#57514a` | Sekundärtext, Labels |
| `ink-3` | `#8c857b` | Meta, Platzhalter-Icons |
| `ink-4` | `#b7b1a7` | Platzhaltertext, Chevrons, Nullwerte |
| `brand` / `brand-strong` / `brand-soft` | `#e8590c` / `#c2410c` / `#fff1e8` | nur Erfassen, aktive Markierung, Fokus |

### 2.2 Status (Prüfstatus, Ergebnis, Hinweise)

Jeder Ton hat Text/Punkt, weiche Fläche und Kontur: `ok|warn|bad|info` + `-soft` + `-line`.

| Ton | Text | Fläche | Kontur | Bedeutung |
|---|---|---|---|---|
| `bad` | `#cf2a1f` | `#fcebe9` | `#f3c4bf` | Überfällig, kritisch, Fehler |
| `warn` | `#b25407` | `#fcf1e1` | `#f0d2a6` | Bald fällig, mit Mängeln |
| `info` | `#2b58c9` | `#ebf0fc` | `#c6d4f4` | Nie geprüft, Hinweis |
| `ok` | `#17793d` | `#e8f4ec` | `#bfe0cb` | Aktuell, ohne Mängel, erledigt |
| `muted` | `ink-2` | `muted-soft` | `line` | Nicht prüfbar, neutral |
| `brand` | `brand-strong` | `brand-soft` | – | „Offene Mängel“-Zähler, Hervorhebung |

**Zuordnung (immer über `format.ts`, nie neu erfinden):**

- Prüfstatus `DUE_META`: `overdue → bad`, `soon → warn`, `never → info`, `ok → ok` → `<DueBadge state>`
- Ergebnis `RESULT_META`: `ok → ok`, `defects → warn`, `critical → bad (gefüllt)`, `not_inspectable → muted` → `<ResultBadge result>`
- Schweregrad `SEVERITY_TONE`: `low → muted`, `medium → warn`, `high → bad`, `critical → bad gefüllt`
  → `<SeverityBadge severity>` (mit Balken-Symbol, damit es auch ohne Farbe lesbar ist).
  Eigene Farbwerte `sev-low|medium|high|critical` für Diagramme.

### 2.3 Typografie

Schrift: **Geist Variable** (selbst gehostet über `@fontsource-variable/geist`; keine externen
Schriften). Zahlen in Tabellen/Zählern immer `tabular-nums`.

| Klasse | Größe / Zeile | Gewicht | Verwendung |
|---|---|---|---|
| `text-display` | 32 / 38 | 600, `tracking-[-0.02em]` | nur Begrüßung auf „Heute“ (ab sm) |
| `text-h1` | 26 / 32 | 600, `tracking-[-0.02em]` | Seitentitel (`PageHeader`) |
| `text-h2` | 20 / 28 | 600 | selten: große Abschnitte in Detailseiten |
| `text-h3` | 17 / 24 | 600 | Dialog-/Drawer-Titel |
| `text-title` | 15 / 22 | 600 | Abschnittstitel (`SectionHeader`), Kartentitel |
| `text-body` | 14 / 20 | 400/500 | Standardtext, Listentitel (500) |
| `text-meta` | 13 / 18 | 400/500 | Untertitel, Labels, Chips, Knopf `sm` |
| `text-caption` | 12 / 16 | 400/500 | Badges, Tabellenköpfe, Hinweise unter Feldern |

Felder nutzen auf dem Handy 15 px (verhindert iOS-Zoom), ab `sm` 14 px.

### 2.4 Abstand, Radien, Schatten

- **Raster 4 px.** Innenabstand Karte `p-4` (Handy) / `sm:p-5`; Listenzeile `px-4 py-2.5`;
  Abstand zwischen Abschnitten `gap-8` (Handy) / `lg:gap-10`; zwischen Abschnittskopf und Inhalt
  `mb-2.5` (macht `SectionHeader`); zwischen Feldern `gap-4`.
- **Radien:** `rounded-md` 8 (Badges, Menüeinträge) · `rounded-lg` 10 (Knöpfe, Felder, Chips,
  Symbolfelder) · `rounded-xl` 12 (Karten, Listen, Menüs) · `rounded-2xl` 16 (Dialoge, Sheets).
  Nichts darüber außer runden Elementen (`rounded-full`: Avatar, Mikrofon, Status-Punkt).
- **Schatten:** `shadow-card` = Haarlinie, für alles, was auf der Seite liegt. `shadow-lift` nur
  Hover von klickbaren Karten. `shadow-pop` nur Schwebendes (Dialog, Menü, Toast, Drawer).
  Keine Rahmen **und** Schatten zugleich auf Karten.

### 2.5 Bewegung

| Klasse | Dauer | Wofür |
|---|---|---|
| `animate-in` | 160 ms | Seitenwechsel (macht `Shell`), neue Inhalte |
| `animate-pop` | 180 ms | Listeneinträge, die nachträglich erscheinen |
| `animate-fade` | 160 ms | Abdunklung hinter Dialogen |
| `animate-up` | 240 ms | Bottom-Sheet (Handy) |
| `animate-slide` / `animate-slide-left` | 200/220 ms | Drawer rechts / Menü links (Handy) |
| `animate-menu` | 140 ms | Aufklappmenüs |
| `animate-rec` | Schleife | nur laufende Aufnahme |
| `skeleton` | Schleife | Lade-Platzhalter |

Kurve `--ease-out-soft` (`cubic-bezier(.2,.8,.2,1)`). Hover-Übergänge 150 ms, `active:scale-[0.98]` auf Knöpfen.

---

## 3. Layout

### Desktop (≥ 1024 px, `lg`)
- **Seitenleiste** fest links, `w-60` (240 px), `bg-canvas`, rechts `border-line`. Von oben:
  Logo + Glocke · Suche (Strg K) · **Erfassen** (orange) + Code scannen · Hauptnavigation ·
  „Mehr“ (einklappbar) · unten Workspace/Konto-Menü und Rechtstexte.
- **Inhalt** `max-w-6xl` (1152 px), zentriert, `px-10 pt-9 pb-16`.
- Detailseiten: zweispaltig `lg:grid-cols-[minmax(0,1fr)_20rem]` – Inhalt links, Eigenschaften rechts.

### Tablet (`sm`–`lg`)
- Kein Seitenmenü; Kopfzeile und untere Leiste wie Handy, Inhalt `px-6`.

### Handy (390 px ist Referenz)
- **Kopfzeile** `h-14`, `bg-canvas`, Logo · Glocke · Suche.
- **Untere Leiste** (`aria-label="Hauptnavigation"`) mit fünf Plätzen: Heute · Prüfen ·
  **Erfassen** (runder Mikrofon-Knopf 56 px, ragt 16 px heraus) · Mängel · Mehr (öffnet die
  Seitenleiste als Panel von links). Aktiver Reiter: Tinte + Strich oben.
- Inhalt `px-4 pt-5 pb-28` (Platz für die Leiste). **Kein horizontaler Überlauf**: breite Inhalte
  (Chips, Tabs) scrollen in sich (`no-scrollbar -mx-4 px-4 overflow-x-auto`), Tabellen werden
  zu Zeilen (`DataTable`).

---

## 4. Bausteine (`src/components/ui.tsx`)

Import immer aus `../components/ui`. Keine eigenen Varianten mit Rohfarben (`bg-red-500` o. Ä.)
bauen – fehlt etwas, Baustein erweitern.

### Aktionen
| Baustein | Wichtige Props | Regeln |
|---|---|---|
| `Button` | `variant: primary \| secondary \| outline \| ghost \| danger \| brand`, `size: xs \| sm \| md \| lg`, `icon`, `loading` | `primary` (Tinte) = Hauptaktion, max. 1 pro Bereich. `brand` nur für Erfassen/Aufnahme. `md` ist 44 px (Handy) / 36 px (Desktop). Text als Verb: „Speichern“, „Prüfung starten“. |
| `IconButton` | `label` (Pflicht), `icon`, `variant: ghost \| secondary \| primary`, `size: sm \| md` | Für Symbol-only. `label` wird `aria-label` + Tooltip. |
| `Menu` | `items: MenuItem[]` (`label, icon, onClick \| to, danger, disabled` oder `'separator'`), `align`, `trigger?` | Sekundäre Aktionen (⋯). Zerstörerisches zuletzt, `danger`, davor `'separator'`. |
| `Kbd` | children | Tastenkürzel-Hinweis. |

### Formulare
| Baustein | Props | Regeln |
|---|---|---|
| `Field` | `label, hint?, error?, optional?, children(id)` | Label immer sichtbar (Tests nutzen `getByLabel`). Fehler ersetzt Hinweis. |
| `Input`, `Select` | wie HTML | 44/40 px hoch. |
| `Textarea` | `dictate?` (Standard an) | Diktat-Knopf (`FieldMic`) unten rechts – nicht entfernen. |
| `DictateInput` | wie `Input` | Einzeilig mit Diktat. |
| `SearchField` | `value, onChange, placeholder?, label?` | Mit Lupe und Leeren-Knopf. |
| `Switch` | `checked, onChange, label?, description?` | Sofort wirksame Einstellungen; kein Speichern-Knopf nötig. |

Formularregeln: eine Spalte auf dem Handy, `sm:grid-cols-2` für kurze Paare (PLZ/Ort). Pflichtfelder
nicht markieren, **optionale** mit `optional`. Speichern unten rechts im Dialog-Fuß bzw. am Ende
der `SettingsSection`.

### Flächen und Struktur
| Baustein | Props | Regeln |
|---|---|---|
| `Card` | `className` | Weiß, `rounded-xl`, `shadow-card`. |
| `CardHeader` | `title, subtitle?, action?` | Kopf innerhalb einer Karte. |
| `PageHeader` | `title, subtitle?, actions?, breadcrumbs?: Crumb[], backTo?: {to,label}, eyebrow?, meta?, back?` | Jede Seite beginnt damit (außer „Heute“). Detailseiten: `breadcrumbs` (Desktop) bzw. `backTo`. `meta` für Badges unter dem Titel. |
| `SectionHeader` | `title, count?, meta?, action?` | Über jeder Liste/Karte im Seiteninhalt. `action` z. B. `<SectionLink to>`. |
| `SectionLink` | `to, children` | „Alle anzeigen ›“. |
| `Breadcrumbs`, `BackLink` | `items` / `to` | Pfad bzw. Zurück-Link. |
| `Tabs` | `value, onChange, tabs: {value,label,count?,tone?}[]` | Unterstrich-Reiter für **Bereiche** einer Seite. Mit `useUrlTab('tab', 'standard')` in der URL halten. |
| `Segmented` | `value, onChange, options` | Umschalter für **Ansicht/Filter** innerhalb eines Bereichs (2–5 Optionen). |
| `SettingsSection` | `title, description?, children, footer?` | Einstellungen: links Erklärung, rechts Felder in Karte. |

### Listen und Daten
| Baustein | Props | Regeln |
|---|---|---|
| `FilterBar` (= `Toolbar`) | `search?: {value,onChange,placeholder}`, `children` (Chips), `trailing` | Über jeder Liste mit > 10 Einträgen. Chips scrollen auf dem Handy waagrecht. |
| `Chip` | `active, onClick, count?, icon?` | Filter an/aus. Aktiv = Tinte gefüllt. |
| `List` | `header?, aria-label?` | Karte mit `divide-y`-Zeilen. |
| `ListGroup` | `title, count?, tone?, action?` | Gruppenkopf (Linear-Stil) innerhalb von `List`. |
| `ListRow` | `leading?, title, subtitle?, meta?, trailing?, to? \| onClick?, chevron?, tone?, selectable?, selected?, onSelect?` | Standardzeile für Objekte/Elemente/Mängel/Aufgaben. `meta` erscheint erst ab `sm`. `tone` färbt den Untertitel (z. B. „Überfällig seit …“). |
| `RowIcon` | `tone?` | 36-px-Symbolfeld als `leading`. |
| `DataTable<T>` | `columns: Column<T>[]` (`key, header, cell, align?, mobile?: primary\|secondary\|trailing\|hidden`), `rows, rowKey, rowTo?, onRowClick?, empty?, loading?, selected?, onSelect?` | Tabelle ab `md`; darunter automatisch `ListRow`s. Für Vergleichsdaten (Prüfungen, Berichte). |
| `PropertyList` | `items: {label, value, icon?}[]` | Eigenschaften im Seitenpanel einer Detailseite. Leere Werte zeigen „–“. |
| `KeyValue` | `items: [label, value][]` | Alt, weiter gültig (rechtsbündige Werte). |
| `Timeline` | `items: {id, icon?, tone?, title, time?, meta?, body?}[]` | Verlauf/Aktivität (Prüfungen, Kommentare, Statuswechsel). |
| `StatTile` | `label, value, tone?, to?, hint?` | Einzelne Kennzahl. Auf „Heute“ als Streifen (`StatusCell`). |
| `Avatar` | `name, size: xs\|sm\|md\|lg` | Initialen, Farbe stabil aus dem Namen. |

### Status
| Baustein | Props | Regeln |
|---|---|---|
| `Badge` | `tone, variant: soft\|outline\|solid, size: sm\|md, dot?, icon?` | `soft` Standard; `solid` nur für Kritisches; `outline` für neutrale Labels (Prüfart, Label). |
| `StatusDot` | `tone, pulse?, label?` | 8-px-Punkt in dichten Listen; `label` wenn der Punkt allein steht. |
| `DueBadge` | `state: DueState` | Prüfstatus eines Elements. |
| `ResultBadge` | `result: Result` | Ergebnis einer Prüfung. |
| `SeverityBadge` | `severity: Severity` | Schweregrad eines Mangels. |
| `toneDot`, `toneText`, `toneSoft`, `SEVERITY_TONE` | – | Klassen-Maps, falls ein Baustein nicht passt. |

### Zustände
| Baustein | Props | Regeln |
|---|---|---|
| `Empty` | `icon?, title, text?, action?, compact?` | Titel sagt, was fehlt („Noch keine Mängel“), Text sagt, was zu tun ist, **eine** Aktion. In Karten `compact`. |
| `Skeleton`, `SkeletonList`, `PageSkeleton` | `className` / `rows` | Statt `Spinner` für Seiten und Listen. `Spinner` nur in kleinen Bereichen. |
| `ErrorBox` | `error, onRetry?` | Fehler aus Anfragen. Mit `onRetry={() => refetch()}`. |
| `Notice` | `tone, title?, children, action?, icon?` | Hinweise im Inhalt (z. B. „Offline – Änderungen werden später übertragen“). |
| `useToast()` | `toast(text, 'ok' \| 'bad')` | Rückmeldung nach Aktionen, ≤ 6 Wörter: „Mangel gespeichert“. |

### Überlagerungen
| Baustein | Props | Regeln |
|---|---|---|
| `Modal` (= `Sheet`) | `title, description?, footer?, size: sm\|md\|lg\|xl, wide?` | Anlegen/Bearbeiten. Handy: Bottom-Sheet, Fußknöpfe volle Breite. Fuß: `secondary` „Abbrechen“ links, `primary` rechts. |
| `Drawer` | `title, subtitle?, footer?` | Vorschau eines Datensatzes rechts, ohne Seitenwechsel. |
| `ConfirmDialog` / `useConfirm()` | `title, text?, confirmLabel?, danger?` | Vor Löschen, Abschließen, Widerrufen. Kein `window.confirm`. |

### Do / Don't
- ✔ Status als `DueBadge`/`StatusDot` – ✘ farbiger Text ohne Punkt oder Symbol.
- ✔ Eine `List` mit `ListRow`s – ✘ viele einzelne Karten untereinander.
- ✔ Zahlen `tabular-nums`, Nullwerte in `ink-4` – ✘ große rote Nullen.
- ✔ Aktionen als Verb („Aufgaben anlegen“) – ✘ „OK“, „Absenden“, „Hier klicken“.
- ✔ Leere Liste mit `Empty` + Aktion – ✘ leere weiße Karte.
- ✘ Verläufe, Glas-Effekte, farbige Hintergründe ganzer Karten, Emoji, Schatten auf Schatten.
- ✘ Orange für etwas anderes als Erfassen/aktive Navigation.

---

## 5. Seitenvorlagen

### 5.1 Liste (Objekte, Elemente, Prüfungen, Mängel, Aufgaben, Begehungen)
```
PageHeader  title · subtitle · actions=[Button primary „Neues …“, Menu(Export, Import)]
Tabs        (falls Bereiche: Überfällig · Bald fällig · …, mit count und tone, useUrlTab)
FilterBar   search + Chips (Art, Status) + trailing (Ansicht/Export)
List        header="74 Elemente" · ListGroup (optional) · ListRow …
            leading=RowIcon/CategoryIcon · title=Code + Art · subtitle=Ort · meta=nächste Prüfung · trailing=DueBadge · chevron
Empty       je nach Filter: „Keine Treffer“ + „Filter zurücksetzen“ bzw. „Noch keine …“ + Anlegen
```
Laden: `SkeletonList`. Auswahl/Massenaktionen: `selectable` + Leiste über der Liste.

### 5.2 Detail (Objekt, Element, Mangel, Aufgabe, Prüfung)
```
PageHeader  breadcrumbs (Objekt › Gebäude › Element) · title · meta=[DueBadge, Badges] · actions=[primary Hauptaktion, Menu]
Grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-6
  links:  Tabs (Übersicht · Prüfungen · Mängel · Dateien) → Karten/Listen, Timeline „Verlauf“
  rechts: Card p-5 mit PropertyList (Status, Fällig am, Prüfart, Hersteller …), darunter weitere Karten
Handy: rechte Spalte rutscht unter den Titel (vor die Tabs).
```

### 5.3 Formular / Sheet
- Kurze Formulare (≤ 6 Felder) im `Modal` (Handy = Bottom-Sheet). Lange Abläufe (Prüfung) als
  eigene Seite mit fester Fußleiste.
- Felder `flex flex-col gap-4`; Abschnitte im Formular mit `text-meta font-semibold text-ink-2`.
- Fuß: Abbrechen (`secondary`) · Speichern (`primary`, `loading` während der Anfrage).

### 5.4 Dashboard („Heute“) – umgesetzt in `Dashboard.tsx`
1. Kopf: Datum (`text-meta`), Begrüßung (`text-h1 sm:text-display`), **eine Zeile Lage** mit
   `StatusDot`s und Links.
2. Schnellstart: drei `ActionTile`s (Erfassen mit orangem Symbolfeld – auf dem Handy entfällt
   die Kachel, dort ist das Mikrofon unten), Code scannen, Rundgang starten.
3. **Prüfstatus**: eine Karte mit Verteilungsbalken und fünf Kennzahlen (Handy 2 Spalten).
4. **Als Nächstes**: priorisierte Liste („needs attention“) mit `RowIcon` im Ton und einer Aktion je Zeile.
5. Zwei Spalten: **Rundgänge** (links, breiter) | Objekte, Offene Aufgaben, Zuletzt geprüft.

### 5.5 Einstellungen
```
PageHeader title="Einstellungen"
Tabs (Workspace · Prüfvorlagen · Benachrichtigungen · Konto · API), useUrlTab
SettingsSection title + description │ Card mit Fields/Switches │ footer=[Button primary „Speichern“]
Gefahrenbereich zuletzt: SettingsSection mit Notice tone="bad" und Button variant="danger" + ConfirmDialog
```

### 5.6 Anmeldung / Registrierung / Einladung / Passwort
Zweispaltig ab `lg`: links Formular (max. 352 px, vertikal zentriert, Logo oben, Rechtslinks unten),
rechts ruhige Produktvorschau auf Rasterpapier (`AuthAside`). Handy: nur das Formular.
Hauptknopf `size="lg"` volle Breite.

---

## 6. Texte und Ton

- **Du-Form**, freundlich und knapp: „Lege dein erstes Objekt an“, nicht „Bitte legen Sie …“.
- **Kurz:** Titel ≤ 4 Wörter, Untertitel ein Satz, Toasts ≤ 6 Wörter, Knöpfe 1–3 Wörter (Verb).
- **Fachwörter nur, wo die Branche sie benutzt** (Feuerschutztür, Brandschutzklappe, Prüfart,
  Mangel, Maßnahme). Keine IT-Wörter: „Datensatz“, „Entität“, „Request“ → „Element“, „Eintrag“.
- Zahlen + Einheit: „14 Prüfungen überfällig“, „seit 5 Monaten“, Datum `TT.MM.JJJJ` über `fmtDate`.
- Leerzustände sagen, **was fehlt** und **was als Nächstes zu tun ist**.
- Fehler: was ist passiert + was tun – „Keine Verbindung. Deine Eingaben bleiben erhalten.“
- Gedankenstrich „–“ und typografische Anführungszeichen „…“. Auslassung „…“.
- Feste Texte in PDFs/Excel zusätzlich Englisch über `shared/i18n.ts` (siehe `CLAUDE.md`).

---

## 7. Mobbin-Referenzen

Nur Muster übernommen (Aufbau, Dichte, Hierarchie) – keine Texte, Grafiken oder Code.

| App | Mobbin | Übernommen |
|---|---|---|
| Jobber | https://mobbin.com/screens/26563ea4-1b26-4a35-8c59-f9e8aab7de5c | „Heute“: Begrüßung + Datum oben, Arbeitsstand als Streifen mit Kennzahlen, To-do darunter |
| Vanta | https://mobbin.com/screens/8d2ea40a-3f09-4615-b9ee-971bce9a277c | „Als Nächstes“: Liste „braucht Aufmerksamkeit“ mit Ton-Symbol und einer Aktion je Zeile |
| Linear | https://mobbin.com/screens/2579f037-4e90-4330-ac35-19323ca9828a | Gruppierte dichte Liste → `ListGroup`/`ListRow`, Zähler neben Gruppentitel |
| Linear | https://mobbin.com/screens/4c79f5df-23b6-4250-81b2-c29db5a9f9ae | Detailkopf mit Eigenschaften als Badges unter dem Titel (`PageHeader.meta`) |
| Plane | https://mobbin.com/screens/1dfefd99-83d3-4831-896d-bcad9ce5b17c | Detailseite: Inhalt links, Eigenschaften-Panel rechts, Aktivität darunter |
| incident.io | https://mobbin.com/screens/fe969887-afe1-41ae-991e-cda75c5a50d7 | `PropertyList` (Label links grau, Wert rechts) und `Timeline` mit Zeit und Textblock |
| Plane | https://mobbin.com/screens/675ba224-6259-48bc-9cae-2bd3c712bf55 | Seitenleiste: kompakte 32-px-Einträge, ruhiger aktiver Zustand, Bereich einklappbar |
| Searchable | https://mobbin.com/screens/25fff5b7-c6b7-455e-8746-7da0680c0384 | Konto/Workspace unten in der Seitenleiste |
| Stripe | https://mobbin.com/screens/ab9ed449-1e64-4dbe-8be4-b98b53831762 | Listenseite: Titel + Aktionen, Filter-Chips, Suche, Tabelle mit leisen Köpfen (`DataTable`) |
| Meetup | https://mobbin.com/screens/c9704a3c-644d-4aba-8780-128aabb8921b | Schnellfilter als Chips neben dem Suchfeld (`FilterBar`) |
| Plane | https://mobbin.com/screens/7d44048d-ec3f-4377-9615-05369920140d | Anlegen-Dialog: Titel, Felder, Fuß mit Verwerfen/Speichern rechts (`Modal`) |
| Canva | https://mobbin.com/screens/3faf146e-9b00-485b-a0d4-eaf0f689e235 | Kleiner Dialog mit sichtbaren Labels über Feldern |
| Plane | https://mobbin.com/screens/81af81fa-5bb1-453a-ab8e-30bf42024c5c | Einstellungen in Abschnitten mit Fuß-Aktionen (`SettingsSection`) |
| Replit | https://mobbin.com/screens/f4d4cf18-a47c-486d-ad88-48acf37bbd4e | Einstellungen: Gefahrenbereich zuletzt, Aktion rechts neben Erklärung |
| incident.io | https://mobbin.com/screens/09e90e35-aa97-4450-99ff-c1162dbf10ec | Anmeldung zweigeteilt: ruhige warme Fläche + schlichtes Formular, Rechtstext unten |
| incident.io | https://mobbin.com/screens/353f2bc2-ec80-403d-9aa2-87736661f04f | Leerzustand klein in der Karte mit gerahmtem Symbol (`Empty compact`) |
| Attio | https://mobbin.com/screens/0323dfb8-2bdf-4495-942a-d77852b464eb | Leerzustand: Titel, ein Satz, genau eine Aktion |
| Shopify (iOS) | https://mobbin.com/screens/e0a3f3f2-db73-430d-8259-e4b59fa6c843 | Handy-Liste: Suche + waagrecht scrollende Filter, Statusbadges in der Zeile |
| Slack (iOS) | https://mobbin.com/screens/db4d4f0e-7eb9-4aad-93cd-ca273abee2de | Bottom-Sheet zum Anlegen: Griff, Titel, Schließen, klare Felder |
| Snapchat (iOS) | https://mobbin.com/screens/89ebfd69-c2e3-4fe8-8647-c04e30a734b6 | Sheet mit großem Hauptknopf volle Breite unten |
| TikTok (iOS) | https://mobbin.com/screens/908b080f-3369-4992-8be5-dce123219790 | Untere Leiste mit hervorgehobener Mittelaktion zwischen je zwei Reitern |

Gesucht, aber verworfen (passten nicht zum Ton): Luma-Anmeldung (dunkel, Werbekacheln),
Hinge/Waymo-Leisten (zu verspielt), Square-Seitenleiste (zu verschachtelt).

---

## 8. Prüfliste vor dem Merge einer Seite

- [ ] Beginnt mit `PageHeader` (Detail: Breadcrumbs/BackLink), Abschnitte mit `SectionHeader`.
- [ ] Laden = Skelett, leer = `Empty` mit Aktion, Fehler = `ErrorBox onRetry`.
- [ ] Status nur über `DueBadge`/`ResultBadge`/`SeverityBadge`/`StatusDot`.
- [ ] 390 px: kein horizontaler Überlauf, Ziele ≥ 40 px, Hauptaktion erreichbar.
- [ ] Keine Rohfarben (`red-500`, Hex im JSX), keine neuen Radien/Schatten.
- [ ] Texte in Du-Form, Knöpfe als Verb, keine Fachjargon-Fremdwörter.
- [ ] `npm run check` und die passende e2e-Reihe grün.
