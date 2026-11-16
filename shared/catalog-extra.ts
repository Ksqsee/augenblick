// Nachtrag zur Katalog-Grundausstattung (Plan v6 F6): typische Mängel für Feuerlöscher, Rauchwarnmelder und
// Brandschutzklappen – eigene Formulierungen. Neue Workspaces bekommen sie mit der Grundausstattung, bestehende genau
// einmal (tenants.catalog_extra_at, worker/catalog.ts); gelöschte Einträge kommen nicht zurück.
import type { CatalogDefect, Severity } from './catalog';

const d = (category: string, title: string, severity: Severity, measure: string, synonyms: string[] = []): Omit<CatalogDefect, 'id'> => ({
  title,
  synonyms,
  severity,
  measure,
  category,
});

export const CATALOG_EXTRA_DEFECTS: Omit<CatalogDefect, 'id'>[] = [
  // Feuerlöscher
  d('extinguisher', 'Plombe fehlt oder ist beschädigt', 'high', 'Gerät prüfen lassen und neu plombieren', ['Plombe fehlt', 'Sicherung gebrochen', 'Siegel fehlt']),
  d('extinguisher', 'Druckanzeige außerhalb des grünen Bereichs', 'high', 'Gerät instand setzen oder austauschen', ['Manometer im roten Bereich', 'Druck zu niedrig', 'kein Druck']),
  d('extinguisher', 'Löscher nicht an seinem Platz', 'high', 'Gerät zurück an den gekennzeichneten Standort bringen', ['Löscher fehlt', 'Feuerlöscher weg', 'Standort leer']),
  d('extinguisher', 'Zugang zum Löscher verstellt', 'high', 'Zugang freiräumen', ['Löscher zugestellt', 'Löscher verdeckt']),
  d('extinguisher', 'Prüfplakette abgelaufen', 'medium', 'Wartung durch Sachkundige beauftragen', ['Prüfdatum überschritten', 'Wartung überfällig']),
  d('extinguisher', 'Schlauch oder Düse beschädigt', 'medium', 'Schlauch bzw. Löschpistole tauschen', ['Schlauch rissig', 'Düse verstopft']),
  d('extinguisher', 'Halterung lose oder fehlt', 'low', 'Halterung fest montieren', ['Wandhalter locker']),
  d('extinguisher', 'Hinweisschild fehlt', 'low', 'Brandschutzzeichen anbringen', ['Schild fehlt', 'Kennzeichnung fehlt']),
  // Rauchwarnmelder
  d('smoke_alarm', 'Melder löst bei Prüfung nicht aus', 'critical', 'Melder sofort tauschen', ['Prüftaste ohne Signal', 'kein Alarm', 'Rauchmelder reagiert nicht']),
  d('smoke_alarm', 'Batterie schwach (Warnsignal)', 'high', 'Batterie bzw. Melder tauschen', ['Melder piept', 'Rauchmelder piept', 'Batteriewarnung']),
  d('smoke_alarm', 'Melder fehlt oder demontiert', 'critical', 'Melder neu montieren', ['Rauchmelder fehlt', 'Melder abgebaut']),
  d('smoke_alarm', 'Raucheindringöffnungen verschmutzt oder abgedeckt', 'high', 'Melder reinigen bzw. Abdeckung entfernen', ['Melder verschmutzt', 'Rauchmelder überstrichen', 'Melder abgeklebt']),
  d('smoke_alarm', 'Austauschfrist überschritten', 'medium', 'Melder ersetzen (Lebensdauer abgelaufen)', ['Melder zu alt', 'älter als zehn Jahre']),
  d('smoke_alarm', 'Montageort ungeeignet', 'low', 'Melder nach Herstellerangabe versetzen', ['zu nah an der Wand', 'falsch montiert']),
  // Brandschutzklappen
  d('damper', 'Klappe schließt nicht vollständig', 'critical', 'Klappe instand setzen lassen, bis dahin Ersatzmaßnahme festlegen', ['Klappe klemmt', 'Brandschutzklappe schließt nicht']),
  d('damper', 'Auslöseeinrichtung defekt', 'critical', 'Schmelzlot bzw. Auslöser tauschen', ['Schmelzlot defekt', 'Auslöser löst nicht aus']),
  d('damper', 'Stellantrieb ohne Funktion', 'high', 'Antrieb prüfen und tauschen', ['Motor defekt', 'Antrieb fährt nicht']),
  d('damper', 'Endschalter meldet falsch', 'medium', 'Endschalter justieren oder tauschen', ['Rückmeldung falsch', 'Endlage nicht gemeldet']),
  d('damper', 'Revisionsöffnung nicht zugänglich', 'medium', 'Zugang schaffen und kennzeichnen', ['Revisionsklappe verbaut', 'kein Zugang zur Klappe']),
  d('damper', 'Verschmutzung im Klappengehäuse', 'medium', 'Klappe reinigen', ['Klappe verschmutzt', 'Staub im Gehäuse']),
  d('damper', 'Kennzeichnung fehlt', 'low', 'Klappe beschriften', ['Schild fehlt', 'keine Kennzeichnung']),
];
