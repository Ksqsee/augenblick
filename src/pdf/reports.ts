// PDF-Erzeugung im Browser (keine Server-Rechenzeit, funktioniert auch offline).
import { INSPECTION_KINDS, SEVERITIES } from '../../shared/catalog';
import { buildFileName, uniqueName } from '../../shared/filename';
import { type DocLanguage, isValidTimeZone, LOCALE, tr } from '../../shared/i18n';
import { BUILDING_TYPES, WALK_SECTIONS, type WalkSection } from '../../shared/walkthrough';
import { api, type Asset, type Defect, fileUrl, type Inspection, type Me, type PropertyDetail, type PropertyRow, type Walkthrough } from '../api';
import { getCategory } from '../categories';
import { RESULT_META } from '../format';
import { AMBER, type Brand, dataUrlBytes, Doc, GREEN, MUTED, RED } from './layout';

// Sprache und Zeitzone des aktuellen Dokuments (wird je Dokument über die Marke gesetzt)
let lang: DocLanguage = 'de';
let dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
let dtFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function useBrand(b: Brand) {
  lang = b.lang ?? 'de';
  const timeZone = b.timeZone && isValidTimeZone(b.timeZone) ? b.timeZone : undefined;
  dateFmt = new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric', timeZone });
  dtFmt = new Intl.DateTimeFormat(LOCALE[lang], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
}
const T = (s: string) => tr(lang, s);
const d = (t: number | null | undefined) => (t ? dateFmt.format(t) : '–');
const dt = (t: number | null | undefined) => (t ? dtFmt.format(t) : '–');
const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const ANSWER = { ok: 'i. O.', defect: 'Mangel', na: 'n. z.' } as const;
const resultColor = (r: string | null) => (r === 'ok' ? GREEN : r === 'critical' ? RED : r === 'defects' ? AMBER : MUTED);

async function fetchBytes(key: string | null | undefined): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!key) return null;
  try {
    const res = await fetch(key.startsWith('/') || key.startsWith('blob:') ? key : fileUrl(key), { credentials: 'same-origin' });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
  } catch {
    return null;
  }
}

let brandCache: { key: string; brand: Brand } | null = null;
export async function loadBrand(me: Me): Promise<Brand> {
  const t = me.tenant;
  const cacheKey = JSON.stringify(t);
  if (brandCache?.key === cacheKey) return brandCache.brand;
  const logo = await fetchBytes(t.logoKey);
  const brand: Brand = {
    company: t.name,
    address: t.address,
    contact: [t.phone, t.email, t.website].filter(Boolean).join(' · '),
    logo: logo?.bytes,
    logoType: logo?.type,
    footer: '',
    lang: (t.language as DocLanguage) ?? 'de',
    timeZone: t.timeZone,
  };
  brandCache = { key: cacheKey, brand };
  return brand;
}

export function inspectionFileName(i: Inspection, tenantPattern: string) {
  return buildFileName(i.propertyPdfPattern || tenantPattern, {
    datum: iso(i.inspectedAt ?? i.createdAt),
    code: i.asset.code,
    art: i.asset.categoryLabel,
    pruefart: i.scheduleLabel,
    objekt: i.asset.propertyName,
    gebaeude: i.asset.buildingName,
    standort: i.asset.location,
    ergebnis: i.result ? RESULT_META[i.result].label : 'Entwurf',
  });
}

export async function inspectionPdf(i: Inspection, brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const def = getCategory(i.asset.category);
  const doc = await Doc.create(brand, `${T('Prüfprotokoll')} ${i.asset.code}`);
  doc.title(`${T('Prüfprotokoll')} ${T(i.asset.categoryLabel)}`, [T(i.scheduleLabel), i.asset.norm && `${T('Grundlage')}: ${i.asset.norm}`].filter(Boolean).join(' · '), [
    i.asset.code,
    `${T('Nr.')} ${i.id.slice(0, 8).toUpperCase()}`,
    ...(i.status === 'draft' ? [T('ENTWURF')] : []),
  ]);
  const attrs = (def.attributes ?? []).map(({ key, label }) => {
    const v = i.asset.attributes[key];
    return [T(label), v === true ? T('Ja') : v === false ? T('Nein') : v == null || v === '' ? '–' : String(v)] as [string, string];
  });
  doc.facts([
    [T('Objekt'), i.asset.propertyName],
    [T('Prüfdatum'), dt(i.inspectedAt ?? i.createdAt)],
    [T('Gebäude'), i.asset.buildingName],
    [T('Art der Prüfung'), T(INSPECTION_KINDS[i.kind])],
    [T('Standort'), [i.asset.location, i.asset.floor].filter(Boolean).join(', ')],
    [T('Prüfer/in'), i.inspectorName],
    [T('Hersteller / Typ'), [i.asset.manufacturer, i.asset.model].filter(Boolean).join(' / ')],
    [T('Nächste Prüfung'), d(i.nextDueAt)],
    ...attrs,
  ]);

  doc.heading(T('Prüfpunkte'));
  if (i.notInspectable) doc.text(T('Das Element war zum Prüfzeitpunkt nicht prüfbar.'), { color: MUTED });
  else
    doc.table(
      [
        { label: T('Nr.'), w: 0.6 },
        { label: T('Prüfpunkt'), w: 8 },
        { label: T('Befund'), w: 1.4, align: 'right' },
      ],
      i.checkpoints.map((cp, n) => {
        const a = i.answers[cp.id];
        return { cells: [String(n + 1), T(cp.label), a ? T(ANSWER[a]) : '–'], color: [undefined, undefined, a === 'defect' ? RED : undefined] };
      }),
    );

  if (i.defects.length) {
    doc.heading(T('Festgestellte Mängel'));
    for (const [n, df] of i.defects.entries()) {
      doc.text(`${n + 1}. ${T(df.title)} – ${T(SEVERITIES[df.severity])}`, { bold: true });
      if (df.note) doc.text(df.note, { color: MUTED, x: 58, width: doc.width - 12 });
      if (df.measure) doc.text(`${T('Maßnahme')}: ${df.measure}`, { x: 58, width: doc.width - 12 });
      const img = await fetchBytes(df.photoKey);
      if (img) await doc.image(img.bytes, img.type, 200, 130);
      doc.gap(4);
    }
  }
  if (i.maintenance.length) {
    doc.heading(T('Durchgeführte Arbeiten'));
    doc.text(i.maintenance.map((k) => T(def.maintenance.find((m) => m.key === k)?.label ?? k)).join(' · '));
  }
  if (i.notes) {
    doc.heading(T('Bemerkungen'));
    doc.text(i.notes);
  }
  if (i.photos?.length) {
    doc.heading(T('Fotos'));
    const items = [];
    for (const p of i.photos) {
      const b = await fetchBytes(p.key);
      items.push({ bytes: b?.bytes ?? null, type: b?.type ?? '', caption: p.caption });
    }
    await doc.gallery(items);
  }
  if (i.resultOverride && i.resultReason) {
    doc.heading(T('Begründung der Gesamtbewertung'));
    doc.text(i.resultReason);
  }
  const sig = dataUrlBytes(i.signature);
  await doc.resultAndSignature(i.resultOverride ? T('Gesamtergebnis (festgelegt)') : T('Gesamtergebnis'), i.result ? T(RESULT_META[i.result].label) : T('Offen'), resultColor(i.result), {
    bytes: sig?.bytes ?? null,
    type: sig?.type ?? '',
    name: i.signerName || i.inspectorName,
    date: d(i.inspectedAt ?? i.createdAt),
  });
  return doc.finish();
}

export async function walkthroughPdf(w: Walkthrough, brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const doc = await Doc.create(brand, `${T('Begehung')} ${w.propertyName}`);
  doc.title(T('Protokoll Brandschutzbegehung'), [w.propertyName, w.buildingName].filter(Boolean).join(' · '), [dt(w.inspectedAt ?? w.createdAt), ...(w.status === 'draft' ? [T('ENTWURF')] : [])]);
  doc.facts([
    [T('Adresse'), w.propertyAddress.split('\n').join(', ')],
    [T('Nutzung'), T(BUILDING_TYPES[w.buildingType])],
    [T('Durchgeführt von'), w.inspectorName],
    [T('Nächste Begehung'), d(w.nextDueAt)],
    [T('Teilnehmende'), w.participants],
    [T('Feststellungen'), String(w.findings.length)],
  ]);
  if (w.findings.length) {
    doc.heading(T('Feststellungen'));
    for (const [n, f] of w.findings.entries()) {
      const q = w.questions.find((x) => x.id === f.questionId);
      doc.text(`${n + 1}. ${T(f.title)} – ${T(SEVERITIES[f.severity])}${q ? ` (${q.basis})` : ''}`, { bold: true });
      if (f.note) doc.text(f.note, { color: MUTED, x: 58, width: doc.width - 12 });
      if (f.measure) doc.text(`${T('Maßnahme')}: ${f.measure}`, { x: 58, width: doc.width - 12 });
      const img = await fetchBytes(f.photoKey);
      if (img) await doc.image(img.bytes, img.type, 200, 130);
      doc.gap(4);
    }
  }
  for (const sec of [...new Set(w.questions.map((q) => q.section as WalkSection))]) {
    doc.heading(T(WALK_SECTIONS[sec]), 11);
    doc.table(
      [
        { label: T('Frage'), w: 6 },
        { label: T('Grundlage'), w: 2.4 },
        { label: T('Befund'), w: 1.2, align: 'right' },
      ],
      w.questions
        .filter((q) => q.section === sec)
        .map((q) => {
          const a = w.answers[q.id];
          return { cells: [T(q.text), q.basis, a ? T(ANSWER[a]) : '–'], color: [undefined, undefined, a === 'defect' ? RED : undefined] };
        }),
    );
  }
  if (w.notes) {
    doc.heading(T('Bemerkungen'));
    doc.text(w.notes);
  }
  const sig = dataUrlBytes(w.signature);
  await doc.resultAndSignature(T('Gesamtergebnis'), w.result ? T(RESULT_META[w.result].label) : T('Offen'), resultColor(w.result), {
    bytes: sig?.bytes ?? null,
    type: sig?.type ?? '',
    name: w.signerName || w.inspectorName,
    date: d(w.inspectedAt ?? w.createdAt),
  });
  doc.gap(6);
  doc.text(T('Rechtsgrundlagen sind Orientierungshinweise; maßgeblich sind die im Einzelfall geltenden Vorschriften und das Brandschutzkonzept.'), { size: 7.5, color: MUTED });
  return doc.finish();
}

export async function defectsPdf(defects: Defect[], brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const doc = await Doc.create(brand, T('Mängelbericht'));
  doc.title(T('Mängelbericht'), `${defects.length} ${T('offene Mängel')} · ${T('Stand')} ${dt(Date.now())}`);
  for (const [n, df] of defects.entries()) {
    doc.ensure(40);
    doc.text(`${n + 1}. ${T(df.title)}`, { bold: true });
    doc.text(
      [T(SEVERITIES[df.severity]), df.code ?? T('Begehung'), df.location, df.buildingName, df.propertyName, `${T('erfasst')} ${d(df.createdAt)}`, df.legalBasis].filter(Boolean).join(' · '),
      { size: 8.5, color: df.severity === 'critical' || df.severity === 'high' ? RED : MUTED },
    );
    if (df.note) doc.text(df.note, { size: 9 });
    if (df.measure) doc.text(`${T('Maßnahme')}: ${df.measure}`, { size: 9 });
    const img = await fetchBytes(df.photoKey);
    if (img) await doc.image(img.bytes, img.type, 180, 110);
    doc.gap(6);
  }
  if (!defects.length) doc.text(T('Keine offenen Mängel.'), { color: MUTED });
  return doc.finish();
}

export async function compliancePdf(props: PropertyRow[], overdue: Asset[], soon: Asset[], brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const doc = await Doc.create(brand, T('Compliance-Übersicht'));
  const total = props.reduce((s, p) => s + p.assets, 0);
  doc.title(T('Compliance-Übersicht'), `${props.length} ${T('Objekte')} · ${total} ${T('Elemente')} · ${T('Stand')} ${dt(Date.now())}`);
  doc.table(
    [
      { label: T('Objekt'), w: 4 },
      { label: T('Elemente'), w: 1.1, align: 'right' },
      { label: T('Überfällig'), w: 1.2, align: 'right' },
      { label: T('Bald fällig'), w: 1.2, align: 'right' },
      { label: T('Ungeprüft'), w: 1.2, align: 'right' },
      { label: T('Mängel'), w: 1, align: 'right' },
      { label: T('Begehung'), w: 1.6, align: 'right' },
    ],
    props.map((p) => ({
      cells: [p.name, String(p.assets), String(p.overdue ?? 0), String(p.soon ?? 0), String(p.never ?? 0), String(p.openDefects), d(p.nextWalkAt)],
      color: [undefined, undefined, p.overdue ? RED : undefined],
    })),
  );
  for (const [title, list] of [
    [T('Überfällige Elemente'), overdue],
    [T('In 30 Tagen fällig'), soon],
  ] as const) {
    doc.heading(`${T(title)} (${list.length})`);
    if (!list.length) doc.text(T('Keine.'), { color: MUTED });
    else
      doc.table(
        [
          { label: T('Code'), w: 1.6 },
          { label: T('Art'), w: 2 },
          { label: T('Ort'), w: 5 },
          { label: T('Fällig'), w: 1.4, align: 'right' },
        ],
        list.map((a) => ({ cells: [a.code, T(getCategory(a.category).label), [a.propertyName, a.buildingName, a.location].filter(Boolean).join(' · '), d(a.nextDueAt)] })),
      );
  }
  return doc.finish();
}

/** Objektbericht: Stammdaten, Brandschutzbeauftragte, Status je Gebäude, alle Elemente, offene Mängel, Begehungen. */
export async function propertyPdf(p: PropertyDetail, defects: Defect[], brand: Brand): Promise<Uint8Array> {
  useBrand(brand);
  const now = Date.now();
  const soon = now + 30 * 86_400_000;
  const doc = await Doc.create(brand, `${T('Objektbericht')} ${p.name}`);
  const overdue = p.assets.filter((a) => a.nextDueAt != null && a.nextDueAt < now);
  const dueSoon = p.assets.filter((a) => a.nextDueAt != null && a.nextDueAt >= now && a.nextDueAt <= soon);
  const never = p.assets.filter((a) => a.nextDueAt == null);
  doc.title(`${T('Objektbericht')} ${p.name}`, [p.address, `${T('Stand')} ${dt(now)}`].filter(Boolean).join(' · '));
  const officer = p.fireOfficers.find((o) => !o.appointedTo || o.appointedTo > now);
  doc.facts([
    [T('Nutzung'), T(BUILDING_TYPES[p.buildingType]) ?? '–'],
    [T('Ansprechpartner'), [p.contactName, p.contactPhone, p.contactEmail].filter(Boolean).join(' · ') || '–'],
    [T('Brandschutzbeauftragte/r'), officer ? [officer.name, officer.company, officer.phone].filter(Boolean).join(' · ') : '–'],
    [T('Elemente'), `${p.assets.length} ${T('in')} ${p.buildings.length} ${T('Gebäuden')}`],
    [T('Status'), `${overdue.length} ${T('überfällig')} · ${dueSoon.length} ${T('in 30 Tagen fällig')} · ${never.length} ${T('ungeprüft')} · ${defects.length} ${T('offene Mängel')}`],
  ]);
  if (p.description) doc.text(p.description, { size: 9, color: MUTED });

  doc.heading(T('Status je Gebäude'));
  doc.table(
    [
      { label: T('Gebäude'), w: 4 },
      { label: T('Elemente'), w: 1.2, align: 'right' },
      { label: T('Überfällig'), w: 1.2, align: 'right' },
      { label: T('Bald fällig'), w: 1.2, align: 'right' },
      { label: T('Ungeprüft'), w: 1.2, align: 'right' },
      { label: T('Mängel'), w: 1, align: 'right' },
    ],
    p.buildings.map((b) => {
      const list = p.assets.filter((a) => a.buildingId === b.id);
      const o = list.filter((a) => overdue.includes(a)).length;
      return {
        cells: [b.name, String(list.length), String(o), String(list.filter((a) => dueSoon.includes(a)).length), String(list.filter((a) => never.includes(a)).length), String(list.reduce((n, a) => n + (a.openDefects ?? 0), 0))],
        color: [undefined, undefined, o ? RED : undefined],
      };
    }),
  );

  for (const b of p.buildings) {
    const list = p.assets.filter((a) => a.buildingId === b.id);
    doc.heading(`${T('Elemente')} · ${b.name} (${list.length})`);
    if (!list.length) {
      doc.text(T('Keine Elemente.'), { color: MUTED });
      continue;
    }
    doc.table(
      [
        { label: T('Code'), w: 1.5 },
        { label: T('Art'), w: 2 },
        { label: T('Standort'), w: 3.4 },
        { label: T('Letzte Prüfung'), w: 1.5 },
        { label: T('Ergebnis'), w: 1.5 },
        { label: T('Nächste'), w: 1.4, align: 'right' },
      ],
      list.map((a) => ({
        cells: [a.code, T(getCategory(a.category).label), [a.location, a.floor].filter(Boolean).join(' · '), d(a.lastInspectedAt), a.lastResult ? T(RESULT_META[a.lastResult].label) : '–', d(a.nextDueAt)],
        color: [undefined, undefined, undefined, undefined, resultColor(a.lastResult), a.nextDueAt != null && a.nextDueAt < now ? RED : undefined],
      })),
    );
  }

  doc.heading(`${T('Offene Mängel')} (${defects.length})`);
  if (!defects.length) doc.text(T('Keine offenen Mängel.'), { color: MUTED });
  for (const df of defects) {
    doc.ensure(30);
    doc.text(T(df.title), { bold: true, size: 9.5 });
    doc.text([T(SEVERITIES[df.severity]), df.code ?? T('Begehung'), df.location, df.buildingName, `${T('erfasst')} ${d(df.createdAt)}`].filter(Boolean).join(' · '), {
      size: 8.5,
      color: df.severity === 'critical' || df.severity === 'high' ? RED : MUTED,
    });
    if (df.note) doc.text(df.note, { size: 9 });
    if (df.measure) doc.text(`${T('Maßnahme')}: ${df.measure}`, { size: 9 });
    doc.gap(4);
  }

  const walks = p.walkthroughs.filter((w) => w.status === 'submitted');
  doc.heading(T('Brandschutzbegehungen'));
  if (!walks.length) doc.text(T('Noch keine Begehung abgeschlossen.'), { color: MUTED });
  else
    doc.table(
      [
        { label: T('Datum'), w: 1.6 },
        { label: T('Durchgeführt von'), w: 3 },
        { label: T('Ergebnis'), w: 1.8 },
        { label: T('Offene Mängel'), w: 1.6, align: 'right' },
        { label: T('Nächste'), w: 1.6, align: 'right' },
      ],
      walks.map((w) => ({ cells: [d(w.inspectedAt), w.inspector, w.result ? T(RESULT_META[w.result].label) : '–', String(w.openDefects), d(w.nextDueAt)], color: [undefined, undefined, resultColor(w.result)] })),
    );
  return doc.finish();
}

export function download(bytes: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Mehrere Prüfprotokolle als ZIP. */
export async function protocolsZip(ids: string[], me: Me, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  const brand = await loadBrand(me);
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const [n, id] of ids.entries()) {
    const insp = await api<Inspection>(`/inspections/${id}`);
    files[uniqueName(inspectionFileName(insp, me.tenant.pdfPattern), used)] = await inspectionPdf(insp, brand);
    onProgress?.(n + 1, ids.length);
  }
  return zipSync(files, { level: 0 });
}


