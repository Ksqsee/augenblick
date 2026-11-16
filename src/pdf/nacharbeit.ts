// Nacharbeit (Plan v7, Paket X): Sammelmappe und Angebotsliste – erzeugt im Browser wie alle Berichte.
// Die Sammelmappe übernimmt die Seiten der einzelnen Protokolle unverändert (gleiches Layout wie der Einzel-Download)
// und setzt Deckblatt, Inhaltsliste und je Mangelgruppe ein Zwischenblatt davor. Große Objekte werden Protokoll für
// Protokoll erzeugt; dazwischen gibt der Browser die Kontrolle ab (Fortschritt, kein Einfrieren).
import { PDFDocument, type PDFPage, StandardFonts } from 'pdf-lib';
import { type Credential, credentialText, pickCredential } from '../../shared/credentials';
import { buildFileName } from '../../shared/filename';
import { type DocLanguage, isValidTimeZone, LOCALE, tr } from '../../shared/i18n';
import { groupMappe, type MappeCounts, mappeCounts, type MappeItem, mappePages, type MappeSection } from '../../shared/mappe';
import { type ExtraLine, money, type Offer, offerRows, qty, type SeriesSuggestion } from '../../shared/offer';
import { buildXlsx } from '../../shared/xlsx';
import { api, type Inspection, type InspectionRow, type Me, type PropertyDetail } from '../api';
import { RESULT_META } from '../format';
import { A4, type Brand, Doc, drawFooter, GREEN, INK, MUTED, pageLabel, WARN } from './layout';
import { inspectionDoc, loadBrand } from './reports';

let lang: DocLanguage = 'de';
let dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
function useBrand(b: Brand) {
  lang = b.lang ?? 'de';
  const timeZone = b.timeZone && isValidTimeZone(b.timeZone) ? b.timeZone : undefined;
  dateFmt = new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });
}
const T = (s: string) => tr(lang, s);
const d = (t: number | null | undefined) => (t ? dateFmt.format(t) : '–');
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const resultLabel = (r: string | null) => (r && r in RESULT_META ? T(RESULT_META[r as keyof typeof RESULT_META].label) : '–');
/** Dem Browser kurz die Kontrolle geben (Eingaben, Fortschritt), damit große Mappen die Seite nicht einfrieren. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------- Sammelmappe ----------

export interface MappeRequest {
  propertyId: string;
  /** genau diese Prüfungen (z. B. direkt nach „Alle unterschreiben“); sonst Zeitraum */
  ids?: string[];
  from?: number;
  to?: number;
  category?: string;
}
export interface MappeProgress {
  stage: 'load' | 'render' | 'build';
  done: number;
  total: number;
}
export interface MappeResult {
  bytes: Uint8Array;
  fileName: string;
  title: string;
  counts: MappeCounts;
  pages: number;
  /** Protokolle ohne gültigen Nachweis der prüfenden Person */
  missingProof: number;
}

type Item = MappeItem & { ins: Inspection; model: string; categoryLabel: string; inspectorName: string; proof: ReturnType<typeof pickCredential> };

function sectionTitle(s: MappeSection, n = s.items.length) {
  if (s.kind === 'clean') return `${T('Ohne Mangel')} (${n})`;
  if (s.kind === 'not_inspectable') return `${T('Nicht prüfbar')} (${n})`;
  return `${s.defects.length ? s.defects.map((x) => T(x)).join(' + ') : T('Mit Mängeln')} (${n})`;
}
const room = (it: Item) => [it.floor, it.location].filter(Boolean).join(' · ');
const typ = (it: Item) => [T(it.categoryLabel), it.model].filter(Boolean).join(' · ');

/**
 * Sammelmappe erzeugen: Prüfungen laden, Protokolle nacheinander erzeugen, Deckblatt/Inhaltsliste/Zwischenblätter
 * davorsetzen und durchgehend nummerieren. `signal` bricht ab (z. B. Dialog geschlossen).
 */
export async function buildMappe(req: MappeRequest, me: Me, onProgress: (p: MappeProgress) => void = () => {}, signal?: AbortSignal): Promise<MappeResult> {
  const brand = await loadBrand(me);
  useBrand(brand);
  const check = () => {
    if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
  };
  const qs = new URLSearchParams({ status: 'submitted', propertyId: req.propertyId });
  if (req.from != null) qs.set('from', String(req.from));
  if (req.to != null) qs.set('to', String(req.to));
  if (req.category) qs.set('category', req.category);
  const [p, rows, credentials] = await Promise.all([
    api<PropertyDetail>(`/properties/${req.propertyId}`),
    req.ids ? Promise.resolve(null) : api<InspectionRow[]>(`/inspections?${qs}`),
    api<Credential[]>('/credentials').catch(() => [] as Credential[]),
  ]);
  const ids = req.ids ?? (rows ?? []).map((r) => r.id);
  if (!ids.length) throw new Error('Keine abgeschlossenen Prüfungen in diesem Zeitraum.');

  // 1. Prüfungen laden (in kleinen Paketen parallel)
  const details: Inspection[] = [];
  for (let k = 0; k < ids.length; k += 6) {
    check();
    details.push(...(await Promise.all(ids.slice(k, k + 6).map((id) => api<Inspection>(`/inspections/${id}`)))));
    onProgress({ stage: 'load', done: Math.min(ids.length, k + 6), total: ids.length });
  }
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const items: Item[] = details
    .filter((i) => i.status === 'submitted' && !i.supersededAt && i.propertyId === req.propertyId)
    .map((i) => {
      const a = assets.get(i.assetId);
      const at = i.inspectedAt ?? i.createdAt;
      return {
        id: i.id,
        ins: i,
        code: i.asset.code,
        floor: i.asset.floor,
        location: i.asset.location,
        category: i.asset.category,
        categoryLabel: i.asset.categoryLabel,
        model: i.asset.model,
        result: i.result,
        notInspectable: i.notInspectable,
        inspectedAt: at,
        inspectorId: i.inspectorId,
        inspectorName: i.inspectorName,
        defects: i.defects.map((x) => x.title),
        sortIndex: a?.sortIndex ?? null,
        number: a?.number ?? null,
        createdAt: a?.createdAt ?? null,
        proof: pickCredential(
          credentials.filter((c) => c.userId === i.inspectorId),
          { category: i.asset.category, manufacturer: i.asset.manufacturer, at },
        ),
      };
    });
  if (!items.length) throw new Error('Keine abgeschlossenen Prüfungen in diesem Zeitraum.');
  const sections = groupMappe(items);
  const ordered = sections.flatMap((s) => s.items);

  // 2. Protokolle erzeugen und Seiten übernehmen
  const master = await PDFDocument.create();
  const pageCount = new Map<string, number>();
  for (const [n, it] of ordered.entries()) {
    check();
    const doc = (await inspectionDoc(it.ins, brand, { credentials })).finalize();
    const copied = await master.copyPages(doc.pdf, doc.pdf.getPageIndices());
    for (const pg of copied) master.addPage(pg);
    pageCount.set(it.id, copied.length);
    onProgress({ stage: 'render', done: n + 1, total: ordered.length });
    await breathe();
  }
  useBrand(brand);
  onProgress({ stage: 'build', done: 0, total: 1 });

  // 3. Deckblatt und Inhaltsliste: Länge der Inhaltsliste ausprobieren, bis die Seitenzahlen stimmen
  const counts = mappeCounts(sections);
  const times = items.map((i) => i.inspectedAt);
  const from = req.from ?? Math.min(...times);
  const to = req.to ?? Math.max(...times);
  const period = ymd(from) === ymd(to) ? d(from) : `${d(from)} – ${d(to)}`;
  let toc = 1;
  let front: Doc | null = null;
  let pages = mappePages(sections, (id) => pageCount.get(id) ?? 1, toc);
  for (let tries = 0; tries < 6; tries++) {
    pages = mappePages(sections, (id) => pageCount.get(id) ?? 1, toc);
    front = await renderFront(brand, { p, sections, items, counts, period, pages });
    const got = front.pdf.getPageCount() - 1;
    if (got === toc) break;
    toc = got;
  }
  const sheets = await renderSheets(brand, sections, pages);
  check();

  // 4. Zusammensetzen: Deckblatt + Inhaltsliste vorn, Zwischenblätter an ihre Stelle
  const own = new Set<PDFPage>();
  const frontPages = await master.copyPages(front!.pdf, front!.pdf.getPageIndices());
  frontPages.forEach((pg, i) => {
    master.insertPage(i, pg);
    own.add(pg);
  });
  const sheetPages = await master.copyPages(sheets.doc.pdf, sheets.doc.pdf.getPageIndices());
  sheets.at.forEach((pageNo, i) => {
    master.insertPage(pageNo - 1, sheetPages[i]);
    own.add(sheetPages[i]);
  });

  // 5. Durchgehende Seitenzahlen: eigene Seiten mit Fußzeile, Protokollseiten mit kleinem Vermerk darunter
  const font = await master.embedFont(StandardFonts.Helvetica);
  const all = master.getPages();
  const footer = front!.footerText();
  all.forEach((pg, i) => {
    const label = pageLabel(lang, i + 1, all.length);
    if (own.has(pg)) drawFooter(pg, font, footer, label);
    else {
      const s = front!.clean(`${T('Sammelmappe')} · ${label}`);
      pg.drawText(s, { x: (A4.w - font.widthOfTextAtSize(s, 7)) / 2, y: 13, size: 7, font, color: MUTED });
    }
  });
  const title = `${T('Sammelmappe')} ${p.name} ${period}`;
  master.setTitle(title);
  master.setProducer('Prüfkompass');
  master.setCreator('Prüfkompass');
  const bytes = await master.save();
  onProgress({ stage: 'build', done: 1, total: 1 });
  const datum = ymd(from) === ymd(to) ? ymd(from) : `${ymd(from)}_${ymd(to)}`;
  return {
    bytes,
    fileName: buildFileName('Sammelmappe_{objekt}_{datum}', { objekt: p.name, datum }),
    title: `Sammelmappe ${p.name} (${period})`,
    counts,
    pages: all.length,
    missingProof: items.filter((i) => i.proof.status !== 'ok').length,
  };
}

async function renderFront(
  brand: Brand,
  x: { p: PropertyDetail; sections: MappeSection<Item>[]; items: Item[]; counts: MappeCounts; period: string; pages: ReturnType<typeof mappePages> },
): Promise<Doc> {
  useBrand(brand);
  const { p, sections, items, counts, pages } = x;
  const doc = await Doc.create(brand, `${T('Sammelmappe')} ${p.name}`);
  doc.title(T('Sammelmappe Prüfprotokolle'), [p.name, p.address.split('\n').join(', ')].filter(Boolean).join(' · '), [x.period]);
  const inspectors = [...new Map(items.map((i) => [i.inspectorId, i.inspectorName])).values()];
  const cats = [...new Map(items.map((i) => [i.category, i.categoryLabel])).entries()].map(([k, l]) => `${T(l)}: ${items.filter((i) => i.category === k).length}`);
  doc.facts([
    [T('Objekt'), p.name],
    [T('Zeitraum'), x.period],
    [T('Geprüft'), String(counts.total)],
    [T('Ohne Mangel'), String(counts.clean)],
    [T('Mit Mangel'), String(counts.withDefects)],
    [T('Nicht prüfbar'), String(counts.notInspectable)],
    [T('Prüfer/innen'), inspectors.join(', ')],
    [T('Elementarten'), cats.join(' · ')],
    [T('Seiten'), String(pages.total)],
    [T('Mangelgruppen'), String(sections.filter((s) => s.kind === 'defects').length)],
  ]);

  // Prüfer/innen mit Nachweis je Elementart
  doc.heading(T('Prüfer/innen und Befähigungsnachweise'), 11);
  const combos = new Map<string, Item[]>();
  for (const it of items) {
    const k = `${it.inspectorId}|${it.category}`;
    combos.set(k, [...(combos.get(k) ?? []), it]);
  }
  const missing = items.filter((i) => i.proof.status !== 'ok');
  doc.table(
    [
      { label: T('Prüfer/in'), w: 2.2 },
      { label: T('Elementart'), w: 1.8 },
      { label: T('Befähigungsnachweis'), w: 4.2 },
      { label: T('Status'), w: 1.6, align: 'right' },
    ],
    [...combos.values()].map((list) => {
      const it = list[0];
      // Status über alle Prüfungen der Gruppe: ein fehlender/abgelaufener Fall reicht für den Hinweis
      const worst = list.find((i) => i.proof.status === 'missing') ?? list.find((i) => i.proof.status === 'expired') ?? it;
      const c = worst.proof.credential;
      const st = worst.proof.status;
      return {
        cells: [
          it.inspectorName,
          T(it.categoryLabel),
          c ? `${credentialText(c, T)}${c.validUntil ? ` · ${T('gültig bis')} ${d(c.validUntil)}` : ''}` : T('nicht hinterlegt'),
          st === 'ok' ? T('gültig') : st === 'expired' ? T('abgelaufen') : T('fehlt'),
        ],
        color: [undefined, undefined, undefined, st === 'ok' ? GREEN : WARN],
      };
    }),
  );
  if (missing.length)
    doc.text(`${T('Hinweis')}: ${missing.length} ${missing.length === 1 ? T('Protokoll ohne gültigen Befähigungsnachweis der prüfenden Person.') : T('Protokolle ohne gültigen Befähigungsnachweis der prüfenden Person.')}`, {
      size: 9,
      color: WARN,
    });

  doc.heading(T('Aufbau der Mappe'), 11);
  const groups = sections.filter((s) => s.kind === 'defects');
  const firstGroup = groups[0] ? pages.section.get(groups[0].key) : undefined;
  const clean = sections.find((s) => s.kind === 'clean');
  const blocked = sections.find((s) => s.kind === 'not_inspectable');
  const lines = [
    `${T('Inhaltsliste')} · ${T('Seite')} 2`,
    clean && `${T('Protokolle ohne Mangel')}: ${clean.items.length} · ${T('ab Seite')} ${pages.section.get(clean.key)}`,
    groups.length && `${T('Protokolle mit Mangel, nach gleichem Mangel gruppiert')}: ${groups.reduce((n, g) => n + g.items.length, 0)} ${T('in')} ${groups.length} ${groups.length === 1 ? T('Gruppe') : T('Gruppen')} · ${T('ab Seite')} ${firstGroup}`,
    blocked && `${T('Nicht prüfbar')}: ${blocked.items.length} · ${T('ab Seite')} ${pages.section.get(blocked.key)}`,
  ].filter(Boolean) as string[];
  lines.forEach((l, i) => doc.text(`${i + 1}. ${l}`, { size: 9.5 }));

  // Inhaltsliste
  doc.newPage();
  doc.title(T('Inhalt'), `${counts.total} ${T('Protokolle')} · ${x.period}`);
  const rows: Parameters<Doc['table']>[1] = [];
  for (const s of sections) {
    rows.push({ cells: [sectionTitle(s), '', '', '', String(pages.section.get(s.key) ?? '')], color: [MUTED, undefined, undefined, undefined, MUTED] });
    for (const it of s.items)
      rows.push({
        cells: [it.code, room(it) || '–', typ(it), resultLabel(it.result), String(pages.item.get(it.id) ?? '')],
        color: [undefined, undefined, undefined, it.result === 'ok' ? undefined : it.result === 'not_inspectable' ? undefined : WARN],
      });
  }
  doc.table(
    [
      { label: T('Nr.'), w: 1.4 },
      { label: T('Raum'), w: 3 },
      { label: T('Typ'), w: 2.6 },
      { label: T('Ergebnis'), w: 1.6 },
      { label: T('Seite'), w: 0.8, align: 'right' },
    ],
    rows,
  );
  return doc;
}

/** Zwischenblätter je Mangelgruppe und für „nicht prüfbar“; `at` = Seitenzahl in der Mappe je Blatt. */
async function renderSheets(brand: Brand, sections: MappeSection<Item>[], pages: ReturnType<typeof mappePages>) {
  useBrand(brand);
  const doc = await Doc.create(brand, T('Sammelmappe'));
  const at: number[] = [];
  const groups = sections.filter((s) => s.kind === 'defects');
  let first = true;
  for (const s of sections) {
    if (s.kind === 'clean') continue;
    if (!first) doc.newPage();
    first = false;
    at.push(pages.section.get(s.key)!);
    if (s.kind === 'defects') {
      const k = groups.indexOf(s) + 1;
      doc.title(`${T('Mangelgruppe')} ${k} / ${groups.length}`, `${s.items.length} ${s.items.length === 1 ? T('Element') : T('Elemente')} ${T('mit denselben Mängeln')}`);
      for (const df of s.defects) doc.text(`– ${T(df)}`, { size: 12, bold: true });
    } else {
      doc.title(T('Nicht prüfbar'), `${s.items.length} ${s.items.length === 1 ? T('Element') : T('Elemente')}`);
      doc.text(T('Diese Elemente waren zum Prüfzeitpunkt nicht prüfbar; der Grund steht im Protokoll.'), { color: MUTED });
    }
    doc.heading(T('Betroffene Elemente'), 11);
    doc.table(
      [
        { label: T('Nr.'), w: 1.4 },
        { label: T('Raum'), w: 3 },
        { label: T('Typ'), w: 2.6 },
        { label: T('Prüfdatum'), w: 1.4 },
        { label: T('Seite'), w: 0.8, align: 'right' },
      ],
      s.items.map((it) => ({ cells: [it.code, room(it) || '–', typ(it), d(it.inspectedAt), String(pages.item.get(it.id) ?? '')] })),
    );
  }
  return { doc, at };
}

// ---------- Angebotsliste ----------

export interface OfferDocData {
  offer: Offer;
  extras: ExtraLine[];
  property: { name: string; address: string };
  suggestions: SeriesSuggestion[];
}

const suggestionText = (s: SeriesSuggestion) =>
  `„${s.title}“: ${s.affected} / ${s.of} ${s.scope === 'property' ? T('im ganzen Objekt') : `${s.floors.length === 1 ? T('Etage') : T('Etagen')} ${s.floors.join(', ')}`} – ${T('als Sammelposition anbieten?')}`;

export async function offerPdf(data: OfferDocData, brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const { rows, net } = offerRows(data.offer, data.extras);
  const doc = await Doc.create(brand, `${T('Angebotsliste')} ${data.property.name}`);
  doc.title(`${T('Angebotsliste')} ${data.property.name}`, [data.property.address.split('\n').join(', '), `${T('Stand')} ${d(Date.now())}`].filter(Boolean).join(' · '));
  doc.facts([
    [T('Positionen'), String(rows.length)],
    [T('Summe netto'), money(net, lang)],
    [T('Mängel mit Leistung'), String(data.offer.lines.reduce((n, l) => n + l.defects.length, 0))],
    [T('Nicht zugeordnet'), String(data.offer.unmapped.length)],
  ]);
  doc.heading(T('Positionen'));
  if (!rows.length) doc.text(T('Keine Positionen.'), { color: MUTED });
  else
    doc.table(
      [
        { label: T('Pos.'), w: 0.6 },
        { label: T('Leistung'), w: 6 },
        { label: T('Menge'), w: 1.4, align: 'right' },
        { label: T('Einzelpreis'), w: 1.5, align: 'right' },
        { label: T('Gesamt'), w: 1.5, align: 'right' },
      ],
      [
        ...rows.map((r) => ({
          cells: [
            r.pos,
            `${r.serviceKey ? `${r.serviceKey} ` : ''}${T(r.title)}${r.doors.length ? `\n${T('Elemente')}: ${r.doors.join(', ')}` : r.extra ? `\n${T('hinzugefügt')}` : ''}`,
            `${qty(r.quantity, lang)} ${T(r.unit)}`,
            money(r.unitPrice, lang),
            money(r.total, lang),
          ],
        })),
        { cells: ['', T('Summe netto'), '', '', money(net, lang)], color: [undefined, INK, undefined, undefined, INK] },
      ],
    );
  if (data.offer.unmapped.length) {
    doc.heading(`${T('Nicht zugeordnete Mängel')} (${data.offer.unmapped.length})`);
    doc.text(T('Für diese Mängel ist im Katalog keine Leistung hinterlegt. Bitte von Hand bepreisen.'), { size: 9, color: WARN });
    doc.table(
      [
        { label: T('Element'), w: 1.5 },
        { label: T('Mangel'), w: 7 },
      ],
      data.offer.unmapped.map((u) => ({ cells: [u.door || '–', T(u.title)] })),
    );
  }
  if (data.suggestions.length) {
    doc.heading(T('Hinweise zu Sammelpositionen'));
    for (const s of data.suggestions) doc.text(`– ${suggestionText(s)}`, { size: 9 });
  }
  doc.gap(8);
  doc.text(T('Alle Preise netto zuzüglich gesetzlicher Umsatzsteuer. Liste zum Weiterverarbeiten, kein verbindliches Angebot.'), { size: 7.5, color: MUTED });
  return doc.finish();
}

export function offerXlsx(data: OfferDocData, language: DocLanguage = 'de'): Uint8Array {
  lang = language;
  const { rows, net } = offerRows(data.offer, data.extras);
  const sheet: (string | number | null)[][] = [
    [T('Pos.'), T('Kürzel'), T('Leistung'), T('Menge'), T('Einheit'), T('Einzelpreis netto'), T('Gesamt netto'), T('Elemente')],
    ...rows.map((r) => [Number(r.pos), r.serviceKey, T(r.title), r.quantity, T(r.unit), r.unitPrice, r.total, r.doors.length ? r.doors.join(', ') : r.extra ? T('hinzugefügt') : '']),
    [null, null, T('Summe netto'), null, null, null, net, null],
  ];
  if (data.offer.unmapped.length) {
    sheet.push([], [null, null, `${T('Nicht zugeordnete Mängel')} (${data.offer.unmapped.length})`]);
    for (const u of data.offer.unmapped) sheet.push([null, null, T(u.title), null, null, null, null, u.door]);
  }
  if (data.suggestions.length) {
    sheet.push([], [null, null, T('Hinweise zu Sammelpositionen')]);
    for (const s of data.suggestions) sheet.push([null, null, suggestionText(s)]);
  }
  return buildXlsx(T('Angebotsliste'), sheet, [6, 10, 48, 9, 10, 16, 16, 40]);
}

export const offerFileName = (name: string, ext: 'pdf' | 'xlsx') => buildFileName('Angebotsliste_{objekt}_{datum}', { objekt: name, datum: ymd(Date.now()) }, ext);
