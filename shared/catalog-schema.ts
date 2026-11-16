// Eingaben des Katalogs (Plan v5/v7): ein Schema je Liste – für API/MCP (worker/catalog.ts), die Katalog-Datei
// (docs/wissen/katalog-seehafer.json, Test) und das Laden aus Datei auf der Katalogseite.
import { z } from 'zod';
import { parseRequirement, REQUIREMENTS } from './catalog-door';

const str = (max: number) => z.string().trim().max(max);
const attrValue = z.union([z.string().trim().max(200), z.number().finite(), z.boolean(), z.null()]);
const fieldName = z.string().regex(/^[a-zA-Z0-9_]{1,40}$/, 'Ungültiger Feldname');
/** Datum JJJJ-MM-TT, das es gibt */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT')
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Datum gibt es nicht');
/** Anforderung der Tür: leer oder keine · RS · T30 · T30-RS · T90 · T90-RS (Schreibweise egal) */
const requirement = z.preprocess(
  (v) => (v == null || v === '' ? '' : (parseRequirement(v) ?? v)),
  z.union([z.enum(REQUIREMENTS), z.literal('')], { errorMap: () => ({ message: `Anforderung möglich: ${REQUIREMENTS.join(', ')}` }) }),
);
export const CATALOG_FIELDS = {
  products: z.object({
    manufacturer: str(120).min(1, 'Hersteller fehlt'),
    model: str(120).min(1, 'Typ fehlt'),
    category: str(40).default(''),
    defaults: z
      .record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/, 'Ungültiger Feldname'), attrValue)
      .refine((o) => Object.keys(o).length <= 30, 'Höchstens 30 Vorgabewerte')
      .default({}),
    approval: str(120).default(''),
    note: str(500).default(''),
    aliases: z.array(str(120).min(1)).max(30).default([]),
    approvalValidUntil: isoDate.nullable().default(null),
    requirement: requirement.default(''),
  }),
  defects: z.object({
    title: str(200).min(2, 'Bezeichnung fehlt'),
    synonyms: z.array(str(120).min(1)).max(20).default([]),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    measure: str(300).default(''),
    category: str(40).default(''),
    serviceKeys: z.array(str(60).min(1)).max(12).default([]),
    quantity: z.number().positive('Menge muss größer als 0 sein').max(10000).default(1),
    note: str(500).default(''),
  }),
  terms: z.object({
    term: str(40).min(1, 'Begriff fehlt'),
    meaning: str(200).min(1, 'Bedeutung fehlt'),
  }),
  services: z.object({
    key: str(60).min(1, 'Kürzel fehlt').regex(/^[\p{L}\d][\p{L}\d ._/+-]*$/u, 'Kürzel: Buchstaben, Ziffern, Punkt, Bindestrich'),
    title: str(200).min(2, 'Bezeichnung fehlt'),
    unit: str(20).min(1).default('Stk'),
    price: z.number().finite().min(0, 'Preis nicht negativ').max(1_000_000),
    condition: z
      .record(fieldName, z.union([z.string().trim().max(100), z.number().finite(), z.boolean(), z.array(z.string().trim().max(100)).min(1).max(20)]))
      .refine((o) => Object.keys(o).length <= 10, 'Höchstens 10 Bedingungen')
      .default({}),
    kind: z.enum(['maintenance', 'repair', 'labor']).default('repair'),
    category: str(40).default(''),
    note: str(500).default(''),
  }),
} as const;
