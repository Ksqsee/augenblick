import clsx from 'clsx';
import { ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Input, PageHeader } from '../components/ui';

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
      'Bei einem Mangel Schweregrad wählen, kurz beschreiben und optional ein Foto aufnehmen.',
      'Durchgeführte Arbeiten antippen, allgemeine Fotos und Bemerkungen ergänzen.',
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
      'Die Übersicht zeigt immer die früheste fällige Prüfart eines Elements.',
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
    link: ['/begehungen', 'Zu den Begehungen'],
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
    link: ['/aufgaben', 'Zu den Aufgaben'],
  },
  {
    id: 'berichte',
    title: 'Berichte, PDF und Export',
    steps: [
      'Jedes Protokoll lässt sich als PDF herunterladen; der Dateiname folgt dem Schema unter Einstellungen → Unternehmen (je Objekt überschreibbar).',
      'Unter Prüfungen → Durchgeführt mehrere Prüfungen auswählen und gesammelt als ZIP exportieren.',
      'Compliance-Übersicht und Mängelbericht gibt es als PDF unter Berichte; dort auch CSV-Liste und vollständiges JSON-Backup.',
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
      'Unter Einstellungen → Profil siehst du alle angemeldeten Geräte und kannst sie abmelden.',
      'Unter Einstellungen → Datenschutz kannst du deine Daten exportieren oder dein Konto löschen.',
    ],
  },
];

const FAQ: [string, string][] = [
  ['Wann gilt ein Element als „bald fällig“?', 'Wenn der nächste Termin einer aktiven Prüfart in den nächsten 30 Tagen liegt.'],
  ['Was passiert bei „nicht prüfbar“?', 'Die Prüfung wird dokumentiert, der Termin bleibt aber bestehen – das Element taucht weiter als fällig auf, bis es geprüft werden konnte.'],
  ['Kann ich eine abgeschlossene Prüfung korrigieren?', 'Administratoren können eine Prüfung im Protokoll „wieder öffnen“. Ergebnis, Unterschrift und daraus entstandene Mängel werden zurückgesetzt und beim erneuten Abschluss neu angelegt.'],
  ['Sind die Prüfkataloge verbindlich?', 'Nein. Die Kataloge und Rechtsgrundlagen sind Orientierungshilfen. Maßgeblich sind Herstellerangaben, die geltenden Vorschriften und das Brandschutzkonzept. Prüfpunkte lassen sich anpassen.'],
  ['Wie kommen Benachrichtigungen aufs Handy?', 'Unter Einstellungen → Benachrichtigungen „Push aktivieren“. Auf dem iPhone muss die App dafür zuerst zum Home-Bildschirm hinzugefügt werden.'],
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
      <PageHeader title="Anleitung & Hilfe" subtitle="So arbeitest du mit Prüfkompass" />
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input className="pl-9" placeholder="Hilfe durchsuchen …" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-col gap-3">
        {topics.map((t) => {
          const isOpen = open === t.id || !!ql;
          return (
            <Card key={t.id} className="overflow-hidden">
              <button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left" onClick={() => setOpen(isOpen && !ql ? null : t.id)} aria-expanded={isOpen}>
                <span className="text-[15px] font-semibold">{t.title}</span>
                <ChevronDown className={clsx('size-4 text-ink-3 transition', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div className="border-t border-line px-5 py-4">
                  <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-2">
                    {t.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {t.link && (
                    <Link to={t.link[0]} className="mt-3 inline-block text-sm font-medium text-brand-strong hover:underline">
                      {t.link[1]} →
                    </Link>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {faq.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-lg font-semibold">Häufige Fragen</h2>
          <Card className="divide-y divide-line">
            {faq.map(([qq, a]) => (
              <details key={qq} className="px-5 py-3">
                <summary className="cursor-pointer text-sm font-medium">{qq}</summary>
                <p className="mt-2 text-sm text-ink-2">{a}</p>
              </details>
            ))}
          </Card>
        </>
      )}
      {!topics.length && !faq.length && <p className="text-sm text-ink-3">Nichts gefunden.</p>}
    </div>
  );
}
