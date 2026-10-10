# Analyse: Augenblick Control

Stand: 10.10.2026 · Methode: headless Chromium (Playwright über CDP) + REA
(`list_browser_targets`, `analyze_web_bundle`) + rein lesende GET-Aufrufe der
eigenen Workspace-Daten. Alle schreibenden Requests waren beim Durchklicken
blockiert. Screenshots liegen nur lokal (nicht im Repo).

Diese Datei beschreibt **Funktionen, Abläufe und Datenmodell**. Code, Texte,
Logos und Grafiken werden nicht übernommen.

## 1. Technik des Originals

| Bereich  | Befund |
|----------|--------|
| Frontend | Flutter Web (CanvasKit, `main.dart.js` ≈ 6,7 MB), Material-Design, Font Inter |
| Backend  | REST-API `api.augenblick-control.de`, Antwortformat `{ success, data, error }` |
| Daten    | Firestore-artige IDs (20 Zeichen), Timestamps als `{_seconds,_nanoseconds}`, `_schemaVersion`, Soft-Delete `isDeleted` |
| Auth     | Cookies `access_token`, `refresh_token`, `csrf_token` (HttpOnly), Refresh-Endpoint |
| Push     | Firebase Cloud Messaging (FCM-Token-Endpunkte) |
| Billing  | Stripe (Checkout/Portal), Pläne `free` / `business`, Testphase |

REA-Hinweis: `analyze_web_bundle` findet in Dart-kompiliertem JS keine Routen,
weil URLs zur Laufzeit zusammengesetzt werden. Die Endpunkt-Liste (Abschnitt 5)
stammt aus einer String-Suche im Bundle.

## 2. Fachlicher Kern

Digitale **Brandschutzprüfungen** nach DIN/ASR: Prüfgegenstände (Elemente/Geräte)
werden in einer Hierarchie verwaltet, regelmäßig geprüft, Mängel verfolgt und
Prüfprotokolle als PDF erzeugt.

```
Workspace (Tenant / Firma)
 └─ Objekt (Liegenschaft: Name, Adresse, Beschreibung, Ansprechpartner)
     └─ Gebäude (Name, Adresse)
         ├─ Grundriss / Bildplan (Bild/PDF, Ebene)  ← Elemente als Marker (x/y 0..1)
         └─ Element / Gerät (Prüfgegenstand)
             └─ Prüfung (Protokoll, Ergebnis, Signatur, Fotos)
                 └─ Mängel → Aufgaben
```

### Element-Kategorien (Prüfvorlagen)

| Schlüssel             | Bezeichnung               | Prüfpunkte | Stammdaten (Auszug) |
|-----------------------|---------------------------|-----------:|---------------------|
| `fireDoor`            | Brandschutztür (Code `BST-…`) | 18 | Baujahr, Zulassungs-Nr., Feuerwiderstandsklasse, Rauchschutz, Türart, Feststellanlage |
| `damper`              | Brandschutzklappe         | 16 | Baujahr, BSK-Nr., Zulassungs-Nr., Nennweite DN, FW-Klasse, Einbaulage, Antrieb, Auslösung |
| `extinguisher`        | Feuerlöscher              | 12 | Baujahr, Seriennummer, Löschmittel, Füllmenge, Brandklassen |
| `rauchmelder`         | Rauchwarnmelder           | 13 | Herstellungsdatum, Montageort, Seriennummer, Batterietyp |
| `brandschutzbegehung` | Begehung (objektweit)     | 68 / 81 Katalogpunkte | – |

Jede Vorlage hat: nummerierte **Prüfpunkte**, **Stammdatenfelder**,
**Wartungsarbeiten**-Optionen (Checkboxen), Version, „custom“/„Variante“-Flags.
Kunden können Prüfpunkte anpassen und eigene Protokolle anlegen.

### Brandschutzbegehung (Katalog)

11 Abschnitte (Flucht-/Rettungswege, Notausgänge, Abschlüsse, Löscheinrichtungen,
Brandmelde-/Alarmierung, RWA, Sicherheitskennzeichnung, Organisatorisch,
Brennbare Materialien, Elektrik, Spezielle Bereiche). Je Prüfpunkt:
Frage, Rechtsgrundlage (ASR, DIN, MBO/LBO, TRGS, DGUV, VdS …),
Standard-Schweregrad (`kritisch` / `hoch` / `mittel`) und Gebäudearten
(`all`, `gastronomie`, `lager`, `tiefgarage_parkhaus`, `versammlungsstaette`,
`pflege_gesundheit`, `schule_kita`).

## 3. Datenmodell (beobachtete Felder)

**Tenant**: companyName, logo, language, timezone, plan, trialEndsAt,
effectiveFeatures (Feature-Flags je Plan: uuidCodes, pdfReports,
excelJsonExport, subcontractors, customProtocols, batchZipExport, floorPlan,
excelImport, brandschutzbegehung, customPruefpunkte, maengelReminders …).

**Mitglied**: uid, email, displayName, role (`owner`, `admin`, `inspector`,
`member`, `subcontractor`), status (`active`/eingeladen), joinedAt.

**Objekt**: name, address, description, contactPerson/Phone/Email.
Compliance je Objekt: totalAssets, overdueCount, soonCount, mangelCount,
nichtPruefbarCount, okCount, status (`green`/…).

**Gebäude**: name, address, objektId.

**Element**: objectCode (Präfix je Kategorie + 4 Zeichen), category, subType,
location, floor, manufacturer, model, stammdaten{}, assetUuid (QR-UUID-Label),
floorPlanId + markerX/markerY, lastInspectionId/Date/Result,
nextInspectionDate, nextInspectionWarnFrom (≈ 30 Tage vorher).

**Prüfung**: category, objektId/buildingId/objectId (+ denormalisierte Namen),
inspectionType (`yearly`, `monthly`, `inner` = 5 J., `strength` = 10 J.),
inspectionPurpose (`planned` …), status (`draft` → `submitted`),
result (`ok`, `issue`, `critical`, `nichtPruefbar`), inspector, inspectedAt,
nextInspectionDate, templateVersion, signatureUrl, photoUrls, notes,
fieldValues:
- `artDerPruefung`: Erstprüfung / wiederkehrend jährlich / nach Instandsetzung / nach Änderung / Sonderprüfung
- `pruefpunkte`: `{ "<nr>": "io" | "mangel" | "nz" }`
- `wartungsarbeiten`: `{ key: bool }`
- `maengel[]`, `massnahmen[]`, `fotoBeschreibungen[]`
- `gesamtbewertung`: z. B. `ohneMaengel`, `erheblicheMaengel`

**Aufgabe**: status (`pending`, `in_progress`, `completed`, `cancelled`),
priority (`low`/`medium`/`high`), Labels, SLA-Richtlinien, Kommentare,
Statistik (Backlog, Durchsatz, Lösungszeit, SLA-Einhaltung, Auslastung).

**Benachrichtigung**: type (z. B. `inspection_submitted`), title, body,
isRead, metadata. Präferenzen je Kanal (E-Mail/Push): Wartung, Aufgaben,
Mängelstatus, Wochenübersicht, Kontosicherheit; „Nicht stören“-Zeitraum.

## 4. Oberfläche & Abläufe

Navigation (Sidebar): **Dashboard, Objekte, Prüfungen, Geräte, Aufgaben,
Berichte** · Team: **Mitarbeiter, Subunternehmer** · Verwaltung:
**Einstellungen, Anleitung**. Oben: Benachrichtigungsglocke, Workspace-Wechsler.

- **Dashboard**: globale Suche, Offline-Modus (Gebäude vorab laden), Schnellaktionen
  „Code scannen“ und „Neues Element“, Kennzahlenleiste (Objekte, Prüfungen,
  Mängel Geräte/Begehung, Überfällig, Bald fällig, Nicht geprüft, Nicht prüfbar),
  Objektstatus-Liste mit Ampel, letzte Prüfungen.
- **Objekte**: Tabelle (Name, Adresse, Kontakt, Status, Mängel, Nicht geprüft,
  letzte/nächste Prüfung), Detail mit Gebäuden, Prüfungen, PDF-Dateinamen-Schema.
- **Prüfungen**: Tabs Überfällig / Bald fällig / Mängel (Geräte) / Mängel (Begehung) /
  Nicht prüfbar / Durchgeführt / Neue Geräte; Filter nach Prüfart; „Code scannen“,
  „Neue Prüfung“. Ablauf: Element wählen/scannen → Prüfart → Prüfpunkte
  i.O./Mangel/n.z. → Wartungsarbeiten → Mängel/Maßnahmen/Fotos →
  Gesamtbewertung → Unterschrift → Abschicken (Entwürfe & Offline-Sync möglich).
- **Geräte**: Liste mit Suche (Code, Standort, Hersteller) und Filter.
- **Mängel**: objektübergreifendes Mängel-Dashboard.
- **Aufgaben**: Tabs Offen / In Bearbeitung / Erledigt / Alle, Übersicht/Statistik.
- **Berichte**: Prüfprotokoll (PDF), Objektbericht, Compliance-Bericht,
  Mängelbericht, Elemente-Liste (Excel, re-importierbar); Erstellte Berichte;
  Archiv. Außerdem JSON-Backup, UUID-Etiketten.
- **Einstellungen**: Profil, Datenschutz/Verträge, Firmenprofil, Tarif,
  Aktivitätsprotokoll, Erinnerungen, Archiv, Prüfvorlagen, Labels,
  SLA-Richtlinien, Import (Excel), UUID-Codes (QR-Etiketten).
- **Mitarbeiter**: Liste mit Rolle/Status, Einladen.

## 5. API-Endpunkte (Gruppen)

- **auth**: login, logout, register, refresh-token, session-check, forgot/reset/change-password,
  verify/confirm-email, workspaces, switch-workspace, legal (versions, acknowledge, history)
- **tenants**: current, members (+invite), usage, storage-stats, audit-log, logo,
  company-profile, notification-preferences, sessions, access-keys, billing (checkout/portal/status/preview), plan-config
- **objekte**: CRUD, compliance · **buildings**: CRUD, search · **floor-plans**
- **objects** (Elemente): CRUD, search, stats, action-required, from-scan, neue-geraete-stats, pruefungen-summary
- **inspections**: CRUD, search, stats, counts, batch-delete, failed-syncs,
  custom-protocols, brandschutzbegehung/catalog, reopen, signature, photos, attachments
- **inspection-templates** (inkl. Varianten) · **maengel** · **tasks** (+labels, sla-policies, comments, stats)
- **reports**: pdf, generate-async, jobs, excel, elements-excel, json-backup, uuid-labels, import-template, archives
- **notifications** (+read-all, fcm-token) · **uuid-codes** (redeem) · **offline-bundle**

## 6. Abgleich mit Prüfkompass (Stand 10.10.2026)

Grundlage ist diese Analyse; Augenblick Control wurde seither nicht erneut geöffnet.

| Bereich (Augenblick) | Prüfkompass | Anmerkung |
|----------------------|-------------|-----------|
| Hierarchie Workspace → Objekt → Gebäude → Element, Grundrisse mit Markern | ✓ | |
| Prüfvorlagen, eigene Protokolle/Varianten, eigene Prüfpunkte | ✓ | eigene Elementarten, Vorlagen je Prüfart |
| Prüfarten (`yearly`, `monthly`, `inner`, `strength`) | ✓ | je Element mit eigener Frist |
| Prüfablauf inkl. Art der Prüfung, Wartungsarbeiten, Mängel, Maßnahmen, Fotos, Gesamtbewertung, Unterschrift | ✓ | Gesamtbewertung überschreibbar mit Begründung |
| Entwürfe, Offline-Sync, fehlgeschlagene Syncs | ✓ | PWA mit Warteschlange |
| Wieder öffnen, Archiv, Mehrfachlöschen | ✓ | |
| Brandschutzbegehung mit Katalog nach Gebäudeart | ✓ | eigener Fragenkatalog und eigene Formulierungen |
| Prüfungs-Reiter (Überfällig, Bald fällig, Nicht prüfbar, Durchgeführt, Neue Geräte), Filter nach Prüfart | ✓ | Mängel-Reiter als eigene Seite |
| Mängel-Dashboard, Aufgaben mit Labels, SLA, Kommentaren, Statistik | ✓ | |
| Subunternehmer | ✓ (anders) | Link je Aufgabe statt eigener Rolle/Konto |
| Berichte: Prüfprotokoll, Objektbericht, Compliance, Mängelbericht, Excel-Elementliste (re-importierbar), JSON-Backup, Archiv | ✓ | PDF entsteht im Browser |
| Batch-ZIP-Export, PDF-Dateinamenschema | ✓ | |
| UUID-/QR-Etiketten, Scan, Zuordnung beim ersten Scan | ✓ | |
| Excel-Import mit Vorlage | ✓ | auch CSV und englische Kopfzeilen |
| Benachrichtigungen, Präferenzen, Wochenübersicht, Kontosicherheit, „Nicht stören“ | ✓ | In-App + Web Push statt FCM |
| Firmenprofil, Logo, Sprache, Zeitzone | ✓ | Sprache gilt für Dokumente; Oberfläche deutsch |
| Sitzungen, Rechtstexte mit Versionen, DSGVO | ✓ | |
| Speicher-Statistik (`storage-stats`) | ✓ | |
| Zugangsschlüssel (`access-keys`) | ✓ | siehe [`docs/api.md`](../api.md) |
| Billing (Stripe, Pläne, Testphase) | – | bewusst weggelassen |
| E-Mail (Passwort vergessen, E-Mail-Bestätigung, Mail-Erinnerungen) | – | bewusst weggelassen; Passwort-Link durch Admin |
