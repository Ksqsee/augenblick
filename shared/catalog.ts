// Prüfkataloge – eigene Formulierungen, orientiert an den einschlägigen Normen
// (DIN 14677, DIN EN 15650 / DIN 31051, DIN 14406-4, DIN 14676).

export type Category = 'fire_door' | 'damper' | 'extinguisher' | 'smoke_alarm';

export interface Checkpoint {
  id: string;
  label: string;
  hint?: string;
}

export interface AttributeField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options?: string[];
}

export interface CategoryDef {
  key: Category;
  label: string;
  plural: string;
  prefix: string;
  norm: string;
  intervalMonths: number;
  checkpoints: Checkpoint[];
  attributes: AttributeField[];
  maintenance: { key: string; label: string }[];
}

const cp = (labels: (string | [string, string])[]): Checkpoint[] =>
  labels.map((l, i) => (Array.isArray(l) ? { id: `p${i + 1}`, label: l[0], hint: l[1] } : { id: `p${i + 1}`, label: l }));

export const CATEGORIES: Record<Category, CategoryDef> = {
  fire_door: {
    key: 'fire_door',
    label: 'Feuerschutztür',
    plural: 'Feuerschutztüren',
    prefix: 'FST',
    norm: 'DIN 14677',
    intervalMonths: 12,
    checkpoints: cp([
      ['Kennzeichnungsschild vorhanden und lesbar', 'Zulassung / Hersteller / Baujahr'],
      'Türblatt ohne Beschädigung, Verzug oder nachträgliche Bohrungen',
      'Zarge fest verankert, Anschlussfuge geschlossen',
      'Bänder und Sicherungsstifte fest, kein Spiel',
      'Obentürschließer schließt die Tür aus jeder Öffnungsstellung',
      'Schließfolgeregelung bei zweiflügeligen Türen wirksam',
      'Schloss rastet selbsttätig ein, Falle gängig',
      'Drücker / Panikbeschlag vollständig und funktionsfähig',
      'Dichtungen (Rauch- und Brandschutz) vollständig, nicht übermalt',
      'Verglasung unbeschädigt, Glasleisten fest',
      'Keine unzulässigen Keile, Haken oder Festhaltungen',
      ['Feststellanlage löst bei Auslösung aus', 'nur wenn vorhanden'],
      'Rauchmelder der Feststellanlage gereinigt / im Prüfzeitraum',
      'Schwellenbereich frei, Bodenspalt im zulässigen Bereich',
      'Freilauf / Schließgeschwindigkeit plausibel eingestellt',
      'Abschließende Funktionsprüfung bestanden',
    ]),
    attributes: [
      { key: 'year', label: 'Baujahr', type: 'number' },
      { key: 'approval', label: 'Zulassungsnummer' },
      { key: 'rating', label: 'Feuerwiderstand', type: 'select', options: ['T30', 'T60', 'T90', 'EI2 30', 'EI2 60', 'EI2 90'] },
      { key: 'smoke', label: 'Rauchschutz (RS)', type: 'boolean' },
      { key: 'leaves', label: 'Flügel', type: 'select', options: ['1-flügelig', '2-flügelig'] },
      { key: 'holdOpen', label: 'Feststellanlage', type: 'boolean' },
    ],
    maintenance: [
      { key: 'closer', label: 'Schließer nachjustiert' },
      { key: 'seals', label: 'Dichtungen getauscht' },
      { key: 'hinges', label: 'Bänder geschmiert' },
      { key: 'lock', label: 'Schloss gewartet' },
      { key: 'other', label: 'Sonstige Arbeiten' },
    ],
  },
  damper: {
    key: 'damper',
    label: 'Brandschutzklappe',
    plural: 'Brandschutzklappen',
    prefix: 'BSK',
    norm: 'DIN EN 15650 / DIN 31051',
    intervalMonths: 12,
    checkpoints: cp([
      'Revisionsöffnung zugänglich und verschließbar',
      'Kennzeichnung und Klappennummer vorhanden',
      'Gehäuse und Anschlussstutzen unbeschädigt, dicht',
      'Einbau / Vermörtelung bzw. Einbausatz intakt',
      'Klappenblatt sauber, frei beweglich, ohne Bruch',
      'Dichtungen am Klappenblatt vollständig',
      'Thermische Auslöseeinrichtung intakt (Schmelzlot o. ä.)',
      'Auslösung per Hand schließt die Klappe vollständig',
      'Endlagenschalter melden AUF / ZU korrekt',
      ['Stellantrieb fährt in Sicherheitsstellung', 'bei motorischen Klappen'],
      'Federrücklauf ohne Verzögerung',
      'Anbindung an Leitsystem / Rauchauslöser geprüft',
      'Verschmutzung im Lüftungskanal nicht brandlastrelevant',
      'Klappe nach Prüfung in Betriebsstellung',
    ]),
    attributes: [
      { key: 'year', label: 'Baujahr', type: 'number' },
      { key: 'damperNo', label: 'Klappennummer' },
      { key: 'approval', label: 'Zulassungsnummer' },
      { key: 'size', label: 'Nennweite / Abmessung' },
      { key: 'rating', label: 'Feuerwiderstand', type: 'select', options: ['K30', 'K60', 'K90', 'EI 30 S', 'EI 60 S', 'EI 90 S'] },
      { key: 'actuator', label: 'Antrieb', type: 'select', options: ['Mechanisch', 'Federrücklaufmotor', 'Pneumatisch'] },
    ],
    maintenance: [
      { key: 'cleaned', label: 'Gereinigt' },
      { key: 'lubricated', label: 'Gelenke geschmiert' },
      { key: 'fuse', label: 'Auslöseelement ersetzt' },
      { key: 'seals', label: 'Dichtung ersetzt' },
      { key: 'other', label: 'Sonstige Arbeiten' },
    ],
  },
  extinguisher: {
    key: 'extinguisher',
    label: 'Feuerlöscher',
    plural: 'Feuerlöscher',
    prefix: 'FL',
    norm: 'DIN 14406-4',
    intervalMonths: 24,
    checkpoints: cp([
      'Standort gekennzeichnet und frei zugänglich',
      'Halterung fest, Griffhöhe angemessen',
      'Typenschild und Bedienungsanleitung lesbar',
      'Behälter ohne Korrosion, Dellen oder Risse',
      'Sicherung / Plombe vorhanden',
      'Druckanzeige im grünen Bereich bzw. Treibmittel geprüft',
      'Schlauch und Löschpistole unbeschädigt, frei',
      'Füllmenge per Wägung bestätigt',
      'Löschmittel in Ordnung (Sichtprüfung)',
      'Prüfplakette mit neuem Termin angebracht',
    ]),
    attributes: [
      { key: 'year', label: 'Baujahr', type: 'number' },
      { key: 'serial', label: 'Seriennummer' },
      { key: 'agent', label: 'Löschmittel', type: 'select', options: ['ABC-Pulver', 'Schaum', 'Wasser', 'CO₂', 'Fettbrand'] },
      { key: 'size', label: 'Füllmenge (kg/l)', type: 'number' },
      { key: 'classes', label: 'Brandklassen' },
    ],
    maintenance: [
      { key: 'pressure', label: 'Druckprüfung' },
      { key: 'valve', label: 'Ventil geprüft' },
      { key: 'hose', label: 'Schlauch ersetzt' },
      { key: 'seal', label: 'Neu plombiert' },
      { key: 'other', label: 'Sonstige Arbeiten' },
    ],
  },
  smoke_alarm: {
    key: 'smoke_alarm',
    label: 'Rauchwarnmelder',
    plural: 'Rauchwarnmelder',
    prefix: 'RWM',
    norm: 'DIN 14676',
    intervalMonths: 12,
    checkpoints: cp([
      'Melder am vorgesehenen Ort montiert',
      'Abstand zu Wänden, Ecken und Leuchten eingehalten',
      'Raucheindringöffnungen frei, nicht überklebt',
      'Gehäuse unbeschädigt, nicht überstrichen',
      'Prüftaste: Alarmsignal ertönt',
      'Batterie / Lebensdauer ausreichend',
      'Gerät innerhalb der Austauschfrist (meist 10 Jahre)',
      'Raumnutzung unverändert (kein Umbau, keine Trennwände)',
    ]),
    attributes: [
      { key: 'manufactured', label: 'Herstelldatum', type: 'date' },
      { key: 'serial', label: 'Seriennummer' },
      { key: 'battery', label: 'Batterie', type: 'select', options: ['10-Jahres-Lithium', 'Wechselbatterie 9V', 'Netzbetrieb'] },
    ],
    maintenance: [
      { key: 'battery', label: 'Batterie getauscht' },
      { key: 'cleaned', label: 'Gereinigt' },
      { key: 'replaced', label: 'Gerät ersetzt' },
      { key: 'other', label: 'Sonstige Arbeiten' },
    ],
  },
};

export const CATEGORY_LIST = Object.values(CATEGORIES);

export const INSPECTION_KINDS = {
  periodic: 'Wiederkehrende Prüfung',
  initial: 'Erstprüfung',
  after_repair: 'Nach Instandsetzung',
  after_change: 'Nach Änderung',
  special: 'Sonderprüfung',
} as const;
export type InspectionKind = keyof typeof INSPECTION_KINDS;

export const SEVERITIES = {
  low: 'Gering',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
} as const;
export type Severity = keyof typeof SEVERITIES;

export const ROLES = {
  owner: 'Inhaber',
  admin: 'Administrator',
  inspector: 'Prüfer',
  viewer: 'Lesezugriff',
} as const;
export type Role = keyof typeof ROLES;
