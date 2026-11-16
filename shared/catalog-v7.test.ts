// Plan v7, Paket V: Anforderung der Tür (Umrechnung), Prüfpunkte je Anforderung (appliesIf), Angebotsliste,
// Import der Wartungsübersicht und die Katalog-Datei gegen das Schema.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allOkAnswers, checkpointApplies, conditionReason } from './applies';
import { CATEGORIES, type CatalogDefect, type CatalogProduct, type CatalogService } from './catalog';
import { normalizeDoorInput, parseRequirement, requirementOf, withRequirement } from './catalog-door';
import { catalogFileBatches, fileItem, parseCatalogFile, productForType, uncertainCounts } from './catalog-file';
import { computeOffer, conditionMatches, type OfferDefect } from './catalog-offer';
import { CATALOG_FIELDS } from './catalog-schema';
import { toImportRows } from './importing';
import { codeNumber, findElementRef, parseElementRef } from './vocab';

const door = CATEGORIES.fire_door;

describe('Anforderung der Tür (Umrechnung)', () => {
  it('Text → Anforderung', () => {
    expect(parseRequirement('T30-RS')).toBe('T30-RS');
    expect(parseRequirement('t30 rs')).toBe('T30-RS');
    expect(parseRequirement('T30 RS Alu-Rohr-Rahmen mit Standflügel')).toBe('T30-RS');
    expect(parseRequirement('RS Alu-Rohr-Rahmen')).toBe('RS');
    expect(parseRequirement('RS / SSK 3')).toBe('RS');
    expect(parseRequirement('T90')).toBe('T90');
    expect(parseRequirement('EI2 30 Sa')).toBe('T30-RS');
    expect(parseRequirement('keine')).toBe('keine');
    expect(parseRequirement('T0')).toBe('keine');
    expect(parseRequirement('SK32')).toBeNull();
    expect(parseRequirement('T60')).toBeNull();
    expect(parseRequirement('Feuchtraumtür')).toBeNull();
  });
  it('Bestand: rating + smoke → requirement', () => {
    expect(requirementOf({ rating: 'T30', smoke: true })).toBe('T30-RS');
    expect(requirementOf({ rating: 'T30', smoke: false })).toBe('T30');
    expect(requirementOf({ rating: 'T90' })).toBe('T90');
    expect(requirementOf({ rating: 'EI2 90', smoke: 'ja' })).toBe('T90-RS');
    expect(requirementOf({ smoke: true })).toBe('RS');
    expect(requirementOf({ smoke: false })).toBeNull();
    expect(requirementOf({ rating: 'T60', smoke: true })).toBeNull();
    expect(requirementOf({ requirement: 'T90', rating: 'T30' })).toBe('T90');
    expect(requirementOf({})).toBeNull();
    expect(withRequirement({ rating: 'T30', smoke: true, leaves: '1-flügelig' })).toMatchObject({ requirement: 'T30-RS', leaves: '1-flügelig' });
  });
  it('Eingabe mit alten Feldnamen: umgerechnet, alte Felder entfernt, Unpassendes als Fehler', () => {
    expect(normalizeDoorInput({ rating: 'T30', smoke: true, leaves: '2-flügelig' })).toEqual({ attrs: { requirement: 'T30-RS', leaves: '2-flügelig' } });
    expect(normalizeDoorInput({ rating: 'T90', requirement: 'RS' })).toEqual({ attrs: { requirement: 'RS' } });
    expect(normalizeDoorInput({ smoke: false })).toEqual({ attrs: {} });
    const bad = normalizeDoorInput({ rating: 'T45' });
    expect(bad.error).toMatch(/T45/);
    expect(bad.error).toMatch(/T30-RS/);
    expect(normalizeDoorInput({ leaves: '1-flügelig' })).toEqual({ attrs: { leaves: '1-flügelig' } });
  });
  it('Tür heißt „Tür“ mit Präfix T; „Tür 36“ und „Feuerschutztür 36“ funktionieren, „T30“ ist keine Nummer', () => {
    expect(door.label).toBe('Tür');
    expect(door.prefix).toBe('T');
    const cats = Object.values(CATEGORIES).map((c) => ({ key: c.key, label: c.label, plural: c.plural, prefix: c.prefix }));
    expect(parseElementRef('Tür 36', cats)).toMatchObject({ number: 36, category: 'fire_door' });
    expect(parseElementRef('Feuerschutztür 36', cats)).toMatchObject({ number: 36, category: 'fire_door' });
    expect(parseElementRef('Fenster 4', cats)).toMatchObject({ number: 4, category: 'window' });
    expect(parseElementRef('DA 2', cats)).toMatchObject({ number: 2, category: 'door_drive' });
    expect(findElementRef('T30 Tür im Keller', cats)).toBeNull();
    expect(findElementRef('Tür schließt nicht, da 2 Bänder lose', cats)).toBeNull();
    expect(codeNumber('T-036')).toBe(36);
    expect(codeNumber('FST-036')).toBe(36);
    expect(codeNumber('DA-002-2')).toBe(2);
  });
});

describe('Prüfpunkte je Anforderung (appliesIf)', () => {
  const all = { leaves: '1-flügelig', holdOpen: false, cardLock: false, dropSeal: false, peephole: false };
  const na = (attrs: Record<string, unknown>) => {
    const r = allOkAnswers(door.checkpoints, {}, 'fire_door', attrs);
    return { na: r.na.map((id) => door.checkpoints.find((c) => c.id === id)!.label), unknown: r.unknown.map((u) => u.attr) };
  };
  const has = (list: string[], re: RegExp) => list.some((l) => re.test(l));
  it('Tür ohne Anforderung: Kennzeichnung, Rauch- und Brandschutzpunkte entfallen', () => {
    const r = na({ ...all, requirement: 'keine' });
    expect(r.unknown).toEqual([]);
    expect(has(r.na, /Kennzeichnungsschild/)).toBe(true);
    expect(has(r.na, /^Rauchschutz:/)).toBe(true);
    expect(has(r.na, /Dämmschichtbildner/)).toBe(true);
  });
  it('RS: Rauchschutz gilt, Brandschutz (Dämmschichtbildner) entfällt, Kennzeichnung gilt', () => {
    const r = na({ ...all, requirement: 'RS' });
    expect(has(r.na, /^Rauchschutz:/)).toBe(false);
    expect(has(r.na, /Dämmschichtbildner/)).toBe(true);
    expect(has(r.na, /Kennzeichnungsschild/)).toBe(false);
  });
  it('T30: Brandschutz gilt, Rauchschutz entfällt', () => {
    const r = na({ ...all, requirement: 'T30' });
    expect(has(r.na, /Dämmschichtbildner/)).toBe(false);
    expect(has(r.na, /^Rauchschutz:/)).toBe(true);
  });
  it('T90-RS: beides gilt; alter Bestand (rating/smoke) wird genauso gelesen', () => {
    for (const attrs of [{ ...all, requirement: 'T90-RS' }, { ...all, rating: 'T90', smoke: true }]) {
      const r = na(attrs);
      expect(has(r.na, /Dämmschichtbildner|^Rauchschutz:|Kennzeichnungsschild/)).toBe(false);
      expect(r.unknown).toEqual([]);
    }
  });
  it('Ausstattung: Schließfolge nur zweiflügelig, FSA nur mit Feststellanlage, Spion/Absenkdichtung/Kartenschloss nur wenn vorhanden', () => {
    const without = na({ ...all, requirement: 'T30' });
    for (const re of [/Schließfolge/, /Feststellanlage löst/, /Rauchmelder der Feststellanlage/, /Türspion/, /Absenkdichtung senkt/, /Kartenschloss/]) expect(has(without.na, re)).toBe(true);
    const withAll = na({ requirement: 'T30-RS', leaves: '2-flügelig', holdOpen: true, cardLock: true, dropSeal: true, peephole: true });
    expect(withAll.na).toEqual([]);
  });
  it('unbekannte Anforderung: Punkte bleiben offen, eine Rückfrage zur Anforderung', () => {
    const r = allOkAnswers(door.checkpoints, {}, 'fire_door', all);
    const reqQuestions = r.unknown.filter((u) => u.attr === 'requirement');
    expect(reqQuestions.length).toBeGreaterThan(2);
    expect(new Set(reqQuestions.map((u) => u.question)).size).toBe(1);
    expect(reqQuestions[0]!.question).toMatch(/T30-RS/);
  });
  it('jede Bedingung hat einen lesbaren Grund; Gruppen nach Bauteil an jedem Punkt', () => {
    expect(conditionReason({ attr: 'requirement', in: ['T30', 'T30-RS', 'T90', 'T90-RS'] })).toBe('ohne Brandschutz');
    expect(conditionReason({ attr: 'requirement', in: ['RS', 'T30-RS', 'T90-RS'] })).toBe('ohne Rauchschutz');
    expect(conditionReason({ attr: 'peephole', equals: true })).toBe('ohne Türspion');
    for (const k of ['fire_door', 'window', 'door_drive'] as const) expect(CATEGORIES[k].checkpoints.every((c) => !!c.group)).toBe(true);
    expect(checkpointApplies({ attr: 'fanlight', equals: true }, { fanlight: false })).toBe('no');
    expect(checkpointApplies({ attr: 'fireDoor', equals: true }, { fireDoor: true })).toBe('yes');
  });
});

describe('Angebotsliste', () => {
  const svc = (key: string, price: number, condition: CatalogService['condition'] = {}, unit = 'Stk', category = 'fire_door'): CatalogService => ({
    id: key,
    key,
    title: `Leistung ${key}`,
    unit,
    price,
    condition,
    kind: 'repair',
    category,
    note: '',
  });
  const services = [
    svc('D0', 17.35, { requirement: ['keine'] }, 'lfm'),
    svc('DBS', 21.5, { requirement: ['RS', 'T30', 'T30-RS', 'T90', 'T90-RS'] }, 'lfm'),
    svc('SX0', 335, { requirement: ['keine'] }),
    svc('SX30', 651, { requirement: ['RS', 'T30', 'T30-RS'] }),
    svc('SX90', 980, { requirement: ['T90', 'T90-RS'] }),
    svc('KM', 1, {}, 'pauschal', ''),
  ];
  const cd = (title: string, serviceKeys: string[], quantity = 1, synonyms: string[] = []): CatalogDefect => ({
    id: title,
    title,
    synonyms,
    severity: 'medium',
    measure: '',
    category: 'fire_door',
    serviceKeys,
    quantity,
  });
  const catalog = [cd('Dichtung fehlt', ['D0', 'DBS', 'KM'], 5), cd('Absenkdichtung defekt', ['SX0', 'SX30', 'SX90'], 1, ['Schall-ex defekt']), cd('Zarge irreparabel beschädigt', [])];
  const d = (id: string, title: string, code: string | null, attributes: Record<string, unknown> | null): OfferDefect => ({ id, title, category: code ? 'fire_door' : null, code, attributes });
  it('Preis nach Bedingung aus den Stammdaten, Mengen summiert, Türen je Zeile', () => {
    const o = computeOffer(
      [
        d('m1', 'Dichtung fehlt', 'T-012', { requirement: 'keine' }),
        d('m2', 'Dichtung fehlt', 'T-003', { requirement: 'T30-RS' }),
        d('m3', 'Dichtung fehlt', 'T-010', { rating: 'T30' }),
        d('m4', 'Schall-ex defekt', 'T-003', { requirement: 'T30-RS' }),
        d('m5', 'Absenkdichtung defekt', 'T-020', { requirement: 'T90-RS' }),
      ],
      catalog,
      services,
    );
    const line = (k: string) => o.lines.find((l) => l.serviceKey === k)!;
    expect(line('D0')).toMatchObject({ quantity: 5, unitPrice: 17.35, total: 86.75, doors: ['T-012'], defects: ['m1'], unit: 'lfm' });
    expect(line('DBS')).toMatchObject({ quantity: 10, total: 215, doors: ['T-003', 'T-010'], defects: ['m2', 'm3'] });
    expect(line('KM')).toMatchObject({ quantity: 15, total: 15 });
    expect(line('SX30')).toMatchObject({ quantity: 1, total: 651, doors: ['T-003'] });
    expect(line('SX90')).toMatchObject({ quantity: 1, total: 980, doors: ['T-020'] });
    expect(o.lines.find((l) => l.serviceKey === 'SX0')).toBeUndefined();
    expect(o.unmapped).toEqual([]);
    expect(o.net).toBe(86.75 + 215 + 15 + 651 + 980);
    // genau die Form aus dem Plan
    expect(Object.keys(o).sort()).toEqual(['lines', 'net', 'unmapped']);
    expect(Object.keys(o.lines[0]!).sort()).toEqual(['defects', 'doors', 'quantity', 'serviceKey', 'title', 'total', 'unit', 'unitPrice']);
  });
  it('ohne Zuordnung, ohne Katalog-Mangel oder mit fehlenden Stammdaten: unter unmapped mit Grund', () => {
    const o = computeOffer(
      [
        d('u1', 'Zarge irreparabel beschädigt', 'T-001', { requirement: 'T30' }),
        d('u2', 'Etwas ganz anderes', 'T-002', {}),
        d('u3', 'Absenkdichtung defekt', 'T-004', {}),
        d('u4', 'Dichtung fehlt', null, null),
      ],
      catalog,
      services,
    );
    expect(o.unmapped.map((u) => [u.defectId, u.door])).toEqual([
      ['u1', 'T-001'],
      ['u2', 'T-002'],
      ['u3', 'T-004'],
    ]);
    expect(o.unmapped[0]!.reason).toMatch(/Keine Leistung/);
    expect(o.unmapped[1]!.reason).toMatch(/Kein passender Katalog-Mangel/);
    expect(o.unmapped[2]!.reason).toMatch(/Anforderung/);
    // ohne Element nur die Leistungen ohne Bedingung
    expect(o.lines.map((l) => l.serviceKey)).toEqual(['KM']);
    expect(Object.keys(o.unmapped[0]!).sort()).toEqual(['defectId', 'door', 'reason', 'title']);
  });
  it('Bedingungen: Liste, Ja/Nein, unbekannt ≠ passt nicht', () => {
    expect(conditionMatches({ requirement: ['T30-RS'], leaves: '1-flügelig' }, { requirement: 'T30-RS', leaves: '1-flügelig' })).toEqual({ ok: true });
    expect(conditionMatches({ closer: true }, { closer: 'JA' })).toEqual({ ok: true });
    expect(conditionMatches({ closer: true }, { closer: false })).toMatchObject({ ok: false, mismatch: true });
    expect(conditionMatches({ closer: true }, {})).toEqual({ ok: false, missing: ['closer'] });
  });
});

describe('Import der Wartungsübersicht', () => {
  const head = [
    'Protokoll Nummer',
    'Ident Nummer',
    'Prüf-Intervall in Tagen',
    'Zeitpunkt der letzten Prüfung',
    'Nächste Prüfung spätestens am',
    'Betreiber / Auftraggeber',
    'Objektbeschreibung',
    'Etage',
    'Raum',
    'Türtyp',
    'Hersteller',
    'Absenkdichtung',
    'OTS',
    'Spion',
    'Zulassung / Prüfzeugnis',
    'Bemerkung / Link',
  ];
  const products: CatalogProduct[] = [
    { id: 'p1', manufacturer: 'Westag + Getalit', model: 'SK32', category: 'fire_door', aliases: ['SK32'], defaults: { soundproof: true, closer: true }, approval: '', note: '', requirement: 'keine' },
    { id: 'p2', manufacturer: 'Westag + Getalit', model: 'T30 RS', category: 'fire_door', aliases: ['T30 RS'], defaults: { closer: true }, approval: 'Z-6.16-1211', note: '', requirement: 'T30-RS' },
    { id: 'p3', manufacturer: 'Anderer', model: 'T30-RS', category: 'fire_door', aliases: ['T30-RS'], defaults: {}, approval: 'Z-6.20-2030', note: '', requirement: 'T30-RS' },
  ];
  const table = [
    head,
    [2, 36, 365, 45763, 46128, 'Kunde', 'Hotel Test', '3.OG', '304', 'SK32', 'Westag + Getalit AG', 'JA', 'JA', 'JA', '', ''],
    [2, 1, 365, 45763, 46128, 'Kunde', 'Hotel Test', 'EG', 'Treppenhaus-Flur', 'T30 RS', 'Westag + Getalit AG', 'JA', 'JA', '', 'Z-6.16-1211 / P-3785/7858', ''],
    [2, 50, 365, '', '', 'Kunde', 'Hotel Test', '1.OG', 'Batterieraum', 'RS Alu-Rohr-Rahmen', '(Ferro-WICSTYLE)', 'JA', 'JA', '', '28119620', ''],
    [1, 9, 365, 45763, 46128, 'Kunde', 'Hotel Test', '1.OG', 'Flur', 'RS Alu-Rohr-Rahmen', 'Ferro-WICSTYLE', '', '', '', '', ''],
    [2, 51, 365, '', '', 'Kunde', 'Hotel Test', '1.OG', 'x', 'T30', 'Westag', 'vielleicht', '', '', '', ''],
  ];
  it('Spalten laut Wissensauszug: Ident-Nr. → Nummer, Türtyp → Katalog-Alias oder Freitext, JA-Spalten, Termine', () => {
    const { rows, errors } = toImportRows(table, [], { products });
    expect(errors).toEqual([{ line: 6, message: 'Absenkdichtung: „vielleicht“ – bitte JA oder leer' }]);
    const [sk, t30, alu, fsa] = rows;
    expect(sk).toMatchObject({ line: 2, property: 'Hotel Test', building: 'Hauptgebäude', category: 'fire_door', number: 36, floor: '3.OG', location: '304' });
    expect(sk).toMatchObject({ manufacturer: 'Westag + Getalit AG', model: 'SK32', catalogType: 'Westag + Getalit SK32', intervalMonths: 12 });
    expect(sk!.attributes).toEqual({ soundproof: true, closer: true, requirement: 'keine', dropSeal: true, peephole: true });
    expect(new Date(sk!.lastInspectedAt!).toISOString().slice(0, 10)).toBe('2025-04-16');
    expect(new Date(sk!.nextDueAt!).toISOString().slice(0, 10)).toBe('2026-04-16');
    // „T30 RS“ und „T30-RS“ sind gleich geschrieben – der Hersteller entscheidet
    expect(t30).toMatchObject({ model: 'T30 RS', catalogType: 'Westag + Getalit T30 RS' });
    expect(t30!.attributes).toMatchObject({ requirement: 'T30-RS', approval: 'Z-6.16-1211 / P-3785/7858', peephole: false, dropSeal: true });
    // kein Katalog-Typ: Freitext als Typ, Anforderung aus dem Text, Klammer-Hersteller ohne Klammer
    expect(alu).toMatchObject({ model: 'RS Alu-Rohr-Rahmen', manufacturer: 'Ferro-WICSTYLE', number: 50 });
    expect(alu!.catalogType).toBeUndefined();
    expect(alu!.attributes).toMatchObject({ requirement: 'RS', approval: '28119620' });
    expect(alu!.lastInspectedAt).toBeUndefined();
    // Protokoll 1 = Feststellanlage
    expect(fsa).toMatchObject({ category: 'hold_open', number: 9 });
    expect(fsa!.attributes ?? {}).toEqual({});
  });
  it('Objekt aus der Auswahl, wenn die Datei keine Objektspalte hat', () => {
    const t = [
      ['Ident-Nr.', 'Türtyp', 'Etage', 'Raum'],
      ['7', 'T90', 'UG', 'Heizung'],
    ];
    expect(toImportRows(t).errors[0]!.message).toMatch(/Spalte fehlt: Objekt/);
    const r = toImportRows(t, [], { property: 'Wohnanlage Süd' });
    expect(r.rows[0]).toMatchObject({ property: 'Wohnanlage Süd', building: 'Hauptgebäude', category: 'fire_door', number: 7, model: 'T90', attributes: { requirement: 'T90' } });
  });
  it('Katalog-Typ: mehrdeutig ohne Hersteller → kein Treffer; Hersteller passt nicht → kein Treffer', () => {
    expect(productForType('T30 RS', products)).toBeNull();
    expect(productForType('t30-rs', products, { manufacturer: 'Westag' })!.id).toBe('p2');
    expect(productForType('SK32', products, { manufacturer: 'Hörmann' })).toBeNull();
    expect(productForType('Westag + Getalit SK32', products)!.id).toBe('p1');
  });
});

describe('Katalog-Datei', () => {
  const doc = parseCatalogFile(readFileSync('docs/wissen/katalog-seehafer.json', 'utf8'));
  it('jeder Eintrag passt zum Schema des Stapel-Endpunkts (ohne unbekannte Felder)', () => {
    for (const b of catalogFileBatches(doc)) {
      const schema = CATALOG_FIELDS[b.kind];
      for (const item of b.items) {
        const extra = Object.keys(item).filter((k) => !(k in schema.shape));
        expect(extra, `${b.kind}: ${JSON.stringify(item).slice(0, 80)}`).toEqual([]);
        const p = schema.safeParse(item);
        expect(p.success, `${b.kind}: ${JSON.stringify(item).slice(0, 120)} ${p.success ? '' : p.error.message}`).toBe(true);
      }
    }
  });
  it('Inhalt: Türtypen mit Aliassen, die 16 Mängel-Bausteine mit Leistungen, Leistungen mit Preisen', () => {
    const doors = doc.products!.filter((p) => p.category === 'fire_door');
    expect(doors.length).toBeGreaterThanOrEqual(20);
    expect(doors.every((p) => Array.isArray(p.aliases) && (p.aliases as string[]).length > 0)).toBe(true);
    const aliases = doors.flatMap((p) => p.aliases as string[]);
    for (const a of ['SK32', 'T30 RS', 'RS / SSK 3', 'FRT', 'Premio T30-RS', 'T30 RS Block-Stahhl']) expect(aliases).toContain(a);
    const keys = new Set(doc.services!.map((s) => s.key as string));
    expect(keys.size).toBe(doc.services!.length);
    expect(doc.defects!.filter((d) => d.category === 'fire_door')).toHaveLength(16);
    for (const d of doc.defects!) for (const k of (d.serviceKeys as string[] | undefined) ?? []) expect(keys.has(k), k).toBe(true);
    // Preise aus den Vorlagen, nicht aus dem Angebot vom 16.11.
    const price = (k: string) => doc.services!.find((s) => s.key === k)!.price;
    expect(price('IS-OTS-BGS')).toBe(34.5);
    expect(price('IS-FSA-GEZE')).toBe(1688);
    expect(price('IS-SPION-BS')).toBe(49.31);
    expect(price('4.003')).toBe(25);
    // Unsicheres markiert, mit Notiz
    const u = uncertainCounts(doc);
    expect(u.products + u.defects + u.services).toBeGreaterThan(0);
    expect(fileItem('services', { key: 'X', title: 'X', price: 1, unsicher: true, notiz: 'offen' }).note).toBe('Unsicher: offen');
  });
  it('Angebotsliste mit der Datei: Schall-Ex nach Anforderung', () => {
    const services = doc.services!.map((s, i) => ({ ...CATALOG_FIELDS.services.parse(fileItem('services', s)), id: String(i) }) as CatalogService);
    const defects = doc.defects!.map((x, i) => ({ ...CATALOG_FIELDS.defects.parse(fileItem('defects', x)), id: String(i) }) as CatalogDefect);
    const o = computeOffer(
      [
        { id: 'a', title: 'Schall-ex defekt', category: 'fire_door', code: 'T-036', attributes: { requirement: 'keine' } },
        { id: 'b', title: 'Absenkdichtung defekt', category: 'fire_door', code: 'T-007', attributes: { requirement: 'T30-RS' } },
        { id: 'c', title: 'Bodenluft zu groß', category: 'fire_door', code: 'T-008', attributes: { requirement: 'T30-RS' } },
      ],
      defects,
      services,
    );
    expect(o.lines.map((l) => [l.serviceKey, l.total, l.doors])).toEqual([
      ['IS-SCHALLEX-0', 335, ['T-036']],
      ['IS-SCHALLEX-T30', 651, ['T-007']],
      ['IS-SCHWELLE', 152.5, ['T-008']],
    ]);
    expect(o.net).toBe(1138.5);
  });
  it('falsche Dateien werden verständlich abgelehnt', () => {
    expect(() => parseCatalogFile('{')).toThrow(/kein gültiges JSON/);
    expect(() => parseCatalogFile('{"format":"x","version":1}')).toThrow(/Keine Katalog-Datei/);
    expect(() => parseCatalogFile('{"format":"pruefkompass-katalog","version":2}')).toThrow(/Version/);
  });
});
