// Brandschutzbegehung: eigener Fragenkatalog. Rechtsgrundlagen sind als Orientierung angegeben.
import type { Severity } from './catalog';

export const BUILDING_TYPES = {
  general: 'Allgemein / Büro',
  school: 'Schule / Kita',
  care: 'Pflege / Gesundheit',
  assembly: 'Versammlungsstätte',
  gastro: 'Gastronomie',
  warehouse: 'Lager / Produktion',
  garage: 'Garage / Parkhaus',
} as const;
export type BuildingType = keyof typeof BUILDING_TYPES;

export interface WalkQuestion {
  id: string;
  section: string;
  text: string;
  basis: string;
  severity: Severity;
  /** leer = gilt für alle Gebäudearten */
  only?: BuildingType[];
}

export const WALK_SECTIONS = {
  esc: 'Flucht- und Rettungswege',
  exit: 'Notausgänge und Türen',
  barrier: 'Brand- und Rauchabschlüsse',
  ext: 'Löschmittel und Löschanlagen',
  alarm: 'Brandmeldung und Alarmierung',
  smoke: 'Rauch- und Wärmeabzug',
  sign: 'Kennzeichnung und Pläne',
  org: 'Organisation und Unterweisung',
  load: 'Brandlasten und Lagerung',
  elec: 'Elektrische Anlagen und Geräte',
  special: 'Nutzungsspezifisch',
} as const;
export type WalkSection = keyof typeof WALK_SECTIONS;

let n = 0;
const q = (section: WalkSection, text: string, basis: string, severity: Severity, only?: BuildingType[]): WalkQuestion => ({
  id: `${section}-${String(++n).padStart(2, '0')}`,
  section,
  text,
  basis,
  severity,
  only,
});

export const WALK_QUESTIONS: WalkQuestion[] = [
  q('esc', 'Rettungswege sind in voller Breite frei von Gegenständen', 'ASR A2.3', 'critical'),
  q('esc', 'Zweiter Rettungsweg vorhanden und erreichbar', 'MBO / LBO', 'critical'),
  q('esc', 'Treppenräume frei von Brandlasten und Abstellgut', 'MBO / LBO', 'high'),
  q('esc', 'Flure und Treppen ausreichend beleuchtet, Sicherheitsbeleuchtung funktionsfähig', 'ASR A3.4/7', 'high'),
  q('esc', 'Bodenbeläge ohne Stolperstellen', 'ASR A1.5', 'medium'),
  q('esc', 'Anleiterbare Stellen und Aufstellflächen der Feuerwehr frei', 'DIN 14090', 'high'),

  q('exit', 'Notausgänge von innen jederzeit ohne Hilfsmittel zu öffnen', 'ASR A2.3', 'critical'),
  q('exit', 'Panik- bzw. Notausgangsverschlüsse funktionieren', 'DIN EN 1125 / DIN EN 179', 'high'),
  q('exit', 'Türen im Rettungsweg schlagen in Fluchtrichtung auf (soweit gefordert)', 'ASR A2.3', 'medium'),
  q('exit', 'Bereiche vor Notausgängen außen frei, nicht zugeparkt', 'ASR A2.3', 'high'),

  q('barrier', 'Feuer- und Rauchschutztüren schließen selbsttätig, nicht verkeilt', 'DIN 4102-5 / MBO', 'critical'),
  q('barrier', 'Feststellanlagen nur mit zugelassener Auslösung', 'DIBt-Zulassung', 'high'),
  q('barrier', 'Leitungsdurchführungen in Brandwänden sichtbar abgeschottet', 'MLAR', 'high'),
  q('barrier', 'Brandschutzklappen zugänglich, Revisionsöffnungen frei', 'DIN EN 15650', 'medium'),
  q('barrier', 'Keine nachträglichen Öffnungen in raumabschließenden Wänden/Decken', 'MBO', 'high'),

  q('ext', 'Feuerlöscher in ausreichender Zahl vorhanden und gekennzeichnet', 'ASR A2.2', 'high'),
  q('ext', 'Feuerlöscher frei zugänglich und im Prüfintervall', 'ASR A2.2 / DIN 14406-4', 'high'),
  q('ext', 'Wandhydranten zugänglich, Schläuche in Ordnung', 'DIN 14462', 'high'),
  q('ext', 'Sprinkler- bzw. Löschanlage betriebsbereit, keine Abdeckung der Sprinklerköpfe', 'VdS / DIN EN 12845', 'critical'),
  q('ext', 'Löschdecke in Küchen vorhanden', 'ASR A2.2', 'medium', ['school', 'care', 'gastro']),

  q('alarm', 'Brandmeldeanlage ohne Störung, Wartung aktuell', 'DIN 14675', 'critical'),
  q('alarm', 'Handfeuermelder frei zugänglich und unbeschädigt', 'DIN 14675', 'high'),
  q('alarm', 'Alarmierungseinrichtungen hörbar in allen Bereichen', 'ASR A2.2', 'high'),
  q('alarm', 'Rauchmelder nicht abgedeckt oder demontiert', 'DIN 14676', 'high'),
  q('alarm', 'Feuerwehrschlüsseldepot und Laufkarten aktuell', 'DIN 14675', 'medium'),

  q('smoke', 'RWA-Öffnungen und Bedienstellen frei und gekennzeichnet', 'DIN 18232', 'high'),
  q('smoke', 'Rauchabzug im Treppenraum funktionsfähig', 'MBO / DIN 18232', 'high'),
  q('smoke', 'Nachströmöffnungen nicht verstellt', 'DIN 18232', 'medium'),

  q('sign', 'Rettungszeichen vollständig, sichtbar und ggf. beleuchtet', 'ASR A1.3', 'high'),
  q('sign', 'Flucht- und Rettungspläne aktuell und richtig ausgerichtet', 'ASR A2.3 / DIN ISO 23601', 'medium'),
  q('sign', 'Brandschutzzeichen für Löscher und Melder vorhanden', 'ASR A1.3', 'medium'),
  q('sign', 'Feuerwehrpläne vorhanden und aktuell', 'DIN 14095', 'medium'),

  q('org', 'Brandschutzordnung Teil A ausgehängt', 'DIN 14096', 'medium'),
  q('org', 'Brandschutzhelfer in ausreichender Zahl benannt', 'ASR A2.2 / DGUV 205-023', 'high'),
  q('org', 'Unterweisung der Beschäftigten dokumentiert (jährlich)', '§ 12 ArbSchG', 'medium'),
  q('org', 'Räumungsübung durchgeführt und dokumentiert', 'ASR A2.3', 'medium'),
  q('org', 'Prüfnachweise der sicherheitstechnischen Anlagen vorhanden', 'Prüfverordnung des Landes', 'high'),

  q('load', 'Keine Lagerung brennbarer Stoffe in Rettungswegen und Technikräumen', 'MBO / TRGS 800', 'high'),
  q('load', 'Entzündbare Flüssigkeiten nur in zugelassenen Schränken', 'TRGS 510', 'high'),
  q('load', 'Abfall regelmäßig entsorgt, Behälter nicht an Fassaden', 'VdS 2038', 'medium'),
  q('load', 'Lagerhöhe hält Abstand zu Sprinklern und Decke ein', 'VdS / DIN EN 12845', 'medium', ['warehouse']),

  q('elec', 'Elektroverteiler verschlossen und frei zugänglich', 'DIN VDE 0100', 'high'),
  q('elec', 'Keine beschädigten Leitungen oder Mehrfachsteckdosen in Reihe', 'DGUV V3', 'high'),
  q('elec', 'Ortsveränderliche Geräte geprüft (Prüfplakette)', 'DGUV V3', 'medium'),
  q('elec', 'Ladeplätze für Akkus/E-Fahrzeuge brandschutztechnisch geeignet', 'VdS 3103', 'medium'),

  q('special', 'Garderoben und Bastelarbeiten nicht in Fluren und Treppenräumen', 'Schulbau-Richtlinie', 'high', ['school']),
  q('special', 'Räumungskonzept für mobilitätseingeschränkte Personen vorhanden', 'Brandschutzkonzept', 'critical', ['care']),
  q('special', 'Stationstüren schließen bei Alarm selbsttätig', 'Krankenhausbau-Verordnung', 'high', ['care']),
  q('special', 'Bestuhlungsplan eingehalten, Gänge frei', 'VStättVO', 'critical', ['assembly']),
  q('special', 'Dekorationen schwer entflammbar (Nachweis)', 'VStättVO', 'high', ['assembly']),
  q('special', 'Fettabscheider und Abluftanlagen der Küche gereinigt', 'VDI 2052', 'high', ['gastro']),
  q('special', 'Gasabsperrung bekannt und zugänglich', 'DVGW', 'high', ['gastro']),
  q('special', 'Gabelstapler-Ladezone mit Abstand zu Brandlasten', 'DGUV / VdS', 'medium', ['warehouse']),
  q('special', 'CO-Warnanlage und Lüftung funktionsfähig', 'Garagenverordnung', 'critical', ['garage']),
  q('special', 'Keine Lagerung in Stellplätzen und Fahrgassen', 'Garagenverordnung', 'high', ['garage']),
];

export function questionsFor(type: BuildingType): WalkQuestion[] {
  return WALK_QUESTIONS.filter((x) => !x.only || x.only.includes(type));
}

export const WALK_INTERVAL_MONTHS = 12;
