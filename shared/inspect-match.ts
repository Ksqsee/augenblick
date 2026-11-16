// Gesprochenes einer Prüfung zuordnen (Plan v6): Mangel → Prüfpunkt nur bei klarem Treffer (A5), Wartungsarbeiten mit
// Synonymen (C4) und Widersprüche zwischen Arbeit und Mangel (C6). Regeln ohne KI, läuft im Browser und im Worker.
import { type CatalogDefect, foldText, matchCatalogDefects } from './vocab';

// ---------- Wörter ----------
/** Wörter, die in fast jedem Mangel stehen und nichts über den Prüfpunkt sagen. */
const GENERIC = new Set([
  'beschaedigt', 'beschaedigung', 'beschaedigungen', 'fehlt', 'fehlen', 'fehlend', 'fehlende', 'fehlender', 'defekt', 'defekte',
  'kaputt', 'lose', 'locker', 'gerissen', 'mangel', 'mangelhaft', 'nicht', 'kein', 'keine', 'keinen', 'ohne', 'vorhanden',
  'vollstaendig', 'unvollstaendig', 'funktioniert', 'funktionsfaehig', 'schlecht', 'falsch', 'richtig', 'oder', 'und', 'mit',
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'ist', 'sind', 'wird', 'werden', 'bei', 'beim',
  'nach', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'ganz', 'mehr', 'sehr', 'stark', 'leicht', 'etwas', 'teilweise',
  'tuer', 'tuere', 'tueren', 'element', 'anlage', 'geprueft', 'pruefung', 'erkennbare', 'erkennbaren', 'unzulaessig',
  'unzulaessige', 'unzulaessigen', 'zulaessig', 'zulaessigen',
]);

const content = (s: string) =>
  foldText(s)
    .split(' ')
    .filter((w) => w.length >= 4 && !GENERIC.has(w));

/** Zwei Wörter meinen dasselbe: gleicher Anfang (6 Zeichen) oder eines steckt im anderen (Komposita, ab 5 Zeichen). */
const sameWord = (a: string, b: string) =>
  a === b ||
  (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6)) ||
  (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));

// ---------- Prüfpunkt ----------
export interface CheckpointAssignment {
  /** zugeordneter Prüfpunkt oder null (nichts passt oder unklar) */
  id: string | null;
  /** mehrere Punkte passen gleich gut – nicht zugeordnet, nachfragen */
  unsure: boolean;
  /** beste Kandidaten (für die Rückfrage) */
  candidates: { id: string; label: string; score: number }[];
}

/**
 * Prüfpunkt zu einem Mangeltext. Grundlage sind die inhaltstragenden Wörter des Texts (ohne „beschädigt“, „fehlt“ …),
 * ergänzt um passende Katalog-Mängel der Art. Zugeordnet wird nur, wenn der beste Punkt klar besser ist als der zweite –
 * sonst lieber kein Prüfpunkt und eine Rückfrage (Plan v6, A5: „ein falscher Eintrag ist schlimmer als eine Rückfrage“).
 */
export function assignCheckpoint(
  text: string,
  checkpoints: { id: string; label: string }[] = [],
  opts: { defects?: CatalogDefect[]; category?: string | null } = {},
): CheckpointAssignment {
  const words = new Set(content(text));
  // Katalog-Mangel der Art: seine Synonyme beschreiben denselben Befund mit anderen Worten
  for (const m of matchCatalogDefects(text, opts.defects ?? [], { category: opts.category ?? null, limit: 1 }))
    for (const p of [m.defect.title, ...(m.defect.synonyms ?? [])]) for (const w of content(p)) words.add(w);
  if (!words.size || !checkpoints.length) return { id: null, unsure: false, candidates: [] };
  const scored = checkpoints
    .map((c) => {
      const cw = content(c.label);
      // gleiches Wort zählt doppelt, gleicher Anfang bzw. Wortteil einfach („schließt“ ≠ „Schließfolge“)
      const score = [...words].reduce((n, w) => n + (cw.includes(w) ? 2 : cw.some((x) => sameWord(w, x)) ? 1 : 0), 0);
      return { id: c.id, label: c.label, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best) return { id: null, unsure: false, candidates: [] };
  if (second && second.score >= best.score) return { id: null, unsure: true, candidates: scored.slice(0, 3) };
  return { id: best.id, unsure: false, candidates: scored.slice(0, 3) };
}

// ---------- Wartungsarbeiten ----------
/** Tätigkeitswörter → gemeinsamer Begriff („gewechselt“ = „getauscht“ = „ersetzt“ …) */
const ACTIONS: [RegExp, string][] = [
  [/^(getausch|tausch|gewechs|wechsel|ersetz|erneue|ausgetau|ausgewec|neu$|neue)/, '#tausch'],
  [/^(gereini|reinig|gesaeub|saeuber|sauber|geputz|putz|entstau|abgewis|gewisch)/, '#reinig'],
  [/^(justie|nachjus|eingest|einstel|nachges|nachstel|reguli|angepa|anpass)/, '#justier'],
  [/^(geschm|schmie|geoelt|oelen|gefett|fetten)/, '#schmier'],
  [/^(geprue|pruef|kontro|getest|teste)/, '#pruef'],
  [/^(plombi|verplo|gesich|sicher)/, '#plomb'],
  [/^(gewart|wartu|warten)/, '#wart'],
];
/** Dinge mit mehreren Namen */
const NOUNS: [RegExp, string][] = [
  [/(schliesser|schliesse|ots$|tuerschl)/, '#schliesser'],
  [/^(rauchmeld|rauchwarn|melder|rauchsch|meldere)/, '#melder'],
  [/^(batter|akku)/, '#batterie'],
  [/^(dichtu|dichtung)/, '#dichtung'],
  [/^(baende|band$|baender|scharn)/, '#band'],
  [/^(haftma|magnet)/, '#magnet'],
];
const canon = (w: string) => ACTIONS.find(([re]) => re.test(w))?.[1] ?? NOUNS.find(([re]) => re.test(w))?.[1] ?? w;
const workWords = (s: string) =>
  foldText(s)
    .split(' ')
    .filter((w) => w.length >= 3 && !GENERIC.has(w) && !['sonstige', 'arbeiten', 'durchgefuehrt', 'gemacht', 'wurde', 'wurden'].includes(w))
    .map(canon);

/**
 * Wartungsarbeit der Elementart zum gesprochenen Text: Schlüssel, Bezeichnung (auch als Teil) oder dieselben
 * Begriffe mit anderen Worten („Batterie gewechselt“ → „Batterie getauscht“, „Schließer eingestellt“ →
 * „Schließer nachjustiert“). Mehrdeutig oder ohne Treffer → null.
 */
export function matchMaintenance(text: string, options: { key: string; label: string }[] = []): { key: string; label: string } | null {
  const t = text.trim();
  if (!t) return null;
  const direct =
    options.find((o) => o.key === t) ??
    options.find((o) => foldText(o.label) === foldText(t)) ??
    options.find((o) => o.key !== 'other' && (foldText(o.label).includes(foldText(t)) || foldText(t).includes(foldText(o.label))));
  if (direct) return direct;
  const tw = new Set(workWords(t));
  if (!tw.size) return null;
  const scored = options
    .filter((o) => o.key !== 'other')
    .map((o) => {
      const ow = [...new Set(workWords(o.label))];
      const common = ow.filter((w) => tw.has(w)).length;
      return { o, score: ow.length ? common / ow.length : 0, common };
    })
    .filter((x) => x.common > 0 && x.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.common - a.common);
  if (!scored.length) return null;
  if (scored[1] && scored[1].score === scored[0]!.score && scored[1].common === scored[0]!.common) return null;
  return scored[0]!.o;
}

// ---------- Widersprüche ----------
/** Mangelwörter, die einer erledigten Arbeit widersprechen (gereinigt ↔ verschmutzt …) */
const CONTRA: Record<string, RegExp> = {
  '#reinig': /^(verschm|schmut|staub|dreck|verstau|verunr)/,
  '#tausch': /^(abgela|veralt|ueberfa|austau)/,
  '#justier': /^(schlies|zieht|klemmt|schleif|zuschl|knallt)/,
  '#schmier': /^(schwerg|quietsc|knarrt|klemmt)/,
};

/**
 * Widerspricht eine erledigte Arbeit einem Mangel desselben Teils? („Melder gereinigt“ + „Melder verschmutzt“,
 * „Batterie getauscht“ + „Batterie leer“ zählt nicht – nur die Paare oben.) Liefert die Rückfrage oder null.
 */
export function workContradiction(work: string, defectTitle: string): string | null {
  const w = workWords(work);
  const actions = w.filter((x) => x.startsWith('#') && CONTRA[x]);
  const nouns = w.filter((x) => !(x.startsWith('#') && ACTIONS.some(([, a]) => a === x)));
  if (!actions.length || !nouns.length) return null;
  const raw = foldText(defectTitle).split(' ');
  const d = raw.map(canon);
  if (!nouns.some((n) => d.some((x) => x === n || (n.length >= 5 && x.length >= 5 && sameWord(n, x))))) return null;
  if (!actions.some((a) => raw.some((x) => CONTRA[a]!.test(x)))) return null;
  return `„${work}“ und Mangel „${defectTitle}“ widersprechen sich – was stimmt?`;
}
