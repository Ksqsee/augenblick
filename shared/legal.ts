// Rechtstexte als Vorlage. Vor dem Produktivbetrieb juristisch prüfen und mit Betreiberdaten ergänzen.
// Neue Version → Nutzer müssen erneut bestätigen.

export interface LegalDoc {
  key: 'terms' | 'privacy' | 'dpa';
  title: string;
  version: string;
  body: string;
}

export const LEGAL_DOCS: LegalDoc[] = [
  {
    key: 'terms',
    title: 'Nutzungsbedingungen',
    version: '2026-10',
    body: `1. Gegenstand
Prüfkompass ist eine Software zur Planung, Durchführung und Dokumentation wiederkehrender Prüfungen an Brandschutzeinrichtungen. Der Workspace-Inhaber schließt den Nutzungsvertrag für sein Unternehmen ab und lädt weitere Personen ein.

2. Verantwortung für Prüfungen
Die Software unterstützt bei der Dokumentation. Die fachliche Verantwortung für Prüfungen, Fristen, Prüfumfang und die Bewertung von Mängeln liegt bei den prüfenden Personen und beim Betreiber der Anlagen. Mitgelieferte Prüfkataloge und Rechtsgrundlagen sind Hilfestellungen und ersetzen nicht die im Einzelfall geltenden Vorschriften, Herstellerangaben oder das Brandschutzkonzept.

3. Pflichten der Nutzer
Zugangsdaten sind vertraulich zu behandeln. Unterschriften im System dürfen nur von der jeweils prüfenden Person geleistet werden. Hochgeladene Inhalte dürfen keine Rechte Dritter verletzen.

4. Verfügbarkeit und Daten
Der Anbieter bemüht sich um eine hohe Verfügbarkeit. Nutzer können ihre Daten jederzeit als Datei exportieren (Berichte, CSV, JSON-Backup).

5. Laufzeit
Der Vertrag läuft auf unbestimmte Zeit und kann jederzeit beendet werden. Nach Beendigung werden die Daten des Workspaces gelöscht, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.`,
  },
  {
    key: 'privacy',
    title: 'Datenschutzhinweise',
    version: '2026-10',
    body: `1. Verantwortlicher
Verantwortlich für die Verarbeitung der im Workspace gespeicherten Daten ist der jeweilige Workspace-Inhaber. Der Betreiber von Prüfkompass verarbeitet diese Daten als Auftragsverarbeiter.

2. Welche Daten verarbeitet werden
Kontodaten (Name, E-Mail-Adresse, Passwort als sicherer Hash), Sitzungsdaten (Zeitpunkte, Browserkennung), Inhalte des Workspaces (Objekte, Prüfprotokolle, Unterschriften, Fotos, Aufgaben, Kommentare) sowie ein Aktivitätsprotokoll.

3. Zweck und Rechtsgrundlage
Bereitstellung der Software und Nachweis durchgeführter Prüfungen (Art. 6 Abs. 1 lit. b und c DSGVO), Sicherheit des Dienstes (Art. 6 Abs. 1 lit. f DSGVO).

4. Speicherort
Die Anwendung läuft auf der Infrastruktur von Cloudflare. Daten werden in Cloudflare D1 und R2 gespeichert.

5. Ihre Rechte
Sie können Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit verlangen. Unter „Einstellungen → Datenschutz“ können Sie Ihre Daten jederzeit exportieren und Ihr Konto löschen. Prüfprotokolle bleiben als Nachweis erhalten; Ihr Name wird darin nach der Löschung durch „Gelöschte Person“ ersetzt.

6. Speicherdauer
Kontodaten bis zur Löschung des Kontos, Prüfnachweise entsprechend den gesetzlichen und vertraglichen Aufbewahrungspflichten des Betreibers.`,
  },
  {
    key: 'dpa',
    title: 'Vereinbarung zur Auftragsverarbeitung (AVV)',
    version: '2026-10',
    body: `1. Gegenstand und Dauer
Der Anbieter verarbeitet personenbezogene Daten im Auftrag des Workspace-Inhabers ausschließlich zur Bereitstellung von Prüfkompass, für die Dauer der Nutzung.

2. Art der Daten und Betroffene
Kontaktdaten und Namen von Beschäftigten, Ansprechpersonen und Subunternehmern; Unterschriften und Fotos im Rahmen von Prüfungen.

3. Weisungsgebundenheit
Die Verarbeitung erfolgt nur auf dokumentierte Weisung des Auftraggebers, die durch die Nutzung der Software erteilt wird.

4. Technische und organisatorische Maßnahmen
Verschlüsselte Übertragung (TLS), Passwort-Hashing (PBKDF2), mandantengetrennte Datenhaltung, rollenbasierte Zugriffsrechte, Protokollierung von Änderungen, Sitzungsverwaltung durch die Nutzer.

5. Unterauftragsverarbeiter
Cloudflare, Inc. (Hosting, Datenbank, Dateispeicher).

6. Löschung
Nach Ende der Nutzung werden die Daten gelöscht oder auf Wunsch zuvor als Export bereitgestellt.`,
  },
];
