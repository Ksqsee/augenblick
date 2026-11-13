// Korpus für den Regel-Parser (shared/smart.ts): Sätze, wie Monteure sie vor Ort sprechen bzw. wie die Spracherkennung
// sie liefert (Füllwörter, „T 30“, „O G“, „Erd Geschoss“, Zahlwörter, „drei Stück“, „3x“) – je mit erwartetem Ergebnis.
// Läuft zweimal: mit den Begriffen der Katalog-Grundausstattung (so im Browser) und ohne (so im Worker /ai/parse).
// Was die Regeln nach ehrlichem Bemühen nicht schaffen, steht als `todo` mit Grund – nicht als angepasste Erwartung.
import { afterAll, describe, expect, it } from 'vitest';
import { CATALOG_SEED_DEFECTS, CATALOG_SEED_TERMS, CATEGORIES } from './catalog';
import { type CaptureCategory, type CaptureItem, type CaptureKind, parseCapture } from './smart';
import { setClientVocab } from './vocab';

const cats: CaptureCategory[] = Object.values(CATEGORIES);
const SEED = { terms: CATALOG_SEED_TERMS.map((t, n) => ({ id: `t${n}`, ...t })), defects: CATALOG_SEED_DEFECTS.map((d, n) => ({ id: `d${n}`, ...d })) };
/** Mittwoch, 11.11.2026, 9 Uhr */
const now = new Date(2026, 10, 11, 9).getTime();

const FD = 'fire_door';
const HO = 'hold_open';
const EX = 'extinguisher';
const SM = 'smoke_alarm';
const DA = 'damper';

type Attrs = Record<string, string | boolean>;
interface Exp {
  kind: CaptureKind;
  count?: number;
  category?: string;
  floor?: string;
  location?: string;
  manufacturer?: string;
  model?: string;
  attributes?: Attrs;
  /** feste Nummer beim Anlegen (Bereich: erste Nummer, Anzahl = Länge) */
  number?: number | null;
  /** Vorschau zeigt „bitte prüfen“ */
  unsure?: boolean;
  /** Mangel/Aufgabe an Element Nr. … */
  ref?: number | null;
  assetCode?: string | null;
  dueInDays?: number | null;
  severity?: string;
}
type Mode = 'assets' | 'findings';
interface Case {
  text: string;
  mode: Mode;
  expect: Exp[];
  todo?: string;
}

const el = (count: number, category: string, floor = '', location = '', more: Partial<Exp> = {}): Exp => ({ kind: 'asset', count, category, floor, location, ...more });
const def = (more: Partial<Exp> = {}): Exp => ({ kind: 'defect', ...more });
const task = (more: Partial<Exp> = {}): Exp => ({ kind: 'task', ...more });
const note = (): Exp => ({ kind: 'note' });
const T30 = { rating: 'T30' };
const RS = { smoke: true };

const A = (text: string, ...expect: Exp[]): Case => ({ text, mode: 'assets', expect });
const F = (text: string, ...expect: Exp[]): Case => ({ text, mode: 'findings', expect });
const todo = (text: string, mode: Mode, reason: string): Case => ({ text, mode, expect: [], todo: reason });

const ELEMENTS: Case[] = [
  // Befund der Designleitung (v5): drei Elemente, Orte und Hersteller je Element
  A(
    'Im dritten OG Raum 306 eine Feuerschutztür von Westag und im ersten OG Treppenhaus eine Feststellanlage und zwei Rauchschutztüren von Schüco',
    el(1, FD, '3. OG', 'Raum 306', { manufacturer: 'Westag' }),
    el(1, HO, '1. OG', 'Treppenhaus'),
    el(2, FD, '1. OG', 'Treppenhaus', { manufacturer: 'Schüco', attributes: RS }),
  ),
  A('drei Feuerschutztüren im EG Flur und eine Feststellanlage', el(3, FD, 'EG', 'Flur'), el(1, HO, 'EG', 'Flur')),
  A('Erdgeschoss Treppenhaus Nord zwei Rauchschutztüren T30 von Hörmann', el(2, FD, 'EG', 'Treppenhaus Nord', { manufacturer: 'Hörmann', attributes: { ...T30, ...RS } })),
  A('ähm im zweiten Stock Flur links drei Brandschutztüren', el(3, FD, '2. OG', 'Flur links')),
  A('Tür 36 im EG Flur', el(1, FD, 'EG', 'Flur', { number: 36 })),
  A('Türen 12 bis 15 im ersten OG', el(4, FD, '1. OG', '', { number: 12 })),
  A('Feuerschutztüren Nummer 36 bis 40 im Treppenhaus Süd', el(5, FD, '', 'Treppenhaus Süd', { number: 36 })),
  A('eine RS-Tür im Keller vor dem Heizraum', el(1, FD, 'UG', 'Vor dem Heizraum', { attributes: RS })),
  A('eine Stahltür T30 im Heizungsraum', el(1, FD, '', 'Heizungsraum', { attributes: { ...T30, doorType: 'Stahltür' } })),
  A(
    'zwei Alu-Rohrrahmentüren T30 RS im Foyer von Schörghuber',
    el(2, FD, '', 'Foyer', { manufacturer: 'Schörghuber', attributes: { ...T30, ...RS, doorType: 'Alu-Rohrrahmentür' } }),
  ),
  A('Doppeltür T90 im Untergeschoss zur Tiefgarage', el(1, FD, 'UG', 'Zur Tiefgarage', { attributes: { rating: 'T90', leaves: '2-flügelig' } })),
  A('drei Feststellanlagen im EG', el(3, HO, 'EG')),
  A('FSA im zweiten OG Flur Ost', el(1, HO, '2. OG', 'Flur Ost')),
  A('eine Haftmagnet-Anlage am Treppenhaus im ersten Obergeschoss', el(1, HO, '1. OG', 'Treppenhaus', { attributes: { holdDevice: 'Haftmagnet' } })),
  A('Feuerschutztür mit Feststellanlage im Flur EG', el(1, FD, 'EG', 'Flur', { attributes: { holdOpen: true } })),
  A('zwei T30-Türen mit Obentürschließer und Absenkdichtung im Keller', el(2, FD, 'UG', '', { attributes: { ...T30, closer: true, dropSeal: true } })),
  A(
    'Wohnungseingangstür mit Spion, T30 RS, dritter Stock links',
    el(1, FD, '3. OG', 'Links', { attributes: { ...T30, ...RS, peephole: true, doorType: 'Wohnungseingangstür' } }),
  ),
  A('5 Feuerlöscher im Lager', el(5, EX, '', 'Lager')),
  A('zwei Löscher sechs Kilo Pulver EG Werkstatt', el(2, EX, 'EG', 'Werkstatt', { attributes: { size: '6', agent: 'ABC-Pulver' } })),
  A('dreißig Rauchwarnmelder in den Wohnungen', el(30, SM, '', 'Wohnungen')),
  A('einundzwanzig Rauchmelder im zweiten OG', el(21, SM, '2. OG')),
  A('fünfundvierzig Rauchwarnmelder mit Zehnjahresbatterie', el(45, SM, '', '', { attributes: { battery: '10-Jahres-Lithium' } })),
  // mehr als 50 auf einmal legt das Sheet nicht an – die Vorschau sagt es
  A('hundert Melder im Bürotrakt', el(50, SM, '', 'Bürotrakt', { unsure: true })),
  A('drei Stück Brandschutzklappen im Technikraum UG', el(3, DA, 'UG', 'Technikraum')),
  A('BSK Nummer 4 Lüftungszentrale', el(1, DA, '', 'Lüftungszentrale', { number: 4 })),
  A('3x RWM Büro 2. OG', el(3, SM, '2. OG', 'Büro')),
  A('Feuerschutztür T 30 im Erd Geschoss Flur', el(1, FD, 'EG', 'Flur', { attributes: T30 })),
  A('zwei Türen t dreißig im O G Treppenhaus', el(2, FD, 'OG', 'Treppenhaus', { attributes: T30 })),
  A('Im Erdgeschoss eine Tür zum Hof und im Keller zwei Türen zur Tiefgarage', el(1, FD, 'EG', 'Zum Hof'), el(2, FD, 'UG', 'Zur Tiefgarage')),
  A('Dachgeschoss: eine Feuerschutztür zum Dachboden', el(1, FD, 'DG', 'Zum Dachboden')),
  A('In der Tiefgarage zwei Feuerschutztore', el(2, FD, 'TG')),
  A('Zwischengeschoss Technik eine T90 Tür', el(1, FD, 'ZG', 'Technik', { attributes: { rating: 'T90' } })),
  A('im Hochparterre zwei Feuerlöscher', el(2, EX, 'EG')),
  A('1. Stock Küche ein Feuerlöscher und ein Rauchmelder', el(1, EX, '1. OG', 'Küche'), el(1, SM, '1. OG', 'Küche')),
  A('erster Stock Flur drei Rauchmelder, zweiter Stock Flur drei Rauchmelder', el(3, SM, '1. OG', 'Flur'), el(3, SM, '2. OG', 'Flur')),
  A('zwei Feuerschutztüren von Novoferm im Kellergang', el(2, FD, '', 'Kellergang', { manufacturer: 'Novoferm' })),
  A('eine Feuerschutztür Hersteller Hörmann Typ H3 im EG', el(1, FD, 'EG', '', { manufacturer: 'Hörmann', model: 'H3' })),
  A('Fabrikat Teckentrup, zwei T30 Türen, Flur 1. OG', el(2, FD, '1. OG', 'Flur', { manufacturer: 'Teckentrup', attributes: T30 })),
  A('im EG Flur Tür 1 bis Tür 4', el(4, FD, 'EG', 'Flur', { number: 1 })),
  A('Rauchschutztür zweiflügelig Treppenhaus West drittes OG', el(1, FD, '3. OG', 'Treppenhaus West', { attributes: { ...RS, leaves: '2-flügelig' } })),
  A('einflügelige T30-Tür Archiv', el(1, FD, '', 'Archiv', { attributes: { ...T30, leaves: '1-flügelig' } })),
  A('zwo Brandschutztüren und eine Feststellanlage im Flur vorm Aufzug', el(2, FD, '', 'Flur vorm Aufzug'), el(1, HO, '', 'Flur vorm Aufzug')),
  A('Feststelleinrichtung mit zwei Rauchmeldern und Handtaster im EG', el(1, HO, 'EG', '', { attributes: { detectors: '2', manualRelease: true } })),
  A(
    'Im Keller: Heizraum eine T90-Tür, Elektroraum eine T30-Tür',
    el(1, FD, 'UG', 'Heizraum', { attributes: { rating: 'T90' } }),
    el(1, FD, 'UG', 'Elektroraum', { attributes: T30 }),
  ),
  A('Feuerlöscher drei Stück Werkstatt', el(3, EX, '', 'Werkstatt')),
  A('eine Brandschutzklappe K90 im Schacht 3. OG', el(1, DA, '3. OG', 'Schacht', { attributes: { rating: 'K90' } })),
  A('vier Feuerschutzabschlüsse in der TG', el(4, FD, 'TG')),
  A('T30 RS Tür Flur Nord EG', el(1, FD, 'EG', 'Flur Nord', { attributes: { ...T30, ...RS } })),
  A('Und dann noch im DG zwei Rauchschutztüren', el(2, FD, 'DG', '', { attributes: RS })),
  A('ein Feuerlöscher', el(1, EX)),
  A('Feststellanlage', el(1, HO)),
  A(
    'zwei Feuerschutztüren von Hörmann und zwei von Schörghuber im 1. OG',
    el(2, FD, '1. OG', '', { manufacturer: 'Hörmann' }),
    el(2, FD, '1. OG', '', { manufacturer: 'Schörghuber' }),
  ),
  A('Elektroraum UG Brandschutztür T90 Hersteller Hörmann Baujahr 2015', el(1, FD, 'UG', 'Elektroraum', { manufacturer: 'Hörmann', attributes: { rating: 'T90', year: '2015' } })),
  A('zwei Rauchschutztüren mit Feststellanlage im Treppenhaus', el(2, FD, '', 'Treppenhaus', { attributes: { ...RS, holdOpen: true } })),
  A('Rauchschutztür und Feststellanlage im Treppenhaus 2. OG', el(1, FD, '2. OG', 'Treppenhaus', { attributes: RS }), el(1, HO, '2. OG', 'Treppenhaus')),
  A('Im Flur hinten eine Feuerschutztür, die ist von Hörmann', el(1, FD, '', 'Flur hinten', { manufacturer: 'Hörmann' })),
  A('äh zwei Feuerschutztüren im äh Erdgeschoss', el(2, FD, 'EG')),
  A('Raum 1.12 eine T30-Tür', el(1, FD, '', 'Raum 1.12', { attributes: T30 })),
  A('Gebäude B, EG, drei Feuerlöscher', el(3, EX, 'EG', 'Gebäude B')),
  // Rest, der keinem Feld zugeordnet werden kann: Standort sauber, Zeile „bitte prüfen“
  A('neun Feuerschutztüren im Treppenhaus, jeweils eine pro Etage', el(9, FD, '', 'Treppenhaus', { unsure: true })),
  A('zwei FST und eine FSA im UG Schleuse', el(2, FD, 'UG', 'Schleuse'), el(1, HO, 'UG', 'Schleuse')),
  A('Feuerschutztür EI2 30 Sa im Flur', el(1, FD, '', 'Flur', { attributes: { rating: 'EI2 30', smoke: true } })),
  A('Drehflügeltür T30 im EG', el(1, FD, 'EG', '', { attributes: { ...T30, doorType: 'Drehflügeltür' } })),
  A('zwei Schiebetore T30 in der Halle', el(2, FD, '', 'Halle', { attributes: { ...T30, doorType: 'Schiebetor' } })),
  A('eine Brandschutztür im 10. OG Technik', el(1, FD, '10. OG', 'Technik')),
  A('im zehnten Stock zwei Rauchschutztüren', el(2, FD, '10. OG', '', { attributes: RS })),
  A('im Dritten Flur eine T30 Tür', el(1, FD, '3. OG', 'Flur', { attributes: T30 })),
  A('Erdgeschoss Raum E.04 Tür 7', el(1, FD, 'EG', 'Raum E.04', { number: 7 })),
  todo('Im Keller zwei Türen, also eine zweiflügelig und eine einflügelig', 'assets', 'Teilmengen („eine … und eine …“) werden nicht auf Elemente mit eigenen Stammdaten verteilt'),
  A('Also im Keller zwei T30-Türen, eine davon zweiflügelig', el(2, FD, 'UG', '', { attributes: T30, unsure: true })),
  A('Schaumlöscher sechs Liter Küche', el(1, EX, '', 'Küche', { attributes: { agent: 'Schaum', size: '6' } })),
  A('zwei CO2-Löscher im Serverraum', el(2, EX, '', 'Serverraum', { attributes: { agent: 'CO₂' } })),
  A('Tür 36 bis 38 Flur Ost zweites Obergeschoss', el(3, FD, '2. OG', 'Flur Ost', { number: 36 })),
  A('Feststellanlage an der Tür zum Treppenhaus im 1. OG', el(1, HO, '1. OG', 'Tür zum Treppenhaus')),
  A('Kellergeschoss drei Stahltüren T90 von Hörmann', el(3, FD, 'UG', '', { manufacturer: 'Hörmann', attributes: { rating: 'T90', doorType: 'Stahltür' } })),
  A('eine Tür', el(1, FD)),
  A('zwei Rauchschutztüren und eine Feststellanlage. Im Keller noch zwei Feuerlöscher.', el(2, FD, '', '', { attributes: RS }), el(1, HO), el(2, EX, 'UG')),
  A('drei Feuerschutztüren im EG Flur. Zwei Feuerlöscher.', el(3, FD, 'EG', 'Flur'), el(2, EX, 'EG', 'Flur')),
  A(
    'Treppenhaus Nord: Tür 1, Tür 2 und Tür 3',
    el(1, FD, '', 'Treppenhaus Nord', { number: 1 }),
    el(1, FD, '', 'Treppenhaus Nord', { number: 2 }),
    el(1, FD, '', 'Treppenhaus Nord', { number: 3 }),
  ),
  A('zwei Brandschutztüren, Hersteller Hörmann, T30, Raum 204', el(2, FD, '', 'Raum 204', { manufacturer: 'Hörmann', attributes: T30 })),
];

const DEFECTS: Case[] = [
  F('Tür 36 schließt nicht', def({ ref: 36 })),
  F('Nummer 12 Dichtung fehlt', def({ ref: 12 })),
  F('FSA 2 löst nicht aus', def({ ref: 2 })),
  F('Bei Tür 7 ist der Obentürschließer kaputt', def({ ref: 7 })),
  F('Tür 14 im zweiten OG wird mit Keil offen gehalten', def({ ref: 14 })),
  F('Feuerlöscher im Keller abgelaufen', def()),
  F('Rauchmelder im Flur piept', def()),
  F('die Tür vom Heizraum schleift am Boden', def()),
  F('Haftmagnet hält nicht mehr', def()),
  F('Feststellanlage löst bei Prüfung nicht aus, dringend', def({ severity: 'high' })),
  F('Dichtung an der Doppeltür im EG eingerissen', def()),
  F('Glasscheibe in der Tür zum Treppenhaus hat einen Sprung', def()),
  F('Schließfolgeregler funktioniert nicht', def({ severity: 'critical' })),
  F('Türblatt verzogen, schleift', def()),
  F('Keil unter der Tür im 3. OG', def()),
  F('Panikschloss geht schwer', def()),
  F('Kennzeichnungsschild fehlt an Tür 3', def({ ref: 3 })),
  F('Tür Nummer 5 fällt nicht ins Schloss', def({ ref: 5 })),
  F('an der Tür 8 ist die Absenkdichtung defekt', def({ ref: 8 })),
  F('Feuerlöscher Plombe gebrochen', def()),
  F('Prüfplakette am Löscher abgelaufen', def()),
  F('Tür steht offen, Keil drunter, sofort entfernen', def({ severity: 'critical' })),
  F('Notausgang zugestellt mit Paletten', def()),
  F('Obentürschließer ölt', def()),
  F('Schloss rastet nicht ein', def()),
  F('Bodenspalt zu groß bei Tür 22', def({ ref: 22 })),
  F('Rauchschalter verschmutzt', def()),
  F('Bänder ausgeschlagen', def()),
  F('Zarge hat Rost', def()),
  F('Türschließer zu schwach eingestellt', def()),
  F('Beschilderung Fluchtweg fehlt im 2. OG', def()),
  F('Bei FST-003 fehlt die Dichtung', def({ assetCode: 'FST-003' })),
  todo('Tür 12 und Tür 13 schließen nicht', 'findings', 'Ein Mangel an zwei Elementen wird nicht verdoppelt; es entsteht ein Mangel an Tür 12'),
  F('Rauchmelder im Kinderzimmer fehlt komplett', def({ severity: 'high' })),
  F('FSA im EG Flur gibt nicht frei bei Stromausfall', def()),
  F('Tür 4 im Keller wird mit Holzkeil festgehalten', def({ ref: 4 })),
  // auch im Modus „Elemente“ bleibt ein Mangel ein Mangel
  A('Tür 9 klemmt', def({ ref: 9 })),
];

const TASKS: Case[] = [
  F('Hausmeister informieren bis Freitag', task({ dueInDays: 2 })),
  F('Ersatzteile für Tür 36 bestellen', task({ ref: 36 })),
  F('Angebot einholen für neue Dichtungen', task()),
  F('morgen Termin mit dem Hausmeister machen', task({ dueInDays: 1 })),
  F('Schlüssel für den Technikraum besorgen', task()),
  F('Fachfirma für die Feststellanlage beauftragen, nächste Woche', task({ dueInDays: 7 })),
  F('Kunden anrufen wegen Zugang Dachboden', task()),
  F('in zwei Wochen nochmal nachfassen', task({ dueInDays: 14 })),
  F('Rauchmelder nachbestellen, drei Stück', task()),
  F('bis Montag Prüfbuch klären', task({ dueInDays: 5 })),
  F('Erinnerung: Wartungsvertrag verlängern', task()),
  F('in 3 Tagen Nachprüfung Tür 7', task({ dueInDays: 3, ref: 7 })),
  F('Notiz: Schlüssel liegt beim Pförtner', note()),
  F('Hinweis Zugang nur mit Begleitung', note()),
];

const MIXED: Case[] = [
  F('Drei Feuerschutztüren im EG Flur, die mittlere schließt nicht. Hausmeister bis Freitag informieren.', el(3, FD, 'EG', 'Flur'), def(), task({ dueInDays: 2 })),
  F('Tür 4 klemmt und Hausmeister informieren', def({ ref: 4 }), task()),
  F('Im Keller zwei neue Feuerlöscher, einer davon ohne Plombe', el(2, EX, 'UG'), def()),
  F('Feststellanlage im EG löst nicht aus, Fachfirma beauftragen', def(), task()),
  A('zwei Rauchmelder im Flur anlegen und der im Bad piept', el(2, SM, '', 'Flur'), def()),
  A('Im 1. OG drei Rauchschutztüren aufgenommen, bei einer fehlt die Dichtung', el(3, FD, '1. OG', '', { attributes: RS }), def()),
  A('Notiz: Kunde will Angebot. Zwei Feuerlöscher im Lager.', note(), el(2, EX, '', 'Lager')),
  F('Tür 36 schließt nicht, Tür 37 Dichtung fehlt', def({ ref: 36 }), def({ ref: 37 })),
  F('Also zwei Feuerschutztüren im EG und die Tür zum Hof schleift', el(2, FD, 'EG'), def()),
  A('drei Rauchmelder im Flur, einer davon ist defekt', el(3, SM, '', 'Flur'), def()),
  F('Feuerlöscher im Flur fehlt, außerdem zwei neue Rauchmelder im Lager', def(), el(2, SM, '', 'Lager')),
  A('Zwei Feuerschutztüren im EG aufgenommen. Tür 1 schließt nicht. Bis morgen Fachfirma anrufen.', el(2, FD, 'EG'), def({ ref: 1 }), task({ dueInDays: 1 })),
];

/** Zweiter Durchgang: nach den Regeln geschrieben, aber vor dem ersten Lauf festgelegt (Abweichungen siehe todo) */
const BLIND: Case[] = [
  A('Im Erdgeschoss links neben dem Haupteingang zwei Feuerlöscher sechs Kilo', el(2, EX, 'EG', 'Links neben dem Haupteingang', { attributes: { size: '6' } })),
  A('drittes Obergeschoss, Flur, vier Rauchwarnmelder', el(4, SM, '3. OG', 'Flur')),
  A(
    'Treppenhaus B im Keller eine Rauchschutztür von Hörmann und im EG eine T30 Tür von Novoferm',
    el(1, FD, 'UG', 'Treppenhaus B', { manufacturer: 'Hörmann', attributes: RS }),
    el(1, FD, 'EG', '', { manufacturer: 'Novoferm', attributes: T30 }),
  ),
  A(
    'zweiter Stock: Tür 21, Tür 22, Tür 23, alle T30 mit Obentürschließer',
    el(1, FD, '2. OG', '', { number: 21, attributes: { ...T30, closer: true } }),
    el(1, FD, '2. OG', '', { number: 22, attributes: { ...T30, closer: true } }),
    el(1, FD, '2. OG', '', { number: 23, attributes: { ...T30, closer: true } }),
  ),
  A('Feuerschutztüren 101 bis 110 Bauteil A', el(10, FD, '', 'Bauteil A', { number: 101 })),
  A('eine Feststellanlage mit Deckenmelder Haus 2 Erdgeschoss', el(1, HO, 'EG', 'Haus 2', { attributes: { trigger: 'Deckenmelder' } })),
  A('sieben Feuerlöscher fünf davon Schaum', el(7, EX, '', '', { unsure: true })),
  F('Feuerlöscher im Treppenhaus 1. OG hängt zu hoch', def()),
  F('Brandschutztür zum Keller fällt nicht zu', def()),
  F('Tür 18 Glasleiste lose', def({ ref: 18 })),
  F('Rauchmelder Wohnung 4 abgelaufen', def({ ref: null })),
  F('im Heizraum fehlt der Feuerlöscher komplett', def({ severity: 'high' })),
  F('Feststellanlage Nummer 3 Melder verschmutzt', def({ ref: 3 })),
  F('Dichtung bei Tür sieben fehlt', def({ ref: 7 })),
  F('Hausmeister soll die Keile entfernen', task()),
  F('Prüfbuch fehlt, bis Ende der Woche nachreichen', def(), task()),
  F('Termin für Nachprüfung am Dienstag', task({ dueInDays: 6 })),
  F('Notiz Schlüsseltresor Code beim Kunden', note()),
  A('zwei Rauchschutztüren Treppenhaus Ost jeweils mit Feststellanlage', el(2, FD, '', 'Treppenhaus Ost', { attributes: { ...RS, holdOpen: true } })),
  A('im EG drei Feuerlöscher, im ersten OG zwei und im zweiten OG zwei', el(3, EX, 'EG'), el(2, EX, '1. OG'), el(2, EX, '2. OG')),
  A('Tiefgarage Ebene minus eins zwei Feuerschutztore', el(2, FD, 'TG', 'Ebene minus eins')),
  A(
    'Feuerschutztür T30-RS zweiflügelig mit Feststellanlage Hersteller Schörghuber Flur EG',
    el(1, FD, 'EG', 'Flur', { manufacturer: 'Schörghuber', attributes: { ...T30, ...RS, leaves: '2-flügelig', holdOpen: true } }),
  ),
  A('äh ja also zwei Brandschutzklappen in der Lüftungszentrale Dach', el(2, DA, '', 'Lüftungszentrale Dach')),
  A('Rauchmelder Kinderzimmer, Rauchmelder Schlafzimmer, Rauchmelder Flur', el(1, SM, '', 'Kinderzimmer'), el(1, SM, '', 'Schlafzimmer'), el(1, SM, '', 'Flur')),
  A('Ein Feuerlöscher Küche, zwei Feuerlöscher Werkstatt', el(1, EX, '', 'Küche'), el(2, EX, '', 'Werkstatt')),
  A('Rauchschutztür im ersten OG Treppenhaus mit Spion', el(1, FD, '1. OG', 'Treppenhaus', { attributes: { ...RS, peephole: true } })),
  A('Feuerschutztür Nummer zwölf im Keller', el(1, FD, 'UG', '', { number: 12 })),
  F('Feuerlöscher hängt nicht an der Wand sondern steht auf dem Boden', def()),
];

const CORPUS = [...ELEMENTS, ...DEFECTS, ...TASKS, ...MIXED, ...BLIND];

/** Vergleich je Eintrag: Elemente vollständig (Standort, Hersteller, Stammdaten exakt), sonst nur die genannten Felder. */
function shape(i: CaptureItem, e: Exp) {
  if (e.kind === 'asset')
    return {
      kind: i.kind,
      count: i.count,
      category: i.category,
      floor: i.floor,
      location: i.location,
      manufacturer: i.manufacturer ?? '',
      model: i.model ?? '',
      attributes: i.attributes ?? {},
      number: i.number ?? null,
      unsure: !!i.unsure,
    };
  const out: Record<string, unknown> = { kind: i.kind };
  if (e.ref !== undefined) out.ref = i.elementRef?.number ?? null;
  if (e.assetCode !== undefined) out.assetCode = i.assetCode;
  if (e.dueInDays !== undefined) out.dueInDays = i.dueInDays;
  if (e.severity !== undefined) out.severity = i.severity;
  return out;
}
const expected = (e: Exp) =>
  e.kind === 'asset'
    ? { manufacturer: '', model: '', attributes: {}, number: null, unsure: false, floor: '', location: '', ...e }
    : Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined));

describe('Korpus', () => {
  it('hat mindestens 120 Sätze', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(120);
  });
});

describe.each([
  ['mit Begriffen des Katalogs (Browser)', true],
  ['ohne Begriffe (Worker)', false],
])('Korpus %s', (_, vocab) => {
  const run = (c: Case) => {
    // Vokabular je Fall setzen: describe.each sammelt erst alle Fälle, ausgeführt wird danach
    setClientVocab(vocab ? SEED : { terms: [], defects: [] });
    const items = parseCapture(c.text, { categories: cats, now, prefer: c.mode });
    expect(items.map((i, n) => (c.expect[n] ? shape(i, c.expect[n]) : { kind: i.kind, title: i.title }))).toEqual(c.expect.map(expected));
  };
  for (const c of CORPUS) {
    if (c.todo) it.todo(`${c.text} – ${c.todo}`);
    else it(`[${c.mode === 'assets' ? 'Elemente' : 'Mängel'}] ${c.text}`, () => run(c));
  }
  afterAll(() => setClientVocab({ terms: [], defects: [] }));
});
