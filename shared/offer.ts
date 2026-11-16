// Angebotsliste (Plan v7, Paket X): Mangel → Leistung → Menge → Türnummern → Preis.
// Die Liste rechnet der Endpunkt GET /properties/:id/offer (Paket V); hier stehen die gemeinsame Form,
// zusätzliche Positionen (Regie/Anfahrt, nur clientseitig), Summen, Serien-Vorschläge und der Kurztext für MCP.
// Keine Rechnung, kein Versand – eine Liste zum Weiterverarbeiten.

export interface OfferLine {
  serviceKey: string;
  title: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Element-Codes */
  doors: string[];
  /** Mangel-IDs */
  defects: string[];
}
export interface OfferUnmapped {
  defectId: string;
  title: string;
  door: string;
}
export interface Offer {
  lines: OfferLine[];
  unmapped: OfferUnmapped[];
  net: number;
}

/** Vom Nutzer hinzugefügte Position (Regie, Anfahrt, eigene) – wird nicht auf dem Server gespeichert. */
export interface ExtraLine {
  id: string;
  serviceKey: string;
  title: string;
  unit: string;
  unitPrice: number;
  quantity: number;
}

export interface OfferRow {
  pos: string;
  serviceKey: string;
  title: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  total: number;
  doors: string[];
  extra: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Positionen der Liste (aus Mängeln) und zusätzliche Positionen, durchnummeriert; Summe netto. */
export function offerRows(offer: Pick<Offer, 'lines'>, extras: ExtraLine[] = []): { rows: OfferRow[]; net: number } {
  const rows: OfferRow[] = [
    ...offer.lines.map((l) => ({
      serviceKey: l.serviceKey,
      title: l.title,
      unit: l.unit,
      unitPrice: Number(l.unitPrice) || 0,
      quantity: Number(l.quantity) || 0,
      total: round2(Number.isFinite(l.total) ? l.total : (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0)),
      doors: l.doors ?? [],
      extra: false,
    })),
    ...extras.map((e) => ({
      serviceKey: e.serviceKey,
      title: e.title,
      unit: e.unit,
      unitPrice: Number(e.unitPrice) || 0,
      quantity: Number(e.quantity) || 0,
      total: round2((Number(e.unitPrice) || 0) * (Number(e.quantity) || 0)),
      doors: [],
      extra: true,
    })),
  ].map((r, i) => ({ ...r, pos: String(i + 1) }));
  return { rows, net: round2(rows.reduce((s, r) => s + r.total, 0)) };
}

export function money(n: number, lang: 'de' | 'en' = 'de') {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

/** Menge ohne überflüssige Nachkommastellen: 3 → „3“, 2.5 → „2,5“. */
export function qty(n: number, lang: 'de' | 'en' = 'de') {
  return new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 2 }).format(n);
}

export interface SeriesAsset {
  code: string;
  floor?: string | null;
  category: string;
}
export interface SeriesSuggestion {
  serviceKey: string;
  title: string;
  scope: 'property' | 'floors';
  floors: string[];
  affected: number;
  of: number;
  text: string;
}

/**
 * Serien-Vorschlag: Betrifft dieselbe Position viele Elemente einer Art, liegt eine Sammelposition nahe.
 * - ganzes Objekt: mindestens 5 betroffen und mindestens die Hälfte aller Elemente dieser Art(en);
 * - sonst je Etage: mindestens 3 betroffen und mindestens die Hälfte der Elemente dieser Art(en) auf der Etage.
 * Nur ein Vorschlagstext – an der Liste ändert sich nichts.
 */
export function seriesSuggestions(offer: Pick<Offer, 'lines'>, assets: SeriesAsset[]): SeriesSuggestion[] {
  const byCode = new Map(assets.map((a) => [a.code, a]));
  const out: SeriesSuggestion[] = [];
  for (const l of offer.lines) {
    const hit = [...new Set(l.doors)].map((c) => byCode.get(c)).filter((a): a is SeriesAsset => !!a);
    if (hit.length < 3) continue;
    const cats = new Set(hit.map((a) => a.category));
    const pool = assets.filter((a) => cats.has(a.category));
    const noun = cats.size === 1 && cats.has('fire_door') ? 'Türen' : 'Elemente';
    if (hit.length >= 5 && hit.length * 2 >= pool.length) {
      out.push({
        serviceKey: l.serviceKey,
        title: l.title,
        scope: 'property',
        floors: [],
        affected: hit.length,
        of: pool.length,
        text: `„${l.title}“ betrifft ${hit.length} von ${pool.length} ${noun} im Objekt – als Sammelposition für alle ${noun} des Objekts anbieten.`,
      });
      continue;
    }
    const floors: string[] = [];
    let affected = 0;
    let of = 0;
    for (const f of [...new Set(hit.map((a) => (a.floor ?? '').trim()))]) {
      if (!f) continue;
      const n = hit.filter((a) => (a.floor ?? '').trim() === f).length;
      const all = pool.filter((a) => (a.floor ?? '').trim() === f).length;
      if (n >= 3 && n * 2 >= all) {
        floors.push(f);
        affected += n;
        of += all;
      }
    }
    if (floors.length)
      out.push({
        serviceKey: l.serviceKey,
        title: l.title,
        scope: 'floors',
        floors,
        affected,
        of,
        text: `„${l.title}“ betrifft ${affected} von ${of} ${noun} ${floors.length === 1 ? 'der Etage' : 'der Etagen'} ${floors.join(', ')} – als Sammelposition „${l.title} an allen ${noun} ${floors.length === 1 ? 'der Etage' : 'der Etagen'} ${floors.join(', ')}“ anbieten.`,
      });
  }
  return out;
}

/** Kurzform für MCP `report(what: "offer")`: Positionen, Summe, nicht zugeordnete Mängel. */
export function offerText(offer: Offer, propertyName: string, opts: { maxDoors?: number } = {}): string {
  const max = opts.maxDoors ?? 12;
  const doors = (d: string[]) => (d.length > max ? `${d.slice(0, max).join(', ')} … (+${d.length - max})` : d.join(', '));
  const { rows, net } = offerRows(offer);
  const lines = [`Angebotsliste „${propertyName}“: ${rows.length} ${rows.length === 1 ? 'Position' : 'Positionen'}, Summe netto ${money(net)}`];
  if (!rows.length) lines.push('- keine Position (keine offenen Mängel mit zugeordneter Leistung)');
  for (const r of rows)
    lines.push(`- ${r.serviceKey ? `${r.serviceKey} ` : ''}${r.title}: ${qty(r.quantity)} ${r.unit} × ${money(r.unitPrice)} = ${money(r.total)}${r.doors.length ? ` · ${doors(r.doors)}` : ''}`);
  if (offer.unmapped.length) {
    lines.push('', `Nicht zugeordnet (${offer.unmapped.length}) – ohne Leistung im Katalog, bitte von Hand bepreisen:`);
    for (const u of offer.unmapped.slice(0, 30)) lines.push(`- ${u.door ? `${u.door}: ` : ''}${u.title}`);
    if (offer.unmapped.length > 30) lines.push(`- … und ${offer.unmapped.length - 30} weitere`);
  }
  lines.push('', 'Liste zum Weiterverarbeiten (kein Angebot im rechtlichen Sinn, kein Versand). Regie und Anfahrt kommen in der App dazu (Objekt → Angebot).');
  return lines.join('\n');
}

/** Prüft die Antwort des Endpunkts grob, damit eine unvollständige Antwort die Seite nicht bricht. */
export function normalizeOffer(raw: unknown): Offer {
  const o = (raw ?? {}) as Partial<Offer>;
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const unmapped = Array.isArray(o.unmapped) ? o.unmapped : [];
  const clean = lines.map((l) => ({
    serviceKey: String(l?.serviceKey ?? ''),
    title: String(l?.title ?? ''),
    unit: String(l?.unit ?? ''),
    unitPrice: Number(l?.unitPrice) || 0,
    quantity: Number(l?.quantity) || 0,
    total: Number(l?.total) || 0,
    doors: Array.isArray(l?.doors) ? l.doors.map(String) : [],
    defects: Array.isArray(l?.defects) ? l.defects.map(String) : [],
  }));
  return {
    lines: clean,
    unmapped: unmapped.map((u) => ({ defectId: String(u?.defectId ?? ''), title: String(u?.title ?? ''), door: String(u?.door ?? '') })),
    net: Number.isFinite(Number(o.net)) ? Number(o.net) : round2(clean.reduce((s, l) => s + l.total, 0)),
  };
}
