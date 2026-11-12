import clsx from 'clsx';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Empty, PageHeader, SearchField, Section, Surface } from '../components/ui';

interface Topic {
  id: string;
  title: string;
  steps: string[];
  link?: [string, string];
}

const GUIDE: Topic[] = [
  {
    id: 'start',
    title: 'Erste Schritte',
    steps: [
      'Unter Einstellungen → Unternehmen Firmenname, Anschrift und Logo hinterlegen – beides erscheint auf allen Protokollen.',
      'Unter Objekte eine Liegenschaft anlegen und darin mindestens ein Gebäude.',
      'Im Gebäude Elemente erfassen (Feuerschutztüren, Klappen, Löscher, Melder) – oder einen vorhandenen Bestand über Import aus Excel übernehmen.',
      'Kolleginnen und Kollegen unter Team einladen und eine Rolle vergeben.',
    ],
    link: ['/objekte', 'Zu den Objekten'],
  },
  {
    id: 'pruefen',
    title: 'Eine Prüfung durchführen',
    steps: [
      'Element über Code scannen (QR-Etikett), Suche (Strg+K) oder die Liste öffnen und „Prüfung starten“ wählen.',
      'Jeden Prüfpunkt mit ✓ (in Ordnung), ✗ (Mangel) oder – (nicht zutreffend) bewerten. „Rest i. O.“ setzt alle offenen Punkte auf in Ordnung.',
      'Bei einem Mangel Schweregrad wählen, kurz beschreiben, die nötige Maßnahme eintragen und optional ein Foto aufnehmen.',
      'Durchgeführte Arbeiten antippen, allgemeine Fotos und Bemerkungen ergänzen.',
      'Die Gesamtbewertung wird aus den Befunden berechnet. Als Sachkundige/r kannst du sie abweichend festlegen, z. B. „Kritisch“ – mit Begründung, die im Protokoll erscheint.',
      'Unterschreiben und „Abschließen“. Ergebnis und nächster Termin werden automatisch berechnet, das Protokoll steht als PDF bereit.',
      'Der Entwurf wird laufend gespeichert – du kannst jederzeit unterbrechen und später weitermachen.',
    ],
  },
  {
    id: 'pruefarten',
    title: 'Prüfarten und Fristen',
    steps: [
      'Manche Elemente haben mehrere Prüfarten mit eigener Frist, z. B. Feuerlöscher: Instandhaltung (2 Jahre), innere Prüfung (5 Jahre), Festigkeitsprüfung (10 Jahre).',
      'Optionale Prüfarten aktivierst du am Element unter „Prüfarten“ und gibst den ersten Termin an.',
      'Die Übersicht zeigt immer die früheste fällige Prüfart eines Elements. Unter Prüfungen filterst du die Listen nach einer bestimmten Prüfart.',
      'Intervalle und Prüfpunkte je Prüfart passt du unter Einstellungen → Prüfvorlagen an.',
    ],
  },
  {
    id: 'offline',
    title: 'Ohne Netz prüfen (Offline-Modus)',
    steps: [
      'Vor dem Termin bei bestehender Verbindung unter Offline-Modus das Gebäude laden (oder in der Objektansicht das Wolken-Symbol am Gebäude).',
      'Vor Ort im Offline-Modus das Element antippen und wie gewohnt prüfen – Fotos werden auf dem Gerät gespeichert.',
      'Sobald wieder Verbindung besteht, werden die Prüfungen automatisch übertragen. Den Stand siehst du in der Warteschlange.',
      'Tipp: Die App lässt sich über das Browser-Menü „Zum Home-Bildschirm“ wie eine normale App installieren.',
    ],
    link: ['/offline', 'Zum Offline-Modus'],
  },
  {
    id: 'begehung',
    title: 'Brandschutzbegehung',
    steps: [
      'Im Objekt „Begehung“ wählen, optional einen Bereich und die Nutzungsart festlegen – danach richtet sich der Fragenkatalog.',
      'Abschnitte nacheinander abarbeiten; zu jeder Frage ist die Rechtsgrundlage angegeben.',
      'Feststellungen werden beim Abschluss zu Mängeln und lassen sich als Aufgaben weitergeben.',
      'Die nächste Begehung wird nach 12 Monaten fällig.',
    ],
    link: ['/pruefen/begehungen', 'Zu den Begehungen'],
  },
  {
    id: 'grundrisse',
    title: 'Grundrisse und Marker',
    steps: [
      'Im Objekt unter „Grundrisse“ einen Plan als Bild oder PDF hochladen (bei PDFs wird die erste Seite verwendet).',
      'In der Planansicht rechts ein nicht platziertes Element wählen und auf die Position im Plan tippen.',
      'Marker zeigen den Status farbig an; Antippen öffnet das Element, dort auch „Verschieben“ oder „Vom Plan entfernen“.',
    ],
  },
  {
    id: 'maengel',
    title: 'Mängel, Aufgaben und Subunternehmer',
    steps: [
      'Unter Mängel siehst du alle offenen Mängel aus Prüfungen und Begehungen – nach Schwere sortiert.',
      'Aus einem Mangel eine Aufgabe erzeugen, zuständige Person oder Subunternehmer zuweisen.',
      'Für Subunternehmer in der Aufgabe „Link erzeugen“ – die Firma kann die Aufgabe ohne Konto ansehen und als erledigt melden.',
      'Wird eine Aufgabe erledigt, gilt der verknüpfte Mangel automatisch als behoben.',
      'Labels und SLA-Fristen je Priorität legst du unter Einstellungen → Aufgaben fest; die Übersicht zeigt Auslastung und SLA-Einhaltung.',
    ],
    link: ['/offen?art=aufgaben', 'Zu den Aufgaben'],
  },
  {
    id: 'berichte',
    title: 'Berichte, PDF und Export',
    steps: [
      'Jedes Protokoll lässt sich als PDF herunterladen; der Dateiname folgt dem Schema unter Einstellungen → Unternehmen (je Objekt überschreibbar).',
      'Unter Prüfungen → Durchgeführt mehrere Prüfungen auswählen und gesammelt als ZIP exportieren.',
      'Compliance-Übersicht, Mängelbericht und Objektbericht (je Objekt, auch direkt in der Objektansicht) gibt es als PDF unter Berichte.',
      'Jeder erzeugte Bericht und jeder ZIP-Export landet automatisch unter Berichte → Erstellte Berichte und lässt sich dort später wieder herunterladen.',
      'Die Elementliste gibt es als Excel-Datei: bearbeiten und über Import wieder einlesen. Außerdem CSV und vollständiges JSON-Backup.',
      'Ältere Prüfungen können archiviert werden (manuell oder automatisch) – sie bleiben als Nachweis erhalten.',
    ],
    link: ['/berichte', 'Zu den Berichten'],
  },
  {
    id: 'etiketten',
    title: 'QR-Etiketten',
    steps: [
      'Unter Berichte → QR-Etiketten Bögen für vorhandene Elemente drucken.',
      'Oder Blanko-Etiketten vorab drucken und aufkleben: Beim ersten Scan legst du das Element an oder ordnest das Etikett einem vorhandenen Element zu.',
      'Der QR-Code öffnet das Element direkt – auch mit der normalen Kamera-App.',
    ],
  },
  {
    id: 'team',
    title: 'Team, Rollen und Sicherheit',
    steps: [
      'Rollen: Inhaber (alles), Administrator (Objekte, Team, Vorlagen), Prüfer (Elemente und Prüfungen), Lesezugriff (nur ansehen).',
      'Passwort vergessen? Ein Admin erzeugt unter Team (Schlüssel-Symbol) einen einmaligen Link, der 24 Stunden gilt.',
      'Unter Einstellungen → Konto siehst du alle angemeldeten Geräte und kannst sie abmelden. Bei einer Anmeldung von einem neuen Gerät bekommst du eine Benachrichtigung.',
      'Unter Einstellungen → Konto → Datenschutz kannst du deine Daten exportieren; dort kannst du auch dein Konto löschen.',
      'Admins sehen unter Einstellungen → Unternehmen den belegten Speicher und legen unter Einstellungen → API Zugangsschlüssel für Fremdsysteme an.',
    ],
  },
];

const FAQ: [string, string][] = [
  ['Wann gilt ein Element als „bald fällig“?', 'Wenn der nächste Termin einer aktiven Prüfart in den nächsten 30 Tagen liegt.'],
  ['Was passiert bei „nicht prüfbar“?', 'Die Prüfung wird dokumentiert, der Termin bleibt aber bestehen – das Element taucht weiter als fällig auf, bis es geprüft werden konnte.'],
  ['Kann ich eine abgeschlossene Prüfung korrigieren?', 'Administratoren können eine Prüfung im Protokoll „wieder öffnen“. Ergebnis, Unterschrift und daraus entstandene Mängel werden zurückgesetzt und beim erneuten Abschluss neu angelegt.'],
  ['Sind die Prüfkataloge verbindlich?', 'Nein. Die Kataloge und Rechtsgrundlagen sind Orientierungshilfen. Maßgeblich sind Herstellerangaben, die geltenden Vorschriften und das Brandschutzkonzept. Prüfpunkte lassen sich anpassen.'],
  ['Wie kommen Benachrichtigungen aufs Handy?', 'Unter Einstellungen → Benachrichtigungen „Push aktivieren“. Auf dem iPhone muss die App dafür zuerst zum Home-Bildschirm hinzugefügt werden.'],
  ['Gibt es Protokolle auf Englisch?', 'Ja. Unter Einstellungen → Unternehmen die Sprache der Dokumente auf Englisch stellen. PDF-Protokolle, Berichte und der Excel-Export erscheinen dann auf Englisch; eigene Prüfpunkte und Freitexte bleiben, wie sie geschrieben wurden. Dort stellst du auch die Zeitzone ein.'],
  ['Kann ich Prüfkompass an andere Systeme anbinden?', 'Ja, über die REST-API. Ein Admin legt unter Einstellungen → API einen Schlüssel an (nur lesen oder lesen und schreiben). Beispiele stehen direkt auf der Seite.'],
  ['Wie verbinde ich Claude mit Prüfkompass?', 'Unter Einstellungen → API steht die Anleitung: Adresse in Claude als Connector eintragen, auf der Freigabeseite die Rechte wählen und verbinden. Danach einfach sagen, was du brauchst – z. B. „Was steht heute an?“ oder „Rundgang Haupthaus“. Claude füllt Prüfungen aus, unterschrieben wird immer in der App.'],
  ['Kann ich nachts Ruhe haben?', 'Ja. Unter Einstellungen → Benachrichtigungen → „Nicht stören“ legst du einen Ruhezeitraum fest (optional das ganze Wochenende). Dann kommen keine Push-Nachrichten; in der App siehst du alles wie gewohnt.'],
  ['Kann ich eigene Elementarten anlegen?', 'Ja, unter Einstellungen → Prüfvorlagen → „Eigene Elementart“ – mit eigenen Prüfpunkten, Stammdatenfeldern und Code-Präfix. Bestehende Arten lassen sich als Variante kopieren.'],
];

export function HelpPage() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>('start');
  const ql = q.trim().toLowerCase();
  const topics = useMemo(() => (ql ? GUIDE.filter((t) => (t.title + t.steps.join(' ')).toLowerCase().includes(ql)) : GUIDE), [ql]);
  const faq = useMemo(() => (ql ? FAQ.filter(([a, b]) => (a + b).toLowerCase().includes(ql)) : FAQ), [ql]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Anleitung & Hilfe" subtitle="So arbeitest du mit Prüfkompass – Schritt für Schritt." />
      <SearchField className="mb-6 sm:!max-w-none" label="Hilfe durchsuchen" placeholder="Hilfe durchsuchen …" value={q} onChange={setQ} />
      <Surface>
        {topics.length > 0 && (
          <Section title="Anleitungen" count={topics.length} flush>
            <ul className="pk-list" aria-label="Anleitungen">
              {topics.map((t) => {
                const isOpen = open === t.id || !!ql;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="flex min-h-[52px] w-full items-center justify-between gap-3 px-(--row-px) py-2.5 text-left transition-colors hover:bg-hover sm:min-h-12"
                      onClick={() => setOpen(isOpen && !ql ? null : t.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="text-body text-ink">{t.title}</span>
                      <span className="flex shrink-0 items-center gap-3 text-meta text-ink-3">
                        <span className="max-sm:hidden">{t.steps.length} Schritte</span>
                        <ChevronDown className={clsx('size-4 text-ink-4 transition-transform', isOpen && 'rotate-180')} />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="animate-in px-(--row-px) pb-5">
                        <ol className="flex flex-col gap-2.5">
                          {t.steps.map((s, i) => (
                            <li key={i} className="flex gap-3 text-body leading-relaxed text-ink-2">
                              <span className="w-4 shrink-0 text-right text-meta leading-relaxed text-ink-3 tabular-nums">{i + 1}</span>
                              <span className="min-w-0">{s}</span>
                            </li>
                          ))}
                        </ol>
                        {t.link && (
                          <Link to={t.link[0]} className="mt-3 ml-7 inline-flex min-h-9 items-center gap-1.5 text-meta font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                            {t.link[1]}
                            <ArrowRight className="size-3.5" />
                          </Link>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        {faq.length > 0 && (
          <Section title="Häufige Fragen" count={faq.length} flush>
            <ul className="pk-list" aria-label="Häufige Fragen">
              {faq.map(([qq, a]) => (
                <li key={qq}>
                  <details className="group" open={!!ql}>
                    <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-(--row-px) py-2.5 text-body text-ink transition-colors hover:bg-hover sm:min-h-12 [&::-webkit-details-marker]:hidden">
                      {qq}
                      <ChevronDown className="size-4 shrink-0 text-ink-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="px-(--row-px) pb-4 text-body leading-relaxed text-ink-2">{a}</p>
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {!topics.length && !faq.length && (
          <Empty
            title="Nichts gefunden"
            text={`Zu „${q.trim()}“ gibt es keine Anleitung. Versuche ein anderes Wort, z. B. „Prüfung“ oder „Export“.`}
            action={
              <Button variant="secondary" onClick={() => setQ('')}>
                Suche leeren
              </Button>
            }
          />
        )}
      </Surface>
      <p className="mt-8 px-1 text-meta text-ink-3">Fragen zur Prüfpflicht selbst beantworten Herstellerangaben, Vorschriften und das Brandschutzkonzept.</p>
    </div>
  );
}
