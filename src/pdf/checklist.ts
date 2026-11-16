// Checkliste je Typ als PDF (Plan v7 W) – eine A4-Seite zum Mitführen: Kopf mit Typ, Anforderung, Zulassung;
// Prüfpunkte nach Bauteil-Gruppen, nur die für die Stammdaten zutreffenden, mit Kästchen und Platz für Türnummern.
// Eigene Datei; nutzt die vorhandene Layout-Schicht (src/pdf/layout.ts). Feste Texte englisch über shared/i18n.ts.
import type { Checklist } from '../../shared/checklist';
import { type DocLanguage, tr } from '../../shared/i18n';
import { A4, type Brand, Doc, INK, LINE, MUTED } from './layout';

export interface ChecklistInput {
  /** Hersteller und Typ, leer = unbekannt */
  type: string;
  categoryLabel: string;
  scheduleLabel: string;
  norm: string;
  requirement: string;
  approval: string;
  /** nur aus dem Element: Code, Nummer, Standort */
  element?: string;
  checklist: Checklist;
}

/** Unterkante des Inhalts (Fußzeile der Layout-Schicht beginnt bei 38 pt). */
const BOTTOM = 54;

export async function checklistPdf(c: ChecklistInput, brand: Brand): Promise<Uint8Array> {
  const lang: DocLanguage = brand.lang ?? 'de';
  const T = (s: string) => tr(lang, s);
  const typeName = c.type || T('Typ unbekannt');
  const doc = await Doc.create(brand, `${T('Checkliste')} ${typeName}`);
  const left = (A4.w - doc.width) / 2;
  doc.title(`${T('Checkliste')} ${typeName}`, [T(c.categoryLabel), T(c.scheduleLabel), c.norm].filter(Boolean).join(' · '));
  doc.facts([
    [T('Typ'), typeName],
    [T('Anforderung'), c.requirement || '–'],
    [T('Zulassung'), c.approval || '–'],
    [T('Elementart'), T(c.categoryLabel)],
    ...(c.element ? ([[T('Element'), c.element]] as [string, string][]) : []),
  ]);
  doc.gap(2);
  doc.text(T('Nur Abweichungen ansagen – alles Übrige gilt als in Ordnung.'), { size: 8.5, color: MUTED });
  doc.gap(4);

  // Spalten: Nr. | Prüfpunkt | Kästchen | Türen mit Abweichung / Notiz
  const wNo = 22;
  const wBox = 26;
  const wNote = Math.round(doc.width * 0.3);
  const wLabel = doc.width - wNo - wBox - wNote;
  const footer = 92;
  const rowsOf = (size: number) =>
    c.checklist.groups.map((g) => ({
      label: T(g.label),
      rows: g.rows.map((r) => {
        const text = `${T(r.label)}${r.ifPresent ? ` (${T('falls vorhanden')}: ${T(r.ifPresent)})` : ''}`;
        const lines = doc.wrap(text, wLabel - 8, size);
        return { n: r.n, lines, h: lines.length * size * 1.25 + 7 };
      }),
    }));
  // Schrift so wählen, dass alles auf eine Seite passt
  let size = 9;
  let groups = rowsOf(size);
  const need = (gs: typeof groups, s: number) => 18 + gs.reduce((sum, g) => sum + s + 10 + g.rows.reduce((x, r) => x + r.h, 0), 0);
  while (size > 6.5 && doc.y - need(groups, size) < BOTTOM + footer) {
    size -= 0.5;
    groups = rowsOf(size);
  }

  // Kopf der Tabelle
  const head = (label: string, x: number, w: number, right = false) => {
    const t = doc.clean(label);
    const tx = right ? x + w - 4 - doc.bold.widthOfTextAtSize(t, 8) : x + 4;
    doc.page.drawText(doc.fit(t, w - 8, 8, doc.bold), { x: tx, y: doc.y - 10, size: 8, font: doc.bold, color: INK });
  };
  doc.ensure(18);
  head(T('Nr.'), left, wNo);
  head(T('Prüfpunkte nach Bauteil'), left + wNo, wLabel);
  head(T('i. O.'), left + wNo + wLabel, wBox);
  head(T('Türen mit Abweichung / Notiz'), left + wNo + wLabel + wBox, wNote);
  doc.y -= 14;
  doc.page.drawLine({ start: { x: left, y: doc.y }, end: { x: left + doc.width, y: doc.y }, thickness: 0.9, color: INK });

  for (const g of groups) {
    doc.ensure(size + 12);
    doc.y -= 4;
    doc.page.drawText(doc.fit(doc.clean(g.label), doc.width, size, doc.bold), { x: left + 4, y: doc.y - size, size, font: doc.bold, color: INK });
    doc.y -= size + 5;
    for (const r of g.rows) {
      doc.ensure(r.h);
      const top = doc.y;
      doc.page.drawText(String(r.n), { x: left + 4, y: top - size - 2, size, font: doc.font, color: MUTED });
      r.lines.forEach((line, i) => doc.page.drawText(line, { x: left + wNo + 4, y: top - size - 2 - i * size * 1.25, size, font: doc.font, color: INK }));
      // Kästchen zum Ankreuzen
      const bs = Math.min(10, size + 1);
      doc.page.drawRectangle({ x: left + wNo + wLabel + (wBox - bs) / 2, y: top - 4 - bs, width: bs, height: bs, borderColor: INK, borderWidth: 0.7 });
      // Schreiblinie für Türnummern
      doc.page.drawLine({ start: { x: left + wNo + wLabel + wBox + 4, y: top - r.h + 4 }, end: { x: left + doc.width, y: top - r.h + 4 }, thickness: 0.4, color: LINE });
      doc.y -= r.h;
      doc.page.drawLine({ start: { x: left, y: doc.y }, end: { x: left + wNo + wLabel + wBox, y: doc.y }, thickness: 0.3, color: LINE });
    }
  }

  // Fuß: entfällt, geprüfte Türen, Datum/Prüfer
  doc.gap(8);
  if (c.checklist.omitted.length) {
    doc.text(`${T('Entfällt nach den Stammdaten')}: ${c.checklist.omitted.map(T).join('; ')}`, { size: 7.5, color: MUTED });
    doc.gap(4);
  }
  doc.ensure(64);
  const line = (label: string, x: number, w: number) => {
    doc.page.drawText(doc.clean(label), { x, y: doc.y - 8, size: 7.5, font: doc.font, color: MUTED });
    doc.page.drawLine({ start: { x, y: doc.y - 24 }, end: { x: x + w, y: doc.y - 24 }, thickness: 0.6, color: INK });
  };
  line(T('Geprüfte Türen (Nummern)'), left, doc.width);
  doc.y -= 32;
  const half = (doc.width - 24) / 2;
  line(T('Datum'), left, half);
  line(T('Prüfer/in'), left + half + 24, half);
  doc.y -= 30;
  return doc.finish();
}
