// Duplikat-Abgleich und Zerlegen von Befunden (Plan v6 B2, C3) – geteilt von Worker (POST /defects, MCP catalog)
// und Tests. Abkürzungen werden vor dem Vergleich ausgeschrieben (OTS → Obentürschließer), Katalog-Synonyme zählen
// mit: zwei Formulierungen, die zum selben Katalog-Mangel passen, beschreiben dasselbe Problem.
import { similarity } from './smart';
import { type CatalogDefect, type CatalogTerm, expandTerms, matchCatalogDefects } from './vocab';

export interface Vocabulary {
  terms?: Pick<CatalogTerm, 'term' | 'meaning'>[];
  defects?: CatalogDefect[];
}

/** Ab diesem Anteil gemeinsamer Wortstämme gilt ein Titel als ähnlich (wie bisher). */
export const SIMILAR = 0.6;

/** Katalog-Mängel mit ausgeschriebenen Begriffen als zusätzliche Formulierungen („OTS defekt“ passt auch zu „Obentürschließer defekt“). */
export function expandCatalogDefects(defects: CatalogDefect[] = [], terms: Vocabulary['terms'] = []): CatalogDefect[] {
  if (!terms.length) return defects;
  return defects.map((d) => {
    const extra = [d.title, ...(d.synonyms ?? [])].map((p) => expandTerms(p, terms)).filter((p, i, all) => all.indexOf(p) === i);
    const known = new Set([d.title, ...(d.synonyms ?? [])]);
    const add = extra.filter((p) => !known.has(p));
    return add.length ? { ...d, synonyms: [...(d.synonyms ?? []), ...add] } : d;
  });
}

/** Bester Katalog-Mangel zu einem (schon ausgeschriebenen) Text oder null. */
function catalogHit(text: string, defects: CatalogDefect[], category?: string | null) {
  return matchCatalogDefects(text, defects, { category, limit: 1 })[0]?.defect ?? null;
}

export interface DuplicateHit<T> {
  candidate: T;
  /** „ähnlich“ (Wortstämme nach dem Ausschreiben) oder „katalog“ (beide passen zum selben Katalog-Mangel) */
  reason: 'similar' | 'catalog';
  /** Katalog-Mangel, über den beide zusammengehören */
  via?: string;
}

/**
 * Erster Kandidat, der dasselbe Problem beschreibt – oder null. Kandidaten: offene Mängel und Befunde in Entwürfen
 * bzw. bereitgelegten Prüfungen desselben Elements (bzw. Objekts ohne Element).
 */
export function findDuplicate<T extends { title: string }>(title: string, candidates: T[], vocab: Vocabulary = {}, category?: string | null): DuplicateHit<T> | null {
  if (!candidates.length || !title.trim()) return null;
  const terms = vocab.terms ?? [];
  const a = expandTerms(title, terms);
  for (const c of candidates) if (similarity(a, expandTerms(c.title, terms)) >= SIMILAR) return { candidate: c, reason: 'similar' };
  const defects = expandCatalogDefects(vocab.defects ?? [], terms);
  if (!defects.length) return null;
  const mine = catalogHit(a, defects, category);
  if (!mine) return null;
  for (const c of candidates) {
    const other = catalogHit(expandTerms(c.title, terms), defects, category);
    if (other && other.title === mine.title && (other.category ?? '') === (mine.category ?? '')) return { candidate: c, reason: 'catalog', via: mine.title };
  }
  return null;
}

/** Trennwörter zwischen mehreren Befunden („…, außerdem …“, „… und …“, Satzzeichen). */
const SPLIT = /\s*(?:[;\n]+|,\s*(?:und\s+|außerdem\s+|ausserdem\s+)?|(?<=[^\d])\.\s+|\s+(?:und außerdem|außerdem|ausserdem|sowie|und dann|und)\s+)\s*/iu;

/**
 * Text mit mehreren Befunden in einzelne Befunde zerlegen (C3): „OTS zieht nicht zu, Dichtung fehlt und Spion verkratzt“
 * → drei Teile. Teile mit nur einem Wort („… beschädigt und lose“) hängen am vorigen Befund.
 */
export function splitFindings(text: string): string[] {
  const parts = text
    .split(SPLIT)
    .map((p) =>
      p
        .trim()
        .replace(/^(?:und\s+|außerdem\s+|ausserdem\s+|sowie\s+)+/iu, '')
        .replace(/[.,;:!]+$/, ''),
    )
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && p.split(/\s+/).length < 2) out[out.length - 1] = `${out[out.length - 1]} und ${p}`;
    else out.push(p);
  }
  return out.length ? out : [text.trim()];
}
