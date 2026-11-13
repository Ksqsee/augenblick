// Prüfkataloge – eigene Formulierungen, orientiert an den einschlägigen Normen
// (DIN 14677, DIN EN 15650 / DIN 31051, DIN 14406-4, DIN 14676).

export type BuiltinCategory =
  | "fire_door"
  | "damper"
  | "extinguisher"
  | "smoke_alarm"
  | "hold_open";
/** Eingebaute Kategorie oder eigener Typ des Workspaces (Schlüssel „c_…“). */
export type Category = string;

export interface Checkpoint {
  id: string;
  label: string;
  hint?: string;
  /** Gruppe im Prüfablauf (eingeklappte Abschnitte); ohne Angabe ordnet die Oberfläche nach Schlüsselwörtern */
  group?: string;
}

export interface AttributeField {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "boolean";
  options?: string[];
}

/** Eine Prüfart mit eigener Frist, z. B. „Innere Prüfung“ alle 5 Jahre. „main“ ist die Hauptprüfung. */
export interface ScheduleDef {
  key: string;
  label: string;
  intervalMonths: number;
  optional: boolean;
  checkpoints?: Checkpoint[];
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
  schedules: ScheduleDef[];
  color?: string;
  custom?: boolean;
  base?: string | null;
}

const cp = (labels: (string | [string, string])[]): Checkpoint[] =>
  labels.map((l, i) =>
    Array.isArray(l)
      ? { id: `p${i + 1}`, label: l[0], hint: l[1] }
      : { id: `p${i + 1}`, label: l },
  );

/** Prüfpunkte der Reihe nach in Gruppen einteilen: [[Anzahl, Name], …] */
const grouped = (
  sizes: [number, string][],
  cps: Checkpoint[],
): Checkpoint[] => {
  const names = sizes.flatMap(([n, g]) => Array<string>(n).fill(g));
  return cps.map((c, i) => (names[i] ? { ...c, group: names[i] } : c));
};

export const CATEGORIES: Record<BuiltinCategory, CategoryDef> = {
  fire_door: {
    key: "fire_door",
    label: "Feuerschutztür",
    plural: "Feuerschutztüren",
    prefix: "FST",
    norm: "DIN 14677",
    intervalMonths: 12,
    checkpoints: cp([
      [
        "Kennzeichnungsschild vorhanden und lesbar",
        "Zulassung / Hersteller / Baujahr",
      ],
      "Türblatt ohne Beschädigung, Verzug oder nachträgliche Bohrungen",
      "Zarge fest verankert, Anschlussfuge geschlossen",
      "Bänder und Sicherungsstifte fest, kein Spiel",
      "Obentürschließer schließt die Tür aus jeder Öffnungsstellung",
      "Schließfolgeregelung bei zweiflügeligen Türen wirksam",
      "Schloss rastet selbsttätig ein, Falle gängig",
      "Drücker / Panikbeschlag vollständig und funktionsfähig",
      "Dichtungen (Rauch- und Brandschutz) vollständig, nicht übermalt",
      "Verglasung unbeschädigt, Glasleisten fest",
      "Keine unzulässigen Keile, Haken oder Festhaltungen",
      ["Feststellanlage löst bei Auslösung aus", "nur wenn vorhanden"],
      "Rauchmelder der Feststellanlage gereinigt / im Prüfzeitraum",
      "Schwellenbereich frei, Bodenspalt im zulässigen Bereich",
      "Freilauf / Schließgeschwindigkeit plausibel eingestellt",
      "Abschließende Funktionsprüfung bestanden",
    ]),
    attributes: [
      { key: "year", label: "Baujahr", type: "number" },
      { key: "approval", label: "Zulassungsnummer" },
      {
        key: "rating",
        label: "Feuerwiderstand",
        type: "select",
        options: ["T30", "T60", "T90", "EI2 30", "EI2 60", "EI2 90"],
      },
      { key: "smoke", label: "Rauchschutz (RS)", type: "boolean" },
      {
        key: "leaves",
        label: "Flügel",
        type: "select",
        options: ["1-flügelig", "2-flügelig"],
      },
      { key: "holdOpen", label: "Feststellanlage", type: "boolean" },
      { key: "doorType", label: "Türtyp / Bauart" },
      { key: "dropSeal", label: "Absenkdichtung", type: "boolean" },
      { key: "closer", label: "Obentürschließer", type: "boolean" },
      { key: "peephole", label: "Türspion", type: "boolean" },
    ],
    schedules: [
      {
        key: "main",
        label: "Jährliche Prüfung und Wartung",
        intervalMonths: 12,
        optional: false,
      },
      {
        key: "visual",
        label: "Monatliche Sichtkontrolle",
        intervalMonths: 1,
        optional: true,
        checkpoints: cp([
          "Tür schließt selbsttätig ins Schloss",
          "Keine Keile oder unzulässigen Festhaltungen",
          "Dichtungen sichtbar vollständig",
          "Türblatt und Zarge ohne neue Schäden",
          "Feststellanlage gibt bei Prüfauslösung frei",
        ]),
      },
    ],
    maintenance: [
      { key: "closer", label: "Schließer nachjustiert" },
      { key: "seals", label: "Dichtungen getauscht" },
      { key: "hinges", label: "Bänder geschmiert" },
      { key: "lock", label: "Schloss gewartet" },
      { key: "other", label: "Sonstige Arbeiten" },
    ],
  },
  damper: {
    key: "damper",
    label: "Brandschutzklappe",
    plural: "Brandschutzklappen",
    prefix: "BSK",
    norm: "DIN EN 15650 / DIN 31051",
    intervalMonths: 12,
    checkpoints: cp([
      "Revisionsöffnung zugänglich und verschließbar",
      "Kennzeichnung und Klappennummer vorhanden",
      "Gehäuse und Anschlussstutzen unbeschädigt, dicht",
      "Einbau / Vermörtelung bzw. Einbausatz intakt",
      "Klappenblatt sauber, frei beweglich, ohne Bruch",
      "Dichtungen am Klappenblatt vollständig",
      "Thermische Auslöseeinrichtung intakt (Schmelzlot o. ä.)",
      "Auslösung per Hand schließt die Klappe vollständig",
      "Endlagenschalter melden AUF / ZU korrekt",
      ["Stellantrieb fährt in Sicherheitsstellung", "bei motorischen Klappen"],
      "Federrücklauf ohne Verzögerung",
      "Anbindung an Leitsystem / Rauchauslöser geprüft",
      "Verschmutzung im Lüftungskanal nicht brandlastrelevant",
      "Klappe nach Prüfung in Betriebsstellung",
    ]),
    attributes: [
      { key: "year", label: "Baujahr", type: "number" },
      { key: "damperNo", label: "Klappennummer" },
      { key: "approval", label: "Zulassungsnummer" },
      { key: "size", label: "Nennweite / Abmessung" },
      {
        key: "rating",
        label: "Feuerwiderstand",
        type: "select",
        options: ["K30", "K60", "K90", "EI 30 S", "EI 60 S", "EI 90 S"],
      },
      {
        key: "actuator",
        label: "Antrieb",
        type: "select",
        options: ["Mechanisch", "Federrücklaufmotor", "Pneumatisch"],
      },
    ],
    schedules: [
      {
        key: "main",
        label: "Funktionsprüfung",
        intervalMonths: 12,
        optional: false,
      },
    ],
    maintenance: [
      { key: "cleaned", label: "Gereinigt" },
      { key: "lubricated", label: "Gelenke geschmiert" },
      { key: "fuse", label: "Auslöseelement ersetzt" },
      { key: "seals", label: "Dichtung ersetzt" },
      { key: "other", label: "Sonstige Arbeiten" },
    ],
  },
  extinguisher: {
    key: "extinguisher",
    label: "Feuerlöscher",
    plural: "Feuerlöscher",
    prefix: "FL",
    norm: "DIN 14406-4",
    intervalMonths: 24,
    checkpoints: cp([
      "Standort gekennzeichnet und frei zugänglich",
      "Halterung fest, Griffhöhe angemessen",
      "Typenschild und Bedienungsanleitung lesbar",
      "Behälter ohne Korrosion, Dellen oder Risse",
      "Sicherung / Plombe vorhanden",
      "Druckanzeige im grünen Bereich bzw. Treibmittel geprüft",
      "Schlauch und Löschpistole unbeschädigt, frei",
      "Füllmenge per Wägung bestätigt",
      "Löschmittel in Ordnung (Sichtprüfung)",
      "Prüfplakette mit neuem Termin angebracht",
    ]),
    attributes: [
      { key: "year", label: "Baujahr", type: "number" },
      { key: "serial", label: "Seriennummer" },
      {
        key: "agent",
        label: "Löschmittel",
        type: "select",
        options: ["ABC-Pulver", "Schaum", "Wasser", "CO₂", "Fettbrand"],
      },
      { key: "size", label: "Füllmenge (kg/l)", type: "number" },
      { key: "classes", label: "Brandklassen" },
    ],
    schedules: [
      {
        key: "main",
        label: "Instandhaltung",
        intervalMonths: 24,
        optional: false,
      },
      {
        key: "inner",
        label: "Innere Prüfung",
        intervalMonths: 60,
        optional: true,
        checkpoints: cp([
          "Behälter drucklos gemacht und geöffnet",
          "Innenwand ohne Korrosion oder Ablagerungen",
          "Steigrohr und Ventil gereinigt und gängig",
          "Löschmittel ersetzt bzw. aufbereitet",
          "Dichtungen erneuert",
          "Behälter wieder befüllt, Treibmittel geprüft",
        ]),
      },
      {
        key: "strength",
        label: "Festigkeitsprüfung",
        intervalMonths: 120,
        optional: true,
        checkpoints: cp([
          "Wasserdruckprüfung mit vorgeschriebenem Prüfdruck",
          "Keine bleibende Verformung",
          "Keine Undichtigkeit",
          "Prüfdatum am Behälter eingeschlagen",
        ]),
      },
    ],
    maintenance: [
      { key: "pressure", label: "Druckprüfung" },
      { key: "valve", label: "Ventil geprüft" },
      { key: "hose", label: "Schlauch ersetzt" },
      { key: "seal", label: "Neu plombiert" },
      { key: "other", label: "Sonstige Arbeiten" },
    ],
  },
  smoke_alarm: {
    key: "smoke_alarm",
    label: "Rauchwarnmelder",
    plural: "Rauchwarnmelder",
    prefix: "RWM",
    norm: "DIN 14676",
    intervalMonths: 12,
    checkpoints: cp([
      "Melder am vorgesehenen Ort montiert",
      "Abstand zu Wänden, Ecken und Leuchten eingehalten",
      "Raucheindringöffnungen frei, nicht überklebt",
      "Gehäuse unbeschädigt, nicht überstrichen",
      "Prüftaste: Alarmsignal ertönt",
      "Batterie / Lebensdauer ausreichend",
      "Gerät innerhalb der Austauschfrist (meist 10 Jahre)",
      "Raumnutzung unverändert (kein Umbau, keine Trennwände)",
    ]),
    attributes: [
      { key: "manufactured", label: "Herstelldatum", type: "date" },
      { key: "serial", label: "Seriennummer" },
      {
        key: "battery",
        label: "Batterie",
        type: "select",
        options: ["10-Jahres-Lithium", "Wechselbatterie 9V", "Netzbetrieb"],
      },
    ],
    schedules: [
      {
        key: "main",
        label: "Jährliche Inspektion",
        intervalMonths: 12,
        optional: false,
      },
    ],
    maintenance: [
      { key: "battery", label: "Batterie getauscht" },
      { key: "cleaned", label: "Gereinigt" },
      { key: "replaced", label: "Gerät ersetzt" },
      { key: "other", label: "Sonstige Arbeiten" },
    ],
  },
  hold_open: {
    key: "hold_open",
    label: "Feststellanlage",
    plural: "Feststellanlagen",
    prefix: "FSA",
    norm: "DIN 14677",
    intervalMonths: 12,
    checkpoints: grouped(
      [
        [2, "Dokumentation"],
        [4, "Abschluss und Schließmittel"],
        [2, "Feststellvorrichtung"],
        [5, "Auslösung und Melder"],
        [4, "Funktionsprüfung"],
        [3, "Umfeld und Abschluss"],
      ],
      cp([
        [
          "Anlage gekennzeichnet, Zulassung und Abnahme belegt",
          "Schild an der Anlage, Abnahmebescheinigung",
        ],
        "Prüfbuch bzw. Wartungsnachweis vorhanden und fortgeschrieben",
        "Zugehöriger Abschluss (Tür, Tor) ohne erkennbare Schäden",
        "Abschluss schließt nach der Freigabe selbsttätig und vollständig",
        "Schließmittel (Türschließer, Federband) wirkt, Schließgeschwindigkeit angemessen",
        [
          "Schließfolge bei zweiflügeligen Abschlüssen eingehalten",
          "nur wenn vorhanden",
        ],
        "Feststellvorrichtung (Haftmagnet, Gleitschiene) fest montiert und unbeschädigt",
        "Haltekraft ausreichend, Gegenplatte sauber und richtig ausgerichtet",
        "Auslösevorrichtung vollständig, Melder an den vorgesehenen Stellen",
        "Melder sauber, Raucheintritt frei, nicht überstrichen oder abgedeckt",
        "Melder innerhalb der Austauschfrist, keine Verschmutzungs- oder Störmeldung",
        "Handauslösetaster vorhanden, gekennzeichnet und gut erreichbar",
        "Energieversorgung und Leitungen intakt und gesichert",
        [
          "Funktionsprüfung Simulation: Prüfrauch löst die Freigabe aus",
          "Prüfaerosol nach Herstellerangabe",
        ],
        "Funktionsprüfung Handauslösung: Taster gibt den Abschluss frei",
        "Funktionsprüfung Energieausfall: Unterbrechung der Versorgung gibt frei",
        "Störung oder Entfernen eines Melders führt zur Freigabe",
        "Schließbereich frei, keine zusätzlichen Festhaltungen",
        "Verbaute Komponenten entsprechen der Zulassung",
        "Abschließende Funktionsprüfung bestanden, Prüfbuch ergänzt",
      ]),
    ),
    attributes: [
      { key: "year", label: "Baujahr", type: "number" },
      { key: "approval", label: "Zulassungsnummer" },
      {
        key: "holdDevice",
        label: "Feststellvorrichtung",
        type: "select",
        options: [
          "Haftmagnet",
          "Freilauftürschließer",
          "Gleitschiene mit Feststellung",
          "Federband mit Feststellung",
        ],
      },
      {
        key: "trigger",
        label: "Auslösevorrichtung",
        type: "select",
        options: [
          "Rauchschalter im Sturz",
          "Deckenmelder",
          "Sturz- und Deckenmelder",
        ],
      },
      { key: "detectors", label: "Anzahl Melder", type: "number" },
      { key: "manualRelease", label: "Handauslösetaster", type: "boolean" },
      { key: "door", label: "Zugehöriger Abschluss" },
    ],
    schedules: [
      {
        key: "main",
        label: "Jährliche Prüfung und Wartung",
        intervalMonths: 12,
        optional: false,
      },
      {
        key: "visual",
        label: "Monatliche Sichtkontrolle",
        intervalMonths: 1,
        optional: true,
        checkpoints: cp([
          "Handauslösung gibt frei, Abschluss schließt ins Schloss",
          "Melder sichtbar unbeschädigt und frei",
          "Schließbereich frei von Hindernissen",
          "Keine Stör- oder Verschmutzungsanzeige",
        ]),
      },
    ],
    maintenance: [
      { key: "detectorCleaned", label: "Melder gereinigt" },
      { key: "detectorReplaced", label: "Melder getauscht" },
      { key: "magnet", label: "Haftmagnet und Gegenplatte gereinigt" },
      { key: "closer", label: "Schließer nachjustiert" },
      { key: "component", label: "Komponente getauscht" },
      { key: "vendor", label: "Herstellerwartung durchgeführt" },
      { key: "other", label: "Sonstige Arbeiten" },
    ],
  },
};

export const isBuiltin = (k: string): k is BuiltinCategory => k in CATEGORIES;

/** Hauptprüfung immer zuerst; „main“ übernimmt Intervall und Prüfpunkte der Kategorie. */
export function schedulesOf(def: CategoryDef): ScheduleDef[] {
  const list = def.schedules?.length
    ? def.schedules
    : [
        {
          key: "main",
          label: "Prüfung",
          intervalMonths: def.intervalMonths,
          optional: false,
        },
      ];
  return list.map((s) =>
    s.key === "main"
      ? {
          ...s,
          intervalMonths: def.intervalMonths,
          checkpoints: def.checkpoints,
        }
      : s,
  );
}

export const CATEGORY_COLORS = [
  "slate",
  "orange",
  "blue",
  "red",
  "green",
  "violet",
  "teal",
  "amber",
] as const;

export const INSPECTION_KINDS = {
  periodic: "Wiederkehrende Prüfung",
  initial: "Erstprüfung",
  after_repair: "Nach Instandsetzung",
  after_change: "Nach Änderung",
  special: "Sonderprüfung",
} as const;
export type InspectionKind = keyof typeof INSPECTION_KINDS;
/** Eigene Prüfungsart des Workspaces (Schlüssel „k_…“). */
export interface CustomKind {
  key: string;
  label: string;
}
export const isCustomKindKey = (k: string) => /^k_[a-z0-9]{4,24}$/.test(k);
/** Bezeichnung einer eingebauten oder eigenen Prüfungsart. */
export function kindLabel(key: string, custom: CustomKind[] = []): string {
  return (
    (INSPECTION_KINDS as Record<string, string>)[key] ??
    custom.find((k) => k.key === key)?.label ??
    key
  );
}

/** Anlass einer Prüfung. Berichtigung ersetzt eine abgeschlossene Prüfung, Nachprüfung kontrolliert die Mängelbehebung. */
export const INSPECTION_PURPOSES = {
  regular: "Regelprüfung",
  correction: "Berichtigung",
  follow_up: "Nachprüfung",
} as const;
export type InspectionPurpose = keyof typeof INSPECTION_PURPOSES;

/** Anlass einer Brandschutzbegehung. */
export const WALK_PURPOSES = {
  regular: "Regelmäßige Begehung",
  extraordinary: "Außerordentliche Begehung",
  after_change: "Begehung nach Änderung",
  follow_up: "Nachbegehung",
} as const;
export type WalkPurpose = keyof typeof WALK_PURPOSES;

export const SEVERITIES = {
  low: "Gering",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
} as const;
export type Severity = keyof typeof SEVERITIES;

export const ROLES = {
  owner: "Inhaber",
  admin: "Administrator",
  inspector: "Prüfer",
  viewer: "Lesezugriff",
} as const;
export type Role = keyof typeof ROLES;

// ---------- Katalog je Workspace: Produkte, typische Mängel, Begriffe (Migration 0023, worker/catalog.ts) ----------

/** Hersteller/Typ mit Vorgabewerten für die Stammdaten (Typ wählen füllt das Elementformular). */
export interface CatalogProduct {
  id: string;
  manufacturer: string;
  model: string;
  /** Elementart (Schlüssel) oder leer = alle */
  category: string;
  /** Vorgabewerte der Stammdaten, z. B. {rating: "T30", smoke: true} */
  defaults: Record<string, string | number | boolean | null>;
  approval: string;
  note: string;
}

/** Typischer Mangel mit Schwere und Maßnahme; Synonyme helfen beim Erkennen im Diktat. */
export interface CatalogDefect {
  id: string;
  title: string;
  synonyms: string[];
  severity: Severity;
  measure: string;
  /** Elementart (Schlüssel) oder leer = alle */
  category: string;
}

/** Abkürzung bzw. Fachbegriff → Bedeutung (z. B. OTS → Obentürschließer). */
export interface CatalogTerm {
  id: string;
  term: string;
  meaning: string;
}

/** Höchstzahl je Liste und Workspace. */
export const CATALOG_LIMITS = {
  products: 2000,
  defects: 1000,
  terms: 500,
} as const;

/** Grundausstattung für neue Workspaces – eigene Formulierungen. */
export const CATALOG_SEED_TERMS: Omit<CatalogTerm, "id">[] = [
  { term: "OTS", meaning: "Obentürschließer" },
  { term: "RS", meaning: "Rauchschutz" },
  { term: "OL", meaning: "Oberlicht" },
  { term: "ST", meaning: "Seitenteil" },
  { term: "FSA", meaning: "Feststellanlage" },
  { term: "FST", meaning: "Feuerschutztür" },
  { term: "HM", meaning: "Haftmagnet" },
  { term: "HAT", meaning: "Handauslösetaster" },
  { term: "SFR", meaning: "Schließfolgeregler" },
  { term: "GLS", meaning: "Gleitschiene" },
  { term: "BSK", meaning: "Brandschutzklappe" },
  { term: "RWM", meaning: "Rauchwarnmelder" },
  { term: "abZ", meaning: "allgemeine bauaufsichtliche Zulassung" },
  { term: "abP", meaning: "allgemeines bauaufsichtliches Prüfzeugnis" },
  { term: "DIBt", meaning: "Deutsches Institut für Bautechnik" },
];

const seedDefect = (
  category: string,
  title: string,
  severity: Severity,
  measure: string,
  synonyms: string[] = [],
): Omit<CatalogDefect, "id"> => ({
  title,
  synonyms,
  severity,
  measure,
  category,
});

export const CATALOG_SEED_DEFECTS: Omit<CatalogDefect, "id">[] = [
  seedDefect(
    "fire_door",
    "Tür schließt nicht vollständig",
    "high",
    "Obentürschließer einstellen, bei Verschleiß tauschen",
    [
      "fällt nicht ins Schloss",
      "Schließer zu schwach",
      "Obentürschließer schließt nicht",
    ],
  ),
  seedDefect(
    "fire_door",
    "Tür mit Keil oder Haken offen gehalten",
    "high",
    "Festhaltung entfernen, Nutzer unterweisen; bei Bedarf zugelassene Feststellanlage vorsehen",
    ["verkeilt", "Keil untergelegt", "festgebunden"],
  ),
  seedDefect(
    "fire_door",
    "Dichtung beschädigt oder fehlend",
    "medium",
    "Dichtung nach Herstellerangabe ersetzen",
    ["Dichtung fehlt", "Rauchschutzdichtung lose", "Dichtung gerissen"],
  ),
  seedDefect(
    "fire_door",
    "Dichtung überstrichen",
    "medium",
    "Überstrichene Dichtung ersetzen",
    ["Dichtung übermalt", "Dichtung lackiert"],
  ),
  seedDefect(
    "fire_door",
    "Absenkdichtung ohne Funktion",
    "medium",
    "Absenkdichtung einstellen oder ersetzen",
    ["Bodendichtung senkt nicht ab", "Bodenspalt zu groß"],
  ),
  seedDefect(
    "fire_door",
    "Falle rastet nicht ein",
    "high",
    "Schloss und Schließblech justieren, bei Bedarf Schloss tauschen",
    ["Schloss klemmt", "Falle klemmt"],
  ),
  seedDefect(
    "fire_door",
    "Türblatt beschädigt oder nachträglich durchbohrt",
    "high",
    "Instandsetzung nur nach Herstellervorgabe, sonst Türblatt tauschen",
    ["Loch im Türblatt", "Bohrung im Türblatt", "Türblatt verzogen"],
  ),
  seedDefect(
    "fire_door",
    "Zarge lose oder Anschlussfuge offen",
    "high",
    "Zarge nachbefestigen, Fuge mit zugelassenem Material schließen",
    ["Fuge offen", "Zarge locker"],
  ),
  seedDefect(
    "fire_door",
    "Bänder mit Spiel",
    "medium",
    "Bänder nachstellen oder tauschen, schmieren",
    ["Band ausgeschlagen", "Tür hängt"],
  ),
  seedDefect(
    "fire_door",
    "Kennzeichnungsschild fehlt oder unleserlich",
    "low",
    "Zulassung klären, Kennzeichnung über den Hersteller nachrüsten",
    ["Typenschild fehlt", "Schild unleserlich"],
  ),
  seedDefect(
    "fire_door",
    "Schließfolgeregelung wirkungslos",
    "high",
    "Schließfolgeregler einstellen oder tauschen",
    ["Gangflügel schließt zuerst", "Schließfolge falsch"],
  ),
  seedDefect(
    "fire_door",
    "Verglasung gesprungen",
    "high",
    "Glas durch zugelassenes Brandschutzglas ersetzen",
    ["Scheibe gesprungen", "Glas Riss"],
  ),
  seedDefect(
    "fire_door",
    "Nicht zugelassenes Bauteil nachgerüstet",
    "medium",
    "Bauteil entfernen, zugelassenes Teil einbauen",
    ["Türspion nachgerüstet", "fremder Beschlag"],
  ),
  seedDefect(
    "fire_door",
    "Drücker oder Panikbeschlag defekt",
    "medium",
    "Beschlag instand setzen oder tauschen",
    ["Drücker lose", "Panikstange klemmt"],
  ),
  seedDefect(
    "fire_door",
    "Schwenkbereich zugestellt",
    "high",
    "Schwenkbereich freiräumen",
    ["Tür verstellt", "Tür blockiert"],
  ),
  seedDefect(
    "hold_open",
    "Feststellanlage löst bei Rauch nicht aus",
    "critical",
    "Abschluss geschlossen halten, Melder und Steuerung sofort instand setzen",
    ["Melder löst nicht aus", "Rauchschalter reagiert nicht"],
  ),
  seedDefect(
    "hold_open",
    "Handauslösetaster ohne Funktion",
    "high",
    "Taster und Verdrahtung prüfen und instand setzen",
    ["Handtaster defekt", "Taster löst nicht aus"],
  ),
  seedDefect(
    "hold_open",
    "Keine Freigabe bei Energieausfall",
    "critical",
    "Netzteil und Haftmagnet prüfen, Anlage bis zur Instandsetzung außer Betrieb nehmen",
    ["hält bei Stromausfall", "Netzausfall ohne Freigabe"],
  ),
  seedDefect(
    "hold_open",
    "Melder verschmutzt",
    "medium",
    "Melder reinigen oder tauschen",
    ["Verschmutzungsanzeige", "Melder staubig"],
  ),
  seedDefect(
    "hold_open",
    "Melder über der Austauschfrist",
    "medium",
    "Melder gegen zugelassenes Ersatzteil tauschen",
    ["Melder zu alt", "Austauschfrist überschritten"],
  ),
  seedDefect(
    "hold_open",
    "Haltekraft des Haftmagneten zu gering",
    "low",
    "Haftmagnet und Gegenplatte reinigen, ausrichten oder tauschen",
    ["Magnet hält nicht", "Gegenplatte verschmutzt"],
  ),
  seedDefect(
    "hold_open",
    "Prüfbuch oder Abnahme fehlt",
    "medium",
    "Abnahmeprüfung nachholen und Prüfbuch anlegen",
    ["keine Abnahme", "Prüfbuch fehlt", "keine Dokumentation"],
  ),
  seedDefect(
    "hold_open",
    "Nicht zugelassene Komponente verbaut",
    "high",
    "Komponente gemäß Zulassung tauschen und Abnahme wiederholen",
    ["Fremdkomponente", "falscher Melder"],
  ),
  seedDefect(
    "hold_open",
    "Melder fehlt oder falsch angeordnet",
    "high",
    "Melder nach Zulassung ergänzen bzw. versetzen",
    ["Deckenmelder fehlt", "Sturzmelder fehlt"],
  ),
  seedDefect(
    "hold_open",
    "Herstellerwartung überfällig",
    "medium",
    "Wartung durch Hersteller oder autorisierten Fachbetrieb beauftragen",
    ["Wartung überfällig"],
  ),
];
