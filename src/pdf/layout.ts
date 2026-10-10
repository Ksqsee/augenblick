// Kleine Layout-Schicht über pdf-lib: Seitenumbruch, Textumbruch, Tabellen, Bilder, Kopf/Fuß.
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

export const A4 = { w: 595.28, h: 841.89 };
const M = { top: 64, bottom: 54, left: 46, right: 46 };
export const INK = rgb(0.11, 0.1, 0.09);
export const MUTED = rgb(0.45, 0.43, 0.4);
export const LINE = rgb(0.86, 0.84, 0.8);
export const RED = rgb(0.78, 0.12, 0.12);
export const GREEN = rgb(0.08, 0.5, 0.24);
export const AMBER = rgb(0.7, 0.33, 0.04);
export const BRAND = rgb(0.89, 0.33, 0.11);

export interface Brand {
  company: string;
  address?: string;
  contact?: string;
  logo?: Uint8Array | null;
  logoType?: string | null;
  footer: string;
  lang?: 'de' | 'en';
  timeZone?: string;
}

type Color = ReturnType<typeof rgb>;

export class Doc {
  pdf!: PDFDocument;
  font!: PDFFont;
  bold!: PDFFont;
  page!: PDFPage;
  y = 0;
  private logo: PDFImage | null = null;
  private cache = new Map<string, boolean>();
  readonly width = A4.w - M.left - M.right;

  static async create(brand: Brand, title: string) {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(title);
    d.pdf.setProducer('Prüfkompass');
    d.pdf.setCreator('Prüfkompass');
    d.font = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    if (brand.logo) d.logo = await d.embed(brand.logo, brand.logoType ?? '');
    d.brand = brand;
    d.newPage();
    return d;
  }
  private brand!: Brand;

  async embed(bytes: Uint8Array, type: string): Promise<PDFImage | null> {
    try {
      if (/png/.test(type) || (bytes[0] === 0x89 && bytes[1] === 0x50)) return await this.pdf.embedPng(bytes);
      if (/jpe?g/.test(type) || (bytes[0] === 0xff && bytes[1] === 0xd8)) return await this.pdf.embedJpg(bytes);
    } catch {
      /* nicht unterstütztes Bild */
    }
    return null;
  }

  /** Nur Zeichen, die die Standardschrift (WinAnsi) kann. */
  clean(s: string): string {
    let out = '';
    for (const ch of s.replace(/\r/g, '').replace(/₂/g, '2').replace(/[‐‑‒—]/g, '–').replace(/\t/g, ' ')) {
      if (ch === '\n') {
        out += ch;
        continue;
      }
      let ok = this.cache.get(ch);
      if (ok === undefined) {
        try {
          this.font.encodeText(ch);
          ok = true;
        } catch {
          ok = false;
        }
        this.cache.set(ch, ok);
      }
      out += ok ? ch : '?';
    }
    return out;
  }

  newPage() {
    this.page = this.pdf.addPage([A4.w, A4.h]);
    this.y = A4.h - M.top;
    // Kopfzeile
    const top = A4.h - 34;
    let x = M.left;
    if (this.logo) {
      const h = 22;
      const w = Math.min(110, (this.logo.width / this.logo.height) * h);
      this.page.drawImage(this.logo, { x, y: top - h + 8, width: w, height: h });
      x += w + 10;
    }
    this.page.drawText(this.clean(this.brand.company), { x, y: top - 4, size: 9, font: this.bold, color: INK });
    const right = [this.brand.address?.split('\n').join(', '), this.brand.contact].filter(Boolean).join(' · ');
    if (right) {
      const t = this.clean(right).slice(0, 110);
      this.page.drawText(t, { x: A4.w - M.right - this.font.widthOfTextAtSize(t, 7.5), y: top - 4, size: 7.5, font: this.font, color: MUTED });
    }
    this.page.drawLine({ start: { x: M.left, y: top - 14 }, end: { x: A4.w - M.right, y: top - 14 }, thickness: 0.6, color: LINE });
  }

  /** Seitenzahlen und Fußzeile am Ende auf alle Seiten schreiben. */
  finish() {
    const pages = this.pdf.getPages();
    pages.forEach((p, i) => {
      const en = this.brand.lang === 'en';
      const stamp = new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: this.brand.timeZone || undefined }).format(Date.now());
      const f = this.clean(this.brand.footer || `${this.brand.company} · ${en ? 'created with Prüfkompass on' : 'erstellt mit Prüfkompass am'} ${stamp}`);
      p.drawLine({ start: { x: M.left, y: 38 }, end: { x: A4.w - M.right, y: 38 }, thickness: 0.6, color: LINE });
      p.drawText(f, { x: M.left, y: 26, size: 7.5, font: this.font, color: MUTED });
      const n = this.brand.lang === 'en' ? `Page ${i + 1} of ${pages.length}` : `Seite ${i + 1} von ${pages.length}`;
      p.drawText(n, { x: A4.w - M.right - this.font.widthOfTextAtSize(n, 7.5), y: 26, size: 7.5, font: this.font, color: MUTED });
    });
    return this.pdf.save();
  }

  ensure(h: number) {
    if (this.y - h < M.bottom) this.newPage();
  }

  gap(h = 8) {
    this.y -= h;
  }

  wrap(text: string, width: number, size: number, font = this.font): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) <= width) cur = next;
        else {
          if (cur) lines.push(cur);
          // sehr lange Wörter hart umbrechen
          let rest = w;
          while (font.widthOfTextAtSize(rest, size) > width) {
            let i = rest.length;
            while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
            lines.push(rest.slice(0, i));
            rest = rest.slice(i);
          }
          cur = rest;
        }
      }
      lines.push(cur);
    }
    return lines;
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: Color; x?: number; width?: number; lineGap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const lh = size * (opts.lineGap ?? 1.35);
    for (const line of this.wrap(s, opts.width ?? this.width, size, font)) {
      this.ensure(lh);
      this.page.drawText(line, { x: opts.x ?? M.left, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= lh;
    }
  }

  heading(s: string, size = 12) {
    this.ensure(size + 24);
    this.gap(10);
    this.text(s, { size, bold: true });
    this.gap(2);
  }

  title(t: string, sub?: string, right?: string[]) {
    this.text(t, { size: 17, bold: true });
    if (sub) this.text(sub, { size: 9.5, color: MUTED });
    if (right?.length) {
      let ry = A4.h - M.top;
      for (const r of right) {
        const s = this.clean(r);
        this.page.drawText(s, { x: A4.w - M.right - this.bold.widthOfTextAtSize(s, 9.5), y: ry - 9.5, size: 9.5, font: this.bold, color: INK });
        ry -= 13;
      }
    }
    this.gap(4);
    this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: A4.w - M.right, y: this.y }, thickness: 1.4, color: INK });
    this.gap(10);
  }

  /** Zweispaltige Schlüssel/Wert-Liste. */
  facts(items: [string, string][]) {
    const colW = (this.width - 18) / 2;
    for (let i = 0; i < items.length; i += 2) {
      const pair = items.slice(i, i + 2);
      const heights = pair.map(([, v]) => this.wrap(v || '–', colW - 100, 9).length);
      const h = Math.max(...heights) * 12 + 5;
      this.ensure(h);
      pair.forEach(([k, v], j) => {
        const x = M.left + j * (colW + 18);
        this.page.drawText(this.clean(k), { x, y: this.y - 9, size: 8.5, font: this.font, color: MUTED });
        this.wrap(v || '–', colW - 100, 9).forEach((line, li) => {
          this.page.drawText(line, { x: x + colW - this.bold.widthOfTextAtSize(line, 9) - 0, y: this.y - 9 - li * 12, size: 9, font: this.bold, color: INK });
        });
        this.page.drawLine({ start: { x, y: this.y - h + 2 }, end: { x: x + colW, y: this.y - h + 2 }, thickness: 0.4, color: LINE });
      });
      this.y -= h + 2;
    }
  }

  /** Tabelle mit festen Spaltenbreiten (Anteile), Kopf wird auf Folgeseiten wiederholt. */
  table(cols: { label: string; w: number; align?: 'right' }[], rows: { cells: string[]; color?: (Color | undefined)[] }[]) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * this.width);
    const drawHead = () => {
      this.ensure(18);
      let x = M.left;
      cols.forEach((c, i) => {
        const t = this.clean(c.label);
        const tx = c.align === 'right' ? x + widths[i] - 4 - this.bold.widthOfTextAtSize(t, 8.5) : x + 4;
        this.page.drawText(t, { x: tx, y: this.y - 11, size: 8.5, font: this.bold, color: INK });
        x += widths[i];
      });
      this.y -= 15;
      this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: A4.w - M.right, y: this.y }, thickness: 0.9, color: INK });
    };
    drawHead();
    for (const r of rows) {
      const wrapped = r.cells.map((c, i) => this.wrap(c || '–', widths[i] - 8, 8.8));
      const h = Math.max(...wrapped.map((w) => w.length)) * 11.5 + 6;
      if (this.y - h < M.bottom) {
        this.newPage();
        drawHead();
      }
      let x = M.left;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, li) => {
          const font = r.color?.[i] ? this.bold : this.font;
          const tx = cols[i].align === 'right' ? x + widths[i] - 4 - font.widthOfTextAtSize(line, 8.8) : x + 4;
          this.page.drawText(line, { x: tx, y: this.y - 11 - li * 11.5, size: 8.8, font, color: r.color?.[i] ?? INK });
        });
        x += widths[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M.left, y: this.y }, end: { x: A4.w - M.right, y: this.y }, thickness: 0.4, color: LINE });
    }
  }

  async image(bytes: Uint8Array | null, type: string, maxW: number, maxH: number, caption?: string) {
    if (!bytes) return;
    const img = await this.embed(bytes, type);
    if (!img) return;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + (caption ? 16 : 6));
    this.page.drawImage(img, { x: M.left, y: this.y - h, width: w, height: h });
    this.y -= h + 4;
    if (caption) this.text(caption, { size: 8, color: MUTED });
  }

  /** Bilder als Raster (z. B. Fotos), je Zeile 3 Stück. */
  async gallery(items: { bytes: Uint8Array | null; type: string; caption: string }[]) {
    const per = 3;
    const gapX = 10;
    const w = (this.width - gapX * (per - 1)) / per;
    const h = w * 0.75;
    for (let i = 0; i < items.length; i += per) {
      const row = items.slice(i, i + per);
      this.ensure(h + 22);
      let x = M.left;
      for (const it of row) {
        const img = it.bytes ? await this.embed(it.bytes, it.type) : null;
        if (img) {
          const s = Math.min(w / img.width, h / img.height);
          this.page.drawImage(img, { x: x + (w - img.width * s) / 2, y: this.y - h + (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
        }
        this.page.drawRectangle({ x, y: this.y - h, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
        const cap = this.wrap(it.caption || '', w, 7.5)[0] ?? '';
        this.page.drawText(cap, { x, y: this.y - h - 10, size: 7.5, font: this.font, color: MUTED });
        x += w + gapX;
      }
      this.y -= h + 20;
    }
  }

  /** Ergebnisbox links, Unterschrift rechts. */
  async resultAndSignature(label: string, value: string, color: Color, sig: { bytes: Uint8Array | null; type: string; name: string; date: string }) {
    this.ensure(92);
    this.gap(8);
    const half = (this.width - 24) / 2;
    const top = this.y;
    this.page.drawRectangle({ x: M.left, y: top - 56, width: half, height: 56, borderColor: color, borderWidth: 1.8 });
    this.page.drawText(this.clean(label.toUpperCase()), { x: M.left + 10, y: top - 18, size: 7.5, font: this.font, color: MUTED });
    this.page.drawText(this.clean(value), { x: M.left + 10, y: top - 38, size: 14, font: this.bold, color: INK });
    const sx = M.left + half + 24;
    if (sig.bytes) {
      const img = await this.embed(sig.bytes, sig.type);
      if (img) {
        const s = Math.min(half / img.width, 46 / img.height);
        this.page.drawImage(img, { x: sx, y: top - 50, width: img.width * s, height: img.height * s });
      }
    }
    this.page.drawLine({ start: { x: sx, y: top - 56 }, end: { x: sx + half, y: top - 56 }, thickness: 0.8, color: INK });
    this.page.drawText(this.clean(`${sig.name}, ${sig.date}`), { x: sx, y: top - 68, size: 8.5, font: this.font, color: INK });
    this.y = top - 80;
  }
}

export function dataUrlBytes(url: string | null | undefined): { bytes: Uint8Array; type: string } | null {
  if (!url?.startsWith('data:')) return null;
  const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!m || !m[2]) return null;
  return { type: m[1], bytes: Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) };
}
