// Suche in normaler Sprache: „überfällige Feuerlöscher im Haupthaus“ → Filter für die Elementliste.
// Regelbasiert, ohne KI – läuft sofort im Browser.

export interface QueryContext {
  categories: { key: string; label: string; plural?: string }[];
  properties: { id: string; name: string }[];
}

export interface ParsedQuery {
  target: 'assets' | 'defects' | 'tasks';
  due?: 'overdue' | 'soon' | 'never' | 'defects';
  category?: string;
  propertyId?: string;
  /** Teile, die als Text gesucht werden (z. B. Standort „2. OG“) */
  rest: string;
  /** lesbare Zusammenfassung der erkannten Filter */
  chips: string[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFC');
const STOP = new Set(['alle', 'zeige', 'zeig', 'mir', 'die', 'der', 'das', 'den', 'dem', 'im', 'in', 'am', 'an', 'von', 'vom', 'mit', 'und', 'für', 'bei', 'welche', 'sind', 'ist', 'gibt', 'es', 'noch', 'bitte', 'liste', 'elemente', 'element', 'objekt', 'gebäude']);

const DUE: [RegExp, NonNullable<ParsedQuery['due']>, string][] = [
  [/über\s?fällig\w*|ueberfaellig\w*|abgelaufen\w*|verpasst\w*/, 'overdue', 'Überfällig'],
  [/nie\s+geprüft|ungeprüft\w*|noch\s+nicht\s+geprüft|erstprüfung/, 'never', 'Nie geprüft'],
  [/bald\s+fällig|demnächst|(diese|nächste)[nmr]?\s+(woche|monat)|in\s+kürze/, 'soon', 'Bald fällig'],
  [/mit\s+mängeln|mangelhaft\w*|beanstandet\w*/, 'defects', 'Mit Mängeln'],
];

/** Wortstamm (für Einzahl/Mehrzahl): „feuerlöscher“, „brandschutztüren“ → „brandschutztür“ */
const stem = (w: string) => w.replace(/(innen|en|er|e|n|s)$/, '');

export function parseQuery(text: string, ctx: QueryContext): ParsedQuery | null {
  let t = ` ${norm(text)} `;
  const chips: string[] = [];
  let due: ParsedQuery['due'];
  for (const [re, v, label] of DUE) {
    if (re.test(t)) {
      due = v;
      chips.push(label);
      t = t.replace(re, ' ');
      break;
    }
  }
  let target: ParsedQuery['target'] = 'assets';
  if (/\bmängel\b|\bmangel\b/.test(t)) {
    target = 'defects';
    t = t.replace(/\bmängel\b|\bmangel\b/, ' ');
  } else if (/\baufgaben?\b|\btodos?\b/.test(t)) {
    target = 'tasks';
    t = t.replace(/\baufgaben?\b|\btodos?\b/, ' ');
  }
  const words = t.split(/[^\p{L}\p{N}.-]+/u).filter(Boolean);
  let category: string | undefined;
  for (const c of ctx.categories) {
    const names = [c.label, c.plural ?? ''].filter(Boolean).map((x) => stem(norm(x)));
    const hit = words.find((w) => w.length >= 4 && names.some((n) => stem(w) === n || (n.length >= 6 && stem(w).startsWith(n.slice(0, Math.max(6, n.length - 2))))));
    if (hit) {
      category = c.key;
      chips.push(c.plural ?? c.label);
      words.splice(words.indexOf(hit), 1);
      break;
    }
  }
  let propertyId: string | undefined;
  let best = 0;
  for (const p of ctx.properties) {
    const pw = norm(p.name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 4 && !STOP.has(w));
    const score = words.filter((w) => w.length >= 4 && pw.some((x) => x === w || stem(x) === stem(w))).length;
    if (score > best) {
      best = score;
      propertyId = p.id;
    }
  }
  if (propertyId) {
    const p = ctx.properties.find((x) => x.id === propertyId)!;
    const pw = norm(p.name).split(/[^\p{L}\p{N}]+/u);
    chips.push(p.name);
    for (let i = words.length - 1; i >= 0; i--) if (pw.some((x) => x === words[i] || stem(x) === stem(words[i]))) words.splice(i, 1);
  }
  const rest = words.filter((w) => !STOP.has(w)).join(' ');
  if (!due && !category && !propertyId && target === 'assets') return null;
  return { target, due, category, propertyId, rest, chips };
}

/** Ziel-URL in der App für eine erkannte Anfrage. */
export function queryUrl(q: ParsedQuery): string {
  if (q.target === 'defects') return '/maengel';
  if (q.target === 'tasks') return '/aufgaben';
  const p = new URLSearchParams();
  if (q.due) p.set('status', q.due);
  if (q.category) p.set('kategorie', q.category);
  if (q.propertyId) p.set('objekt', q.propertyId);
  if (q.rest) p.set('q', q.rest);
  return `/elemente?${p}`;
}
