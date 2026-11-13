// Werkzeuge des MCP-Servers zur Anzeige in Einstellungen → API (Reihenfolge wie in worker/mcp-tools.ts).
// Ein Test (worker/mcp.test.ts) prüft, dass die Liste zu den Werkzeugen des Servers passt.
export const MCP_TOOLS: [name: string, purpose: string][] = [
  ['briefing', 'Lage, „Jetzt“-Liste, Autopilot seit dem letzten Mal'],
  ['search', 'Elemente, Objekte, Mängel, Aufgaben suchen'],
  ['list', 'Listen mit Filtern'],
  ['get', 'ein Element, Objekt, Mangel, eine Aufgabe oder Prüfung vollständig'],
  ['get_photo', 'Foto oder Grundriss als Bild ansehen'],
  ['capture', 'Mängel, Aufgaben, Notizen, Elemente auf einmal anlegen'],
  ['update_asset', 'Stammdaten nachtragen (z. B. vom Typenschild)'],
  ['update_tasks', 'Status, Zuständige, Frist, Kommentar'],
  ['update_defect', 'Mangel beheben oder wieder öffnen'],
  ['plan', 'Rundgänge ansehen, Wochenplanung auslösen'],
  ['tour', 'Rundgang vor Ort führen'],
  ['inspect', 'Prüfung ausfüllen und zur Unterschrift bereitlegen'],
  ['setup', 'Objekt, Gebäude und Elemente in einem Rutsch anlegen'],
  ['catalog', 'Fachwissen: Hersteller/Typen, typische Mängel, Begriffe'],
  ['autopilot', 'Autopilot ansehen, Schritt ausführen, rückgängig machen'],
  ['report', 'Kennzahlen für Zeitraum und Objekt'],
];

/** Fertige Befehle (MCP-Prompts) zur Anzeige. */
export const MCP_PROMPTS = ['Tagesbriefing', 'Diktat erfassen', 'Woche planen', 'Typenschilder nachtragen', 'Monatsbericht schreiben', 'Rundgang führen', 'Plan einrichten'];
