// Stammdaten einer Elementart prüfen und vereinheitlichen (Plan v6, D1) – für MCP update_asset und setup.
// Auswahllisten nur mit erlaubten Werten, Zahlen als Zahl, Baujahr 1950 bis nächstes Jahr, Ja/Nein als Wahrheitswert.
import type { AttributeField } from './catalog';
import { normalizeDoorInput } from './catalog-door';

export interface FieldError {
  key: string;
  label: string;
  message: string;
}

export type AttrValue = string | number | boolean | null;

const fold = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
const NUMBER_WORDS: Record<string, number> = { ein: 1, eins: 1, eine: 1, einer: 1, zwei: 2, drei: 3, vier: 4 };
const YES = /^(ja|j|yes|true|1|vorhanden|mit)$/i;
const NO = /^(nein|n|no|false|0|keine?|ohne|nicht vorhanden)$/i;

/** Frühestes Baujahr, das als plausibel gilt. */
export const YEAR_MIN = 1950;
export const yearMax = (now = Date.now()) => new Date(now).getFullYear() + 1;

/** Einen Wert für ein Feld prüfen; liefert den vereinheitlichten Wert oder eine Fehlermeldung. */
export function checkField(f: AttributeField, raw: unknown, now = Date.now()): { value: AttrValue } | { error: string } {
  if (raw == null || raw === '') return { value: null };
  if (f.key === 'year' || (f.type === 'number' && /baujahr/i.test(f.label))) {
    const n = Number(String(raw).trim());
    if (!Number.isInteger(n) || n < YEAR_MIN || n > yearMax(now))
      return { error: `${f.label} „${String(raw)}“ ist nicht plausibel – erlaubt sind ${YEAR_MIN} bis ${yearMax(now)}.` };
    return { value: n };
  }
  switch (f.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `${f.label} „${String(raw)}“ ist keine Zahl.` };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const s = String(raw).trim();
      if (YES.test(s)) return { value: true };
      if (NO.test(s)) return { value: false };
      return { error: `${f.label}: „${s}“ – bitte ja oder nein.` };
    }
    case 'select': {
      const opts = f.options ?? [];
      const s = String(raw).trim();
      const exact = opts.find((o) => fold(o) === fold(s));
      if (exact) return { value: exact };
      // „2“, „zwei“, „zweiflügelig“ → „2-flügelig“, wenn genau eine Option mit dieser Zahl beginnt
      const head = fold(s).match(/^(\d+|ein|eins|eine|zwei|drei|vier)/)?.[1];
      const n = head ? (NUMBER_WORDS[head] ?? Number(head)) : null;
      const rest = head ? fold(s).slice(head.length) : '';
      if (n != null) {
        const hits = opts.filter((o) => {
          const m = fold(o).match(/^(\d+)(.*)$/);
          return m && Number(m[1]) === n && (!rest || m[2] === rest);
        });
        if (hits.length === 1) return { value: hits[0]! };
      }
      return { error: `${f.label} „${s}“ gibt es nicht – möglich: ${opts.join(', ')}.` };
    }
    case 'date': {
      const s = String(raw).trim();
      const m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
      if (!m) return { error: `${f.label} „${s}“ ist kein Datum (JJJJ-MM-TT oder JJJJ-MM).` };
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = m[3] ? Number(m[3]) : 1;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { error: `${f.label} „${s}“ gibt es nicht.` };
      if (y < YEAR_MIN || y > yearMax(now)) return { error: `${f.label} „${s}“ ist nicht plausibel.` };
      return { value: s };
    }
    default:
      return { value: typeof raw === 'string' ? raw.trim().slice(0, 300) : String(raw) };
  }
}

/** Mehrere Felder prüfen: gültige Werte, Fehler je Feld und unbekannte Schlüssel. */
export function validateAttributes(fields: AttributeField[], input: Record<string, unknown>, now = Date.now()) {
  const values: Record<string, AttrValue> = {};
  const errors: FieldError[] = [];
  const unknown: string[] = [];
  // Tür (Plan v7): alte Felder Feuerwiderstand/Rauchschutz werden als Anforderung angenommen
  const legacy = withLegacyDoorFields(fields, input);
  if (legacy.error) errors.push({ key: 'requirement', label: fields.find((f) => f.key === 'requirement')?.label ?? 'Anforderung', message: legacy.error });
  input = legacy.attrs;
  for (const [k, raw] of Object.entries(input)) {
    const f = fields.find((x) => x.key === k);
    if (!f) {
      unknown.push(k);
      continue;
    }
    const r = checkField(f, raw, now);
    if ('error' in r) errors.push({ key: k, label: f.label, message: r.error });
    else values[k] = r.value;
  }
  return { values, errors, unknown };
}

/** `rating`/`smoke` → `requirement`, wenn die Art das Feld Anforderung hat und die alten Felder nicht mehr kennt. */
export function withLegacyDoorFields(fields: Pick<AttributeField, 'key'>[], input: Record<string, unknown>): { attrs: Record<string, unknown>; error?: string } {
  if (!('rating' in input || 'smoke' in input)) return { attrs: input };
  if (!fields.some((f) => f.key === 'requirement') || fields.some((f) => f.key === 'rating' || f.key === 'smoke')) return { attrs: input };
  return normalizeDoorInput(input);
}
